# Android APK: portable aapt/d8 build

`build.sh` is the **manual (non-Gradle) release path**: the one that produced the published `apk/ScorchedTanks.apk`. It packages only the files in `game/` from the current checkout and never generates a signing key. The Gradle project in `android/` is the second path; it is built in CI as a smoke test (see `.github/workflows/ci.yml`).

## Prerequisites

- Linux, Bash 4+, JDK 11+ (`java`, `javac`, `keytool`), `aapt`, `zipalign`, `unzip`, `cmp`.
  On Debian/Ubuntu: `apt-get install openjdk-21-jdk-headless aapt zipalign`.
- Android platform `android.jar` (API 34) and build-tools `d8.jar` + `apksigner.jar`, either from an Android SDK
  (`$ANDROID_HOME/platforms/android-34/android.jar`, `$ANDROID_HOME/build-tools/<ver>/lib/*.jar`) or from the
  standalone zips `platform-34-ext7_r03.zip` and `build-tools_r34-linux.zip` on dl.google.com
  (the build-tools jars are Java and run on aarch64 too).
- For a release: the **existing** production keystore and its password, kept outside the repo.

### Variables

| Variable | Description | Default |
|---|---|---|
| `VC` | Android versionCode | **required** |
| `KEYSTORE_PATH` | Existing release keystore | **required, no default** |
| `KS_PASS` | Store and key password (read through `env:`, never on the command line) | **required** |
| `KS_ALIAS` | Key alias | `st` |
| `VERSION_NAME` | versionName; must equal `GAME_VER` in `game/index.html` | `1.$VC` |
| `ANDROID_JAR` | Platform jar | `$BUILD_HOME/p/android-34/android.jar` |
| `D8_JAR`, `APKSIGNER_JAR` | Build-tools jars | found under `$BUILD_HOME/b/*/lib/` |
| `TARGET_SDK` / `MIN_SDK` | Manifest SDK levels | `28` / `24` (the published values) |
| `EXPECTED_CERT_SHA256` | Signer the APK must carry | production signer `0B:23:9E:…:7F:6D:98` (same as assetlinks.json) |
| `PREVIOUS_APK` | Published APK for the versionCode check | `apk/ScorchedTanks.apk` |
| `ALLOW_SAME_VERSION_CODE` | `1` to rebuild an already-published versionCode | unset |
| `BUILD_HOME` / `APK_OUT` | Work dir / output APK | `.android-build/` (gitignored) / `$BUILD_HOME/out/ScorchedTanks.apk` |

## Release build

```bash
VC=16 KEYSTORE_PATH=/secure/scorched-release.jks KS_PASS="$KS_PASS" \
  ANDROID_JAR=... D8_JAR=... APKSIGNER_JAR=... ./build.sh
```

Every check fails closed (exit 2, and a rejected APK is deleted):

1. keystore path set and the file exists; no key is ever generated;
2. `VERSION_NAME` equals `GAME_VER`;
3. `VC` is higher than the versionCode in `PREVIOUS_APK` (equal only with `ALLOW_SAME_VERSION_CODE=1`);
4. `apksigner verify` passes and the signer SHA-256 equals `EXPECTED_CERT_SHA256`;
5. the APK's `assets/` holds exactly the `game/*.html|css|js` files, byte-identical;
6. the APK's versionCode/versionName equal the requested ones.

The script does not copy the result into `apk/` and does not deploy. Promoting a build is a deliberate step:
copy the verified APK to `apk/ScorchedTanks.apk`, commit, then run `server/deploy.sh` (see `docs/RELEASE-SAFETY.md`).

## Development / CI build (throwaway key)

```bash
ANDROID_JAR=... D8_JAR=... APKSIGNER_JAR=... tools/android/build-dev-apk.sh
```

Generates a random key in a temp dir (deleted afterwards), skips the signer/versionCode release checks, and
writes `.android-build/out/ScorchedTanks-DEV.apk` with signer `CN=Scorched Tanks DEV - NOT FOR RELEASE`.
It cannot upgrade a store/published install and must never be published.

## Tests

```bash
bash tests/test_android_build.sh
```

Part 1 (no SDK needed): syntax, no absolute paths or key generation, pinned fingerprint equals assetlinks.json,
missing/unset keystore, bad versionCode, missing password, versionName mismatch.
Part 2 (runs when `ANDROID_JAR`, `D8_JAR`, `APKSIGNER_JAR` point at real files): full dev build and asset
byte check, then rejection of a non-production signer (and removal of its APK), a lower versionCode and a
reused versionCode.

## Verified (2026-10-31, aarch64 sandbox, OpenJDK 21, platform 34 ext7, build-tools 34)

- Release build with the production keystore, `VC=15 ALLOW_SAME_VERSION_CODE=1`: `apksigner verify` OK (v2+v3),
  signer SHA-256 `0b239ed6…bb7f6d98`, versionCode 15 / versionName 1.15 / targetSdk 28.
- `AndroidManifest.xml`, `classes.dex`, `resources.arsc` and the icon are byte-identical to the published
  `apk/ScorchedTanks.apk`; the 4 game assets equal `game/`. The published APK additionally carries four stale,
  unused files from an old build directory (`chart.js`, `datalabels.js`, `hark-charts.css`, `hark-charts.js`),
  which the new build no longer packages.

## Target SDK policy (decision for the owner)

The manual path keeps targetSdk 28 so the published, sideloaded APK behaves exactly as before. Google Play has
required **targetSdk 36** for new apps and app updates since 31 Aug 2026 (extensions end 1 Nov 2026; source:
https://support.google.com/googleplay/android-developer/answer/11926878). The Gradle project therefore targets
36; a Play upload should come from the Gradle build (or `TARGET_SDK=36` here, which also needs a matching
`android.jar`) after a device test, since edge-to-edge and WebView/file-access defaults changed after API 28.
