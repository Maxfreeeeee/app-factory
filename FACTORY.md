# Factory invariants

Every app scaffolded from `~/Desktop/app-factory/template` inherits these. They
are not style preferences — each one is a finding that already cost a rebuild,
a review rejection, or an audit. `npm run preflight` enforces the enforceable
ones; the rest are here because a script cannot see them.

## Security

- **The session store is not configurable.** SecureStore only. `@react-native-async-storage/async-storage` is deliberately absent from `package.json` so the shortcut cannot come back. If a simulator build needs a session, sign in again.
- **No `EXPO_PUBLIC_` flag may weaken auth, storage, or verification.** Everything with that prefix ships inside the bundle and can be flipped in a release build. Dev-only affordances gate on `__DEV__`, which the compiler strips.
- **Privilege comes from a UUID allowlist** (`ADMIN_USER_IDS`), never from an email address or domain suffix. Users choose their own email.
- **Entitlement is decided server-side.** The client may read its own `subscriptions` row for rendering; it may never write it.
- **Every table enables RLS in the migration that creates it,** and grants are explicit and column-scoped. Supabase's default privileges hand new public tables to `authenticated`, so a service-role-only table needs an explicit `revoke`.
- **Payment webhooks compare secrets in constant time and record `event.id`** before applying anything.
- **The model API is called from edge functions only.** A key in the client is a key in everyone's hands.
- **`SECURITY DEFINER` functions set `search_path = ''`.**

## App Store

- **In-app account deletion ships in v1** (guideline 5.1.1(v)) — an app that creates accounts is rejected without it.
- **Email confirmation stays on**, in `config.toml` *and* in the hosted dashboard. The file does not configure the hosted project.
- **Do not ship near-identical apps from one account** (guideline 4.3(a), spam). A shared codebase is invisible to review and fine; a reskin of the same app into another vertical is not.
- **Trademarks live in the keyword field only** — never in the title or subtitle. Rights holders get apps removed, and Apple acts on the complaint.

## Spec

- **The spec is a contract, not documentation.** `docs/spec.json` is read by the backend, design, listing and ship stages. Anything it leaves open, parallel agents each close differently — an agent cannot ask a follow-up question.
- **`spec-lint.mjs` decides the shape**: owner-scoped tables declare an `ownerColumn`, anything that grants entitlement is `writes: server`, every model call carries a rate limit, `accountDeletion` and `ai.disclosure` are true. Catching those in a 2 KB JSON file costs nothing; catching them in preflight costs a rebuild.
- **`nonGoals` is load-bearing.** The fan-out builds exactly what the spec lists. Every entity is a migration, an RLS policy, a screen, a privacy answer and a row `delete-account` has to clear.

## Fan-out

- **Whatever is shared and ordered is decided before the fan-out, by the orchestrator** — migration numbers, the theme, `src/lib/api.ts`, the rate-limit table. Two agents both choosing `0005_` is the failure mode, and so is eight agents each fixing navigation.
- **Sequential only where there is a real dependency**: theme before screens, migrations before types before typed API methods, metadata push before screenshots.
- **Every agent gets the invariants in its own brief.** An agent has not read this file unless you put it there.
- **A verification agent is adversarial or it is worthless.** "Name a row user A can read that belongs to user B" finds things; "review the RLS policies" returns a summary of the code.

## Assets

- **The icon carries no alpha channel.** App Store Connect rejects it at upload, after the build is already spent. Measured: six plausible `sips` routes do not strip it — only a round trip through JPEG does, because JPEG cannot carry alpha. `icons.mjs` prints the working command.
- **One iPhone screenshot set in 2026: the 6.9" display**, 1320×2868 or 1290×2796. `simctl` writes RGBA every time, so screenshots get flattened too.
- **The first two screenshots are the advertisement** — they are the only ones shown in search results.

## App Store Connect

- **The listing goes up over the API from `store/<locale>.md`.** Retyping a 100-character keyword field into a web form is how a keyword gets spent twice, and `aso-lint` cannot see a web form.
- **Nothing submits itself.** `asc.mjs` has no submit path. Uploading metadata to a `PREPARE_FOR_SUBMISSION` version is reversible; a submission is not, and 4.3(a) is a judgement call.
- **The app record is created by hand, once** — the API cannot create it. Its id goes in `eas.json` as `ascAppId`.
- **6.9" screenshots upload under `APP_IPHONE_67`.** `APP_IPHONE_69` does not exist; verified against the API's own enum on 2026-09-01.

## Listing

- Keywords are single words. iOS combines them across title, subtitle and keyword field itself, so a phrase spends characters to buy nothing.
- No word appears in two fields. No word Apple ignores (`app`, `free`, `kostenlos`, `beste`).
- Each localization is its own 100-character field. `de-DE` first — it carries the Difficulty discount — then `en-US`, then further locales as additive surface.
- German compounds do not decompose. Budget roughly double per concept and verify each against Astro.
- `npm run aso` fails until `store/<locale>.md` is filled. That failure is the checklist, not a bug.

## Working style

- Expo changes fast: read `https://docs.expo.dev/versions/v57.0.0/` before writing app code, not from memory.
- Migrations are sequential and never edited once applied.
- Accepted risks go in `.preflight-accepted` with a real reason, not in a code comment.
