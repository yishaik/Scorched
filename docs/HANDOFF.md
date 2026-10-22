# Handoff — Scorched Tanks (2026-10-19)

## Current state
- **v1.11 is live** at https://scorched-tanks.yishai-k.workers.dev:
  - `/` landing, `/play` browser game, `/download` APK, `/join/CODE` room invites, `/health` version check.
- Server: Cloudflare Worker **`scorched-tanks`** with Durable Objects **`Lobby`** (matchmaking) and **`Room`** (roster, relay, host, snapshots).
- Android APK `com.yishai.scorchedtanks` (versionCode 11) is in `apk/`. According to a Family Link notice on 2026-10-18, it was installed on Maayan's phone.
- In progress: nothing. No feature work is underway.

## Repo
- Only `main` exists (initial import of v1.11, `b8dfdfc`). There are no other branches or PRs except this handoff PR (`docs/handoff`).

## Backups
- Drive folder: https://drive.google.com/drive/folders/1EcwcT79F1iFWtzCUGGhhlznfbt_kqFGX holds backup zips up to v11, the APK and the docs.
- **Those Drive docs and backups still contain the keystore password, so treat them as private.** Never copy them into this repo as-is.

## Proposed definition of done (NOT yet confirmed by Yishai)
1. v1.12 runs stably on Maayan's phone after a real-device playtest.
2. Fix: settings not persisting between launches.
3. Fix: rotating mid-round stretches the terrain.
4. One full online game between 2 phones, joined through an invite link.

## Known issues
These come from `DOCS.md` "Known gaps", which was written around v1.4, so some may already be fixed. Verify each one before working on it.
- Not playtested thoroughly on a real device.
- Walls don't affect Rollers and Diggers.
- The Cavern ceiling doesn't fall.
- Max power doesn't drop with damage.
- Settings aren't saved between launches. The APK enables DOM storage, so localStorage can be used.
- Rotation mid-round stretches the terrain instead of regenerating it.

## Secrets and env vars (names only, no values in this repo)
| Name | What | Where it lives |
|---|---|---|
| `KS_PASS` | Keystore password (store and key) for `build.sh` | Kept privately by Yishai |
| `key.jks` | APK signing key, alias `st`. Losing it means updates won't install over existing installs | Kept out of git (`.gitignore`), held privately |
| `CF_API_TOKEN` | Cloudflare API token for `server/deploy.sh` | Kept privately by Yishai |

The Cloudflare account id is listed in `DEPLOY.md`.

## Build / run / test
- **Play locally:** open `game/index.html` in a browser. Local and CPU play works offline, and online mode connects to the live worker.
- **Build APK:** set up the prerequisites in `DEPLOY.md`, edit the paths at the top of `build.sh`, put `key.jks` at `$A/key.jks`, then run `KS_PASS=<password> VC=12 ./build.sh` and copy the output to `apk/ScorchedTanks.apk`.
- **Deploy:** `CF_API_TOKEN=<token> ./server/deploy.sh`. Use `meta-update.json` for later deploys, and do not resend migrations.
- **Verify:** `curl https://scorched-tanks.yishai-k.workers.dev/health` should show the new `app` version.
- **Tests:** there are no automated tests. `android/.github/workflows/build.yml` is not at the repo root, so GitHub Actions never runs it.

## Next steps
1. Get Yishai to confirm or adjust the definition of done.
2. Playtest v1.11 on a real phone and re-check the known issues list.
3. Fix settings persistence and the rotation terrain stretch, then release v1.12 following the checklist in `DEPLOY.md`.
4. Run a 2-phone online game through an invite link.
5. Optional: move the CI workflow to `.github/workflows/` at the root and add a smoke test, for example a `/health` check.
