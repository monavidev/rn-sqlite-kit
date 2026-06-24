# rn-sqlite-kit

[![npm](https://img.shields.io/npm/v/rn-sqlite-kit.svg)](https://www.npmjs.com/package/rn-sqlite-kit)
[![CI](https://github.com/monavidev/rn-sqlite-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/monavidev/rn-sqlite-kit/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/rn-sqlite-kit.svg)](LICENSE)

A small, dependency-free SQLite TurboModule for React Native on iOS and Android.

It uses the SQLite implementation already provided by each operating system—`android.database.sqlite.SQLiteDatabase` on Android and `libsqlite3` on iOS—so there is no bundled database engine, ORM, or third-party runtime.

> [!IMPORTANT]
> `rn-sqlite-kit` requires React Native's New Architecture.

## Highlights

| Feature | What you get |
| --- | --- |
| **Zero npm dependencies** | No runtime or development packages are added to the library. |
| **Native on both platforms** | Direct Android SQLite and Apple `libsqlite3` implementations. |
| **Off the JS thread** | Database work runs on a native serial worker queue. |
| **Transactions** | Execute a batch atomically with automatic rollback on failure. |
| **Typed API** | TypeScript declarations ship with the package. |
| **BLOB support** | Portable base64 values work consistently across iOS and Android. |

Every database is app-private and opens with foreign keys enabled, write-ahead logging (WAL), and a five-second busy timeout.

## Requirements

| Platform | Requirement |
| --- | --- |
| React Native | `>= 0.79` with New Architecture enabled |
| Android | The consuming app supplies `minSdk` (tested on API 24+) |
| iOS | iOS 13.4+ |

## Installation

```bash
npm install rn-sqlite-kit
```

React Native autolinking handles the native module. Install CocoaPods after adding the package on iOS:

```bash
cd ios && pod install
```

## Quick start

```ts
import { blob, SQLite } from 'rn-sqlite-kit';

const db = await SQLite.open({ name: 'inventory.db' });

try {
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

  const result = await db.execute(
    'SELECT id, name, quantity, photo FROM products WHERE quantity > ?',
    [0],
  );

  console.log('Inserted row:', inserted.insertId);
  console.log('Products:', result.rows);
} finally {
  await db.close();
}
```

Database names are file names, not paths. Values such as `../data.db` are deliberately rejected so files stay inside the app's private database directory.

## API

### `SQLite.open(options)`

Opens a database and returns a `SQLiteDatabase` handle.

```ts
const db = await SQLite.open({ name: 'app.db' });
```

Opening the same name more than once shares its native database while keeping separate logical connections. The name must be 1–128 letters, numbers, dots, underscores, or hyphens, and cannot start with a dot.

### `db.execute(sql, params?)`

Executes exactly one SQL statement using unnumbered positional `?` placeholders.

```ts
const result = await db.execute(
  'UPDATE products SET quantity = quantity - ? WHERE id = ?',
  [1, 42],
);

console.log(result.rowsAffected);
```

Each call resolves to:

```ts
type SqliteResult = Readonly<{
  rows: Array<Record<string, string | number | null | SqliteBlob>>;
  rowsAffected: number;
  insertId: number | null;
}>;
```

The parameter count and supported value types are validated before native execution.

### `db.transaction(statements)`

Executes statements in order and returns one result per statement. The entire batch is rolled back if any statement fails.

```ts
const results = await db.transaction([
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

Closes the logical connection. Calling `close()` more than once is safe. New operations are rejected as soon as closing begins.

### `SQLite.deleteDatabase(name)`

Closes every native connection for the given name and removes the database, WAL, and shared-memory files.

```ts
await SQLite.deleteDatabase('inventory.db');
```

### `blob(base64)`

Creates a validated BLOB parameter. BLOB columns use the same representation when read:

```ts
const contents = blob('AQIDBA==');
await db.execute('INSERT INTO files (contents) VALUES (?)', [contents]);
```

```ts
type SqliteBlob = Readonly<{
  type: 'blob';
  base64: string;
}>;
```

## Supported parameter values

| JavaScript value | SQLite value |
| --- | --- |
| `string` | `TEXT` |
| finite `number` | `INTEGER` or `REAL` |
| `boolean` | `INTEGER` (`1` or `0`) |
| `null` | `NULL` |
| `blob(base64)` | `BLOB` |

SQLite booleans are returned as numbers. JavaScript also cannot precisely represent every 64-bit SQLite integer, so keep exact IDs within `Number.MAX_SAFE_INTEGER`.

## Intentional constraints

- Only unnumbered positional `?` parameters are supported. Named parameters (`:name`, `@name`, `$name`) and numbered parameters (`?1`) are rejected.
- `execute` accepts one statement; use `transaction` for a batch.
- Avoid relying on `INSERT ... RETURNING` or `UPDATE ... RETURNING` because Android system SQLite versions vary.
- Encryption, migrations, sync, web support, schema modeling, and ORM features are outside this package's scope.
- SQLite is supplied by iOS and Android; this package does not bundle a custom SQLite build or SQLCipher.

## Development

The test suite uses Node's built-in test runner and keeps the project dependency-free:

```bash
npm test
npm run check
```

`npm run check` validates JavaScript syntax, public API behavior, result decoding, package purity, and the npm publish file list. Native changes should also pass the smoke-test screen in [`example`](example) on both Android and iOS.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

MIT © Nattawat Virunsuntornkul
