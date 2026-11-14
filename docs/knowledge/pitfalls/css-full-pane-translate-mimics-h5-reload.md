---
kind: pitfall
title: A keyframe full-pane slide tied to a display flip looks like an H5 reload (a transition on a persistent overlay is the accepted WeChat push)
status: active
owns:
  - apps/desktop/src/ui/chat.css
  - apps/desktop/src/components/search/SearchOverlay.css
  - apps/desktop/src/components/chat/narrowLayoutAlignment.test.ts
related:
  - docs/client/common/ui-identity/craft-quality.md
detected: 2026-11-11
revised: 2026-11-14
owner: Client Platform / UI System
review-cadence: on-change
---

# Keyframe-on-display-flip slide = H5 reload; transition-on-overlay = native push

## Current decision (2026-11-14)

Product explicitly asked for the WeChat-style narrow navigation: tapping a
conversation slides the chat in from the right, and back slides it out. The
implemented pattern is a **persistent full-stage overlay driven by a
`transform`/`visibility` transition**, not the keyframe approach that failed
earlier:

```css
.sc-chat[data-narrow='true'] .sc-conversation {
  position: absolute; inset: 0; z-index: 20;
  transform: translateX(100%); visibility: hidden;
  transition: transform var(--pt-motion-slow) var(--pt-motion-out),
              visibility 0s linear var(--pt-motion-slow);
}
.sc-chat[data-narrow='true'][data-narrow-open='true'] .sc-conversation {
  transform: translateX(0); visibility: visible;
  transition: transform var(--pt-motion-slow) var(--pt-motion-out), visibility 0s;
}
```

Why this does not repeat the rejected version:

1. Both panes stay mounted. There is no `display:none → flex` flip, so nothing
   re-triggers an animation or reflows the header/scroll/composer.
2. A `transition` between two real transform states animates **both enter and
   exit symmetrically**; the old keyframe could only play on the display flip
   and hard-cut on the way out.
3. `visibility` (with a delayed hide) keeps the parked pane out of the tab
   order and pointer input instead of leaving an off-screen interactive layer.
4. The catalog remains mounted underneath, so popping back reveals the live
   list rather than remounting it — the native view-controller feel WeChat has.
5. Timing uses `--pt-motion-slow`, which the reduced-motion runtime collapses
   to `0ms`, so the push is disabled for that preference.

## Historical symptom and root cause (still valid as the anti-pattern)

On a narrow (single-pane) window, opening a conversation was first reported as
"突然就切换了，没有动画". A slide-in was then added but re-reported as
"页面刷新，会晃动，搞得和 H5 一样". That slide moved the whole conversation
surface — header, scroll region and composer — a full viewport width on every
open, which read as a web page sliding in rather than a native view becoming
active.

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

Because `display: none → flex` re-triggers the keyframe, the entire pane is
translated a full viewport width — a document-navigation gesture, not a state
reveal — and keyframes cannot animate the exit, producing the asymmetric
slide-in/hard-cut-out that reinforced the "refresh" impression.

## The line that matters

- **Rejected:** `@keyframes` translateX bound to a `display` flip (enter-only,
  re-trigger, jitter, no exit).
- **Accepted:** `transition` on `transform`/`visibility` for a persistently
  mounted absolutely-positioned overlay (symmetric enter/exit, no reflow).
- Smaller inline reveals (`sc-rail-search-in`, `pt-search-in`) stay
  **opacity-only, never translate** — that narrower rule is unchanged; only the
  top-level narrow pane navigation gained the horizontal push.

## What guards against regression

`narrowLayoutAlignment.test.ts` and `conversationFrameAlignment.test.ts` pin
the new contract:

- The narrow `.sc-conversation` is `position:absolute; inset:0`, parked at
  `translateX(100%); visibility:hidden`, and rests at `translateX(0);
  visibility:visible` when `data-narrow-open`.
- A `transition` must drive it; `sc-conversation-slide-in`, any `animation:` on
  the open rule, and the keyframe must stay absent.
- The catalog must not be `display:none` when open (it stays mounted beneath).

## How to detect a recurrence

```sh
cd apps/desktop && pnpm exec vitest run src/components/chat/narrowLayoutAlignment.test.ts src/components/chat/conversationFrameAlignment.test.ts
```

For visual confirmation, shrink the window below 720px and open a
conversation: the pane should glide in from the right over the list, and the
header back tile should glide it back out to the right revealing the same
list — no hard cut, no header/composer jitter, no blank intermediate frame.

## Crosswalks

- Motion tokens and easing roles: `docs/client/common/ui-identity/tokens.md §8`
- Related flash/geometry pitfall:
  `docs/knowledge/pitfalls/crossfade-morph-flash-and-measure-feedback.md`
