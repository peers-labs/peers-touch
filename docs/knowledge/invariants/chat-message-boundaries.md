---
kind: invariant
title: Chat message content must not be occluded
status: active
owns:
  - apps/mobile/src/pages/ChatPage.tsx
  - apps/mobile/src/features/chat/
  - apps/desktop/src/components/chat/
  - apps/desktop/src/pages/SocialChatPage.tsx
  - apps/desktop/src/pages/ChatPage.tsx
  - apps/desktop/src/components/MessageBubble.tsx
  - apps/desktop/src/components/MessageComposer.tsx
  - apps/desktop/src/components/ChatInput.tsx
referenced-by:
  - docs/knowledge/invariants/mobile-chat-layout-boundaries.md
  - docs/knowledge/invariants/desktop-chat-layout-boundaries.md
related:
  - docs/client/chat/chat-ux-contract.md
  - docs/client/mobile/chat-layout-contract.md
  - docs/client/desktop/chat-layout-contract.md
detected: 2026-06-09
---

# Chat message content must not be occluded

## What must hold

Chat message body content MUST remain readable and actionable across Mobile and Desktop. Message action surfaces, metadata rows, retry controls, composers, safe areas, side panels, and floating layers MUST NOT cover text, image bodies, file names, voice scrubbers, or other primary message content.

## Why this is non-negotiable

Chat is the primary product surface for trust and continuity. If message menus, hover actions, timestamps, or input areas cover the body of a message, the user loses the ability to read, copy, preview, retry, or verify content.

This invariant also prevents platform drift. Mobile long-press menus and Desktop hover/right-click menus may differ, but they must preserve the same message anatomy: `Bubble` carries primary content, `MetaRow` carries status, and `ActionAnchor` places actions outside the readable body.

The failure mode is subtle: a visually acceptable bubble for short text can break for long text, images, failed sends, or messages near the viewport edge. Therefore the rule is structural, not aesthetic.

## How to verify

- `rg "position:\\s*absolute|absolute" apps/mobile/src/pages/ChatPage.tsx apps/mobile/src/features/chat apps/desktop/src/components/chat apps/desktop/src/pages/SocialChatPage.tsx apps/desktop/src/pages/ChatPage.tsx apps/desktop/src/components/MessageBubble.tsx apps/desktop/src/components/MessageComposer.tsx apps/desktop/src/components/ChatInput.tsx` — review every hit and confirm it does not place actions or metadata over primary message content.
- `rg "ContextMenu|Dropdown|Popover|BottomSheet|ActionAnchor|MetaRow|MessageBubble|Composer" apps/mobile/src/pages/ChatPage.tsx apps/mobile/src/features/chat apps/desktop/src/components/chat apps/desktop/src/pages/SocialChatPage.tsx apps/desktop/src/pages/ChatPage.tsx apps/desktop/src/components/MessageBubble.tsx apps/desktop/src/components/MessageComposer.tsx apps/desktop/src/components/ChatInput.tsx` — review message action and metadata placement for collision handling.
- Manual acceptance: check text, image, file, voice, failed, sending, and system messages near the top, middle, and bottom of the conversation viewport.

## Crosswalks

- See `docs/client/chat/chat-ux-contract.md` for the shared Chat message anatomy and collision model.
- See `docs/client/mobile/chat-layout-contract.md` for Mobile safe-area, keyboard, and BottomSheet fallback rules.
- See `docs/client/desktop/chat-layout-contract.md` for Desktop pane, hover, right-click, and virtualization rules.
