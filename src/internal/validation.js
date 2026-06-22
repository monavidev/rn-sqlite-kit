const DATABASE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function assertDatabaseName(name) {
  if (typeof name !== 'string' || !DATABASE_NAME.test(name)) {
    throw new TypeError(
      'Database name must contain 1-128 letters, numbers, dots, underscores, or hyphens and cannot start with a dot.',
    );
  }
}

function assertSqlAndParameters(sql, params) {
  if (typeof sql !== 'string' || sql.trim().length === 0) {
    throw new TypeError('SQL must be a non-empty string.');
  }
  if (!Array.isArray(params)) {
    throw new TypeError('SQL parameters must be an array.');
  }

  const placeholders = countPositionalPlaceholders(sql);
  if (placeholders !== params.length) {
    throw new TypeError(
      `SQL has ${placeholders} positional ? parameter(s), but ${params.length} value(s) were supplied.`,
    );
  }

  params.forEach((value, index) => assertParameter(value, `params[${index}]`));
}

function assertStatements(statements) {
  if (!Array.isArray(statements)) {
    throw new TypeError('transaction(statements) requires an array.');
  }

  statements.forEach((statement, index) => {
    if (!statement || typeof statement !== 'object' || Array.isArray(statement)) {
      throw new TypeError(`statements[${index}] must be an object.`);
    }
    assertSqlAndParameters(statement.sql, statement.params ?? []);
  });
}

function assertParameter(value, path) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} cannot be NaN or Infinity.`);
    }
    return;
  }

  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.type === 'blob' &&
    typeof value.base64 === 'string' &&
    BASE64.test(value.base64)
  ) {
    return;
  }

  throw new TypeError(
    `${path} must be string, finite number, boolean, null, or { type: 'blob', base64: string }.`,
  );
}

/**
 * Counts unnumbered positional `?` parameters outside SQL strings/comments.
 * Named parameters and numbered ?NNN placeholders are deliberately rejected:
 * the public API accepts only a positional values array.
 */
function countPositionalPlaceholders(sql) {
  let count = 0;
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (char === "'" || char === '"' || char === '`') {
      index = consumeQuoted(sql, index, char);
      continue;
    }

    if (char === '[') {
      index = consumeBracketIdentifier(sql, index);
      continue;
    }

    if (char === '-' && next === '-') {
      index = consumeLineComment(sql, index + 2);
      continue;
    }

    if (char === '/' && next === '*') {
      index = consumeBlockComment(sql, index + 2);
      continue;
    }

    if (char === '?') {
      if (isDigit(next)) {
        throw new TypeError('Numbered SQLite placeholders (?NNN) are not supported. Use unnumbered ? placeholders.');
      }
      count += 1;
      index += 1;
      continue;
    }

    if ((char === ':' || char === '@' || char === '$') && isIdentifierStart(next)) {
      throw new TypeError('Named SQLite placeholders are not supported. Use unnumbered ? placeholders.');
    }

    index += 1;
  }

  return count;
}

function consumeQuoted(sql, start, quote) {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === quote) {
      if (sql[index + 1] === quote && quote !== '`') {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return index;
}

function consumeBracketIdentifier(sql, start) {
  const end = sql.indexOf(']', start + 1);
  return end === -1 ? sql.length : end + 1;
}

function consumeLineComment(sql, start) {
  const end = sql.indexOf('\n', start);
  return end === -1 ? sql.length : end + 1;
}

function consumeBlockComment(sql, start) {
  const end = sql.indexOf('*/', start);
  return end === -1 ? sql.length : end + 2;
}

function isDigit(value) {
  return typeof value === 'string' && value >= '0' && value <= '9';
}

function isIdentifierStart(value) {
  return typeof value === 'string' && /[A-Za-z_]/.test(value);
}

module.exports = {
  assertDatabaseName,
  assertSqlAndParameters,
  assertStatements,
  assertParameter,
  countPositionalPlaceholders,
};
