---
kind: invariant
title: Mobile product surface and evidence harness views must stay decoupled
status: active
owns:
  - packages/prototypes/mobile/chat/src/app/
  - packages/prototypes/mobile/chat/src/MobileApp.tsx
  - packages/prototypes/mobile/chat/src/MobilePrototype.tsx
  - packages/prototypes/mobile/chat/src/MobileShell.tsx
  - packages/prototypes/mobile/chat/scripts/
  - tooling/scripts/review/mobile-surface-boundary.mjs
related:
  - docs/knowledge/invariants/app-layer-must-not-restyle-primitives.md
  - docs/knowledge/playbooks/ui-primitive-promotion.md
detected: 2026-11-04
owner: Client Platform / UI System
review-cadence: on-change
---

# Mobile product surface and evidence harness views must stay decoupled

`packages/prototypes/mobile/chat` hosts TWO mobile surfaces with deliberately
different, machine-locked contracts. They are not two versions of one UI to be
merged; they are two consumers of the same peers-ui library.

## The two surfaces

- **Product surface** — `src/app/**` + `src/MobileApp.tsx`
  - reducer-driven Chinese product UI (`model.ts` / `state.ts` / `screens.tsx`),
    `ma-*` DOM, in-frame sheets/call.
  - asserted by `tooling/scripts/ui-system/suites/boards.suite.json`.
- **Evidence harness** — `MobilePrototype` / `MobileShell` / `socialDemo` /
  `callPrototype` / `pages/**` / `components/**`
  - URL `?scenario=` injection of controlled failure states, `mp-*` DOM,
    English control labels, evidence-only outcomes.
  - asserted by `scripts/check-layout.mjs` and `scripts/check-call-states.py`.

The contracts genuinely differ: the call surface alone has seven forced
evidence states (`incoming`, `active_here`, `reconnecting`,
`handled_elsewhere` …) with 44px `.mp-call-control` targets and English
aria-labels, versus the product's three-state `.ma-call` reducer flow in
Chinese. Forcing one component to serve both produces a mode/language/dual-DOM
prop explosion — that is the pit this invariant prevents.

## Hard rules

1. Product `app/**` must never import an evidence-harness module
   (`MobilePrototype`, `MobileShell`, `*Demo`, `callPrototype`, `pages/**`,
   `components/**`, `mobilePrototype.css`).
2. The evidence harness must not import product views/state
   (`app/screens`, `app/primitives`, `app/CallScreen`, `app/MobileAppView`,
   `app/state`).
3. The ONLY sanctioned cross-surface sharing is:
   - `@peers-touch/ui` primitives and tokens (the real reuse seam), and
   - pure, React/UI-free domain entities in `src/app/model.ts`
     (types + seed/selectors), which the harness MAY import.
4. Widening what the harness may import from `app/` is an explicit architecture
   decision, not an accidental convenience import.

Enforced by `tooling/scripts/review/mobile-surface-boundary.mjs` (runs in
`tooling/scripts/review/run.sh`). When a genuinely shared headless behavior
appears (a third consumer, or identical transition semantics needed on both
sides), extract it to a neutral headless module both import — do not couple
the views.

## How to verify

- [ ] `node tooling/scripts/review/mobile-surface-boundary.mjs` exits 0.
- [ ] A temporary cross-import (e.g. `app/MobileAppView.tsx` importing
      `../MobileShell`) makes the same command exit 1; remove it to restore.
- [ ] `node tooling/scripts/ui-system/evaluate-specimens.mjs --suite
      tooling/scripts/ui-system/suites/boards.suite.json --base <prototype>`
      stays OBSERVED (product ma-* contract), and
      `packages/prototypes/mobile/chat/scripts/check-call-states.py` still
      passes on its own dev port (evidence mp-* contract untouched).
