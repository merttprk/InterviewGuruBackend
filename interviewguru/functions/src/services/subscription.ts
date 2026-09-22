import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { PACKAGE_CREDITS, SUBSCRIPTION_PRODUCTS } from "../config";

/**
 * RevenueCat webhook işleyicisi. PatternFusion'daki sürümden uyarlandı:
 * - tekilleştirme yalnız event.id ile (RENEWAL/CANCELLATION/EXPIRATION aynı
 *   transaction_id'yi paylaşır; transaction bazlı dedup iptali düşürüyordu)
 * - CANCELLATION ödenmiş dönem bitene kadar premium'u korur
 * - abonelik premium hakkı verir; kota günlük olduğu için abonelikte kredi yok
 * - tek seferlik paket `aiCredits`'e eklenir
 */
function normalizeProductId(productId: string): string {
  // Google Play base plan'ı "ig_monthly:monthly" biçiminde ekleyebilir.
  return (productId || "").split(":")[0].trim();
}

export function isSubscriptionProduct(productId: string): boolean {
  const id = normalizeProductId(productId);
  return SUBSCRIPTION_PRODUCTS.includes(id) || /week|month|year|annual/i.test(id);
}

export function packageCreditsFor(productId: string): number {
  const id = normalizeProductId(productId);
  if (PACKAGE_CREDITS[id] !== undefined) return PACKAGE_CREDITS[id];
  logger.warn(`Tanımsız paket ürünü: "${productId}" — PACKAGE_CREDITS'e ekleyin`);
  const n = id.match(/(\d+)/);
  return n ? Number(n[1]) : 5;
}

export async function processRevenueCatWebhook(
  body: any
): Promise<{ status: number; message: string }> {
  const event = body?.event;
  const type = event?.type;
  const uid = event?.app_user_id;
  if (!type) return { status: 400, message: "Missing event type" };
  if (!uid) return { status: 400, message: "Missing app_user_id" };

  if (event.id) {
    const ref = admin.firestore().collection("processedRevenueCatEvents").doc(String(event.id));
    const created = await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return false;
      tx.set(ref, {
        type,
        uid,
        transactionId: event.transaction_id || null,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!created) return { status: 200, message: "Already processed" };
  }

  switch (type) {
  case "INITIAL_PURCHASE":
  case "RENEWAL":
  case "PRODUCT_CHANGE":
  case "UNCANCELLATION":
    if (isSubscriptionProduct(event.product_id)) await activate(uid, event);
    break;
  case "CANCELLATION":
    await cancel(uid, event);
    break;
  case "EXPIRATION":
    await expire(uid);
    break;
  case "NON_RENEWING_PURCHASE":
    await addPackage(uid, event);
    break;
  case "TRANSFER":
    await transfer(uid, event);
    break;
  default:
    logger.info(`İşlenmeyen RevenueCat olayı: ${type}`);
  }
  return { status: 200, message: "OK" };
}

function ts(ms: unknown): admin.firestore.Timestamp | null {
  return typeof ms === "number" ? admin.firestore.Timestamp.fromMillis(ms) : null;
}

async function activate(uid: string, event: any): Promise<void> {
  await admin.firestore().collection("users").doc(uid).set(
    {
      isPremium: true,
      subscriptionStatus: "active",
      subscriptionProductId: normalizeProductId(event.product_id),
      subscriptionStore: event.store || null,
      subscriptionExpirationDate: ts(event.expiration_at_ms),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  logger.info(`Premium açıldı: ${uid} (${event.product_id})`);
}

async function cancel(uid: string, event: any): Promise<void> {
  const exp = typeof event.expiration_at_ms === "number" ? event.expiration_at_ms : 0;
  if (exp <= Date.now()) {
    await expire(uid);
    return;
  }
  await admin.firestore().collection("users").doc(uid).set(
    {
      isPremium: true,
      subscriptionStatus: "cancelled",
      subscriptionExpirationDate: ts(exp),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function expire(uid: string): Promise<void> {
  await admin.firestore().collection("users").doc(uid).set(
    {
      isPremium: false,
      subscriptionStatus: "expired",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  logger.info(`Premium kapandı: ${uid}`);
}

async function addPackage(uid: string, event: any): Promise<void> {
  const amount = packageCreditsFor(event.product_id);
  await admin.firestore().collection("users").doc(uid).set(
    {
      aiCredits: admin.firestore.FieldValue.increment(amount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  logger.info(`Paket: ${uid} +${amount} kredi (${event.product_id})`);
}

async function transfer(fromUid: string, event: any): Promise<void> {
  const targets: string[] = Array.isArray(event.transferred_to) ? event.transferred_to : [];
  const fromRef = admin.firestore().collection("users").doc(fromUid);
  const from = (await fromRef.get()).data() || {};
  for (const target of targets) {
    await admin.firestore().collection("users").doc(target).set(
      {
        isPremium: from.isPremium === true,
        subscriptionStatus: from.subscriptionStatus || null,
        subscriptionProductId: from.subscriptionProductId || null,
        subscriptionExpirationDate: from.subscriptionExpirationDate || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  if (targets.length > 0) {
    await fromRef.set(
      { isPremium: false, subscriptionStatus: "transferred", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
  }
}
