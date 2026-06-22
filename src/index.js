const NativeReactNativeSqliteKit = require('./NativeReactNativeSqliteKit').default;
const { createSQLiteKit } = require('./createSQLiteKit');

module.exports = createSQLiteKit(NativeReactNativeSqliteKit);
