# Scorched Tanks multiplayer Worker

The Cloudflare Worker source lives in [worker.js](worker.js). It combines HTTP routes, public quick matchmaking (`Lobby` Durable Object), and private/public room relay (`Room` Durable Object).

- Source version: `APP_VER = "1.15"`; runtime version from `GET /health`.
- Configured canonical Worker hostname: `scorched-tanks.yishai-k.workers.dev`.
- Multiplayer is a **client-host-authoritative game**; server relays payloads and stores last host snapshots, but does not independently validate physics/economy.
- Room capacity is 2–6 seats (default 4), with client-supplied `pid` and room codes; no authenticated account/session layer.
- Production deploy script: [deploy.sh](deploy.sh), uses `meta-update.json` for established Durable Object migrations.

Before deploying, read [DEPLOY.md](../DEPLOY.md). For HTTP/WebSocket request/response formats see [docs/PROTOCOL.md](../docs/PROTOCOL.md); for security and reliability caveats see [docs/REVIEW-2026-10-31.md](../docs/REVIEW-2026-10-31.md).

**Do not use this script as a test:** `deploy.sh` uploads directly to the configured Cloudflare account. Keep `CF_API_TOKEN` and signing materials out of source control.
