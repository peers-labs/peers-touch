---
kind: invariant
title: Mobile renders ONE product surface; evidence injects state, never a second skin
status: active
owns:
  - packages/prototypes/mobile/chat/src/app/
  - packages/prototypes/mobile/chat/src/MobileApp.tsx
  - packages/prototypes/mobile/chat/src/MobilePrototype.tsx
  - packages/prototypes/mobile/chat/scripts/
  - tooling/scripts/review/mobile-surface-boundary.mjs
related:
  - docs/knowledge/invariants/app-layer-must-not-restyle-primitives.md
  - docs/knowledge/playbooks/ui-primitive-promotion.md
detected: 2026-11-04
updated: 2026-11-06
owner: Client Platform / UI System
review-cadence: on-change
---

# Mobile renders ONE product surface; evidence injects state, never a second skin

`packages/prototypes/mobile/chat` renders exactly one mobile product UI.
Evidence is a **state injection** concern, not a parallel set of views.

## Architecture

- **Product surface** — `src/app/**` + `src/MobileApp.tsx`
  - reducer-driven Chinese product UI (`model.ts` / `state.ts` / `screens.tsx`),
    `ma-*` layout + `@peers-touch/ui` primitives, in-frame sheets/call.
  - shares data and interaction grammar with the desktop north-star prototype
    (`shared/ui-system/chat-data`, `moments-data`, `identity-tone`).
- **Evidence host** — `MobilePrototype.tsx` (thin)
  - URL `?scenario=` selects a `ProductScenario`; it renders
    `<MobileApp scenario=…/>` inside a device frame. Scenarios only seed
    `AppState` (`default / journey / station-offline / long-content /
    long-lists`) — there is no separate DOM, language, or IA.
  - the standalone dev port (`:3108`) shows the scenario controls; the shared
    board (`MobileFrame`) always renders the plain product with no
    产品面/取证台 toggle.

The earlier two-skin split (English `mp-*` MobileShell / pages / demo seeds
alongside the Chinese product) was deleted on 2026-11-06: presenting two
different chat products in one phone frame contradicted desktop/mobile parity
and doubled every change.

## Hard rules

1. There is one view layer: `src/app/**`. The former `MobileShell.tsx`,
   `pages/**`, `components/**`, `data.ts`, `*Demo.ts`, `callPrototype.ts`,
   `types.ts`, `i18n.ts` must never be reintroduced.
2. `MobilePrototype.tsx` may only mount `MobileApp` and read `app/model`
   scenario vocabulary; it must not define screens or own product chrome.
   `mobilePrototype.css` styles only the workbench/device frame.
3. A new controlled evidence condition is added as a **state variant**
   (`ProductScenario` / `AppState`), expressed by the existing product UI —
   never by forking a component.

Enforced by `tooling/scripts/review/mobile-surface-boundary.mjs` and
`scripts/check-residual-parity.mjs` (source + runtime single-skin guard).

## How to verify

- [ ] `node tooling/scripts/review/mobile-surface-boundary.mjs` exits 0.
- [ ] `PROTOTYPE_URL=http://localhost:3108 node
      packages/prototypes/mobile/chat/scripts/check-layout.mjs` passes
      (product geometry across 390/554/1440).
- [ ] `check-long-lists.mjs`, `check-call-states.py`,
      `check-residual-parity.mjs` pass against the same product surface.
- [ ] The shared board 手机原型 shows only MobileApp — no view toggle, exactly
      three `.pt-mobile-tabbar` tabs, zero `mp-*` product nodes.
