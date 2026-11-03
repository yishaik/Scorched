// Store-readiness gate for the release AAB (Google Play). Read-only: never signs, uploads or publishes.
// Usage:
//   node tests/android/store-gate.mjs --aab app-release.aab --bundletool bundletool.jar [--last-vc 16] [--strict]
//   node tests/android/store-gate.mjs --manifest manifest.xml --entries entries.txt [...]   (fixtures; tests/node)
// Checks: package name; minSdk == 24; targetSdk >= 36; versionCode == GAME_VER patch and versionName == GAME_VER;
// versionCode > last released (equal = "no version bump": a warning, or a failure with --strict / STORE_GATE_STRICT=1);
// no permissions beyond the allowlist; not debuggable; no native .so (or every .so 16 KB page-aligned);
// base/assets carry game/ byte-identical.
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PACKAGE = "com.yishai.scorchedtanks";
export const MIN_SDK = 24, TARGET_SDK_MIN = 36;
export const ALLOWED_PERMISSIONS = ["android.permission.INTERNET"];

const attr = (xml, re) => { const m = xml.match(re); return m ? m[1] : null; };
export function parseManifest(xml) {
  const tag = (xml.match(/<manifest\b[^>]*>/) || [""])[0];
  const sdk = (xml.match(/<uses-sdk\b[^>]*>/) || [""])[0];
  const app = (xml.match(/<application\b[^>]*>/) || [""])[0];
  return {
    package: attr(tag, /\bpackage="([^"]+)"/),
    versionCode: +attr(tag, /android:versionCode="(\d+)"/),
    versionName: attr(tag, /android:versionName="([^"]+)"/),
    minSdk: +attr(sdk, /android:minSdkVersion="(\d+)"/),
    targetSdk: +attr(sdk, /android:targetSdkVersion="(\d+)"/),
    debuggable: /android:debuggable="true"/.test(app),
    permissions: [...xml.matchAll(/<uses-permission(?:-sdk-23)?\b[^>]*android:name="([^"]+)"/g)].map((m) => m[1]),
  };
}

export function gameVersion(html) {
  const v = (html.match(/const GAME_VER = "([^"]+)"/) || [])[1];
  if (!v) throw new Error("GAME_VER not found in game/index.html");
  return v;
}

// returns { errors, warnings, info }
export function evaluate({ manifest, entries, gameVer, lastVc, strict, soAlign = {}, extraPermissions = [] }) {
  const errors = [], warnings = [], info = [];
  const m = manifest;
  const patch = +gameVer.split(".").pop();
  info.push(`package=${m.package} versionCode=${m.versionCode} versionName=${m.versionName} minSdk=${m.minSdk} targetSdk=${m.targetSdk}`);
  if (m.package !== PACKAGE) errors.push(`package is ${m.package}, expected ${PACKAGE}`);
  if (m.minSdk !== MIN_SDK) errors.push(`minSdk is ${m.minSdk}, expected ${MIN_SDK}`);
  if (!(m.targetSdk >= TARGET_SDK_MIN)) errors.push(`targetSdk is ${m.targetSdk}; Google Play requires >= ${TARGET_SDK_MIN}`);
  if (m.versionCode !== patch) errors.push(`versionCode ${m.versionCode} != GAME_VER ${gameVer} patch (${patch})`);
  if (m.versionName !== gameVer) errors.push(`versionName ${m.versionName} != GAME_VER ${gameVer}`);
  if (Number.isFinite(lastVc) && lastVc > 0) {
    if (m.versionCode < lastVc) errors.push(`versionCode ${m.versionCode} is lower than the last released ${lastVc}`);
    else if (m.versionCode === lastVc) {
      const msg = `versionCode ${m.versionCode} equals the last released ${lastVc}: not a new release (bump GAME_VER, APP_VER, Gradle versionCode/Name and landing together)`;
      (strict ? errors : warnings).push(msg);
    } else info.push(`versionCode ${m.versionCode} > last released ${lastVc}`);
  } else warnings.push("last released versionCode unknown; skipped the upgrade-order check");
  if (m.debuggable) errors.push("release bundle is debuggable");
  const allowed = new Set([...ALLOWED_PERMISSIONS, ...extraPermissions]);
  const extra = m.permissions.filter((p) => !allowed.has(p));
  if (extra.length) errors.push(`unexpected permissions: ${extra.join(", ")} (allowed: ${[...allowed].join(", ")})`);
  const so = entries.filter((e) => /\.so$/.test(e));
  if (!so.length) info.push("no native libraries (.so): 16 KB page-size requirement does not apply");
  for (const e of so) {
    const a = soAlign[e];
    if (a == null) errors.push(`native library ${e}: alignment unknown`);
    else if (a < 16384) errors.push(`native library ${e}: LOAD segment alignment ${a} < 16384 (16 KB page size)`);
  }
  const assets = entries.filter((e) => e.startsWith("base/assets/"));
  if (!assets.includes("base/assets/index.html")) errors.push("base/assets/index.html missing from the bundle");
  return { errors, warnings, info };
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--strict") o.strict = true;
    else if (a.startsWith("--")) o[a.slice(2)] = argv[++i];
  }
  return o;
}

async function main() {
  const o = args(process.argv.slice(2));
  const gameVer = gameVersion(readFileSync(join(ROOT, "game", "index.html"), "utf8"));
  const strict = !!o.strict || process.env.STORE_GATE_STRICT === "1";
  let xml, entries, soAlign = {}, tmp = null;
  if (o.aab) {
    if (!existsSync(o.aab)) throw new Error(`AAB not found: ${o.aab}`);
    xml = execFileSync("java", ["-jar", o.bundletool, "dump", "manifest", "--bundle", o.aab], { encoding: "utf8" });
    entries = execFileSync("unzip", ["-Z1", o.aab], { encoding: "utf8" }).split("\n").filter(Boolean);
    const so = entries.filter((e) => /\.so$/.test(e));
    if (so.length) {
      tmp = mkdtempSync(join(tmpdir(), "gate-"));
      execFileSync("unzip", ["-q", o.aab, ...so, "-d", tmp]);
      for (const e of so) {
        const out = execFileSync("readelf", ["-lW", join(tmp, e)], { encoding: "utf8" });
        const aligns = out.split("\n").filter((l) => /^\s*LOAD\b/.test(l)).map((l) => parseInt(l.trim().split(/\s+/).pop(), 16));
        soAlign[e] = aligns.length ? Math.min(...aligns) : 0;
      }
    }
    // the bundle's game files equal game/
    for (const f of ["index.html", "hark.css", "hark-hero.css", "hark.js"]) {
      const want = readFileSync(join(ROOT, "game", f));
      const got = execFileSync("unzip", ["-p", o.aab, `base/assets/${f}`], { maxBuffer: 64 << 20 });
      if (Buffer.compare(want, got) !== 0) throw new Error(`base/assets/${f} differs from game/${f}`);
    }
  } else {
    xml = readFileSync(o.manifest, "utf8");
    entries = readFileSync(o.entries, "utf8").split("\n").filter(Boolean);
  }
  const lastVc = o["last-vc"] != null ? +o["last-vc"] : NaN;
  const r = evaluate({ manifest: parseManifest(xml), entries, gameVer, lastVc, strict, soAlign, extraPermissions: (process.env.STORE_GATE_ALLOW_PERMISSIONS || "").split(",").filter(Boolean) });
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  r.info.forEach((l) => console.log("ok   " + l));
  r.warnings.forEach((l) => console.log(`${process.env.GITHUB_ACTIONS ? "::warning title=Store gate::" : "WARN "}${l}`));
  r.errors.forEach((l) => console.log(`${process.env.GITHUB_ACTIONS ? "::error title=Store gate::" : "FAIL "}${l}`));
  if (r.errors.length) { console.log(`store gate: ${r.errors.length} problem(s)`); process.exit(1); }
  console.log(`store gate: passed${r.warnings.length ? ` with ${r.warnings.length} warning(s)` : ""}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error("store gate error:", e.message); process.exit(2); });
