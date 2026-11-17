// Pure helpers for the v1.18 age gate / parent PIN, extracted from game/index.html and run in a VM.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, grab } from './helpers.mjs';

const src = read('game/index.html');
const ctx = vm.createContext({});
vm.runInContext(`
  ${grab(src, 'cleanAge')}
  ${grab(src, 'hashPin')}
  ${grab(src, 'ageDefaults')}
  this.api = { cleanAge, hashPin, ageDefaults };
`, ctx);
const { cleanAge, hashPin, ageDefaults } = ctx.api;
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));

test('cleanAge accepts only u13, teen and adult', () => {
  assert.equal(cleanAge('u13'), 'u13');
  assert.equal(cleanAge('teen'), 'teen');
  assert.equal(cleanAge('adult'), 'adult');
  assert.equal(cleanAge(''), '');
  assert.equal(cleanAge('child'), '');
  assert.equal(cleanAge('18'), '');
  assert.equal(cleanAge(null), '');
  assert.equal(cleanAge('Adult'), '');
});

test('ageDefaults: under 13 locks online and restricts room codes; others do not', () => {
  same(ageDefaults('u13'), { allowOnline: false, restrictCodes: true });
  same(ageDefaults('teen'), { allowOnline: true, restrictCodes: false });
  same(ageDefaults('adult'), { allowOnline: true, restrictCodes: false });
  same(ageDefaults('nope'), { allowOnline: true, restrictCodes: false });
});

test('hashPin is deterministic, 8 hex chars, and does not echo the PIN', () => {
  const a = hashPin('1234');
  const b = hashPin('1234');
  const c = hashPin('0000');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.notEqual(a, c);
  assert.ok(!String(a).includes('1234'));
});
