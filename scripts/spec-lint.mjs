#!/usr/bin/env node
// spec-lint.mjs — validates docs/spec.json, the contract every later stage reads.
//
// The pipeline is: description → spec → backend → design → listing → App Store.
// Each stage after the spec is fanned out across subagents, and an agent cannot
// ask a follow-up question. So anything an agent would have to guess has to be
// decided here, before the fan-out — that is what this gate is for.
//
// It also carries the FACTORY.md invariants forward into the *design* of the
// app rather than the review of it: entitlement written server-side, model
// calls rate-limited, account deletion in v1, AI disclosure. Catching those in
// a 2 KB JSON file costs nothing; catching them in preflight costs a rebuild.
//
// Usage:  node spec-lint.mjs [spec-file]     (default: ./docs/spec.json)
//         node spec-lint.mjs --strict        (warnings also fail)
//         node spec-lint.mjs --summary       (print the build plan it implies)

import { readFileSync, existsSync } from "node:fs";

const argv = process.argv.slice(2);
const STRICT = argv.includes("--strict");
const SUMMARY = argv.includes("--summary");
const FILE = argv.find((a) => !a.startsWith("--")) ?? "docs/spec.json";

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { r: "\x1b[31m", y: "\x1b[33m", g: "\x1b[32m", d: "\x1b[2m", b: "\x1b[1m", n: "\x1b[0m" }
  : { r: "", y: "", g: "", d: "", b: "", n: "" };

if (!existsSync(FILE)) {
  console.error(`${C.r}✗${C.n} no spec at ${FILE} — run /app-spec first`);
  process.exit(2);
}

let spec;
try {
  spec = JSON.parse(readFileSync(FILE, "utf8"));
} catch (e) {
  console.error(`${C.r}✗${C.n} ${FILE} is not valid JSON — ${e.message}`);
  process.exit(2);
}

const issues = [];
const E = (id, msg) => issues.push(["E", id, msg]);
const W = (id, msg) => issues.push(["W", id, msg]);
const I = (id, msg) => issues.push(["I", id, msg]);

const arr = (v) => (Array.isArray(v) ? v : []);
const has = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k);
const KEBAB = /^[a-z][a-z0-9-]*$/;
const SNAKE = /^[a-z][a-z0-9_]*$/;

// --- app ---------------------------------------------------------------------
const app = spec.app ?? {};
if (!app.name) E("A1", "app.name missing");
if (!KEBAB.test(app.slug ?? "")) E("A2", `app.slug "${app.slug ?? ""}" must be kebab-case`);
if (!/^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/.test(app.bundle ?? ""))
  E("A3", `app.bundle "${app.bundle ?? ""}" must be reverse-DNS, e.g. com.maxfre.${app.slug ?? "slug"}`);
if (app.name && [...app.name].length > 30)
  W("A4", `app.name is ${[...app.name].length} chars — the App Store name field is 30`);
const locales = arr(app.locales);
if (!locales.length) E("A5", "app.locales missing — at least one, and each is its own 100-char keyword field");
if (app.primaryLocale && !locales.includes(app.primaryLocale))
  E("A6", `app.primaryLocale "${app.primaryLocale}" is not in app.locales`);
if (!app.tagline) W("A7", "app.tagline missing — the subtitle is written from it");

// --- auth --------------------------------------------------------------------
const auth = spec.auth ?? {};
if (auth.signup && auth.accountDeletion !== true)
  E("U1", "auth.accountDeletion must be true — App Store 5.1.1(v) rejects an account-creating app without in-app deletion");
if (auth.signup && auth.emailConfirm === false)
  E("U2", "auth.emailConfirm false — open signup with unverified email is what enabled the rest of the audit findings");
const roles = arr(spec.roles);
if (!roles.length) W("U3", "roles missing — say who uses this, even if the answer is just [\"user\"]");
if (roles.includes("admin"))
  I("U4", "admin role — privilege comes from the ADMIN_USER_IDS UUID allowlist, never from an email domain");

// --- entities ----------------------------------------------------------------
const ACCESS = ["owner", "owner-and-admin", "team", "public-read", "service-only"];
const entities = arr(spec.entities);
const entityNames = new Set();
// Anything that decides what a user is entitled to. The client may render its
// own row; it may never write one. Matched on whole name tokens, not substrings:
// "plan" would otherwise flag race_plans and training_plans in every fitness app,
// and a gate that cries wolf gets switched off.
const PRIVILEGED_TOKENS = new Set([
  "subscription", "subscriptions", "entitlement", "entitlements", "credit", "credits",
  "balance", "balances", "quota", "quotas", "tier", "tiers", "role", "roles",
  "permission", "permissions", "invoice", "invoices", "billing", "purchase", "purchases",
  "receipt", "receipts",
]);
const isPrivileged = (name) => String(name).split("_").some((t) => PRIVILEGED_TOKENS.has(t));

if (!entities.length) E("E0", "entities empty — a spec with no data model cannot generate a backend");

for (const t of entities) {
  const n = t?.name ?? "(unnamed)";
  if (!SNAKE.test(t?.name ?? "")) E("E1", `entity "${n}" must be snake_case`);
  if (entityNames.has(n)) E("E2", `entity "${n}" declared twice`);
  entityNames.add(n);

  if (!ACCESS.includes(t?.access))
    E("E3", `entity "${n}" access "${t?.access ?? ""}" — must be one of ${ACCESS.join(" | ")}`);

  const cols = arr(t?.columns);
  const colNames = cols.map((c) => (typeof c === "string" ? c.split(/\s+/)[0] : c?.name));
  if (!cols.length) E("E4", `entity "${n}" has no columns`);
  // A primary key, not necessarily one called "id" — a one-row-per-user table is
  // correctly keyed on user_id, and demanding a surrogate id there invents a bug.
  const hasPk = cols.some((c) => typeof c === "object" && c?.pk) || colNames.includes("id");
  if (cols.length && !hasPk) E("E5", `entity "${n}" declares no primary key (mark one column "pk": true)`);
  if (cols.length && !colNames.includes("created_at")) W("E6", `entity "${n}" has no created_at`);

  if (String(t?.access ?? "").startsWith("owner")) {
    if (!t?.ownerColumn) E("E7", `entity "${n}" is owner-scoped but declares no ownerColumn — RLS cannot be generated`);
    else if (!colNames.includes(t.ownerColumn))
      E("E8", `entity "${n}" ownerColumn "${t.ownerColumn}" is not one of its columns`);
  }

  if (!["client", "server"].includes(t?.writes))
    E("E9", `entity "${n}" writes "${t?.writes ?? ""}" — must be "client" or "server"`);

  if (isPrivileged(n) && t?.writes !== "server")
    E("E10", `entity "${n}" looks like an entitlement and is client-writable — entitlement is decided server-side`);

  if (t?.access === "public-read" && t?.writes === "client")
    W("E11", `entity "${n}" is world-readable and client-writable — say plainly why in the spec, or narrow it`);
}

// --- edge functions ----------------------------------------------------------
const fns = arr(spec.edgeFunctions);
const fnNames = new Set();
let modelFns = 0;
for (const f of fns) {
  const n = f?.name ?? "(unnamed)";
  if (!KEBAB.test(f?.name ?? "")) E("F1", `edge function "${n}" must be kebab-case (it becomes the URL path)`);
  if (fnNames.has(n)) E("F2", `edge function "${n}" declared twice`);
  fnNames.add(n);
  if (!["user", "service", "public"].includes(f?.auth))
    E("F3", `edge function "${n}" auth "${f?.auth ?? ""}" — must be "user", "service" or "public"`);
  if (f?.auth === "public" && !f?.publicReason)
    E("F4", `edge function "${n}" is public with no publicReason — an unauthenticated function is a bill anyone can run up`);
  if (f?.usesModel) {
    modelFns++;
    if (!f?.rateLimit?.bucket || !(f.rateLimit.perDay > 0))
      E("F5", `edge function "${n}" calls the model without rateLimit {bucket, perDay}`);
    if (f?.cache !== true) W("F6", `edge function "${n}" calls the model without a cache — the same question gets paid for twice`);
  }
  if (!f?.purpose) W("F7", `edge function "${n}" has no purpose — the agent that writes it has to guess`);
}
if (auth.accountDeletion === true && !fnNames.has("delete-account"))
  E("F8", "auth.accountDeletion is true but no delete-account edge function is declared");

for (const t of entities) {
  if (t?.writes !== "server") continue;
  const written = fns.some((f) => arr(f?.writes).includes(t.name));
  if (!written) W("F9", `entity "${t.name}" is server-written but no edge function declares it in writes[]`);
}

// --- screens -----------------------------------------------------------------
const screens = arr(spec.screens);
const routes = new Set();
const surfaced = new Set();
if (!screens.length) E("S0", "screens empty — the design stage has nothing to lay out");
for (const s of screens) {
  const r = s?.route ?? "(unnamed)";
  if (routes.has(r)) E("S1", `route "${r}" declared twice`);
  routes.add(r);
  if (!/^\((app|auth)\)\//.test(r))
    E("S2", `route "${r}" must live under (app)/ or (auth)/ — AuthGate routes on those groups`);
  if (!s?.purpose) W("S3", `screen "${r}" has no purpose — one sentence, or the agent invents one`);
  for (const e of [...arr(s?.reads), ...arr(s?.writes)]) {
    if (!entityNames.has(e)) E("S4", `screen "${r}" references unknown entity "${e}"`);
    surfaced.add(e);
  }
  for (const e of arr(s?.writes)) {
    const t = entities.find((x) => x?.name === e);
    if (t && t.writes === "server") W("S5", `screen "${r}" writes "${e}", which is server-written — it goes through an edge function`);
  }
}
for (const t of entities) {
  if (t?.writes === "server" && t?.access === "service-only") continue;
  if (!surfaced.has(t?.name)) W("S6", `entity "${t?.name}" is never read or written by a screen — dead table, or a missing screen`);
}
if (auth.accountDeletion === true && !screens.some((s) => /settings|account|profil/i.test(s?.route ?? "")))
  W("S7", "no settings/account screen — in-app account deletion has to live somewhere reachable");

// --- monetization ------------------------------------------------------------
const mon = spec.monetization ?? {};
const MODELS = ["free", "freemium", "subscription", "paid"];
if (!MODELS.includes(mon.model)) E("M1", `monetization.model "${mon.model ?? ""}" — one of ${MODELS.join(" | ")}`);
if (mon.model && mon.model !== "free") {
  if (!mon.entitlement) E("M2", "paid model with no monetization.entitlement name");
  if (!mon.provider) E("M3", "paid model with no monetization.provider (revenuecat | storekit)");
  if (!arr(mon.gatedFeatures).length)
    E("M4", "paid model with no gatedFeatures — decide what is behind the paywall before building both sides");
  if (mon.provider === "revenuecat" && !fnNames.has("revenuecat-webhook"))
    W("M5", "revenuecat without a revenuecat-webhook function — entitlement would have to be trusted from the client");
}

// --- ai ----------------------------------------------------------------------
const ai = spec.ai;
if (modelFns && !ai) E("I1", "edge functions call a model but spec.ai is missing (provider, model, disclosure)");
if (ai) {
  if (!ai.model) E("I2", "spec.ai.model missing — pin the model id, do not let an agent guess it");
  if (ai.disclosure !== true)
    E("I3", "spec.ai.disclosure must be true — EU AI Act Art. 50(1): the user is told they are talking to a machine. This one was already paid for once.");
  if (!modelFns && fns.length)
    W("I4", "spec.ai is declared but no edge function sets usesModel — the key would have nowhere safe to live");
}

// --- privacy -----------------------------------------------------------------
const priv = spec.privacy ?? {};
if (!has(priv, "tracking")) E("P1", "privacy.tracking missing — the privacy label needs a yes or no, and a wrong yes is a rejection");
if (priv.tracking === true)
  W("P2", "privacy.tracking true — this claims cross-app tracking and requires ATT. Say no unless an ad SDK is actually shipping.");
if (!arr(priv.collects).length) W("P3", "privacy.collects empty — every table with a user column collects something");

// --- aso ---------------------------------------------------------------------
const aso = spec.aso ?? {};
const cluster = arr(aso.cluster);
if (!cluster.length) W("K1", "aso.cluster empty — the listing stage starts from it");
for (const k of cluster) if (/\s/.test(k)) E("K2", `aso.cluster "${k}" is a phrase — iOS combines single words itself`);
if (!aso.scan) I("K3", "no aso.scan path — /app-scan writes the verdict this cluster should come from");

// --- scope -------------------------------------------------------------------
if (!arr(spec.nonGoals).length)
  W("N1", "nonGoals empty — name what v1 does not do, or the fan-out will build it");
if (!spec.coreLoop) W("N2", "coreLoop missing — one sentence: what the user does here, repeatedly");

// --- report ------------------------------------------------------------------
const errors = issues.filter((i) => i[0] === "E").length;
const warns = issues.filter((i) => i[0] === "W").length;

console.log(`\n${C.b}${app.name ?? "?"}${C.n} ${C.d}${FILE}${C.n}`);
console.log(
  `${C.d}  ${entities.length} entities · ${fns.length} edge functions · ${screens.length} screens · ${locales.length} locales${C.n}`
);
if (issues.length) console.log();
for (const [sev, id, msg] of issues) {
  const tag = sev === "E" ? `${C.r}error${C.n}` : sev === "W" ? `${C.y}warn ${C.n}` : `${C.d}info ${C.n}`;
  console.log(`  ${tag} ${C.d}${id}${C.n} ${msg}`);
}

if (SUMMARY) {
  console.log(`\n${C.b}  build plan${C.n}`);
  console.log(`${C.d}  migrations${C.n}  ${entities.map((t) => t.name).join(", ") || "—"}`);
  console.log(`${C.d}  functions ${C.n}  ${fns.map((f) => f.name).join(", ") || "—"}`);
  console.log(`${C.d}  screens   ${C.n}  ${screens.map((s) => s.route).join(", ") || "—"}`);
  console.log(`${C.d}  listings  ${C.n}  ${locales.join(", ") || "—"}`);
}

console.log(
  `\n${errors ? C.r + C.b : C.g + C.b}  ${errors} error${errors === 1 ? "" : "s"}${C.n}  ${C.y}${warns} warning${warns === 1 ? "" : "s"}${C.n}\n`
);
process.exit(errors > 0 || (STRICT && warns > 0) ? 1 : 0);
