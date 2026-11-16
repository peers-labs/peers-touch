---
kind: pitfall
title: Drawer guide travel must preserve roots and never scroll its ancestors
status: active
owns:
  - apps/desktop/src/ui/chat.css
  - apps/desktop/src/components/chat/ChatMessageArea.tsx
  - packages/prototypes/shared/ui-system/chat/chat.css
  - apps/desktop/src/components/search/SearchOverlay.css
  - apps/desktop/src/components/chat/narrowLayoutAlignment.test.ts
  - apps/desktop/src/pages/SocialChatPage.tsx
  - packages/ui/web/src/drawer-assembly.ts
  - packages/ui/web/src/use-drawer-assembly.ts
  - packages/ui/web/src/drawer-resizer.tsx
  - tooling/acceptance/gates/chat/drawer_layout.py
related:
  - docs/client/common/ui-identity/craft-quality.md
detected: 2026-11-11
revised: 2026-11-15
owner: Client Platform / UI System
review-cadence: on-change
---

# Keyframe-on-display-flip slide = H5 reload; transition-on-overlay = native push

## Current owner (2026-11-16)

The catalogue/main/inner guide now comes from shared `useDrawerAssembly`.
The active native layout no longer has a720px CSS pane swap. Its governing
allocation and input rules are in
[the drawer contract](../../architecture/platform/client/ui-system/prototype/drawer-assembly.md).
The previous failures below remain regression examples, not live layout
recipes. Preserve the persistent root and zero ancestor scroll while checking
actual screen-space guide travel. Pointercancel restores preference; Back
retains runtime selection and current composer.

At 676/554px native windows, reserving the soft reading ideal as a hard floor
left only 135/13px of catalogue. The separator also disabled itself whenever
pressure existed. Merely enabling it would still start dragging from the
hidden preferred paper, and its closed position remained at the old exposure.
The shared allocator now gives the catalogue the reachable space after the
work minimum; the controller directly addresses visible boundaries. Expanded
preference is separate from temporary collapse. A frame that grows enough
releases collapse, and pointer release settles to the reachable minimum or
maximum by last direction. Row and header footprints are independently
budgeted. Keep controls whole, cancellation noncommitting, and the complete
catalogue restored on Back. Values and allocation remain in the drawer contract.
The original current-profile two-client Native Gate borrows its authenticated
client for `drawer_layout.prove_drawer_layout`; no second login/runtime is
created. Programmatic native resize and semantic pointer input do not establish
physical live-window dragging.
The current embedded WebDriver's `dispatch_pointer_event` emits `MouseEvent`
only. That does not invoke the shared resizer's pointer handlers and cannot
prove capture or cancellation. The Native drawer scenario observes both event
families at the real handle, preserves all geometry and gesture assertions,
and reports `native-drawer-pointer-input` as blocked when the requested
pointer event is absent. Independent window, keyboard and draft checks run
before this capability boundary. Never add mouse fallbacks to the production
resizer or spoof pointer capture to turn that Driver gap into product proof.

## Historical decision (2026-11-14, superseded layout)

Product explicitly asked for the WeChat-style narrow navigation: tapping a
conversation slides the chat in from the right, and back slides it out. The
implemented pattern is a **persistent full-stage overlay driven by a
`transform`/`visibility` transition**, not the keyframe approach that failed
earlier:

```css
.sc-chat[data-narrow='true'] .sc-conversation {
  position: absolute; inset: 0; z-index: 20;
  transform: translateX(100%); visibility: hidden;
  transition: transform var(--pt-motion-navigation) var(--pt-motion-drawer),
              visibility 0s linear var(--pt-motion-navigation);
}
.sc-chat[data-narrow='true'][data-narrow-open='true'] .sc-conversation {
  transform: translateX(0); visibility: visible;
  transition: transform var(--pt-motion-navigation) var(--pt-motion-drawer), visibility 0s;
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
5. Timing uses `--pt-motion-navigation`, which the reduced-motion runtime collapses
   to `0ms`, so the push is disabled for that preference.

## Selection-root remount recurrence (2026-11-15)

The CSS overlay alone did not preserve the animated DOM. `ChatMessageArea`
returned `WindowDragRegion > div` for no selection but a bare `div` for
direct-open intent and selected conversations. React replaced the whole root
when selection changed, so the new element first painted at the final
`translateX(0)` and no transition ran. The same mismatch cut the exit.

All three branches now retain the shell adapter and its child div; only drag
mode and conversation content change. The root has no selection key. Composer
keys still belong to their own conversation/edit targets. The governing
lifetime and timing rules are in
[Desktop Chat Layout Contract §7](../../client/desktop/chat-layout-contract.md#7-window-and-density-rules)
and [UI Identity motion roles](../../client/common/ui-identity/tokens.md#8-motion-roles).

## Ancestor-scroll recurrence (2026-11-15)

Preserving the root exposed a second defect: tail anchoring called
`bottomRef.scrollIntoView()` before setting the message viewport's
`scrollTop`. The narrow stage used `overflow-x: hidden`, which clips paint
but remains programmatically scrollable. Opening a conversation therefore
scrolled the stage horizontally toward its offscreen tail sentinel.

In a 640px window (580px stage), the transform still read `translateX(580px)`
while stage `scrollLeft` jumped to 566px, putting the pane at screen offset
14px within 4ms. During the transition the stage's scroll range shrank and
clamped back toward zero, creating the apparent collision and rebound.
A 338px window reproduced the same cancellation (278px transform, 268px
stage scroll, 10px screen offset).

Tail anchoring now sets only its owning viewport's `scrollTop`. Both Desktop
and prototype narrow stages use `overflow: clip` on **both** axes; combining
`clip` with `hidden` on the other axis would compute back to a scrollable
overflow. The drawer easing reduces the abrupt mid-travel speed peak and
stops without overshoot.

Browser verification must record `pane.getBoundingClientRect().x -
stage.getBoundingClientRect().x`, ancestor `scrollLeft`, root identity, and
vertical bounds on each frame. Checking only `DOMMatrix(transform).m41`
misses this defect. Include late timeline measurements, image growth,
composer focus, enter/exit, and reduced motion.

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
the shared allocation and persistent-root contract. The following were the
earlier breakpoint-specific guards and remain historical context:

- The narrow `.sc-conversation` is `position:absolute; inset:0`, parked at
  `translateX(100%); visibility:hidden`, and rests at `translateX(0);
  visibility:visible` when `data-narrow-open`.
- A `transition` must drive it; `sc-conversation-slide-in`, any `animation:` on
  the open rule, and the keyframe must stay absent.
- The catalog must not be `display:none` when open (it stays mounted beneath).
- Selection variants must preserve the same shell adapter / child root with
  no selection key; CSS-only checks cannot prove DOM lifetime or actual travel.
- Tail scrolling must remain within the message viewport. Narrow stages must
  clip both axes without becoming scroll containers; screen-space travel must
  stay monotonic and equal the transform with every ancestor `scrollLeft = 0`.

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
