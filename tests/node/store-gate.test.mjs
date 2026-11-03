// Unit tests for the store-readiness gate (tests/android/store-gate.mjs) on manifest fixtures; no SDK needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest, evaluate, gameVersion } from '../android/store-gate.mjs';
import { read } from './helpers.mjs';

const ver = gameVersion(read('game/index.html'));
const patch = +ver.split('.').pop();
const xml = (o = {}) => `<?xml version="1.0"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" android:versionCode="${o.vc ?? patch}" android:versionName="${o.vn ?? ver}" package="${o.pkg ?? 'com.yishai.scorchedtanks'}">
  <uses-sdk android:minSdkVersion="${o.min ?? 24}" android:targetSdkVersion="${o.target ?? 36}"/>
  <uses-permission android:name="android.permission.INTERNET"/>${(o.perms || []).map((p) => `\n  <uses-permission android:name="${p}"/>`).join('')}
  <application android:label="Scorched Tanks"${o.debug ? ' android:debuggable="true"' : ''}><activity android:name=".MainActivity"/></application>
</manifest>`;
const entries = ['base/manifest/AndroidManifest.xml', 'base/assets/index.html', 'base/dex/classes.dex'];
const run = (o = {}, extra = {}) => evaluate({ manifest: parseManifest(xml(o)), entries: extra.entries || entries, gameVer: ver, lastVc: extra.lastVc ?? patch - 1, strict: !!extra.strict, soAlign: extra.soAlign || {} });

test('the checked-in Gradle values pass the gate (against the previous release)', () => {
  const r = run();
  assert.deepEqual(r.errors, []);
});
test('parses bundletool manifest XML', () => {
  const m = parseManifest(xml({ perms: ['android.permission.CAMERA'] }));
  assert.equal(m.package, 'com.yishai.scorchedtanks');
  assert.equal(m.minSdk, 24); assert.equal(m.targetSdk, 36); assert.equal(m.versionCode, patch);
  assert.deepEqual(m.permissions, ['android.permission.INTERNET', 'android.permission.CAMERA']);
});
test('fails: low targetSdk, wrong minSdk, wrong package, debuggable, dangerous permission', () => {
  assert.match(run({ target: 35 }).errors.join(), /targetSdk is 35/);
  assert.match(run({ min: 21 }).errors.join(), /minSdk is 21/);
  assert.match(run({ pkg: 'com.example' }).errors.join(), /package is com.example/);
  assert.match(run({ debug: true }).errors.join(), /debuggable/);
  assert.match(run({ perms: ['android.permission.ACCESS_FINE_LOCATION'] }).errors.join(), /unexpected permissions: android.permission.ACCESS_FINE_LOCATION/);
});
test('versionCode must match GAME_VER and move forward', () => {
  assert.match(run({ vc: patch + 1 }).errors.join(), /!= GAME_VER/);
  assert.match(run({ vn: '9.9' }).errors.join(), /versionName/);
  assert.match(run({}, { lastVc: patch + 1 }).errors.join(), /lower than the last released/);
  const same = run({}, { lastVc: patch });
  assert.deepEqual(same.errors, []);
  assert.match(same.warnings.join(), /not a new release/);
  assert.match(run({}, { lastVc: patch, strict: true }).errors.join(), /not a new release/);
});
test('native libraries must be 16 KB aligned', () => {
  const so = [...entries, 'base/lib/arm64-v8a/libx.so'];
  assert.match(run({}, { entries: so }).errors.join(), /alignment unknown/);
  assert.match(run({}, { entries: so, soAlign: { 'base/lib/arm64-v8a/libx.so': 4096 } }).errors.join(), /4096 < 16384/);
  assert.deepEqual(run({}, { entries: so, soAlign: { 'base/lib/arm64-v8a/libx.so': 16384 } }).errors, []);
});
test('bundle must carry the game', () => {
  assert.match(run({}, { entries: ['base/dex/classes.dex'] }).errors.join(), /index.html missing/);
});
