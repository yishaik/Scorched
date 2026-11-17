# Google Play release checklist — Scorched Tanks

This is the path to a **ready-to-publish** package. It does **not** authorize a Play store
listing, a production track promotion, or a Worker deploy. Publishing still needs
Yishai's explicit OK, given in this project's chat, naming the track (closed testing
or production) and the artifact.

Current source version: **1.17 / versionCode 17**. The committed sideload APK
`apk/ScorchedTanks.apk` remains the last published build (**1.16 / versionCode 16**)
until a signed VC17 AAB/APK replaces it. Do not commit an unsigned build in its place.

Related: [DEPLOY.md](../../DEPLOY.md), [RELEASE-SAFETY.md](../RELEASE-SAFETY.md),
[ANDROID-BUILD.md](../ANDROID-BUILD.md), [CI.md](../CI.md),
[TESTING.md](../TESTING.md), [COPY.md](../../marketing/COPY.md).
Data safety answers live in PR #34 (`docs/store/privacy-terms.md` on branch
`store/privacy-terms`): https://github.com/yishaik/Scorched/pull/34

---

## 1. Signed AAB (Gradle `bundleRelease`)

Release signing is environment-driven. The keystore and passwords stay **outside**
the repository. Gradle will not fall back to the debug key; without the variables
below, `bundleRelease` produces an unsigned bundle (what CI builds).

Required environment variable names (values never belong in git, docs commits,
CI logs or issue comments):

| Name | Role |
|---|---|
| `SCORCHED_KEYSTORE` | Absolute path to the existing production keystore file |
| `SCORCHED_KEYSTORE_PASSWORD` | Keystore password |
| `SCORCHED_KEY_ALIAS` | Key alias. Optional; Gradle defaults to `st` |
| `SCORCHED_KEY_PASSWORD` | Key password. Optional; defaults to `SCORCHED_KEYSTORE_PASSWORD` |

There is no checked-in Gradle wrapper. Use a known Gradle 8.11.x and JDK 17, same
as CI (`.github/workflows/ci.yml`).

```bash
# From the repo root. Does not publish anything.
# Do not invent a new keystore if the production file is missing.
export SCORCHED_KEYSTORE=/secure/path/to/the-existing-release.jks
export SCORCHED_KEYSTORE_PASSWORD=    # set privately; do not type it into the repo
# optional: export SCORCHED_KEY_ALIAS=st
# optional: export SCORCHED_KEY_PASSWORD=    # defaults to the store password

cd android
gradle :app:bundleRelease --no-daemon --stacktrace
```

Expected output: `android/app/build/outputs/bundle/release/app-release.aab`.

`assembleRelease` with the same variables produces a signed APK, useful for a
sideload/update check, but the Play upload artifact is the AAB. After a signed
VC17 AAB (and, if we keep shipping a direct download, a signed VC17 APK) has
been verified, the APK may be copied to `apk/ScorchedTanks.apk` in a later PR.
`server/deploy.sh` will refuse to deploy while `APP_VER` and the committed APK
versionName disagree (when `aapt` is available). That refusal is expected until
the signed APK is committed; do not bypass it and do not run `server/deploy.sh`
as part of this prep.

---

## 2. Signer SHA-256 verification

The production signer is pinned in `build.sh` (`PROD_CERT_SHA256`) and in
`server/worker.js` (`/.well-known/assetlinks.json`):

```
0B:23:9E:D6:B6:E3:C7:4F:05:EC:3B:C6:E4:6A:66:D9:3D:EB:77:9B:62:D8:01:46:89:9E:93:0C:BB:7F:6D:98
```

A different signer breaks in-place upgrades for existing installs and App Links
for `https://tanks.yishaik.com/join/…`. Never create a new signing identity as a
fallback.

```bash
AAB=android/app/build/outputs/bundle/release/app-release.aab

# keytool prints the certificate, including SHA-256. Compare it to the pin above
# (colons and case are ignored).
keytool -printcert -jarfile "$AAB"

# Equivalent check: normalize both fingerprints to lowercase hex and diff them.
python3 - <<'PY'
import re, subprocess, sys
PIN = "0B:23:9E:D6:B6:E3:C7:4F:05:EC:3B:C6:E4:6A:66:D9:3D:EB:77:9B:62:D8:01:46:89:9E:93:0C:BB:7F:6D:98"
out = subprocess.check_output(["keytool", "-printcert", "-jarfile", "android/app/build/outputs/bundle/release/app-release.aab"], text=True)
found = re.findall(r"SHA256:\s*([0-9A-Fa-f:]+)", out)
if not found:
    sys.exit("no SHA256 in keytool output")
norm = lambda s: re.sub(r"[^0-9a-f]", "", s.lower())
ok = any(norm(f) == norm(PIN) for f in found)
print("found:", found)
print("matches pin:" , ok)
sys.exit(0 if ok else 1)
PY
```

If the printout does not match the pin, discard the AAB. Do not upload it.

Also confirm the bundle's `versionName` is `1.17` and `versionCode` is `17`, and
that it is not debuggable. The store-gate step below covers this once you have
bundletool.

---

## 3. Strict store-gate (`workflow_dispatch`, `release: true`)

Root workflow: `.github/workflows/ci.yml`. The `store-gate` job builds an
**unsigned** `bundleRelease` (no `SCORCHED_KEYSTORE*` in CI) and checks it with
`tests/android/store-gate.mjs`. CI never signs, never uploads an AAB/APK, and
never deploys the Worker.

The gate reads `versionCode` from the newly built AAB and compares it to the
committed `apk/ScorchedTanks.apk` (`--last-vc`):

- AAB `versionCode` must equal the `GAME_VER` patch (17) and `versionName`
  must equal `GAME_VER` (1.17). A mismatch here is always an error.
- If AAB `versionCode` **equals** the committed APK's versionCode, that is
  "not a new release": a **warning** on pull requests and pushes, and an
  **error** when the workflow is dispatched with `release: true`.
- If AAB `versionCode` is **greater** than the committed APK's, the upgrade-order
  check passes (this is the expected state on the v1.17 branch: AAB 17 vs
  published APK 16). Leaving the VC16 APK in the tree is intentional.
- If AAB `versionCode` is **lower** than the committed APK's, that is always
  an error.

CI sets `STORE_GATE_STRICT=1` only when the workflow is started via
`workflow_dispatch` **and** the `release` input is true. Opening a PR is not
enough to run the strict form.

```bash
# From a machine with gh, against the release branch (not main):
gh workflow run CI --repo yishaik/Scorched --ref release/v1.17 -f release=true
```

Or: GitHub → Actions → CI → Run workflow → branch `release/v1.17` → enable
"Store gate in release mode: versionCode must be strictly greater than the
published APK's" → Run workflow.

Locally, once you have an AAB and bundletool:

```bash
node tests/android/store-gate.mjs \
  --aab android/app/build/outputs/bundle/release/app-release.aab \
  --bundletool /path/to/bundletool.jar \
  --last-vc 16 \
  --strict
```

`--strict` (or `STORE_GATE_STRICT=1`) is the same rule as `release: true`.
Without it, an equal versionCode only warns. Unit tests for the gate live in
`tests/node/store-gate.test.mjs` and do not need the SDK.

---

## 4. Play Console steps that need Yishai

These cannot be finished from the repo alone. Do not publish, and do not create
a Play listing or start a closed test, without Yishai doing the Console work
(or explicitly asking for a named action).

1. **Play Console account.** A Google Play developer account in Yishai's name,
   with the app package `com.yishai.scorchedtanks`. Confirm whether the account
   already exists and whether it is a new personal account or an organization
   account — the closed-test rules differ.
2. **Payments / merchant profile.** A one-time paid app needs a payments profile
   and a merchant account set up in Play Console before a price can be sold.
   Confirm this is already done.
3. **Price.** The store copy already describes a **one-time paid download**
   (see `marketing/COPY.md` and the terms in PR #34). The actual price is not
   in the repo and must be chosen by Yishai. Do not invent one.
4. **Data safety form.** Fill the Play Console Data safety questionnaire from
   the answers in PR #34, file `docs/store/privacy-terms.md` (section "Play
   Console: Data safety answers"). Contact used there: theyishaik@gmail.com.
   If #34 is not yet merged, read that file on the `store/privacy-terms` branch
   rather than improvising. Privacy and terms URLs, once #34's Worker routes
   are the published ones: `https://tanks.yishaik.com/privacy` and
   `https://tanks.yishaik.com/terms` (the PR description says those routes were
   already deployed; confirm they still serve this policy before submitting).
5. **Content rating.** Complete the IARC questionnaire in Play Console.
   The Data safety / policy draft targets 13+. The official rating is whatever
   the questionnaire returns; do not self-assign a rating in the listing.
6. **Closed testing track.** Upload the **signed**, verified VC17 AAB to a
   closed testing track, not production. Add testers and run the test.
   `docs/TESTING.md` currently claims that a new *personal* Play developer
   account must run a closed test with at least 12 testers opted in for 14
   consecutive days before it can apply for production access. **That claim
   is unverified against current Play Console policy** and should be checked
   on the account itself before planning the calendar. Only real people on
   real devices count, if the rule still applies.
7. **Store listing assets** (files already in `marketing/` unless noted):

   | Asset | Path / notes |
   |---|---|
   | Feature graphic (1024×500) | `marketing/feature-graphic.png` |
   | High-res icon (512×512, 32-bit PNG) | `marketing/play-icon-512.png` (from the launcher vector) |
   | Screenshots | `marketing/screenshot-1-sunset.png`, `screenshot-2-night.png`, `screenshot-3-map-builder.png`. `marketing/COPY.md` still calls for real-device shots of the shop, lobby and map builder. |
   | Short / full description, tagline | `marketing/COPY.md` (EN and HE) |
   | 30-second gameplay trailer | **Pending.** The listing needs a YouTube URL once the trailer exists. Do not invent a URL. |
   | Promo square (optional, social) | `marketing/promo-square.png` |

8. **Publishing rule.** Promoting the release to production, pressing
   "Start rollout to production", or otherwise making the paid listing
   publicly available requires Yishai's explicit OK. Ready-to-publish means
   the signed AAB, the store-gate (strict) pass, the listing assets, Data
   safety, content rating and closed-test materials are prepared and waiting
   for that OK. Stop there until he gives it.

---

## 5. Ready-to-publish package (target 2026-11-28)

The 30-day goal is a package that can go onto a Play testing or production
track, not an automated publish. Trailer is pending. Worker production deploys
and any change to the live Durable Object schema stay out of scope until a
later, explicit release.
