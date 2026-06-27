import assert from 'node:assert/strict';
import test from 'node:test';

import validation from '../src/internal/validation.js';

const { assertDatabaseName, assertSqlAndParameters, countPositionalPlaceholders } = validation;

test('database names are restricted to safe app-private file names', () => {
  assert.doesNotThrow(() => assertDatabaseName('inventory.v1.db'));
  assert.throws(() => assertDatabaseName('../outside.db'), /Database name/);
  assert.throws(() => assertDatabaseName('.hidden.db'), /Database name/);
});

test('counts only positional parameters outside literals and comments', () => {
  const sql = `
    SELECT '?', "?", [???], ` + '`?`' + `, value
    FROM items
    -- ? in a comment
    WHERE id = ? /* another ? */ AND label = 'it''s ?'
  `;
  assert.equal(countPositionalPlaceholders(sql), 1);
});

test('rejects parameter count mismatches and unsupported placeholder styles', () => {
  assert.throws(
    () => assertSqlAndParameters('SELECT ? + ?', [1]),
    /2 positional/,
  );
  assert.throws(
    () => assertSqlAndParameters('SELECT :id', []),
    /Named SQLite placeholders/,
  );
  assert.throws(
    () => assertSqlAndParameters('SELECT ?1', [1]),
    /Numbered SQLite placeholders/,
  );
});

test('rejects multiple statements before calling the native module', () => {
  assert.doesNotThrow(() => assertSqlAndParameters('SELECT 1;', []));
  assert.throws(
    () => assertSqlAndParameters('SELECT 1; SELECT 2', []),
    /exactly one SQL statement/,
  );
  assert.throws(
    () => assertSqlAndParameters(';', []),
    /exactly one SQL statement/,
  );
});

test('accepts CREATE TRIGGER bodies with internal semicolons', () => {
  assert.doesNotThrow(() =>
    assertSqlAndParameters(
      `CREATE TRIGGER IF NOT EXISTS stock_movements_no_delete
       BEFORE DELETE ON stock_movements
       BEGIN
         SELECT RAISE(ABORT, 'stock movements cannot be deleted');
       END;`,
      [],
    ),
  );

  assert.doesNotThrow(() =>
    assertSqlAndParameters(
      `CREATE TEMP TRIGGER update_end_column
       AFTER UPDATE ON items
       BEGIN
         UPDATE items SET end = NEW.end WHERE id = NEW.id;
         SELECT CASE WHEN NEW.end IS NULL THEN RAISE(IGNORE) ELSE NEW.end END;
       END`,
      [],
    ),
  );
});

test('rejects SQL after a CREATE TRIGGER statement', () => {
  assert.throws(
    () =>
      assertSqlAndParameters(
        `CREATE TRIGGER item_audit
         AFTER INSERT ON items
         BEGIN
           SELECT 1;
         END; SELECT 2`,
        [],
      ),
    /exactly one SQL statement/,
  );
});

test('accepts validated BLOB parameters and rejects malformed base64', () => {
  assert.doesNotThrow(() =>
    assertSqlAndParameters('INSERT INTO files(data) VALUES (?)', [
      { type: 'blob', base64: 'AQIDBA==' },
    ]),
  );
  assert.throws(
    () =>
      assertSqlAndParameters('INSERT INTO files(data) VALUES (?)', [
        { type: 'blob', base64: 'not base64!' },
      ]),
    /must be string/,
  );
});
