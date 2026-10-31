#!/usr/bin/env bash
# Deploy the Scorched Tanks Worker (relay + landing page + browser game + APK download).
#
# Usage (from anywhere):
#   ./server/deploy.sh --dry-run            # build the upload bundle, print it, touch no network
#   CF_API_TOKEN=... ./server/deploy.sh     # upload, then verify /health reports APP_VER
#
# Optional env: CF_ACCOUNT_ID, WORKER_NAME (scorched-tanks),
#   WORKER_URL (https://scorched-tanks.yishai-k.workers.dev), CF_API_BASE,
#   HEALTH_RETRIES (6), HEALTH_DELAY seconds (5), APKSIGNER_JAR (enables the APK signer check).
# Exit codes: 0 ok, 2 bad input/preflight, 3 Cloudflare rejected the upload, 4 post-deploy check failed.
# See docs/RELEASE-SAFETY.md for the staging/rollback procedure.
set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "deploy: unknown argument: $arg" >&2; exit 2 ;;
  esac
done

ACCOUNT="${CF_ACCOUNT_ID:-0f6475716c1a85bfa0a5956792e85b52}"
WORKER_NAME="${WORKER_NAME:-scorched-tanks}"
WORKER_URL="${WORKER_URL:-https://scorched-tanks.yishai-k.workers.dev}"
CF_API_BASE="${CF_API_BASE:-https://api.cloudflare.com/client/v4}"
HEALTH_RETRIES="${HEALTH_RETRIES:-6}"
HEALTH_DELAY="${HEALTH_DELAY:-5}"
EXPECTED_CERT_SHA256='0b239ed6b6e3c74f05ec3bc6e46a66d93deb779b62d80146899e930cbb7f6d98'

die() { local code="$1"; shift; printf 'deploy: %s\n' "$*" >&2; exit "$code"; }
cd "$(dirname "$0")"

# ---- preflight (no network) ----
for f in worker.js meta-update.json inline_assets.py ../landing/index.html ../game/index.html ../apk/ScorchedTanks.apk; do
  [[ -f "$f" ]] || die 2 "missing $f"
done
APP_VER="$(sed -n 's/^const APP_VER = "\([^"]*\)".*/\1/p' worker.js | head -n1)"
[[ -n "$APP_VER" ]] || die 2 'could not read APP_VER from worker.js'
GAME_VER="$(sed -n 's/.*const GAME_VER = "\([^"]*\)".*/\1/p' ../game/index.html | head -n1)"
[[ "$GAME_VER" == "$APP_VER" ]] || die 2 "GAME_VER ($GAME_VER) in game/index.html != APP_VER ($APP_VER) in worker.js"
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' meta-update.json || die 2 'meta-update.json is not valid JSON'
if command -v node >/dev/null 2>&1; then
  tmpjs="$(mktemp --suffix=.mjs)"; cp worker.js "$tmpjs"
  node --check "$tmpjs" || { rm -f "$tmpjs"; die 2 'worker.js has a syntax error'; }
  rm -f "$tmpjs"
fi
if command -v aapt >/dev/null 2>&1; then
  apk_name="$(aapt dump badging ../apk/ScorchedTanks.apk | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -n1)"
  [[ "$apk_name" == "$APP_VER" ]] || die 2 "apk/ScorchedTanks.apk versionName ($apk_name) != APP_VER ($APP_VER)"
else
  echo 'deploy: note: aapt not found, APK versionName check skipped' >&2
fi
if [[ -n "${APKSIGNER_JAR:-}" ]]; then
  fp="$(java -jar "$APKSIGNER_JAR" verify --print-certs ../apk/ScorchedTanks.apk | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -n1)"
  [[ "$fp" == "$EXPECTED_CERT_SHA256" ]] || die 2 "APK signer $fp is not the production signer"
fi

STAGE="$(mktemp -d)"
trap 'rm -rf -- "$STAGE"' EXIT
cp ../landing/index.html "$STAGE/landing.txt"
python3 inline_assets.py ../game "$STAGE/game.txt" >/dev/null   # inlines hark.css/hark-hero.css/hark.js so /play matches the APK
cp ../apk/ScorchedTanks.apk "$STAGE/app.apk.bin"
cp worker.js meta-update.json "$STAGE/"

echo "Target: worker '$WORKER_NAME' (account $ACCOUNT) -> $WORKER_URL, APP_VER $APP_VER"
( cd "$STAGE" && for f in worker.js meta-update.json landing.txt game.txt app.apk.bin; do
    printf '  %-16s %9s bytes  sha256 %s\n' "$f" "$(wc -c <"$f")" "$(sha256sum "$f" | cut -c1-16)"
  done )
if (( DRY_RUN )); then
  echo 'DRY RUN: nothing uploaded, no network calls made.'
  exit 0
fi
[[ -n "${CF_API_TOKEN:-}" ]] || die 2 'CF_API_TOKEN is not set'

# ---- record what is live now (for rollback) ----
prev="$(curl -sS --max-time 15 "$WORKER_URL/health" 2>/dev/null || true)"
echo "Before deploy, /health: ${prev:-<unreachable>}"

# ---- upload ----
resp="$STAGE/cf-response.json"
http_code="$(curl -sS --max-time 120 -o "$resp" -w '%{http_code}' -X PUT \
  "$CF_API_BASE/accounts/$ACCOUNT/workers/scripts/$WORKER_NAME" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -F "metadata=@$STAGE/meta-update.json;type=application/json" \
  -F "worker.js=@$STAGE/worker.js;filename=worker.js;type=application/javascript+module" \
  -F "landing.txt=@$STAGE/landing.txt;filename=landing.txt;type=text/plain" \
  -F "game.txt=@$STAGE/game.txt;filename=game.txt;type=text/plain" \
  -F "app.apk.bin=@$STAGE/app.apk.bin;filename=app.apk.bin;type=application/octet-stream")" \
  || die 3 "upload request failed (curl exit $?)"
summary="$(python3 - "$resp" "$http_code" <<'PY'
import json, sys
path, code = sys.argv[1], sys.argv[2]
try:
    body = json.load(open(path))
except Exception as e:
    print(f"HTTP {code}: response is not JSON ({e})"); sys.exit(1)
if not isinstance(body, dict) or body.get("success") is not True:
    errs = body.get("errors") if isinstance(body, dict) else None
    print(f"HTTP {code}: success != true; errors={json.dumps(errs)}"); sys.exit(1)
if not code.startswith("2"):
    print(f"HTTP {code} despite success=true"); sys.exit(1)
r = body.get("result") or {}
print(f"HTTP {code}: success; id={r.get('id')} etag={r.get('etag')} modified_on={r.get('modified_on')}")
PY
)" || die 3 "Cloudflare rejected the upload: $summary"
echo "Cloudflare: $summary"

# ---- post-deploy verification ----
for ((i = 1; i <= HEALTH_RETRIES; i++)); do
  health="$(curl -sS --max-time 15 "$WORKER_URL/health" 2>/dev/null || true)"
  if python3 -c 'import json,sys; h=json.loads(sys.argv[1]); sys.exit(0 if h.get("ok") is True and h.get("app")==sys.argv[2] else 1)' "$health" "$APP_VER" 2>/dev/null; then
    echo "Verified: /health reports app $APP_VER: $health"
    exit 0
  fi
  (( i < HEALTH_RETRIES )) && sleep "$HEALTH_DELAY"
done
die 4 "post-deploy check failed: /health returned '${health:-<nothing>}', expected ok=true app=$APP_VER. Previous /health: ${prev:-<unknown>}. Roll back from the Cloudflare dashboard (Workers > $WORKER_NAME > Deployments) or redeploy the previous commit."
