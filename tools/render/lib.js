// Shared helpers for the marketing renderers: repo-relative paths, function extraction from
// game/index.html, and a seeded Math.random so every run produces the same pixels.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const GAME_HTML = path.join(ROOT, 'game', 'index.html');

function gameSource() { return fs.readFileSync(GAME_HTML, 'utf8'); }

// Returns the source of `function name(...) { ... }` from the game, or throws if it is gone.
function grab(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(`function ${name}() not found in game/index.html`);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error(`unbalanced braces in function ${name}()`);
}

// Output directory: argv[2], then $RENDER_OUT, then marketing/ in the repo.
function outDir() {
  const dir = path.resolve(process.argv[2] || process.env.RENDER_OUT || path.join(ROOT, 'marketing'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Deterministic randomness and clock (mulberry32, fixed seed).
function seedRandom(seed = 1) {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  global.performance = { now: () => 1234 };
}

module.exports = { ROOT, GAME_HTML, gameSource, grab, outDir, seedRandom };
