import { jsonCompletion } from "../services/openai";
import { LANGUAGE_NAMES, Language } from "../config";

/**
 * CV değerlendirmesi. Eski istemci düz metin istiyor, "\n\n" ile bölüp Türkçe
 * başlık arıyordu; her dilde kırılıyordu. Artık katı JSON şeması: istemci
 * ayrıştırma yapmaz, alanları doğrudan çizer.
 */
export interface CvReview {
  overallScore: number; // 0-100
  headline: string; // tek cümlelik özet yargı
  atsScore: number; // 0-100, aday takip sistemine uygunluk
  sections: Array<{
    key: "contact" | "summary" | "experience" | "education" | "skills" | "languages" | "certifications" | "formatting";
    score: number; // 0-10
    strengths: string[];
    improvements: string[];
  }>;
  missingKeywords: string[];
  rewrittenSummary: string;
  topActions: string[]; // en önemli 3-5 adım, sıralı
}

const SECTION_KEYS = [
  "contact", "summary", "experience", "education", "skills", "languages", "certifications", "formatting",
];

export const CV_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overallScore", "headline", "atsScore", "sections", "missingKeywords", "rewrittenSummary", "topActions"],
  properties: {
    overallScore: { type: "integer" },
    headline: { type: "string" },
    atsScore: { type: "integer" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "score", "strengths", "improvements"],
        properties: {
          key: { type: "string", enum: SECTION_KEYS },
          score: { type: "integer" },
          strengths: { type: "array", items: { type: "string" } },
          improvements: { type: "array", items: { type: "string" } },
        },
      },
    },
    missingKeywords: { type: "array", items: { type: "string" } },
    rewrittenSummary: { type: "string" },
    topActions: { type: "array", items: { type: "string" } },
  },
};

export async function reviewCv(
  cvText: string,
  language: Language,
  targetRole: string
): Promise<CvReview> {
  const lang = LANGUAGE_NAMES[language];
  const system = [
    "You are a senior recruiter and career coach who reviews CVs/resumes.",
    `Write every human-readable string in ${lang}.`,
    "Be specific and actionable: quote or reference the candidate's own content when giving feedback.",
    "Scores: overallScore and atsScore are 0-100, section scores are 0-10.",
    "Include a section entry only for sections that exist or are clearly missing and important.",
    "strengths and improvements: 1-4 short bullet sentences each.",
    "missingKeywords: 5-12 role-relevant keywords that are absent from the CV.",
    "rewrittenSummary: a 3-4 sentence professional summary the candidate could paste in.",
    "topActions: 3-5 highest impact next steps, most important first.",
    "If the text is not a CV, set overallScore to 0 and explain in headline.",
    "Never invent facts about the candidate.",
  ].join("\n");

  const user = [
    targetRole ? `Target role: ${targetRole}` : "Target role: not specified (infer from the CV).",
    "CV text:",
    "<<<",
    cvText,
    ">>>",
  ].join("\n");

  const result = await jsonCompletion<CvReview>({
    system,
    user,
    schemaName: "cv_review",
    schema: CV_REVIEW_SCHEMA,
    maxTokens: 2500,
    temperature: 0.4,
  });

  const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(Number(n) || 0)));
  result.overallScore = clamp(result.overallScore, 100);
  result.atsScore = clamp(result.atsScore, 100);
  result.sections = (result.sections || []).map((s) => ({ ...s, score: clamp(s.score, 10) }));
  return result;
}

/** CV oluşturucudaki bir alanı (özet, deneyim maddesi) yeniden yazar. */
export interface ImprovedText {
  improved: string;
  alternatives: string[];
  tips: string[];
}

export const IMPROVE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["improved", "alternatives", "tips"],
  properties: {
    improved: { type: "string" },
    alternatives: { type: "array", items: { type: "string" } },
    tips: { type: "array", items: { type: "string" } },
  },
};

export type ImproveKind = "summary" | "experience" | "skills" | "cover_letter";

export async function improveCvText(
  text: string,
  kind: ImproveKind,
  language: Language,
  targetRole: string
): Promise<ImprovedText> {
  const lang = LANGUAGE_NAMES[language];
  const guidance: Record<ImproveKind, string> = {
    summary: "Rewrite as a 3-4 sentence professional summary. Lead with years of experience and core strengths.",
    experience: "Rewrite as 3-5 achievement bullets starting with strong action verbs; quantify results where the text allows. Separate bullets with newlines, each starting with '• '.",
    skills: "Return a clean, comma separated list of skills grouped logically; remove duplicates.",
    cover_letter: "Write a concise cover letter (max 220 words) based on the notes.",
  };
  const system = [
    "You are an expert CV writer.",
    `Write in ${lang}.`,
    guidance[kind],
    "Keep facts from the input; never invent employers, dates, degrees or numbers.",
    "alternatives: 2 shorter variants. tips: 2-3 short tips.",
  ].join("\n");
  const user = `${targetRole ? `Target role: ${targetRole}\n` : ""}Input:\n<<<\n${text}\n>>>`;
  return jsonCompletion<ImprovedText>({
    system,
    user,
    schemaName: "improved_text",
    schema: IMPROVE_SCHEMA,
    maxTokens: 1200,
    temperature: 0.6,
  });
}
