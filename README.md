# rn-sqlite-kit

A production-oriented SQLite native module for React Native iOS and Android.

It has **no npm runtime dependencies and no npm development dependencies**. The package directly uses:

- Android: `android.database.sqlite.SQLiteDatabase`
- iOS: Apple system `libsqlite3` via `<sqlite3.h>`
- React Native: only the host app's `react-native` peer dependency and its built-in Codegen/TurboModule support

It does **not** use `react-native-sqlite-storage`, `expo-sqlite`, `react-native-quick-sqlite`, WatermelonDB, SQLCipher, a JSI bridge package, or an ORM.

> “No other npm” does not mean reimplementing the SQLite database engine. SQLite itself comes with iOS/Android. This library owns the JavaScript API and all Android/iOS bridge code; the operating system owns the proven database engine.

## Requirements

- React Native `>= 0.79`
- New Architecture enabled
- Android minSdk supplied by the consuming React Native app (tested target: API 24+)
- iOS deployment target compatible with the app (podspec baseline: iOS 13.4)

## Install

```bash
npm install rn-sqlite-kit
```

For iOS:

```bash
cd ios
pod install
```

## What the module configures

Each app-private database is opened with:

- foreign-key enforcement enabled
- write-ahead logging (WAL) enabled
- a 5-second SQLite busy timeout
- one native serial worker queue per JS module instance, so database work does not run on the JS thread

Database names are file names only. Paths such as `../data.db` are rejected deliberately; files always live in the app's private database storage.

## Quick start

```ts
import { SQLite, blob } from 'react-native-sqlite-kit';

const db = await SQLite.open({ name: 'inventory.db' });

await db.execute(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    photo BLOB
  )
`);

const inserted = await db.execute(
  'INSERT INTO products (name, quantity, photo) VALUES (?, ?, ?)',
  ['Keyboard', 12, blob('AQIDBA==')],
);

const products = await db.execute(
  'SELECT id, name, quantity, photo FROM products WHERE quantity > ?',
  [0],
);

console.log(inserted.insertId);
console.log(products.rows);

await db.close();
```

## API

### `SQLite.open({ name })`

Opens an app-private file and returns a `SQLiteDatabase` handle. Calls that open the same name share one native database handle, while each JavaScript object retains its own logical connection ID.

```ts
const db = await SQLite.open({ name: 'app.db' });
```

### `db.execute(sql, params?)`

Runs exactly **one** SQL statement. Use unnumbered positional `?` placeholders only; a parameter count mismatch throws before native execution.

```ts
const result = await db.execute(
  'UPDATE products SET quantity = quantity - ? WHERE id = ?',
  [1, 42],
);

console.log(result.rowsAffected);
```

Result shape:

```ts
{
  rows: Array<Record<string, string | number | null | SqliteBlob>>;
  rowsAffected: number;
  insertId: number | null;
}
```

### `db.transaction(statements)`

Runs a batch atomically. On failure, every statement in the batch is rolled back.

```ts
await db.transaction([
  {
    sql: 'UPDATE products SET quantity = quantity - ? WHERE id = ?',
    params: [1, 42],
  },
  {
    sql: 'INSERT INTO inventory_log (product_id, action) VALUES (?, ?)',
    params: [42, 'sold'],
  },
]);
```

### `db.close()`

Closes this logical connection. It is safe to call more than once.

### `SQLite.deleteDatabase(name)`

Closes all known logical connections to the named database and deletes the main database, WAL, and shared-memory files.

```ts
await SQLite.deleteDatabase('inventory.db');
```

### `blob(base64)`

Builds a BLOB parameter. BLOB columns return the same portable representation.

```ts
const attachment = blob('AQIDBA==');
await db.execute('INSERT INTO files (contents) VALUES (?)', [attachment]);
```

## Intentional v1 constraints

- Only positional `?` parameters are supported. Named parameters (`:name`, `@name`, `$name`) and numbered parameters (`?1`) are rejected.
- `execute` accepts one statement. Use `transaction` for a batch.
- Do not rely on `INSERT ... RETURNING` / `UPDATE ... RETURNING`; Android system SQLite versions vary. Use a normal mutation followed by `SELECT` when needed.
- SQLite stores booleans as integers; `true` / `false` are written as `1` / `0` and read back as numbers.
- JavaScript cannot represent every 64-bit SQLite integer exactly. Keep IDs and integer values within `Number.MAX_SAFE_INTEGER` when exact precision matters.
- This package does not provide encryption, an ORM, schema migrations, database sync, web support, or a custom SQLite engine.

## Quality gates

The repository uses no test framework package. Unit tests run with Node's built-in test runner:

```bash
npm test
npm run check
```

`npm run check` verifies JavaScript syntax, validation/result decoding, the zero-dependency manifest, direct native SQLite imports, and the publish file list.

`example/App.tsx` plus `example/SmokeTests.ts` is a native smoke-test screen. Before publishing a release, copy it into a bare React Native test app and run it on Android and iOS. It verifies:

1. table creation
2. positional binding
3. BLOB round-trip
4. committed reads
5. transaction rollback

## Publish a production release

1. Run `npm run check`.
2. Run the native smoke-test screen on Android and iOS.
3. Configure npm Trusted Publisher for this GitHub repository and `.github/workflows/publish.yml`.
4. Release:

```bash
npm version patch
git push origin main --follow-tags
```

The `v*` tag triggers npm publish with provenance.

## License

MIT © Nattawat Virunsuntornkul
