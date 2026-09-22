import { HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

/**
 * İstemcinin ayırt edebileceği hata kodları. İstemci `details.code` alanını
 * okur ve kendi dilinde mesaj gösterir; buradaki mesaj yalnız log içindir.
 */
export type AppErrorCode =
  | "unauthenticated"
  | "invalid-parameters"
  | "insufficient-credits"
  | "daily-limit"
  | "rate-limit-exceeded"
  | "permission-denied"
  | "ai-failed";

export class AppError extends Error {
  constructor(public code: AppErrorCode, message: string) {
    super(message);
    this.name = "AppError";
  }
}

const HTTPS_CODES: Record<AppErrorCode, ConstructorParameters<typeof HttpsError>[0]> = {
  "unauthenticated": "unauthenticated",
  "invalid-parameters": "invalid-argument",
  "insufficient-credits": "resource-exhausted",
  "daily-limit": "resource-exhausted",
  "rate-limit-exceeded": "resource-exhausted",
  "permission-denied": "permission-denied",
  "ai-failed": "unavailable",
};

/** Her hatayı istemcinin anlayacağı HttpsError'a çevirir; iç ayrıntı sızdırmaz. */
export function toHttpsError(error: unknown): HttpsError {
  if (error instanceof HttpsError) return error;
  if (error instanceof AppError) {
    return new HttpsError(HTTPS_CODES[error.code], error.message, { code: error.code });
  }
  logger.error("Beklenmeyen hata", error);
  return new HttpsError("internal", "Unexpected error", { code: "internal" });
}

/** Kimliği doğrulanmış uid'yi döndürür, yoksa hata fırlatır. */
export function requireUid(request: CallableRequest): string {
  const uid = request.auth?.uid;
  if (!uid) throw new AppError("unauthenticated", "Sign-in required");
  return uid;
}

/**
 * Firestore tabanlı hız sınırı. PatternFusion'daki bellek içi sayaç her soğuk
 * başlangıçta sıfırlanıyor ve örnekler arasında paylaşılmıyordu; bu sürüm
 * `rateLimits/{uid_fn}` dokümanında sabit pencere tutar.
 */
export async function rateLimit(
  uid: string,
  fn: string,
  maxRequests: number,
  windowMs: number
): Promise<void> {
  const db = admin.firestore();
  const ref = db.collection("rateLimits").doc(`${uid}_${fn}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const data = snap.exists ? snap.data() || {} : {};
    const start = Number(data.windowStart || 0);
    let count = Number(data.count || 0);
    if (now - start > windowMs) {
      tx.set(ref, { windowStart: now, count: 1 });
      return;
    }
    if (count >= maxRequests) {
      throw new AppError("rate-limit-exceeded", `Too many ${fn} requests`);
    }
    count += 1;
    tx.set(ref, { windowStart: start, count }, { merge: true });
  });
}

/** Metin parametresini doğrular ve kırpar. */
export function requireText(value: unknown, name: string, maxLength: number, minLength = 1): string {
  if (typeof value !== "string") {
    throw new AppError("invalid-parameters", `${name} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    throw new AppError("invalid-parameters", `${name} is too short`);
  }
  return trimmed.slice(0, maxLength);
}

export function optionalText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
