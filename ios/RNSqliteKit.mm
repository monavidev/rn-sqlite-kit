#import "RNSqliteKit.h"

#import <sqlite3.h>
#import <string.h>

#import <memory>

static NSString *const RNSqliteKitErrorCode = @"SQLITE_ERROR";

static BOOL RNSqliteKitIsValidDatabaseName(NSString *name) {
  static NSRegularExpression *expression;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    expression = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"
                                                           options:0
                                                             error:nil];
  });

  if (![name isKindOfClass:[NSString class]]) {
    return NO;
  }
  return [expression firstMatchInString:name options:0 range:NSMakeRange(0, name.length)] != nil;
}

static NSString *RNSqliteKitSQLiteMessage(sqlite3 *database) {
  const char *message = database == NULL ? "SQLite operation failed." : sqlite3_errmsg(database);
  return [NSString stringWithUTF8String:(message ?: "SQLite operation failed.")];
}

static NSError *RNSqliteKitError(NSString *message) {
  return [NSError errorWithDomain:@"ReactNativeSqliteKit"
                             code:1
                         userInfo:@{ NSLocalizedDescriptionKey : message ?: @"SQLite operation failed." }];
}

@implementation RNSqliteKit

RCT_EXPORT_MODULE(ReactNativeSqliteKit)

- (instancetype)init {
  self = [super init];
  if (self) {
    _databases = [NSMutableDictionary new];
    _connections = [NSMutableDictionary new];
    _referenceCounts = [NSMutableDictionary new];
    _queue = dispatch_queue_create("com.reactnativesqlitekit.database", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (void)invalidate {
  dispatch_async(_queue, ^{
    for (NSValue *value in self->_databases.allValues) {
      sqlite3 *database = static_cast<sqlite3 *>(value.pointerValue);
      if (database != NULL) {
        sqlite3_close_v2(database);
      }
    }
    [self->_databases removeAllObjects];
    [self->_connections removeAllObjects];
    [self->_referenceCounts removeAllObjects];
  });
}

- (void)open:(NSString *)databaseName
      resolve:(RCTPromiseResolveBlock)resolve
       reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_queue, ^{
    if (!RNSqliteKitIsValidDatabaseName(databaseName)) {
      reject(RNSqliteKitErrorCode, @"Database name contains unsupported characters.", nil);
      return;
    }

    NSError *error = nil;
    sqlite3 *database = [self databaseForName:databaseName createIfNeeded:YES error:&error];
    if (database == NULL) {
      reject(RNSqliteKitErrorCode, error.localizedDescription ?: @"Unable to open SQLite database.", error);
      return;
    }

    self->_referenceCounts[databaseName] = @(self->_referenceCounts[databaseName].integerValue + 1);
    NSString *connectionId = NSUUID.UUID.UUIDString;
    self->_connections[connectionId] = databaseName;
    resolve(connectionId);
  });
}

- (void)close:(NSString *)connectionId
       resolve:(RCTPromiseResolveBlock)resolve
        reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_queue, ^{
    NSString *databaseName = self->_connections[connectionId];
    if (databaseName == nil) {
      reject(RNSqliteKitErrorCode, @"Unknown or closed SQLite connection.", nil);
      return;
    }

    [self->_connections removeObjectForKey:connectionId];
    NSInteger remaining = self->_referenceCounts[databaseName].integerValue - 1;
    if (remaining <= 0) {
      sqlite3 *database = static_cast<sqlite3 *>([self->_databases[databaseName] pointerValue]);
      if (database != NULL) {
        sqlite3_close_v2(database);
      }
      [self->_databases removeObjectForKey:databaseName];
      [self->_referenceCounts removeObjectForKey:databaseName];
    } else {
      self->_referenceCounts[databaseName] = @(remaining);
    }

    resolve(@YES);
  });
}

- (void)deleteDatabase:(NSString *)databaseName
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_queue, ^{
    if (!RNSqliteKitIsValidDatabaseName(databaseName)) {
      reject(RNSqliteKitErrorCode, @"Database name contains unsupported characters.", nil);
      return;
    }

    NSArray<NSString *> *connectionIds = [self->_connections allKeysForObject:databaseName];
    for (NSString *connectionId in connectionIds) {
      [self->_connections removeObjectForKey:connectionId];
    }

    sqlite3 *database = static_cast<sqlite3 *>([self->_databases[databaseName] pointerValue]);
    if (database != NULL) {
      sqlite3_close_v2(database);
    }
    [self->_databases removeObjectForKey:databaseName];
    [self->_referenceCounts removeObjectForKey:databaseName];

    NSError *error = nil;
    for (NSString *path in [self pathsForDatabaseName:databaseName]) {
      if (![[NSFileManager defaultManager] fileExistsAtPath:path]) {
        continue;
      }
      if (![[NSFileManager defaultManager] removeItemAtPath:path error:&error]) {
        reject(RNSqliteKitErrorCode, error.localizedDescription, error);
        return;
      }
    }
    resolve(@YES);
  });
}

- (void)execute:(NSString *)connectionId
             sql:(NSString *)sql
      paramsJson:(NSString *)paramsJson
         resolve:(RCTPromiseResolveBlock)resolve
          reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_queue, ^{
    NSError *error = nil;
    sqlite3 *database = [self databaseForConnectionId:connectionId error:&error];
    if (database == NULL) {
      reject(RNSqliteKitErrorCode, error.localizedDescription, error);
      return;
    }

    NSArray *params = [self arrayFromJSON:paramsJson error:&error];
    if (params == nil) {
      reject(RNSqliteKitErrorCode, error.localizedDescription, error);
      return;
    }

    NSDictionary *result = [self executeSQL:sql onDatabase:database params:params error:&error];
    if (result == nil) {
      reject(RNSqliteKitErrorCode, error.localizedDescription, error);
      return;
    }

    NSString *serialized = [self JSONStringFromObject:result error:&error];
    if (serialized == nil) {
      reject(RNSqliteKitErrorCode, error.localizedDescription, error);
      return;
    }
    resolve(serialized);
  });
}

- (void)executeBatch:(NSString *)connectionId
      statementsJson:(NSString *)statementsJson
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_queue, ^{
    NSError *error = nil;
    sqlite3 *database = [self databaseForConnectionId:connectionId error:&error];
    if (database == NULL) {
      reject(RNSqliteKitErrorCode, error.localizedDescription, error);
      return;
    }

    NSArray *statements = [self arrayFromJSON:statementsJson error:&error];
    if (statements == nil) {
      reject(RNSqliteKitErrorCode, error.localizedDescription, error);
      return;
    }

    char *transactionError = NULL;
    if (sqlite3_exec(database, "BEGIN IMMEDIATE", NULL, NULL, &transactionError) != SQLITE_OK) {
      NSString *message = transactionError ? [NSString stringWithUTF8String:transactionError] : RNSqliteKitSQLiteMessage(database);
      if (transactionError != NULL) sqlite3_free(transactionError);
      reject(RNSqliteKitErrorCode, message, RNSqliteKitError(message));
      return;
    }

    NSMutableArray *results = [NSMutableArray arrayWithCapacity:statements.count];
    BOOL success = YES;
    for (NSUInteger index = 0; index < statements.count; index += 1) {
      id entry = statements[index];
      if (![entry isKindOfClass:[NSDictionary class]]) {
        error = RNSqliteKitError([NSString stringWithFormat:@"statements[%lu] must be an object.", (unsigned long)index]);
        success = NO;
        break;
      }

      NSDictionary *statement = (NSDictionary *)entry;
      NSString *sql = statement[@"sql"];
      NSArray *params = statement[@"params"] ?: @[];
      if (![sql isKindOfClass:[NSString class]] || ![params isKindOfClass:[NSArray class]]) {
        error = RNSqliteKitError([NSString stringWithFormat:@"statements[%lu] is invalid.", (unsigned long)index]);
        success = NO;
        break;
      }

      NSDictionary *result = [self executeSQL:sql onDatabase:database params:params error:&error];
      if (result == nil) {
        success = NO;
        break;
      }
      [results addObject:result];
    }

    const char *finalSQL = success ? "COMMIT" : "ROLLBACK";
    transactionError = NULL;
    if (sqlite3_exec(database, finalSQL, NULL, NULL, &transactionError) != SQLITE_OK) {
      NSString *message = transactionError ? [NSString stringWithUTF8String:transactionError] : RNSqliteKitSQLiteMessage(database);
      if (transactionError != NULL) sqlite3_free(transactionError);
      reject(RNSqliteKitErrorCode, message, RNSqliteKitError(message));
      return;
    }
    if (!success) {
      reject(RNSqliteKitErrorCode, error.localizedDescription ?: @"SQLite transaction failed.", error);
      return;
    }

    NSString *serialized = [self JSONStringFromObject:results error:&error];
    if (serialized == nil) {
      reject(RNSqliteKitErrorCode, error.localizedDescription, error);
      return;
    }
    resolve(serialized);
  });
}

- (sqlite3 *)databaseForConnectionId:(NSString *)connectionId error:(NSError **)error {
  NSString *databaseName = _connections[connectionId];
  if (databaseName == nil) {
    if (error) *error = RNSqliteKitError(@"Unknown or closed SQLite connection.");
    return NULL;
  }

  sqlite3 *database = static_cast<sqlite3 *>([_databases[databaseName] pointerValue]);
  if (database == NULL && error) {
    *error = RNSqliteKitError(@"SQLite database is not open.");
  }
  return database;
}

- (sqlite3 *)databaseForName:(NSString *)databaseName
              createIfNeeded:(BOOL)createIfNeeded
                        error:(NSError **)error {
  sqlite3 *existing = static_cast<sqlite3 *>([_databases[databaseName] pointerValue]);
  if (existing != NULL || !createIfNeeded) {
    return existing;
  }

  NSString *path = [self databasePathForName:databaseName];
  if (path == nil) {
    if (error) *error = RNSqliteKitError(@"Unable to resolve the app-private database directory.");
    return NULL;
  }

  NSError *directoryError = nil;
  [[NSFileManager defaultManager] createDirectoryAtPath:[path stringByDeletingLastPathComponent]
                            withIntermediateDirectories:YES
                                             attributes:nil
                                                  error:&directoryError];
  if (directoryError != nil) {
    if (error) *error = directoryError;
    return NULL;
  }

  sqlite3 *database = NULL;
  int opened = sqlite3_open_v2(path.UTF8String,
                               &database,
                               SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX,
                               NULL);
  if (opened != SQLITE_OK) {
    if (error) *error = RNSqliteKitError(RNSqliteKitSQLiteMessage(database));
    if (database != NULL) sqlite3_close_v2(database);
    return NULL;
  }

  sqlite3_busy_timeout(database, 5000);
  char *pragmaError = NULL;
  int foreignKeys = sqlite3_exec(database, "PRAGMA foreign_keys = ON", NULL, NULL, &pragmaError);
  if (foreignKeys == SQLITE_OK) {
    if (pragmaError != NULL) sqlite3_free(pragmaError);
    pragmaError = NULL;
    int journalMode = sqlite3_exec(database, "PRAGMA journal_mode = WAL", NULL, NULL, &pragmaError);
    if (journalMode == SQLITE_OK) {
      if (pragmaError != NULL) sqlite3_free(pragmaError);
      _databases[databaseName] = [NSValue valueWithPointer:database];
      _referenceCounts[databaseName] = @0;
      return database;
    }
  }

  NSString *message = pragmaError ? [NSString stringWithUTF8String:pragmaError] : RNSqliteKitSQLiteMessage(database);
  if (pragmaError != NULL) sqlite3_free(pragmaError);
  if (error) *error = RNSqliteKitError(message);
  sqlite3_close_v2(database);
  return NULL;
}

- (NSString *)databasePathForName:(NSString *)databaseName {
  NSURL *applicationSupportURL = [[NSFileManager defaultManager] URLsForDirectory:NSApplicationSupportDirectory
                                                                          inDomains:NSUserDomainMask].firstObject;
  if (applicationSupportURL == nil) {
    return nil;
  }
  NSString *directory = [applicationSupportURL.path stringByAppendingPathComponent:@"ReactNativeSqliteKit"];
  return [directory stringByAppendingPathComponent:databaseName];
}

- (NSArray<NSString *> *)pathsForDatabaseName:(NSString *)databaseName {
  NSString *path = [self databasePathForName:databaseName];
  if (path == nil) return @[];
  return @[ path, [path stringByAppendingString:@"-wal"], [path stringByAppendingString:@"-shm"] ];
}

- (NSArray *)arrayFromJSON:(NSString *)serialized error:(NSError **)error {
  NSData *data = [serialized dataUsingEncoding:NSUTF8StringEncoding];
  id object = [NSJSONSerialization JSONObjectWithData:data options:0 error:error];
  if (![object isKindOfClass:[NSArray class]]) {
    if (error && *error == nil) *error = RNSqliteKitError(@"Expected a JSON array.");
    return nil;
  }
  return object;
}

- (NSString *)JSONStringFromObject:(id)object error:(NSError **)error {
  NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:error];
  if (data == nil) return nil;
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

- (NSDictionary *)executeSQL:(NSString *)sql
                   onDatabase:(sqlite3 *)database
                       params:(NSArray *)params
                        error:(NSError **)error {
  if (![sql isKindOfClass:[NSString class]] || [[sql stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] length] == 0) {
    if (error) *error = RNSqliteKitError(@"SQL must be a non-empty string.");
    return nil;
  }

  sqlite3_stmt *statement = NULL;
  const char *tail = NULL;
  int prepared = sqlite3_prepare_v2(database, sql.UTF8String, -1, &statement, &tail);
  if (prepared != SQLITE_OK || statement == NULL) {
    if (error) *error = RNSqliteKitError(RNSqliteKitSQLiteMessage(database));
    return nil;
  }

  NSString *remainder = tail ? [[NSString alloc] initWithUTF8String:tail] : @"";
  NSString *trimmedRemainder = [remainder stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (trimmedRemainder.length > 0 && ![trimmedRemainder isEqualToString:@";"]) {
    sqlite3_finalize(statement);
    if (error) *error = RNSqliteKitError(@"execute accepts exactly one SQL statement. Use transaction for a batch.");
    return nil;
  }

  int expectedParameters = sqlite3_bind_parameter_count(statement);
  if (expectedParameters != (int)params.count) {
    sqlite3_finalize(statement);
    if (error) {
      *error = RNSqliteKitError([NSString stringWithFormat:@"SQL has %d positional ? parameter(s), but %lu value(s) were supplied.", expectedParameters, (unsigned long)params.count]);
    }
    return nil;
  }

  if (![self bindParams:params toStatement:statement error:error]) {
    sqlite3_finalize(statement);
    return nil;
  }

  int columns = sqlite3_column_count(statement);
  NSMutableArray *rows = [NSMutableArray new];
  int step = SQLITE_OK;
  if (columns > 0) {
    while ((step = sqlite3_step(statement)) == SQLITE_ROW) {
      NSMutableDictionary *row = [NSMutableDictionary dictionaryWithCapacity:(NSUInteger)columns];
      for (int index = 0; index < columns; index += 1) {
        const char *name = sqlite3_column_name(statement, index);
        NSString *columnName = name ? [NSString stringWithUTF8String:name] : [NSString stringWithFormat:@"column_%d", index];
        row[columnName] = [self valueForColumn:index statement:statement];
      }
      [rows addObject:row];
    }
  } else {
    step = sqlite3_step(statement);
  }

  if (step != SQLITE_DONE) {
    sqlite3_finalize(statement);
    if (error) *error = RNSqliteKitError(RNSqliteKitSQLiteMessage(database));
    return nil;
  }

  NSString *keyword = [self primaryKeywordForSQL:sql];
  BOOL isMutation = [keyword isEqualToString:@"INSERT"] || [keyword isEqualToString:@"REPLACE"] || [keyword isEqualToString:@"UPDATE"] || [keyword isEqualToString:@"DELETE"];
  NSInteger rowsAffected = isMutation ? sqlite3_changes(database) : 0;
  id insertId = ([keyword isEqualToString:@"INSERT"] || [keyword isEqualToString:@"REPLACE"])
      ? @(sqlite3_last_insert_rowid(database))
      : [NSNull null];

  sqlite3_finalize(statement);
  return @{
    @"rows" : rows,
    @"rowsAffected" : @(rowsAffected),
    @"insertId" : insertId,
  };
}

- (BOOL)bindParams:(NSArray *)params toStatement:(sqlite3_stmt *)statement error:(NSError **)error {
  for (NSUInteger index = 0; index < params.count; index += 1) {
    id value = params[index];
    int parameterIndex = (int)index + 1;
    int result = SQLITE_OK;

    if (value == [NSNull null]) {
      result = sqlite3_bind_null(statement, parameterIndex);
    } else if ([value isKindOfClass:[NSString class]]) {
      result = sqlite3_bind_text(statement, parameterIndex, ((NSString *)value).UTF8String, -1, SQLITE_TRANSIENT);
    } else if ([value isKindOfClass:[NSNumber class]]) {
      if (CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID()) {
        result = sqlite3_bind_int(statement, parameterIndex, [value boolValue] ? 1 : 0);
      } else {
        const char *type = [value objCType];
        if (strchr("cislqCISLQ", type[0]) != NULL) {
          result = sqlite3_bind_int64(statement, parameterIndex, [value longLongValue]);
        } else {
          result = sqlite3_bind_double(statement, parameterIndex, [value doubleValue]);
        }
      }
    } else if ([value isKindOfClass:[NSDictionary class]] && [value[@"type"] isEqual:@"blob"] && [value[@"base64"] isKindOfClass:[NSString class]]) {
      NSData *data = [[NSData alloc] initWithBase64EncodedString:value[@"base64"] options:0];
      if (data == nil) {
        if (error) *error = RNSqliteKitError(@"Invalid base64 SQLite BLOB value.");
        return NO;
      }
      result = sqlite3_bind_blob(statement, parameterIndex, data.bytes, (int)data.length, SQLITE_TRANSIENT);
    } else {
      if (error) *error = RNSqliteKitError(@"Unsupported SQLite parameter.");
      return NO;
    }

    if (result != SQLITE_OK) {
      if (error) *error = RNSqliteKitError(RNSqliteKitSQLiteMessage(sqlite3_db_handle(statement)));
      return NO;
    }
  }
  return YES;
}

- (id)valueForColumn:(int)index statement:(sqlite3_stmt *)statement {
  switch (sqlite3_column_type(statement, index)) {
    case SQLITE_NULL:
      return [NSNull null];
    case SQLITE_INTEGER:
      return @(sqlite3_column_int64(statement, index));
    case SQLITE_FLOAT:
      return @(sqlite3_column_double(statement, index));
    case SQLITE_TEXT: {
      const unsigned char *text = sqlite3_column_text(statement, index);
      return text ? [NSString stringWithUTF8String:(const char *)text] : @"";
    }
    case SQLITE_BLOB: {
      const void *bytes = sqlite3_column_blob(statement, index);
      int length = sqlite3_column_bytes(statement, index);
      NSData *data = [NSData dataWithBytes:bytes length:(NSUInteger)length];
      return @{
        @"type" : @"blob",
        @"base64" : [data base64EncodedStringWithOptions:0],
      };
    }
    default:
      return [NSNull null];
  }
}

- (NSString *)primaryKeywordForSQL:(NSString *)sql {
  NSString *trimmed = [sql stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  NSCharacterSet *separators = [NSCharacterSet characterSetWithCharactersInString:@" \t\r\n(;" ];
  return [[[trimmed componentsSeparatedByCharactersInSet:separators] firstObject] uppercaseString] ?: @"";
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeReactNativeSqliteKitSpecJSI>(params);
}

@end
