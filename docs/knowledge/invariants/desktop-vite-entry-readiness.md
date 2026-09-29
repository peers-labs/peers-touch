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

Desktop startup MUST treat Vite as ready only after a dependency canary that
imports generated protocol bindings succeeds, the transformed local module graph
has been fetched, and the canary succeeds again. Startup itself is complete only
after the WebView reports that React mounted. An open TCP port, root document
response, or shallow renderer entry transform is insufficient.

The Vite dev server MUST send `Cache-Control: no-store` for every runtime mode.
WebKit otherwise retains transformed module responses across Vite restarts and
can reject a new entry graph even when every current HTTP request succeeds.

## Why this is non-negotiable

Vite can successfully transform `/src/main.tsx` before its transitive imports
have completed their first transform. Starting Tauri at that boundary lets the
WebView fail its one-shot entry request when a dependency such as
`desktop_api.ts` cannot yet resolve a generated protocol module, leaving the
window on the boot error surface after Vite recovers.

Startup and status reuse must share the same dependency canary. Startup must
also fail closed and stop its managed processes when the receiver-side mount
signal is missing or the early boot bridge reports a resource failure.

## How to verify

- `node --test tooling/devctl/test/desktop.test.mjs` passes.
- `rg -n "desktopViteReadinessUrl|waitForDesktopVite" tooling/devctl/desktop.mjs`
  shows the dependency canary, module-graph warm-up, and second startup probe.
- `rg -n "waitForDesktopFrontend|React app mounted" tooling/devctl/desktop.mjs`
  shows the receiver-side startup gate.
- `rg -n "Cache-Control.*no-store" apps/desktop/vite.config.ts` shows the
  normal dev runtime does not reuse stale transformed modules.
- A cold `make desktop` reaches `shell:end` and `identity:end` without
  `RESOURCE LOAD ERROR` or `React did not mount`.

## Crosswalks

- Developer Toolchain lifecycle: `docs/architecture/developer-toolchain/design.md`.
