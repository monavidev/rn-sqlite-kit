function isBlob(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.type === 'blob' &&
    typeof value.base64 === 'string'
  );
}

function isCell(value) {
  return (
    value === null ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    isBlob(value)
  );
}

function parseRow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Native SQLite result included an invalid row.');
  }

  const row = {};
  for (const [key, cell] of Object.entries(value)) {
    if (!isCell(cell)) {
      throw new TypeError(`Native SQLite result included an invalid value for column "${key}".`);
    }
    row[key] = cell;
  }
  return row;
}

function parseResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Native SQLite result is not an object.');
  }

  if (!Array.isArray(value.rows)) {
    throw new TypeError('Native SQLite result is missing rows.');
  }
  if (!Number.isInteger(value.rowsAffected) || value.rowsAffected < 0) {
    throw new TypeError('Native SQLite result has an invalid rowsAffected value.');
  }
  if (value.insertId !== null && value.insertId !== undefined && !Number.isFinite(value.insertId)) {
    throw new TypeError('Native SQLite result has an invalid insertId value.');
  }

  return Object.freeze({
    rows: value.rows.map(parseRow),
    rowsAffected: value.rowsAffected,
    insertId: value.insertId ?? null,
  });
}

function decodeResult(serialized) {
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new TypeError('Native SQLite returned malformed JSON.');
  }
  return parseResult(parsed);
}

function decodeBatchResult(serialized) {
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new TypeError('Native SQLite returned malformed JSON.');
  }

  if (!Array.isArray(parsed)) {
    throw new TypeError('Native SQLite batch result is not an array.');
  }
  return parsed.map(parseResult);
}

module.exports = {
  decodeResult,
  decodeBatchResult,
};
