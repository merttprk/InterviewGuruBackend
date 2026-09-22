import * as logger from "firebase-functions/logger";
import fetch from "node-fetch";

/**
 * OneSignal push. Hedef `external_user_id` = Firebase uid; istemciler
 * `OneSignal.login(uid)` çağırır. Uygulama kimliği sır değil (functions/.env),
 * REST anahtarı Secret Manager'da (ONESIGNAL_API_KEY).
 */
export async function sendPush(
  uids: string[],
  title: string,
  message: string,
  data: Record<string, string> = {}
): Promise<number> {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_API_KEY;
  if (!appId || !apiKey) {
    logger.warn("OneSignal yapılandırılmamış; bildirim atlandı");
    return 0;
  }
  if (uids.length === 0) return 0;

  const response = await fetch("https://onesignal.com/api/v1/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${apiKey}`,
    },
    body: JSON.stringify({
      app_id: appId,
      include_external_user_ids: uids,
      headings: { en: title },
      contents: { en: message },
      data,
      ios_sound: "default",
      android_sound: "default",
      small_icon: process.env.ONESIGNAL_SMALL_ICON || "ic_stat_onesignal_default",
    }),
  });
  const json = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) {
    logger.error("OneSignal hatası", json);
    return 0;
  }
  return Number(json.recipients || 0);
}

/** Aynı metni alan kullanıcıları 2000'lik parçalar halinde gönderir. */
export async function sendPushChunked(
  uids: string[],
  title: string,
  message: string,
  data: Record<string, string> = {}
): Promise<number> {
  let sent = 0;
  for (let i = 0; i < uids.length; i += 2000) {
    sent += await sendPush(uids.slice(i, i + 2000), title, message, data);
  }
  return sent;
}
