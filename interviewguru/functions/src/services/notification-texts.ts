import {Language} from "../config";

/**
 * Zamanlanmış bildirim metinleri. PatternFusion bunları Firestore'dan okuyor ve
 * tohumlama için ayrı bir fonksiyon deploy edip silmek gerekiyordu; burada
 * kodda duruyor — değişiklik tek deploy.
 * {n} yer tutucusu seri gün sayısıdır.
 */
interface Texts {
  streakTitle: string;
  streakBody: string; // {n}
  comebackTitle: string;
  comebackBody: string;
}

export const NOTIFICATION_TEXTS: Record<Language, Texts> = {
  en: {
    streakTitle: "Keep your streak alive 🔥",
    streakBody: "You're on a {n}-day streak. One short lesson today keeps it going!",
    comebackTitle: "Your next interview is closer than you think",
    comebackBody: "Take a 3-minute lesson or a quick mock interview to stay sharp.",
  },
  tr: {
    streakTitle: "Serini koru 🔥",
    streakBody: "{n} günlük serin var. Bugün kısa bir ders seriyi devam ettirir!",
    comebackTitle: "Bir sonraki mülakatın sandığından yakın",
    comebackBody: "Formda kalmak için 3 dakikalık bir ders ya da hızlı bir deneme mülakatı yap.",
  },
  de: {
    streakTitle: "Halte deine Serie am Leben 🔥",
    streakBody: "Du hast eine {n}-Tage-Serie. Eine kurze Lektion heute hält sie am Laufen!",
    comebackTitle: "Dein nächstes Vorstellungsgespräch ist näher, als du denkst",
    comebackBody: "Mach eine 3-Minuten-Lektion oder ein kurzes Probeinterview, um fit zu bleiben.",
  },
  es: {
    streakTitle: "Mantén tu racha 🔥",
    streakBody: "Llevas una racha de {n} días. ¡Una lección corta hoy la mantiene!",
    comebackTitle: "Tu próxima entrevista está más cerca de lo que crees",
    comebackBody: "Haz una lección de 3 minutos o una entrevista de práctica rápida.",
  },
  fr: {
    streakTitle: "Garde ta série 🔥",
    streakBody: "Tu as une série de {n} jours. Une courte leçon aujourd'hui la prolonge !",
    comebackTitle: "Ton prochain entretien est plus proche que tu ne le penses",
    comebackBody: "Fais une leçon de 3 minutes ou un entretien d'entraînement rapide.",
  },
  pt: {
    streakTitle: "Mantenha sua sequência 🔥",
    streakBody: "Você está em uma sequência de {n} dias. Uma lição curta hoje a mantém!",
    comebackTitle: "Sua próxima entrevista está mais perto do que você imagina",
    comebackBody: "Faça uma lição de 3 minutos ou uma entrevista simulada rápida.",
  },
  hi: {
    streakTitle: "अपनी स्ट्रीक बनाए रखें 🔥",
    streakBody: "आपकी {n} दिन की स्ट्रीक है। आज एक छोटा पाठ इसे जारी रखेगा!",
    comebackTitle: "आपका अगला इंटरव्यू आपकी सोच से ज़्यादा क़रीब है",
    comebackBody: "तैयार रहने के लिए 3 मिनट का पाठ या एक छोटा मॉक इंटरव्यू करें।",
  },
  id: {
    streakTitle: "Pertahankan runtunanmu 🔥",
    streakBody: "Kamu punya runtunan {n} hari. Satu pelajaran singkat hari ini menjaganya!",
    comebackTitle: "Wawancara berikutnya lebih dekat dari yang kamu kira",
    comebackBody: "Ambil pelajaran 3 menit atau simulasi wawancara singkat agar tetap siap.",
  },
  ms: {
    streakTitle: "Kekalkan rentetan anda 🔥",
    streakBody: "Anda ada rentetan {n} hari. Satu pelajaran ringkas hari ini mengekalkannya!",
    comebackTitle: "Temu duga seterusnya lebih dekat daripada yang anda sangka",
    comebackBody: "Ambil pelajaran 3 minit atau temu duga olok-olok ringkas untuk kekal bersedia.",
  },
};
