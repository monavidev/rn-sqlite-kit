import assert from 'node:assert/strict';
import test from 'node:test';

import codec from '../src/internal/codec.js';

const { decodeBatchResult, decodeResult } = codec;

test('decodeResult preserves rows, BLOBs, and mutation metadata', () => {
  const result = decodeResult(
    JSON.stringify({
      rows: [
        {
          id: 7,
          name: 'Keyboard',
          attachment: { type: 'blob', base64: 'AQID' },
          deletedAt: null,
        },
      ],
      rowsAffected: 1,
      insertId: 7,
    }),
  );

  assert.deepEqual(result, {
    rows: [
      {
        id: 7,
        name: 'Keyboard',
        attachment: { type: 'blob', base64: 'AQID' },
        deletedAt: null,
      },
    ],
    rowsAffected: 1,
    insertId: 7,
  });
});

test('decodeBatchResult rejects malformed native output', () => {
  assert.throws(
    () => decodeBatchResult(JSON.stringify([{ rows: 'no', rowsAffected: 0 }])),
    /missing rows/,
  );
});

test('decodeResult rejects non-finite values from a corrupted native result', () => {
  assert.throws(
    () => decodeResult('{"rows":[],"rowsAffected":0,"insertId":"7"}'),
    /invalid insertId/,
  );
});

test('decodeResult safely preserves special SQLite column aliases', () => {
  const result = decodeResult(
    '{"rows":[{"__proto__":"safe"}],"rowsAffected":0,"insertId":null}',
  );

  assert.equal(Object.hasOwn(result.rows[0], '__proto__'), true);
  assert.equal(result.rows[0].__proto__, 'safe');
  assert.equal(Object.getPrototypeOf(result.rows[0]), Object.prototype);
});

test('decodeResult rejects non-string native payloads', () => {
  assert.throws(() => decodeResult({}), /malformed JSON/);
});
