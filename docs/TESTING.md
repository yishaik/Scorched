# Verification and test strategy

**Status on 2026-11-03:** an automated pre-store pipeline exists (PR "Automated pre-store test pipeline"). What it
covers, how to run it and what still needs people is below. A box ticked in the matrix means *an automated test
asserts it*; it is not a claim about any particular run. CI results are on each PR's checks page.

## Run everything

```bash
tests/run-all.sh            # shell + node + Playwright (portrait + landscape) + local two-client online test
tests/run-all.sh --quick    # shell + node only (seconds, no browser)
ST_ONLINE=0 tests/run-all.sh                        # skip the local Worker / online test
STORE_AAB=app-release.aab BUNDLETOOL=bundletool.jar LAST_VC=16 tests/run-all.sh   # also run the store gate
```

`tests/run-all.sh` installs `tests/e2e` from its lockfile, uses Playwright's Chromium (or a system Chromium via
`PW_CHROMIUM_PATH`, e.g. `/usr/bin/chromium` on arm64 Linux, where Playwright has no download), prints a PASS/FAIL
table and exits non-zero on any failure. The Android emulator job needs KVM and the Android SDK, so it runs only in
GitHub Actions (`android-emulator`); see docs/CI.md.

## Test hook (`?test=1`)

`game/index.html` exposes `window.__ST_TEST__` **only** when the page URL has `?test=1`, or when the host sets
`window.__ST_TEST_FLAG__ = true` before the game script runs (the emulator job does this over the WebView DevTools
protocol). Without the flag no global, listener or timer is created and gameplay is unchanged;
`tests/node/test-hook.test.mjs` checks the guard and `specs/smoke.spec.mjs` checks the global is absent at runtime.

| Call | What it does |
|---|---|
| `state()` | screen (`title`, `menu`, `setup`, `shop`, `play`, `roundOver`, `standings`, `pause`, `mapEditor`, `online*`…), round, turn, busy, wind, gfx, world/stage size and a terrain-mask hash, tanks (hp, alive, x/y, angle, power, weapon), players (cash, wins, kills, stock, items), online view/code/host |
| `seed(n)` | seeds the game's `rnd()` (mulberry32) so terrain, turn order and CPU play repeat |
| `aim({angle, power, weapon})`, `fire()` | act for the human whose turn it is (refused otherwise) |
| `solve(i)` | best angle/power at tank `i` from the game's own trajectory model (no `rnd()` used) |
| `settle(maxSimSeconds)` | synchronous fast-forward: runs pending CPU moves at once and steps physics until a human can act or the round ends |
| `waitSettled(ms)` | real-time wait until nothing is moving (used online, where play runs at 1×) |

## What is automated

| Area | Test | Where it runs |
|---|---|---|
| Page loads with no console errors / uncaught exceptions; no request reaches production | every Playwright test (fixture) | local + `e2e-browser` |
| Local 2-player and CPU game to a round winner, round 2, final standings; 10-tank CPU round | `specs/match.spec.mjs` | local + CI |
| Shop before round 1: tap-to-buy, hold-to-buy, sell, misc items, inventory/cash into the round | `specs/shop.spec.mjs` | local + CI |
| Save from the game menu → reload → Continue restores round, turn, wind, terrain bitmap, tanks, inventories | `specs/save.spec.mjs` | local + CI |
| Modern/Classic persists after reload and survives rotation | `specs/gfx.spec.mjs` | local + CI |
| Map builder: draw, tree/bush/wreck, save, edit/reopen, reload, play on it | `specs/mapeditor.spec.mjs` | local + CI |
| Rotation after a crater and mid-shot: world size, terrain and tanks unchanged (letterboxed, not stretched/reseeded) | `specs/rotation.spec.mjs` | local + CI |
| Malformed `st-*` localStorage payloads and a full quota: no crash, bad save dropped with a message | `specs/storage.spec.mjs` | local + CI |
| Online: create room, join by code, lobby roster, host start, simultaneous shop, 3 turns with both clients agreeing on turn, terrain and HP; bad code → error dialog | `specs/online.spec.mjs` against `server/worker.js` under **local** `wrangler dev` | local + CI |
| Android: install, launch, WebView renders, hook inert, a full CPU round in the real WebView (DevTools protocol), rotation, deep links `scorchedtanks://join/TEST1` (ignored: not 4 letters) and `/TEST` (offline join), reinstall-over keeps localStorage, home/resume; fails on FATAL EXCEPTION, ANR or chromium `Uncaught` | `tests/android/emulator-smoke.sh` | `android-emulator` (API 24, 36) |
| Old-WebView syntax/CSS guard: no `??`, `?.`, `||=`/`&&=`, numeric separators in game scripts; no CSS `inset` in game styles (both broke the game on the API 24 emulator's WebView) | `tests/node/webview-compat.test.mjs` | local + `node-tests` |
| Store gate on the release AAB: package, minSdk 24, targetSdk ≥ 36, versionCode = GAME_VER patch and > published APK, permission allowlist (INTERNET), not debuggable, no/16 KB-aligned `.so`, assets = `game/` | `tests/android/store-gate.mjs` (+ `tests/node/store-gate.test.mjs`) | `store-gate` |

All browser and emulator tests are hermetic: Playwright answers Google Fonts with an empty stylesheet and aborts every
other external request; Chromium is also started with the production hosts mapped to nowhere; the emulator's Wi-Fi and
mobile data are switched off before the app starts.

## What still needs people

- **Google Play closed test.** A new *personal* Play developer account must run a closed test with at least 12 testers
  opted in for 14 consecutive days before it can apply for production access. Only real people on real devices count.
- **Gameplay feel and balance:** weapon fun, CPU difficulty, economy, sound, touch ergonomics on small/large phones.
- **Real devices and real networks:** two phones in one online match over mobile data, host disconnect/migration,
  reconnection, low bandwidth, blocked WebSocket (the online test covers one happy path on a local Worker only).
- **Release signing:** App Links verification and the assetlinks fingerprint against the **release** signer, an
  update from the previously published release-signed build (CI can only test a debug-key reinstall), Play App Signing.
- **Store listing:** screenshots, copy, data-safety form, content rating, privacy policy.

## Current testability

| Area | What can be checked | Limitations |
|---|---|---|
| Web/offline | Serve `game/` and play with a browser | Game HTML references local Hark assets plus Google Fonts |
| Map and persistence | Reload, save/continue, map edit | Browser origin and APK file-origin storage differ |
| Android | Install a correctly signed release APK and use touch, rotation/deep links | `build.sh` references non-repository absolute paths; Gradle config is not release-equivalent |
| Multiplayer | Two browsers/phones using a private room | Requires deployed Worker and two distinct client identities |
| Worker | Public `/health`; room API; WebSocket | Health only checks HTTP/version, not complete DO/game correctness |
| Marketing renderer | Visual regression of generated art | Render scripts depend on old workspace paths and Node `canvas` |
| CI | Root `.github/workflows/ci.yml` (see docs/CI.md) | Emulator job needs KVM (GitHub-hosted only) |

## Local web smoke test

```bash
git clone https://github.com/yishaik/Scorched.git
cd Scorched
python3 -m http.server 8000 --directory game
# Open http://localhost:8000 in a browser.
```

Confirm page loads without JS errors and that HUD, terrain, aiming, weapons and sound work. Exercise both portrait and landscape at mobile viewport sizes. The automated version of this is `tests/run-all.sh` (Playwright); the manual check remains useful for look and feel.

## Release and acceptance matrix

`[x]` automated (see above) · `[~]` partly automated (browser/emulator/debug key; the rest needs people or the release signer) · `[ ]` manual.
10-tank row: one round with 9 CPUs is automated; weapon-family coverage is not. Online row: create/join by code and turn sync are automated against a local Worker; invite links, host settings sync and version-mismatch warnings are not.

- [x] New local 2-player game: shop before first round; turn handoff, fire and winner.
- [x] Local 10-tank CPU game: AI turns, weapons, settling, win conditions and round progression.
- [ ] Verify all weapon families (direct blast, MIRV/funky, rollers, diggers, napalm, dirt, laser) under all wall styles.
- [x] Modern/Classic graphic mode switch persists after reload and survives rotation.
- [x] Draw a custom map; add tree, bush, wreck; save/edit/reopen; verify custom terrain and visuals.
- [x] Local `st-setup` persists; `st-save` save/continue restores tank inventories, turn, world bitmap and camera dimensions.
- [x] Test invalid/malformed localStorage payloads and full quota; app does not crash.
- [~] Browser online: room create, join via code and invite link, host controls settings, mismatched-version warning.
- [ ] Two Android phones: complete a full online match, shop and rounds; test host disconnect, CPU takeover, reconnection and host migration.
- [~] Rotate Android device mid-shot and after crater deformation; world must not stretch/reseed.
- [~] Verify Android `scorchedtanks://join/CODE` and registered HTTPS App Links; independently verify association fingerprint against **release signer**.
- [~] Android install/update from a previous release retains app data; fresh install and upgrade both tested.
- [~] Confirm emitted APK's versionName, versionCode, targetSdk and signature; do not assume Gradle settings equal historical aapt settings.
- [ ] Health endpoint reports expected version; GET `/play` and `/download` return correct content types; basic private room HTTP/WebSocket handshake works.
- [ ] Test with low bandwidth, bad connectivity, blocked WebSocket and two tabs sharing a `pid`.

## Useful read-only checks

```bash
# The following URL is the checked-in Worker address; it is not proof of current live availability.
curl -fsS https://scorched-tanks.yishai-k.workers.dev/health
curl -I https://scorched-tanks.yishai-k.workers.dev/play
curl -I https://scorched-tanks.yishai-k.workers.dev/download
python3 server/inline_assets.py game /tmp/scorched-game.html
```

The last command checks generation of inlined web HTML (no deployment). Be aware that `server/deploy.sh` performs a **real production upload**; never use it as a smoke test.

## Suggested automated tests, ordered by value (status)

1. **Static sanity** — done: node-tests (versions, syntax, metadata, references, test-hook guard). Link checking and secret scanning not yet.
2. **Game model** — partly: `mulberry32`, `cleanSlots`, `cleanMap`, `shopLegal` in Node; physics/serialization are exercised end-to-end through the test hook instead.
3. **Browser E2E** — done: `tests/e2e` (Playwright).
4. **Worker integration** — partly: mocked DO tests (`tests/worker.test.mjs`) plus the real Worker under local `wrangler dev` in the online E2E. Host migration, socket replacement and protocol abuse under workerd are not yet covered.
5. **Two-client smoke** — done against a local Worker (never production). A staging Worker would add real network conditions.
6. **Android** — done in CI: emulator smoke (API 24, 36) and the store gate. Not covered: release-signer verification, upgrade from the release-signed APK, App Links verification.

Do not add a production-deploy CI job until build paths, signing provenance, migration safety and rollback strategy are validated.
