---
kind: invariant
title: Mobile Chat bottom layers must not hide content
status: active
owns:
  - apps/mobile/src/pages/ChatPage.tsx
  - apps/mobile/src/features/chat/
  - apps/mobile/src/components/MobileShell.tsx
referenced-by:
  - docs/knowledge/invariants/chat-message-boundaries.md
related:
  - docs/client/chat/chat-ux-contract.md
  - docs/client/mobile/chat-layout-contract.md
detected: 2026-06-09
---

# Mobile Chat bottom layers must not hide content

## What must hold

Mobile Chat MUST derive message viewport bottom padding from every visible bottom occlusion source: composer, expanded input, emoji panel, attachment panel, keyboard overlap, bottom tab when visible, system safe area, and the Chat bottom clearance token. The last message MUST remain fully visible above those layers.

## Why this is non-negotiable

Mobile Chat combines the smallest viewport with the most bottom-layer competition. A fixed `padding-bottom` or visually tuned absolute value will fail when the composer grows, the keyboard opens, an attachment panel replaces the keyboard, or the device has a Home Indicator.

The app-level bottom tab is especially risky. Chat detail should normally hide it; if it remains visible, it becomes an occlusion rectangle and must participate in the same clearance formula as the composer and safe area.

This invariant exists so AI agents do not treat keyboard avoidance, panel height, and tab height as separate UI hacks. They are one bottom clearance model.

## How to verify

- `rg "paddingBottom|padding-bottom|bottom:|env\\(safe-area-inset-bottom\\)|keyboard|Composer|BottomTab|tab" apps/mobile/src/pages/ChatPage.tsx apps/mobile/src/features/chat apps/mobile/src/components/MobileShell.tsx` — review every bottom spacing or positioning decision and confirm it accounts for all visible bottom occlusions.
- `rg "position:\\s*fixed|position:\\s*absolute|fixed|absolute" apps/mobile/src/pages/ChatPage.tsx apps/mobile/src/features/chat apps/mobile/src/components/MobileShell.tsx` — review every fixed or absolute layer and confirm it is modeled as an occlusion rectangle.
- Manual acceptance: verify keyboard closed, keyboard open, emoji panel open, attachment panel open, long text selected, image selected, and Home Indicator device states.

## Crosswalks

- See `docs/client/mobile/chat-layout-contract.md` for the bottom clearance formula and Mobile acceptance matrix.
- See `docs/knowledge/invariants/chat-message-boundaries.md` for shared message content non-occlusion rules.
