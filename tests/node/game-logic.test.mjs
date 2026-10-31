// Headless unit tests of pure game functions, extracted from game/index.html and run in a VM.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, grab } from './helpers.mjs';

const src = read('game/index.html');
const ctx = vm.createContext({});
vm.runInContext(`
  const TYPES = ["Human", "Moron", "Shooter", "Poolshark", "Tosser", "Chooser", "Spoiler", "Cyborg"];
  const MAP_N = 160;
  ${grab(src, 'mulberry32')}
  ${grab(src, 'cleanSlots')}
  ${grab(src, 'cleanMap')}
  this.api = { mulberry32, cleanSlots, cleanMap, TYPES };
`, ctx);
const { mulberry32, cleanSlots, cleanMap } = ctx.api;

test('the game constants used here still match the game', () => {
  assert.match(src, /const MAP_N = 160;/);
  assert.match(src, /const TYPES = \["Human", "Moron", "Shooter", "Poolshark", "Tosser", "Chooser", "Spoiler", "Cyborg"\];/);
});

test('mulberry32: same seed gives the same stream (online games share a seed)', () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const sa = Array.from({ length: 50 }, a), sb = Array.from({ length: 50 }, b), sc = Array.from({ length: 50 }, c);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
});

test('cleanSlots: clamps to 2..10 known types', () => {
  assert.deepEqual([...cleanSlots(null, ['Human', 'Shooter'])], ['Human', 'Shooter']);
  assert.deepEqual([...cleanSlots(['Bogus'], ['Human', 'Cyborg'])], ['Shooter', 'Cyborg']);
  assert.equal(cleanSlots(Array(15).fill('Human'), ['Human']).length, 10);
});

test('cleanMap: rejects malformed maps and sanitises good ones', () => {
  assert.equal(cleanMap(null), null);
  assert.equal(cleanMap({ h: [1, 2, 3] }), null);
  const m = cleanMap({ n: '<b>My&"Map</b> long name here', h: Array(160).fill(150), d: [[5, 0], [200, 1], [7, 9], [3.6, 2]] });
  assert.equal(m.n, 'bMyMap/b long na');
  assert.ok(m.h.every((v) => v === 100));
  assert.deepEqual(m.d.map((e) => [...e]), [[5, 0], [4, 2]]);
  assert.equal(cleanMap({ h: Array(160).fill(-5), d: Array(60).fill([1, 1]) }).d.length, 40);
});
