import { jsonCompletion } from "../services/openai";
import { LANGUAGE_NAMES, Language } from "../config";

/**
 * Deneme mülakatı: önce rol/seviye/türe göre soru seti üretilir (ücretsiz,
 * günlük sınırlı), kullanıcı yazılı yanıtlar, sonra tüm set tek çağrıda
 * değerlendirilir (1 kredi).
 */
export type InterviewType = "behavioral" | "technical" | "mixed" | "hr";
export type Seniority = "intern" | "junior" | "mid" | "senior" | "lead";

export interface InterviewQuestion {
  id: string;
  question: string;
  category: string; // örn. "Teamwork", "System design"
  tip: string; // yanıtlarken dikkat edilecek tek cümle
}

export const QUESTIONS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "question", "category", "tip"],
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          category: { type: "string" },
          tip: { type: "string" },
        },
      },
    },
  },
};

export async function generateQuestions(
  role: string,
  seniority: Seniority,
  type: InterviewType,
  count: number,
  language: Language,
  jobDescription: string
): Promise<InterviewQuestion[]> {
  const lang = LANGUAGE_NAMES[language];
  const system = [
    "You are an experienced hiring manager preparing a realistic job interview.",
    `Write all text in ${lang}.`,
    `Generate exactly ${count} distinct interview questions.`,
    "Mix difficulty sensibly for the seniority. Avoid yes/no questions.",
    "behavioral = STAR-style past experience; technical = role-specific knowledge/problem solving;",
    "hr = motivation, salary, culture fit; mixed = a balance of all.",
    "id: q1, q2, ... in order. tip: one practical sentence on how to answer well.",
  ].join("\n");
  const user = [
    `Role: ${role}`,
    `Seniority: ${seniority}`,
    `Interview type: ${type}`,
    jobDescription ? `Job description:\n<<<\n${jobDescription}\n>>>` : "",
  ].filter(Boolean).join("\n");

  const result = await jsonCompletion<{ questions: InterviewQuestion[] }>({
    system,
    user,
    schemaName: "interview_questions",
    schema: QUESTIONS_SCHEMA,
    maxTokens: 1500,
    temperature: 0.8,
  });
  return (result.questions || []).slice(0, count).map((q, i) => ({ ...q, id: `q${i + 1}` }));
}

export interface AnswerFeedback {
  id: string;
  score: number; // 0-10
  feedback: string;
  strengths: string[];
  improvements: string[];
  sampleAnswer: string;
}

export interface InterviewEvaluation {
  overallScore: number; // 0-100
  summary: string;
  hireSignal: "strong_yes" | "yes" | "maybe" | "no";
  answers: AnswerFeedback[];
  nextSteps: string[];
}

export const EVALUATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overallScore", "summary", "hireSignal", "answers", "nextSteps"],
  properties: {
    overallScore: { type: "integer" },
    summary: { type: "string" },
    hireSignal: { type: "string", enum: ["strong_yes", "yes", "maybe", "no"] },
    answers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "score", "feedback", "strengths", "improvements", "sampleAnswer"],
        properties: {
          id: { type: "string" },
          score: { type: "integer" },
          feedback: { type: "string" },
          strengths: { type: "array", items: { type: "string" } },
          improvements: { type: "array", items: { type: "string" } },
          sampleAnswer: { type: "string" },
        },
      },
    },
    nextSteps: { type: "array", items: { type: "string" } },
  },
};

export async function evaluateAnswers(
  role: string,
  seniority: Seniority,
  qa: Array<{ id: string; question: string; answer: string }>,
  language: Language
): Promise<InterviewEvaluation> {
  const lang = LANGUAGE_NAMES[language];
  const system = [
    "You are a fair but demanding interviewer giving feedback after a mock interview.",
    `Write all text in ${lang}.`,
    "Score each answer 0-10 for relevance, structure (e.g. STAR), specificity and impact.",
    "An empty or off-topic answer scores 0-2 and the feedback says so kindly.",
    "feedback: 2-3 sentences. strengths/improvements: 1-3 short bullets each.",
    "sampleAnswer: a strong model answer of 4-7 sentences the candidate can learn from; do not invent the candidate's personal facts, use placeholders like [project] where needed.",
    "overallScore 0-100. nextSteps: 3 concrete practice actions.",
    "Return one answers entry per question, same ids, same order.",
  ].join("\n");
  const user = [
    `Role: ${role}`,
    `Seniority: ${seniority}`,
    ...qa.map((x) => `\n[${x.id}] Question: ${x.question}\nAnswer: ${x.answer || "(no answer)"}`),
  ].join("\n");

  const result = await jsonCompletion<InterviewEvaluation>({
    system,
    user,
    schemaName: "interview_evaluation",
    schema: EVALUATION_SCHEMA,
    maxTokens: 4000,
    temperature: 0.4,
  });
  const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(Number(n) || 0)));
  result.overallScore = clamp(result.overallScore, 100);
  result.answers = (result.answers || []).map((a) => ({ ...a, score: clamp(a.score, 10) }));
  return result;
}
