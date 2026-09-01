# __APP_NAME__

<!-- One paragraph: what this app is, who it is for, what the core loop is.
     Then the ASO niche it was chosen for and the keyword cluster behind it. -->

Scaffolded from `~/Desktop/app-factory/template`. The shared invariants below
apply; everything in this file is what makes THIS app different.

@~/Desktop/app-factory/FACTORY.md

## Architecture

- `src/app/` — expo-router: `(auth)` and `(app)` groups; redirect logic lives only in `src/providers/AuthGate.tsx`
- `src/lib/` — `supabase.ts` (client), `api.ts` (one typed method per edge function), `hooks.ts` (react-query)
- `supabase/migrations/` — sequential, never edited after they are applied
- `supabase/functions/` — Deno edge functions; `_shared/` is the proven core, copied not reinvented
- `store/` — one listing per locale, validated by `npm run aso`

## Commands

- `npm start` — Metro/Expo dev server
- `npm run check` — typecheck + tests + preflight; run before every build
- `npm run aso` — validate the store listings

## This app's decisions

<!-- Domain rules, data model choices, anything a reviewer would need to know.
     Delete this comment once there is something real here. -->
