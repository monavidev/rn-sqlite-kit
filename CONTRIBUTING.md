# Contributing

## Rules

- Keep `dependencies` and `devDependencies` empty. This repository intentionally has no third-party npm code in its shipped library or test harness.
- Keep Android implementation limited to Android platform APIs and iOS implementation limited to Apple platform APIs plus React Native's own generated interface.
- Preserve API parity between Android and iOS.
- Do not change the public API without adding validation tests and a smoke-test scenario.

## Before opening a pull request

```bash
npm run check
```

Also run `example/App.tsx` / `example/SmokeTests.ts` in a bare React Native app on Android and iOS for any native change.
