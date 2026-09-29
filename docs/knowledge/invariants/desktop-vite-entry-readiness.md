---
kind: invariant
title: Desktop Vite readiness includes the entry module
status: active
owns:
  - tooling/devctl/desktop.mjs
  - tooling/devctl/test/desktop.test.mjs
referenced-by:
  - docs/knowledge/README.md
related:
  - docs/architecture/developer-toolchain/design.md
detected: 2026-09-29
---

# Desktop Vite readiness includes the entry module

## What must hold

Desktop startup and runtime reuse MUST treat Vite as ready only after the
renderer entry module returns a successful HTTP response. An open TCP port or a
successful root document response is insufficient.

## Why this is non-negotiable

Vite can accept connections and serve `index.html` before the renderer entry
module has completed its first transform. Starting Tauri at that boundary lets
the WebView fail its one-shot `/src/main.tsx` request and remain on the boot
error surface even after Vite becomes healthy.

Startup and status reuse must share the same probe. Otherwise a failed native
window can be classified as reusable solely because the port and root document
are available.

## How to verify

- `node --test tooling/devctl/test/desktop.test.mjs` passes.
- `rg -n "desktopViteReadinessUrl|waitForDesktopVite" tooling/devctl/desktop.mjs`
  shows the same entry-module URL used by startup and status.
- A cold `make desktop` reaches `shell:end` and `identity:end` without
  `RESOURCE LOAD ERROR` or `React did not mount`.

## Crosswalks

- Developer Toolchain lifecycle: `docs/architecture/developer-toolchain/design.md`.
