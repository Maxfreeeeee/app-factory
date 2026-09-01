# app-factory

Ship several App Store apps without re-deciding the same things, and without
security eroding as the pace goes up.

Four layers, all built.

| Layer | What |
|---|---|
| 1 — template | Golden Expo + Supabase app, audit findings pre-fixed, `new-app.sh` |
| 2 — gates | `spec-lint.mjs`, `preflight.sh`, `aso-lint.mjs`, `icons.mjs`, `shots.mjs` — the rules as scripts |
| 3 — reach | `asc.mjs` — App Store Connect over the API, so the listing is not retyped |
| 4 — skills | `/app-forge` over `/app-scan`, `/app-spec`, `/app-new`, `/app-backend`, `/app-design`, `/app-assets`, `/aso-listing`, `/asc-push`, `/app-ship` |

```
app-factory/
  FACTORY.md          invariants, @-imported by every app's AGENTS.md
  template/           the golden app
  scans/              verdict files, gitignored — answers stay local
  specs/              specs written before their app directory exists
  scripts/
    new-app.sh        scaffold + substitute + git init + preflight
    spec-lint.mjs     contract gate — the spec every later stage reads
    preflight.sh      security gate
    aso-lint.mjs      listing gate
    icons.mjs         icon validation + derived rasters
    shots.mjs         screenshot capture + validation
    asc.mjs           App Store Connect: metadata, screenshots, build
```

## The chain, end to end

```
/app-scan    <niche>   →  scans/<niche>.md        kill it, or name what to build
/app-spec    <descr>   →  specs/<slug>.json       the contract — spec-lint green
/app-new     <Name>    →  ~/Desktop/<Name>        15/15 preflight on day zero
/app-backend           →  migrations + functions  fanned out, applied to a real project
/app-design            →  canvas → screens        one human stop: Max edits the canvas
/app-assets            →  icon + screenshots      alpha stripped, 6.9" verified
/aso-listing           →  store/<locale>.md       de-DE first, then en-US, then en-GB
/asc-push              →  App Store Connect       metadata, screenshots, build attached
/app-ship              →  docs/PUBLISH-CHECKLIST  what only Max can do, in order
```

`/app-forge` runs the whole chain with the gates and the checkpoints in it, and
keeps a ledger in `<app>/docs/FORGE.md` so a build survives a session boundary.

Each step writes a file the next one reads, so nothing has to be re-explained
between sessions. The skills live in `~/.claude/skills/` and therefore work from
any directory — they are not tied to a repo.

### Three stops, and only three

Everything else runs unattended. The chain stops at the **design canvas** (nothing
is implemented from a design nobody looked at), at anything that **costs money**
(a Supabase project past the free allowance, every EAS build), and at **Submit
for Review** — `asc.mjs` has no submit path at all, because uploading metadata
is reversible and submitting is not.

### Why skills and not memory

A preference can be forgotten and a memory can go stale. These encode the
things that are expensive to rediscover: the launch thresholds that differ from
Astro's published advice, the filter that was added after desk research nearly
cost a build, the German compound problem, and the App Store rejections already
paid for once (privacy-label tracking claim, EU AI Act Art. 50(1), sandbox
subscriptions expiring mid-review, EAS billing the project owner).

## Running this on another machine

This is a personal tool published as-is. It assumes macOS (it shells out to
`sips` and `xcrun simctl`), an Apple Developer account, a Supabase account, and
Expo. Nothing in it is a framework — it is one person's pipeline, and the parts
worth stealing are the gates.

Two things are deliberately **not** in this repo:

- **Credentials.** App Store Connect identifiers live in
  `~/.appstoreconnect/config.json`, outside any repo, and the private key stays
  where App Store Connect put it:

  ```json
  { "keyId": "ABCD123456",
    "issuerId": "00000000-0000-0000-0000-000000000000",
    "keyPath": "~/.appstoreconnect/private_keys/AuthKey_ABCD123456.p8" }
  ```

  `new-app.sh` reads it and writes the `submit.production.ios` block into each
  scaffolded app; `asc.mjs` reads it directly, so it works from any directory.
  Get the key from App Store Connect → Users and Access → Integrations. Without
  the file, everything else still runs — only the upload stage needs it.

- **The skills.** `/app-forge` and the eight stage skills live in
  `~/.claude/skills/`, not here, because that is where Claude Code loads them
  from. The scripts in `scripts/` are the enforceable half and stand alone.

The template's `package.json` scripts call
`$HOME/Desktop/app-factory/scripts/…` by absolute path — deliberately, so the
gate cannot be copied into an app and quietly diverge from it. Clone somewhere
else and those paths need changing.

## Why gates first

Prose rules get forgotten between apps. Both existing apps carried the *same*
session-storage flaw under two different flag names — one written months after
the other, after the first had already been audited and "fixed". On the gate's
first run it named both, and both were closed the same day. A script
catches that. A memory of an audit does not.

## scripts/new-app.sh

```
new-app.sh "Roxsplit" --bundle com.maxfre.roxsplit
```

Copies `template/`, substitutes name / slug / bundle / scheme, pins
`@anthropic-ai/sdk` to whatever npm reports *at scaffold time* (rather than to a
version guessed months earlier), writes `.env` from the examples, makes the
first commit, and runs preflight. A fresh app passes 15/15 with zero warnings —
that is the template's own regression test.

## What the template already gets right

Each of these is a finding that cost something once:

| | |
|---|---|
| SecureStore only, no env switch | `async-storage` is not a dependency, so the shortcut cannot return |
| No dev-login affordance at all | the one that shipped behind a flag had to be pulled |
| `ADMIN_USER_IDS` UUID allowlist | email-derived privilege was a self-service admin bypass |
| RLS + explicit column-scoped grants in every migration | Supabase's default privileges hand new tables to `authenticated` |
| Webhook: constant-time compare + `event.id` insert as the lock | a retried delivery applied an entitlement twice |
| In-app account deletion in v1 | App Store 5.1.1(v) rejects without it |
| `enable_confirmations = true` | open signup with unverified email enabled the rest |
| `search_path = ''` on every SECURITY DEFINER function | |

The eight `_shared/` backend modules were byte-identical across both existing
apps before extraction — they are not a guess at what is reusable.

## scripts/preflight.sh

Security gate for an Expo + Supabase app. Every check traces to a finding in
a real security audit of a shipped app, or to an App Store review
requirement. `preflight.sh --list` prints all checks.

```
npm run preflight          # from an app directory
```

Exit 1 on any blocking finding. Accepted risks go in `.preflight-accepted`
in the app root, one `ID  reason` per line — mirrors the `◇ accepted risk`
notation in the audit:

```
M1  by design: client writes its own tracking data, no cross-user leak
```

## scripts/aso-lint.mjs

Validates one App Store listing per locale. Encodes the rules from
the ASO research this repo is built on: single words only (iOS combines them
across title + subtitle + keywords itself), no word spent twice, no character
spent on something Apple ignores.

```
npm run aso                # lints every store/<locale>.md
```


### Listing format — `store/<locale>.md`

```
title: Beispiel — Erholung & Laufen
subtitle: Trainiere nach deinem Körper
keywords: erholung,hrv,ruhepuls,schlaf,laufplan,marathon,pace,kalorien
promo: One editable line, 170 chars, no review needed to change it.

--- description ---
Long text, 4000 chars.
```

Optional `store/_config.md` holds `trademarks:` — terms allowed in the keyword
field but never in title or subtitle.

### What it checks

- Character limits: title 30, subtitle 30, keywords 100, promo 170, description 4000
- Phrases in the keyword field (**error** — iOS builds phrases itself)
- Spaces after commas (every one is a lost character)
- A word spent in both title/subtitle and keywords
- Singular/plural pairs Apple already stems
- Words Apple ignores or the listing implies (`app`, `free`, `kostenlos`, `beste`…)
- Trademarks in title or subtitle (**error** — this is how apps get removed)
- Umlaut words missing their `ae`/`oe`/`ue` spelling — both index separately
- German compounds ≥12 chars — they do **not** decompose, so they cost real budget

### Locales are the international lever

Each localization is its own 100-character keyword field. `de-DE` + `en-US` +
English (U.K.) is ~300 characters of indexed surface for one binary, and
`de-DE` carries the Difficulty discount. The linter warns when two locales
share a keyword field, because a copy wastes the second one.

## scripts/spec-lint.mjs

The contract gate. `docs/spec.json` is what `/app-backend` turns into migrations,
`/app-design` lays out, `/aso-listing` starts from and `/app-ship` answers the
privacy questionnaire with. Every stage after it is fanned out across subagents,
and an agent cannot ask a follow-up question — so anything it would have to guess
is decided here.

```
npm run spec                    # from an app directory
node spec-lint.mjs <file> --summary --strict
```

It refuses a spec whose owner-scoped table has no `ownerColumn` (RLS cannot be
generated), whose entitlement table is client-writable, whose model call has no
rate limit, whose screen references a table that does not exist, or which turns
off account deletion or AI disclosure. It also refuses phrases in `aso.cluster`,
for the same reason `aso-lint` does.

The privileged-table check matches whole name tokens rather than substrings —
`plan` as a substring flags `race_plans` and `training_plans` in every fitness
app, and a gate that cries wolf gets switched off.

## scripts/asc.mjs

App Store Connect over its own API, with the credentials already in `eas.json`.

```
asc.mjs status            version state, per-locale gaps, what is left for you
asc.mjs push --dry-run    what would change
asc.mjs push              name, subtitle, keywords, description, promo, URLs
asc.mjs screenshots       store/screenshots/<locale>/*.png, ordered by filename
asc.mjs build             attach the newest processed TestFlight build
```

`push` runs `aso-lint` first and refuses on any error — a keyword field the
linter rejects is not made acceptable by being in Apple's database.

It carries the things that are expensive to rediscover: 6.9" screenshots upload
under `APP_IPHONE_67` (there is no `APP_IPHONE_69`), `whatsNew` is rejected on a
first version, `supportUrl` is required to submit, and metadata is only editable
in five specific states. It cannot submit for review, deliberately.

## scripts/icons.mjs and scripts/shots.mjs

Max draws `assets/icon.png` at 1024×1024; every other raster is a deterministic
resize. The check that earns the script is `hasAlpha` — App Store Connect rejects
an alpha channel at *upload*, after the build is already spent, and every design
tool exports RGBA by default. Six plausible `sips` routes were measured and do
not strip it; only a round trip through JPEG does, and the script prints that
command when it fires.

`shots.mjs` captures from the booted simulator into
`store/screenshots/<locale>/NN-name.png`, flattens the RGBA that `simctl` always
writes, and validates the one iPhone set Apple takes in 2026 — the 6.9" display,
1320×2868 or 1290×2796.
