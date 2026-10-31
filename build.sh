#!/usr/bin/env bash
# Portable legacy (aapt/d8) Android packaging. See docs/ANDROID-BUILD.md.
set -euo pipefail

if [[ "${1:-}" == "--help" ]]; then
  cat <<'HELP'
Usage: VC=16 KS_PASS=... KEYSTORE_PATH=/secure/release.jks ./build.sh

Required: VC, KS_PASS, KEYSTORE_PATH (existing keystore), Android SDK tools.
Optional: BUILD_HOME (default .android-build/), ANDROID_JAR, D8_JAR,
          APKSIGNER_JAR, APK_OUT, KS_ALIAS (default st), VERSION_NAME.
The script never generates a signing key or deploys anything.
HELP
  exit 0
fi

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GAME_DIR="$ROOT/game"
ANDROID_DIR="$ROOT/android"
BUILD_HOME="${BUILD_HOME:-$ROOT/.android-build}"
ANDROID_JAR="${ANDROID_JAR:-$BUILD_HOME/p/android-34/android.jar}"
KEYSTORE_PATH="${KEYSTORE_PATH:-$BUILD_HOME/key.jks}"
APK_OUT="${APK_OUT:-$BUILD_HOME/out/ScorchedTanks.apk}"
KS_ALIAS="${KS_ALIAS:-st}"
VC="${VC:-}"
VERSION_NAME="${VERSION_NAME:-1.$VC}"

fail() { printf 'Android build: %s\n' "$*" >&2; exit 2; }
[[ "$VC" =~ ^[1-9][0-9]*$ ]] || fail 'Set VC to a positive Android versionCode (e.g. VC=16).'
[[ "$VERSION_NAME" =~ ^[[:alnum:]._-]+$ ]] || fail 'VERSION_NAME contains unsupported characters.'
[[ -n "${KS_PASS:-}" ]] || fail 'Set KS_PASS securely (never commit it).'
[[ -f "$KEYSTORE_PATH" ]] || fail "Signing key is missing at $KEYSTORE_PATH; refusing to generate a new key."
[[ -f "$GAME_DIR/index.html" ]] || fail 'Missing game/index.html.'
[[ -f "$ANDROID_DIR/app/src/main/AndroidManifest.xml" ]] || fail 'Missing AndroidManifest.xml.'
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

mkdir -p "$BUILD_HOME" "$(dirname -- "$APK_OUT")"
WORK="$(mktemp -d "$BUILD_HOME/tmp.XXXXXXXX")"
trap 'rm -rf -- "$WORK"' EXIT
mkdir -p "$WORK/gen" "$WORK/classes" "$WORK/dex" "$WORK/assets"

# Copy only assets from this checkout. Never package files from a previous build.
for src in "$GAME_DIR"/*.html "$GAME_DIR"/*.css "$GAME_DIR"/*.js; do
  [[ -f "$src" ]] && cp -- "$src" "$WORK/assets/"
done

MANIFEST="$ANDROID_DIR/app/src/main/AndroidManifest.xml"
MARKER='<manifest xmlns:android="http://schemas.android.com/apk/res/android">'
grep -Fq "$MARKER" "$MANIFEST" || fail 'Android manifest has an unexpected format.'
sed "s@${MARKER}@<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" package=\"com.yishai.scorchedtanks\" android:versionCode=\"$VC\" android:versionName=\"$VERSION_NAME\">@" "$MANIFEST" > "$WORK/AndroidManifest.xml"

aapt package -f -m -J "$WORK/gen" -M "$WORK/AndroidManifest.xml" -S "$ANDROID_DIR/app/src/main/res" -I "$ANDROID_JAR" --min-sdk-version 24 --target-sdk-version 28
javac -nowarn --release 11 -cp "$ANDROID_JAR" -d "$WORK/classes" \
  "$WORK/gen/com/yishai/scorchedtanks/R.java" \
  "$ANDROID_DIR/app/src/main/java/com/yishai/scorchedtanks/MainActivity.java"

classes=()
while IFS= read -r -d '' class; do classes+=("$class"); done < <(find "$WORK/classes" -name '*.class' -print0)
(( ${#classes[@]} > 0 )) || fail 'No compiled Java classes.'
java -cp "$D8_JAR" com.android.tools.r8.D8 --release --min-api 24 --lib "$ANDROID_JAR" --output "$WORK/dex" "${classes[@]}"
aapt package -f -M "$WORK/AndroidManifest.xml" -S "$ANDROID_DIR/app/src/main/res" -A "$WORK/assets" -I "$ANDROID_JAR" --min-sdk-version 24 --target-sdk-version 28 -F "$WORK/unsigned.apk"
( cd "$WORK/dex" && aapt add "$WORK/unsigned.apk" classes.dex >/dev/null )
zipalign -f 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"
java -jar "$APKSIGNER_JAR" sign --ks "$KEYSTORE_PATH" --ks-pass env:KS_PASS --key-pass env:KS_PASS --ks-key-alias "$KS_ALIAS" --out "$APK_OUT" "$WORK/aligned.apk"
java -jar "$APKSIGNER_JAR" verify --print-certs "$APK_OUT"

# Verify the APK contains byte-for-byte source assets from this checkout.
for src in "$GAME_DIR"/*.html "$GAME_DIR"/*.css "$GAME_DIR"/*.js; do
  [[ -f "$src" ]] || continue
  unzip -p "$APK_OUT" "assets/$(basename -- "$src")" | cmp - "$src" || fail "Packaged asset differs: $(basename -- "$src")"
done
printf 'Verified APK: %s\n' "$APK_OUT"
