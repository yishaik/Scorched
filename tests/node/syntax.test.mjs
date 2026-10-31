// Parse checks: worker module, inline game/landing scripts, JSON metadata, hark.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { ROOT, read, inlineScripts } from './helpers.mjs';

test('server/worker.js passes node --check as an ES module', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worker-'));
  try {
    copyFileSync(join(ROOT, 'server/worker.js'), join(dir, 'worker.mjs'));
    execFileSync(process.execPath, ['--check', join(dir, 'worker.mjs')], { stdio: 'pipe' });
  } finally { rmSync(dir, { recursive: true }); }
});

for (const page of ['game/index.html', 'landing/index.html']) {
  test(`${page}: every inline <script> parses`, () => {
    const scripts = inlineScripts(read(page));
    assert.ok(scripts.length > 0, 'no inline scripts found');
    for (const s of scripts) {
      assert.doesNotThrow(() => new vm.Script(s.code, { filename: `${page}:${s.line}` }), `${page} script at line ${s.line}`);
    }
  });
}

for (const js of readdirSync(join(ROOT, 'game')).filter((f) => f.endsWith('.js'))) {
  test(`game/${js} parses`, () => { new vm.Script(read(`game/${js}`), { filename: js }); });
}

for (const f of ['server/metadata.json', 'server/meta-update.json']) {
  test(`${f} is valid Worker metadata`, () => {
    const m = JSON.parse(read(f));
    assert.equal(m.main_module, 'worker.js');
    const classes = m.bindings.filter((b) => b.type === 'durable_object_namespace').map((b) => b.class_name).sort();
    assert.deepEqual(classes, ['Lobby', 'Room']);
  });
}

test('game/index.html references only files that exist in game/', () => {
  const html = read('game/index.html');
  const files = new Set(readdirSync(join(ROOT, 'game')));
  const refs = [...html.matchAll(/(?:src|href)="([\w.-]+\.(?:js|css))"/g)].map((m) => m[1]);
  assert.ok(refs.length > 0);
  for (const r of refs) assert.ok(files.has(r), `missing game/${r}`);
});
