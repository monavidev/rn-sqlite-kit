export type SqliteBlob = Readonly<{
  type: 'blob';
  base64: string;
}>;

/** Values accepted as positional `?` parameters. */
export type SqliteParameter = string | number | boolean | null | SqliteBlob;

/** Values returned by SQLite. Booleans are stored and returned as 0 or 1. */
export type SqliteCell = string | number | null | SqliteBlob;

export type SqliteRow = Record<string, SqliteCell>;

export type SqliteResult = Readonly<{
  rows: SqliteRow[];
  rowsAffected: number;
  insertId: number | null;
}>;

export type SqliteStatement = Readonly<{
  sql: string;
  params?: readonly SqliteParameter[];
}>;

export type OpenDatabaseOptions = Readonly<{
  /** A file name stored in this app's private database directory. */
  name: string;
}>;

export declare function blob(base64: string): SqliteBlob;

export declare class SQLiteDatabase {
  readonly name: string;

  execute(sql: string, params?: readonly SqliteParameter[]): Promise<SqliteResult>;

  transaction(
    statements: readonly SqliteStatement[],
  ): Promise<SqliteResult[]>;

  close(): Promise<void>;
}

export declare const SQLite: Readonly<{
  open(options: OpenDatabaseOptions): Promise<SQLiteDatabase>;
  deleteDatabase(name: string): Promise<void>;
}>;

export default SQLite;
