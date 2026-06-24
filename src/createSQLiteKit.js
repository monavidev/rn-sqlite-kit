const { decodeBatchResult, decodeResult } = require('./internal/codec');
const {
  assertDatabaseName,
  assertParameter,
  assertSqlAndParameters,
  assertStatements,
} = require('./internal/validation');

const REQUIRED_NATIVE_METHODS = [
  'open',
  'close',
  'deleteDatabase',
  'execute',
  'executeBatch',
];

/**
 * Builds the public API around a native module. Kept separate from the React
 * Native import so it can be exercised with a deterministic native mock.
 */
function createSQLiteKit(nativeModule) {
  if (!nativeModule || typeof nativeModule !== 'object') {
    throw new TypeError('ReactNativeSqliteKit native module is unavailable.');
  }

  for (const method of REQUIRED_NATIVE_METHODS) {
    if (typeof nativeModule[method] !== 'function') {
      throw new TypeError(`ReactNativeSqliteKit native module is missing ${method}().`);
    }
  }

  function blob(base64) {
    const value = { type: 'blob', base64 };
    assertParameter(value, 'blob(base64)');
    return Object.freeze(value);
  }

  class SQLiteDatabase {
    #closed = false;
    #closing = null;
    #connectionId;

    constructor(name, connectionId) {
      this.name = name;
      this.#connectionId = connectionId;
    }

    async execute(sql, params = []) {
      this.#assertOpen();
      assertSqlAndParameters(sql, params);

      const serialized = await nativeModule.execute(
        this.#connectionId,
        sql,
        JSON.stringify(params),
      );
      return decodeResult(serialized);
    }

    async transaction(statements) {
      this.#assertOpen();
      assertStatements(statements);

      const serialized = await nativeModule.executeBatch(
        this.#connectionId,
        JSON.stringify(
          statements.map((statement) => ({
            sql: statement.sql,
            params: statement.params ?? [],
          })),
        ),
      );
      return decodeBatchResult(serialized);
    }

    async close() {
      if (this.#closed) {
        return;
      }
      if (this.#closing) {
        return this.#closing;
      }

      this.#closing = nativeModule.close(this.#connectionId)
        .then(() => {
          this.#closed = true;
        })
        .finally(() => {
          this.#closing = null;
        });
      return this.#closing;
    }

    #assertOpen() {
      if (this.#closed || this.#closing) {
        throw new Error(`SQLite database "${this.name}" is closed.`);
      }
    }
  }

  async function open(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('SQLite.open requires an object: { name: string }.');
    }
    assertDatabaseName(options.name);
    const connectionId = await nativeModule.open(options.name);
    return new SQLiteDatabase(options.name, connectionId);
  }

  async function deleteDatabase(name) {
    assertDatabaseName(name);
    await nativeModule.deleteDatabase(name);
  }

  const SQLite = Object.freeze({
    open,
    deleteDatabase,
  });

  return {
    blob,
    SQLiteDatabase,
    SQLite,
    default: SQLite,
  };
}

module.exports = { createSQLiteKit };
