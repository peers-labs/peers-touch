---
kind: invariant
title: Desktop Chat actions must respect pane bounds
status: active
owns:
  - apps/desktop/src/components/chat/
  - apps/desktop/src/pages/SocialChatPage.tsx
  - apps/desktop/src/pages/ChatPage.tsx
  - apps/desktop/src/components/MessageBubble.tsx
  - apps/desktop/src/components/MessageComposer.tsx
  - apps/desktop/src/components/ChatInput.tsx
referenced-by:
  - docs/knowledge/invariants/chat-message-boundaries.md
related:
  - docs/client/chat/chat-ux-contract.md
  - docs/client/desktop/chat-layout-contract.md
detected: 2026-06-09
---

# Desktop Chat actions must respect pane bounds

## What must hold

Desktop Chat message actions MUST be placed relative to the active conversation pane, not the full window by default. Hover bars, right-click menus, popovers, retry controls, and keyboard-triggered action surfaces MUST NOT cover message content, collide with the composer, overflow behind side panels, or assume a fixed window size.

## Why this is non-negotiable

Desktop Chat uses multiple panes: app navigation, conversation list, conversation pane, optional detail panel, and floating layers. A menu that works in a full-width test window can cover content or leave the visible webview when the user resizes panes or opens a detail panel.

Desktop also has hover and right-click affordances that Mobile does not. These affordances are useful only when they remain secondary to reading and selecting content. Hover UI must not cover selected text, image bodies, file names, voice scrubbers, or retry controls.

The invariant also protects accessibility. If actions only appear on hover and have no keyboard-reachable anchor, the message operation model becomes mouse-only and inconsistent with the shared Chat contract.

## How to verify

- `rg "ContextMenu|Dropdown|Popover|hover|onMouseEnter|onContextMenu|right-click|rightClick" apps/desktop/src/components/chat apps/desktop/src/pages/SocialChatPage.tsx apps/desktop/src/pages/ChatPage.tsx apps/desktop/src/components/MessageBubble.tsx apps/desktop/src/components/MessageComposer.tsx apps/desktop/src/components/ChatInput.tsx` — review every action surface for pane-aware collision handling and keyboard access.
- `rg "window\\.innerWidth|innerWidth|clientWidth|getBoundingClientRect|ResizeObserver" apps/desktop/src/components/chat apps/desktop/src/pages/SocialChatPage.tsx apps/desktop/src/pages/ChatPage.tsx apps/desktop/src/components/MessageBubble.tsx apps/desktop/src/components/MessageComposer.tsx apps/desktop/src/components/ChatInput.tsx` — confirm measurements use the owning pane where needed.
- Manual acceptance: verify hover actions, right-click menu, selected text, image messages, failed sends, detail panel open, narrow window, and virtualized history loading.

## Crosswalks

- See `docs/client/desktop/chat-layout-contract.md` for Desktop pane and action placement rules.
- See `docs/knowledge/invariants/chat-message-boundaries.md` for shared message content non-occlusion rules.
