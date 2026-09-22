# CLAUDE.md — InterviewGuru Backend

## Değişmez kurallar
- **Türkçe yaz.** Yanıtlar ve kod yorumları Türkçe.
- **Sırlar repoya girmez.** OpenAI / RevenueCat / OneSignal anahtarları yalnız Secret Manager'da
  (`firebase functions:secrets:set`). `functions/.env` yalnız sır OLMAYAN değerler; `.env.local`
  emülatör içindir ve deploy edilmez. `serviceAccountKey.json` gitignore'da.
- **Deploy kullanıcı onayıyla.** `firebase deploy` dışa dönük işlem; sormadan çalıştırma.
- **Yıkıcı işlem yok.** Seed betiği `--prune` olmadan hiçbir şey silmez.
- Şablon: `/Users/muhammedmert/PatternFusionBackend/patternfusion` (aynı iskelet).

## Yapı
- `interviewguru/functions/src/index.ts` — tüm uçlar (onCall v2, onSchedule, onRequest)
- `interviewguru/functions/src/config.ts` — diller, kredi maliyetleri, kotalar (istemcilerde karşılığı var)
- `interviewguru/content/` — ders/maaş/ülke/ipucu içeriği (JSON, dil başına) → `scripts/seed-content/seed.js`
- `interviewguru/firestore.rules` — kredi/premium alanları yalnız sunucuya ait

## Doğrulama
`cd interviewguru/functions && npx tsc --noEmit -p .` ve `node ../scripts/seed-content/seed.js --dry`
