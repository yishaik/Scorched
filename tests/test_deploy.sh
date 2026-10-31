#!/usr/bin/env bash
# server/deploy.sh tests with a fake `curl` on PATH. Never touches Cloudflare or the live Worker:
# the fake curl answers every request locally, and the URLs point at *.invalid hosts anyway.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf -- "$T"' EXIT
mkdir -p "$T/bin"
APP_VER="$(sed -n 's/^const APP_VER = "\([^"]*\)".*/\1/p' "$ROOT/server/worker.js" | head -n1)"

cat > "$T/bin/curl" <<'FAKE'
#!/usr/bin/env bash
# Fake curl: logs the call, writes FAKE_CF_BODY to -o for PUTs, prints FAKE_CF_CODE for -w,
# and prints FAKE_HEALTH for /health.
echo "curl $*" >> "$FAKE_LOG"
out="" url="" wfmt=""
while (( $# )); do
  case "$1" in
    -o) out="$2"; shift ;;
    -w) wfmt="$2"; shift ;;
    -H|-F|-X|--max-time) shift ;;
    http*) url="$1" ;;
  esac
  shift
done
case "$url" in
  */health) [[ "${FAKE_HEALTH_FAIL:-0}" == 1 ]] && exit 7; printf '%s' "${FAKE_HEALTH:-}" ;;
  *)
    [[ "${FAKE_CF_CURL_FAIL:-0}" == 1 ]] && exit 6
    [[ -n "$out" ]] && printf '%s' "${FAKE_CF_BODY:-}" > "$out"
    [[ -n "$wfmt" ]] && printf '%s' "${FAKE_CF_CODE:-200}" ;;
esac
exit 0
FAKE
chmod +x "$T/bin/curl"

pass=0
run() { # name expected_exit [env...]
  local name="$1" want="$2"; shift 2
  : > "$T/log"
  set +e
  env PATH="$T/bin:$PATH" FAKE_LOG="$T/log" CF_API_BASE="https://cf.invalid/client/v4" \
      WORKER_URL="https://worker.invalid" HEALTH_RETRIES=2 HEALTH_DELAY=0 "$@" \
      bash "$ROOT/server/deploy.sh" ${DEPLOY_ARGS:-} >"$T/out" 2>"$T/err"
  local got=$?
  set -e
  if [[ "$got" != "$want" ]]; then
    echo "FAIL: $name: exit $got, expected $want"; cat "$T/out" "$T/err"; exit 1
  fi
  pass=$((pass + 1)); echo "ok - $name (exit $got)"
}
OKBODY='{"success":true,"errors":[],"result":{"id":"scorched-tanks","etag":"abc"}}'
HEALTH_OK="{\"ok\":true,\"game\":\"scorched-tanks\",\"v\":2,\"app\":\"$APP_VER\"}"

DEPLOY_ARGS=--dry-run run "dry run makes no network calls" 0
[[ ! -s "$T/log" ]] || { echo 'FAIL: dry run called curl'; exit 1; }
grep -q 'DRY RUN' "$T/out"
git -C "$ROOT" status --porcelain -- server | grep -Eq 'landing.txt|game.txt|app.apk.bin' && { echo 'FAIL: deploy left bundle files in server/'; exit 1; }

DEPLOY_ARGS=--bogus run "unknown flag rejected" 2
run "missing token fails before any upload" 2 CF_API_TOKEN=
grep -q 'CF_API_TOKEN' "$T/err"; [[ ! -s "$T/log" ]]
run "happy path verifies /health app version" 0 CF_API_TOKEN=t FAKE_CF_BODY="$OKBODY" FAKE_HEALTH="$HEALTH_OK"
grep -q "Verified: /health reports app $APP_VER" "$T/out"
run "Cloudflare success=false fails" 3 CF_API_TOKEN=t FAKE_CF_CODE=200 \
  FAKE_CF_BODY='{"success":false,"errors":[{"code":10021,"message":"Uncaught SyntaxError"}]}' FAKE_HEALTH="$HEALTH_OK"
grep -q '10021' "$T/err"
run "Cloudflare 403 fails" 3 CF_API_TOKEN=t FAKE_CF_CODE=403 \
  FAKE_CF_BODY='{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}'
run "Cloudflare non-JSON 502 fails" 3 CF_API_TOKEN=t FAKE_CF_CODE=502 FAKE_CF_BODY='<html>Bad gateway</html>'
run "Cloudflare empty body fails" 3 CF_API_TOKEN=t FAKE_CF_CODE=200 FAKE_CF_BODY=''
run "curl transport error fails" 3 CF_API_TOKEN=t FAKE_CF_CURL_FAIL=1
run "stale version on /health fails" 4 CF_API_TOKEN=t FAKE_CF_BODY="$OKBODY" \
  FAKE_HEALTH='{"ok":true,"game":"scorched-tanks","v":2,"app":"0.0-stale"}'
grep -q 'Roll back' "$T/err"
run "/health unreachable fails" 4 CF_API_TOKEN=t FAKE_CF_BODY="$OKBODY" FAKE_HEALTH_FAIL=1
grep -q "^curl .*https://cf.invalid/client/v4/accounts/.*/workers/scripts/scorched-tanks" "$T/log" || { echo 'FAIL: upload URL not overridable'; exit 1; }
if grep -q 'cloudflare.com\|workers.dev' "$T/log"; then echo 'FAIL: production URL contacted'; exit 1; fi
echo "PASS: $pass deploy.sh cases (fake curl, no network)"
