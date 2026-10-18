#!/usr/bin/env bash
# Deploy the Scorched Tanks Worker (relay + landing page + browser game + APK download).
# Usage: CF_API_TOKEN=... ./server/deploy.sh   (run from the repo root)
set -euo pipefail
ACCOUNT=${CF_ACCOUNT_ID:-0f6475716c1a85bfa0a5956792e85b52}
cd "$(dirname "$0")"
cp ../landing/index.html landing.txt
cp ../game/index.html game.txt
cp ../apk/ScorchedTanks.apk app.apk.bin
curl -sS -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/workers/scripts/scorched-tanks" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -F "metadata=@meta-update.json;type=application/json" \
  -F "worker.js=@worker.js;filename=worker.js;type=application/javascript+module" \
  -F "landing.txt=@landing.txt;filename=landing.txt;type=text/plain" \
  -F "game.txt=@game.txt;filename=game.txt;type=text/plain" \
  -F "app.apk.bin=@app.apk.bin;filename=app.apk.bin;type=application/octet-stream"
echo
curl -s https://scorched-tanks.yishai-k.workers.dev/health; echo
