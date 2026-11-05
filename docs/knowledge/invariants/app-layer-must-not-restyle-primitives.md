---
kind: invariant
title: App layer must never restyle or re-control UI primitives
status: active
owns:
  - packages/prototypes/
  - apps/desktop/src/pages/
  - apps/desktop/src/components/
  - apps/mobile/src/
  - packages/ui/web/src/
  - tooling/scripts/review/primitive-layer-guard.mjs
related:
  - docs/client/common/ui-identity/README.md
  - docs/architecture/platform/client/ui-system/prototype/north-star-frame.md
detected: 2026-11-03
owner: Client Platform / UI System
review-cadence: on-change
---

# App layer must never restyle or re-control UI primitives

## What must hold

The visual value, business value, and emotional value of a control must be
identical and continuous on **every** surface that uses it. That is only
possible if each primitive is defined exactly once, in `packages/ui`, and the
app/page/prototype layer is a *composer*, never a second style owner.

The boundary is between **composition** (allowed at the app layer) and
**definition/control of a primitive's appearance or state machinery**
(forbidden).

### Forbidden outside `packages/ui`

1. CSS selectors that target peers-ui classes (`.pt-button`, `.pt-field-frame`,
   `.pt-switch`, `.pt-dialog`, `.pt-menu-item`, `.pt-alert`, `.pt-avatar`,
   …) to restyle shape, color, border, radius, shadow, background,
   typography, density, or motion. Skin theming goes through CSS custom
   properties consumed by the primitive, never by overriding the rendered
   class.
2. App-layer re-implementations of primitive behavior: `el.style.*` visual
   mutations, `classList.add/remove/toggle` for hover/focus/disabled/checked,
   focus-ring or press-state logic, hand-rolled open/close/positioning of
   floating layers, per-page entrance animations on library components.
3. Copying a primitive's markup/CSS into a page-local "almost the same"
   component. Missing capability is added to the primitive as a public
   variant/prop, not patched locally.

### Allowed at the app layer

- Page/region **layout only**: grid/flex placement, page-owned container
  spacing, naming and ordering regions. Selectors must target app-owned
  classes, never `.pt-*`.
- Composition through the primitive's public API: props, variants, density,
  tone, slots, and semantic data attributes.
- Business state via primitive props (`checked`, `availability`,
  `execution`, value bindings). Visual state is derived by the primitive.
- Theme values via tokens (`--pt-*` / skin variable bridge), because the
  primitive consumes the token; the page does not paint the control.
- Behavior that genuinely belongs to the page (data fetching, navigation,
  business effects) — never the control's own interaction chrome.

### When a page needs a shape the primitive lacks

Promote it once, at the primitive layer: token/variant in `packages/ui` →
contract entry (`packages/ui/contracts`) → deterministic guard → specimen
evidence. Until then the page does not workaround it with local CSS.

## Why this is non-negotiable

The frame had 112 app-layer CSS rules overriding `.pt-*` classes (32 on
`.pt-button`, 31 on `.pt-field-frame`, plus direct JS height mutation of a
textarea). Each override made one screen "look right" while every other
surface kept the library default — the exact reason controls drifted between
settings, chat, dialogs, and the Lark wizard, and why rounds of visual tuning
never compounded. Primitive-level fixes are N→1; app-layer overrides are
1→N recurring debt.

## How to verify

```sh
node tooling/scripts/review/primitive-layer-guard.mjs
```

- Fails on any `.pt-*` selector in app-layer CSS outside `packages/ui`.
- Fails on `.style.<visual>` writes and `classList` visual-state toggles in
  app-layer TS/TSX.
- Pre-existing debt is listed in
  `tooling/scripts/review/primitive-layer.baseline.json`; the count may only
  decrease. Any match not on the baseline fails (no new overrides).

## Crosswalks

- Token/source hierarchy: `docs/client/common/ui-identity/README.md` §2, §7.
- Prototype frame grammar:
  `docs/architecture/platform/client/ui-system/prototype/north-star-frame.md`.
- Related control-chrome leak:
  `docs/knowledge/pitfalls/prototype-embedded-control-chrome-leak.md`.
