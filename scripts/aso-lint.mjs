#!/usr/bin/env node
// aso-lint.mjs — validates App Store listings per locale, mechanically.
//
// The rules come from the brain (2026-08-31-aso-cluster-waehlt-die-app):
// iOS combines single words freely across title + subtitle + keywords, so you
// never enter phrases, never repeat a word across fields, and never spend a
// character on something Apple ignores. Those rules are easy to state and easy
// to forget on app #4 — so they live here instead of in a prompt.
//
// Usage:  node aso-lint.mjs [store-dir]   (default: ./store)
//         node aso-lint.mjs --strict      (warnings also fail)

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const argv = process.argv.slice(2);
const STRICT = argv.includes("--strict");
const DIR = argv.find((a) => !a.startsWith("--")) ?? "store";

const LIMITS = { title: 30, subtitle: 30, keywords: 100, promo: 170, description: 4000 };
const REQUIRED = ["title", "subtitle", "keywords"];

// Apple ignores these, or they are implied by the listing itself. Spending
// characters on them is a straight loss.
const WASTED = {
  en: ["app", "apps", "free", "best", "top", "new", "the", "and", "for", "with", "your", "my",
       "ios", "iphone", "ipad", "apple", "download", "online", "pro", "plus"],
  de: ["app", "apps", "kostenlos", "gratis", "beste", "besten", "neu", "neue", "der", "die", "das",
       "und", "für", "fuer", "mit", "mein", "meine", "von", "im", "ios", "iphone", "apple"],
};

const UMLAUT = [["ä", "ae"], ["ö", "oe"], ["ü", "ue"], ["ß", "ss"]];

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { r: "\x1b[31m", y: "\x1b[33m", g: "\x1b[32m", d: "\x1b[2m", b: "\x1b[1m", n: "\x1b[0m" }
  : { r: "", y: "", g: "", d: "", b: "", n: "" };

const len = (s) => [...s].length;
const words = (s) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2);
const langOf = (loc) => (loc.toLowerCase().startsWith("de") ? "de" : "en");

function parse(text) {
  const [head, ...rest] = text.split(/^---\s*description\s*---\s*$/m);
  const f = {};
  for (const line of head.split("\n")) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (m && !line.startsWith("#")) f[m[1].toLowerCase()] = m[2].trim();
  }
  if (rest.length) f.description = rest.join("").trim();
  return f;
}

let config = { trademarks: [] };
if (existsSync(join(DIR, "_config.md"))) {
  const c = parse(readFileSync(join(DIR, "_config.md"), "utf8"));
  config.trademarks = (c.trademarks ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

const files = existsSync(DIR)
  ? readdirSync(DIR).filter((f) => f.endsWith(".md") && !f.startsWith("_")).sort()
  : [];
if (!files.length) {
  console.error(`aso-lint: no locale files in ${DIR}/ (expected e.g. de-DE.md, en-US.md)`);
  process.exit(2);
}

let errors = 0, warns = 0;
const keywordFields = new Map();

for (const file of files) {
  const locale = basename(file, ".md");
  const lang = langOf(locale);
  const f = parse(readFileSync(join(DIR, file), "utf8"));
  const issues = [];
  const E = (m) => { issues.push(["E", m]); errors++; };
  const W = (m) => { issues.push(["W", m]); warns++; };
  const I = (m) => issues.push(["I", m]);

  for (const k of REQUIRED) if (!f[k]) E(`missing required field: ${k}`);

  const meters = [];
  for (const [field, limit] of Object.entries(LIMITS)) {
    if (!f[field]) continue;
    const n = len(f[field]);
    meters.push([field, n, limit]);
    if (n > limit) E(`${field} is ${n} chars, limit ${limit} — ${n - limit} over`);
    else if (field === "keywords" && n < limit - 10) I(`keywords leaves ${limit - n} chars unused`);
  }

  const kwRaw = f.keywords ?? "";
  const kws = kwRaw.split(",").map((s) => s.trim()).filter(Boolean);

  if (/,\s/.test(kwRaw)) E(`space after a comma in keywords — every space is a wasted character`);
  if (/^\s|\s$/.test(kwRaw)) W(`leading/trailing whitespace in keywords`);

  for (const kw of kws) {
    if (/\s/.test(kw))
      E(`"${kw}" is a phrase — enter single words, iOS combines them across fields itself`);
    if (config.trademarks.includes(kw.toLowerCase())) I(`"${kw}" is a trademark — fine in keywords, never in title/subtitle`);
  }

  for (const tm of config.trademarks) {
    for (const field of ["title", "subtitle"]) {
      if (f[field] && words(f[field]).includes(tm))
        E(`trademark "${tm}" appears in ${field} — rights holders get apps removed for this`);
    }
  }

  const seen = new Map();
  for (const kw of kws) {
    const k = kw.toLowerCase();
    if (seen.has(k)) W(`"${kw}" appears twice in keywords`);
    seen.set(k, true);
  }

  const kwLower = kws.map((k) => k.toLowerCase());
  for (const a of kwLower) {
    for (const suf of ["s", "e", "en", "n", "er"]) {
      if (kwLower.includes(a + suf))
        W(`"${a}" and "${a + suf}" — Apple stems these, keep one and spend the ${suf.length + 1} chars elsewhere`);
    }
  }

  const titleWords = new Set([...words(f.title ?? ""), ...words(f.subtitle ?? "")]);
  for (const kw of kwLower) {
    if (titleWords.has(kw))
      W(`"${kw}" is already in title/subtitle — it is indexed there, drop it from keywords`);
  }
  if (f.title && f.subtitle) {
    for (const w of words(f.title)) if (words(f.subtitle).includes(w)) W(`"${w}" repeated in title and subtitle`);
  }

  for (const kw of kwLower) if (WASTED[lang].includes(kw)) W(`"${kw}" is ignored or implied — wasted characters`);

  for (const kw of kws) {
    const hasUmlaut = UMLAUT.some(([u]) => kw.toLowerCase().includes(u));
    if (!hasUmlaut) continue;
    let ascii = kw.toLowerCase();
    for (const [u, a] of UMLAUT) ascii = ascii.replaceAll(u, a);
    if (!kwLower.includes(ascii)) I(`"${kw}" — users type "${ascii}" too; both spellings index separately`);
  }

  if (lang === "de") {
    const compounds = kws.filter((k) => len(k) >= 12);
    if (compounds.length)
      I(`German compounds do not decompose (${compounds.slice(0, 3).join(", ")}) — verify each against Astro before spending the chars`);
  }

  if (f.keywords) {
    const prev = keywordFields.get(kwRaw);
    if (prev) W(`identical keyword field to ${prev} — a second locale is a second 100-char field, not a copy`);
    else keywordFields.set(kwRaw, locale);
  }

  const status = issues.some(([s]) => s === "E") ? `${C.r}✗${C.n}` : issues.some(([s]) => s === "W") ? `${C.y}▲${C.n}` : `${C.g}✓${C.n}`;
  console.log(`\n${status} ${C.b}${locale}${C.n}  ${C.d}${meters.map(([k, n, l]) => `${k} ${n}/${l}`).join("  ")}${C.d}  ·  ${kws.length} keywords${C.n}`);
  for (const [sev, msg] of issues) {
    const tag = sev === "E" ? `${C.r}error${C.n}` : sev === "W" ? `${C.y}warn ${C.n}` : `${C.d}info ${C.n}`;
    console.log(`    ${tag} ${msg}`);
  }
}

console.log(
  `\n${errors ? C.r + C.b : C.g + C.b}  ${errors} error${errors === 1 ? "" : "s"}${C.n}  ${C.y}${warns} warning${warns === 1 ? "" : "s"}${C.n}  ${C.d}${files.length} locale${files.length === 1 ? "" : "s"}${C.n}\n`
);
process.exit(errors > 0 || (STRICT && warns > 0) ? 1 : 0);
