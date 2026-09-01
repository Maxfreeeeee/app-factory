#!/usr/bin/env bash
# preflight.sh — security gate for Expo + Supabase apps built from the app-factory.
#
# Every check traces back to a finding from a real security audit of a shipped app
# (docs/security-audit-2026-07-31.md) or to an App Store review requirement.
# Prose rules get forgotten between apps; this does not.
#
# Usage:  preflight.sh [app-dir]        (default: $PWD)
#         preflight.sh --list           (show all checks)
#
# Accepted risks: put one "ID  reason" per line in <app-dir>/.preflight-accepted
# (mirrors the "◇ accepted risk" notation in the audit). Accepted FAILs are
# reported as ACCEPTED and do not break the build.

set -uo pipefail

APP_DIR="${1:-$PWD}"
[ "${1:-}" = "--list" ] && LIST_ONLY=1 || LIST_ONLY=0
[ "$LIST_ONLY" = 1 ] && APP_DIR="$PWD"
APP_DIR="$(cd "$APP_DIR" 2>/dev/null && pwd)" || { echo "no such directory: ${1:-}"; exit 2; }

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  R=$'\033[31m'; Y=$'\033[33m'; G=$'\033[32m'; D=$'\033[2m'; B=$'\033[1m'; N=$'\033[0m'
else R=""; Y=""; G=""; D=""; B=""; N=""; fi

FAILS=0; WARNS=0; PASSES=0; ACCEPTED=0
ACCEPT_FILE="$APP_DIR/.preflight-accepted"

# --- source layout -----------------------------------------------------------
# apps are either flat (src/ at root) or nested (app/src) — both layouts ship
CLIENT_DIRS=""
for d in "$APP_DIR/src" "$APP_DIR/app/src" "$APP_DIR/app" "$APP_DIR/components" "$APP_DIR/lib"; do
  [ -d "$d" ] && case "$d" in */app) [ -f "$d/package.json" ] || CLIENT_DIRS="$CLIENT_DIRS $d";; *) CLIENT_DIRS="$CLIENT_DIRS $d";; esac
done
SUPA_DIR=""
for d in "$APP_DIR/supabase" "$APP_DIR/app/supabase" "$APP_DIR/../supabase"; do
  [ -d "$d" ] && { SUPA_DIR="$d"; break; }
done
MIGRATIONS="$SUPA_DIR/migrations"
FUNCTIONS="$SUPA_DIR/functions"

cgrep() { # grep across client (non-edge-function) source only
  [ -n "$CLIENT_DIRS" ] || return 1
  grep -rniE --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
    --exclude-dir=node_modules --exclude-dir=.expo --exclude-dir=dist --exclude-dir=functions \
    "$1" $CLIENT_DIRS 2>/dev/null
}

is_accepted() { [ -f "$ACCEPT_FILE" ] && grep -qE "^[[:space:]]*$1([[:space:]]|$)" "$ACCEPT_FILE"; }

# report ID SEVERITY TITLE EVIDENCE
report() {
  local id="$1" sev="$2" title="$3" ev="${4:-}"
  # A documented decision stops nagging whatever its severity — otherwise the
  # accept file only silences blockers and warnings stay noise forever.
  if [ "$sev" != "PASS" ] && is_accepted "$id"; then
    local why; why=$(grep -E "^[[:space:]]*$id([[:space:]]|$)" "$ACCEPT_FILE" | head -1 | sed -E "s/^[[:space:]]*$id[[:space:]]*//")
    printf "  ${D}◇ %-4s ACCEPTED${N} %s ${D}— %s${N}\n" "$id" "$title" "$why"; ACCEPTED=$((ACCEPTED+1)); return
  fi
  case "$sev" in
    FAIL) printf "  ${R}${B}✗ %-4s FAIL${N}     %s\n" "$id" "$title"; FAILS=$((FAILS+1));;
    WARN) printf "  ${Y}▲ %-4s WARN${N}     %s\n" "$id" "$title"; WARNS=$((WARNS+1));;
    PASS) printf "  ${G}✓ %-4s${N} ${D}%s${N}\n" "$id" "$title"; PASSES=$((PASSES+1)); return;;
  esac
  [ -n "$ev" ] && printf "%s\n" "$ev" | head -4 | sed "s|$APP_DIR/||" | sed "s/^/       ${D}/;s/$/${N}/"
}

if [ "$LIST_ONLY" = 1 ]; then
  cat <<'LIST'
C1  admin privilege derived from an email address or domain suffix
C2  runtime flag can weaken auth/storage/verification in a shipped build
C3  Supabase email confirmations disabled
H1  blanket write grant to authenticated/anon on all tables
H2  auth session reachable from AsyncStorage instead of SecureStore
H3  payment webhook without replay/idempotency protection
S1  service-role key referenced from client code
S2  placeholder secret (change-me / your-secret) still in the tree
S3  .env or a credentials file tracked by git
S4  table created without row level security enabled
S5  secret-looking value exposed through an EXPO_PUBLIC_ variable
S6  LLM provider API called directly from the client
S7  hardcoded credentials in source
S8  no in-app account deletion (App Store 5.1.1(v))
S9  hardcoded JWT literal in client source
LIST
  exit 0
fi

echo
printf "${B}preflight${N} ${D}%s${N}\n" "$APP_DIR"
[ -n "$SUPA_DIR" ] && printf "${D}  supabase: %s${N}\n" "${SUPA_DIR#$APP_DIR/}"
echo

# --- C1: privilege from email --------------------------------------------------
hit=$(cgrep "endsWith\(['\"]@|['\"]@[a-z0-9.-]+\.(local|internal|test)['\"]|email.*(===|==).*(admin|@)" ; \
      [ -d "$FUNCTIONS" ] && grep -rniE "endsWith\(['\"]@|['\"]@[a-z0-9.-]+\.(local|internal|test)['\"]" "$FUNCTIONS" 2>/dev/null)
if [ -n "$hit" ]; then report C1 FAIL "privilege derived from an email address — use a UUID allowlist" "$hit"
else report C1 PASS "no email-derived privilege"; fi

# --- C2: shippable security downgrade ------------------------------------------
# An EXPO_PUBLIC_ flag ships inside the bundle and can be flipped in a release
# build; __DEV__ is stripped by the compiler. So: env-selected = blocking,
# __DEV__-gated = informational.
DOWNGRADE="DEV_LOGIN|devLogin|SKIP_AUTH|_DEV_BYPASS|INSECURE|SCREENSHOT_LOGIN|DISABLE_(AUTH|RLS|SSL|VERIFY|CONFIRM)|BYPASS_(AUTH|RLS)|ALLOW_INSECURE"
env_hit=$( { cgrep "process\.env\.[A-Z0-9_]*($DOWNGRADE)"; \
             grep -rhoE "EXPO_PUBLIC_[A-Z0-9_]*($DOWNGRADE)[A-Z0-9_]*" --exclude-dir=node_modules --exclude-dir=.git "$APP_DIR" 2>/dev/null | sort -u; } )
ungated=""
# A translation catalogue holding the string "devLogin" is a label, not an
# affordance — and it will never contain __DEV__.
for f in $(cgrep "$DOWNGRADE" | grep -viE "/(i18n|locales|translations|lang)/" | cut -d: -f1 | sort -u); do
  grep -q "__DEV__" "$f" || ungated="$ungated$f: dev affordance with no __DEV__ guard in the file"$'\n'
done
if [ -n "$env_hit" ]; then report C2 FAIL "env flag can weaken security in a release build — gate on __DEV__ only" "$env_hit"
elif [ -n "$ungated" ]; then report C2 FAIL "dev affordance not guarded by __DEV__" "$ungated"
else report C2 PASS "no shippable security-downgrade flag"; fi

# --- C3: email confirmations ---------------------------------------------------
if [ -f "$SUPA_DIR/config.toml" ]; then
  if grep -qE "^[[:space:]]*enable_confirmations[[:space:]]*=[[:space:]]*false" "$SUPA_DIR/config.toml"; then
    report C3 FAIL "enable_confirmations = false — open signup with unverified email" "$(grep -nE 'enable_confirmations' "$SUPA_DIR/config.toml")"
  else report C3 PASS "email confirmations enabled in config.toml"; fi
else report C3 WARN "no supabase/config.toml found — cannot verify email confirmations"; fi

# --- H1: blanket grants --------------------------------------------------------
if [ -d "$MIGRATIONS" ]; then
  hit=$(grep -rniE "grant[[:space:]]+(all|insert|update|delete)[^;]*on[[:space:]]+all[[:space:]]+tables[^;]*to[[:space:]]+(authenticated|anon)" "$MIGRATIONS" 2>/dev/null)
  if [ -n "$hit" ]; then report H1 FAIL "blanket write grant — RLS becomes the only write gate" "$hit"
  else report H1 PASS "no blanket write grants"; fi
fi

# --- H2: session storage -------------------------------------------------------
clients=$(cgrep "createClient" | cut -d: -f1 | sort -u)
if [ -n "$clients" ]; then
  bad=""; soft=""
  for f in $clients; do
    # Key on the import, not the word: a comment explaining why AsyncStorage is
    # forbidden must not read as a finding. Not imported means not reachable.
    grep -qE "^[[:space:]]*import .*@react-native-async-storage/async-storage" "$f" || continue
    sel=$(grep -nE "storage:.*AsyncStorage" "$f")
    if [ -n "$sel" ] && printf '%s' "$sel" | grep -q "process\.env"; then
      bad="$bad$f:$(printf '%s' "$sel" | head -1 | cut -d: -f1) env flag selects plaintext AsyncStorage"$'\n'
    elif ! grep -qiE "SecureStore|SecureStorage" "$f"; then
      bad="$bad$f: AsyncStorage is the only session storage"$'\n'
    else
      soft="$soft$f: AsyncStorage reachable beside SecureStore (guarded)"$'\n'
    fi
  done
  if [ -n "$bad" ]; then report H2 FAIL "auth session can land in plaintext AsyncStorage — SecureStore only" "$bad"
  elif [ -n "$soft" ]; then report H2 WARN "AsyncStorage still reachable for the session" "$soft"
  else report H2 PASS "supabase client does not use AsyncStorage"; fi
fi

# --- H3: webhook idempotency ---------------------------------------------------
if [ -d "$FUNCTIONS" ]; then
  hooks=$(find "$FUNCTIONS" -maxdepth 1 -type d -name '*webhook*' 2>/dev/null)
  if [ -n "$hooks" ]; then
    bad=""
    for h in $hooks; do
      grep -rqiE "idempot|event\.id|event_id|processed_events|timingSafeEqual" "$h" 2>/dev/null || bad="$bad$h: no idempotency or constant-time compare"$'\n'
    done
    if [ -n "$bad" ]; then report H3 FAIL "payment webhook without replay protection" "$bad"
    else report H3 PASS "webhooks have replay/idempotency handling"; fi
  fi
fi

# --- S1: service role in client ------------------------------------------------
hit=$(cgrep "SERVICE_ROLE|service_role")
if [ -n "$hit" ]; then report S1 FAIL "service-role key referenced from client code" "$hit"
else report S1 PASS "no service-role key in client code"; fi

# --- S2: placeholder secrets ---------------------------------------------------
hit=$(grep -rniE "change-?me|your-secret|replace-?me|todo-?secret" \
      --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs \
      --exclude='*.example' --exclude='*.sample' --exclude='*.template' --exclude='*.md' \
      "$SUPA_DIR" "$APP_DIR"/.env* "$APP_DIR"/app/.env* 2>/dev/null)
if [ -n "$hit" ]; then report S2 FAIL "placeholder secret still in the tree" "$hit"
else report S2 PASS "no placeholder secrets"; fi

# --- S3: tracked secrets -------------------------------------------------------
if git -C "$APP_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  hit=$(git -C "$APP_DIR" ls-files 2>/dev/null | grep -E '(^|/)(\.env($|\.)|credentials\.json|.*\.p8$|.*\.p12$|.*\.mobileprovision$)' | grep -vE '\.(example|sample|template)$')
  if [ -n "$hit" ]; then report S3 FAIL "secret file tracked by git" "$hit"
  else report S3 PASS "no secret files tracked by git"; fi
else report S3 WARN "not a git repository — cannot check for tracked secrets"; fi

# --- S4: RLS per table ---------------------------------------------------------
if [ -d "$MIGRATIONS" ]; then
  tables=$(grep -rhoiE "create[[:space:]]+table[[:space:]]+(if[[:space:]]+not[[:space:]]+exists[[:space:]]+)?[a-z0-9_.\"]+" "$MIGRATIONS" 2>/dev/null \
           | sed -E 's/.*[[:space:]]//; s/"//g; s/^public\.//' | sort -u)
  rls=$(grep -rhoiE "alter[[:space:]]+table[[:space:]]+[a-z0-9_.\"]+[[:space:]]+enable[[:space:]]+row[[:space:]]+level" "$MIGRATIONS" 2>/dev/null \
        | sed -E 's/[[:space:]]+enable.*//; s/.*[[:space:]]//; s/"//g; s/^public\.//' | sort -u)
  missing=""
  for t in $tables; do echo "$rls" | grep -qx "$t" || missing="$missing  $t"$'\n'; done
  if [ -n "$missing" ]; then report S4 FAIL "table(s) created without row level security" "$missing"
  else report S4 PASS "every created table enables RLS ($(echo "$tables" | grep -c .) tables)"; fi
fi

# --- S5: secrets behind EXPO_PUBLIC_ -------------------------------------------
hit=$(grep -rhoE "EXPO_PUBLIC_[A-Z0-9_]*(ANTHROPIC|SERVICE|SECRET|PRIVATE|PASSWORD|ADMIN|TOKEN)[A-Z0-9_]*" \
      --exclude-dir=node_modules --exclude-dir=.git "$APP_DIR" 2>/dev/null | sort -u)
if [ -n "$hit" ]; then report S5 FAIL "secret-looking value shipped in the client bundle" "$hit"
else report S5 PASS "no secrets behind EXPO_PUBLIC_"; fi

# --- S6: LLM called from client ------------------------------------------------
hit=$(cgrep "api\.anthropic\.com|@anthropic-ai/|api\.openai\.com")
if [ -n "$hit" ]; then report S6 FAIL "LLM provider called from the client — key would ship to users" "$hit"
else report S6 PASS "LLM access goes through edge functions"; fi

# --- S7: hardcoded credentials -------------------------------------------------
hit=$(cgrep "(password|passwort|apikey|api_key)[[:space:]]*[:=][[:space:]]*['\"][^'\"]{6,}['\"]" | grep -viE "placeholder|process\.env|autocomplete|type=|textContentType|newPassword|new-password|current-password" \
      | grep -viE "/(i18n|locales|translations|lang)/")
if [ -n "$hit" ]; then report S7 WARN "possible hardcoded credential" "$hit"
else report S7 PASS "no hardcoded credentials"; fi

# --- S8: account deletion (App Store 5.1.1(v)) ---------------------------------
has_signup=$(cgrep "signUp\(" | head -1)
if [ -n "$has_signup" ]; then
  hit=$( { cgrep "delete-?account|deleteAccount|konto.?l(ö|oe)schen"; \
           [ -d "$FUNCTIONS" ] && ls "$FUNCTIONS" 2>/dev/null | grep -i "delete"; } | head -1)
  if [ -z "$hit" ]; then report S8 FAIL "app creates accounts but offers no in-app deletion (App Store 5.1.1(v))"
  else report S8 PASS "in-app account deletion present"; fi
fi

# --- S9: hardcoded JWT ---------------------------------------------------------
hit=$(cgrep "['\"]eyJ[A-Za-z0-9_-]{20,}")
if [ -n "$hit" ]; then report S9 WARN "hardcoded JWT literal in client source — move to env" "$hit"
else report S9 PASS "no hardcoded JWT literals"; fi

# --- summary -------------------------------------------------------------------
echo
if [ "$FAILS" -gt 0 ]; then
  printf "${R}${B}  %d blocking${N}  ${Y}%d warning${N}  ${G}%d ok${N}${D}  %d accepted${N}\n\n" "$FAILS" "$WARNS" "$PASSES" "$ACCEPTED"
  exit 1
fi
printf "${G}${B}  preflight passed${N}  ${Y}%d warning${N}  ${G}%d ok${N}${D}  %d accepted${N}\n\n" "$WARNS" "$PASSES" "$ACCEPTED"
exit 0
