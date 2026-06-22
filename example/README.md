# Native smoke-test screen

`App.tsx` and `SmokeTests.ts` are intentionally dependency-free. Copy them into a bare React Native app that consumes this package, then run the screen on a physical Android device and iOS Simulator/device.

The smoke test covers table creation, positional parameter binding, BLOB round-tripping, and transaction rollback. A production release should pass it on both platforms.
