import { blob, SQLite } from 'react-native-sqlite-kit';

export type SmokeTestResult = Readonly<{
  name: string;
  passed: boolean;
  detail: string;
}>;

export async function runSmokeTests(): Promise<SmokeTestResult[]> {
  const databaseName = 'sqlite-kit-smoke.db';
  await SQLite.deleteDatabase(databaseName);
  const db = await SQLite.open({ name: databaseName });
  const results: SmokeTestResult[] = [];

  const run = async (name: string, action: () => Promise<void>) => {
    try {
      await action();
      results.push({ name, passed: true, detail: 'Passed' });
    } catch (error) {
      results.push({
        name,
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  try {
    await run('create table', async () => {
      await db.execute(`
        CREATE TABLE notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          pinned INTEGER NOT NULL,
          payload BLOB
        )
      `);
    });

    await run('bind values and select rows', async () => {
      const inserted = await db.execute(
        'INSERT INTO notes (title, pinned, payload) VALUES (?, ?, ?)',
        ['hello', true, blob('AQIDBA==')],
      );
      if (inserted.insertId === null) {
        throw new Error('Expected insertId.');
      }
      const selected = await db.execute('SELECT title, pinned, payload FROM notes WHERE id = ?', [inserted.insertId]);
      if (selected.rows.length !== 1 || selected.rows[0].title !== 'hello') {
        throw new Error('Expected persisted row.');
      }
    });

    await run('rollback failed transaction', async () => {
      try {
        await db.transaction([
          { sql: 'INSERT INTO notes (title, pinned) VALUES (?, ?)', params: ['rollback', false] },
          { sql: 'INSERT INTO missing_table (value) VALUES (?)', params: ['fail'] },
        ]);
      } catch {
        // Expected.
      }
      const count = await db.execute('SELECT COUNT(*) AS count FROM notes WHERE title = ?', ['rollback']);
      if (count.rows[0]?.count !== 0) {
        throw new Error('Transaction did not roll back.');
      }
    });
  } finally {
    await db.close();
    await SQLite.deleteDatabase(databaseName);
  }

  return results;
}
