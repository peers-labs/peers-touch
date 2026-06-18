# Cross-Client Chat UX Contract

> Status: Canonical client-level contract.
> Audience: Desktop, Mobile, reviewers, and AI agents generating Chat UI code.
> Updated: 2026-06-09.

## 1. Purpose

Peers-Touch Chat must feel like one IM product across Desktop and Mobile while respecting each platform's input model.

This document defines the cross-client contract for:

- Message structure and visual semantics.
- Non-overlap layout boundaries.
- Message action placement.
- Scroll anchoring and new-message behavior.
- Composer, status, failure, and empty/error states.

Platform-specific rules live in:

- `docs/client/mobile/chat-layout-contract.md`
- `docs/client/desktop/chat-layout-contract.md`

Path-level hard rules live in:

- `docs/knowledge/invariants/chat-message-boundaries.md`
- `docs/knowledge/invariants/mobile-chat-layout-boundaries.md`
- `docs/knowledge/invariants/desktop-chat-layout-boundaries.md`

## 2. Product Principles

Chat UI MUST optimize for readable messages, stable spatial boundaries, and predictable recovery from weak network or layout collisions.

The product must never rely on visual luck:

- A message operation menu MUST NOT cover the readable body of the selected message.
- The composer MUST NOT cover the last message.
- The viewport MUST NOT allow header, tab bar, side panel, action menu, or system safe area to hide message content.
- Message metadata MUST NOT compete with content padding.
- Platform differences MUST preserve shared message semantics.

## 3. Shared Message Anatomy

Every user-visible message SHOULD map to this semantic structure, even if a platform renders slots differently:

```text
MessageItem
├─ AvatarSlot
├─ SenderSlot
├─ Bubble
│  └─ Content
├─ MetaRow
│  ├─ time
│  ├─ deliveryStatus
│  └─ retry affordance
└─ ActionAnchor
```

Slot rules:

- `Bubble` owns only primary content: text, image, file, voice, link preview, system copy, or quoted preview.
- `MetaRow` owns time, sent/delivered/read state, failure state, and retry entry.
- `ActionAnchor` owns placement for context menus, hover actions, long-press actions, and overflow controls.
- `AvatarSlot` and `SenderSlot` may collapse in consecutive message groups, but their absence MUST NOT change message body width unpredictably.

Anti-patterns:

- Do not place long-press or right-click action menus inside the bottom of `Bubble`.
- Do not encode time/status inside text layout padding.
- Do not overlay image actions on the image body unless the overlay is transient, low-priority, and collision checked.

## 4. Shared Layout Rectangles

Every Chat implementation MUST reason in rectangles:

```text
ChatSurfaceRect
├─ HeaderRect
├─ MessageViewportRect
│  └─ MessageContentRect
├─ ComposerRect
├─ FloatingLayerRect
└─ PlatformSafeAreaRect
```

Required invariants:

- `MessageContentRect` MUST exclude `HeaderRect`, `ComposerRect`, sidebars, bottom tabs, and platform safe areas.
- `FloatingLayerRect` MUST be collision checked against the viewport and selected message body.
- `ComposerRect` MUST be stable and measured or tokenized; message list bottom padding MUST derive from it.
- `MessageViewportRect` MUST be the only vertical scroll container inside a conversation detail surface.

## 5. Action Placement

Action surfaces include context menus, hover bars, long-press menus, reaction pickers, retry popovers, attachment previews, and message overflow controls.

Placement algorithm:

```text
1. Compute selectedMessageContentRect.
2. Compute viewportRect and occlusionRects.
3. Prefer placing the action surface outside selectedMessageContentRect.
4. Prefer above the message when there is enough space.
5. Fall back below the message when below space is safe.
6. Fall back to a detached surface:
   - Mobile: BottomSheet.
   - Desktop: collision-aware ContextMenu or side popover.
7. Never choose a placement that intersects selectedMessageContentRect.
```

Occlusion rectangles:

- Header.
- Composer.
- Mobile keyboard or attachment panel.
- Mobile bottom tab when visible.
- Desktop sidebars, detail panels, and resizable splitters.
- System safe areas.
- Existing modal, drawer, or popover layers.

## 6. Message Type Rules

Text messages:

- Long text MUST wrap inside the bubble max width.
- Selection, copy, quote, and action menus MUST NOT cover the selected text.
- If metadata is present, it MUST live in `MetaRow` or a reserved inline status slot with explicit padding.

Image messages:

- Image body MUST keep an undisturbed visible rectangle.
- Send status, retry, and time SHOULD render outside the image in `MetaRow`.
- If a transient image overlay is needed, it MUST be bounded, gradient-backed, and must not host primary actions.

File messages:

- Filename, size, status, and retry MUST be readable without opening a menu.
- File cards MUST reserve space for icons and status rather than overlaying them on the filename.

Voice messages:

- Progress, duration, and retry MUST share a stable row.
- Action surfaces MUST not cover the scrubber or playback affordance.

System messages:

- System copy MUST use the i18n system.
- System messages MUST be visually distinct from user bubbles and cannot inherit user action menus by default.

## 7. Scroll Contract

Conversation scrolling MUST preserve reading context:

- Entering a conversation defaults to the newest readable message when no saved anchor exists.
- Loading history above the current viewport MUST preserve the current anchor and must not jump.
- Receiving new messages while the user is reading history MUST show a new-message affordance instead of forcing scroll to bottom.
- When the user is at bottom, new messages MAY auto-scroll if doing so does not interrupt composition.
- The last message bottom edge MUST remain visible above the composer with a minimum platform gap.

## 8. Composer Contract

Composer semantics are shared even when layout differs:

- Empty composer shows attach/action affordance.
- Non-empty composer shows send affordance.
- Multiline composer has a maximum expansion height; after that, the input scrolls internally.
- Reply/edit/draft context occupies a reserved context row above the input, not ad hoc bubble padding.
- Failed sends must be recoverable at message level and should not rely only on toast feedback.

## 9. Visual Tokens

Implementations MUST use named Chat layout tokens instead of magic numbers.

Minimum shared token groups:

```text
chat.surface.paddingInline
chat.message.avatarSize
chat.message.bubble.maxWidth
chat.message.bubble.paddingX
chat.message.bubble.paddingY
chat.message.bubble.radius
chat.message.meta.gap
chat.message.group.gap
chat.message.cluster.gap
chat.message.action.minTarget
chat.scroll.bottomClearance
chat.composer.minHeight
chat.composer.maxInputRows
```

Platform contracts may map these tokens to different values.

## 10. Accessibility And I18n

- User-facing strings MUST use locale keys.
- Interactive action targets MUST expose accessible names.
- Keyboard focus, screen reader order, and visible focus state MUST match message anatomy order.
- Desktop MUST support keyboard and right-click access to message actions.
- Mobile MUST support touch targets large enough for thumb interaction.

## 11. AI Agent Implementation Checklist

When generating Chat UI code, an AI agent MUST:

1. Identify all affected rectangles: viewport, message content, composer, floating layer, platform safe area.
2. Preserve `MessageItem -> Bubble -> Content -> MetaRow -> ActionAnchor` semantics.
3. Use tokenized spacing and dimensions.
4. Implement action placement as collision-aware, not absolute-by-eye.
5. Verify text, image, file, voice, failure, loading, and empty states.
6. Verify bottom-most content with composer closed, composer expanded, and platform-specific panels visible.

## 12. Change Record

- 2026-06-09: Created the cross-client Chat UX contract to align Mobile and Desktop IM behavior before platform-specific implementation.
