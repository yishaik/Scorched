#!/usr/bin/env bash
# One entry point for everything that runs in a plain Linux box without KVM or the Android SDK:
#   1. shell tests (build.sh fail-closed, deploy.sh with a fake curl, deploy.sh --dry-run)  — never deploys
#   2. node tests (versions, syntax, game logic, test-hook guard, store-gate rules, worker mocks)
#   3. Playwright browser E2E, Chromium, Pixel 7 portrait + landscape
#   4. two-client online E2E against server/worker.js run LOCALLY under wrangler dev   (skip: ST_ONLINE=0)
#   5. store gate on an AAB, only when one is given:  STORE_AAB=path BUNDLETOOL=jar [LAST_VC=16]
# The Android emulator job needs KVM and runs in GitHub Actions (see docs/CI.md).
# Usage: tests/run-all.sh [--quick]   (--quick: shell + node only)
# Exit code is non-zero when any part fails; a summary table is printed at the end.
set -uo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}" no_proxy="127.0.0.1,localhost${no_proxy:+,$no_proxy}"
QUICK=0; [ "${1:-}" = "--quick" ] && QUICK=1
declare -a NAMES=() RESULTS=()
step() {
  local name="$1"; shift
  printf '\n=== %s\n' "$name"
  if "$@"; then RESULTS+=("PASS"); else RESULTS+=("FAIL"); fi
  NAMES+=("$name")
}
skip() { NAMES+=("$1"); RESULTS+=("SKIP ($2)"); printf '\n=== %s: skipped (%s)\n' "$1" "$2"; }

shell_tests() {
  for f in build.sh server/deploy.sh tools/android/build-dev-apk.sh tests/*.sh tests/android/*.sh; do bash -n "$f" || return 1; done
  env -u ANDROID_JAR -u D8_JAR -u APKSIGNER_JAR bash tests/test_android_build.sh >/tmp/st-build.log 2>&1 || { tail -20 /tmp/st-build.log; return 1; }
  bash tests/test_deploy.sh >/tmp/st-deploy.log 2>&1 || { tail -20 /tmp/st-deploy.log; return 1; }
  bash server/deploy.sh --dry-run >/tmp/st-dry.log 2>&1 || { tail -20 /tmp/st-dry.log; return 1; }
  echo "shell tests ok"
}
node_tests() { node --test tests/node/*.test.mjs tests/*.test.mjs 2>&1 | grep -E '^# (tests|pass|fail)|^not ok' ; [ "${PIPESTATUS[0]}" -eq 0 ]; }

e2e_setup() {
  cd "$ROOT/tests/e2e" || return 1
  [ -d node_modules/@playwright/test ] || npm ci --no-audit --no-fund || return 1
  if [ -z "${PW_CHROMIUM_PATH:-}" ]; then
    # Playwright's own Chromium when it installs; otherwise a system Chromium (e.g. arm64 Linux has no Playwright build)
    if ! npx playwright install chromium >/tmp/st-pw-install.log 2>&1; then
      for c in /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome; do [ -x "$c" ] && export PW_CHROMIUM_PATH="$c" && break; done
      [ -n "${PW_CHROMIUM_PATH:-}" ] || { echo "no Chromium: install one (apt-get install chromium) or run 'npx playwright install --with-deps chromium'"; return 1; }
      echo "using system Chromium at $PW_CHROMIUM_PATH"
    fi
  fi
}
e2e() { (e2e_setup && cd "$ROOT/tests/e2e" && ST_ONLINE=0 npx playwright test --project=pixel7-portrait --project=pixel7-landscape --reporter=list); }
online() { (e2e_setup && cd "$ROOT/tests/e2e" && ST_ONLINE=1 npx playwright test --project=online --reporter=list); }
gate() { node tests/android/store-gate.mjs --aab "$STORE_AAB" --bundletool "$BUNDLETOOL" --last-vc "${LAST_VC:-16}"; }

step "shell tests" shell_tests
step "node tests" node_tests
if [ "$QUICK" = 1 ]; then skip "browser E2E" "--quick"; skip "online E2E" "--quick"
else
  step "browser E2E (Pixel 7 portrait + landscape)" e2e
  if [ "${ST_ONLINE:-1}" = "0" ]; then skip "online E2E" "ST_ONLINE=0"; else step "online E2E (local wrangler dev, 2 clients)" online; fi
fi
if [ -n "${STORE_AAB:-}" ] && [ -n "${BUNDLETOOL:-}" ]; then step "store gate" gate; else skip "store gate" "set STORE_AAB and BUNDLETOOL; runs in CI"; fi
skip "Android emulator" "needs KVM + Android SDK; runs in CI (android-emulator job)"

printf '\n%-48s %s\n' "PART" "RESULT"
rc=0
for i in "${!NAMES[@]}"; do printf '%-48s %s\n' "${NAMES[$i]}" "${RESULTS[$i]}"; [ "${RESULTS[$i]}" = "FAIL" ] && rc=1; done
[ -d tests/e2e/playwright-report ] && echo "Playwright report: tests/e2e/playwright-report/index.html; failure screenshots: tests/e2e/test-results/"
exit $rc
