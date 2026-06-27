package com.reactnativesqlitekit

import android.database.Cursor
import android.database.sqlite.SQLiteCursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteProgram
import android.database.sqlite.SQLiteQuery
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

private data class ManagedDatabase(
  val database: SQLiteDatabase,
  var referenceCount: Int,
)

/**
 * Direct Android implementation backed by android.database.sqlite. Operations
 * are serialized on one worker so SQLite I/O never runs on the JS thread and a
 * database handle cannot be used concurrently by this module.
 */
class ReactNativeSqliteKitModule(
  reactContext: ReactApplicationContext,
) : NativeReactNativeSqliteKitSpec(reactContext) {
  private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "ReactNativeSqliteKit").apply { isDaemon = true }
  }
  private val connections = mutableMapOf<String, String>()
  private val databases = mutableMapOf<String, ManagedDatabase>()

  override fun getName(): String = NAME

  override fun open(databaseName: String, promise: Promise) {
    runAsync(promise) {
      require(DATABASE_NAME.matches(databaseName)) {
        "Database name contains unsupported characters."
      }

      val managed = databases[databaseName] ?: openManagedDatabase(databaseName).also {
        databases[databaseName] = it
      }
      managed.referenceCount += 1

      UUID.randomUUID().toString().also { connectionId ->
        connections[connectionId] = databaseName
      }
    }
  }

  override fun close(connectionId: String, promise: Promise) {
    runAsync(promise) {
      val databaseName = connections.remove(connectionId)
        ?: throw IllegalStateException("Unknown or closed SQLite connection.")
      val managed = databases[databaseName]
        ?: throw IllegalStateException("SQLite database is not open.")

      managed.referenceCount -= 1
      if (managed.referenceCount <= 0) {
        closeQuietly(managed.database)
        databases.remove(databaseName)
      }
      true
    }
  }

  override fun deleteDatabase(databaseName: String, promise: Promise) {
    runAsync(promise) {
      require(DATABASE_NAME.matches(databaseName)) {
        "Database name contains unsupported characters."
      }

      connections.entries.removeIf { (_, name) -> name == databaseName }
      databases.remove(databaseName)?.let { closeQuietly(it.database) }
      reactApplicationContext.deleteDatabase(databaseName)
      true
    }
  }

  override fun execute(
    connectionId: String,
    sql: String,
    paramsJson: String,
    promise: Promise,
  ) {
    runAsync(promise) {
      val params = parseArray(paramsJson, "params")
      executeStatement(databaseForConnection(connectionId), sql, params).toString()
    }
  }

  override fun executeBatch(
    connectionId: String,
    statementsJson: String,
    promise: Promise,
  ) {
    runAsync(promise) {
      val database = databaseForConnection(connectionId)
      val statements = parseArray(statementsJson, "statements")
      val results = JSONArray()

      database.beginTransactionNonExclusive()
      try {
        for (index in 0 until statements.length()) {
          val entry = statements.optJSONObject(index)
            ?: throw IllegalArgumentException("statements[$index] must be an object.")
          val sql = entry.optString("sql", "")
          val params = entry.optJSONArray("params") ?: JSONArray()
          results.put(executeStatement(database, sql, params))
        }
        database.setTransactionSuccessful()
      } finally {
        database.endTransaction()
      }

      results.toString()
    }
  }

  override fun invalidate() {
    runCatching {
      executor.execute {
        databases.values.forEach { closeQuietly(it.database) }
        databases.clear()
        connections.clear()
      }
    }
    executor.shutdown()
    super.invalidate()
  }

  private fun openManagedDatabase(databaseName: String): ManagedDatabase {
    val databaseFile: File = reactApplicationContext.getDatabasePath(databaseName)
    val parent = databaseFile.parentFile
    if (parent != null && !parent.exists() && !parent.mkdirs()) {
      throw IllegalStateException("Unable to create SQLite database directory.")
    }

    val database = SQLiteDatabase.openDatabase(
      databaseFile.absolutePath,
      null,
      SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY,
    )

    try {
      database.setForeignKeyConstraintsEnabled(true)
      database.enableWriteAheadLogging()
      database.execSQL("PRAGMA busy_timeout = 5000")
      return ManagedDatabase(database, 0)
    } catch (error: Throwable) {
      closeQuietly(database)
      throw error
    }
  }

  private fun databaseForConnection(connectionId: String): SQLiteDatabase {
    val databaseName = connections[connectionId]
      ?: throw IllegalStateException("Unknown or closed SQLite connection.")
    return databases[databaseName]?.database
      ?: throw IllegalStateException("SQLite database is not open.")
  }

  private fun executeStatement(
    database: SQLiteDatabase,
    sql: String,
    params: JSONArray,
  ): JSONObject {
    assertOneStatement(sql)
    val keyword = primaryKeyword(sql)
    require(keyword.isNotEmpty()) { "SQL must be a non-empty string." }
    val parameterCount = countPositionalPlaceholders(sql)
    require(parameterCount == params.length()) {
      "SQL has $parameterCount positional ? parameter(s), but ${params.length()} value(s) were supplied."
    }

    return if (statementReturnsRows(keyword)) {
      executeQuery(database, sql, params)
    } else {
      executeMutation(database, sql, params, keyword)
    }
  }

  private fun executeQuery(
    database: SQLiteDatabase,
    sql: String,
    params: JSONArray,
  ): JSONObject {
    val cursor = database.rawQueryWithFactory(
      SQLiteDatabase.CursorFactory { _, driver, editTable, query ->
        bindArguments(query, params)
        SQLiteCursor(driver, editTable, query)
      },
      sql,
      emptyArray<String>(),
      "",
    )

    cursor.use {
      val rows = JSONArray()
      while (it.moveToNext()) {
        val row = JSONObject()
        for (columnIndex in 0 until it.columnCount) {
          row.put(it.getColumnName(columnIndex), cursorValue(it, columnIndex))
        }
        rows.put(row)
      }
      return JSONObject()
        .put("rows", rows)
        .put("rowsAffected", 0)
        .put("insertId", JSONObject.NULL)
    }
  }

  private fun executeMutation(
    database: SQLiteDatabase,
    sql: String,
    params: JSONArray,
    keyword: String,
  ): JSONObject {
    val statement = database.compileStatement(sql)
    try {
      bindArguments(statement, params)
      val result = JSONObject().put("rows", JSONArray())

      when (keyword) {
        "INSERT", "REPLACE" -> {
          val insertId = statement.executeInsert()
          result.put("rowsAffected", if (insertId == -1L) 0 else 1)
          result.put("insertId", if (insertId == -1L) JSONObject.NULL else insertId)
        }
        "UPDATE", "DELETE" -> {
          result.put("rowsAffected", statement.executeUpdateDelete())
          result.put("insertId", JSONObject.NULL)
        }
        else -> {
          statement.execute()
          result.put("rowsAffected", 0)
          result.put("insertId", JSONObject.NULL)
        }
      }
      return result
    } finally {
      statement.close()
    }
  }

  private fun bindArguments(program: SQLiteProgram, params: JSONArray) {
    for (index in 0 until params.length()) {
      val argumentIndex = index + 1
      when (val value = params.get(index)) {
        JSONObject.NULL -> program.bindNull(argumentIndex)
        is Boolean -> program.bindLong(argumentIndex, if (value) 1 else 0)
        is Byte, is Short, is Int, is Long -> program.bindLong(argumentIndex, (value as Number).toLong())
        is Float, is Double -> program.bindDouble(argumentIndex, (value as Number).toDouble())
        is Number -> program.bindDouble(argumentIndex, value.toDouble())
        is String -> program.bindString(argumentIndex, value)
        is JSONObject -> {
          if (value.optString("type") != "blob" || !value.has("base64")) {
            throw IllegalArgumentException("Only { type: 'blob', base64: string } objects are valid SQLite parameters.")
          }
          val base64 = value.optString("base64", "")
          try {
            program.bindBlob(argumentIndex, Base64.decode(base64, Base64.DEFAULT))
          } catch (error: IllegalArgumentException) {
            throw IllegalArgumentException("Invalid base64 SQLite BLOB value.", error)
          }
        }
        else -> throw IllegalArgumentException("Unsupported SQLite parameter at index $index.")
      }
    }
  }

  private fun cursorValue(cursor: Cursor, index: Int): Any {
    return when (cursor.getType(index)) {
      Cursor.FIELD_TYPE_NULL -> JSONObject.NULL
      Cursor.FIELD_TYPE_INTEGER -> cursor.getLong(index)
      Cursor.FIELD_TYPE_FLOAT -> cursor.getDouble(index)
      Cursor.FIELD_TYPE_STRING -> cursor.getString(index)
      Cursor.FIELD_TYPE_BLOB -> JSONObject()
        .put("type", "blob")
        .put("base64", Base64.encodeToString(cursor.getBlob(index), Base64.NO_WRAP))
      else -> throw IllegalStateException("Unsupported SQLite column type.")
    }
  }

  private fun parseArray(serialized: String, label: String): JSONArray {
    return try {
      JSONArray(serialized)
    } catch (error: Exception) {
      throw IllegalArgumentException("$label must be a valid JSON array.", error)
    }
  }

  private fun statementReturnsRows(keyword: String): Boolean =
    keyword == "SELECT" || keyword == "PRAGMA" || keyword == "EXPLAIN" || keyword == "VALUES"

  private fun primaryKeyword(sql: String): String {
    val keywords = topLevelKeywords(sql)
    if (keywords.isEmpty()) return ""
    if (keywords.first() != "WITH") return keywords.first()

    val mainKeywords = setOf("SELECT", "INSERT", "UPDATE", "DELETE", "REPLACE", "PRAGMA", "EXPLAIN", "VALUES")
    return keywords.drop(1).firstOrNull { it in mainKeywords } ?: "WITH"
  }

  private fun topLevelKeywords(sql: String): List<String> {
    val output = mutableListOf<String>()
    var index = 0
    var depth = 0

    while (index < sql.length) {
      val char = sql[index]
      val next = sql.getOrNull(index + 1)
      when {
        char.isWhitespace() -> index += 1
        char == '-' && next == '-' -> index = skipLineComment(sql, index + 2)
        char == '/' && next == '*' -> index = skipBlockComment(sql, index + 2)
        char == '\'' || char == '"' || char == '`' -> index = skipQuoted(sql, index, char)
        char == '[' -> index = skipBracketIdentifier(sql, index)
        char == '(' -> {
          depth += 1
          index += 1
        }
        char == ')' -> {
          if (depth > 0) depth -= 1
          index += 1
        }
        isIdentifierStart(char) -> {
          val start = index
          index += 1
          while (index < sql.length && isIdentifierPart(sql[index])) index += 1
          if (depth == 0) output.add(sql.substring(start, index).uppercase(Locale.US))
        }
        else -> index += 1
      }
    }
    return output
  }

  private fun assertOneStatement(sql: String) {
    if (isCreateTriggerStatement(sql)) {
      assertSingleCreateTriggerStatement(sql)
      return
    }

    var index = 0
    var hasStatementContent = false
    var terminated = false

    while (index < sql.length) {
      val char = sql[index]
      val next = sql.getOrNull(index + 1)
      when {
        char.isWhitespace() -> index += 1
        char == '-' && next == '-' -> index = skipLineComment(sql, index + 2)
        char == '/' && next == '*' -> index = skipBlockComment(sql, index + 2)
        char == '\'' || char == '"' || char == '`' -> {
          if (terminated) throw IllegalArgumentException("execute accepts exactly one SQL statement. Use transaction for a batch.")
          hasStatementContent = true
          index = skipQuoted(sql, index, char)
        }
        char == '[' -> {
          if (terminated) throw IllegalArgumentException("execute accepts exactly one SQL statement. Use transaction for a batch.")
          hasStatementContent = true
          index = skipBracketIdentifier(sql, index)
        }
        isIdentifierStart(char) -> {
          if (terminated) throw IllegalArgumentException("execute accepts exactly one SQL statement. Use transaction for a batch.")
          hasStatementContent = true
          index = readIdentifierEnd(sql, index)
        }
        char == ';' -> {
          if (!hasStatementContent || terminated) {
            throw IllegalArgumentException("execute accepts exactly one SQL statement. Use transaction for a batch.")
          }
          terminated = true
          index += 1
        }
        else -> {
          if (terminated) throw IllegalArgumentException("execute accepts exactly one SQL statement. Use transaction for a batch.")
          hasStatementContent = true
          index += 1
        }
      }
    }

    require(hasStatementContent) { "SQL must be a non-empty string." }
  }

  private fun assertSingleCreateTriggerStatement(sql: String) {
    val end = findCreateTriggerEnd(sql)
    if (end == -1 || !hasOnlyOptionalTerminator(sql, end)) {
      throw IllegalArgumentException("execute accepts exactly one SQL statement. Use transaction for a batch.")
    }
  }

  private fun isCreateTriggerStatement(sql: String): Boolean {
    val keywords = firstKeywords(sql, 3)
    return keywords.getOrNull(0) == "CREATE" &&
      (keywords.getOrNull(1) == "TRIGGER" ||
        ((keywords.getOrNull(1) == "TEMP" || keywords.getOrNull(1) == "TEMPORARY") &&
          keywords.getOrNull(2) == "TRIGGER"))
  }

  private fun firstKeywords(sql: String, limit: Int): List<String> {
    val keywords = mutableListOf<String>()
    var index = 0

    while (index < sql.length && keywords.size < limit) {
      val char = sql[index]
      val next = sql.getOrNull(index + 1)
      when {
        char.isWhitespace() -> index += 1
        char == '-' && next == '-' -> index = skipLineComment(sql, index + 2)
        char == '/' && next == '*' -> index = skipBlockComment(sql, index + 2)
        isIdentifierStart(char) -> {
          val end = readIdentifierEnd(sql, index)
          keywords.add(sql.substring(index, end).uppercase(Locale.US))
          index = end
        }
        else -> return keywords
      }
    }

    return keywords
  }

  private fun findCreateTriggerEnd(sql: String): Int {
    var index = 0
    var inTriggerBody = false
    var caseDepth = 0

    while (index < sql.length) {
      val char = sql[index]
      val next = sql.getOrNull(index + 1)
      when {
        char.isWhitespace() -> index += 1
        char == '-' && next == '-' -> index = skipLineComment(sql, index + 2)
        char == '/' && next == '*' -> index = skipBlockComment(sql, index + 2)
        char == '\'' || char == '"' || char == '`' -> index = skipQuoted(sql, index, char)
        char == '[' -> index = skipBracketIdentifier(sql, index)
        isIdentifierStart(char) -> {
          val end = readIdentifierEnd(sql, index)
          val keyword = sql.substring(index, end).uppercase(Locale.US)
          val controlKeyword = isStandaloneControlKeyword(sql, index, end)

          if (!inTriggerBody && keyword == "BEGIN" && controlKeyword) {
            inTriggerBody = true
          } else if (inTriggerBody && keyword == "CASE" && controlKeyword) {
            caseDepth += 1
          } else if (inTriggerBody && keyword == "END" && controlKeyword) {
            if (caseDepth > 0) {
              caseDepth -= 1
            } else if (isTriggerEndBoundary(sql, end)) {
              return end
            }
          }

          index = end
        }
        else -> index += 1
      }
    }

    return -1
  }

  private fun isStandaloneControlKeyword(sql: String, start: Int, end: Int): Boolean {
    val previous = previousNonWhitespace(sql, start)
    val next = skipTrivia(sql, end)

    return previous != '.' &&
      (next >= sql.length || (sql[next] != '.' && sql[next] != '='))
  }

  private fun previousNonWhitespace(sql: String, start: Int): Char {
    var index = start - 1
    while (index >= 0 && sql[index].isWhitespace()) index -= 1
    return if (index >= 0) sql[index] else '\u0000'
  }

  private fun isTriggerEndBoundary(sql: String, index: Int): Boolean {
    val next = skipTrivia(sql, index)
    return next >= sql.length || sql[next] == ';'
  }

  private fun hasOnlyOptionalTerminator(sql: String, index: Int): Boolean {
    var next = skipTrivia(sql, index)
    if (next < sql.length && sql[next] == ';') {
      next = skipTrivia(sql, next + 1)
    }
    return next >= sql.length
  }

  private fun skipTrivia(sql: String, start: Int): Int {
    var index = start

    while (index < sql.length) {
      val char = sql[index]
      val next = sql.getOrNull(index + 1)
      index = when {
        char.isWhitespace() -> index + 1
        char == '-' && next == '-' -> skipLineComment(sql, index + 2)
        char == '/' && next == '*' -> skipBlockComment(sql, index + 2)
        else -> return index
      }
    }

    return index
  }

  private fun countPositionalPlaceholders(sql: String): Int {
    var count = 0
    var index = 0
    while (index < sql.length) {
      val char = sql[index]
      val next = sql.getOrNull(index + 1)
      when {
        char == '\'' || char == '"' || char == '`' -> index = skipQuoted(sql, index, char)
        char == '[' -> index = skipBracketIdentifier(sql, index)
        char == '-' && next == '-' -> index = skipLineComment(sql, index + 2)
        char == '/' && next == '*' -> index = skipBlockComment(sql, index + 2)
        char == '?' -> {
          require(next == null || !next.isDigit()) {
            "Numbered SQLite placeholders (?NNN) are not supported. Use unnumbered ? placeholders."
          }
          count += 1
          index += 1
        }
        (char == ':' || char == '@' || char == '$') && next != null && isIdentifierStart(next) -> {
          throw IllegalArgumentException("Named SQLite placeholders are not supported. Use unnumbered ? placeholders.")
        }
        else -> index += 1
      }
    }
    return count
  }

  private fun skipQuoted(sql: String, start: Int, quote: Char): Int {
    var index = start + 1
    while (index < sql.length) {
      if (sql[index] == quote) {
        if (quote != '`' && sql.getOrNull(index + 1) == quote) {
          index += 2
        } else {
          return index + 1
        }
      } else {
        index += 1
      }
    }
    return index
  }

  private fun skipBracketIdentifier(sql: String, start: Int): Int {
    val close = sql.indexOf(']', start + 1)
    return if (close == -1) sql.length else close + 1
  }

  private fun skipLineComment(sql: String, start: Int): Int {
    val lineEnd = sql.indexOf('\n', start)
    return if (lineEnd == -1) sql.length else lineEnd + 1
  }

  private fun skipBlockComment(sql: String, start: Int): Int {
    val blockEnd = sql.indexOf("*/", start)
    return if (blockEnd == -1) sql.length else blockEnd + 2
  }

  private fun isIdentifierStart(value: Char): Boolean = value == '_' || value.isLetter()

  private fun isIdentifierPart(value: Char): Boolean = isIdentifierStart(value) || value.isDigit()

  private fun readIdentifierEnd(sql: String, start: Int): Int {
    var index = start + 1
    while (index < sql.length && isIdentifierPart(sql[index])) index += 1
    return index
  }

  private fun closeQuietly(database: SQLiteDatabase) {
    runCatching { database.close() }
  }

  private fun runAsync(promise: Promise, block: () -> Any?) {
    try {
      executor.execute {
        try {
          promise.resolve(block())
        } catch (error: Throwable) {
          promise.reject("SQLITE_ERROR", error.message ?: "SQLite operation failed.", error)
        }
      }
    } catch (error: Throwable) {
      promise.reject("SQLITE_ERROR", error.message ?: "SQLite module is unavailable.", error)
    }
  }

  companion object {
    const val NAME = "ReactNativeSqliteKit"
    private val DATABASE_NAME = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
  }
}
