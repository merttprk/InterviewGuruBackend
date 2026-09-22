# lesson-art — ders/konu görselleri

`generate.py` (macOS, Pillow) her ders için marka renginde gradyan zemin, yarı saydam daireler
(HeroCard dili), SF Symbol simgesi ve soluk konu numarasından oluşan 1280×720 WebP üretir.
Simgeler `render_symbol.swift` ile AppKit'ten beyaz PNG olarak çıkarılır (yalnız macOS).

    cd scripts/lesson-art && python3 generate.py
    cd ../seed-content && NODE_PATH=../../functions/node_modules node seed.js --cli-auth

Çıktılar `scripts/seed-content/images/` altında commit'lidir (54 dosya, ~8 KB/adet); seed.js
`lesson_images/` altına yükler ve dokümanlara `imageUrl` yazar (9 dil aynı görseli paylaşır).
İleride gerçek illüstrasyonlar gelirse aynı dosya adlarıyla üzerine yazmak yeterlidir.
