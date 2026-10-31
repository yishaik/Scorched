# Scorched Tanks — developer documentation (v1.15 source)

This page is the developer entry point. The playable product description and screenshots are in [README.md](README.md). Engineering references below were reviewed against the source at `main` commit `26b9c8b` on **2026-10-31**.

> **Review scope:** static source inspection only. Building a signed APK, testing devices, deploying to Cloudflare, and verifying the production domain were **not** performed as part of the documentation refresh.

## Start here

| Need | Reference |
|---|---|
| System components, data flow, storage, implementation locations | [Architecture](docs/ARCHITECTURE.md) |
| HTTP routes, WebSocket envelopes, room lifecycle and trust limits | [Multiplayer protocol](docs/PROTOCOL.md) |
| Local development, Android/Worker publishing and rollback precautions | [Deployment](DEPLOY.md) |
| Manual QA matrix, reproducible checks and automation plan | [Testing](docs/TESTING.md) |
| Code review findings and remediation order | [Source audit (2026-10-31)](docs/REVIEW-2026-10-31.md) |
| Current handoff/next development priorities | [Handoff](docs/HANDOFF.md) |
| Agent and contributor constraints | [AGENTS.md](AGENTS.md) |
| Historical release changes | [CHANGELOG.md](CHANGELOG.md) |

## Quickstart: web

The source HTML references nearby `game/hark.css`, `hark-hero.css`, `hark.js` and Google Fonts. It is **not** literally one standalone file unless local assets are inlined. There is no npm bundle/build for the gameplay.

```bash
git clone https://github.com/yishaik/Scorched.git
cd Scorched
python3 -m http.server 8000 --directory game
# Open http://localhost:8000
```

Use local 2-player or vs-CPU modes for offline gameplay. The *online* menu always points at `scorched-tanks.yishai-k.workers.dev` (`NET_BASE` in `game/index.html`); it does not use an automatically started local backend. Serving the page on localhost does not create an isolated multiplayer test environment.

To produce the same inline HTML variant used in the Worker deploy:

```bash
python3 server/inline_assets.py game /tmp/scorched-game.html
```

## What the game currently implements

- Local 2–10 players, human and CPU; seven named CPU profiles (Moron, Shooter, Poolshark, Tosser, Chooser, Spoiler, Cyborg).
- More than 30 weapons across missiles, nukes, clusters, napalm, rollers, diggers, sandhogs, dirt, riot, plasma and laser; shields, guidance, parachutes and fuel.
- Turn-based trajectory/power/wind physics, bitmap terrain deformation and settling, round scoring/cash, and shops.
- Modern/Classic renderer, dynamic sky, terrain texture, background silhouettes, trees/bushes/wrecks, hit/burn decoration.
- Map picker/editor with 160-height-sample maps and placed decoration. Maps persist in localStorage, up to 30.
- Local game save and continue, remembered setup per mode, graphics/mute preferences. Local saves are not online/cloud backups.
- Online public quick matching and shareable private rooms, host lobby settings, turn timer, simultaneous shopping, best-effort reconnect, AI substitution on disconnect and host migration.

**Capacity distinction:** local supports 2–10 tanks; Room DO enforces **2–6 seats**, and the browser client creates rooms requesting **4 seats** (quick match also 4). Online 10-player matches are not supported by the current room implementation.

## Main source

`game/index.html` owns almost all game logic, UI and networking. Important entrypoints:

- `Net` near the `NET_BASE` and `GAME_VER` constants: WebSocket connection, matchmaking and roster.
- `WEAPONS`, `ITEMS`, `cfg`, `AI`: player setup and data tables.
- `makeTerrain`, `genDecor`, `renderTerrain`, `drawWorld`: world generation/rendering.
- `fire`, `impact`, `update`, `cpuMove`, `startMatch`, `nextTurn`: simulation and turn control.
- `serializeState`, `applyState`, `saveGame`: local snapshot and online host state exchange.
- `netBroadcast`, `netShop*`, `netOn*`, `onlineHostChanged`: online orchestration.

The server is `server/worker.js` (Worker default export, `Lobby` and `Room` DO classes). It **does not** run a trusted copy of gameplay physics. The online host is a client, with relay and occasional state snapshots.

## Android and release status

The Android wrapper runs a locally bundled game through WebView, supports fullscreen and invites through the native share bridge. It has a separate Gradle project and historical manual `build.sh`. **Neither is verified as a clean-clone, production-equivalent v1.15 release build.** Read [DEPLOY.md](DEPLOY.md) before building; do not run `server/deploy.sh` while simply testing.

The repository contains `apk/ScorchedTanks.apk`, but its actual version, signing identity and target SDK have not been independently inspected in this review. `game/index.html`, `landing/index.html` and `server/worker.js` each identify v1.15 in source.

## Project limitations, by design vs gaps

- The gameplay source is intentionally monolithic, which helps rapid standalone iteration but makes isolated unit testing and modular releases harder.
- WebAudio and external font loading depend on browser capabilities; audio starts only after user interaction.
- Networking uses a four-character room code and client-supplied persistent `pid`, **not** user accounts or verified authentication.
- Players may mix versions with a warning; there is no strict protocol compatibility gate.
- Current rendering-helper scripts are historical and not runnable from a vanilla checkout; see the audit.
- Code known gaps still include wall behavior for some specialty weapons, cavern ceiling settling and max-power reduction with damage; all require behavior verification before treating them as confirmed regressions.

## Contribution discipline

Use a feature branch and PR; never commit secrets, keystores or signing passwords. Separate source-code fixes from documentation/release operations. For all gameplay changes verify local save/restore, screen rotation, online host/peer state parity, disconnect recovery and at least one representative weapon per class. See [AGENTS.md](AGENTS.md) and [TESTING.md](docs/TESTING.md).
