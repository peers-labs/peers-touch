---
kind: pitfall
title: Embedded controls leak square UA chrome into rounded glass frames
status: active
owns:
  - packages/prototypes/shared/ui-system/DesignDirections.tsx
  - packages/prototypes/shared/ui-system/design-directions.css
  - tooling/scripts/ui-system/craft-battery.mjs
  - tooling/scripts/ui-system/suites/north-star.suite.json
related:
  - docs/architecture/platform/client/ui-system/prototype/north-star-frame.md
detected: 2026-10-30
owner: Client Platform / UI System
review-cadence: on-change
---

# Embedded controls leak square UA chrome into rounded glass frames

## Symptom

Inside the rounded, translucent desktop-prototype frame the owner kept
finding "boxes that do not belong": a hard square dark rectangle around the
search field on keyboard focus, a gray outset rectangle behind a heart icon
button, and hairline borders where the icon rail, top bar and conversation
rail meet. Each was reported individually ("方框圆角", "这个边界不要",
"怎么会这样") and each was initially fixed as a one-off, so the same class
of defect recurred across different elements over multiple rounds.

## Root cause

Native/global control chrome was allowed to paint *inside* a rounded
material host:

1. The global `.pt-ui :where(input,...):focus-visible { outline: 2px solid
   var(--pt-focus) }` rule has higher specificity than a bare
   `input { outline: 0 }`, so the 2px square outline rendered on a
   radius-0 `<input>` that visually lives inside a 12px rounded host.
2. A custom `<button>` without border/background reset inherited the UA
   `outset` border and system-gray face (`2px outset rgb(0,0,0)`,
   `rgb(239,239,239)`).
3. Chrome zones (icon rail / top bar / side rail) were separated with
   `1px` hairlines; in a glass material surface hierarchy strokes read as
   admin-frame tiling, while the intended separation is material
   (translucent surfaces + blur + shadow).

The deeper process failure was that owner-reported craft defects were fixed
at the instance layer and never promoted into deterministic gates, so the
next identical defect had to be noticed by a human again.

## Mitigation

### What was done in code

- `design-directions.css`: embedded search input neutralizes the global
  outline at sufficient specificity (`.sk-shell .sk-chat-search
  input:focus-visible { outline: none }`); the rounded HOST paints keyboard
  focus via `.sk-chat-search:focus-within { box-shadow: 0 0 0 2px ... }`, so
  the ring follows the 12px radius. The range control gets a pill-shaped
  focus shadow of its own.
- The heart button carries an explicit reset (`border:0; background:
  transparent; appearance` inherited from the frame button reset).
- `.sk-rail`, `.sk-feed-head`, `.sk-chats` have zero border width on all
  sides; zone separation is material-only.

### What guards against regression

- Craft battery rules in `tooling/scripts/ui-system/craft-battery.mjs`:
  C9 `embedded-control-square-focus` (focuses each text-like control,
  fails when a radius-0 input inside a radius-≥8 host paints a visible
  outline), C10 `chrome-zone-hairline` (rail/head/aside must have zero
  border), C11 `ua-button-chrome` (no visible button may keep an `outset`
  border).
- `tooling/scripts/ui-system/suites/north-star.suite.json` runs the battery
  against `.sk-shell` and asserts `outline-style: none` on the focused
  search input plus the rounded host focus ring.

## How to detect a recurrence

```sh
node tooling/scripts/ui-system/evaluate-specimens.mjs \
  --suite tooling/scripts/ui-system/suites/north-star.suite.json
```

rollup must be `OBSERVED`. A human-only screenshot pass cannot replace the
gate: focus-state defects are invisible in static screenshots.

## Crosswalks

- Design grammar (radius on the painting layer, material-not-hairline
  chrome, focus follows host radius):
  `docs/architecture/platform/client/ui-system/prototype/north-star-frame.md`
- Generic craft geometry gate: `tooling/scripts/ui-system/craft-battery.mjs`
