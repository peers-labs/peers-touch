# Desktop Chat Layout Contract

> Status: Desktop platform-level contract.
> Audience: Desktop Chat implementers, reviewers, and AI agents.
> Updated: 2026-06-09.

## 1. Purpose

This document refines `docs/client/chat/chat-ux-contract.md` for Desktop.

Desktop Chat has more horizontal space than Mobile, but also more collision sources: side navigation, conversation list, detail panels, hover action bars, right-click menus, resizable panes, modals, and Tauri window size changes.

## 2. Required Surface Model

Desktop conversation surfaces MUST reason about these rectangles:

```text
DesktopChatSurface
├─ AppShellNavRect
├─ ConversationListRect
├─ ConversationPaneRect
│  ├─ ChatHeaderRect
│  ├─ MessageViewportRect
│  │  └─ MessageContentRect
│  └─ ComposerRect
├─ DetailPanelRect
├─ FloatingLayerRect
└─ WindowViewportRect
```

Rules:

- `MessageViewportRect` is the only vertical scroll container inside the active conversation pane.
- Side navigation, conversation list, and detail panel widths MUST be excluded from message content calculations.
- Pane resize MUST recompute bubble max width, action placement, and floating layer collision.
- The composer MUST be fixed to the conversation pane bottom, not the full app window bottom.

## 3. Desktop Message Actions

Desktop supports hover, right-click, keyboard, and explicit overflow actions.

Legal action patterns:

- Hover action bar outside the readable message body.
- Right-click context menu using collision-aware placement.
- Keyboard-accessible overflow menu anchored to `ActionAnchor`.
- Detached side popover when the message is near viewport edges.

Forbidden patterns:

- Hover bar covering text selection, image body, file name, voice scrubber, or retry control.
- Context menu that overflows behind the composer or outside the Tauri webview.
- Absolute action controls that depend on a fixed window width.
- Action controls that appear only on hover without keyboard or screen reader access.

## 4. Split Layout Boundaries

Desktop Chat may combine multiple panes:

```text
Sidebar + ConversationList + ConversationPane + DetailPanel
```

Boundary rules:

- The conversation pane owns message width and composer width.
- Bubble max width MUST be based on `ConversationPaneRect`, not `WindowViewportRect`.
- Detail panel open/close MUST not shift scroll anchor unexpectedly.
- Conversation list resize MUST not cause the selected message action menu to cover content.
- Empty, loading, error, and no-selection states MUST occupy the conversation pane rather than leaking into side panes.

## 5. Scroll And Virtualization

Desktop may use virtualized message lists, but virtualization must preserve the cross-client scroll contract:

- Loading older messages MUST preserve the visible anchor.
- New message auto-scroll only applies when the user is at bottom.
- Hover bars and context menus MUST remain anchored to the rendered message while virtualization updates.
- If the selected message unmounts due to virtualization, any attached floating action surface MUST close or re-anchor safely.
- The last message bottom edge MUST stay above `ComposerRect` with `chat.scroll.bottomClearance`.

## 6. Composer And Focus

Desktop composer requirements:

- Composer is fixed to `ConversationPaneRect` bottom.
- Reply/edit context rows are reserved above the input.
- Keyboard shortcuts MUST not steal focus from message text selection.
- Send, attach, emoji, mention, and voice/file affordances must be keyboard reachable when present.
- Composer expansion MUST reduce `MessageViewportRect` height instead of overlaying the last message.

## 7. Window And Density Rules

- Narrow windows MUST degrade toward the Mobile-like single conversation pane model.
- Very wide panes SHOULD cap bubble max width through Chat tokens.
- High-density layouts MUST keep `MetaRow` readable and separated from content.
- Dark mode, high contrast mode, and reduced motion mode MUST not change collision semantics.

## 8. Desktop Acceptance Matrix

Every Desktop Chat UI change should be checked in these states:

| State | Expected outcome |
| --- | --- |
| Hover text message | Hover actions do not cover text. |
| Hover image message | Hover actions do not cover image body. |
| Right-click near top | Context menu remains inside viewport. |
| Right-click near bottom | Context menu does not collide with composer. |
| Detail panel open | Bubble width and scroll anchor remain stable. |
| Window resized narrow | Actions re-place or collapse safely. |
| Virtualized history loading | Current reading anchor is preserved. |
| Failed send | Retry remains readable and keyboard reachable. |
| Keyboard navigation | Message actions are accessible without mouse. |
| Text selection | Selection is not hidden by hover actions. |

## 9. AI Agent Notes

When changing `apps/desktop/src/components/chat/`, `apps/desktop/src/pages/SocialChatPage.tsx`, `apps/desktop/src/pages/ChatPage.tsx`, or legacy Chat components, an AI agent MUST:

1. Read `docs/client/chat/chat-ux-contract.md`.
2. Read this document.
3. Read `docs/knowledge/invariants/chat-message-boundaries.md`.
4. Read `docs/knowledge/invariants/desktop-chat-layout-boundaries.md`.
5. Identify which pane owns each measurement.
6. Avoid action placement that assumes a single fixed viewport.

## 10. Change Record

- 2026-06-09: Created Desktop-specific Chat layout contract for pane boundaries, hover/right-click actions, virtualization, focus, and Tauri window resizing.
