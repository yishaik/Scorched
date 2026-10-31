// Renders every image twice into fresh temp dirs and asserts both runs are byte-identical,
// non-empty PNGs of the expected size. Used by CI (`npm run check`); writes nothing in the repo.
'use strict';
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXPECT = {
  'feature-graphic.png': [1024, 500],
  'screenshot-1-sunset.png': [1920, 1080],
  'screenshot-2-night.png': [1920, 1080],
  'promo-square.png': [1080, 1080],
  'screenshot-3-map-builder.png': [1920, 1080],
};
function renderAll() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorched-render-'));
  for (const script of ['mk.js', 'mb.js']) execFileSync(process.execPath, [path.join(__dirname, script), dir], { stdio: 'inherit' });
  return dir;
}
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const a = renderAll(), b = renderAll();
let failed = 0;
for (const [name, [w, h]] of Object.entries(EXPECT)) {
  const fa = path.join(a, name), fb = path.join(b, name);
  const buf = fs.readFileSync(fa);
  const ok = buf.slice(1, 4).toString() === 'PNG' && buf.readUInt32BE(16) === w && buf.readUInt32BE(20) === h;
  const same = sha(fa) === sha(fb);
  console.log(`${ok && same ? 'ok  ' : 'FAIL'} ${name} ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)} ${sha(fa).slice(0, 16)}${same ? '' : ' (differs between runs)'}`);
  if (!ok || !same) failed++;
}
fs.rmSync(a, { recursive: true }); fs.rmSync(b, { recursive: true });
if (failed) { console.error(`${failed} image(s) failed`); process.exit(1); }
console.log('PASS: renderer deterministic from a clean checkout');
