#!/usr/bin/env bash
# new-app.sh — scaffold a new app from the factory template.
#
# Usage:  new-app.sh <Name> [--slug <slug>] [--bundle <com.x.y>] [--dir <path>]
#                    [--spec <spec.json>] [--install]
# Example: new-app.sh "Roxsplit" --bundle com.maxfre.roxsplit

set -euo pipefail

FACTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$FACTORY/template"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; D=$'\033[2m'; B=$'\033[1m'; N=$'\033[0m'
else R=""; G=""; Y=""; D=""; B=""; N=""; fi

die() { printf "${R}%s${N}\n" "$1" >&2; exit 1; }

APP_NAME="${1:-}"
[ -n "$APP_NAME" ] || die "usage: new-app.sh <Name> [--slug s] [--bundle com.x.y] [--dir path] [--spec f] [--install]"
shift

SLUG=""; BUNDLE=""; DEST=""; SPEC=""; INSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --slug)   SLUG="$2"; shift 2;;
    --bundle) BUNDLE="$2"; shift 2;;
    --dir)    DEST="$2"; shift 2;;
    --spec)   SPEC="$2"; shift 2;;
    --install) INSTALL=1; shift;;
    *) die "unknown option: $1";;
  esac
done

# slug: lowercase, alphanumeric + hyphen (Expo slug and npm name rules)
[ -n "$SLUG" ] || SLUG="$(printf '%s' "$APP_NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"
[ -n "$BUNDLE" ] || BUNDLE="com.maxfre.$(printf '%s' "$SLUG" | tr -d '-')"
[ -n "$DEST" ] || DEST="$HOME/Desktop/$APP_NAME"
SCHEME="$(printf '%s' "$SLUG" | tr -d '-')"

[ -e "$DEST" ] && die "$DEST already exists"
[ -d "$TEMPLATE" ] || die "template not found at $TEMPLATE"

printf "\n${B}%s${N}\n" "$APP_NAME"
printf "${D}  slug %s · bundle %s · scheme %s://${N}\n" "$SLUG" "$BUNDLE" "$SCHEME"
printf "${D}  → %s${N}\n\n" "$DEST"

cp -R "$TEMPLATE" "$DEST"

# Pin the Anthropic SDK to whatever is current at scaffold time rather than to
# a version guessed months ago. Unpinned is a last resort — Deno resolves it
# fresh on every cold start, so two deploys can run different code.
SDK_PIN=""
if command -v npm >/dev/null 2>&1; then
  V="$(npm view @anthropic-ai/sdk version 2>/dev/null || true)"
  [ -n "$V" ] && SDK_PIN="@^$V"
fi
if [ -z "$SDK_PIN" ]; then
  printf "${Y}  ▲ could not reach npm — @anthropic-ai/sdk left unpinned in _shared/anthropic.ts${N}\n"
fi

export APP_NAME SLUG BUNDLE SCHEME SDK_PIN
find "$DEST" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.json' \
  -o -name '*.sql' -o -name '*.toml' -o -name '*.md' -o -name '*.example' \) -print0 \
| xargs -0 perl -pi -e '
    s/__APP_NAME__/$ENV{APP_NAME}/g;
    s/__APP_SLUG__/$ENV{SLUG}/g;
    s/__BUNDLE_ID__/$ENV{BUNDLE}/g;
    s/__SCHEME__/$ENV{SCHEME}/g;
    s/__ANTHROPIC_SDK_PIN__/$ENV{SDK_PIN}/g;
  '

cp "$DEST/.env.example" "$DEST/.env"
cp "$DEST/supabase/functions/.env.example" "$DEST/supabase/functions/.env"

# App Store Connect identifiers live on the machine, never in this repo — the
# key id and issuer id are account-level and this template is publishable.
# asc.mjs reads the same file. eas submit wants a local copy of the .p8; *.p8 is
# gitignored, so the copy never leaves the machine.
ASC_CONFIG="${ASC_CONFIG:-$HOME/.appstoreconnect/config.json}"
mkdir -p "$DEST/credentials"
if [ -f "$ASC_CONFIG" ] && command -v python3 >/dev/null 2>&1; then
  python3 - "$ASC_CONFIG" "$DEST" <<'PYEOF'
import json, os, shutil, sys

cfg_path, dest = sys.argv[1], sys.argv[2]
try:
    cfg = json.load(open(cfg_path))
except Exception as e:
    print(f"  \u25b2 {cfg_path} is not valid JSON ({e}) — eas.json submit block left empty")
    raise SystemExit(0)

key_id, issuer = cfg.get("keyId"), cfg.get("issuerId")
key_path = os.path.expanduser(cfg.get("keyPath") or "")
if not (key_id and issuer):
    print(f"  \u25b2 keyId/issuerId missing from {cfg_path} — eas.json submit block left empty")
    raise SystemExit(0)

if key_path and os.path.isfile(key_path):
    target = os.path.join(dest, "credentials", "asc-api-key.p8")
    shutil.copyfile(key_path, target)
    os.chmod(target, 0o600)
else:
    print(f"  \u25b2 no ASC private key at {key_path or '(keyPath unset)'} — eas submit will need one")

eas_path = os.path.join(dest, "eas.json")
eas = json.load(open(eas_path))
eas.setdefault("submit", {}).setdefault("production", {})["ios"] = {
    "ascApiKeyPath": "./credentials/asc-api-key.p8",
    "ascApiKeyId": key_id,
    "ascApiKeyIssuerId": issuer,
}
json.dump(eas, open(eas_path, "w"), indent=2)
open(eas_path, "a").write("\n")
print(f"  \u2713 App Store Connect wired from {cfg_path} (key {key_id})")
PYEOF
else
  printf "${D}  · no %s — fill eas.json submit.production.ios yourself, or see README${N}\n" "$ASC_CONFIG"
fi

# The spec is the contract every later stage reads. /app-spec writes it before
# the app directory exists, so it gets carried in here.
mkdir -p "$DEST/docs"
if [ -n "$SPEC" ]; then
  [ -f "$SPEC" ] || die "no spec at $SPEC"
  cp "$SPEC" "$DEST/docs/spec.json"
  if node "$FACTORY/scripts/spec-lint.mjs" "$DEST/docs/spec.json" >/dev/null 2>&1; then
    printf "${G}  ✓ spec copied to docs/spec.json — lint clean${N}\n"
  else
    printf "${Y}  ▲ spec copied to docs/spec.json but spec-lint is not clean — run: npm run spec${N}\n"
  fi
fi

if command -v git >/dev/null 2>&1; then
  git -C "$DEST" init -q
  git -C "$DEST" add -A
  # Uses the machine's global git identity — nothing hardcoded here.
  git -C "$DEST" commit -qm "Scaffold $APP_NAME from app-factory template" || true
fi

if [ "$INSTALL" = 1 ]; then
  printf "${D}  installing dependencies…${N}\n"
  (cd "$DEST" && npm install --silent) || printf "${Y}  ▲ npm install failed — run it yourself${N}\n"
fi

printf "\n${B}preflight${N}\n"
bash "$FACTORY/scripts/preflight.sh" "$DEST" || true

cat <<EOS
${B}Next${N}
  ${B}/app-backend${N}  docs/spec.json → migrations, edge functions, a real Supabase
                project in eu-central-1, types and typed api.ts methods
  ${B}/app-design${N}   a canvas you edit by hand, then the screens
  ${B}/app-assets${N}   drop a 1024x1024 icon.png in assets/, then screenshots
  ${B}/aso-listing${N}  store/de-DE.md from real Astro numbers → npm run aso
  ${B}/asc-push${N}     everything up to App Store Connect over the API

  ${D}or /app-forge to run the chain with the gates and checkpoints in it${N}

${B}Only you can do these${N}
  · create the app record in App Store Connect, then put its id in eas.json
    as ascAppId ${D}(the API cannot create it)${N}
  · in the Supabase dashboard: email confirmations ON, min password length 8
    ${D}(config.toml does not configure the hosted project)${N}
  · eas init on the first build ${D}(it writes extra.eas.projectId itself)${N}

  ${D}cd "$DEST" && npm install && npm run check${N}

EOS
