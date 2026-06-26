---
kind: pitfall
title: Mobile Chat actions must not become right drawers
status: active
owns:
  - apps/mobile/src/pages/ChatPage.tsx
  - apps/mobile/src/styles.css
  - docs/client/chat/chat-ux-contract.md
  - docs/client/mobile/chat-layout-contract.md
referenced-by:
  - docs/knowledge/invariants/chat-message-boundaries.md
  - docs/knowledge/invariants/mobile-chat-layout-boundaries.md
  - docs/knowledge/playbooks/ux-case-to-contract.md
related:
  - docs/client/common/ux-design-methodology.md
  - docs/client/common/ui-identity/README.md
  - docs/client/common/ui-identity/layout.md
  - docs/client/common/ui-identity/components.md
  - docs/client/common/ui-identity/interaction.md
detected: 2026-06-19
---

# Mobile Chat actions must not become right drawers

## Symptom

The Mobile Chat "More chat actions" surface opened as a desktop-style right drawer on a phone-width screen:

- The drawer covered most of the conversation while leaving an arbitrary strip of messages visible on the left.
- Header, close affordance, action rows, background choices, and destructive actions read as one generic panel instead of a mobile conversation action sheet.
- Search, mute, sticky, alert, background, clear history, group members, block, and unblock were not named as one `ConversationActionSurface`.
- Destructive actions were visually adjacent to reversible preferences.
- The surface did not clearly communicate bottom safe-area ownership, one internal scroll container, or mobile sheet boundaries.

## Root Cause

The implementation treated conversation-level actions as a generic floating drawer instead of a platform-specific `ConversationActionSurface`. Existing UI Identity rules were strong enough to flag boundary, floating-layer, dangerous-action, and safe-area problems, but the Chat contract did not explicitly name conversation actions as distinct from message actions. Without that name, a desktop drawer pattern leaked into the mobile phone-width implementation.

## Mitigation

### What was done in code

- Replaced the `ChatActionDrawer` component with `ChatActionSheet` in `apps/mobile/src/pages/ChatPage.tsx`.
- Added dialog semantics with `role="dialog"`, `aria-modal="true"`, and a labelled sheet title.
- Converted the visual placement in `apps/mobile/src/styles.css` from a right-aligned fixed drawer to a bottom-aligned full-width action sheet.
- Added a drag handle, sticky sheet header, safe-area bottom padding, backdrop blur, and one internal scroll container.
- Grouped reversible preferences, background selection, secondary actions, and dangerous actions into separate visual sections.
- Updated `docs/client/chat/chat-ux-contract.md` to define `ConversationActionSurface`.
- Updated `docs/client/mobile/chat-layout-contract.md` to require bottom sheets or dedicated settings pages for mobile conversation actions.

### What guards against regression

- Mobile Chat edits must load `docs/client/chat/chat-ux-contract.md` and `docs/client/mobile/chat-layout-contract.md` before changing conversation-level actions.
- Phone-width conversation actions must use a bottom action sheet or dedicated settings page, not a right drawer.
- Destructive actions must remain visually grouped away from reversible preferences.

## How to Detect a Recurrence

Run these checks during review:

- `rg "ChatActionDrawer|right:\\s*0|border-left|width:\\s*min\\([^\\n]*vw" apps/mobile/src/pages/ChatPage.tsx apps/mobile/src/styles.css`
- `rg "ConversationActionSurface|Conversation Action Sheets" docs/client/chat/chat-ux-contract.md docs/client/mobile/chat-layout-contract.md`
- `rg "clearHistory|block|unblock|danger" apps/mobile/src/pages/ChatPage.tsx apps/mobile/src/styles.css`

Interpretation:

- A right-edge drawer is not acceptable for phone-width Mobile Chat conversation actions unless the design intentionally routes to a dedicated settings page instead.
- `ConversationActionSurface` must remain documented in both the cross-client Chat contract and the Mobile layout contract.
- Clear history, block, and unblock must stay in a danger group or an equivalent destructive-action section.

## Crosswalks

- Invariant: `docs/knowledge/invariants/chat-message-boundaries.md`.
- Invariant: `docs/knowledge/invariants/mobile-chat-layout-boundaries.md`.
- Playbook: `docs/knowledge/playbooks/ux-case-to-contract.md`.
- Contract: `docs/client/chat/chat-ux-contract.md`.
- Contract: `docs/client/mobile/chat-layout-contract.md`.
