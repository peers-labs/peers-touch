# Mobile Chat Layout Contract

> Status: Mobile platform-level contract.
> Audience: Mobile Chat implementers, reviewers, and AI agents.
> Updated: 2026-06-09.

## 1. Purpose

This document refines `docs/client/chat/chat-ux-contract.md` for Mobile.

Mobile Chat has one primary responsibility: keep conversation content readable while the user's thumb, keyboard, safe area, bottom navigation, attachment panels, and floating actions compete for a small screen.

## 2. Required Screen Model

Mobile conversation detail MUST use a dedicated Chat shell:

```text
MobileChatScreen
├─ ChatHeader
├─ MessageViewport
│  └─ MessageContent
├─ ScrollToBottomAffordance
├─ Composer
├─ InputPanelLayer
└─ SystemSafeArea
```

Rules:

- Chat detail SHOULD hide the app-level bottom tab by default.
- If a bottom tab is visible, it MUST be part of the occlusion model and message bottom clearance calculation.
- `MessageViewport` is the only scroll container in the conversation detail.
- `Composer`, emoji panel, attachment panel, voice panel, keyboard, and home indicator MUST never cover the last message.

## 3. Safe Area And Keyboard Avoidance

Mobile layout MUST compute bottom clearance from visible bottom layers:

```text
messageViewportPaddingBottom =
  composerHeight
  + inputPanelHeight
  + keyboardOverlapHeight
  + bottomTabHeightWhenVisible
  + safeAreaBottom
  + chat.scroll.bottomClearance
```

Implementation requirements:

- Composer height MUST be measured or derived from tokens.
- Attachment and emoji panel heights MUST be explicit.
- Keyboard open/close transitions MUST update the same bottom clearance model, not a separate one-off style.
- The Home Indicator area MUST be treated as an occlusion rectangle.
- The last message bottom edge MUST remain at least `chat.scroll.bottomClearance` above the composer or active panel.

## 4. Composer States

Mobile composer has these legal states:

```text
CompactComposer
ExpandedTextComposer
PanelComposer
VoiceComposer
ReplyOrEditComposer
```

State rules:

- Empty text shows attach/action affordance.
- Non-empty text shows send affordance.
- Multiline input expands to the platform token maximum, then scrolls internally.
- Emoji panel, attachment panel, voice panel, and system keyboard are mutually exclusive visible input surfaces.
- Reply/edit preview uses a reserved row above the input; it MUST NOT consume message list padding directly.

## 5. Message Actions

Mobile message actions MUST use long-press or explicit overflow entry.

Legal placements:

- Context surface above the selected message when enough space exists.
- Context surface below the selected message when it does not collide with composer or safe area.
- BottomSheet fallback when neither side has safe space.

Forbidden placements:

- Absolute action rows inside the bottom of a text bubble.
- Action menus covering image bodies.
- Context surfaces clipped by `MessageViewport`.
- Floating menus hidden behind composer, keyboard, attachment panel, or Home Indicator.

## 6. Touch And Gesture Boundaries

- Minimum interactive target SHOULD use `chat.message.action.minTarget`.
- Horizontal swipe gestures MUST NOT conflict with vertical message scroll.
- Long-press selection MUST keep the selected message visible.
- Pull-to-refresh, history loading, and scroll-to-bottom affordances MUST not share the same gesture zone.
- Image preview gestures MUST not trigger message context actions accidentally.

## 7. Conversation List And Bottom Tab

Conversation list pages may show the app-level bottom tab, but they MUST still reserve bottom space:

```text
conversationListPaddingBottom =
  bottomTabHeight
  + safeAreaBottom
  + chat.scroll.bottomClearance
```

Bottom tab constraints:

- Visual tab height SHOULD be compact and stable.
- Tab labels, badges, and icons MUST NOT increase total height dynamically.
- Conversation list empty/loading/error states MUST fit above the bottom tab.
- Entering chat detail SHOULD transition into a tab-hidden secondary page.

## 8. Mobile Acceptance Matrix

Every Mobile Chat UI change should be checked in these states:

| State | Expected outcome |
| --- | --- |
| Keyboard closed | Last message is visible above composer. |
| Keyboard open | Composer follows keyboard and does not cover content. |
| Attachment panel open | Message list bottom padding includes panel height. |
| Emoji panel open | Panel replaces keyboard and keeps same clearance model. |
| Long text selected | Menu does not cover selected text. |
| Image selected | Menu does not cover image body. |
| Long image near bottom | Fallback action surface does not collide with composer. |
| Failed send | Retry is visible in `MetaRow` or reserved status row. |
| Home Indicator device | Bottom content clears system safe area. |
| Android gesture navigation | Bottom content clears system safe area. |

## 9. AI Agent Notes

When changing `apps/mobile/src/pages/ChatPage.tsx`, `apps/mobile/src/features/chat/`, or future Mobile Chat components, an AI agent MUST:

1. Read `docs/client/chat/chat-ux-contract.md`.
2. Read this document.
3. Read `docs/knowledge/invariants/chat-message-boundaries.md`.
4. Read `docs/knowledge/invariants/mobile-chat-layout-boundaries.md`.
5. Name every bottom occlusion source in the implementation or review notes.
6. Avoid one-off pixel values; add or reuse Chat layout tokens.

## 10. Change Record

- 2026-06-09: Created Mobile-specific Chat layout contract for safe area, keyboard, composer, bottom tab, and touch action boundaries.
