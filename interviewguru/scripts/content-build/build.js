// Çeviri haritalarından content/{salaries,countries,tips}/<lang>.json üretir.
// Yapı (id, sıra, sayılar, para birimi, bayrak) base.js'ten gelir; metin i18n/<lang>.json'dan.
const fs = require("fs");
const path = require("path");
const { REGIONS, SALARIES, COUNTRIES, TIPS } = require("./base");

const OUT = "/Users/muhammedmert/InterviewGuruBackend/interviewguru/content";
const LANGS = (process.argv[2] || "en,tr,de,es,fr,pt,hi,id,ms").split(",");
const en = JSON.parse(fs.readFileSync(path.join(__dirname, "i18n/en.json"), "utf8"));

function need(v, where) {
  if (typeof v !== "string" || !v.trim()) throw new Error(`eksik/boş metin: ${where}`);
  return v.trim();
}

for (const lang of LANGS) {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, `i18n/${lang}.json`), "utf8"));
  const salaries = SALARIES.map(([id, cat, ranges]) => ({
    id,
    title: need(m.salaries?.[id]?.title, `${lang} salaries.${id}.title`),
    category: need(m.salaryCategories?.[cat], `${lang} salaryCategories.${cat}`),
    description: need(m.salaries?.[id]?.description, `${lang} salaries.${id}.description`),
    ranges: REGIONS.map(([r, currency]) => ({
      region: need(m.regions?.[r], `${lang} regions.${r}`),
      currency,
      junior: ranges[r][0],
      mid: ranges[r][1],
      senior: ranges[r][2],
    })),
  }));
  const countries = COUNTRIES.map(([id, flag]) => {
    const c = m.countries?.[id] || {};
    const f = (k) => need(c[k], `${lang} countries.${id}.${k}`);
    if (!Array.isArray(c.tips) || c.tips.length !== en.countries[id].tips.length)
      throw new Error(`${lang} countries.${id}.tips uzunluğu İngilizceyle aynı değil`);
    return {
      id, name: f("name"), flag, summary: f("summary"), jobMarket: f("jobMarket"), visa: f("visa"),
      salaryNote: f("salaryNote"), languages: f("languages"),
      tips: c.tips.map((t, i) => need(t, `${lang} countries.${id}.tips[${i}]`)),
    };
  });
  const tips = TIPS.map(([id, cat]) => ({
    id,
    category: need(m.tipCategories?.[cat], `${lang} tipCategories.${cat}`),
    title: need(m.tips?.[id]?.title, `${lang} tips.${id}.title`),
    body: need(m.tips?.[id]?.body, `${lang} tips.${id}.body`),
  }));
  for (const [kind, data] of [["salaries", salaries], ["countries", countries], ["tips", tips]]) {
    fs.mkdirSync(path.join(OUT, kind), { recursive: true });
    fs.writeFileSync(path.join(OUT, kind, `${lang}.json`), JSON.stringify(data, null, 2) + "\n");
  }
  console.log(`${lang}: ${salaries.length} maaş, ${countries.length} ülke, ${tips.length} ipucu`);
}
