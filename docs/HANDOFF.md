# Project handoff — Scorched Tanks

**Updated:** 2026-11-17 (Asia/Jerusalem). This supersedes the 2026-10-31 handoff
(which still described source as v1.15 and said root CI was missing) and the
earlier 2026-10-19 v1.11 note.

## Source state

- `main` is `df8a392` (merge of PR #36), **v1.18 / versionCode 18**: first-launch
  age-group selection, on-device parent controls with a parent PIN, and a
  safety reminder before online play. All of it is localStorage only. It also
  carries the v1.17 Play icon, checklist, trailer pipeline, and the
  privacy/terms files (updated to describe the on-device age group and parent
  PIN). Play already has a 1.17 / VC17 Early Access build whose source was
  never checked in, so the next Play upload must be VC18.
- The committed sideload APK `apk/ScorchedTanks.apk` is the signed **1.18 /
  versionCode 18** build (production signer). Store-gate compares the unsigned
  AAB (18) to that APK (18); an equal versionCode is a warning on PRs and an
  error only when the workflow is dispatched with `release: true`. Do not
  replace the APK with an unsigned or differently signed build.
- Core gameplay is unchanged: offline 2–10 tanks, 7 CPU types, map editor,
  modern/classic graphics, save/continue, shops, 30+ weapons, destructible
  terrain. Online uses the Cloudflare Worker plus `Lobby`/`Room` Durable
  Objects. The app creates private rooms with a default of four seats; the
  Room DO maximum is six; the host can pick 2–6. Quick Match stays 4.
- Browser/Android game sources and the signed sideload APK coexist in the repo.
  The live Worker is the production `scorched-tanks` worker
  (`https://scorched-tanks.yishai-k.workers.dev`, marketing host
  `https://tanks.yishaik.com`). Do not run `server/deploy.sh` unless a deploy
  has been explicitly requested. `APP_VER` and the committed APK versionName
  both read 1.18, so the deploy.sh aapt check will pass.

## On-device safety settings (v1.18)

Stored only in `localStorage` on the device. Never sent to the Worker or
included in online room state. No accounts and no new Android permissions.

- `st-age` — `u13`, `teen`, or `adult`. Chosen on first launch (and later from
  Parent Controls).
- `st-pin` — 8-hex one-way hash of the 4-digit parent PIN. Required to change
  settings, and to turn online play on for the under-13 group.
- `st-allow-online` — `0` or `1`. Under 13 defaults to off; choosing that
  group always re-locks online until a parent enables it with the PIN.
- `st-restrict-codes` — `0` or `1`. When on, Quick Match, join-by-code, and
  Share are hidden. Under 13 defaults to on. There is no in-game chat.

A safety reminder is shown every time before the online panel opens.

## CI and store-gate (now on main)

Root workflow: `.github/workflows/ci.yml`. It runs on pull requests, pushes to
`main`, and `workflow_dispatch`. Jobs: `shell-tests`, `node-tests`,
`render-tools`, `apk-smoke`, `e2e-browser`, `android-emulator` (API 24 and 36),
`store-gate`. See [CI.md](CI.md). The workflow never publishes, never uploads
an AAB/APK as a release, and never deploys the Worker.

`store-gate` builds an unsigned Gradle `bundleRelease` and checks package,
minSdk 24, targetSdk ≥ 36, versionCode = `GAME_VER` patch, versionName =
`GAME_VER`, only `INTERNET`, not debuggable, no unaligned `.so`, and bundle
assets = `game/`. It compares versionCode to the committed
`apk/ScorchedTanks.apk`. An equal versionCode is a warning on PRs and an
error when the workflow is dispatched with `release: true`. After the signed
VC18 sideload APK was committed, that equal-18 warning is the expected state
on v1.18 PRs. Play already has VC17, which was never committed as a sideload
APK. Details and commands:
[PLAY_RELEASE_CHECKLIST.md](store/PLAY_RELEASE_CHECKLIST.md).

## Open PRs and branches

- **PR #36** (`release/v1.18`) is **merged** into `main` as `df8a392`.
- **PR #34** (privacy/terms) was merged earlier the same day; the privacy
  policy on main also describes the on-device age group, parent PIN and
  parent-control settings.
- **PR #35** (`release/v1.17`) was superseded by `release/v1.18`.
- The signed 1.18 / VC18 sideload APK lands in `apk/ScorchedTanks.apk` on
  this branch (`chore/sideload-apk-1.18`). Do not force-push, and do not
  touch `main` directly.
- Other historical branches (`docs/handoff`, `release/v1.16`, feature and fix
  branches) are already merged or idle; do not treat them as the work tree.

## 30-day goal

Ready-to-publish Play package by **2026-11-28**. That means a signed **VC18**
AAB that passes the strict store-gate, listing assets, Data safety / content
rating material, and a closed-testing plan — sitting ready, not uploaded to
production. A 30-second gameplay trailer pipeline exists (v3 take in
`/workspace/scorched-trailer/v3/`; videos are not in git). Publishing to any
Play track still needs Yishai's explicit OK.
The business model is already in `marketing/COPY.md`: free in the browser and
via the GitHub/APK sideload; a one-time paid download on Google Play.

## In progress / next steps

1. v1.18 source is on `main` (`df8a392`) and the signed sideload APK is the
   1.18 / VC18 production-signed build. Play upload of the signed VC18 AAB
   still needs Yishai's explicit OK, naming the track and the artifact.
2. Use `docs/store/privacy-terms.md` when filling the Play Data safety form.
   Confirm the Play content rating / Families target now that under-13 can
   play offline with parent controls.
3. The signed VC18 AAB and APK already exist at
   `/workspace/scorched-release/1.18/` (outside the repo). Do not generate a
   new key. The next Play upload must be versionCode 18.
4. Yishai still needs to confirm Play Console account status, payments /
   merchant setup, and the paid-download price. Do not invent a price.
5. Trailer v3 is recorded at `/workspace/scorched-trailer/v3/` (generic names,
   human winner, Modern look; videos are not in git). Real-device listing
   screenshots and the closed-testing track remain. See the checklist.
6. Worker deploy is a separate, explicitly requested step. After this APK
   swap, `deploy.sh` preflight will accept the matching 1.18 APK.

## Known issues and cautions

- Mid-round rotation, settings persistence, press-and-hold shop, map builder
  and modern graphics landed in v1.12–v1.15; treat older bug lists in
  pre-v1.16 notes as historical unless reproduced.
- `docs/TESTING.md` claims a new personal Play account needs 12 testers for 14
  consecutive days before production access. **Unverified** against current
  Play policy; confirm on the account.
- `deploy.sh --dry-run` should now pass the APK versionName check (`APP_VER`
  and the committed APK are both 1.18). CI's `shell-tests` job does not
  install `aapt`, so that check is skipped there.
- Keystore material, passwords, Cloudflare tokens and private backups must
  stay out of git. A historical Drive backup was known to contain the
  keystore password in plaintext; treat that storage as sensitive.
- `build.sh` is the historical sideload (targetSdk 28) path. Play uploads
  come from the Gradle project (`targetSdk 36`). Do not use `build.sh` as the
  Play artifact.
- Online trust/cheat resilience is improved in v1.16 (rejoin tokens, host-only
  authoritative messages, rate limits, shop validation) but is not a full
  anti-cheat system.
- Do not claim a physical-device or two-phone online run has been done unless
  it was actually run.

## Secrets and environment (names only)

| Name | Used by |
|---|---|
| `SCORCHED_KEYSTORE` | Gradle release signing, path to the existing keystore |
| `SCORCHED_KEYSTORE_PASSWORD` | Gradle release signing |
| `SCORCHED_KEY_ALIAS` | Optional, default `st` |
| `SCORCHED_KEY_PASSWORD` | Optional, defaults to the store password |
| `KEYSTORE_PATH`, `KS_PASS`, `KS_ALIAS` | `build.sh` sideload path (same production key) |
| `CF_API_TOKEN`, `CF_ACCOUNT_ID` | `server/deploy.sh` production upload — do not run for this milestone |
| `WORKER_NAME`, `WORKER_URL` | Optional staging override for deploy.sh |

## How to build, run and test

- Local web: `python3 -m http.server 8000 --directory game`
- Inlined game HTML (no upload): `python3 server/inline_assets.py game /tmp/scorched-game.html`
- Node tests (no SDK): `node --test tests/node/*.test.mjs tests/*.test.mjs`
- Shell tests: `bash tests/test_android_build.sh && bash tests/test_deploy.sh && bash server/deploy.sh --dry-run`
- Browser E2E + local online: `tests/run-all.sh` (see [TESTING.md](TESTING.md))
- Renderer check: `cd tools/render && npm ci && npm run check`
- Store-gate unit tests are part of the node suite. The AAB gate needs Gradle
  and bundletool; CI runs it. Strict mode: `gh workflow run CI --ref <branch> -f release=true`
- Signed Play AAB: [PLAY_RELEASE_CHECKLIST.md](store/PLAY_RELEASE_CHECKLIST.md)

## Reference documents

- [DOCS.md](../DOCS.md) — developer index (the "v1.15 source" header is a
  2026-10-31 audit snapshot and is stale as a version label)
- [ARCHITECTURE.md](ARCHITECTURE.md), [PROTOCOL.md](PROTOCOL.md)
- [TESTING.md](TESTING.md), [CI.md](CI.md)
- [DEPLOY.md](../DEPLOY.md), [RELEASE-SAFETY.md](RELEASE-SAFETY.md),
  [ANDROID-BUILD.md](ANDROID-BUILD.md)
- [PLAY_RELEASE_CHECKLIST.md](store/PLAY_RELEASE_CHECKLIST.md)
- [AGENTS.md](../AGENTS.md)
- [COPY.md](../marketing/COPY.md)
- [REVIEW-2026-10-31.md](REVIEW-2026-10-31.md) — dated audit
