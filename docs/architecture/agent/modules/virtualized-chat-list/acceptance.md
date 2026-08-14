# P2-M10 Virtualized Chat List — Acceptance (S4)

## Deterministic (D)

| ID | Check | Result |
|----|-------|--------|
| D1 | `pnpm run check` passes | ✅ |
| D2 | No new dependencies (uses existing @tanstack/react-virtual) | ✅ |
| D3 | MessageList accepts scrollRef prop | ✅ |
| D4 | ChatPage passes scrollRef to MessageList | ✅ |

## Functional (F)

| ID | Check | Expected |
|----|-------|----------|
| F1 | 100+ messages render without jank | Only visible items + overscan in DOM |
| F2 | New message while at bottom → auto-scrolls | Smooth scroll to end |
| F3 | User scrolls up → new message doesn't force scroll | Position preserved |
| F4 | FollowUpChips visible after last assistant message | Included as last virtual item |
| F5 | MessageBubble hover/actions still functional | Virtual items are interactive |
| F6 | Variable height messages measured correctly | No layout jumps |

## Integration (I)

| ID | Check | Expected |
|----|-------|----------|
| I1 | scrollRef from ChatPage wired to virtualizer | useVirtualizer.getScrollElement returns the scroll container |
| I2 | Old auto-scroll effect removed from ChatPage | No duplicate scroll behavior |
