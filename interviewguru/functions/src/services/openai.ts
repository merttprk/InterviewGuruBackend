import fetch from "node-fetch";
import * as logger from "firebase-functions/logger";
import {AppError} from "../middleware/errors";
import {openAiModel} from "../config";

/**
 * OpenAI Chat Completions çağrısı, katı JSON şemasıyla (structured outputs).
 * SDK yok: PatternFusion/LearnInvest'teki gibi düz fetch. Anahtar yalnız
 * Secret Manager'dan gelir (`OPENAI_API_KEY`), istemcide HİÇ bulunmaz.
 */
export interface JsonCompletionOptions {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
}

export async function jsonCompletion<T>(options: JsonCompletionOptions): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.error("OPENAI_API_KEY tanımlı değil");
    throw new AppError("ai-failed", "AI is not configured");
  }

  const body = {
    model: openAiModel(),
    temperature: options.temperature ?? 0.5,
    max_tokens: options.maxTokens ?? 2000,
    response_format: {
      type: "json_schema",
      json_schema: {name: options.schemaName, strict: true, schema: options.schema},
    },
    messages: [
      {role: "system", content: options.system},
      {role: "user", content: options.user},
    ],
  };

  let lastError: unknown = null;
  // Geçici hatalarda (429/5xx) bir kez daha dene.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        lastError = new Error(`OpenAI ${response.status}: ${text.slice(0, 300)}`);
        if (response.status === 429 || response.status >= 500) {
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        break;
      }

      const json = (await response.json()) as any;
      const choice = json?.choices?.[0];
      if (choice?.message?.refusal) {
        throw new AppError("ai-failed", "Model refused the request");
      }
      const content = choice?.message?.content;
      if (typeof content !== "string") {
        throw new AppError("ai-failed", "Empty AI response");
      }
      return JSON.parse(content) as T;
    } catch (error) {
      if (error instanceof AppError) throw error;
      lastError = error;
    }
  }

  logger.error("OpenAI çağrısı başarısız", lastError);
  throw new AppError("ai-failed", "AI request failed");
}
