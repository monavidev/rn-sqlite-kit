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
