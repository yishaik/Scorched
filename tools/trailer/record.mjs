// Record real Scorched Tanks gameplay (browser build) for the Play Store trailer.
// Usage (from the repo root, after `npm ci` in tests/e2e):
//   OUT=/workspace/scorched-trailer node tools/trailer/record.mjs
//
// Writes raw WebM clips, an optional WebAudio capture, stills and edit.json
// under $OUT/raw. Does not talk to the production Worker: the optional lobby
// clip uses a local wrangler dev process. Does not upload anything.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve, extname, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const OUT = resolve(process.env.OUT || "/workspace/scorched-trailer");
const RAW = join(OUT, "raw");
const PORT = +(process.env.ST_PORT || 4277);
const WORKER_PORT = +(process.env.ST_WORKER_PORT || 8788);
const SEED = +(process.env.ST_SEED || 20261117);
const TANKS = +(process.env.ST_TANKS || 6);
const skipLobby = process.env.ST_SKIP_LOBBY === "1";
const require = createRequire(join(repo, "tests/e2e/package.json"));
const { chromium } = require("playwright");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

async function serveGame() {
  const root = resolve(repo, "game");
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p === "/" || p === "/play") p = "/index.html";
      const f = normalize(join(root, p));
      if (!f.startsWith(root)) { res.writeHead(403).end(); return; }
      let body = await readFile(f);
      // Recording-only: add a test-hook helper that ends the round with the
      // living human as the winner. The on-disk game/index.html is not changed.
      if (/\/index\.html$/.test(f)) {
        const needle = "window.__ST_TEST__ = Object.freeze({";
        const inject = `window.__ST_TEST__ = Object.freeze({
            forceHumanWin() {
              const human = tanks.find((t) => t.health > 0 && !t.p.cpu);
              if (!human) return { ok: false, reason: "no living human" };
              for (const t of tanks) { if (t !== human) t.health = 0; }
              gameOver(human);
              return { ok: true, winner: human.name, type: human.p.type };
            },`;
        const html = body.toString("utf8");
        if (html.includes(needle)) body = Buffer.from(html.replace(needle, inject));
      }
      res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch (e) {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  return server;
}

function startWorker() {
  const script = join(repo, "tests/e2e/support/worker-dev.mjs");
  const child = spawn(process.execPath, [script, String(WORKER_PORT)], {
    stdio: "inherit",
    env: { ...process.env, ST_WORKER_PORT: String(WORKER_PORT), WRANGLER_SEND_METRICS: "false", CI: "1" },
  });
  return child;
}

async function waitHealth(url, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch (e) {}
    await sleep(400);
  }
  throw new Error("local worker did not become healthy: " + url);
}

const state = (page) => page.evaluate(() => window.__ST_TEST__.state());

async function setOpt(page, key, value) {
  const btn = page.locator(`[data-opt="${key}"]`);
  for (let i = 0; i < 10; i++) {
    const t = await btn.innerText();
    if (t.includes(value)) return;
    await btn.click();
  }
  throw new Error(`could not set ${key} to ${value}`);
}

async function startAudio(page) {
  return page.evaluate(async () => {
    const rec = window.__ST_REC__;
    if (!rec || !rec.dest) return { ok: false, reason: "no tap" };
    if (rec.ctx.state === "suspended") await rec.ctx.resume();
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");
    if (!mime) return { ok: false, reason: "no MediaRecorder mime" };
    const chunks = [];
    const mr = new MediaRecorder(rec.dest.stream, { mimeType: mime });
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    window.__ST_AUDIO_CHUNKS__ = chunks;
    window.__ST_AUDIO_MR__ = mr;
    mr.start(100);
    return { ok: true, mime, ctx: rec.ctx.state };
  });
}

async function stopAudio(page, dest) {
  const b64 = await page.evaluate(async () => {
    const mr = window.__ST_AUDIO_MR__;
    if (!mr) return null;
    await new Promise((res) => {
      mr.onstop = res;
      try { mr.stop(); } catch (e) { res(); }
    });
    const chunks = window.__ST_AUDIO_CHUNKS__ || [];
    if (!chunks.length) return "";
    const blob = new Blob(chunks, { type: "audio/webm" });
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let s = "";
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    }
    return btoa(s);
  });
  if (b64 == null) return { ok: false, bytes: 0 };
  const buf = Buffer.from(b64, "base64");
  if (buf.length) await writeFile(dest, buf);
  return { ok: buf.length > 0, bytes: buf.length, path: dest };
}

async function waitMyTurn(page, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await state(page);
    if (s.screen === "roundOver" || s.screen === "standings" || s.state === "over") return s;
    if (s.screen === "play" && s.myTurn) return s;
    if (s.screen === "play") {
      await page.evaluate(() => {
        const T = window.__ST_TEST__, s = T.state();
        if (s.state === "play" && !s.myTurn) T.settle(90);
      });
    }
    await sleep(40);
  }
  return state(page);
}

async function fireWeapon(page, name, mode = "tank") {
  return page.evaluate(({ name, mode }) => {
    const T = window.__ST_TEST__, s = T.state();
    if (!s.myTurn) return { ok: false, reason: "not my turn", screen: s.screen };
    const W = T.weapons();
    const w = W.find((x) => x.name === name);
    if (!w) return { ok: false, reason: "unknown weapon " + name };
    const me = s.tanks[s.turn];
    if (!me || me.stock && false) {}
    const stock = s.players.find((p) => p.name === me.name)?.stock?.[w.i];
    if (stock === 0) return { ok: false, reason: "no stock of " + name, stock };
    const foes = s.tanks.filter((t) => t.alive && t.i !== s.turn).sort((a, b) => Math.abs(a.x - me.x) - Math.abs(b.x - me.x));
    let angle = me.x < s.world.W / 2 ? 62 : 118, power = 72;
    if (mode === "tank" && foes[0]) {
      const sol = T.solve(foes[0].i);
      if (sol) { angle = sol.angle; power = sol.power; }
    } else if (mode === "hill") {
      // high arc toward mid-field so the blast is visible without necessarily ending the round
      angle = me.x < s.world.W / 2 ? 68 : 112;
      power = 58;
    } else if (mode === "arc" && foes[0]) {
      const sol = T.solve(foes[0].i);
      if (sol) {
        angle = sol.angle;
        power = Math.min(100, sol.power + 6);
        if (me.x < s.world.W / 2) angle = Math.min(80, angle + 8);
        else angle = Math.max(100, angle - 8);
      }
    } else if (mode === "napalm") {
      // High readable arc toward a mid-field living foe so the fire sits on a slope, not at the edge.
      const mid = foes.filter((t) => t.x > s.world.W * 0.28 && t.x < s.world.W * 0.82);
      const target = mid[0] || foes[0];
      if (target) {
        const sol = T.solve(target.i);
        if (sol) {
          angle = me.x < s.world.W / 2 ? Math.min(82, sol.angle + 12) : Math.max(98, sol.angle - 12);
          power = Math.max(48, Math.min(82, sol.power - 2));
        }
      } else {
        angle = me.x < s.world.W / 2 ? 72 : 108;
        power = 64;
      }
    }
    const aimed = T.aim({ weapon: w.i, angle, power });
    const fired = aimed && T.fire();
    return { ok: !!fired, aimed, weapon: name, angle, power, stock };
  }, { name, mode });
}

function clock(t0) {
  return (Date.now() - t0) / 1000;
}

async function main() {
  await mkdir(RAW, { recursive: true });
  const server = await serveGame();
  let worker = null;
  const marks = [];
  const clips = [];
  const issues = [];
  const note = (id, extra) => { const rec = { id, t: 0, ...extra }; marks.push(rec); console.log("mark", rec); };

  try {
    const browser = await chromium.launch({
      headless: true,
      args: [
        "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage",
        "--no-sandbox",
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      recordVideo: { dir: join(RAW, "video"), size: { width: 1920, height: 1080 } },
    });

    // Tap WebAudio: anything connected to the context destination is also
    // mirrored into a MediaStream we can MediaRecorder.
    await context.addInitScript(() => {
      try {
        localStorage.setItem("st-muted", "0");
        localStorage.setItem("st-gfx", "modern");
      } catch (e) {}
      const Orig = window.AudioContext || window.webkitAudioContext;
      if (!Orig) return;
      const origConnect = AudioNode.prototype.connect;
      function Patched(...args) {
        const ctx = new Orig(...args);
        const dest = ctx.createMediaStreamDestination();
        window.__ST_REC__ = { ctx, dest };
        return ctx;
      }
      Patched.prototype = Orig.prototype;
      window.AudioContext = Patched;
      window.webkitAudioContext = Patched;
      AudioNode.prototype.connect = function (target, ...rest) {
        const out = origConnect.call(this, target, ...rest);
        const rec = window.__ST_REC__;
        if (rec && target === this.context.destination) {
          try { origConnect.call(this, rec.dest, ...rest); } catch (e) {}
        }
        return out;
      };
    });

    // Allow Google Fonts so the HUD matches the shipping game; never hit production.
    await context.route((u) => !/^(127\.0\.0\.1|localhost)$/.test(u.hostname), (route) => {
      const u = route.request().url();
      if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return route.continue();
      return route.abort("blockedbyclient");
    });

    const page = await context.newPage();
    const videoT0 = Date.now();
    const mark = (id, extra = {}) => {
      const rec = { id, t: clock(videoT0), ...extra };
      marks.push(rec);
      console.log("mark", rec);
    };

    await page.goto(`http://127.0.0.1:${PORT}/index.html?test=1`);
    await page.waitForFunction(() => typeof window.__ST_TEST__ === "object");
    await page.locator("#title").click();
    const audioInfo = await startAudio(page);
    const audioT0 = Date.now();
    console.log("audio start", audioInfo, "offsetMs", audioT0 - videoT0);
    if (!audioInfo.ok) issues.push("WebAudio MediaRecorder did not start: " + (audioInfo.reason || "unknown"));
    await page.locator("#menu").waitFor({ state: "visible" });

    await page.locator("#vsCpu").click();
    await page.locator("#setup").waitFor({ state: "visible" });
    for (let k = 0; k < 10; k++) await page.locator('[data-set="r-"]').click();
    await page.locator('[data-set="r+"]').click(); // 1 round is enough
    for (let k = 2; k < TANKS; k++) await page.locator('[data-set="n+"]').click();
    await setOpt(page, "wind", "None");
    await setOpt(page, "terrain", "Mountains");
    await setOpt(page, "sky", "Gradient");
    await page.evaluate((s) => window.__ST_TEST__.seed(s), SEED);
    await page.locator("#startMatch").click();
    await page.locator("#shop").waitFor({ state: "visible" });

    const weapons = await page.evaluate(() => window.__ST_TEST__.weapons());
    const want = ["Nuke", "MIRV", "Hot Napalm", "Roller", "Digger"];
    mark("shop_start");
    await sleep(400);
    for (const name of want) {
      const w = weapons.find((x) => x.name === name);
      if (!w) { issues.push("weapon missing from shop: " + name); continue; }
      const btn = page.locator(`#shopList [data-buy="${w.i}"]`);
      await btn.scrollIntoViewIfNeeded();
      await sleep(280);
      await btn.click();
      await sleep(180);
    }
    await page.screenshot({ path: join(RAW, "still-shop.png") });
    await sleep(400);
    mark("shop_end");
    await page.locator("#shopDone").click();
    await page.locator("#confirmYes").click();
    await page.waitForFunction(() => window.__ST_TEST__.state().screen === "play", { timeout: 15000 });
    await sleep(400);
    await page.screenshot({ path: join(RAW, "still-battlefield.png") });

    const shots = [
      { id: "hook", weapon: "Nuke", mode: "tank", hang: 1400, still: "still-hook.png" },
      { id: "mirv", weapon: "MIRV", mode: "arc", hang: 800, still: "still-mirv.png" },
      // stillAt: grab the frame mid-burn, before waitSettled lets the fire die out
      { id: "napalm", weapon: "Hot Napalm", mode: "napalm", hang: 800, stillAt: 4800, still: "still-napalm.png" },
      { id: "roller", weapon: "Roller", mode: "tank", hang: 800, still: "still-roller.png" },
      { id: "digger", weapon: "Digger", mode: "hill", hang: 1200, still: "still-digger.png" },
    ];

    for (const shot of shots) {
      const turn = await waitMyTurn(page);
      if (turn.screen === "roundOver" || turn.state === "over") {
        issues.push(`round ended before ${shot.id} (${shot.weapon})`);
        break;
      }
      mark(shot.id + "_start", { weapon: shot.weapon });
      const r = await fireWeapon(page, shot.weapon, shot.mode);
      console.log("fire", shot, r);
      if (!r.ok) {
        issues.push(`${shot.weapon} fire failed: ${r.reason || JSON.stringify(r)}`);
        mark(shot.id + "_end", { failed: true });
        continue;
      }
      if (shot.stillAt) {
        await sleep(shot.stillAt);
        if (shot.still) await page.screenshot({ path: join(RAW, shot.still) });
      }
      const settled = await page.evaluate((ms) => window.__ST_TEST__.waitSettled(ms), 20000);
      if (settled.timedOut) issues.push(`${shot.weapon} waitSettled timed out`);
      await sleep(shot.hang || 0);
      if (shot.still && !shot.stillAt) await page.screenshot({ path: join(RAW, shot.still) });
      mark(shot.id + "_end");
    }

    // End the round with the living human as the winner (never a CPU).
    const forced = await page.evaluate(() => {
      const T = window.__ST_TEST__;
      if (typeof T.forceHumanWin !== "function") return { ok: false, reason: "no forceHumanWin hook" };
      return T.forceHumanWin();
    });
    console.log("forceHumanWin", forced);
    if (!forced || !forced.ok) {
      issues.push("forceHumanWin failed: " + JSON.stringify(forced));
    }
    const after = await state(page);
    if (after.screen === "roundOver" || after.state === "over") {
      await page.locator("#win").waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
      const winText = (after.winText || "") + " " + ((await page.locator("#winText").textContent().catch(() => "")) || "");
      if (!/Player 1/i.test(winText) || /\b(Shooter|Moron|Poolshark|Tosser|Chooser|Spoiler|Cyborg)\b/i.test(winText)) {
        issues.push("win screen is not a human winner: " + winText.trim());
      }
      mark("win_start");
      await sleep(400);
      await page.screenshot({ path: join(RAW, "still-win.png") });
      await sleep(2400);
      mark("win_end");
    } else {
      issues.push("round result screen was not reached; last screen=" + after.screen + " state=" + after.state);
    }

    const audioPath = join(RAW, "gameplay-audio.webm");
    const audioStop = await stopAudio(page, audioPath);
    console.log("audio stop", audioStop);

    await page.close();
    const videoPath = await page.video().path();
    await context.close();
    // Move the finalized video to a stable name.
    const gameplayVideo = join(RAW, "gameplay.webm");
    if (videoPath && existsSync(videoPath)) {
      const { copyFile, unlink } = await import("node:fs/promises");
      await copyFile(videoPath, gameplayVideo);
      try { await unlink(videoPath); } catch (e) {}
    } else {
      issues.push("Playwright did not produce a gameplay video");
    }

    // --- optional online lobby clip (local Worker only) ---
    let lobbyVideo = null;
    if (!skipLobby) {
      try {
        worker = startWorker();
        await waitHealth(`http://127.0.0.1:${WORKER_PORT}/health`);
        const { WebSocket } = globalThis;
        const lobbyCtx = await browser.newContext({
          viewport: { width: 1920, height: 1080 },
          deviceScaleFactor: 1,
          recordVideo: { dir: join(RAW, "video"), size: { width: 1920, height: 1080 } },
        });
        const guestCtx = await browser.newContext({
          viewport: { width: 1920, height: 1080 },
          deviceScaleFactor: 1,
        });
        const PROD_HOST = "scorched-tanks.yishai-k.workers.dev";
        const WORKER = `127.0.0.1:${WORKER_PORT}`;
        for (const ctx of [lobbyCtx, guestCtx]) {
          // Generic display names only — never real people in the trailer.
          await ctx.addInitScript((n) => {
            try { localStorage.setItem("st-name", n); localStorage.setItem("st-gfx", "modern"); } catch (e) {}
          }, ctx === lobbyCtx ? "Commander" : "Gunner");
          await ctx.routeWebSocket(/^wss?:\/\/scorched-tanks\.yishai-k\.workers\.dev\//, (route) => {
            const u = new URL(route.url());
            const up = new WebSocket(`ws://${WORKER}${u.pathname}${u.search}`);
            const pending = [];
            up.onopen = () => { while (pending.length) up.send(pending.shift()); };
            up.onmessage = (e) => route.send(typeof e.data === "string" ? e.data : Buffer.from(e.data));
            up.onclose = (e) => route.close({ code: e.code >= 3000 || e.code === 1000 ? e.code : 1000, reason: e.reason }).catch(() => {});
            up.onerror = () => {};
            route.onMessage((m) => (up.readyState === 1 ? up.send(m) : pending.push(m)));
            route.onClose((code, reason) => { try { up.close(code >= 3000 || code === 1000 ? code : 1000, reason); } catch (e) {} });
          });
          await ctx.route((u) => !/^(127\.0\.0\.1|localhost)$/.test(u.hostname), async (route) => {
            const u = new URL(route.request().url());
            if (/fonts\.(googleapis|gstatic)\.com/.test(u.host)) return route.continue();
            if (u.host === PROD_HOST && u.pathname.startsWith("/api/")) {
              const r = await route.fetch({ url: `http://${WORKER}${u.pathname}${u.search}` });
              return route.fulfill({ response: r });
            }
            return route.abort("blockedbyclient");
          });
        }
        const host = await lobbyCtx.newPage();
        const lobbyT0 = Date.now();
        await host.goto(`http://127.0.0.1:${PORT}/index.html?test=1`);
        await host.waitForFunction(() => typeof window.__ST_TEST__ === "object");
        await host.locator("#title").click();
        await host.locator("#vsNet").click();
        await host.locator("#netOnline").waitFor({ state: "visible" });
        await host.locator("#netCreateBtn").click();
        await host.locator("#netLobby").waitFor({ state: "visible", timeout: 20000 });
        await host.locator("#nlCode").waitFor({ state: "visible" });
        const code = (await host.locator("#nlCode").textContent()).trim();
        const guest = await guestCtx.newPage();
        await guest.goto(`http://127.0.0.1:${PORT}/index.html?test=1`);
        await guest.locator("#title").click();
        await guest.locator("#vsNet").click();
        await guest.locator("#netCode").fill(code);
        await guest.locator("#netJoinBtn").click();
        await host.locator("#nlList").filter({ hasText: "Gunner" }).waitFor({ timeout: 15000 });
        const lobbyStart = (Date.now() - lobbyT0) / 1000;
        await sleep(400);
        await host.screenshot({ path: join(RAW, "still-lobby.png") });
        await sleep(2800);
        const lobbyEnd = (Date.now() - lobbyT0) / 1000;
        await host.close();
        const lv = await host.video().path();
        await lobbyCtx.close();
        await guestCtx.close();
        lobbyVideo = join(RAW, "lobby.webm");
        if (lv && existsSync(lv)) {
          const { copyFile, unlink } = await import("node:fs/promises");
          await copyFile(lv, lobbyVideo);
          try { await unlink(lv); } catch (e) {}
        }
        clips.push({ id: "lobby", file: "lobby.webm", start: Math.max(0, lobbyStart), end: lobbyEnd, source: "lobby" });
        marks.push({ id: "lobby_start", t: lobbyStart, file: "lobby.webm" });
        marks.push({ id: "lobby_end", t: lobbyEnd, file: "lobby.webm" });
        console.log("lobby clip", code, lobbyStart, lobbyEnd);
      } catch (e) {
        issues.push("lobby clip failed (local worker): " + e.message);
        console.error(e);
      }
    }

    await browser.close();

    const pair = (id) => {
      const a = marks.find((m) => m.id === id + "_start");
      const b = marks.find((m) => m.id === id + "_end");
      if (!a || !b || b.t <= a.t) return null;
      return { id, file: "gameplay.webm", start: a.t, end: b.t, source: "gameplay" };
    };
    for (const id of ["shop", "hook", "mirv", "napalm", "roller", "digger", "win"]) {
      const c = pair(id);
      if (c) clips.push(c);
    }

    const edit = {
      recordedAt: new Date().toISOString(),
      seed: SEED,
      tanks: TANKS,
      viewport: { width: 1920, height: 1080 },
      videoT0,
      audioT0,
      audioOffsetMs: audioT0 - videoT0,
      audio: audioStop.ok ? "gameplay-audio.webm" : null,
      audioBytes: audioStop.bytes || 0,
      gameplay: existsSync(gameplayVideo) ? "gameplay.webm" : null,
      lobby: lobbyVideo && existsSync(lobbyVideo) ? "lobby.webm" : null,
      marks,
      clips,
      issues,
    };
    await writeFile(join(RAW, "edit.json"), JSON.stringify(edit, null, 2));
    console.log("wrote", join(RAW, "edit.json"));
    console.log("clips", clips);
    console.log("issues", issues);
  } finally {
    try { server.close(); } catch (e) {}
    if (worker) {
      try { worker.kill("SIGTERM"); } catch (e) {}
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
