// Saf iş kuralı testleri (Firebase gerektirmez): `npm test`
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { normalizeLanguage, dayKey, AD_REWARD_DAILY_LIMIT, PREMIUM_DAILY_AI_LIMIT } from "../config";
import { buildState } from "../services/credits";
import { isSubscriptionProduct, packageCreditsFor } from "../services/subscription";

test("dil normalizasyonu: desteklenmeyen → en, bölge eki atılır", () => {
  assert.equal(normalizeLanguage("tr"), "tr");
  assert.equal(normalizeLanguage("pt-BR"), "pt");
  assert.equal(normalizeLanguage("ID"), "id");
  assert.equal(normalizeLanguage("ja"), "en");
  assert.equal(normalizeLanguage(undefined), "en");
});

test("günlük sayaç yalnız bugünün kaydını sayar", () => {
  const today = dayKey(new Date("2026-09-22T10:00:00Z"));
  const s = buildState({ aiCredits: 2, aiUsage: { day: today, count: 5 }, adRewards: { day: "2026-09-21", count: 5 } }, today);
  assert.equal(s.credits, 2);
  assert.equal(s.premiumUsedToday, 5);
  assert.equal(s.adRewardsLeftToday, AD_REWARD_DAILY_LIMIT, "dünkü reklam sayacı bugüne taşınmamalı");
  assert.equal(s.premiumDailyLimit, PREMIUM_DAILY_AI_LIMIT);
});

test("negatif kredi sıfıra kırpılır, premium bayrağı yalnız true ise", () => {
  const s = buildState({ aiCredits: -3, isPremium: "yes" });
  assert.equal(s.credits, 0);
  assert.equal(s.isPremium, false);
});

test("İstanbul gün anahtarı: UTC 22:30 ertesi güne düşer", () => {
  assert.equal(dayKey(new Date("2026-09-22T22:30:00Z")), "2026-09-23");
});

test("abonelik ürünleri ve Google base plan eki", () => {
  assert.equal(isSubscriptionProduct("ig_monthly"), true);
  assert.equal(isSubscriptionProduct("ig_yearly:annual-autorenew"), true);
  assert.equal(isSubscriptionProduct("ig_credits_10"), false);
});

test("paket kredileri: tanımlı ürün, bilinmeyen üründe sayıdan çıkarım", () => {
  assert.equal(packageCreditsFor("ig_credits_10"), 10);
  assert.equal(packageCreditsFor("ig_credits_30"), 30);
  assert.equal(packageCreditsFor("ig_pack_15"), 15);
});
