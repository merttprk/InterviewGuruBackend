#!/usr/bin/env python3
"""Ders/konu görselleri: her ders için marka renginde gradyan + SF Symbol + soluk konu numarası.

Kullanım (macOS):
  python3 generate.py            # symbols/ yoksa render_symbol.swift ile üretir, images/ altına 54 webp yazar
Çıktı: scripts/seed-content/images/<lessonId>.webp ve <topicId>.webp — seed.js bunları Storage'a yükler.
Yeni ders eklenirse ICONS eşlemesine SF Symbol adı eklenir (iOS lessonSystemIcon ile aynı).
"""
import json, pathlib, random, subprocess, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent / "content" / "lessons" / "en"
OUT = HERE.parent / "seed-content" / "images"
SYM = HERE / "symbols"
W, H = 1280, 720
ICONS = {
    "interview": "person.wave.2.fill", "preparation": "checklist", "questions": "questionmark.bubble.fill",
    "communication": "bubble.left.and.bubble.right.fill", "technical": "chevron.left.forwardslash.chevron.right",
    "simulation": "video.fill", "calm": "figure.mind.and.body", "followup": "envelope.open.fill",
}

def ensure_symbols():
    SYM.mkdir(exist_ok=True)
    for key, name in ICONS.items():
        p = SYM / f"{key}.png"
        if not p.exists():
            subprocess.run(["swift", str(HERE / "render_symbol.swift"), name, str(p), "512"], check=True)

def hex2rgb(h): h = h.lstrip("#"); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
def mix(c, t, a): return tuple(int(c[i] + (t[i] - c[i]) * a) for i in range(3))

def gradient(c0, c1):
    img = Image.new("RGB", (W, H)); px = img.load()
    for y in range(H):
        for x in range(0, W, 2):
            col = mix(c0, c1, x / W * 0.6 + y / H * 0.4)
            px[x, y] = col
            if x + 1 < W: px[x + 1, y] = col
    return img

def circles(img, seed):
    rnd = random.Random(seed)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    for (cx, cy, r, a) in [
        (W - 120 + rnd.randint(-60, 40), -60 + rnd.randint(-30, 60), 300 + rnd.randint(-30, 60), 26),
        (W - 40 + rnd.randint(-80, 20), 260 + rnd.randint(-60, 80), 200 + rnd.randint(-20, 50), 20),
        (60 + rnd.randint(-40, 80), H + 20 + rnd.randint(-40, 40), 150 + rnd.randint(-30, 40), 14),
    ]:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, a))
    return Image.alpha_composite(img.convert("RGBA"), layer)

def font(size):
    for fp in ["/System/Library/Fonts/SFNSRounded.ttf", "/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Helvetica.ttc"]:
        try: return ImageFont.truetype(fp, size)
        except OSError: pass
    return ImageFont.load_default()

def compose(color_hex, icon_key, seed, number=None):
    c = hex2rgb(color_hex)
    img = circles(gradient(mix(c, (255, 255, 255), 0.22), mix(c, (0, 0, 0), 0.12)), seed)
    sym = Image.open(SYM / f"{icon_key}.png").convert("RGBA").resize((300, 300), Image.LANCZOS)
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sh = Image.new("RGBA", (300, 300), (0, 0, 0, 0)); sh.paste((0, 0, 0, 70), (0, 0, 300, 300), sym)
    shadow.paste(sh, (150, (H - 300) // 2 + 14), sh)
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(18)))
    img.paste(sym, (150, (H - 300) // 2), sym)
    if number is not None:
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(layer); f = font(260)
        txt = f"{number:02d}"; b = d.textbbox((0, 0), txt, font=f)
        d.text((W - (b[2] - b[0]) - 90 - b[0], H - (b[3] - b[1]) - 60 - b[1]), txt, font=f, fill=(255, 255, 255, 38))
        img = Image.alpha_composite(img, layer)
    return img.convert("RGB")

def main():
    ensure_symbols(); OUT.mkdir(parents=True, exist_ok=True); n = 0
    for f in sorted(ROOT.glob("*.json")):
        d = json.load(open(f)); lesson = d.get("lesson", d)
        icon = lesson["icon"]
        if icon not in ICONS: sys.exit(f"ICONS eşlemesinde yok: {icon}")
        compose(lesson["color"], icon, lesson["id"]).save(OUT / f"{lesson['id']}.webp", "WEBP", quality=84, method=6); n += 1
        for i, t in enumerate(d.get("topics", []), 1):
            compose(lesson["color"], icon, t["id"], i).save(OUT / f"{t['id']}.webp", "WEBP", quality=84, method=6); n += 1
    print(f"{n} görsel → {OUT}")

if __name__ == "__main__":
    main()
