---
kind: invariant
title: Desktop Vite readiness includes a dependency canary
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

# Desktop Vite readiness includes a dependency canary

## What must hold

Desktop startup and runtime reuse MUST treat Vite as ready only after a
dependency canary that imports generated protocol bindings returns a successful
HTTP response, remains stable for a bounded window, and succeeds again. An open
TCP port, root document response, or shallow renderer entry transform is
insufficient.

## Why this is non-negotiable

Vite can successfully transform `/src/main.tsx` before its transitive imports
have completed their first transform. Starting Tauri at that boundary lets the
WebView fail its one-shot entry request when a dependency such as
`desktop_api.ts` cannot yet resolve a generated protocol module, leaving the
window on the boot error surface after Vite recovers.

Startup and status reuse must share the same probe. Otherwise a failed native
window can be classified as reusable solely because the port and root document
are available.

## How to verify

- `node --test tooling/devctl/test/desktop.test.mjs` passes.
- `rg -n "desktopViteReadinessUrl|waitForDesktopVite" tooling/devctl/desktop.mjs`
  shows the same dependency-canary URL used by startup and status, with a
  bounded stability window before the second startup probe.
- A cold `make desktop` reaches `shell:end` and `identity:end` without
  `RESOURCE LOAD ERROR` or `React did not mount`.

## Crosswalks

- Developer Toolchain lifecycle: `docs/architecture/developer-toolchain/design.md`.
