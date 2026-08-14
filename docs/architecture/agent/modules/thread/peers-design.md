# P2-M9 Thread (Sub-conversations) — Peers Design (S2)

## 1. Feature Source

**LobeHub topology**: `store/chat/slices/thread` + `features/Portal/Thread`

In LobeHub, Thread = "branch from a message and continue in Portal side panel". The main chat stays uncluttered; the side conversation lives in the right panel.

**Scope** (v1):
- "Open Thread" action on assistant messages → opens Portal with thread view
- Thread view renders branch messages starting from the selected message
- User can send new messages within the thread (uses same turn API)
- Thread list in topic sidebar (existing branch sessions surfaced)

**Out of scope** (deferred):
- Thread merging back to main conversation
- Thread-specific topic/title management

---

## 2. Architecture Decision

### 2.1 Mapping to Existing Infrastructure

We already have:
- `branchFromMessage(messageId)` → duplicates session, prunes to branch point
- Portal side panel with DraggablePanel (P1-M5)
- `portal.ts` store with view switching

**Decision**: Thread = "open a branched session in Portal". No new proto needed. We reuse the existing branch mechanism but surface it in Portal instead of navigating away.

### 2.2 Portal Store Extension

Add `thread` view to `PortalView`:

```typescript
// store/portal.ts
type PortalView = 'artifacts' | 'artifactDetail' | 'toolDetail' | 'thread';

interface PortalState {
  // ... existing
  threadSessionKey: string | null;  // the branched session key being viewed
  threadSourceMessageId: string | null;  // the message that spawned the thread
}

actions: {
  openThread: (sessionKey: string, sourceMessageId: string) => void;
}
```

### 2.3 Thread Action Flow

```
User clicks "Thread" on a message
  → chat.branchFromMessage(messageId) — creates new session
  → portal.openThread(newSessionKey, messageId)
  → Portal renders ThreadView with the branched session's messages
  → User sends message in thread → uses same sendMessage but targeting threadSessionKey
```

### 2.4 UI Components

New: `components/portal/views/ThreadView.tsx`
- Header: "Thread from: [truncated source message]"
- Message list (reuses MessageBubble)
- Input area (reuses ChatInput targeting thread session)

### 2.5 Action Bar Addition

Add "Thread" action to `buildAssistantActions` menu:
```typescript
{ key: 'thread', label: 'chat.message.action.thread', icon: MessageSquareMore, onClick: ctx.onThread }
```

---

## 3. Implementation Checklist

| # | File | Change |
|---|------|--------|
| 1 | `store/portal.ts` | Add `thread` view, `threadSessionKey`, `openThread` action |
| 2 | `components/portal/views/ThreadView.tsx` | New component |
| 3 | `components/portal/PortalPanel.tsx` | Route `thread` view |
| 4 | `messages/actions/types.ts` | Add `onThread` |
| 5 | `messages/actions/registry.ts` | Add Thread action |
| 6 | `messages/AssistantMessage.tsx` | Wire `onThread` |
| 7 | Locales | Add thread keys |

---

## 4. Acceptance Criteria Preview

- **D1**: TS check passes
- **F1**: Click Thread → Portal opens with thread view showing branched messages
- **F2**: Send message in thread → appends to branched session
- **F3**: Close Portal → thread session persists, reopenable
- **I1**: Thread uses same Station turn API (no new endpoint needed)
