---
kind: pitfall
title: A full-pane CSS translateX enter animation makes a native surface swap feel like an H5 page reload
status: active
owns:
  - apps/desktop/src/ui/chat.css
  - apps/desktop/src/components/search/SearchOverlay.css
  - apps/desktop/src/components/chat/narrowLayoutAlignment.test.ts
related:
  - docs/client/common/ui-identity/craft-quality.md
detected: 2026-11-11
owner: Client Platform / UI System
review-cadence: on-change
---

# A full-pane CSS translateX enter animation makes a native surface swap feel like an H5 page reload

## Symptom

On a narrow (single-pane) window, opening a conversation was reported as
"突然就切换了，没有动画" and, after a slide-in was added, re-reported as
"页面刷新，会晃动，搞得和 H5 一样". The whole conversation surface — header,
scroll region, and composer — swept horizontally from the right edge on every
open, which read as a web page sliding in rather than a native view becoming
active. The same class of small translate on the in-rail search and the search
overlay added perceptible geometric nudging.

## Root cause

The desktop shell already does the correct native thing: `PageHost` keeps
pages in a persistent keepAlive tree and swaps them with
`display: contents | none`, and the narrow chat swap flips `.sc-sessions` /
`.sc-conversation` via `data-narrow-open`. Both surfaces stay mounted and hot.

The defect was layering an enter **keyframe on top of an already-mounted
surface**:

```css
@keyframes sc-conversation-slide-in {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}
.sc-chat[data-narrow='true'][data-narrow-open='true'] .sc-conversation {
  display: flex;
  animation: sc-conversation-slide-in var(--pt-motion-normal) var(--pt-motion-out) both;
}
```

Because `display: none → flex` re-triggers the keyframe, the entire pane
(including its own header and input) is translated a full viewport width. That
is fundamentally a document-navigation gesture, not a state reveal:

1. It moves geometry the surface does not own — the header, scroll container,
   and composer travel together and can trigger compositor jitter.
2. It imitates a mobile view-controller push with a hand-rolled CSS transform,
   which cannot match a platform transition and therefore looks like H5.
3. Keyframes cannot animate the exit (the pane returns to `display: none`
   immediately), so the interaction is asymmetric — slide in, hard cut out —
   reinforcing the "refresh" impression.

Smaller inline reveals (`sc-rail-search-in` translateX(6px),
`pt-search-in` translateY(-6px)) were the same anti-pattern at smaller scale:
enter motion that shifts geometry instead of only fading.

## Mitigation

Scope motion by surface type instead of decorating every swap with movement.

1. **Route / persistent surface — instant visibility flip, no enter motion.**
   Remove `sc-conversation-slide-in` entirely; the narrow conversation swap is
   again a pure `display` flip on the keepAlive tree. No keyframe, no
   transform, no fade on the surface itself.
2. **Inline and floating reveals — opacity only, never translate.**
   `sc-rail-search-in` and `pt-search-in` now animate `opacity` from 0 to 1
   with no `translateX/Y`, so they appear without moving any layout box.
3. **Keep component-local state motion.** Spinners, typing dots, pulses,
   progress, and hover/press feedback are unchanged — they are scoped to their
   own element and do not reflow neighbors.

The governing contract is
`docs/client/common/ui-identity/craft-quality.md §11` (Surface And Route
Transition Motion): persistent surfaces switch by visibility, floating layers
fade, and only component-local state may move.

## What guards against regression

`narrowLayoutAlignment.test.ts` pins the static contract:

- The stylesheet must not contain `sc-conversation-slide-in` or any
  `translateX(100%)` inside the 720px narrow-swap block, and the active
  `.sc-conversation` rule must not declare an `animation`.
- `sc-rail-search-in` must match an opacity-only keyframe and its block must
  contain no `translateX`/`translateY`.

## How to detect a recurrence

```sh
cd apps/desktop && pnpm exec vitest run src/components/chat/narrowLayoutAlignment.test.ts
```

For visual confirmation, shrink the window below 720px and open a
conversation: the pane must appear in place with no horizontal travel, no
blank intermediate frame, and no movement of the header or composer. Capture a
dense burst across the click; every frame after the swap should show the pane
at its resting geometry.

## Crosswalks

- Motion contract: `docs/client/common/ui-identity/craft-quality.md §11`
- Motion tokens and easing roles: `docs/client/common/ui-identity/tokens.md §8`
- Related flash/geometry pitfall:
  `docs/knowledge/pitfalls/crossfade-morph-flash-and-measure-feedback.md`
