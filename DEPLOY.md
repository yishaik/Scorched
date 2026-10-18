# Scorched Tanks — Deployment & Links (v1.11, 2026-10-19)

## Live links
| What | URL |
|---|---|
| Landing page | https://scorched-tanks.yishai-k.workers.dev/ |
| Room invite (example) | https://scorched-tanks.yishai-k.workers.dev/join/ABCD |
| Play in browser | https://scorched-tanks.yishai-k.workers.dev/play (auto-join: `/play#room=ABCD`) |
| APK download | https://scorched-tanks.yishai-k.workers.dev/download |
| Health check | https://scorched-tanks.yishai-k.workers.dev/health |
| Android App Links file | https://scorched-tanks.yishai-k.workers.dev/.well-known/assetlinks.json |
| WebSocket – quick match | `wss://scorched-tanks.yishai-k.workers.dev/ws/quick?name=&pid=&ver=` |
| WebSocket – room | `wss://scorched-tanks.yishai-k.workers.dev/ws/room/CODE?name=&pid=&ver=` |
| Cloudflare dashboard | https://dash.cloudflare.com/ → Workers & Pages → scorched-tanks (account 0f6475716c1a85bfa0a5956792e85b52) |
| Google Drive backups | https://drive.google.com/drive/folders/1EcwcT79F1iFWtzCUGGhhlznfbt_kqFGX |
| GitHub repo | https://github.com/yishaik/Scorched |

## Layout
- `game/index.html` — the entire game (Canvas + WebAudio + online netcode). `GAME_VER` constant near `NET_BASE`.
- `landing/index.html` — branded invite/download page (self-contained, no external assets).
- `server/worker.js` — Cloudflare Worker + Durable Objects `Lobby` (matchmaking) and `Room` (roster, relay, host, snapshots). Protocol is documented at the top of the file.
- `server/metadata.json` — first deploy only (creates DO migration tag `v1`).
- `server/meta-update.json` — every later deploy (no `migrations`; sending them again fails with "migration tag precondition failed").
- `server/deploy.sh` — bundles landing + game + APK into the Worker and uploads it.
- `android/` — WebView wrapper (package `com.yishai.scorchedtanks`, minSdk 24, target 34). Deep links: `scorchedtanks://join/CODE` and `https://scorched-tanks.yishai-k.workers.dev/join/CODE`.
- `build.sh` — builds/signs the APK without Gradle (aapt, d8, zipalign, apksigner). `KS_PASS=<keystore password> VC=<versionCode> ./build.sh`. `KS_PASS` is required (the script exits if it's unset) and is used for both the store and key password; it is read from the environment, never stored in the repo.
- `apk/ScorchedTanks.apk` — latest build (versionCode 11, versionName 1.11).
- `key.jks` — signing key (alias `st`). NOT in this repo: the key and its password are kept privately. Never commit them to a public repo. Losing the key means updates won't install over existing installs.

## Release checklist (new version)
1. Bump `GAME_VER` in `game/index.html`, `APP_VER` in `server/worker.js`, and the version in the landing footer.
2. Build: `KS_PASS=<keystore password> VC=12 ./build.sh` (versionName becomes 1.12). Edit the paths at the top of `build.sh` first: `A=` is the tools/output folder, `R=` the android folder, and line 6 copies the game files (`game/*.html,css,js`) into the APK assets.
3. Copy the new APK to `apk/ScorchedTanks.apk`.
4. `CF_API_TOKEN=... ./server/deploy.sh` — updates the server, landing page, browser game and APK download together.
5. Check `/health` shows the new `app` version, then upload a dated backup zip to Drive.

## Versions
Clients send `ver` on connect; the room roster includes each player's `ver`. Mismatched versions are allowed to play together — the lobby only shows a yellow tag and an UPDATE link.

## Build prerequisites (Linux)
`openjdk-21-jdk-headless aapt zipalign`, plus `android.jar` (platform-34-ext7_r03.zip) and build-tools jars (build-tools_r34-linux.zip) from dl.google.com. Paths are set at the top of `build.sh`.
