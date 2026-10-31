#!/usr/bin/env bash
# Portable legacy (aapt/d8) Android packaging. See docs/ANDROID-BUILD.md.
set -euo pipefail

usage() {
  cat <<'HELP'
Usage (release):  VC=16 KS_PASS=... KEYSTORE_PATH=/secure/release.jks ./build.sh
Usage (dev only): tools/android/build-dev-apk.sh   (throwaway key, never a release)

Required: VC, KS_PASS, KEYSTORE_PATH (an existing keystore), Android SDK tools.
Optional: BUILD_HOME (default .android-build/), ANDROID_JAR, D8_JAR,
          APKSIGNER_JAR, APK_OUT, KS_ALIAS (default st), VERSION_NAME (default 1.$VC),
          TARGET_SDK (default 28, the published value), MIN_SDK (default 24),
          EXPECTED_CERT_SHA256 (default: production signer, see assetlinks.json),
          PREVIOUS_APK (default apk/ScorchedTanks.apk) for the versionCode check,
          ALLOW_SAME_VERSION_CODE=1 to rebuild an already published versionCode.
Release checks (all fail closed): keystore exists, signer SHA-256 equals
EXPECTED_CERT_SHA256, VC is not lower than PREVIOUS_APK (and not equal unless
ALLOW_SAME_VERSION_CODE=1), VERSION_NAME equals GAME_VER in game/index.html,
packaged assets are byte-identical to game/.
The script never generates a signing key and never deploys anything.
HELP
}
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then usage; exit 0; fi

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GAME_DIR="$ROOT/game"
ANDROID_DIR="$ROOT/android"
BUILD_HOME="${BUILD_HOME:-$ROOT/.android-build}"
ANDROID_JAR="${ANDROID_JAR:-$BUILD_HOME/p/android-34/android.jar}"
KEYSTORE_PATH="${KEYSTORE_PATH:-}"
APK_OUT="${APK_OUT:-$BUILD_HOME/out/ScorchedTanks.apk}"
KS_ALIAS="${KS_ALIAS:-st}"
VC="${VC:-}"
VERSION_NAME="${VERSION_NAME:-1.$VC}"
TARGET_SDK="${TARGET_SDK:-28}"
MIN_SDK="${MIN_SDK:-24}"
# Production signer. Must match sha256_cert_fingerprints in server/worker.js (assetlinks.json).
PROD_CERT_SHA256='0B:23:9E:D6:B6:E3:C7:4F:05:EC:3B:C6:E4:6A:66:D9:3D:EB:77:9B:62:D8:01:46:89:9E:93:0C:BB:7F:6D:98'
EXPECTED_CERT_SHA256="${EXPECTED_CERT_SHA256:-$PROD_CERT_SHA256}"
PREVIOUS_APK="${PREVIOUS_APK-$ROOT/apk/ScorchedTanks.apk}"
# Set only by tools/android/build-dev-apk.sh: skips release-only policy checks.
DEV_BUILD="${SCORCHED_DEV_BUILD:-0}"

fail() { printf 'Android build: %s\n' "$*" >&2; exit 2; }
# Like fail, but first deletes the APK (and its v4 .idsig) so a rejected artifact cannot be shipped.
reject() { rm -f -- "$APK_OUT" "$APK_OUT.idsig"; fail "$@"; }
norm_fp() { tr -d ': \n' <<<"$1" | tr '[:upper:]' '[:lower:]'; }

[[ "$VC" =~ ^[1-9][0-9]*$ ]] || fail 'Set VC to a positive Android versionCode (e.g. VC=16).'
[[ "$VERSION_NAME" =~ ^[[:alnum:]._-]+$ ]] || fail 'VERSION_NAME contains unsupported characters.'
[[ "$TARGET_SDK" =~ ^[1-9][0-9]*$ && "$MIN_SDK" =~ ^[1-9][0-9]*$ ]] || fail 'TARGET_SDK/MIN_SDK must be integers.'
[[ -n "$KEYSTORE_PATH" ]] || fail 'Set KEYSTORE_PATH to the existing release keystore (no default; refusing to generate a new key).'
[[ -n "${KS_PASS:-}" ]] || fail 'Set KS_PASS securely (never commit it).'
[[ -f "$KEYSTORE_PATH" ]] || fail "Signing key is missing at $KEYSTORE_PATH; refusing to generate a new key."
[[ -f "$GAME_DIR/index.html" ]] || fail 'Missing game/index.html.'
[[ -f "$ANDROID_DIR/app/src/main/AndroidManifest.xml" ]] || fail 'Missing AndroidManifest.xml.'

if [[ "$DEV_BUILD" != 1 ]]; then
  [[ "$(norm_fp "$EXPECTED_CERT_SHA256")" =~ ^[0-9a-f]{64}$ ]] || fail 'EXPECTED_CERT_SHA256 must be a SHA-256 fingerprint.'
  game_ver="$(sed -n 's/.*const GAME_VER = "\([^"]*\)".*/\1/p' "$GAME_DIR/index.html" | head -n1)"
  [[ "$VERSION_NAME" == "$game_ver" ]] || fail "VERSION_NAME $VERSION_NAME does not match GAME_VER $game_ver in game/index.html."
fi

[[ -f "$ANDROID_JAR" ]] || fail "Missing Android platform jar: $ANDROID_JAR (set ANDROID_JAR)."
find_jar() {
  local name="$1" root
  for root in "$BUILD_HOME/b" "$BUILD_HOME"/b/*; do
    if [[ -f "$root/lib/$name" ]]; then printf '%s\n' "$root/lib/$name"; return 0; fi
  done
  return 1
}
D8_JAR="${D8_JAR:-$(find_jar d8.jar || true)}"
APKSIGNER_JAR="${APKSIGNER_JAR:-$(find_jar apksigner.jar || true)}"
[[ -f "$D8_JAR" ]] || fail 'Missing d8.jar (set D8_JAR).'
[[ -f "$APKSIGNER_JAR" ]] || fail 'Missing apksigner.jar (set APKSIGNER_JAR).'
for program in aapt javac java zipalign unzip cmp mktemp; do
  command -v "$program" >/dev/null 2>&1 || fail "Missing required executable: $program"
done

# Monotonic versionCode against the last published APK (release builds only).
if [[ "$DEV_BUILD" != 1 && -n "$PREVIOUS_APK" ]]; then
  [[ -f "$PREVIOUS_APK" ]] || fail "PREVIOUS_APK not found: $PREVIOUS_APK (set PREVIOUS_APK= to skip deliberately)."
  prev_vc="$(aapt dump badging "$PREVIOUS_APK" | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" | head -n1)"
  [[ -n "$prev_vc" ]] || fail "Could not read versionCode from $PREVIOUS_APK."
  if (( VC < prev_vc )); then fail "VC=$VC is lower than the published versionCode $prev_vc; Android would refuse the update."; fi
  if (( VC == prev_vc )) && [[ "${ALLOW_SAME_VERSION_CODE:-0}" != 1 ]]; then
    fail "VC=$VC equals the published versionCode; bump VC (or ALLOW_SAME_VERSION_CODE=1 for a rebuild)."
  fi
fi

mkdir -p "$BUILD_HOME" "$(dirname -- "$APK_OUT")"
WORK="$(mktemp -d "$BUILD_HOME/tmp.XXXXXXXX")"
trap 'rm -rf -- "$WORK"' EXIT
mkdir -p "$WORK/gen" "$WORK/classes" "$WORK/dex" "$WORK/assets"

# Copy only assets from this checkout. Never package files from a previous build.
shopt -s nullglob
assets=("$GAME_DIR"/*.html "$GAME_DIR"/*.css "$GAME_DIR"/*.js)
shopt -u nullglob
(( ${#assets[@]} > 0 )) || fail 'No game assets found.'
cp -- "${assets[@]}" "$WORK/assets/"

MANIFEST="$ANDROID_DIR/app/src/main/AndroidManifest.xml"
MARKER='<manifest xmlns:android="http://schemas.android.com/apk/res/android">'
grep -Fq "$MARKER" "$MANIFEST" || fail 'Android manifest has an unexpected format.'
sed "s@${MARKER}@<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" package=\"com.yishai.scorchedtanks\" android:versionCode=\"$VC\" android:versionName=\"$VERSION_NAME\">@" "$MANIFEST" > "$WORK/AndroidManifest.xml"

aapt package -f -m -J "$WORK/gen" -M "$WORK/AndroidManifest.xml" -S "$ANDROID_DIR/app/src/main/res" -I "$ANDROID_JAR" --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK"
javac -nowarn --release 11 -cp "$ANDROID_JAR" -d "$WORK/classes" \
  "$WORK/gen/com/yishai/scorchedtanks/R.java" \
  "$ANDROID_DIR/app/src/main/java/com/yishai/scorchedtanks/MainActivity.java"

classes=()
while IFS= read -r -d '' class; do classes+=("$class"); done < <(find "$WORK/classes" -name '*.class' -print0)
(( ${#classes[@]} > 0 )) || fail 'No compiled Java classes.'
java -cp "$D8_JAR" com.android.tools.r8.D8 --release --min-api "$MIN_SDK" --lib "$ANDROID_JAR" --output "$WORK/dex" "${classes[@]}"
aapt package -f -M "$WORK/AndroidManifest.xml" -S "$ANDROID_DIR/app/src/main/res" -A "$WORK/assets" -I "$ANDROID_JAR" --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK" -F "$WORK/unsigned.apk"
( cd "$WORK/dex" && aapt add "$WORK/unsigned.apk" classes.dex >/dev/null )
zipalign -f 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"
rm -f -- "$APK_OUT" "$APK_OUT.idsig"
java -jar "$APKSIGNER_JAR" sign --ks "$KEYSTORE_PATH" --ks-pass env:KS_PASS --key-pass env:KS_PASS --ks-key-alias "$KS_ALIAS" --out "$APK_OUT" "$WORK/aligned.apk"
certs="$(java -jar "$APKSIGNER_JAR" verify --verbose --print-certs "$APK_OUT" 2>/dev/null)" || reject 'apksigner verify failed.'
printf '%s\n' "$certs" | grep -E '^Verified using|^Signer #1 certificate (DN|SHA-256)'
actual_fp="$(printf '%s\n' "$certs" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -n1)"
[[ -n "$actual_fp" ]] || reject 'Could not read signer certificate digest.'
if [[ "$DEV_BUILD" != 1 && "$(norm_fp "$actual_fp")" != "$(norm_fp "$EXPECTED_CERT_SHA256")" ]]; then
  reject "Signer SHA-256 $actual_fp does not match EXPECTED_CERT_SHA256; APK removed (wrong key would break upgrades and assetlinks)."
fi

# Verify the APK contains byte-for-byte source assets from this checkout, and nothing else.
expected_list="$(for src in "${assets[@]}"; do printf 'assets/%s\n' "$(basename -- "$src")"; done | sort)"
actual_list="$(unzip -Z1 "$APK_OUT" | grep '^assets/' | sort)"
[[ "$expected_list" == "$actual_list" ]] || reject "Packaged asset list differs from game/: $(diff <(echo "$expected_list") <(echo "$actual_list") | tr '\n' ' ')"
for src in "${assets[@]}"; do
  unzip -p "$APK_OUT" "assets/$(basename -- "$src")" | cmp -s - "$src" || reject "Packaged asset differs: $(basename -- "$src")"
done
badging="$(aapt dump badging "$APK_OUT" | sed -n '1p;/targetSdkVersion/p')"
printf '%s\n' "$badging"
[[ "$badging" == *"versionCode='$VC'"* && "$badging" == *"versionName='$VERSION_NAME'"* ]] || fail 'APK version metadata mismatch.'
printf 'Verified APK (%s assets byte-identical to game/, signer %s): %s\n' "${#assets[@]}" "$actual_fp" "$APK_OUT"
[[ "$DEV_BUILD" == 1 ]] && printf 'DEV BUILD: throwaway signer, not for release or upload.\n'
exit 0
