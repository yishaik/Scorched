#!/usr/bin/env bash
# Safe static and negative-path checks; does not require Android SDK or keystore.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash -n "$ROOT/build.sh"
help=$("$ROOT/build.sh" --help)
[[ "$help" == *"KEYSTORE_PATH"* ]]
if grep -Eq '/workspace/|keytool[[:space:]]+-genkeypair' "$ROOT/build.sh"; then
  echo 'Legacy absolute paths or silent key generation detected' >&2
  exit 1
fi
out="$(mktemp -d)"
trap 'rm -rf -- "$out"' EXIT
if VC=16 KS_PASS=temporary-test-value KEYSTORE_PATH="$out/missing.jks" "$ROOT/build.sh" >"$out/stdout" 2>"$out/stderr"; then
  echo 'Build unexpectedly accepted a missing signing keystore' >&2
  exit 1
fi
grep -Fq 'refusing to generate a new key' "$out/stderr"
[[ ! -f "$out/missing.jks" ]]
if VC=abc KS_PASS=temporary-test-value KEYSTORE_PATH="$out/missing.jks" "$ROOT/build.sh" >"$out/stdout" 2>"$out/stderr"; then
  echo 'Build unexpectedly accepted invalid versionCode' >&2
  exit 1
fi
grep -Fq 'positive Android versionCode' "$out/stderr"
echo 'PASS: build script syntax, portable paths, missing key fails closed, invalid VC rejected'
