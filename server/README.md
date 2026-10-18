# Scorched Tanks multiplayer server
Cloudflare Worker `scorched-tanks` (account Yishai.k@gmail.com), URL https://scorched-tanks.yishai-k.workers.dev
Durable Objects: Lobby (matchmaking queue, open public rooms) and Room (roster, host, relay, snapshot for host migration).
Deploy: PUT /accounts/<id>/workers/scripts/scorched-tanks multipart with metadata.json + worker.js (see protocol comment at top of worker.js).
Redeploy: use meta-update.json (no migrations); initial deploy used metadata.json (migration v1).
