# Android APK: portable aapt/d8 build

This is the **legacy non-Gradle path** used by `build.sh`. It packages only source files from `game/` in the current checkout. It is separate from `android/app/build.gradle`, which is not yet aligned with the production release configuration (see issue #14).

## Prerequisites

- Linux with Bash 4+, JDK 11+ (`javac`, `java`), `aapt`, `zipalign`, `unzip`, `cmp`, `mktemp`.
- Android platform 34 `android.jar` and Android build-tools jars `d8.jar`, `apksigner.jar`.
- An **existing** trusted signing keystore and its alias/password. This script will not generate a new keystore. For isolated tests, generate an explicitly named disposable test keystore outside the repository and never publish the resulting APK as a release.

### Paths and settings

| Variable | Description | Default |
|---|---|---|
| `BUILD_HOME` | Toolchain and temp/output directory | `<repo>/.android-build` (gitignored) |
| `ANDROID_JAR` | Android SDK platform jar | `$BUILD_HOME/p/android-34/android.jar` |
| `D8_JAR` | Android build-tools D8 jar | discovered under `$BUILD_HOME/b/*/lib/d8.jar` |
| `APKSIGNER_JAR` | Android build-tools signer jar | discovered under `$BUILD_HOME/b/*/lib/apksigner.jar` |
| `KEYSTORE_PATH` | **Existing** signing keystore | `$BUILD_HOME/key.jks` |
| `KS_PASS` | Password for store and alias | required |
| `KS_ALIAS` | Signing alias | `st` |
| `VC` | Monotonically increasing Android versionCode | required positive integer |
| `VERSION_NAME` | Android version name | `1.$VC` |
| `APK_OUT` | Final APK file | `$BUILD_HOME/out/ScorchedTanks.apk` |

Use `./build.sh --help` for built-in usage. The script validates inputs *before* creating the temporary build directory. It never deploys or updates the committed `apk/ScorchedTanks.apk` automatically.

```
# Illustrative only: point these variables at your own toolchain and existing keystore.
VC=16 VERSION_NAME=1.16 KEYSTORE_PATH=/secure/ScorchedTanks-release.jks \
  KS_PASS="$KS_PASS" ./build.sh
```

The script compiles `MainActivity.java`, generates the APK with `aapt`, converts classes with D8, aligns/signs it with the **provided** key, verifies its signature, and checks that every packaged HTML/CSS/JS asset is byte-for-byte identical to `game/`. An error fails the build; no prior state or signing key is silently regenerated.

## Safe checks without the Android SDK

```
bash tests/test_android_build.sh
```

The checks validate shell syntax, absence of old absolute paths, rejection of invalid `VC`, and failure when a keystore is absent. This **does not prove that a release APK compiles**. End-to-end builds, certificate fingerprints, target SDK and actual installation/update behavior still require a full Android SDK and a device test. The historical aapt path targets SDK 28; Gradle config currently targets SDK 34. Align policy in issue #14 before Google Play publishing.

## Related work

- #13 — portable APK packaging (this change)
- #14 — root CI and Gradle/release equivalence
- #26 — signing policy, production deploy verification and rollback safety
