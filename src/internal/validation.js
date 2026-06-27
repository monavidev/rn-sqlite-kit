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

  assertSingleStatement(sql);
  const placeholders = countPositionalPlaceholders(sql);
  if (placeholders !== params.length) {
    throw new TypeError(
      `SQL has ${placeholders} positional ? parameter(s), but ${params.length} value(s) were supplied.`,
    );
  }

  params.forEach((value, index) => assertParameter(value, `params[${index}]`));
}

/**
 * Rejects batches at the JavaScript boundary so callers receive a clear error
 * before native work begins. A single trailing semicolon is accepted;
 * additional SQL after it is not.
 */
function assertSingleStatement(sql) {
  if (isCreateTriggerStatement(sql)) {
    assertSingleCreateTriggerStatement(sql);
    return;
  }

  let hasContent = false;
  let index = 0;
  let terminated = false;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (/\s/.test(char)) {
      index += 1;
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

    if (terminated) {
      throw new TypeError(
        'execute accepts exactly one SQL statement. Use transaction for a batch.',
      );
    }

    if (char === "'" || char === '"' || char === '`') {
      hasContent = true;
      index = consumeQuoted(sql, index, char);
      continue;
    }

    if (char === '[') {
      hasContent = true;
      index = consumeBracketIdentifier(sql, index);
      continue;
    }

    if (isIdentifierStart(char)) {
      hasContent = true;
      index = consumeIdentifier(sql, index);
      continue;
    }

    if (char === ';') {
      if (!hasContent) {
        throw new TypeError(
          'execute accepts exactly one SQL statement. Use transaction for a batch.',
        );
      }
      terminated = true;
      index += 1;
      continue;
    }

    hasContent = true;
    index += 1;
  }

  if (!hasContent) {
    throw new TypeError('SQL must be a non-empty string.');
  }
}

function assertSingleCreateTriggerStatement(sql) {
  const end = findCreateTriggerEnd(sql);
  if (end === -1 || !hasOnlyOptionalTerminator(sql, end)) {
    throw new TypeError(
      'execute accepts exactly one SQL statement. Use transaction for a batch.',
    );
  }
}

function isCreateTriggerStatement(sql) {
  const keywords = firstKeywords(sql, 3);
  return (
    keywords[0] === 'CREATE' &&
    (keywords[1] === 'TRIGGER' ||
      ((keywords[1] === 'TEMP' || keywords[1] === 'TEMPORARY') &&
        keywords[2] === 'TRIGGER'))
  );
}

function firstKeywords(sql, limit) {
  const keywords = [];
  let index = 0;

  while (index < sql.length && keywords.length < limit) {
    const char = sql[index];
    const next = sql[index + 1];

    if (/\s/.test(char)) {
      index += 1;
    } else if (char === '-' && next === '-') {
      index = consumeLineComment(sql, index + 2);
    } else if (char === '/' && next === '*') {
      index = consumeBlockComment(sql, index + 2);
    } else if (isIdentifierStart(char)) {
      const end = consumeIdentifier(sql, index);
      keywords.push(sql.slice(index, end).toUpperCase());
      index = end;
    } else {
      break;
    }
  }

  return keywords;
}

function findCreateTriggerEnd(sql) {
  let index = 0;
  let inTriggerBody = false;
  let caseDepth = 0;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (/\s/.test(char)) {
      index += 1;
    } else if (char === '-' && next === '-') {
      index = consumeLineComment(sql, index + 2);
    } else if (char === '/' && next === '*') {
      index = consumeBlockComment(sql, index + 2);
    } else if (char === "'" || char === '"' || char === '`') {
      index = consumeQuoted(sql, index, char);
    } else if (char === '[') {
      index = consumeBracketIdentifier(sql, index);
    } else if (isIdentifierStart(char)) {
      const end = consumeIdentifier(sql, index);
      const keyword = sql.slice(index, end).toUpperCase();
      const controlKeyword = isStandaloneControlKeyword(sql, index, end);

      if (!inTriggerBody && keyword === 'BEGIN' && controlKeyword) {
        inTriggerBody = true;
      } else if (inTriggerBody && keyword === 'CASE' && controlKeyword) {
        caseDepth += 1;
      } else if (inTriggerBody && keyword === 'END' && controlKeyword) {
        if (caseDepth > 0) {
          caseDepth -= 1;
        } else if (isTriggerEndBoundary(sql, end)) {
          return end;
        }
      }

      index = end;
    } else {
      index += 1;
    }
  }

  return -1;
}

function isStandaloneControlKeyword(sql, start, end) {
  const previous = previousNonWhitespace(sql, start);
  const next = skipTrivia(sql, end);

  return (
    previous !== '.' &&
    next < sql.length &&
    sql[next] !== '.' &&
    sql[next] !== '='
  ) || (
    previous !== '.' &&
    next >= sql.length
  );
}

function previousNonWhitespace(sql, start) {
  let index = start - 1;
  while (index >= 0 && /\s/.test(sql[index])) index -= 1;
  return index >= 0 ? sql[index] : '';
}

function isTriggerEndBoundary(sql, index) {
  const next = skipTrivia(sql, index);
  return next >= sql.length || sql[next] === ';';
}

function hasOnlyOptionalTerminator(sql, index) {
  index = skipTrivia(sql, index);
  if (index < sql.length && sql[index] === ';') {
    index = skipTrivia(sql, index + 1);
  }
  return index >= sql.length;
}

function skipTrivia(sql, start) {
  let index = start;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (/\s/.test(char)) {
      index += 1;
    } else if (char === '-' && next === '-') {
      index = consumeLineComment(sql, index + 2);
    } else if (char === '/' && next === '*') {
      index = consumeBlockComment(sql, index + 2);
    } else {
      break;
    }
  }

  return index;
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

function consumeIdentifier(sql, start) {
  let index = start + 1;
  while (index < sql.length && /[A-Za-z0-9_]/.test(sql[index])) {
    index += 1;
  }
  return index;
}

module.exports = {
  assertDatabaseName,
  assertSqlAndParameters,
  assertStatements,
  assertParameter,
  assertSingleStatement,
  countPositionalPlaceholders,
};
