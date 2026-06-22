/** @type {import('@react-native-community/cli-types').Config} */
module.exports = {
  dependency: {
    platforms: {
      android: {
        packageImportPath:
          'import com.reactnativesqlitekit.ReactNativeSqliteKitPackage;',
        packageInstance: 'new ReactNativeSqliteKitPackage()',
      },
    },
  },
};
