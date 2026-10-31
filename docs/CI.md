# CI and tests

Root workflow: `.github/workflows/ci.yml`. It runs on pull requests, pushes to `main` and manual dispatch, with
`permissions: contents: read`. It **builds and tests only**: no release, no artifact upload, no deploy, no secrets.
(The old `android/.github/workflows/build.yml` never ran, because GitHub only reads workflows from the root
`.github/`, and it would have published debug-signed APKs as GitHub releases. It is removed.)

| Job | What it proves | Run locally |
|---|---|---|
| `shell-tests` | `build.sh` fails closed without SDK (missing/unset key, bad VC, password, versionName); `deploy.sh` against a fake curl (11 cases); `deploy.sh --dry-run` on the real tree | `bash tests/test_android_build.sh && bash tests/test_deploy.sh && bash server/deploy.sh --dry-run` |
| `node-tests` | Versions agree (GAME_VER, APP_VER, landing footer, Gradle versionName/Code); Gradle targetSdk ≥ 36, assets from `game/`, no debug release signer; assetlinks fingerprint = pinned signer; `node --check` of worker.js; every inline script in game/landing parses; metadata JSON; game references only existing files; headless unit tests of `mulberry32`, `cleanSlots`, `cleanMap` extracted from game/index.html | `node --test tests/node/*.test.mjs` (Node 18+, no dependencies) |
| `render-tools` | `tools/render` installs from its lockfile and renders all 5 store images twice, byte-identical, at the expected sizes | `cd tools/render && npm ci && npm run check` |
| `apk-smoke` | Manual `build.sh` path: real build with a throwaway key (`tools/android/build-dev-apk.sh`), assets byte-identical, release-policy rejections. Gradle path: `assembleDebug` + unsigned `assembleRelease`, version 1.N/N, targetSdk 36, release APK contains `game/` files and is **not** signed | needs the Android SDK; see docs/ANDROID-BUILD.md |

The debug/dev APKs built in CI are discarded with the runner; they are never uploaded or released.

## Renderer (`tools/render`)

Renders the store graphics in `marketing/` from the game's own drawing functions (`paintSky`, `drawTankModern`,
`mapDraw`, …) extracted from `game/index.html`, so they follow the current game art.

```bash
cd tools/render
npm ci              # node-canvas 3.2.3, pinned by package-lock.json
npm run render      # writes marketing/*.png (or: node mk.js <dir>; node mb.js <dir>; or RENDER_OUT=<dir>)
npm run check       # renders twice into temp dirs, asserts identical bytes and sizes; writes nothing in the repo
```

Determinism: `Math.random` is replaced with a fixed-seed mulberry32 and `performance.now()` is fixed. Output is
byte-identical run to run on the same machine; text uses system fonts, so bytes can differ between machines with
different font sets (sizes and layout do not). `npm run check` therefore compares two runs on the same machine
rather than against committed PNGs. If a game function the renderer uses is renamed, the renderer fails with
`function X() not found in game/index.html`.

## Release signing prerequisites

See docs/RELEASE-SAFETY.md (production signer fingerprint, keystore handling, Gradle `SCORCHED_KEYSTORE*` env vars,
deploy verification and rollback).
