// Runs server/worker.js LOCALLY under wrangler dev (workerd + local Durable Objects) for the online E2E test.
// Never deploys, never needs a Cloudflare login, never touches production. State lives in a temp dir.
// Usage: node support/worker-dev.mjs [port]
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const port = String(+(process.argv[2] || process.env.ST_WORKER_PORT || 8787));
const dir = mkdtempSync(join(tmpdir(), "st-worker-"));
copyFileSync(join(repo, "server", "worker.js"), join(dir, "worker.js"));
// the three asset modules worker.js imports (deploy.sh normally stages these); stubs are enough for room tests
writeFileSync(join(dir, "landing.txt"), "<!doctype html><title>landing (local test)</title>");
copyFileSync(join(repo, "game", "index.html"), join(dir, "game.txt"));
writeFileSync(join(dir, "app.apk.bin"), Buffer.alloc(0));
writeFileSync(join(dir, "wrangler.toml"), `
name = "scorched-tanks-local-test"
main = "worker.js"
compatibility_date = "2026-09-01"
workers_dev = false
send_metrics = false

[[rules]]
type = "Text"
globs = ["**/*.txt"]
fallthrough = false

[[rules]]
type = "Data"
globs = ["**/*.bin"]
fallthrough = false

[[durable_objects.bindings]]
name = "ROOM"
class_name = "Room"

[[durable_objects.bindings]]
name = "LOBBY"
class_name = "Lobby"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Room", "Lobby"]
`);
mkdirSync(join(dir, "state"));
const bin = join(here, "..", "node_modules", ".bin", "wrangler");
const child = spawn(bin, ["dev", "--local", "--ip", "127.0.0.1", "--port", port, "--persist-to", join(dir, "state"), "--log-level", "warn", "--show-interactive-dev-session=false"], {
  cwd: dir, stdio: "inherit",
  env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1", NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" },
});
const stop = () => { try { child.kill("SIGTERM"); } catch (e) {} };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
child.on("exit", (c) => { try { rmSync(dir, { recursive: true, force: true }); } catch (e) {} process.exit(c ?? 0); });
