// Listing claims that can be checked from source: tank counts, AI, weapons, shop items, options, modern look pieces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { read } from './helpers.mjs';

const src = read('game/index.html');

test('2 to 10 tanks and 7 CPU personalities, any mix with humans', () => {
  assert.match(src, /slots\.length > 2/);
  assert.match(src, /slots\.length < 10/);
  const m = src.match(/const TYPES = \[([^\]]+)\]/);
  assert.ok(m, 'TYPES');
  const types = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.ok(types.includes('Human'));
  const ai = types.filter((n) => n !== 'Human');
  assert.equal(ai.length, 7, String(ai));
});

test('over 30 weapons including the ones named in the Play listing', () => {
  const names = [...src.matchAll(/name:\s*"(Baby Missile|Missile|Baby Nuke|Nuke|Leapfrog|Funky Bomb|MIRV|Death's Head|Napalm|Hot Napalm|Tracer|Smoke Tracer|Baby Roller|Roller|Heavy Roller|Riot Charge|Riot Blast|Riot Bomb|Heavy Riot Bomb|Baby Digger|Digger|Heavy Digger|Baby Sandhog|Sandhog|Heavy Sandhog|Dirt Clod|Dirt Ball|Ton of Dirt|Liquid Dirt|Dirt Charge|Earth Disrupter|Plasma Blast|Laser)"/g)].map((x) => x[1]);
  const unique = [...new Set(names)];
  assert.ok(unique.length > 30, 'weapon count ' + unique.length);
  for (const need of ['Nuke', 'MIRV', 'Funky Bomb', 'Napalm', 'Roller', 'Digger', 'Sandhog', 'Dirt Ball', 'Laser']) {
    assert.ok(unique.includes(need), need);
  }
});

test('shields, parachutes, guidance and fuel are sold one unit at a time', () => {
  for (const id of ['chute', 'shield', 'fuel', 'heat', 'ballistic']) {
    assert.match(src, new RegExp('id: "' + id + '"'));
  }
  assert.match(src, /sold one unit at a time/);
  assert.match(src, /x\.bundle = 1/);
  assert.match(src, /wind:.*walls:.*terrain:.*gravity:.*sky:/s);
});

test('modern look has sunset skies, grassy hills, burning trees, and a persisted one-tap Classic toggle', () => {
  assert.match(src, /long sunset clouds/);
  assert.match(src, /#8aa86a/); // far grassy hill
  assert.match(src, /#3a6a24/); // near grassy hill
  assert.match(src, /function hillGrass\(/);
  assert.match(src, /quadraticCurveTo/); // flame shape on burning trees
  assert.match(src, /#ffee66/);
  assert.match(src, /data-gs="gfx"/);
  assert.match(src, /data-v="modern"/);
  assert.match(src, /data-v="classic"/);
  assert.match(src, /localStorage\.setItem\("st-gfx"/);
  // Classic sky path stays the old flat gradient
  assert.match(src, /sky\.addColorStop\(0, "#0b1440"\)/);
});
