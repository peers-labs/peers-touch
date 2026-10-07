# Mobile Chat Layout Contract

> Status: Mobile platform-level contract.
> Audience: Mobile Chat implementers, reviewers, and AI agents.
> Updated: 2026-06-19.

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

## 6. Conversation Action Sheets

Conversation-level actions are opened from the chat header or conversation detail controls. They configure the conversation rather than operating on one message.

Required mobile behavior:

- Use a bottom action sheet or a dedicated chat settings page for conversation actions.
- Do not use a desktop-style right drawer on phone-width screens.
- The sheet MUST include the system safe area in its bottom padding.
- The sheet MUST have one scroll container when content exceeds the available height.
- The backdrop MUST make the underlying conversation non-interactive while preserving visual context.
- The header, close affordance, and drag/handle affordance MUST share one sheet boundary.
- Reversible preferences such as search, mute, sticky, alert, and background MAY update optimistically when rollback or re-open recovery is clear.
- Destructive actions such as clear history and block MUST be grouped separately and confirmed when they remove or hide conversation context.

Acceptance states:

| State | Expected outcome |
| --- | --- |
| iPhone safe-area device | Sheet clears the Home Indicator and remains scrollable. |
| Long action list | Sheet scrolls internally; header and close remain available. |
| Background selected | The selected option is visible as selection state, not as a command row. |
| Destructive action visible | Danger group is separated from reversible preferences. |
| Backdrop tap | Sheet closes and the chat returns to its previous scroll context. |

## 7. Touch And Gesture Boundaries

- Minimum interactive target SHOULD use `chat.message.action.minTarget`.
- Horizontal swipe gestures MUST NOT conflict with vertical message scroll.
- Long-press selection MUST keep the selected message visible.
- Pull-to-refresh, history loading, and scroll-to-bottom affordances MUST not share the same gesture zone.
- Image preview gestures MUST not trigger message context actions accidentally.

## 8. Conversation List And Bottom Tab

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

## 9. Mobile Acceptance Matrix

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
| Conversation action sheet open | Sheet uses bottom placement, safe-area padding, internal scroll, and separated danger group. |
| Failed send | Retry is visible in `MetaRow` or reserved status row. |
| Home Indicator device | Bottom content clears system safe area. |
| Android gesture navigation | Bottom content clears system safe area. |

## 10. AI Agent Notes

When changing `apps/mobile/src/pages/ChatPage.tsx`, `apps/mobile/src/features/chat/`, or future Mobile Chat components, an AI agent MUST:

1. Read `docs/client/chat/chat-ux-contract.md`.
2. Read this document.
3. Read `docs/knowledge/invariants/chat-message-boundaries.md`.
4. Read `docs/knowledge/invariants/mobile-chat-layout-boundaries.md`.
5. Name every bottom occlusion source in the implementation or review notes.
6. Avoid one-off pixel values; add or reuse Chat layout tokens.
7. Check conversation action sheets separately from message action menus.

## 11. Change Record

- 2026-06-09: Created Mobile-specific Chat layout contract for safe area, keyboard, composer, bottom tab, and touch action boundaries.
- 2026-06-19: Added `ConversationActionSurface` mobile action sheet rules after a phone-width right drawer regressed the Peers Touch UI identity.

## 12. Bounded History And Restoration

`BoundedList` is a presentation-only SectionBoundary shared by Chat, Contacts,
and member selections. It does not fetch data or retain hidden page trees.
Messages mount at most 200 rows; other lists mount at most 100. Previous/Next
traverse overlapping half-windows, and message targets materialize before focus
or scrolling. Replacing a window keeps the overlapping row's viewport offset.
Logical-history selectors own thread counts and local search; submitting search
uses the existing native indexed-search command and its timestamp/ID cursor.

`app/navigation/scrollRestoration.ts` owns bounded in-memory window/query/scroll
metadata outside tab lifetime. Each cache retains at most 100 locations; scroll
snapshots expire after 30 minutes. The actual page or message scroller is used,
not the Shell's clipping wrapper. Runtime projection fencing clears all
metadata on account/Station teardown; ordinary suspend must not erase it.
An older window's bottom is not the live conversation tail.

Source tests and `node apps/mobile/scripts/check-bounded-lists.mjs` exercise
these mechanics. The latter uses isolated presentation data and closes its
browser/server. It does not prove native Messaging, Station pagination,
physical-device accessibility, AS-14 timing, or bounded projection memory.
Full native history hydration remains separately tracked in the Mobile plan.

Conversation-list freshness uses the native Device Engine's
`messaging_conversation_summary` read: the last logical message and actor unread
count are computed from the same visible pending/committed rows as full history.
Summary queries decode at most one message and enrich only its pins,
attachments, reactions, and readers. The Messaging runtime publishes Direct
and Group summaries independently of loaded history. Native events refresh full
history only for active or already-materialized conversations, so an unopened
conversation does not become an unbounded Web history merely to show a preview
or unread badge. Scope and refresh-revision fencing preserve valid snapshots
when reads fail or are superseded.

This refinement does not define general history cursor ordering, pending-row
promotion between pages, or a retained-history eviction budget. Active and
previously materialized histories remain complete until those decisions are
accepted; the native index and DOM windows are not substitutes for them.
