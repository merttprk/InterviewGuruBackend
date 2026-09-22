// Üretilen 27 dosyanın doğrulaması.
const fs = require("fs");
const path = require("path");
const ROOT = "/Users/muhammedmert/InterviewGuruBackend/interviewguru/content";
const LANGS = ["en", "tr", "de", "es", "fr", "pt", "hi", "id", "ms"];
const KINDS = ["salaries", "countries", "tips"];
const errs = [];
const load = (k, l) => JSON.parse(fs.readFileSync(path.join(ROOT, k, `${l}.json`), "utf8"));

function walkEmpty(v, where) {
  if (typeof v === "string") { if (!v.trim()) errs.push(`boş metin: ${where}`); }
  else if (Array.isArray(v)) v.forEach((x, i) => walkEmpty(x, `${where}[${i}]`));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walkEmpty(x, `${where}.${k}`);
}
const FIELDS = {
  salaries: ["id", "title", "category", "description", "ranges"],
  countries: ["id", "name", "flag", "summary", "jobMarket", "visa", "salaryNote", "languages", "tips"],
  tips: ["id", "category", "title", "body"],
};
let files = 0;
for (const kind of KINDS) {
  let en;
  try { en = load(kind, "en"); } catch (e) { errs.push(`${kind}/en: ${e.message}`); continue; }
  const enIds = en.map((x) => x.id).join(",");
  for (const lang of LANGS) {
    let d;
    try { d = load(kind, lang); files++; } catch (e) { errs.push(`${kind}/${lang}: parse ${e.message}`); continue; }
    if (!Array.isArray(d)) { errs.push(`${kind}/${lang}: dizi değil`); continue; }
    if (d.map((x) => x.id).join(",") !== enIds) errs.push(`${kind}/${lang}: id/sıra farkı`);
    if (new Set(d.map((x) => x.id)).size !== d.length) errs.push(`${kind}/${lang}: yinelenen id`);
    walkEmpty(d, `${kind}/${lang}`);
    d.forEach((item, i) => {
      const keys = Object.keys(item).sort().join(",");
      if (keys !== [...FIELDS[kind]].sort().join(",")) errs.push(`${kind}/${lang}/${item.id}: alan kümesi ${keys}`);
      if (kind === "salaries") {
        const a = item.ranges, b = en[i].ranges;
        if (a.length !== b.length) errs.push(`${lang}/${item.id}: bölge sayısı`);
        a.forEach((r, j) => {
          for (const f of ["currency", "junior", "mid", "senior"]) if (r[f] !== b[j][f]) errs.push(`${lang}/${item.id}/${j}: ${f} farkı`);
          if (!/^[A-Z]{3}$/.test(r.currency)) errs.push(`${lang}/${item.id}: para birimi ${r.currency}`);
          if (!(Number.isInteger(r.junior) && r.junior < r.mid && r.mid < r.senior)) errs.push(`${lang}/${item.id}/${r.region}: junior<mid<senior değil`);
          if (Object.keys(r).sort().join(",") !== "currency,junior,mid,region,senior") errs.push(`${lang}/${item.id}: range alanları`);
        });
      }
      if (kind === "countries") {
        if (!item.flag || item.flag !== en[i].flag) errs.push(`${lang}/${item.id}: bayrak`);
        if (!Array.isArray(item.tips) || item.tips.length < 3) errs.push(`${lang}/${item.id}: <3 ipucu`);
      }
      if (lang !== "en" && kind !== "salaries") {
        // Çevrilmemiş (İngilizceyle birebir aynı) uzun metin var mı?
        for (const f of ["summary", "body", "visa"]) if (item[f] && item[f] === en[i][f]) errs.push(`${kind}/${lang}/${item.id}.${f}: çevrilmemiş`);
      }
    });
    console.log(`OK? ${kind}/${lang}.json: ${d.length} kayıt`);
  }
}
console.log(`\n${files} dosya okundu.`);
if (errs.length) { console.log(`${errs.length} HATA:\n` + errs.join("\n")); process.exit(1); }
console.log("DOĞRULAMA GEÇTİ: 27/27 dosya ayrıştı; id+sıra eşleşiyor; maaş sayıları/para birimleri İngilizceyle aynı; boş metin yok; ülkelerde bayrak ve ≥3 ipucu var.");
