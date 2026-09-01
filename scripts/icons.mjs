#!/usr/bin/env node
// icons.mjs — validates the app icon Max supplies, derives everything else.
//
// Max draws one file: assets/icon.png at 1024x1024. Every other raster the app
// needs is a deterministic resize of it, so it should never be drawn twice or
// exported by hand at 3am before a submission.
//
// The check that earns this script's existence is hasAlpha. App Store Connect
// does not reject an icon with an alpha channel in Xcode, or in `eas build`, or
// anywhere else you would find out cheaply — it rejects it at *upload*, after
// the build has already burned ~20 minutes on EAS. The icon looks perfect the
// whole way. Every design tool exports RGBA by default, so this is the normal
// case, not the unlucky one. Catching it here costs 200ms.
//
// The other rules are Apple's icon requirements, which have not moved in years:
// 1024x1024, square, PNG, no alpha, RGB. No rounded corners of its own — iOS
// applies the superellipse mask itself, and a pre-rounded icon gets the mask
// applied twice and comes out visibly wrong.
//
// Usage:  node icons.mjs [app-dir]           (default: $PWD)
//         node icons.mjs --source <path>     import a file into assets/ first
//         node icons.mjs --strict            (warnings also fail)

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

const argv = process.argv.slice(2);
const STRICT = argv.includes("--strict");
const flag = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};
const SOURCE = flag("--source");
const positional = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--source");
const APP_DIR = resolve(positional[0] ?? process.cwd());

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { r: "\x1b[31m", y: "\x1b[33m", g: "\x1b[32m", d: "\x1b[2m", b: "\x1b[1m", n: "\x1b[0m" }
  : { r: "", y: "", g: "", d: "", b: "", n: "" };

const issues = [];
const E = (m) => issues.push(["E", m]);
const W = (m) => issues.push(["W", m]);
const I = (m) => issues.push(["I", m]);

const SRGB = "/System/Library/ColorSync/Profiles/sRGB Profile.icc";

// The one incantation on this machine that actually removes an alpha channel.
// Verified empirically on macOS 26.3 / sips-316 — everything else keeps it:
//   sips -s format png                      → hasAlpha: yes
//   sips --deleteColorManagementProperties  → hasAlpha: yes  (touches the ICC profile only)
//   sips -s format png --matchTo <sRGB>     → hasAlpha: yes
//   sips -s format bmp / tiff, then back    → hasAlpha: yes  (both write alpha-capable variants)
//   qlmanage -t                             → hasAlpha: yes
// Only a round trip through JPEG drops the channel, because JPEG cannot carry
// one. `formatOptions best` keeps it near-lossless (a measured (220,40,40) came
// back (220,40,41)); transparent pixels composite onto WHITE.
const fixCommand = (file) =>
  `sips -s format jpeg -s formatOptions best ${file} --out /tmp/icon-flat.jpg && \\\n` +
  `      sips -s format png --matchTo '${SRGB}' /tmp/icon-flat.jpg --out ${file}`;

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// sips -g prints "  key: value" lines under the file path.
function probe(file) {
  let out;
  try {
    out = sh("sips", ["-g", "pixelWidth", "-g", "pixelHeight", "-g", "hasAlpha",
                      "-g", "space", "-g", "format", "-g", "profile", file]);
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

// --- locate the icon ---------------------------------------------------------
const ASSETS = join(APP_DIR, "assets");
const ICON = join(ASSETS, "icon.png");

if (!existsSync(APP_DIR)) {
  console.error(`${C.r}✗${C.n} no such directory: ${APP_DIR}`);
  process.exit(2);
}

if (SOURCE) {
  const src = isAbsolute(SOURCE) ? SOURCE : resolve(process.cwd(), SOURCE);
  if (!existsSync(src)) {
    console.error(`${C.r}✗${C.n} --source ${src} does not exist`);
    process.exit(2);
  }
  mkdirSync(ASSETS, { recursive: true });
  copyFileSync(src, ICON);
  I(`imported ${basename(src)} → assets/icon.png`);
}

if (!existsSync(ICON)) {
  console.error(`\n${C.r}✗${C.n} ${C.b}no icon at assets/icon.png${C.n}  ${C.d}${APP_DIR}${C.n}\n`);
  console.error(`  Draw one file. Apple's requirements for it:\n`);
  console.error(`    ${C.b}1024 x 1024${C.n}     exactly, and square`);
  console.error(`    ${C.b}PNG${C.n}             not JPEG, not PDF, not an .icon bundle`);
  console.error(`    ${C.b}no alpha${C.n}        App Store Connect rejects an icon with an alpha`);
  console.error(`                    channel at upload, after the build has run`);
  console.error(`    ${C.b}sRGB${C.n}            RGB colour space, not Gray, not CMYK`);
  console.error(`    ${C.b}square corners${C.n}  no rounding of your own — iOS applies the`);
  console.error(`                    superellipse mask itself, and rounding it twice`);
  console.error(`                    leaves a visible pale fringe at the corners`);
  console.error(`    ${C.b}full bleed${C.n}      art to all four edges, no padding, no shadow\n`);
  console.error(`  Then:  ${C.d}node icons.mjs --source ~/Downloads/whatever.png${C.n}\n`);
  process.exit(1);
}

// --- validate ----------------------------------------------------------------
const p = probe(ICON);
if (!p) {
  console.error(`${C.r}✗${C.n} sips cannot read assets/icon.png — is it actually an image?`);
  process.exit(1);
}

const w = Number(p.pixelWidth), h = Number(p.pixelHeight);
let dimsOK = true;

if (p.format !== "png") E(`format is ${p.format}, must be png`);

if (w !== h) {
  E(`icon is ${w}x${h} — must be square`);
  dimsOK = false;
} else if (w !== 1024) {
  E(`icon is ${w}x${h} — must be exactly 1024x1024`);
  dimsOK = false;
}

if (p.hasAlpha === "yes") {
  E(`icon has an alpha channel — App Store Connect rejects this at upload, ` +
    `after the build. Strip it:\n` +
    `      ${C.d}${fixCommand("assets/icon.png")}${C.n}\n` +
    `      ${C.d}(transparent pixels composite onto white — if the icon relies on\n` +
    `       transparency, paint a deliberate opaque background first)${C.n}`);
}

if (p.space && p.space !== "RGB") {
  W(`colour space is ${p.space}, not RGB — convert it:\n` +
    `      ${C.d}sips -s format png --matchTo '${SRGB}' assets/icon.png --out assets/icon.png${C.n}`);
} else if (p.profile && !/sRGB/i.test(p.profile)) {
  I(`profile is "${p.profile}" — Display P3 is accepted, but sRGB is what renders ` +
    `predictably everywhere: ${C.d}sips -s format png --matchTo '${SRGB}' assets/icon.png --out assets/icon.png${C.n}`);
}

// --- derive ------------------------------------------------------------------
// Android masks the adaptive icon and the web favicon sits on a page, so both
// tolerate alpha. The splash image is *supposed* to have one — it is composited
// over the splash backgroundColor from app.config.js, and flattening it would
// paint a white box over that colour.
const DERIVED = [
  { name: "adaptive-icon.png", size: 1024, note: "Android, masked by the launcher" },
  { name: "splash-icon.png",   size: 512,  note: "alpha is fine here — it sits on the splash backgroundColor" },
  { name: "favicon.png",       size: 48,   note: "web" },
];

const results = [];
if (dimsOK) {
  const iconMtime = statSync(ICON).mtimeMs;
  for (const d of DERIVED) {
    const out = join(ASSETS, d.name);
    const cur = existsSync(out) ? probe(out) : null;
    const correct =
      cur &&
      Number(cur.pixelWidth) === d.size &&
      Number(cur.pixelHeight) === d.size &&
      cur.format === "png" &&
      statSync(out).mtimeMs >= iconMtime;

    if (correct) {
      results.push([d.name, d.size, "unchanged", d.note]);
      continue;
    }
    try {
      sh("sips", ["-z", String(d.size), String(d.size), ICON, "--out", out]);
      results.push([d.name, d.size, cur ? "regenerated" : "generated", d.note]);
    } catch (e) {
      E(`could not generate ${d.name} — ${String(e.message).split("\n")[0]}`);
    }
  }
} else {
  I(`derived assets not generated — fix the source icon's dimensions first`);
}

// --- cross-check app.config.js ----------------------------------------------
// Parsed as text on purpose: app.config.js is executable and may read env vars
// or import from node_modules that are not installed yet.
const CONFIG = join(APP_DIR, "app.config.js");
if (!existsSync(CONFIG)) {
  W(`no app.config.js in ${APP_DIR} — cannot verify the icon is actually referenced`);
} else {
  const cfg = readFileSync(CONFIG, "utf8");

  const iconRef = cfg.match(/(?<!adaptive[-_]?)\bicon:\s*["'`]([^"'`]+)["'`]/);
  if (!iconRef) W(`app.config.js declares no icon: — the app would build with Expo's default`);
  else if (iconRef[1] !== "./assets/icon.png")
    W(`app.config.js icon is "${iconRef[1]}", not "./assets/icon.png"`);

  // expo-splash-screen's image, if the plugin declares one at all.
  const splash = cfg.match(/["']expo-splash-screen["']\s*,\s*\{([\s\S]*?)\}/);
  if (splash) {
    const img = splash[1].match(/image:\s*["'`]([^"'`]+)["'`]/);
    if (!img)
      I(`expo-splash-screen declares no image: — it renders the backgroundColor only. ` +
        `Add ${C.d}image: "./assets/splash-icon.png"${C.n} to use the icon that was just generated.`);
  }

  // Every ./assets/* path the config names must exist, or the build fails late.
  const referenced = [...cfg.matchAll(/["'`](\.\/assets\/[^"'`]+)["'`]/g)].map((m) => m[1]);
  for (const ref of [...new Set(referenced)]) {
    if (!existsSync(join(APP_DIR, ref)))
      W(`app.config.js references ${ref}, which does not exist`);
  }
}

// --- report ------------------------------------------------------------------
const errors = issues.filter((i) => i[0] === "E").length;
const warns = issues.filter((i) => i[0] === "W").length;

const status = errors ? `${C.r}✗${C.n}` : warns ? `${C.y}▲${C.n}` : `${C.g}✓${C.n}`;
console.log(`\n${status} ${C.b}icon.png${C.n}  ${C.d}${w}x${h}  ${p.format}  ${p.space ?? "?"}  alpha ${p.hasAlpha}${C.n}`);

for (const [name, size, state, note] of results) {
  const tag = state === "unchanged" ? `${C.d}unchanged  ${C.n}` : `${C.g}${state.padEnd(11)}${C.n}`;
  console.log(`    ${tag} ${name.padEnd(18)} ${C.d}${size}px · ${note}${C.n}`);
}

if (issues.length) console.log();
for (const [sev, msg] of issues) {
  const tag = sev === "E" ? `${C.r}error${C.n}` : sev === "W" ? `${C.y}warn ${C.n}` : `${C.d}info ${C.n}`;
  console.log(`    ${tag} ${msg}`);
}

console.log(
  `\n${errors ? C.r + C.b : C.g + C.b}  ${errors} error${errors === 1 ? "" : "s"}${C.n}  ${C.y}${warns} warning${warns === 1 ? "" : "s"}${C.n}  ${C.d}${results.length} derived asset${results.length === 1 ? "" : "s"}${C.n}\n`
);
process.exit(errors > 0 || (STRICT && warns > 0) ? 1 : 0);
