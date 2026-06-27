import assert from 'node:assert/strict';
import test from 'node:test';

import apiFactory from '../src/createSQLiteKit.js';

const { createSQLiteKit } = apiFactory;

test('public API sends positional parameters as JSON and decodes native results', async () => {
  const calls = [];
  const kit = createSQLiteKit({
    async open(name) {
      calls.push(['open', name]);
      return 'connection-1';
    },
    async close(id) {
      calls.push(['close', id]);
      return true;
    },
    async deleteDatabase(name) {
      calls.push(['delete', name]);
      return true;
    },
    async execute(id, sql, paramsJson) {
      calls.push(['execute', id, sql, paramsJson]);
      return JSON.stringify({ rows: [{ id: 1, enabled: 1 }], rowsAffected: 0, insertId: null });
    },
    async executeBatch(id, statementsJson) {
      calls.push(['batch', id, statementsJson]);
      return JSON.stringify([{ rows: [], rowsAffected: 1, insertId: 2 }]);
    },
  });

  const db = await kit.SQLite.open({ name: 'production-test.db' });
  const image = kit.blob('AQIDBA==');
  const query = await db.execute('SELECT ? AS id, ? AS image', [1, image]);
  assert.deepEqual(query.rows, [{ id: 1, enabled: 1 }]);

  const batch = await db.transaction([
    { sql: 'INSERT INTO item(name) VALUES (?)', params: ['Keyboard'] },
  ]);
  assert.equal(batch[0].insertId, 2);

  await Promise.all([db.close(), db.close()]);
  await kit.SQLite.deleteDatabase('production-test.db');

  assert.deepEqual(calls, [
    ['open', 'production-test.db'],
    ['execute', 'connection-1', 'SELECT ? AS id, ? AS image', JSON.stringify([1, image])],
    ['batch', 'connection-1', JSON.stringify([{ sql: 'INSERT INTO item(name) VALUES (?)', params: ['Keyboard'] }])],
    ['close', 'connection-1'],
    ['delete', 'production-test.db'],
  ]);
});

test('public API rejects operations after close and invalid native contracts', async () => {
  assert.throws(() => createSQLiteKit({}), /missing open/);

  const kit = createSQLiteKit({
    async open() { return 'c'; },
    async close() { return true; },
    async deleteDatabase() { return true; },
    async execute() { return JSON.stringify({ rows: [], rowsAffected: 0, insertId: null }); },
    async executeBatch() { return '[]'; },
  });
  const db = await kit.SQLite.open({ name: 'closed.db' });
  await db.close();
  await assert.rejects(() => db.execute('SELECT 1'), /is closed/);
});

test('public API rejects new work while a database is closing', async () => {
  let finishClosing;
  const kit = createSQLiteKit({
    async open() { return 'c'; },
    close() {
      return new Promise((resolve) => {
        finishClosing = () => resolve(true);
      });
    },
    async deleteDatabase() { return true; },
    async execute() {
      return JSON.stringify({ rows: [], rowsAffected: 0, insertId: null });
    },
    async executeBatch() { return '[]'; },
  });

  const db = await kit.SQLite.open({ name: 'closing.db' });
  const closing = db.close();

  await assert.rejects(() => db.execute('SELECT 1'), /is closed/);
  finishClosing();
  await closing;
});

test('public API accepts a single CREATE TRIGGER statement with body semicolons', async () => {
  const calls = [];
  const kit = createSQLiteKit({
    async open() { return 'c'; },
    async close() { return true; },
    async deleteDatabase() { return true; },
    async execute(id, sql, paramsJson) {
      calls.push(['execute', id, sql, paramsJson]);
      return JSON.stringify({ rows: [], rowsAffected: 0, insertId: null });
    },
    async executeBatch() { return '[]'; },
  });
  const db = await kit.SQLite.open({ name: 'trigger.db' });
  const sql = `CREATE TRIGGER IF NOT EXISTS stock_movements_no_delete
    BEFORE DELETE ON stock_movements
    BEGIN SELECT RAISE(ABORT, 'stock movements cannot be deleted'); END`;

  await db.execute(sql);

  assert.deepEqual(calls, [['execute', 'c', sql, '[]']]);
});

test('public API still rejects multiple SQL statements in execute', async () => {
  const kit = createSQLiteKit({
    async open() { return 'c'; },
    async close() { return true; },
    async deleteDatabase() { return true; },
    async execute() {
      return JSON.stringify({ rows: [], rowsAffected: 0, insertId: null });
    },
    async executeBatch() { return '[]'; },
  });
  const db = await kit.SQLite.open({ name: 'batch.db' });

  await assert.rejects(
    () => db.execute('SELECT 1; SELECT 2'),
    /execute accepts exactly one SQL statement/,
  );
});
