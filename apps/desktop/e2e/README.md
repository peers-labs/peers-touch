# Desktop Performance Tests

This directory is performance-only. Playwright must not be used for product
Acceptance.

Native macOS product Acceptance lives under `tooling/acceptance/` and uses:

```text
Python gates -> Selenium -> embedded WebDriver -> native Tauri WKWebView
```

`tests/performance-browser-collect.spec.ts` samples the browser performance
cell. The remaining specs and shared fixtures are retained only for the
performance evidence pipeline; they are not Acceptance gates.
