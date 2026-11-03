// The opt-in test hook in game/index.html must be inert without ?test=1 (or window.__ST_TEST_FLAG__ === true).
// Runtime proof is in tests/e2e/specs/smoke.spec.mjs; this checks the guard itself with no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read } from './helpers.mjs';

const html = read('game/index.html');
const start = html.indexOf('const TEST_ON = (() => {');
const guard = html.indexOf('if (TEST_ON) {', start);

function blockEnd(src, open) {
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return k;
  }
  throw new Error('unbalanced');
}

test('test hook exists and is wrapped in a single if (TEST_ON) block', () => {
  assert.ok(start > 0, 'TEST_ON definition not found');
  assert.ok(guard > start, 'if (TEST_ON) guard not found');
  const end = blockEnd(html, html.indexOf('{', guard));
  // every mention of the global lives inside the guarded block (comments above it excepted)
  const re = /window\.__ST_TEST__/g;
  let m, n = 0;
  while ((m = re.exec(html))) { n++; assert.ok(m.index > guard && m.index < end, `window.__ST_TEST__ used outside the guard at offset ${m.index}`); }
  assert.ok(n >= 1);
});

test('TEST_ON is true only for ?test=1 or an explicit host flag', () => {
  const expr = html.slice(html.indexOf('(() => {', start), html.indexOf('})();', start) + 4);
  const evalWith = (search, flag) => new Function('location', 'window', `return ${expr}`)({ search }, flag === undefined ? {} : { __ST_TEST_FLAG__: flag });
  const on = ['?test=1', '?a=b&test=1', '?test=1&x=2'];
  const off = ['', '?', '?test=0', '?test=10', '?test=true', '?xtest=1', '?test', '?room=ABCD', '#test=1'];
  for (const s of on) assert.equal(evalWith(s), true, s);
  for (const s of off) assert.equal(evalWith(s), false, s);
  assert.equal(evalWith('', true), true, 'host flag true');
  for (const f of [1, 'true', 'yes', {}, false, null]) assert.equal(evalWith('', f), false, `host flag ${JSON.stringify(f)}`);
  // a throwing location getter is treated as off
  assert.equal(new Function('window', `const location = { get search() { throw new Error('x'); } }; return ${expr}`)({}), false);
});

test('the guarded block only defines things (no listeners, timers, storage writes or state changes at load)', () => {
  const end = blockEnd(html, html.indexOf('{', guard));
  const body = html.slice(guard, end);
  // top-level statements of the block: const declarations and the frozen global, nothing else
  for (const bad of [/addEventListener\(/, /localStorage\.setItem/, /setInterval\(/, /requestAnimationFrame\(/]) {
    assert.ok(!bad.test(body), `test hook must not use ${bad}`);
  }
  assert.match(body, /window\.__ST_TEST__ = Object\.freeze\(/);
});
