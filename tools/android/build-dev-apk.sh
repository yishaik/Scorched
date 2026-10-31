#!/usr/bin/env bash
# DEVELOPMENT / CI ONLY: build the APK with a throwaway key generated in a temp dir.
# The output is named ScorchedTanks-DEV.apk, is signed by a random key that is
# deleted afterwards, and must never be published, uploaded or deployed.
# Same toolchain variables as build.sh (ANDROID_JAR, D8_JAR, APKSIGNER_JAR, BUILD_HOME, VC).
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
command -v keytool >/dev/null 2>&1 || { echo 'build-dev-apk: keytool (JDK) is required' >&2; exit 2; }
game_ver="$(sed -n 's/.*const GAME_VER = "\([^"]*\)".*/\1/p' "$ROOT/game/index.html" | head -n1)"
VC="${VC:-${game_ver##*.}}"
[[ "$VC" =~ ^[1-9][0-9]*$ ]] || VC=1
KEYDIR="$(mktemp -d)"
trap 'rm -rf -- "$KEYDIR"' EXIT
KS_PASS="dev-$(od -An -N8 -tx8 /dev/urandom | tr -d ' ')"
export KS_PASS
keytool -genkeypair -keystore "$KEYDIR/dev.jks" -storepass:env KS_PASS -keypass:env KS_PASS \
  -alias dev -keyalg RSA -keysize 2048 -validity 2 -dname "CN=Scorched Tanks DEV - NOT FOR RELEASE" >/dev/null 2>&1
BUILD_HOME="${BUILD_HOME:-$ROOT/.android-build}"
SCORCHED_DEV_BUILD=1 VC="$VC" VERSION_NAME="${VERSION_NAME:-$game_ver}" KS_ALIAS=dev \
  KEYSTORE_PATH="$KEYDIR/dev.jks" BUILD_HOME="$BUILD_HOME" \
  APK_OUT="${APK_OUT:-$BUILD_HOME/out/ScorchedTanks-DEV.apk}" bash "$ROOT/build.sh"
