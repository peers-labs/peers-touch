# P2-M10 Virtualized Chat List — Peers Design (S2)

## 1. Feature Source

**LobeHub topology**: `features/Conversation/ChatList` (with virtua)

Current state: Agent `MessageList.tsx` is 27 lines using `.map()` — no virtualization. For conversations with 100+ messages, this causes scroll jank and memory pressure.

**Scope**:
- Replace `.map()` with `@tanstack/react-virtual` (already in deps)
- Dynamic item height measurement (messages vary in height)
- Auto-scroll to bottom on new messages
- Scroll-to-message API (for search results, quoted messages)
- Preserve FollowUpChips at bottom (outside virtual list)

**Out of scope** (deferred):
- Sticky date separators (low priority for Agent chat)
- Infinite scroll / pagination (Agent conversations rarely exceed 500 messages)

---

## 2. Architecture Decision

### 2.1 Library Choice

Use `@tanstack/react-virtual` (already installed, v3.14.7). The IM side (`ChatMessageTimeline.tsx`) already uses it — proven in this codebase.

### 2.2 Component Design

Replace `MessageList.tsx` internals:

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

export function MessageList() {
  const messages = useChatStore(s => s.messages);
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  // Auto-scroll on new message
  useEffect(() => {
    if (shouldAutoScroll) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end', behavior: 'smooth' });
    }
  }, [messages.length]);

  return (
    <div ref={parentRef} style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{ position: 'absolute', top: virtualItem.start, width: '100%' }}
          >
            <MessageBubble message={messages[virtualItem.index]} />
          </div>
        ))}
      </div>
      {/* FollowUpChips pinned at bottom, outside virtual container */}
    </div>
  );
}
```

### 2.3 Auto-Scroll Logic

- Track `isAtBottom` via scroll event (within 50px of bottom)
- If user is at bottom when new message arrives → auto-scroll
- If user has scrolled up → don't auto-scroll (show "new messages" indicator later)

### 2.4 Scroll-to-Message API

Expose via store or ref:
```typescript
scrollToMessage: (messageId: string) => {
  const index = messages.findIndex(m => m.id === messageId);
  if (index >= 0) virtualizer.scrollToIndex(index, { align: 'center', behavior: 'smooth' });
}
```

---

## 3. Implementation Checklist

| # | File | Change |
|---|------|--------|
| 1 | `components/MessageList.tsx` | Rewrite with `useVirtualizer` |
| 2 | Parent container | Ensure fixed height (flex: 1) for scroll container |
| 3 | `store/chat.ts` | Add `scrollToMessage` action (optional, v1 can skip) |

---

## 4. Acceptance Criteria Preview

- **D1**: TS check passes
- **D2**: No new dependencies needed
- **F1**: 100+ messages render without scroll jank
- **F2**: New message arrives → auto-scrolls to bottom (if already at bottom)
- **F3**: User scrolls up → stays in position on new message
- **F4**: FollowUpChips visible after last message
- **F5**: MessageBubble interaction (hover, actions) still works within virtual items
