// Shared helpers for the portable Node tests (no browser, no dependencies).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

export function match1(text, re, what) {
  const m = text.match(re);
  if (!m) throw new Error(`${what} not found`);
  return m[1];
}

// Inline <script> blocks (no src attribute) of an HTML file, with their start line.
export function inlineScripts(html) {
  const out = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] && /\bsrc\s*=/.test(m[1])) continue;
    if (m[1] && /type\s*=\s*["'](?!text\/javascript|module)/i.test(m[1])) continue;
    out.push({ code: m[2], line: html.slice(0, m.index).split('\n').length });
  }
  return out;
}

// Source of `function name(...) {...}` in the game, by brace matching.
export function grab(src, name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`function ${name}() not found`);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error(`unbalanced braces in ${name}()`);
}
