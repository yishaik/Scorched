// Drives the app's real Android WebView over the DevTools protocol (debug builds only: a debuggable app's WebView
// exposes webview_devtools_remote_<pid>). No dependencies: Node 22's fetch + WebSocket.
// Usage: node webview-cdp.mjs <port> <command> [arg]
//   info                       print {href, title visible, hook type, GAME_VER, st-pid, marker}
//   set-marker <value>         localStorage st-e2e-marker = value
//   play                       reload with window.__ST_TEST_FLAG__ = true, play a local CPU round to a winner via the
//                              test hook, print the result, then reload without the flag
//   world                      print the current world/stage sizes (needs the hook active)
const [port, cmd, arg] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;

async function target() {
  for (let k = 0; k < 30; k++) {
    try {
      const list = await (await fetch(`${base}/json/list`)).json();
      const t = list.find((x) => x.type === "page" && /android_asset\/index\.html/.test(x.url)) || list.find((x) => x.type === "page");
      if (t && t.webSocketDebuggerUrl) return t;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("no WebView page on the DevTools socket");
}

async function session() {
  const t = await target();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("CDP socket error")); });
  let id = 0;
  const wait = new Map(), events = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
    else if (m.method) events.push(m);
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    wait.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expression, awaitPromise = true) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error("page exception: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  return { ws, send, evaluate, events };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INFO = `(() => { const t = document.getElementById("title"); return { href: location.href, ready: document.readyState,
  titleVisible: !!t && !t.hidden, menuVisible: !!document.getElementById("menu") && !document.getElementById("menu").hidden,
  hook: typeof window.__ST_TEST__, ver: typeof GAME_VER === "string" ? GAME_VER : null,
  pid: localStorage.getItem("st-pid"), marker: localStorage.getItem("st-e2e-marker"),
  canvas: (() => { const c = document.getElementById("cv"); return c ? [c.width, c.height] : null; })() }; })()`;

async function reload(s, flag) {
  if (flag) {
    const { identifier } = await s.send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__ST_TEST_FLAG__ = true;" });
    s.flagId = identifier;
  } else if (s.flagId) {
    await s.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: s.flagId });
  }
  await s.send("Page.reload", { ignoreCache: true });
  for (let k = 0; k < 40; k++) {
    await sleep(500);
    try { const r = await s.evaluate("document.readyState"); if (r === "complete") break; } catch (e) {}
  }
}

const s = await session();
let out;
try {
  if (cmd === "info") out = await s.evaluate(INFO);
  else if (cmd === "set-marker") out = await s.evaluate(`localStorage.setItem("st-e2e-marker", ${JSON.stringify(arg || "1")}); localStorage.getItem("st-e2e-marker")`);
  else if (cmd === "world") out = await s.evaluate(`window.__ST_TEST__ ? window.__ST_TEST__.state().world : null`);
  else if (cmd === "play") {
    await reload(s, true);
    const hook = await s.evaluate("typeof window.__ST_TEST__");
    if (hook !== "object") throw new Error("test hook did not activate with the WebView flag: " + hook);
    out = await s.evaluate(`(async () => {
      const T = window.__ST_TEST__, $ = (id) => document.getElementById(id), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      $("title").click(); await sleep(300);
      $("vsCpu").click(); await sleep(300);
      T.seed(777);
      $("startMatch").click(); await sleep(300);
      for (let k = 0; k < 20 && T.state().screen !== "play"; k++) {
        if (!$("shopConfirm").hidden) $("confirmYes").click();
        else if (!$("shopDone").hidden && $("shopReady").hidden) $("shopDone").click();
        await sleep(400);
      }
      const start = T.state();
      if (start.screen !== "play") return { ok: false, why: "round did not start", screen: start.screen };
      let s = T.settle();
      for (let k = 0; k < 120 && s.state === "play"; k++) {
        if (s.myTurn) {
          const foe = s.tanks.find((t) => t.alive && t.i !== s.turn);
          const sol = T.solve(foe.i);
          T.aim({ angle: sol.angle, power: sol.power }); T.fire();
        }
        s = T.settle(120);
        await sleep(0);
      }
      await sleep(500);
      return { ok: s.state === "over", winText: $("winText").textContent, round: s.round, tanks: s.tanks.map((t) => [t.name, t.hp]),
        world: start.world };
    })()`);
    // the visible result stays on screen for the screenshot; the caller reloads without the flag afterwards
  } else if (cmd === "unflag") {
    await reload(s, false);
    out = await s.evaluate(INFO);
  } else throw new Error("unknown command " + cmd);
  console.log(JSON.stringify(out));
} finally {
  s.ws.close();
}
