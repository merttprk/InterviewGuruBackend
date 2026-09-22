import {onCall, onRequest} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {defineSecret} from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

import {
  AppError, optionalText, rateLimit, requireText, requireUid, toHttpsError,
} from "./middleware/errors";
import {CREDIT_COST, MAX_CV_CHARS, dayKey, normalizeLanguage, Language} from "./config";
import * as credits from "./services/credits";
import {processRevenueCatWebhook} from "./services/subscription";
import {sendPushChunked} from "./services/onesignal";
import {NOTIFICATION_TEXTS} from "./services/notification-texts";
import {reviewCv as runCvReview, improveCvText as runImprove, ImproveKind} from "./ai/cv-review";
import {
  evaluateAnswers, generateQuestions, InterviewType, Seniority,
} from "./ai/interview";

admin.initializeApp();

// Sırlar Secret Manager'da. Ayarlamak için: firebase functions:secrets:set <AD>
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const REVENUECAT_WEBHOOK_AUTH = defineSecret("REVENUECAT_WEBHOOK_AUTH");
const ONESIGNAL_API_KEY = defineSecret("ONESIGNAL_API_KEY");

/**
 * App Check: istemciler Play Integrity / App Attest jetonu gönderir. İlk
 * sürümde zorunlu değil (debug derlemeler ve App Check kaydı yapılmadan
 * önce kırılmasın diye); konsolda uygulamalar kaydedilince
 * ENFORCE_APP_CHECK=true yapılır (functions/.env).
 */
const enforceAppCheck = process.env.ENFORCE_APP_CHECK === "true";

const AI_OPTIONS = {
  timeoutSeconds: 120,
  memory: "512MiB" as const,
  maxInstances: 20,
  enforceAppCheck,
  secrets: [OPENAI_API_KEY],
};

const db = () => admin.firestore();
const serverTime = () => admin.firestore.FieldValue.serverTimestamp();

// ---------------------------------------------------------------------------
// Kredi durumu
// ---------------------------------------------------------------------------

/**
 * İstemcinin kredi göstergesi. Yeni kullanıcıya hoş geldin kredisini de
 * (idempotent) burada tanımlar. deviceId: Android SSAID / iOS IDFV.
 */
export const getAiState = onCall({enforceAppCheck}, async (request) => {
  try {
    const uid = requireUid(request);
    await credits.grantWelcomeIfNeeded(uid, request.data?.deviceId);
    return {success: true, ...(await credits.getState(uid))};
  } catch (e) {
    throw toHttpsError(e);
  }
});

/** Ödüllü reklam izlendikten sonra 1 kredi (günlük sınırlı). */
export const claimAdReward = onCall({enforceAppCheck}, async (request) => {
  try {
    const uid = requireUid(request);
    await rateLimit(uid, "claimAdReward", 10, 60 * 60 * 1000);
    return {success: true, ...(await credits.rewardAd(uid))};
  } catch (e) {
    throw toHttpsError(e);
  }
});

// ---------------------------------------------------------------------------
// CV
// ---------------------------------------------------------------------------

/**
 * CV değerlendirmesi. İstemci PDF'ten metni cihazda çıkarır ve metni gönderir
 * (PDF'i yüklemek hem yavaş hem gereksiz). Sonuç users/{uid}/cvReviews altına
 * yazılır; istemci geçmişi oradan okur, yazamaz.
 */
export const reviewCv = onCall(AI_OPTIONS, async (request) => {
  try {
    const uid = requireUid(request);
    await rateLimit(uid, "reviewCv", 10, 10 * 60 * 1000);

    const cvText = requireText(request.data?.cvText, "cvText", MAX_CV_CHARS, 150);
    const language = normalizeLanguage(request.data?.language);
    const targetRole = optionalText(request.data?.targetRole, 120);
    const fileName = optionalText(request.data?.fileName, 200);

    await credits.grantWelcomeIfNeeded(uid, request.data?.deviceId);
    await credits.assertCanSpend(uid, CREDIT_COST.reviewCv);

    const review = await runCvReview(cvText, language, targetRole);
    const state = await credits.spend(uid, CREDIT_COST.reviewCv);

    const ref = db().collection("users").doc(uid).collection("cvReviews").doc();
    await ref.set({
      createdAt: serverTime(),
      language,
      targetRole,
      fileName,
      overallScore: review.overallScore,
      review,
    });

    logger.info("CV değerlendirildi", {uid, score: review.overallScore, language});
    return {success: true, reviewId: ref.id, review, state};
  } catch (e) {
    throw toHttpsError(e);
  }
});

/** CV oluşturucu yardımcısı: bir alanı yeniden yazar. */
export const improveCvText = onCall(AI_OPTIONS, async (request) => {
  try {
    const uid = requireUid(request);
    await rateLimit(uid, "improveCvText", 20, 10 * 60 * 1000);

    const text = requireText(request.data?.text, "text", 4000, 10);
    const kinds: ImproveKind[] = ["summary", "experience", "skills", "cover_letter"];
    const kind = kinds.includes(request.data?.kind) ? (request.data.kind as ImproveKind) : "summary";
    const language = normalizeLanguage(request.data?.language);
    const targetRole = optionalText(request.data?.targetRole, 120);

    await credits.grantWelcomeIfNeeded(uid, request.data?.deviceId);
    await credits.assertCanSpend(uid, CREDIT_COST.improveCvText);
    const result = await runImprove(text, kind, language, targetRole);
    const state = await credits.spend(uid, CREDIT_COST.improveCvText);
    return {success: true, result, state};
  } catch (e) {
    throw toHttpsError(e);
  }
});

// ---------------------------------------------------------------------------
// Deneme mülakatı
// ---------------------------------------------------------------------------

const SENIORITIES: Seniority[] = ["intern", "junior", "mid", "senior", "lead"];
const TYPES: InterviewType[] = ["behavioral", "technical", "mixed", "hr"];

export const generateInterviewQuestions = onCall(AI_OPTIONS, async (request) => {
  try {
    const uid = requireUid(request);
    await rateLimit(uid, "generateInterviewQuestions", 10, 10 * 60 * 1000);

    const role = requireText(request.data?.role, "role", 120, 2);
    const seniority = SENIORITIES.includes(request.data?.seniority) ? request.data.seniority : "mid";
    const type = TYPES.includes(request.data?.type) ? request.data.type : "mixed";
    const count = Math.max(3, Math.min(10, Number(request.data?.count) || 5));
    const language = normalizeLanguage(request.data?.language);
    const jobDescription = optionalText(request.data?.jobDescription, 4000);

    await credits.countQuestionSet(uid);
    const questions = await generateQuestions(role, seniority, type, count, language, jobDescription);

    const ref = db().collection("users").doc(uid).collection("interviews").doc();
    await ref.set({
      createdAt: serverTime(),
      status: "in_progress",
      role,
      seniority,
      type,
      language,
      questions,
    });
    return {success: true, interviewId: ref.id, questions};
  } catch (e) {
    throw toHttpsError(e);
  }
});

export const evaluateInterview = onCall(AI_OPTIONS, async (request) => {
  try {
    const uid = requireUid(request);
    await rateLimit(uid, "evaluateInterview", 10, 10 * 60 * 1000);

    const interviewId = requireText(request.data?.interviewId, "interviewId", 64);
    const answersIn: unknown = request.data?.answers;
    if (!Array.isArray(answersIn)) throw new AppError("invalid-parameters", "answers must be an array");

    const ref = db().collection("users").doc(uid).collection("interviews").doc(interviewId);
    const snap = await ref.get();
    if (!snap.exists) throw new AppError("invalid-parameters", "Interview not found");
    const interview = snap.data() || {};
    if (interview.status === "completed") {
      // Aynı mülakatı iki kez değerlendirip iki kredi harcatma.
      return {success: true, evaluation: interview.evaluation, state: await credits.getState(uid)};
    }

    const byId = new Map<string, string>();
    for (const a of answersIn as Array<{ id?: unknown; answer?: unknown }>) {
      if (typeof a?.id === "string") byId.set(a.id, optionalText(a.answer, 3000));
    }
    const qa = (interview.questions || []).map((q: { id: string; question: string }) => ({
      id: q.id,
      question: q.question,
      answer: byId.get(q.id) || "",
    }));
    if (qa.every((x: { answer: string }) => x.answer.length === 0)) {
      throw new AppError("invalid-parameters", "No answers");
    }

    await credits.assertCanSpend(uid, CREDIT_COST.evaluateInterview);
    const language: Language = normalizeLanguage(request.data?.language || interview.language);
    const evaluation = await evaluateAnswers(interview.role, interview.seniority, qa, language);
    const state = await credits.spend(uid, CREDIT_COST.evaluateInterview);

    await ref.set(
      {
        status: "completed",
        completedAt: serverTime(),
        answers: qa.map((x: { id: string; answer: string }) => ({id: x.id, answer: x.answer})),
        overallScore: evaluation.overallScore,
        evaluation,
      },
      {merge: true}
    );
    return {success: true, evaluation, state};
  } catch (e) {
    throw toHttpsError(e);
  }
});

// ---------------------------------------------------------------------------
// Hesap silme (Play veri silme şartı + App Store 5.1.1(v))
// ---------------------------------------------------------------------------

export const deleteMyData = onCall({enforceAppCheck, timeoutSeconds: 120}, async (request) => {
  try {
    const uid = requireUid(request);
    const userRef = db().collection("users").doc(uid);
    await db().recursiveDelete(userRef);
    await db().collection("rateLimits").where(admin.firestore.FieldPath.documentId(), ">=", `${uid}_`)
      .where(admin.firestore.FieldPath.documentId(), "<", `${uid}_`).get()
      .then((s) => Promise.all(s.docs.map((d) => d.ref.delete())));
    try {
      await admin.storage().bucket().deleteFiles({prefix: `users/${uid}/`});
    } catch (err) {
      logger.warn("Storage silme atlandı", err);
    }
    await admin.auth().deleteUser(uid).catch((err) => logger.warn("Auth kullanıcı silinemedi", err));
    logger.info(`Kullanıcı verisi silindi: ${uid}`);
    return {success: true};
  } catch (e) {
    throw toHttpsError(e);
  }
});

// ---------------------------------------------------------------------------
// RevenueCat
// ---------------------------------------------------------------------------

/** FAIL-CLOSED: sır boşsa hiçbir isteği kabul etme; sabit zamanlı karşılaştırma. */
function webhookAuthValid(header: string | undefined): boolean {
  const expected = REVENUECAT_WEBHOOK_AUTH.value().trim();
  // Yer tutucu değer (servis henüz kurulmadı) hiçbir isteği geçirmez.
  if (!expected || expected.startsWith("PLACEHOLDER")) return false;
  const a = Buffer.from((header ?? "").trim());
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const revenuecatWebhook = onRequest({secrets: [REVENUECAT_WEBHOOK_AUTH]}, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }
    if (!webhookAuthValid(req.headers.authorization)) {
      logger.warn("RevenueCat webhook yetkisiz");
      res.status(401).send("Unauthorized");
      return;
    }
    const result = await processRevenueCatWebhook(req.body);
    res.status(result.status).send(result.message);
  } catch (e) {
    logger.error("RevenueCat webhook hatası", e);
    res.status(500).send("Internal Server Error");
  }
});

// ---------------------------------------------------------------------------
// Bildirimler
// ---------------------------------------------------------------------------

async function isAdmin(uid: string): Promise<boolean> {
  const snap = await db().collection("userRoles").doc(uid).get();
  return snap.exists && snap.data()?.isAdmin === true;
}

/** Admin yayını: { title, body, audience: "all" | "premium" | "free" } */
export const sendNotification = onCall({secrets: [ONESIGNAL_API_KEY]}, async (request) => {
  try {
    const uid = requireUid(request);
    if (!(await isAdmin(uid))) throw new AppError("permission-denied", "Admin only");
    const title = requireText(request.data?.title, "title", 80);
    const body = requireText(request.data?.body, "body", 240);
    let query: FirebaseFirestore.Query = db().collection("users");
    if (request.data?.audience === "premium") query = query.where("isPremium", "==", true);
    if (request.data?.audience === "free") query = query.where("isPremium", "==", false);
    const snap = await query.select().get();
    const sent = await sendPushChunked(snap.docs.map((d) => d.id), title, body, {type: "broadcast"});
    return {success: true, sent, total: snap.size};
  } catch (e) {
    throw toHttpsError(e);
  }
});

/**
 * Her gün 20:00 (İstanbul):
 *  - dün aktif olup bugün henüz olmayan (serisi tehlikede) kullanıcıya seri bildirimi
 *  - son 2-7 gün içinde aktif olup sonra kaybolana geri dönüş bildirimi
 * notificationsEnabled=false olanlar atlanır. Aynı dildekiler tek istekte gider.
 */
export const scheduledEngagementReminders = onSchedule(
  {
    schedule: "0 20 * * *",
    timeZone: "Europe/Istanbul",
    timeoutSeconds: 540,
    memory: "512MiB",
    secrets: [ONESIGNAL_API_KEY],
  },
  async () => {
    const today = new Date();
    const day = (offset: number) => dayKey(new Date(today.getTime() - offset * 86400000));
    const yesterday = day(1);

    const streakSnap = await db().collection("users")
      .where("streakLastDay", "==", yesterday)
      .select("language", "streakCurrent", "notificationsEnabled").get();

    // Aynı dil + aynı seri sayısı → aynı metin → tek istek.
    const groups = new Map<string, { lang: Language; n: number; uids: string[] }>();
    for (const doc of streakSnap.docs) {
      const d = doc.data();
      if (d.notificationsEnabled === false) continue;
      const n = Number(d.streakCurrent || 0);
      if (n < 1) continue;
      const lang = normalizeLanguage(d.language);
      const key = `${lang}_${n}`;
      const g = groups.get(key) || {lang, n, uids: []};
      g.uids.push(doc.id);
      groups.set(key, g);
    }
    let sent = 0;
    for (const g of groups.values()) {
      const t = NOTIFICATION_TEXTS[g.lang];
      sent += await sendPushChunked(g.uids, t.streakTitle, t.streakBody.replace("{n}", String(g.n)), {
        type: "streak",
      });
    }

    const comebackSnap = await db().collection("users")
      .where("streakLastDay", ">=", day(7))
      .where("streakLastDay", "<=", day(2))
      .select("language", "notificationsEnabled").get();
    const byLang = new Map<Language, string[]>();
    for (const doc of comebackSnap.docs) {
      const d = doc.data();
      if (d.notificationsEnabled === false) continue;
      const lang = normalizeLanguage(d.language);
      byLang.set(lang, [...(byLang.get(lang) || []), doc.id]);
    }
    for (const [lang, uids] of byLang) {
      const t = NOTIFICATION_TEXTS[lang];
      sent += await sendPushChunked(uids, t.comebackTitle, t.comebackBody, {type: "comeback"});
    }
    logger.info(`Etkileşim bildirimleri: ${sent} alıcı`);
  }
);
