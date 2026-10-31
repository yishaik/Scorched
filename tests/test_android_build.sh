#!/usr/bin/env bash
# build.sh checks. Part 1 needs no Android SDK or keystore.
# Part 2 runs only when the toolchain is present (ANDROID_JAR, D8_JAR, APKSIGNER_JAR, aapt,
# zipalign, keytool) and does a full DEV build with a throwaway key plus release-policy rejections.
# It never uses or needs the production keystore.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$(mktemp -d)"
trap 'rm -rf -- "$out"' EXIT
expect_fail() { # description, expected stderr fragment, env...
  local what="$1" frag="$2"; shift 2
  if env "$@" bash "$ROOT/build.sh" >"$out/stdout" 2>"$out/stderr"; then
    echo "FAIL: build accepted $what" >&2; exit 1
  fi
  grep -Fq "$frag" "$out/stderr" || { echo "FAIL: $what: unexpected error:" >&2; cat "$out/stderr" >&2; exit 1; }
  echo "ok - rejects $what"
}

bash -n "$ROOT/build.sh"
bash -n "$ROOT/tools/android/build-dev-apk.sh"
help=$(bash "$ROOT/build.sh" --help)
[[ "$help" == *"KEYSTORE_PATH"* && "$help" == *"EXPECTED_CERT_SHA256"* ]]
if grep -Eq '/workspace/|keytool[[:space:]]+-genkeypair' "$ROOT/build.sh"; then
  echo 'FAIL: legacy absolute paths or key generation in build.sh' >&2; exit 1
fi
# The production fingerprint pinned in build.sh must equal the one served in assetlinks.json.
fp_build="$(sed -n "s/^PROD_CERT_SHA256='\([^']*\)'.*/\1/p" "$ROOT/build.sh")"
grep -Fq "\"$fp_build\"" "$ROOT/server/worker.js" || { echo 'FAIL: build.sh signer != assetlinks fingerprint' >&2; exit 1; }
echo 'ok - signer fingerprint matches assetlinks.json'

GV="$(sed -n 's/.*const GAME_VER = "\([^"]*\)".*/\1/p' "$ROOT/game/index.html" | head -n1)"
touch "$out/placeholder.jks"
expect_fail 'missing keystore' 'refusing to generate a new key' VC=99 KS_PASS=t KEYSTORE_PATH="$out/missing.jks"
[[ ! -e "$out/missing.jks" ]] || { echo 'FAIL: a keystore was created' >&2; exit 1; }
expect_fail 'unset KEYSTORE_PATH' 'no default' VC=99 KS_PASS=t KEYSTORE_PATH=
expect_fail 'invalid versionCode' 'positive Android versionCode' VC=abc KS_PASS=t KEYSTORE_PATH="$out/placeholder.jks"
expect_fail 'missing password' 'KS_PASS' VC=99 KS_PASS= KEYSTORE_PATH="$out/placeholder.jks"
expect_fail 'versionName != GAME_VER' 'does not match GAME_VER' VC=99 VERSION_NAME=0.0 KS_PASS=t KEYSTORE_PATH="$out/placeholder.jks"
expect_fail 'malformed expected fingerprint' 'EXPECTED_CERT_SHA256' VC=99 VERSION_NAME="$GV" KS_PASS=t \
  KEYSTORE_PATH="$out/placeholder.jks" EXPECTED_CERT_SHA256=nope
echo 'PASS part 1: static and fail-closed checks'

have_tools=1
for v in ANDROID_JAR D8_JAR APKSIGNER_JAR; do [[ -f "${!v:-}" ]] || have_tools=0; done
for p in aapt zipalign keytool java javac; do command -v "$p" >/dev/null 2>&1 || have_tools=0; done
if (( ! have_tools )); then
  echo 'SKIP part 2: Android toolchain not configured (set ANDROID_JAR, D8_JAR, APKSIGNER_JAR)'
  exit 0
fi

# Full dev build with a throwaway key; build.sh itself verifies signature, asset bytes and metadata.
BUILD_HOME="$out/bh" APK_OUT="$out/dev.apk" bash "$ROOT/tools/android/build-dev-apk.sh" >"$out/dev.log" 2>&1 \
  || { cat "$out/dev.log" >&2; echo 'FAIL: dev build' >&2; exit 1; }
grep -q 'DEV BUILD' "$out/dev.log"
for f in "$ROOT"/game/*.html "$ROOT"/game/*.css "$ROOT"/game/*.js; do
  unzip -p "$out/dev.apk" "assets/$(basename "$f")" | cmp -s - "$f"
done
git -C "$ROOT" diff --quiet -- game android || { echo 'FAIL: build modified tracked sources' >&2; exit 1; }
echo 'ok - dev APK builds, verifies, assets byte-identical to game/'

# A non-production key must be rejected in release mode and leave no APK behind.
keytool -genkeypair -keystore "$out/other.jks" -storepass test-only -keypass test-only -alias st \
  -keyalg RSA -keysize 2048 -validity 2 -dname 'CN=wrong key test' >/dev/null 2>&1
PREV="$(aapt dump badging "$ROOT/apk/ScorchedTanks.apk" | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p")"
expect_fail 'non-production signer' 'does not match EXPECTED_CERT_SHA256' VC=$((PREV + 1)) VERSION_NAME="$GV" \
  KS_PASS=test-only KEYSTORE_PATH="$out/other.jks" BUILD_HOME="$out/bh" APK_OUT="$out/rel.apk"
[[ ! -e "$out/rel.apk" ]] || { echo 'FAIL: rejected APK left behind' >&2; exit 1; }
if (( PREV > 1 )); then
  expect_fail 'versionCode below published' 'lower than the published versionCode' VC=$((PREV - 1)) VERSION_NAME="$GV" \
    KS_PASS=test-only KEYSTORE_PATH="$out/other.jks" BUILD_HOME="$out/bh"
fi
expect_fail 'reused versionCode' 'equals the published versionCode' VC="$PREV" VERSION_NAME="$GV" \
  KS_PASS=test-only KEYSTORE_PATH="$out/other.jks" BUILD_HOME="$out/bh"
echo 'PASS part 2: real dev build and release-policy rejections'
