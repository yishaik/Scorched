# Verification and test strategy

**Status on 2026-10-31:** no runnable repository-root CI workflow or automated gameplay test suite was found. This page is a plan and reproducible manual checklist, **not** a claim that the tests have passed.

## Current testability

| Area | What can be checked | Limitations |
|---|---|---|
| Web/offline | Serve `game/` and play with a browser | Game HTML references local Hark assets plus Google Fonts |
| Map and persistence | Reload, save/continue, map edit | Browser origin and APK file-origin storage differ |
| Android | Install a correctly signed release APK and use touch, rotation/deep links | `build.sh` references non-repository absolute paths; Gradle config is not release-equivalent |
| Multiplayer | Two browsers/phones using a private room | Requires deployed Worker and two distinct client identities |
| Worker | Public `/health`; room API; WebSocket | Health only checks HTTP/version, not complete DO/game correctness |
| Marketing renderer | Visual regression of generated art | Render scripts depend on old workspace paths and Node `canvas` |
| CI | A YAML file exists at `android/.github/workflows/build.yml` | GitHub Actions searches repository-root `.github/workflows/`; this workflow is inert here |

## Local web smoke test

```bash
git clone https://github.com/yishaik/Scorched.git
cd Scorched
python3 -m http.server 8000 --directory game
# Open http://localhost:8000 in a browser.
```

Confirm page loads without JS errors and that HUD, terrain, aiming, weapons and sound work. Exercise both portrait and landscape at mobile viewport sizes. This is a *manual* browser smoke test; no command-line assertion is provided.

## Release and acceptance matrix

- [ ] New local 2-player game: shop before first round; turn handoff, fire and winner.
- [ ] Local 10-tank CPU game: AI turns, weapons, settling, win conditions and round progression.
- [ ] Verify all weapon families (direct blast, MIRV/funky, rollers, diggers, napalm, dirt, laser) under all wall styles.
- [ ] Modern/Classic graphic mode switch persists after reload and survives rotation.
- [ ] Draw a custom map; add tree, bush, wreck; save/edit/reopen; verify custom terrain and visuals.
- [ ] Local `st-setup` persists; `st-save` save/continue restores tank inventories, turn, world bitmap and camera dimensions.
- [ ] Test invalid/malformed localStorage payloads and full quota; app does not crash.
- [ ] Browser online: room create, join via code and invite link, host controls settings, mismatched-version warning.
- [ ] Two Android phones: complete a full online match, shop and rounds; test host disconnect, CPU takeover, reconnection and host migration.
- [ ] Rotate Android device mid-shot and after crater deformation; world must not stretch/reseed.
- [ ] Verify Android `scorchedtanks://join/CODE` and registered HTTPS App Links; independently verify association fingerprint against **release signer**.
- [ ] Android install/update from a previous release retains app data; fresh install and upgrade both tested.
- [ ] Confirm emitted APK's versionName, versionCode, targetSdk and signature; do not assume Gradle settings equal historical aapt settings.
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

## Suggested automated tests, ordered by value

1. **Static sanity**: validate documents/links, version consistency, worker syntax, inline output and absence of obvious secrets.
2. **Game model**: extract or modularize pure RNG, map validation, physics and state serialization for Node tests with seeded fixtures.
3. **Browser E2E**: Playwright for setup, simulated fire, shop, save/continue, map editor and mobile viewport/rotation.
4. **Worker integration**: isolated Cloudflare DO test environment for room lifecycle, collision retries, socket replacement, host migration and protocol abuse.
5. **Two-client smoke**: deterministic multi-tab two-player session against staging, never casual production rooms.
6. **Android**: Gradle release packaging verification, WebView instrumentation, APK update/deep link and signature checks.

Do not add a production-deploy CI job until build paths, signing provenance, migration safety and rollback strategy are validated.
