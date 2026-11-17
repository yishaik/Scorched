# AGENTS.md — coding and documentation contributor guidance

Start with [DOCS.md](DOCS.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/PROTOCOL.md](docs/PROTOCOL.md) and [docs/HANDOFF.md](docs/HANDOFF.md). For release operations read [DEPLOY.md](DEPLOY.md), [docs/TESTING.md](docs/TESTING.md), [docs/CI.md](docs/CI.md) and [docs/store/PLAY_RELEASE_CHECKLIST.md](docs/store/PLAY_RELEASE_CHECKLIST.md) first.

## Code locations

- `game/index.html` — gameplay, Canvas/WebAudio rendering, local save and multiplayer client; `GAME_VER` near `NET_BASE`.
- `game/hark.css`, `hark-hero.css`, `hark.js` — dependent styles/scripts; source HTML is **not** independent of these files.
- `server/worker.js` — Worker HTTP routing, Durable Objects `Lobby`/`Room`, relay and stored host snapshots; `APP_VER`.
- `server/inline_assets.py` and `server/deploy.sh` — deploy-time asset preparation and **production upload**.
- `android/` — WebView and Gradle project (Play / targetSdk 36 path). `build.sh` is the historical sideload (targetSdk 28) aapt flow, not the Play upload path.
- `landing/index.html` — invitation/download page, version footer and decorative animation.
- `tests/` — Node unit tests, Playwright E2E, Android emulator smoke, and `tests/android/store-gate.mjs`.
- `.github/workflows/ci.yml` — root CI (shell, node, renderer, APK smoke, E2E, emulator, store-gate). Build and test only; it never publishes or deploys.
- `tools/render/` — deterministic generator for the feature graphic, screenshots and promo square in `marketing/`. The Play high-res icon is separate: `marketing/play-icon-512.svg` / `.png`, rendered from the launcher vector, not from this tool.
- `docs/store/` — Play release checklist and (on PR #34 / `store/privacy-terms`) privacy, terms and Data safety answers.

## Project conventions

- Preserve current playable behavior unless the task requests gameplay changes. The main game remains monolithic by current design; modularization needs separate tests and review.
- Keep Android WebView, browser inlined output, Worker `APP_VER`, `GAME_VER`, landing version, and Gradle `versionCode`/`versionName` in sync. The committed `apk/ScorchedTanks.apk` is the last *published* sideload artifact and may lag mid-release (store-gate treats that as last-vc: equal = warning, or error in strict mode; lower = always an error; higher = expected until the signed APK is replaced).
- Local games can have 2–10 tanks; online server room seats max at six and the app defaults to four. Never describe them as identical capabilities.
- Maintain saved-game compatibility (`serializeState`, RLE mask) and localStorage keys. Test portrait/landscape world preservation, custom maps and reload.
- Preserve protocol backwards compatibility or explicitly introduce a negotiated minimum supported version. Review host-migration snapshots and reconnect semantics for any network change.
- Document any newly observed issue with a source path and severity; distinguish verified static code observations from untested runtime behavior.

## Safety and release rules

- Never commit `*.jks`, passwords, access tokens or private backup content. Do not embed secrets in docs, logs or issue comments. Refer to signing and deploy secrets by **name only**: `SCORCHED_KEYSTORE`, `SCORCHED_KEYSTORE_PASSWORD`, `SCORCHED_KEY_ALIAS`, `SCORCHED_KEY_PASSWORD`, `KEYSTORE_PATH`, `KS_PASS`, `CF_API_TOKEN`, `CF_ACCOUNT_ID`.
- Never create a new signing identity during a release as a silent fallback; verify the signer SHA-256 against the pin in `build.sh` / `server/worker.js` (`PROD_CERT_SHA256`).
- **Do not push directly to `main`**. Use a branch + PR with a clear verification note. Do not force-push unless the user has approved that specific rewrite.
- Never invoke `server/deploy.sh` or modify production Worker/Durable Object schema as part of a review, README, or Play-prep change. `--dry-run` is the only deploy script invocation that is safe by default.
- Do not replace `apk/ScorchedTanks.apk` with an unsigned or differently signed build.
- Do not publish to Google Play, start a production rollout, or promote a testing track to production without Yishai's explicit OK. Ready-to-publish (target 2026-11-28) means the signed AAB and listing package are prepared and waiting. The gameplay trailer is still pending.
- Do not trust `pid` as authentication; use explicit threat modeling for public networking and client relay data.
- Do not claim tests have passed without execution and observable results. Root CI exists and is required; run the local node (and, when feasible, shell and store-gate) tests before a PR, then wait for the workflow.
