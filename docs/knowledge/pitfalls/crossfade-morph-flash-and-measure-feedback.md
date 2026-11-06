---
kind: pitfall
title: Morphing capsule flashes empty when visibility delays the incoming layer and width measurement feeds back into the clipped layer
status: active
owns:
  - packages/prototypes/shared/ui-system/moments/moments.css
  - packages/prototypes/shared/ui-system/moments/MomentsFeature.tsx
  - tooling/scripts/ui-system/suites/north-star.suite.json
related:
  - docs/architecture/platform/client/ui-system/prototype/components/moments-feature.md
detected: 2026-11-05
owner: Client Platform / UI System
review-cadence: on-change
---

# Morphing capsule flashes empty when visibility delays the incoming layer and width measurement feeds back into the clipped layer

## Symptom

The feed sorter capsule (最新/热门 ⇄ icon-only 回顶) was reported as
"变换要丝滑，不要闪" and, after a round trip to the top, rendered as a 36px
sliver with the option labels wrapped into a vertical column ("最\\n新"),
while the back-to-top state painted a blank white square with no arrow.

## Root cause

Two coupled structural mistakes, both caused by letting the animated width
own layer geometry:

1. **Shared visibility transition delays the incoming layer.**
   `transition: opacity .26s, visibility 0s linear .26s` is the standard
   hide-after-fade rule, but the same declaration also gates the reverse
   direction: when a layer becomes active its `visibility: visible` is
   delayed by the same offset. For ~150ms BOTH layers are invisible while the
   capsule width keeps animating — an empty white pill, perceived as a flash.
2. **Measuring inside the animated container feeds back into layout.**
   The sorter width was measured from the active layer's `offsetWidth` while
   that layer lived inside the width-animated, `overflow:hidden` pill. After
   shrink to 36px the measured layer was grid/placed in a 28px box, so its
   measured width collapsed to the shrunken size; measuring it again on the
   way back pinned the sorter at 36px forever (and block/grid misplacement
   pushed the icon button below the clip edge — the blank square).

## Mitigation

Geometry ownership, not numeric tuning:

1. One `width: max-content; flex: 0 0 auto` grid **stage** inside the pill
   holds both layers in the same cell, right-anchored. The stage is intrinsic
   and non-shrinkable, so its width is independent of the pill's animated
   width. Measure ONLY the stage (once, via ResizeObserver); the measure can
   never feed back as a crushed layer. Pill widths are the measured sorter
   width (`--sk-feed-pill-w`) in sort mode and fixed 36px in top mode; its
   right edge is the constant anchor.
2. Role-aware visibility transitions: the INCOMING layer gets
   `visibility 0s` (visible from frame one, fade-in immediately); the
   OUTGOING layer keeps `visibility 0s linear <fade>` (paints through its
   fade-out, hidden only after it finishes). Both roles are declared on the
   `data-mode` state selectors, never as one shared transition.

## What guards against regression

north-star scenario `moments-feed-sort-morphs-to-top` asserts, in addition to
mode flips, scroll-to-top and radius:

- `tile-icon-rendered`: exactly one svg inside the top tile.
- `tile-visible-in-top-mode` / `options-hidden-in-top-mode` (and the inverse
  pair after restore) — the role-aware visibility contract.
- `options-stay-one-line-clipped` / `options-one-line-after-restore`: the
  options layer keeps a 28px one-line height even while clipped; the old
  block-flow bug wrapped it to ~56px.
- `sorter-width-restored`: pill width returns to the measured 112px after the
  round trip (the feedback-pinned 36px failure).
- `right-edge-anchored-in-top-mode` / `...-after-restore`: pill right edge
  equals the first post's right edge within 1px in both modes.

## How to detect a recurrence

```sh
node tooling/scripts/ui-system/evaluate-specimens.mjs \
  --suite tooling/scripts/ui-system/suites/north-star.suite.json \
  --base http://localhost:3291
```

rollup must be `OBSERVED`. For frame-level confidence, capture a dense
(~30ms) burst of clipped screenshots across both morph directions and append
them into one strip: the capsule must never be content-empty mid-morph.

## Crosswalks

- Morph product contract:
  `docs/architecture/platform/client/ui-system/prototype/components/moments-feature.md`
