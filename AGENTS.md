# AGENTS.md — coding and documentation contributor guidance

Start with [DOCS.md](DOCS.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/PROTOCOL.md](docs/PROTOCOL.md) and [docs/HANDOFF.md](docs/HANDOFF.md). For release operations read [DEPLOY.md](DEPLOY.md) and [docs/TESTING.md](docs/TESTING.md) first.

## Code locations

- `game/index.html` — gameplay, Canvas/WebAudio rendering, local save and multiplayer client; `GAME_VER` near `NET_BASE`.
- `game/hark.css`, `hark-hero.css`, `hark.js` — dependent styles/scripts; source HTML is **not** independent of these files.
- `server/worker.js` — Worker HTTP routing, Durable Objects `Lobby`/`Room`, relay and stored host snapshots; `APP_VER`.
- `server/inline_assets.py` and `server/deploy.sh` — deploy-time asset preparation and **production upload**.
- `android/` — WebView and Gradle development project; `build.sh` is an old nonportable aapt flow, not a known-good release build.
- `landing/index.html` — invitation/download page, version footer and decorative animation.
- `tools/render/` — historical marketing image-generation scripts, with missing external absolute-path dependencies.

## Project conventions

- Preserve current playable behavior unless the task requests gameplay changes. The main game remains monolithic by current design; modularization needs separate tests and review.
- Keep Android WebView, browser inlined output, Worker `APP_VER`, `GAME_VER`, landing version, and APK release metadata in sync.
- Local games can have 2–10 tanks; online server room seats max at six and UI creates rooms for four. Never describe them as identical capabilities.
- Maintain saved-game compatibility (`serializeState`, RLE mask) and localStorage keys. Test portrait/landscape world preservation, custom maps and reload.
- Preserve protocol backwards compatibility or explicitly introduce a negotiated minimum supported version. Review host-migration snapshots and reconnect semantics for any network change.
- Document any newly observed issue with a source path and severity; distinguish verified static code observations from untested runtime behavior.

## Safety and release rules

- Never commit `*.jks`, passwords, access tokens or private backup content. Do not embed secrets in docs, logs or issue comments.
- Never create a new signing identity during a release as a silent fallback; verify existing signer and APK metadata.
- **Do not push directly to `main`**. Use a branch + PR with a clear verification note.
- Never invoke `server/deploy.sh` or modify production Worker/Durable Object schema as part of a review/README refresh.
- Do not trust `pid` as authentication; use explicit threat modeling for public networking and client relay data.
- Do not claim tests have passed without execution and observable results; root CI is currently missing and Android build scripts require remediation.
