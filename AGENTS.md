# AGENTS.md — guide for coding agents

Start with [docs/HANDOFF.md](docs/HANDOFF.md) (current state, next steps), then `DOCS.md` (architecture) and `DEPLOY.md` (links, release checklist).

## Layout
- `game/index.html` — the entire game (Canvas + WebAudio + online netcode), single file. `GAME_VER` near `NET_BASE`.
- `landing/index.html` — self-contained invite/download page.
- `server/` — Cloudflare Worker `scorched-tanks` with Durable Objects `Lobby` and `Room`; `deploy.sh` bundles landing + game + APK. Protocol documented at the top of `worker.js`.
- `android/` — minimal WebView wrapper (`com.yishai.scorchedtanks`).
- `build.sh` — Gradle-free APK build (aapt, d8, zipalign, apksigner).
- `apk/ScorchedTanks.apk` — latest build.

## Conventions
- Keep the game in one self-contained `game/index.html`, with no external assets or build step.
- Bump versions in all three places on release (`GAME_VER`, `APP_VER`, landing footer). See the **Release checklist** in `DEPLOY.md`.
- Mismatched client versions may still play together, so keep the protocol backward compatible.

## Hard rules
- **Never commit `key.jks`** (it's gitignored) or any password or token. The keystore password comes only from the `KS_PASS` env var, and the Cloudflare token only from `CF_API_TOKEN`.
- The repo is **public**. Grep your diff for secrets before pushing.
- Don't push to `main` directly. Use a branch and a PR.
