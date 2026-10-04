# Desktop Performance Tests

This directory is performance-only. Playwright must not be used for product
Acceptance.

Native macOS product Acceptance lives under `tooling/acceptance/` and uses:

```text
Python gates -> Selenium -> embedded WebDriver -> native Tauri WKWebView
```

The retained specs sample only Native Tauri WebView development or packaged
runtime cells. They belong to the performance evidence pipeline and are not
product Acceptance gates.
