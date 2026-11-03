// The game must parse in older Android System WebViews (minSdk 24). Found by the API 24 emulator job:
// `a ?? b` made the whole game script a SyntaxError in WebView/Chrome < 80 ("Unexpected token ?"), leaving a dead
// title screen. Syntax newer than ES2018 is refused here; the emulator job is the runtime check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read, inlineScripts } from './helpers.mjs';

// Raw source scan (no parser dependency). Comments are dropped line-wise; none of these tokens is used in strings today,
// so a hit is real code. If one is ever needed inside a string, split it ("?" + "?").
const code = (src) => src.split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n');
const BANNED = [
  [/\?\?/, 'nullish coalescing ?? (Chrome 80)'],
  [/\?\.(?=[\w$[(])/, 'optional chaining ?. (Chrome 80)'],
  [/(\|\||&&)=/, 'logical assignment ||= &&= (Chrome 85)'],
  [/\b\d+_\d+\b/, 'numeric separators 1_000 (Chrome 75)'],
];

for (const f of ['game/index.html', 'landing/index.html']) {
  test(`${f}: inline scripts avoid syntax newer than ES2018 (old Android WebViews)`, () => {
    for (const { code: src, line } of inlineScripts(read(f))) {
      const c = code(src);
      for (const [re, what] of BANNED) {
        const m = re.exec(c);
        if (m) {
          const ln = line + c.slice(0, m.index).split('\n').length - 1;
          assert.fail(`${f}:${ln} uses ${what}`);
        }
      }
    }
  });
}
test('game/hark.js avoids syntax newer than ES2018', () => {
  const c = code(read('game/hark.js'));
  for (const [re, what] of BANNED) assert.ok(!re.test(c), `hark.js uses ${what}`);
});
