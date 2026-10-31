// The version must agree everywhere it is written: game, Worker, landing page, Gradle, docs-free.
import test from 'node:test';
import assert from 'node:assert/strict';
import { read, match1 } from './helpers.mjs';

const GAME_VER = match1(read('game/index.html'), /const GAME_VER = "([^"]+)"/, 'GAME_VER');

test('GAME_VER looks like 1.N', () => assert.match(GAME_VER, /^1\.\d+$/));

test('APP_VER in server/worker.js equals GAME_VER', () => {
  assert.equal(match1(read('server/worker.js'), /const APP_VER = "([^"]+)"/, 'APP_VER'), GAME_VER);
});

test('landing page footer shows the same version', () => {
  assert.equal(match1(read('landing/index.html'), /class="ver">v([^<]+)</, 'landing .ver'), GAME_VER);
});

test('android/app/build.gradle versionName/versionCode match', () => {
  const g = read('android/app/build.gradle');
  assert.equal(match1(g, /versionName '([^']+)'/, 'versionName'), GAME_VER);
  assert.equal(Number(match1(g, /versionCode (\d+)/, 'versionCode')), Number(GAME_VER.split('.')[1]));
});

test('Gradle targets an SDK Google Play accepts (>= 36) and packages game/', () => {
  const g = read('android/app/build.gradle');
  assert.ok(Number(match1(g, /targetSdk (\d+)/, 'targetSdk')) >= 36);
  assert.match(g, /assets\.srcDirs = \['\.\.\/\.\.\/game'\]/);
  assert.doesNotMatch(g, /signingConfigs\.debug/, 'release must never use the debug signer');
});

test('assetlinks fingerprint equals the signer pinned in build.sh', () => {
  const pinned = match1(read('build.sh'), /^PROD_CERT_SHA256='([^']+)'/m, 'PROD_CERT_SHA256');
  assert.ok(read('server/worker.js').includes(`"${pinned}"`));
});
