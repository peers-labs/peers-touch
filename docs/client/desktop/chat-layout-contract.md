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

Action-button transitions MUST name visual properties explicitly. They must not
animate inherited `visibility`: a toolbar becoming visible must make its
controls focusable immediately, including in a background WebView.

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
- The shared `useDrawerAssembly` owns one stage width/height measurement,
  catalogue preference, pressure, main guide and inner guide. There is no
  720/960px pane swap. The allocation and stops are defined in
  [drawer-assembly.md](../../architecture/platform/client/ui-system/prototype/drawer-assembly.md).
  Catalogue paper stays finite; exposure retracts beneath the main guide.
  The 480px reading ideal is soft: catalogue and work share compression
  against complete 64px catalogue / 200px work minima and the 280px usable
  work budget. The visible separator remains draggable under pressure;
  pointer and keyboard inputs invert the same allocation, and Back restores
  the finite catalogue with its handle at the restored edge.
  At 200px exposure, left-aligned identity rows and both tabs/search/new are
  restored; Segmented measures whether labels fit. This presentation budget
  is independent of the 240px stable preference. Catalogue avatars are 36px
  with 6px radius, and session rows consume the shared 56px height.
  No-selection, direct-open intent and selected-conversation branches share
  a persistent guide and the same `WindowDragRegion > div` content root.
  Presentation Back preserves business selection, composer, attachments and
  reading position. Selecting a different object dismisses the old inner task.
- Detail/thread belongs inside the main work bay, fills a compressed bay and
  docks at the shared leaf width when a readable parent remainder fits.
  Opening it does not reflow the main timeline. Retain only the current inner
  task while parked to preserve its draft/scroll; covered and moving regions
  are `inert` and `aria-hidden`. Back closes the deepest task first.
- Push and pop use `motion.navigation` / `motion.ease.drawer` from UI
  Identity. Reduced motion disables the transition. The navigation state and
  business selection are independent of animation completion.
- The moving stage MUST use `overflow: clip` on both axes, with
  `scrollLeft` remaining zero throughout navigation. Message tail anchoring
  MUST set only the message viewport's `scrollTop`; `scrollIntoView` can
  scroll ancestors and cancel the pane's actual horizontal travel. Verify
  screen-space pane bounds relative to the stage, not only its CSS transform.
- Very wide panes SHOULD cap bubble max width through Chat tokens.
- High-density layouts MUST keep `MetaRow` readable and separated from content.
- Metadata flows onto additional lines when its localized verdict cannot fit.
  Constrain the verdict's tooltip anchor to the message column, wrap long
  reason codes, and keep Retry whole and keyboard reachable. Neither a fixed
  metadata height nor clipping may discard the recovery action.
- Composer controls stay whole inside the writing dock. Tool and send groups
  wrap when their combined width exceeds the pane, including upload labels.
- Header tools enter a complete, keyboard-accessible menu below the shared
  work-tools budget; video/detail cannot be silently removed. Short height
  bounds composer context and input separately. `TextArea` owns auto-growth
  and remeasures when the parent budget changes.
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
