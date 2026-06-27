# Changelog

## 1.2.4 - 2026-06-27

- Allow single `CREATE TRIGGER ... BEGIN ...; ... END` statements through JavaScript and Android validation.
- Remove the stale Android generated spec import that breaks React Native 0.83 codegen builds.
- Pass an empty edit table to Android `rawQueryWithFactory` for newer AndroidX/RN toolchains.

## 1.2.3 - 2026-06-24

- Reject new database work as soon as a connection starts closing.
- Reject multiple SQL statements at the JavaScript boundary.
- Safely decode result columns with special names such as `__proto__`.
- Correct package imports and the repository URL in CocoaPods metadata.
- Refresh the README with clearer setup, API, type, and constraint documentation.

## 1.2.2 - 2026-06-23

- Bumped the package version for publication.

## 1.2.1

- Fixed package name in README from `react-native-sqlite-kit` to `rn-sqlite-kit`.
- Improved documentation clarity and installation instructions.
- Removed duplicate title in README.

## 1.2.0

- Automated CI/CD with GitHub Actions.
- Simplified release workflow: push tag → npm publish automatic.
- Improved build consistency and deployment reliability.
- Continuous integration tests on every pull request.

## 1.1.0

- Published on npm as `rn-sqlite-kit`.
- Updated repository URLs to GitHub `monavidev/rn-sqlite-kit`.
- Enhanced documentation and setup guides.
- Improved type definitions and error messages.
- All tests passing with 100% coverage of API.
- Ready for production use on iOS and Android.

## 1.0.0

- Initial public API: open, execute, transaction, close, deleteDatabase, and BLOB values.
- Direct Android system SQLite implementation.
- Direct iOS system SQLite implementation.
- React Native Codegen/TurboModule contract.
- No npm runtime or development dependencies.
