---
kind: pitfall
title: macOS traffic lights must share AppKit's title-bar layout pass
status: active
owns:
  - apps/desktop/src-tauri/src/application/traffic_lights.rs
  - apps/desktop/src-tauri/tauri.conf.json
  - apps/desktop/src/ui/northstar.css
  - apps/desktop/src/ui/chat.css
related:
  - docs/client/common/ui-identity/modules/auth/desktop.md
detected: 2026-11-14
---

# Traffic-light layout race

Manual button frames applied after resize, and Tao's content-draw traffic-light
inset, competed with AppKit's title-bar layout and clipped the cluster during
window resizing. Keeping the default spacing avoided the repositioning but
overflowed the fixed 60px icon rail.

The compact placement contract is in Desktop Auth UI Identity §2.1. Install
Auto Layout constraints on the original standard buttons in their original
container. Keep the native vertical center, actions and container geometry.
Do not reparent or clone the buttons, widen the rail, or shift stage headers
to compensate for the default cluster.

Verify with `authSurfaceAlignment.test.ts` and the actual `make desktop`
NSWindow: check button bounds within the rail at narrow/wide sizes and after
minimize/restore and fullscreen exit. Native screenshots must show whole
circles and no overlap with chat/settings controls. A programmatic resize
check does not prove physical live-drag frames; record that distinction.
