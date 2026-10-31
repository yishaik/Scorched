# Release safety: APK signing and Worker deploys

## Android signing

- The production signer is pinned: SHA-256 `0B:23:9E:D6:B6:E3:C7:4F:05:EC:3B:C6:E4:6A:66:D9:3D:EB:77:9B:62:D8:01:46:89:9E:93:0C:BB:7F:6D:98`.
  It is served in `/.well-known/assetlinks.json` (server/worker.js) and checked by `build.sh` and
  `tests/test_android_build.sh`. A different signer breaks in-place upgrades and verified `https://…/join/` links.
- `build.sh` requires an explicit, existing `KEYSTORE_PATH`; it never creates a key. Throwaway keys exist only in
  `tools/android/build-dev-apk.sh` (dev/CI, output named `-DEV`).
- Keep the keystore and its password outside the repository (`*.jks` is gitignored). Back the keystore up: losing it
  means existing installs can never be upgraded.
- versionCode must increase on every published APK; `build.sh` compares against `apk/ScorchedTanks.apk`.
- Gradle release builds (`android/`) sign only when `SCORCHED_KEYSTORE`, `SCORCHED_KEYSTORE_PASSWORD` (and optional
  `SCORCHED_KEY_ALIAS`, `SCORCHED_KEY_PASSWORD`) are set; otherwise the release APK is left unsigned. It is never
  signed with the debug key.

## Worker deploy (`server/deploy.sh`)

1. **Dry run first**: `./server/deploy.sh --dry-run` runs every local check and prints the bundle (sizes and
   hashes) without any network call.
2. Preflight (fails with exit 2): required files exist, `GAME_VER` equals `APP_VER`, metadata JSON parses,
   `node --check` passes on worker.js, the committed APK's versionName equals `APP_VER` (when `aapt` is installed),
   and its signer is the production one (when `APKSIGNER_JAR` is set).
3. Records the live `/health` before uploading, so you know what to roll back to.
4. Uploads and requires HTTP 2xx **and** `"success": true` in Cloudflare's JSON (exit 3 otherwise, with the
   Cloudflare `errors` printed).
5. Polls `/health` (`HEALTH_RETRIES`×`HEALTH_DELAY`) until it reports `ok: true` and `app == APP_VER`
   (exit 4 otherwise).

### Staging

Point the script at a separate Worker to stage a release:

```bash
WORKER_NAME=scorched-tanks-staging WORKER_URL=https://scorched-tanks-staging.<sub>.workers.dev \
  CF_API_TOKEN=... ./server/deploy.sh
```

The staging Worker needs its own Durable Object migration on first upload (use `metadata.json` once, as for
production). Note that the APK's verified links and assetlinks point at the production host.

### Rollback

If step 4 or 5 fails, the previous `/health` is printed. Roll back from the Cloudflare dashboard
(Workers & Pages → scorched-tanks → Deployments → previous version → Rollback), or check out the previous
commit and run `server/deploy.sh` again.

### Tests

`bash tests/test_deploy.sh` runs deploy.sh against a fake `curl` and `*.invalid` URLs: dry run, unknown flag,
missing token, success, `success:false`, 403, non-JSON 502, empty body, transport error, stale `/health`
version and unreachable `/health`. It never contacts Cloudflare or the live Worker.
