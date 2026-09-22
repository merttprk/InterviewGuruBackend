import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {AppError} from "../middleware/errors";
import {
  AD_REWARD_CREDITS,
  AD_REWARD_DAILY_LIMIT,
  FREE_DAILY_QUESTION_SETS,
  PREMIUM_DAILY_AI_LIMIT,
  WELCOME_CREDITS,
  dayKey,
} from "../config";

/**
 * Yapay zekâ kredileri. Bütün alanlar SUNUCUYA ait; firestore.rules istemcinin
 * bunlara yazmasını engeller.
 *
 *   users/{uid}.aiCredits          harcanabilir kredi (hoş geldin + reklam + paket)
 *   users/{uid}.isPremium          RevenueCat webhook'u yazar
 *   users/{uid}.aiUsage            {day, count}      premium günlük kota sayacı
 *   users/{uid}.adRewards          {day, count}      günlük ödüllü reklam sayacı
 *   users/{uid}.questionSets       {day, count}      ücretsiz soru üretim sayacı
 *   device_credits/{deviceId}      silip-yükle istismarına karşı hoş geldin bayrağı
 */
export interface CreditState {
  isPremium: boolean;
  credits: number;
  premiumDailyLimit: number;
  premiumUsedToday: number;
  adRewardsLeftToday: number;
}

const db = () => admin.firestore();
const users = () => db().collection("users");

function counterToday(value: unknown, today: string): number {
  const v = value as { day?: string; count?: number } | undefined;
  return v && v.day === today ? Number(v.count || 0) : 0;
}

export function buildState(data: FirebaseFirestore.DocumentData, today = dayKey()): CreditState {
  return {
    isPremium: data.isPremium === true,
    credits: Math.max(0, Number(data.aiCredits || 0)),
    premiumDailyLimit: PREMIUM_DAILY_AI_LIMIT,
    premiumUsedToday: counterToday(data.aiUsage, today),
    adRewardsLeftToday: Math.max(0, AD_REWARD_DAILY_LIMIT - counterToday(data.adRewards, today)),
  };
}

export async function getState(uid: string): Promise<CreditState> {
  const snap = await users().doc(uid).get();
  return buildState(snap.exists ? snap.data() || {} : {});
}

/**
 * Yeni kullanıcıya bir defalık hoş geldin kredisi. İki katmanlı bayrak:
 * uid (aynı hesap tekrar istemesin) ve cihaz kimliği (silip-yükle ile yeni
 * anonim uid alan kullanıcı tekrar almasın). PatternFusion'daki desenin aynısı.
 */
export async function grantWelcomeIfNeeded(uid: string, deviceId?: string): Promise<void> {
  const device = typeof deviceId === "string" ? deviceId.trim().slice(0, 128) : "";
  const userRef = users().doc(uid);

  if (device) {
    const deviceRef = db().collection("device_credits").doc(device);
    const deviceSnap = await deviceRef.get();
    if (deviceSnap.exists && deviceSnap.data()?.welcomeGranted === true) {
      await userRef.set({welcomeGranted: true}, {merge: true});
      await deviceRef.set(
        {lastUid: uid, lastSeenAt: admin.firestore.FieldValue.serverTimestamp()},
        {merge: true}
      );
      return;
    }
  }

  let granted = false;
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists ? snap.data() || {} : {};
    if (data.welcomeGranted === true) return;
    tx.set(
      userRef,
      {
        aiCredits: Number(data.aiCredits || 0) + WELCOME_CREDITS,
        welcomeGranted: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      {merge: true}
    );
    granted = true;
  });

  if (granted && device) {
    await db().collection("device_credits").doc(device).set(
      {
        welcomeGranted: true,
        firstGrantedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastUid: uid,
        lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      {merge: true}
    );
  }
  if (granted) logger.info(`Hoş geldin kredisi: uid=${uid} device=${device || "?"}`);
}

/** Ön kontrol: işlem yapılabilir mi? (OpenAI çağrısından ÖNCE, para harcamamak için) */
export async function assertCanSpend(uid: string, cost: number): Promise<void> {
  if (cost <= 0) return;
  const state = await getState(uid);
  if (state.isPremium) {
    if (state.premiumUsedToday + cost > state.premiumDailyLimit) {
      throw new AppError("daily-limit", "Premium daily AI limit reached");
    }
    return;
  }
  if (state.credits < cost) {
    throw new AppError("insufficient-credits", "Not enough AI credits");
  }
}

/**
 * Başarılı işlemden SONRA krediyi düşer (atomik). Premium kullanıcıda kredi
 * değil günlük sayaç artar. Kalan durumu döndürür.
 */
export async function spend(uid: string, cost: number): Promise<CreditState> {
  const ref = users().doc(uid);
  const today = dayKey();
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    if (cost <= 0) return buildState(data, today);

    if (data.isPremium === true) {
      const used = counterToday(data.aiUsage, today) + cost;
      const aiUsage = {day: today, count: used};
      tx.set(ref, {aiUsage, updatedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
      return buildState({...data, aiUsage}, today);
    }

    const credits = Number(data.aiCredits || 0);
    if (credits < cost) {
      throw new AppError("insufficient-credits", "Not enough AI credits");
    }
    const aiCredits = credits - cost;
    tx.set(ref, {aiCredits, updatedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
    return buildState({...data, aiCredits}, today);
  });
}

/**
 * Ödüllü reklam sonrası kredi. Sunucu reklamın gerçekten izlendiğini
 * doğrulayamıyor (AdMob SSV kurulana kadar); bu yüzden günlük üst sınır
 * zorunlu — kötü niyetli istemci en fazla günde AD_REWARD_DAILY_LIMIT kredi alır.
 */
export async function rewardAd(uid: string): Promise<CreditState> {
  const ref = users().doc(uid);
  const today = dayKey();
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    const count = counterToday(data.adRewards, today);
    if (count >= AD_REWARD_DAILY_LIMIT) {
      throw new AppError("daily-limit", "Daily ad reward limit reached");
    }
    const adRewards = {day: today, count: count + 1};
    const aiCredits = Number(data.aiCredits || 0) + AD_REWARD_CREDITS;
    tx.set(
      ref,
      {adRewards, aiCredits, updatedAt: admin.firestore.FieldValue.serverTimestamp()},
      {merge: true}
    );
    return buildState({...data, adRewards, aiCredits}, today);
  });
}

/** Ücretsiz soru üretimi için günlük sayaç (premium'a sınır yok, kotaya da sayılmaz). */
export async function countQuestionSet(uid: string): Promise<void> {
  const ref = users().doc(uid);
  const today = dayKey();
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    if (data.isPremium === true) return;
    const count = counterToday(data.questionSets, today);
    if (count >= FREE_DAILY_QUESTION_SETS) {
      throw new AppError("daily-limit", "Daily interview limit reached");
    }
    tx.set(ref, {questionSets: {day: today, count: count + 1}}, {merge: true});
  });
}
