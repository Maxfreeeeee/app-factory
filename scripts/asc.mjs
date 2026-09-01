#!/usr/bin/env node
// asc.mjs — App Store Connect over the API, so the listing is not retyped by hand.
//
// Everything in `store/<locale>.md` — name, subtitle, keyword field, promo text,
// description — plus the screenshots, goes up over the ASC API. Typing 100
// characters of keywords into a web form for the third locale is how a keyword
// gets spent twice, and aso-lint cannot see a web form.
//
// It deliberately CANNOT submit for review. Uploading metadata to a
// PREPARE_FOR_SUBMISSION version is reversible; submitting is not, and
// guideline 4.3(a) is a judgement call a script has no business making.
// `asc.mjs status` ends by printing exactly what is left for a human.
//
// Facts here were verified against the live API on 2026-09-01, not recalled:
//   · 6.9" iPhone screenshots (1320x2868) upload under 'APP_IPHONE_67'.
//     There is no APP_IPHONE_69 — the API's own error message enumerates the
//     valid types and the largest iPhone case is 67.
//   · a version carries both appStoreState and appVersionState; they agree.
//
// Usage:
//   asc.mjs apps                       list the apps on the account
//   asc.mjs status      [app-dir]      version state, per-locale gaps, what is left for you
//   asc.mjs push        [app-dir]      push every store/<locale>.md  (--dry-run to preview)
//   asc.mjs screenshots [app-dir]      upload store/screenshots/<locale>/*.png (--replace)
//   asc.mjs build       [app-dir]      attach the newest processed TestFlight build
//   asc.mjs get <path>                 raw GET, for when something is off
//
// Credentials resolve in this order: --key-id/--issuer/--key → env
// (ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH) → <app-dir>/eas.json
// submit.production.ios → ~/.appstoreconnect/config.json.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { createSign, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const CMD = argv.find((a) => !a.startsWith("--")) ?? "status";
const POSITIONAL = argv.filter((a) => !a.startsWith("--")).slice(1);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true) : d;
};
const DRY = argv.includes("--dry-run");
const REPLACE = argv.includes("--replace");

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { r: "\x1b[31m", y: "\x1b[33m", g: "\x1b[32m", d: "\x1b[2m", b: "\x1b[1m", n: "\x1b[0m" }
  : { r: "", y: "", g: "", d: "", b: "", n: "" };
const ok = (m) => console.log(`  ${C.g}✓${C.n} ${m}`);
const info = (m) => console.log(`  ${C.d}·${C.n} ${m}`);
const warn = (m) => console.log(`  ${C.y}▲${C.n} ${m}`);
const die = (m) => { console.error(`\n${C.r}✗${C.n} ${m}\n`); process.exit(1); };

const APP_DIR = resolve(
  (CMD === "get" || CMD === "apps" ? null : POSITIONAL[0]) ?? flag("app-dir") ?? process.cwd()
);

// --- credentials --------------------------------------------------------------
function credentials() {
  let keyId = flag("key-id") ?? process.env.ASC_KEY_ID;
  let issuer = flag("issuer") ?? process.env.ASC_ISSUER_ID;
  let keyPath = flag("key") ?? process.env.ASC_KEY_PATH;
  let appId = flag("app") ?? process.env.ASC_APP_ID;

  const easPath = join(APP_DIR, "eas.json");
  if (existsSync(easPath)) {
    try {
      const ios = JSON.parse(readFileSync(easPath, "utf8"))?.submit?.production?.ios ?? {};
      keyId ??= ios.ascApiKeyId;
      issuer ??= ios.ascApiKeyIssuerId;
      appId ??= ios.ascAppId;
      if (!keyPath && ios.ascApiKeyPath) {
        const p = resolve(APP_DIR, ios.ascApiKeyPath);
        if (existsSync(p)) keyPath = p;
      }
    } catch { /* an unreadable eas.json is not this script's problem */ }
  }

  const cfgPath = process.env.ASC_CONFIG ?? join(process.env.HOME, ".appstoreconnect", "config.json");
  if (existsSync(cfgPath)) {
    try {
      const c = JSON.parse(readFileSync(cfgPath, "utf8"));
      keyId ??= c.keyId; issuer ??= c.issuerId;
      // a hand-written config says ~/… ; resolve() would make that a literal "~" dir
      keyPath ??= c.keyPath?.startsWith("~/") ? join(process.env.HOME, c.keyPath.slice(2)) : c.keyPath;
    } catch { /* a broken config is reported by the check below, not by a stack trace */ }
  }

  if (keyId && !keyPath) {
    const home = join(process.env.HOME, ".appstoreconnect", "private_keys", `AuthKey_${keyId}.p8`);
    if (existsSync(home)) keyPath = home;
  }

  if (!keyId || !issuer || !keyPath)
    die(
      `no App Store Connect credentials.\n` +
      `    Expected them in one of:\n` +
      `      ~/.appstoreconnect/config.json   {"keyId", "issuerId", "keyPath"}\n` +
      `      ${join(APP_DIR, "eas.json")} under submit.production.ios\n` +
      `      the environment: ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH\n` +
      `    The key itself is downloaded once from App Store Connect → Users and Access → Integrations.`
    );
  if (!existsSync(keyPath)) die(`private key not found at ${keyPath}`);
  return { keyId, issuer, keyPath, appId };
}

const CRED = CMD === "help" ? {} : credentials();

// --- signed request -----------------------------------------------------------
let cachedJwt = null, cachedExp = 0;
function token() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now < cachedExp - 60) return cachedJwt;
  const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "ES256", kid: CRED.keyId, typ: "JWT" });
  const exp = now + 15 * 60; // Apple caps the lifetime at 20 minutes
  const payload = b64({ iss: CRED.issuer, iat: now, exp, aud: "appstoreconnect-v1" });
  const s = createSign("SHA256");
  s.update(`${head}.${payload}`); s.end();
  const sig = s.sign({ key: readFileSync(CRED.keyPath, "utf8"), dsaEncoding: "ieee-p1363" }).toString("base64url");
  cachedJwt = `${head}.${payload}.${sig}`; cachedExp = exp;
  return cachedJwt;
}

async function api(path, { method = "GET", body, raw } = {}) {
  const url = path.startsWith("http") ? path : `https://api.appstoreconnect.apple.com${path}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const detail = json?.errors?.map((e) => `${e.title}: ${e.detail ?? ""}`).join("\n      ") ?? String(json).slice(0, 400);
    die(`${method} ${path} → ${res.status}\n      ${detail}`);
  }
  return json;
}

// --- listing files (same format aso-lint validates) ---------------------------
function parseListing(text) {
  const [head, ...rest] = text.split(/^---\s*description\s*---\s*$/m);
  const f = {};
  for (const line of head.split("\n")) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (m && !line.startsWith("#")) f[m[1].toLowerCase()] = m[2].trim();
  }
  if (rest.length) f.description = rest.join("").trim();
  return f;
}

function listings() {
  const dir = join(APP_DIR, "store");
  if (!existsSync(dir)) die(`no store/ directory in ${APP_DIR} — run /aso-listing first`);
  const config = existsSync(join(dir, "_config.md"))
    ? parseListing(readFileSync(join(dir, "_config.md"), "utf8")) : {};
  const out = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_")).sort()) {
    out.push({ locale: basename(f, ".md"), file: join(dir, f), ...parseListing(readFileSync(join(dir, f), "utf8")) });
  }
  if (!out.length) die("store/ has no <locale>.md files");
  return { config, out };
}

// The listing gate runs before anything is uploaded. A keyword field that
// aso-lint rejects is not made acceptable by being in Apple's database.
function gateListing() {
  if (argv.includes("--skip-lint")) { warn("aso-lint skipped (--skip-lint)"); return; }
  try {
    execFileSync("node", [join(import.meta.dirname, "aso-lint.mjs"), join(APP_DIR, "store")], { stdio: "inherit" });
  } catch {
    die("aso-lint failed — fix the listing before uploading it. (--skip-lint overrides, and should not.)");
  }
}

// --- app / version resolution -------------------------------------------------
async function resolveApp() {
  if (CRED.appId) {
    const a = await api(`/v1/apps/${CRED.appId}`);
    return a.data;
  }
  const cfg = join(APP_DIR, "app.config.js");
  let bundle = null;
  if (existsSync(cfg)) bundle = readFileSync(cfg, "utf8").match(/bundleIdentifier:\s*["']([^"']+)["']/)?.[1];
  if (!bundle) die("no ascAppId in eas.json and no bundleIdentifier in app.config.js — pass --app <id>");
  const r = await api(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundle)}`);
  if (!r.data?.length)
    die(
      `no app with bundle id ${bundle} on this account.\n` +
      `    The app record itself cannot be created over the API — create it once at\n` +
      `    https://appstoreconnect.apple.com → Apps → +, then put its id in eas.json as ascAppId.`
    );
  return r.data[0];
}

// States where App Store Connect still lets metadata change. Anything else and
// a PATCH is rejected with a message that does not say why.
const EDITABLE = new Set([
  "PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED",
  "METADATA_REJECTED", "INVALID_BINARY", "DEVELOPER_REMOVED_FROM_SALE",
]);

async function resolveVersion(app, { create = true } = {}) {
  const r = await api(`/v1/apps/${app.id}/appStoreVersions?limit=10&filter[platform]=IOS`);
  const versions = r.data ?? [];
  const state = (v) => v.attributes.appVersionState ?? v.attributes.appStoreState;
  const editable = versions.find((v) => EDITABLE.has(state(v)));
  if (editable) return { version: editable, total: versions.length };
  const wanted = flag("version");
  if (!create) return { version: null, total: versions.length };
  if (!wanted)
    die(
      `no editable version. Newest is ${versions[0]?.attributes.versionString} (${state(versions[0] ?? { attributes: {} })}).\n` +
      `    Pass --version 1.0.1 to create the next one.`
    );
  const created = await api("/v1/appStoreVersions", {
    method: "POST",
    body: {
      data: {
        type: "appStoreVersions",
        attributes: { platform: "IOS", versionString: String(wanted) },
        relationships: { app: { data: { type: "apps", id: app.id } } },
      },
    },
  });
  ok(`created version ${wanted}`);
  return { version: created.data, total: versions.length + 1 };
}

// --- commands -----------------------------------------------------------------
async function cmdApps() {
  const r = await api("/v1/apps?limit=50");
  console.log();
  for (const a of r.data) console.log(`  ${C.b}${a.id}${C.n}  ${a.attributes.bundleId}  ${C.d}${a.attributes.name} · ${a.attributes.primaryLocale}${C.n}`);
  console.log();
}

async function cmdStatus() {
  const app = await resolveApp();
  const { version, total } = await resolveVersion(app, { create: false });
  const state = version ? (version.attributes.appVersionState ?? version.attributes.appStoreState) : "—";
  console.log(`\n${C.b}${app.attributes.name}${C.n} ${C.d}${app.attributes.bundleId} · ${app.id}${C.n}`);
  console.log(`  version ${C.b}${version?.attributes.versionString ?? "none"}${C.n}  ${EDITABLE.has(state) ? C.g : C.y}${state}${C.n} ${C.d}(${total} total)${C.n}\n`);
  if (!version) { warn("no version to inspect"); return; }

  const locs = await api(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
  for (const l of locs.data ?? []) {
    const a = l.attributes;
    const sets = await api(`/v1/appStoreVersionLocalizations/${l.id}/appScreenshotSets`);
    let shots = 0;
    for (const s of sets.data ?? []) {
      const ss = await api(`/v1/appScreenshotSets/${s.id}/appScreenshots?limit=10`);
      shots += (ss.data ?? []).length;
    }
    const miss = [];
    if (!a.description) miss.push("description");
    if (!a.keywords) miss.push("keywords");
    if (!a.supportUrl) miss.push("supportUrl");
    if (!shots) miss.push("screenshots");
    const mark = miss.length ? `${C.y}▲${C.n}` : `${C.g}✓${C.n}`;
    console.log(
      `  ${mark} ${C.b}${a.locale}${C.n}  ${C.d}desc ${(a.description ?? "").length}/4000 · kw ${[...(a.keywords ?? "")].length}/100 · ${shots} screenshot${shots === 1 ? "" : "s"}${C.n}` +
      (miss.length ? `  ${C.y}missing: ${miss.join(", ")}${C.n}` : "")
    );
  }

  const build = await api(`/v1/appStoreVersions/${version.id}/build`).catch(() => null);
  console.log(build?.data ? `\n  ${C.g}✓${C.n} build ${build.data.id} attached` : `\n  ${C.y}▲${C.n} no build attached — run \`asc.mjs build\` after EAS finishes`);

  console.log(`\n${C.b}  left for you, in App Store Connect${C.n}`);
  for (const l of [
    "age rating questionnaire",
    "app privacy answers (the tracking question — say no unless an ad SDK ships)",
    "pricing and availability",
    "export compliance",
    "Submit for Review — after reading the 4.3(a) note in docs/PUBLISH-CHECKLIST.md",
  ]) console.log(`    ${C.d}·${C.n} ${l}`);
  console.log();
}

async function cmdPush() {
  gateListing();
  const { config, out } = listings();
  const app = await resolveApp();
  const { version, total } = await resolveVersion(app);
  const state = version.attributes.appVersionState ?? version.attributes.appStoreState;
  if (!EDITABLE.has(state)) die(`version ${version.attributes.versionString} is ${state} — metadata is locked`);

  console.log(`\n${C.b}${app.attributes.name}${C.n} ${C.d}→ version ${version.attributes.versionString} (${state})${C.n}${DRY ? `  ${C.y}dry run${C.n}` : ""}\n`);

  const infos = await api(`/v1/apps/${app.id}/appInfos`);
  // The editable appInfo is the one that is not already live.
  const appInfo = (infos.data ?? []).find((i) => i.attributes.appStoreState !== "READY_FOR_SALE") ?? infos.data?.[0];
  const infoLocs = appInfo ? await api(`/v1/appInfos/${appInfo.id}/appInfoLocalizations`) : { data: [] };
  const verLocs = await api(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);

  for (const l of out) {
    console.log(`  ${C.b}${l.locale}${C.n}`);

    // --- name + subtitle + privacy policy live on the appInfo, not the version
    const nameAttrs = {};
    if (l.title) nameAttrs.name = l.title;
    if (l.subtitle) nameAttrs.subtitle = l.subtitle;
    if (config.privacy) nameAttrs.privacyPolicyUrl = config.privacy;
    if (Object.keys(nameAttrs).length && appInfo) {
      const existing = (infoLocs.data ?? []).find((x) => x.attributes.locale === l.locale);
      if (DRY) info(`name/subtitle → ${existing ? "update" : "create"} ${JSON.stringify(nameAttrs)}`);
      else if (existing) {
        await api(`/v1/appInfoLocalizations/${existing.id}`, {
          method: "PATCH",
          body: { data: { type: "appInfoLocalizations", id: existing.id, attributes: nameAttrs } },
        });
        ok(`name "${l.title}" · subtitle "${l.subtitle ?? ""}"`);
      } else {
        await api("/v1/appInfoLocalizations", {
          method: "POST",
          body: {
            data: {
              type: "appInfoLocalizations",
              attributes: { locale: l.locale, ...nameAttrs },
              relationships: { appInfo: { data: { type: "appInfos", id: appInfo.id } } },
            },
          },
        });
        ok(`created app info localization ${l.locale}`);
      }
    }

    // --- description, keywords, promo, URLs live on the version localization
    const attrs = {};
    if (l.description) attrs.description = l.description;
    if (l.keywords) attrs.keywords = l.keywords;
    if (l.promo) attrs.promotionalText = l.promo;
    const support = l.support ?? config.support;
    const marketing = l.marketing ?? config.marketing;
    if (support) attrs.supportUrl = support;
    if (marketing) attrs.marketingUrl = marketing;
    // whatsNew is rejected on a first version — there is nothing that is new.
    if (l.whatsnew && total > 1) attrs.whatsNew = l.whatsnew;

    if (!attrs.description) warn(`${l.locale}: no description — App Store Connect requires one`);
    if (!support) warn(`${l.locale}: no supportUrl — put "support:" in store/_config.md; ASC requires it to submit`);

    const existing = (verLocs.data ?? []).find((x) => x.attributes.locale === l.locale);
    if (DRY) { info(`version localization → ${existing ? "update" : "create"} ${Object.keys(attrs).join(", ")}`); continue; }
    if (existing) {
      await api(`/v1/appStoreVersionLocalizations/${existing.id}`, {
        method: "PATCH",
        body: { data: { type: "appStoreVersionLocalizations", id: existing.id, attributes: attrs } },
      });
      ok(`keywords (${[...(l.keywords ?? "")].length}/100) · description (${(l.description ?? "").length}/4000)`);
    } else {
      await api("/v1/appStoreVersionLocalizations", {
        method: "POST",
        body: {
          data: {
            type: "appStoreVersionLocalizations",
            attributes: { locale: l.locale, ...attrs },
            relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } },
          },
        },
      });
      ok(`created version localization ${l.locale}`);
    }
  }
  console.log(`\n  ${C.d}next:${C.n} asc.mjs screenshots${DRY ? "   (this was a dry run — nothing changed)" : ""}\n`);
}

// 6.9" iPhone (1320x2868) and 6.7" (1290x2796) both live under APP_IPHONE_67.
// Verified against the API's own enum on 2026-09-01: APP_IPHONE_69 does not exist.
const IPHONE_SET = "APP_IPHONE_67";
const VALID_SIZES = [[1320, 2868], [1290, 2796], [1284, 2778], [1242, 2688]];

function pixelSize(file) {
  try {
    const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { encoding: "utf8" });
    return [+out.match(/pixelWidth:\s*(\d+)/)?.[1], +out.match(/pixelHeight:\s*(\d+)/)?.[1]];
  } catch { return [0, 0]; }
}

async function cmdScreenshots() {
  const app = await resolveApp();
  const { version } = await resolveVersion(app);
  const dir = join(APP_DIR, "store", "screenshots");
  if (!existsSync(dir)) die(`no ${dir} — capture them with:  node ~/Desktop/app-factory/scripts/shots.mjs`);
  const verLocs = await api(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
  console.log(`\n${C.b}${app.attributes.name}${C.n} ${C.d}→ ${version.attributes.versionString}${C.n}\n`);

  for (const locale of readdirSync(dir).filter((d) => statSync(join(dir, d)).isDirectory()).sort()) {
    const files = readdirSync(join(dir, locale)).filter((f) => /\.png$/i.test(f)).sort();
    console.log(`  ${C.b}${locale}${C.n} ${C.d}${files.length} file${files.length === 1 ? "" : "s"}${C.n}`);
    if (!files.length) continue;
    if (files.length > 10) die(`${locale} has ${files.length} screenshots — App Store Connect takes at most 10`);

    const loc = (verLocs.data ?? []).find((x) => x.attributes.locale === locale);
    if (!loc) { warn(`${locale} has no version localization yet — run \`asc.mjs push\` first`); continue; }

    const sets = await api(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`);
    let set = (sets.data ?? []).find((s) => s.attributes.screenshotDisplayType === IPHONE_SET);
    if (!set) {
      if (DRY) { info(`would create ${IPHONE_SET} set`); continue; }
      set = (await api("/v1/appScreenshotSets", {
        method: "POST",
        body: {
          data: {
            type: "appScreenshotSets",
            attributes: { screenshotDisplayType: IPHONE_SET },
            relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: loc.id } } },
          },
        },
      })).data;
      ok(`created ${IPHONE_SET} set`);
    }

    const have = await api(`/v1/appScreenshotSets/${set.id}/appScreenshots?limit=10`);
    if ((have.data ?? []).length) {
      if (!REPLACE) { warn(`${locale} already has ${have.data.length} screenshots — pass --replace to overwrite`); continue; }
      for (const s of have.data) {
        if (DRY) info(`would delete ${s.id}`);
        else { await api(`/v1/appScreenshots/${s.id}`, { method: "DELETE" }); }
      }
      if (!DRY) ok(`removed ${have.data.length} existing`);
    }

    const uploaded = [];
    for (const f of files) {
      const path = join(dir, locale, f);
      const bytes = readFileSync(path);
      const [w, h] = pixelSize(path);
      if (!VALID_SIZES.some(([vw, vh]) => vw === w && vh === h))
        die(`${locale}/${f} is ${w}x${h} — App Store Connect takes ${VALID_SIZES.map((s) => s.join("x")).join(", ")} for this set`);
      if (DRY) { info(`would upload ${f} (${w}x${h}, ${(bytes.length / 1024).toFixed(0)} KB)`); continue; }

      const reserved = (await api("/v1/appScreenshots", {
        method: "POST",
        body: {
          data: {
            type: "appScreenshots",
            attributes: { fileSize: bytes.length, fileName: f },
            relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: set.id } } },
          },
        },
      })).data;

      for (const op of reserved.attributes.uploadOperations ?? []) {
        const chunk = bytes.subarray(op.offset, op.offset + op.length);
        const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
        const r = await fetch(op.url, { method: op.method, headers, body: chunk });
        if (!r.ok) die(`upload of ${f} failed: ${r.status} ${await r.text()}`);
      }

      await api(`/v1/appScreenshots/${reserved.id}`, {
        method: "PATCH",
        body: {
          data: {
            type: "appScreenshots", id: reserved.id,
            attributes: { uploaded: true, sourceFileChecksum: createHash("md5").update(bytes).digest("hex") },
          },
        },
      });
      uploaded.push(reserved.id);
      ok(`${f} ${C.d}${w}x${h}${C.n}`);
    }

    // Filename order is the display order. The first two are what sell the app.
    if (uploaded.length && !DRY) {
      await api(`/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, {
        method: "PATCH",
        body: { data: uploaded.map((id) => ({ type: "appScreenshots", id })) },
      });
      ok(`ordered ${uploaded.length} by filename`);
    }
  }
  console.log();
}

async function cmdBuild() {
  const app = await resolveApp();
  const { version } = await resolveVersion(app);
  const builds = await api(`/v1/builds?filter[app]=${app.id}&limit=5&sort=-uploadedDate`);
  const ready = (builds.data ?? []).find((b) => b.attributes.processingState === "VALID");
  if (!ready) {
    const states = (builds.data ?? []).map((b) => `${b.attributes.version} ${b.attributes.processingState}`).join(", ");
    die(`no processed build. Newest: ${states || "none"}. Apple takes 10–30 minutes after EAS finishes.`);
  }
  if (DRY) { info(`would attach build ${ready.attributes.version} (${ready.id})`); return; }
  await api(`/v1/appStoreVersions/${version.id}/relationships/build`, {
    method: "PATCH",
    body: { data: { type: "builds", id: ready.id } },
  });
  ok(`attached build ${ready.attributes.version} to version ${version.attributes.versionString}`);
}

async function cmdGet() {
  const path = POSITIONAL[0] ?? flag("path");
  if (!path) die("usage: asc.mjs get /v1/apps");
  console.log(JSON.stringify(await api(path), null, 2));
}

const commands = { apps: cmdApps, status: cmdStatus, push: cmdPush, screenshots: cmdScreenshots, build: cmdBuild, get: cmdGet };
const run = commands[CMD];
if (!run) die(`unknown command "${CMD}" — one of: ${Object.keys(commands).join(", ")}`);
await run();
