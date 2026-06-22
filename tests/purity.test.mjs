import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('package ships no runtime or development npm dependencies', async () => {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies, {});
  assert.deepEqual(pkg.devDependencies, {});
  assert.deepEqual(Object.keys(pkg.peerDependencies), ['react-native']);
});

test('native code uses operating-system SQLite APIs directly', async () => {
  const [android, ios] = await Promise.all([
    readFile(
      join(root, 'android/src/main/java/com/reactnativesqlitekit/ReactNativeSqliteKitModule.kt'),
      'utf8',
    ),
    readFile(join(root, 'ios/RNSqliteKit.mm'), 'utf8'),
  ]);

  assert.match(android, /android\.database\.sqlite\.SQLiteDatabase/);
  assert.match(ios, /#import <sqlite3\.h>/);
  for (const banned of [
    'react-native-sqlite-storage',
    'expo-sqlite',
    'react-native-quick-sqlite',
    'watermelondb',
    'sqlcipher',
  ]) {
    assert.doesNotMatch(android + ios, new RegExp(banned, 'i'));
  }
});
