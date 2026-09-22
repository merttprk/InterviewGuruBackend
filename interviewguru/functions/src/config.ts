/**
 * Tek yerde duran iş kuralları. İstemcilerde (Android/iOS) aynı sabitlerin
 * karşılığı var; değiştirirken ikisini de güncelle.
 */

/** İçerik ve yapay zekâ yanıt dilleri. İlki varsayılan. */
export const SUPPORTED_LANGUAGES = ["en", "tr", "de", "es", "fr", "pt", "hi", "id", "ms"] as const;
export type Language = typeof SUPPORTED_LANGUAGES[number];

export function normalizeLanguage(value: unknown): Language {
  const code = typeof value === "string" ? value.trim().toLowerCase().slice(0, 2) : "";
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code) ? (code as Language) : "en";
}

/** Dil kodu → modele verilecek dil adı. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  tr: "Turkish",
  de: "German",
  es: "Spanish",
  fr: "French",
  pt: "Portuguese",
  hi: "Hindi",
  id: "Indonesian",
  ms: "Malay",
};

/**
 * Yapay zekâ işlemlerinin kredi maliyeti.
 * Soru üretimi ücretsiz (ucuz ve kısa) ama günlük sınırlı; asıl maliyet
 * değerlendirmede.
 */
export const CREDIT_COST = {
  reviewCv: 1,
  evaluateInterview: 1,
  improveCvText: 1,
  generateInterviewQuestions: 0,
} as const;

/** Yeni cihaza bir defalık hoş geldin kredisi. */
export const WELCOME_CREDITS = 3;

/** Ödüllü reklam başına verilen kredi ve günlük üst sınır. */
export const AD_REWARD_CREDITS = 1;
export const AD_REWARD_DAILY_LIMIT = 5;

/** Premium kullanıcının günlük yapay zekâ kotası (tüm işlemler toplamı). */
export const PREMIUM_DAILY_AI_LIMIT = 40;

/** Ücretsiz kullanıcının günlük soru üretim sınırı (kredi harcamaz). */
export const FREE_DAILY_QUESTION_SETS = 6;

/** Tek seferlik kredi paketleri (RevenueCat NON_RENEWING_PURCHASE). */
export const PACKAGE_CREDITS: Record<string, number> = {
  ig_credits_10: 10,
  ig_credits_30: 30,
};

/** Abonelik ürünleri — hepsi aynı premium hakkını verir. */
export const SUBSCRIPTION_PRODUCTS = ["ig_weekly", "ig_monthly", "ig_yearly"];

/** Günlük sayaçlar için gün anahtarı (İstanbul saatine göre). */
export function dayKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Varsayılan model. functions/.env içindeki OPENAI_MODEL ile değiştirilebilir. */
export function openAiModel(): string {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

/** CV metni için üst sınır (karakter). Uzun PDF'ler kırpılır. */
export const MAX_CV_CHARS = 24000;
