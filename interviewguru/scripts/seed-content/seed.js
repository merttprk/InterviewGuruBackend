#!/usr/bin/env node
/**
 * İçerik tohumlama: content/ altındaki JSON'ları Firestore'a yazar.
 *
 *   content/lessons/<lang>/*.json   → lessons/<lang>/items/<lessonId>
 *                                     lessons/<lang>/items/<lessonId>/topics/<topicId>
 *   content/salaries/<lang>.json    → salaries/<lang>/items/<id>
 *   content/countries/<lang>.json   → countries/<lang>/items/<id>
 *   content/tips/<lang>.json        → tips/<lang>/items/<id>
 *
 * Görseller: images/<topicId>.webp (veya <lessonId>.webp) varsa Storage'a
 * lesson_images/ altına yüklenir ve kalıcı indirme URL'si dokümana `imageUrl`
 * olarak yazılır. Görsel yoksa alan boş kalır; istemci renkli ikon çizer.
 *
 * Kullanım (servis hesabı anahtarı GİT'E GİRMEZ, .gitignore'da):
 *   cd scripts/seed-content && npm install
 *   SERVICE_ACCOUNT=./serviceAccountKey.json node seed.js [--lang en,tr] [--dry]
 *   node seed.js --cli-auth            (firebase login oturumuyla, anahtar dosyası olmadan)
 *
 * İdempotent: aynı içerikle tekrar çalıştırmak aynı sonucu verir. İçerikte
 * artık olmayan konu dokümanlarını SİLMEZ (yıkıcı işlem yok); --prune verilirse siler.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const admin = require("firebase-admin");

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const prune = args.includes("--prune");
const langArg = (args.find((a) => a.startsWith("--lang=")) || "").split("=")[1];

const ROOT = path.resolve(__dirname, "../../content");
const IMAGES = path.resolve(__dirname, "images");
const PROJECT = "interviewguru-745f5";

const keyPath = process.env.SERVICE_ACCOUNT || path.resolve(__dirname, "serviceAccountKey.json");
const cliAuth = args.includes("--cli-auth");

/**
 * --cli-auth: servis hesabı anahtarı yerine terminaldeki `firebase login` oturumu
 * kullanılır (~/.config/configstore/firebase-tools.json). Anahtar dosyası
 * indirmeye gerek kalmaz; hiçbir sır diske ya da repoya yazılmaz. İstemci
 * kimliği firebase-tools'un herkese açık OAuth istemcisidir.
 */
function cliCredential() {
  const store = path.join(require("os").homedir(), ".config/configstore/firebase-tools.json");
  const refresh = JSON.parse(fs.readFileSync(store, "utf8")).tokens?.refresh_token;
  if (!refresh) throw new Error("firebase login oturumu bulunamadı — önce `firebase login`");
  // Firestore istemcisi yalnız sertifika ya da ADC kabul ediyor: oturum, çalışma
  // süresince 600 izinli geçici bir ADC dosyası olarak verilir ve çıkışta silinir.
  const tmp = path.join(require("os").tmpdir(), `ig-seed-adc-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({
    type: "authorized_user",
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
    refresh_token: refresh,
  }), { mode: 0o600 });
  const cleanup = () => { try { fs.unlinkSync(tmp); } catch (_) { /* zaten silinmiş */ } };
  process.on("exit", cleanup);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
  process.env.GOOGLE_CLOUD_PROJECT = PROJECT;
  return admin.credential.applicationDefault();
}

if (!dry) {
  let credential;
  if (cliAuth) {
    credential = cliCredential();
  } else {
    const key = JSON.parse(fs.readFileSync(keyPath, "utf8"));
    if (key.project_id !== PROJECT) {
      console.error(`Anahtar ${key.project_id} projesine ait, beklenen ${PROJECT}. Durduruldu.`);
      process.exit(1);
    }
    credential = admin.credential.cert(key);
  }
  admin.initializeApp({
    credential,
    projectId: PROJECT,
    storageBucket: process.env.STORAGE_BUCKET || `${PROJECT}.firebasestorage.app`,
  });
}

const db = dry ? null : admin.firestore();
const imageUrlCache = new Map();

async function imageUrlFor(id) {
  if (imageUrlCache.has(id)) return imageUrlCache.get(id);
  const file = path.join(IMAGES, `${id}.webp`);
  if (!fs.existsSync(file)) {
    imageUrlCache.set(id, null);
    return null;
  }
  if (dry) return `dry://${id}.webp`;
  const bucket = admin.storage().bucket();
  const dest = `lesson_images/${id}.webp`;
  const remote = bucket.file(dest);
  const [exists] = await remote.exists();
  let token;
  if (exists) {
    const [meta] = await remote.getMetadata();
    token = meta.metadata && meta.metadata.firebaseStorageDownloadTokens;
  }
  if (!token) token = crypto.randomUUID();
  await bucket.upload(file, {
    destination: dest,
    metadata: {
      contentType: "image/webp",
      cacheControl: "public, max-age=31536000, immutable",
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(dest)}?alt=media&token=${token}`;
  imageUrlCache.set(id, url);
  return url;
}

function validateLesson(lesson, file) {
  const errs = [];
  if (!lesson.id || !lesson.title || !Array.isArray(lesson.topics)) errs.push("lesson fields");
  for (const t of lesson.topics || []) {
    if (!t.id || !t.title) errs.push(`${t.id}: fields`);
    if (!Array.isArray(t.pages) || t.pages.length < 1) errs.push(`${t.id}: pages`);
    for (const q of t.quiz || []) {
      if (!Array.isArray(q.options) || q.options.length !== 4) errs.push(`${t.id}/${q.id}: options`);
      if (!(q.answer >= 0 && q.answer <= 3)) errs.push(`${t.id}/${q.id}: answer`);
    }
  }
  if (errs.length) throw new Error(`${file}: ${errs.join(", ")}`);
}

async function commitAll(writes) {
  // Firestore batch sınırı 500.
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + 400)) {
      if (w.delete) batch.delete(w.ref);
      else batch.set(w.ref, w.data);
    }
    await batch.commit();
  }
}

async function seedLessons(lang) {
  const dir = path.join(ROOT, "lessons", lang);
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  let count = 0;
  for (const file of files) {
    const lesson = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    validateLesson(lesson, `${lang}/${file}`);
    const writes = [];
    const lessonRef = dry ? null : db.collection("lessons").doc(lang).collection("items").doc(lesson.id);
    const topicIds = lesson.topics.map((t) => t.id);
    const freeTopics = lesson.topics.filter((t) => !t.premium).length;
    const lessonDoc = {
      id: lesson.id,
      order: lesson.order,
      icon: lesson.icon,
      color: lesson.color,
      title: lesson.title,
      summary: lesson.summary,
      topicCount: lesson.topics.length,
      freeTopicCount: freeTopics,
      topicIds,
      totalMinutes: lesson.topics.reduce((s, t) => s + (t.minutes || 3), 0),
      imageUrl: await imageUrlFor(lesson.id),
      updatedAt: dry ? null : admin.firestore.FieldValue.serverTimestamp(),
    };
    writes.push({ ref: lessonRef, data: lessonDoc });
    for (const t of lesson.topics) {
      writes.push({
        ref: dry ? null : lessonRef.collection("topics").doc(t.id),
        data: {
          id: t.id,
          lessonId: lesson.id,
          order: t.order,
          title: t.title,
          minutes: t.minutes || 3,
          premium: t.premium === true,
          imageUrl: await imageUrlFor(t.id),
          pages: t.pages,
          quiz: t.quiz || [],
        },
      });
    }
    if (prune && !dry) {
      const existing = await lessonRef.collection("topics").get();
      for (const d of existing.docs) {
        if (!topicIds.includes(d.id)) writes.push({ ref: d.ref, delete: true });
      }
    }
    if (!dry) await commitAll(writes);
    count += lesson.topics.length;
    console.log(`  ${lang}/${file}: ${lesson.topics.length} konu`);
  }
  return count;
}

async function seedList(kind, lang) {
  const file = path.join(ROOT, kind, `${lang}.json`);
  if (!fs.existsSync(file)) return 0;
  const items = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(items)) throw new Error(`${file}: dizi bekleniyordu`);
  const writes = items.map((item, i) => ({
    ref: dry ? null : db.collection(kind).doc(lang).collection("items").doc(item.id),
    data: { order: i + 1, ...item },
  }));
  if (!dry) await commitAll(writes);
  console.log(`  ${kind}/${lang}.json: ${items.length} kayıt`);
  return items.length;
}

(async () => {
  const langs = langArg
    ? langArg.split(",")
    : fs.readdirSync(path.join(ROOT, "lessons")).filter((d) => !d.startsWith("."));
  console.log(`${dry ? "[KURU ÇALIŞMA] " : ""}Diller: ${langs.join(", ")}`);
  for (const lang of langs) {
    await seedLessons(lang);
    for (const kind of ["salaries", "countries", "tips"]) await seedList(kind, lang);
  }
  console.log("Bitti.");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
