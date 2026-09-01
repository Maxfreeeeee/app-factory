#!/usr/bin/env node
// shots.mjs — captures and validates App Store screenshots from the simulator.
//
// Screenshots are the only listing asset a script cannot write for you, and the
// only one that is both required and easy to get subtly wrong. Three things go
// wrong repeatedly:
//
// 1. Wrong pixel size. App Store Connect accepts one iPhone set in 2026 — the
//    6.9" display — and rejects anything that is not exactly 1320x2868 or
//    1290x2796. A screenshot taken on the wrong simulator looks identical in
//    Finder and fails at upload.
// 2. Alpha. `xcrun simctl io screenshot` writes RGBA. Measured on this machine:
//    hasAlpha: yes, every time. ASC rejects alpha in screenshots for the same
//    reason it rejects it in the icon, and just as late.
// 3. Order. The first two screenshots are the only ones shown in search
//    results, so they are the ad, not the start of a feature tour.
//
// Usage:  node shots.mjs [app-dir] --locale de-DE [--device "iPhone 17 Pro Max"] [--name home]
//         node shots.mjs [app-dir] --check     validate store/screenshots/
//         node shots.mjs --strict              (warnings also fail)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const argv = process.argv.slice(2);
const STRICT = argv.includes("--strict");
const CHECK = argv.includes("--check");
const VALUED = new Set(["--locale", "--device", "--name"]);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};
const LOCALE = flag("--locale");
const DEVICE = flag("--device") ?? "iPhone 17 Pro Max";
const NAME_ARG = flag("--name");
const positional = argv.filter((a, i) => !a.startsWith("--") && !VALUED.has(argv[i - 1]));
const APP_DIR = resolve(positional[0] ?? process.cwd());

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { r: "\x1b[31m", y: "\x1b[33m", g: "\x1b[32m", d: "\x1b[2m", b: "\x1b[1m", n: "\x1b[0m" }
  : { r: "", y: "", g: "", d: "", b: "", n: "" };

const issues = [];
const E = (m) => issues.push(["E", m]);
const W = (m) => issues.push(["W", m]);
const I = (m) => issues.push(["I", m]);

// App Store Connect, 2026: the 6.9" iPhone set is the required one. Supplying it
// alone is valid — ASC scales it down for the smaller classes. These are the only
// two accepted portrait geometries for that set.
const ACCEPTED = [
  { w: 1320, h: 2868, device: 'iPhone 17 Pro Max / 16 Pro Max (6.9")' },
  { w: 1290, h: 2796, device: 'iPhone 15 Pro Max / 14 Pro Max (6.7", accepted for the 6.9" set)' },
];
const MAX_SHOTS = 10;      // ASC hard limit per locale
const CONVERTING = [3, 5]; // what actually earns the install

const SRGB = "/System/Library/ColorSync/Profiles/sRGB Profile.icc";
const SHOTS_DIR = join(APP_DIR, "store", "screenshots");

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function probe(file) {
  let out;
  try {
    out = sh("sips", ["-g", "pixelWidth", "-g", "pixelHeight", "-g", "hasAlpha", "-g", "format", file]);
  } catch {
    return null;
  }
  const p = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^\s+([a-zA-Z]+):\s*(.*)$/);
    if (m) p[m[1]] = m[2].trim();
  }
  return p.pixelWidth ? p : null;
}

// The only route that removes an alpha channel with the tools on this machine.
// `sips -s format png`, `--matchTo`, `--deleteColorManagementProperties`, and
// round trips through bmp/tiff all keep it; JPEG cannot carry one, so a trip
// through JPEG is the flatten. `formatOptions best` keeps the loss invisible.
function stripAlpha(file) {
  const tmp = join(tmpdir(), `shots-${process.pid}-${Date.now()}.jpg`);
  try {
    sh("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "best", file, "--out", tmp]);
    sh("sips", ["-s", "format", "png", "--matchTo", SRGB, tmp, "--out", file]);
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

const sizeLabel = (p) => `${p.pixelWidth}x${p.pixelHeight}`;
const isAccepted = (p) =>
  ACCEPTED.some((a) => a.w === Number(p.pixelWidth) && a.h === Number(p.pixelHeight));
const isLandscape = (p) =>
  ACCEPTED.some((a) => a.h === Number(p.pixelWidth) && a.w === Number(p.pixelHeight));

function specLocales() {
  const spec = join(APP_DIR, "docs", "spec.json");
  if (!existsSync(spec)) return null;
  try {
    const j = JSON.parse(readFileSync(spec, "utf8"));
    const l = j?.app?.locales;
    return Array.isArray(l) && l.length ? l : null;
  } catch {
    return null;
  }
}

const ORDER_RULE =
  `the first two screenshots are the only ones shown in search results — they carry ` +
  `the value proposition, not the start of a feature tour. Shots 3-5 may explain features.`;

function report(extra = "") {
  const errors = issues.filter((i) => i[0] === "E").length;
  const warns = issues.filter((i) => i[0] === "W").length;
  if (issues.length) console.log();
  for (const [sev, msg] of issues) {
    const tag = sev === "E" ? `${C.r}error${C.n}` : sev === "W" ? `${C.y}warn ${C.n}` : `${C.d}info ${C.n}`;
    console.log(`    ${tag} ${msg}`);
  }
  console.log(`\n    ${C.d}order${C.n} ${ORDER_RULE}`);
  console.log(
    `\n${errors ? C.r + C.b : C.g + C.b}  ${errors} error${errors === 1 ? "" : "s"}${C.n}  ${C.y}${warns} warning${warns === 1 ? "" : "s"}${C.n}  ${C.d}${extra}${C.n}\n`
  );
  process.exit(errors > 0 || (STRICT && warns > 0) ? 1 : 0);
}

// ============================================================ check ==========
if (CHECK) {
  if (!existsSync(SHOTS_DIR)) {
    console.error(`${C.r}✗${C.n} no store/screenshots/ in ${APP_DIR}`);
    console.error(`  ${C.d}capture one:  node shots.mjs --locale de-DE --name home${C.n}`);
    process.exit(2);
  }

  const dirs = readdirSync(SHOTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  if (!dirs.length) {
    console.error(`${C.r}✗${C.n} store/screenshots/ has no locale directories`);
    process.exit(2);
  }

  console.log(`\n${C.b}screenshots${C.n} ${C.d}${SHOTS_DIR}${C.n}`);

  let total = 0;
  for (const locale of dirs) {
    // Anything raised while inspecting this locale decides its row marker, so a
    // count or size violation cannot show a green tick.
    const before = issues.length;
    const dir = join(SHOTS_DIR, locale);
    const files = readdirSync(dir).filter((f) => /\.png$/i.test(f)).sort();
    total += files.length;

    const sizes = new Set();
    let alpha = 0, bad = 0;
    for (const f of files) {
      const p = probe(join(dir, f));
      if (!p) {
        E(`${locale}/${f} is not a readable image`);
        bad++;
        continue;
      }
      sizes.add(sizeLabel(p));
      if (p.hasAlpha === "yes") {
        alpha++;
        E(`${locale}/${f} has an alpha channel — ASC rejects it at upload`);
      }
      if (!isAccepted(p)) {
        bad++;
        if (isLandscape(p))
          E(`${locale}/${f} is ${sizeLabel(p)} — that is landscape; the 6.9" set is portrait ${ACCEPTED[0].w}x${ACCEPTED[0].h}`);
        else
          E(`${locale}/${f} is ${sizeLabel(p)} — not an accepted 6.9" size (${ACCEPTED.map((a) => `${a.w}x${a.h}`).join(" or ")})`);
      }
    }

    if (!files.length) E(`${locale} has no screenshots — ASC needs at least 1 per published locale`);
    else if (files.length > MAX_SHOTS) E(`${locale} has ${files.length} screenshots — ASC accepts at most ${MAX_SHOTS}`);
    else if (files.length < CONVERTING[0])
      W(`${locale} has ${files.length} — ${CONVERTING[0]}-${CONVERTING[1]} is what actually converts`);
    else if (files.length > CONVERTING[1])
      I(`${locale} has ${files.length} — past ${CONVERTING[1]} they are rarely scrolled to`);

    if (sizes.size > 1)
      W(`${locale} mixes sizes (${[...sizes].join(", ")}) — one set, one geometry`);

    const raised = issues.slice(before);
    const ok = raised.some(([sev]) => sev === "E")
      ? `${C.r}✗${C.n}`
      : raised.some(([sev]) => sev === "W")
        ? `${C.y}▲${C.n}`
        : `${C.g}✓${C.n}`;
    console.log(
      `  ${ok} ${C.b}${locale.padEnd(8)}${C.n} ${C.d}${String(files.length).padStart(2)} shot${files.length === 1 ? " " : "s"}  ` +
      `${[...sizes].join(",") || "—"}  ${!files.length ? "—" : alpha ? C.r + alpha + " with alpha" + C.n + C.d : "no alpha"}${C.n}`
    );
  }

  const want = specLocales();
  if (want) {
    for (const l of want) if (!dirs.includes(l)) E(`docs/spec.json declares locale "${l}" with no screenshots`);
    for (const d of dirs) if (!want.includes(d)) W(`store/screenshots/${d}/ is not in docs/spec.json app.locales`);
  } else {
    I(`no docs/spec.json — locale directories not cross-checked`);
  }

  report(`${dirs.length} locale${dirs.length === 1 ? "" : "s"} · ${total} screenshot${total === 1 ? "" : "s"}`);
}

// ============================================================ capture ========
if (!LOCALE) {
  console.error(`${C.r}✗${C.n} --locale is required to capture`);
  console.error(`  ${C.d}node shots.mjs --locale de-DE --name home${C.n}`);
  console.error(`  ${C.d}node shots.mjs --check${C.n}`);
  process.exit(2);
}

// A booted simulator is the whole precondition. Say how to get one.
let booted = "";
try {
  booted = sh("xcrun", ["simctl", "list", "devices", "booted"]);
} catch {
  console.error(`${C.r}✗${C.n} xcrun simctl is not available — install the Xcode command line tools`);
  process.exit(2);
}
const bootedNames = [...booted.matchAll(/^\s{4}(.+?)\s+\([0-9A-F-]{36}\)\s+\(Booted\)/gm)].map((m) => m[1]);

if (!bootedNames.length) {
  console.error(`\n${C.r}✗${C.n} ${C.b}no simulator is booted${C.n}\n`);
  console.error(`  ${C.d}xcrun simctl boot "${DEVICE}"${C.n}`);
  console.error(`  ${C.d}open -a Simulator${C.n}`);
  console.error(`  ${C.d}npm start${C.n}  then press ${C.b}i${C.n} to load the app into it\n`);
  console.error(`  Then take the shot once the screen shows what you want to sell.\n`);
  process.exit(1);
}
if (!bootedNames.includes(DEVICE))
  W(`booted simulator is "${bootedNames[0]}", not "${DEVICE}" — verify the size below is a 6.9" one`);

// --- destination, auto-numbered in capture order -----------------------------
const dir = join(SHOTS_DIR, LOCALE);
mkdirSync(dir, { recursive: true });

const existing = readdirSync(dir).filter((f) => /\.png$/i.test(f));
const highest = existing.reduce((max, f) => {
  const m = f.match(/^(\d+)-/);
  return m ? Math.max(max, Number(m[1])) : max;
}, 0);
const nn = String(highest + 1).padStart(2, "0");

// `--name 01-home` and `--name home` should both work — strip a leading number
// so the auto-numbering stays the single source of order.
const slug = (NAME_ARG ?? "shot").replace(/^\d+[-_]/, "").replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase();
const out = join(dir, `${nn}-${slug}.png`);

if (existing.length >= MAX_SHOTS)
  W(`${LOCALE} already has ${existing.length} screenshots — ASC accepts at most ${MAX_SHOTS}`);

try {
  sh("xcrun", ["simctl", "io", "booted", "screenshot", "--type=png", out]);
} catch (e) {
  console.error(`${C.r}✗${C.n} capture failed — ${String(e.stderr ?? e.message).trim().split("\n").pop()}`);
  process.exit(1);
}

const raw = probe(out);
if (!raw) {
  console.error(`${C.r}✗${C.n} the capture is not a readable image`);
  process.exit(1);
}
const hadAlpha = raw.hasAlpha === "yes";

if (hadAlpha) stripAlpha(out);

const final = probe(out);
if (!final) {
  console.error(`${C.r}✗${C.n} the flattened capture is no longer readable — ${out}`);
  process.exit(1);
}
if (final.hasAlpha === "yes")
  E(`alpha channel survived the flatten — do not upload ${out}`);

if (!isAccepted(final)) {
  if (isLandscape(final))
    E(`captured ${sizeLabel(final)} — the simulator is in landscape; rotate it to portrait (⌘←/⌘→)`);
  else
    E(`captured ${sizeLabel(final)} — not an accepted 6.9" size. Boot ${C.b}iPhone 17 Pro Max${C.n} ` +
      `and capture again: ${C.d}xcrun simctl boot "iPhone 17 Pro Max"${C.n}`);
} else {
  const match = ACCEPTED.find((a) => a.w === Number(final.pixelWidth));
  I(`${sizeLabel(final)} — ${match.device}`);
}

if (Number(final.pixelWidth) !== Number(raw.pixelWidth) || Number(final.pixelHeight) !== Number(raw.pixelHeight))
  E(`flatten changed the geometry: ${sizeLabel(raw)} → ${sizeLabel(final)}`);

const n = existing.length + 1;
if (n <= 2)
  I(`this is screenshot ${n} of ${LOCALE} — it appears in search results, so it has to sell, not explain`);

console.log(`\n${C.g}✓${C.n} ${C.b}${LOCALE}/${nn}-${slug}.png${C.n}  ${C.d}${sizeLabel(final)}  ` +
  `alpha ${hadAlpha ? "stripped" : "none"}  ·  ${n} shot${n === 1 ? "" : "s"} in ${LOCALE}${C.n}`);

report(`${bootedNames[0]}`);
