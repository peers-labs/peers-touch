---
kind: pitfall
title: macOS traffic lights must share AppKit's title-bar layout pass
status: active
owns:
  - apps/desktop/src-tauri/src/application/traffic_lights.rs
  - apps/desktop/src-tauri/tauri.conf.json
  - apps/desktop/src/ui/northstar.css
  - apps/desktop/src/ui/chat.css
  - packages/prototypes/shared/ui-system/design-directions.css
related:
  - docs/client/common/ui-identity/modules/auth/desktop.md
  - docs/client/common/ui-identity/tokens.md
  - docs/architecture/platform/client/ui-system/prototype/north-star-frame.md
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

AppKit's standard button cell keeps a 14pt drawing size even after reducing
width/height constraints or selecting a small control size. A smaller declared
frame therefore does not prove a smaller circle. Keep the native 14pt hit
target and scale the original button's drawing coordinates around its existing
center to the accepted painted diameter. Assign absolute drawing bounds so
repeated surface changes do not accumulate scaling. Do not use a layer
transform: AppKit owns and rewrites the view's layer transform during layout.
Verify the colored circle's pixel bounds in a normal development NSWindow,
not only Accessibility bounds or an Acceptance build that bypasses chrome.

## How to detect perimeter material recurrence

Deleting the left border left the top/upper-left corner painted with L2
`subtle` while L1 used a white translucent gradient. This produced two
different materials around the native lights and the rest of the perimeter.
L1 and the shell background/border must all consume the existing `--pt-surface`
color. The reference governs frame geometry, not a new palette: preserve the
product's existing three-level colors.
Inset stage corners expose that same base; prototype wallpaper/background
layers must be inset and rounded too, or they paint over the base.

Check actual native screenshots at both narrow and wide sizes: sample blank
L1, its top edge, top/right/bottom surround and the exposed inner corner.
The chrome colors must match, while L2 retains its existing distinct surface.
Source assertions alone cannot prove painted pixel continuity.

Frame color derivations must resolve inside the UIProvider scope. A column
hairline declared on `:root` from `--pt-text`, which is supplied only by the
descendant UIProvider, becomes invalid and silently paints no separator.
Derive it on `.ds-shell` and inspect the actual header-bottom pixels after
making header and conversation surfaces the same color.
