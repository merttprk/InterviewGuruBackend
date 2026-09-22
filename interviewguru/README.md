# InterviewGuru Backend (Firebase)

Proje: `interviewguru-745f5` · Functions v2 · Node 22 · TypeScript

## Uçlar

| Uç | Tür | Kredi | Açıklama |
|---|---|---|---|
| `getAiState` | onCall | – | Kredi/premium durumu; yeni cihaza 3 hoş geldin kredisi |
| `claimAdReward` | onCall | +1 | Ödüllü reklam sonrası (günde en çok 5) |
| `reviewCv` | onCall | 1 | CV metni → puan, bölüm geri bildirimi, eksik anahtar kelimeler, yeniden yazılmış özet |
| `improveCvText` | onCall | 1 | CV oluşturucuda özet/deneyim/yetenek/ön yazı iyileştirme |
| `generateInterviewQuestions` | onCall | 0 | Rol/seviye/türe göre soru seti (ücretsizde günde 6) |
| `evaluateInterview` | onCall | 1 | Yanıtların toplu değerlendirmesi, örnek yanıtlar |
| `deleteMyData` | onCall | – | Kullanıcının tüm verisini ve hesabını siler |
| `revenuecatWebhook` | onRequest | – | Premium aç/kapat, kredi paketleri |
| `sendNotification` | onCall (admin) | – | OneSignal yayını |
| `scheduledEngagementReminders` | onSchedule 20:00 | – | Seri ve geri dönüş bildirimleri |

Premium kullanıcı kredi harcamaz; günlük 40 yapay zekâ işlemi kotası vardır.

## Kurulum
```
cd functions && npm install && cp .env.example .env
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set REVENUECAT_WEBHOOK_AUTH
firebase functions:secrets:set ONESIGNAL_API_KEY
npx tsc --noEmit -p .
```

## Deploy
```
firebase deploy --only functions,firestore:rules,firestore:indexes,storage
firebase deploy --only remoteconfig
```

## İçerik
```
cd scripts/seed-content && npm install
SERVICE_ACCOUNT=./serviceAccountKey.json node seed.js           # tüm diller
node seed.js --dry                                               # doğrulama
```
Görseller: `scripts/seed-content/images/<topicId>.webp` → Storage `lesson_images/`.
