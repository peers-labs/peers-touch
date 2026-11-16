---
kind: pitfall
title: Desktop header drag regions were fragmented
status: active
owns:
  - apps/desktop/src/components/
  - apps/desktop/src/pages/
  - packages/ui/web/src/moment-scope-bar.tsx
related:
  - docs/client/desktop/window-chrome.md
  - docs/client/common/ui-identity/frontend-component-tree.md
detected: 2026-11-15
owner: Client Platform
review-cadence: on-change
---

# Desktop header drag regions were fragmented

## Symptom and cause

Settings' group bar and several Agent/common pane headers could not move
the native window. Only seven local drag markers existed in four source
files. The frame had no shared interaction adapter, so visually equivalent
headers had different native behavior.

Adding `deep` everywhere would create a second failure: custom clickable
divs, search frame padding and resize handles are not all automatically
excluded by Tauri. Shared composites can also silently discard a marker if
their root does not forward DOM attributes.

## Mitigation

Consume the shell-owned adapter and region contract in
[window-chrome.md](../../client/desktop/window-chrome.md).
Keep Tauri as the single native executor. The real module header fixtures
exercise forwarded attributes and exclusions; the AST guard checks native
attribute ownership and classifies content headers separately.

## How to detect a recurrence

```sh
pnpm --dir apps/desktop exec vitest run \
  src/components/shell/WindowDragRegion.test.tsx \
  src/pages/settingsSurface.test.tsx
```

Use the opt-in original-Tauri-script browser check documented in
`tooling/scripts/review/window_chrome_hit_testing.py`. Review custom div
interactions and attribute forwarding whenever a header changes. Native
physical dragging is a separate proof obligation; do not convert an
unperformed drag into PASS from DOM tests or screenshots.
