// Helpers to pull code out of the single-file game (game/index.html) for Node tests.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../..", import.meta.url));
export const html = () => readFileSync(root + "game/index.html", "utf8");

// every inline <script> body (scripts with src= are skipped)
export function inlineScripts(h = html()) {
  const out = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(h))) if (!/\bsrc=/.test(m[1] || "") && m[2].trim()) out.push(m[2]);
  return out;
}

// text from the first `start` marker through the end of the balanced block that follows it
export function block(src, start) {
  const i = src.indexOf(start);
  if (i < 0) throw new Error("marker not found: " + start);
  let j = src.indexOf("{", i), k = src.indexOf("[", i);
  const open = k >= 0 && (j < 0 || k < j) && /=\s*\[$/.test(src.slice(i, k + 1)) ? "[" : "{";
  j = open === "[" ? k : j;
  const close = open === "[" ? "]" : "}";
  let depth = 0, q = null;
  for (let p = j; p < src.length; p++) {
    const c = src[p];
    if (q) { if (c === "\\") p++; else if (c === q) q = null; continue; }
    if (c === "/" && src[p + 1] === "/") { p = src.indexOf("\n", p); if (p < 0) break; continue; }
    if (c === "/" && src[p + 1] === "*") { p = src.indexOf("*/", p + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) {
      let e = p + 1;
      while (src[e] === ")" || src[e] === ";") e++;
      return src.slice(i, e);
    }
  }
  throw new Error("unbalanced block: " + start);
}
