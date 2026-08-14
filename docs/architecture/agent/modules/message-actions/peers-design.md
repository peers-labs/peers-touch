# Module 2: Message & Actions — Peers-Touch Architecture Design

> **Module**: P0-M2 Message & Actions
> **Step**: S2 — Peers Design
> **Status**: draft
> **Depends on**: reference-analysis.md (S1 complete), Module 1 Streaming Runtime (S3 complete)

---

## 1. Scope

This module delivers:
- A registry-based message action system (replacing hardcoded buttons)
- Role-dispatched message components (splitting the monolithic MessageBubble)
- Core actions: copy, edit, delete, regenerate, retry, branch, continue
- Streaming-aware message states (thinking, tool calling, done, error)

Out of scope for this module (deferred to P1/P2):
- Virtualized message list (ChatList with virtua)
- Translate, TTS, share actions
- Multi-select / forward
- AssistantGroup / CompressedGroup rendering
- Comments on messages

## 2. Architecture Overview

```
store/chat.ts (existing)
    │ messages: ChatMessage[]
    │ operations: Record<string, Operation>
    ▼
components/messages/
    ├── MessageList.tsx          ← scroll container + auto-scroll (existing ChatPage logic extracted)
    ├── MessageItem.tsx          ← role dispatcher (new)
    ├── AssistantMessage.tsx     ← assistant rendering + thinking + tool calls (extracted from MessageBubble)
    ├── UserMessage.tsx          ← user message (extracted)
    ├── ToolCallCard.tsx         ← tool call detail card (extracted)
    └── MessageActionBar.tsx     ← registry-based action bar (new)

components/messages/actions/     ← action definitions
    ├── types.ts                ← MessageAction interface
    ├── registry.ts             ← buildActions(message, context) → action[]
    ├── copy.ts
    ├── edit.ts
    ├── delete.ts
    ├── regenerate.ts
    ├── retry.ts
    ├── branch.ts
    └── continue.ts
```

## 3. Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Extract message components from MessageBubble, keep MessageBubble as thin dispatcher | Incremental refactor; existing tests and imports still work |
| D2 | Action bar uses a registry pattern (array of action descriptors) | Extensible; actions can be added/removed without touching the bar component |
| D3 | Actions are per-message-state aware | Action visibility depends on message.role + message.loading + operation state |
| D4 | Keep flat messages[] array (no dual map) | Sufficient for current needs; dual map is optimization for large history |
| D5 | No virtualization yet | Deferred to separate module; current performance is acceptable |

## 4. Message Action Registry

### 4.1 Action Interface

```typescript
// components/messages/actions/types.ts

interface MessageActionDef {
  key: string;
  label: string;           // i18n key
  icon: ComponentType;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  onClick: () => void;
}

interface MessageActionContext {
  message: ChatMessage;
  isStreaming: boolean;
  isCurrentSession: boolean;
  operationState: Operation | undefined;
}
```

### 4.2 Registry Logic

```typescript
// components/messages/actions/registry.ts

function buildMessageActions(ctx: MessageActionContext): {
  primary: MessageActionDef[];   // always-visible icon buttons (max 2-3)
  menu: MessageActionDef[];      // overflow dropdown items
} {
  const { message, isStreaming } = ctx;
  
  if (message.role === 'user') {
    return {
      primary: [copyAction(ctx), editAction(ctx)],
      menu: [regenerateAction(ctx), deleteAction(ctx)],
    };
  }
  
  if (message.role === 'assistant') {
    if (message.error) {
      return {
        primary: [retryAction(ctx), deleteAction(ctx)],
        menu: [copyAction(ctx)],
      };
    }
    if (message.loading) {
      return { primary: [], menu: [] }; // no actions while streaming
    }
    return {
      primary: [copyAction(ctx), regenerateAction(ctx)],
      menu: [editAction(ctx), branchAction(ctx), continueAction(ctx), deleteAction(ctx)],
    };
  }
  
  return { primary: [copyAction(ctx)], menu: [] };
}
```

## 5. Component Decomposition

### MessageBubble.tsx refactor strategy

1. **Keep MessageBubble as the export** (no breaking changes for importers)
2. MessageBubble becomes a thin role dispatcher:
   ```tsx
   function MessageBubble({ message, ...props }) {
     switch (message.role) {
       case 'assistant': return <AssistantMessage message={message} {...props} />;
       case 'user': return <UserMessage message={message} {...props} />;
       default: return <SystemMessage message={message} />;
     }
   }
   ```
3. Extract role-specific rendering into `components/messages/AssistantMessage.tsx` and `components/messages/UserMessage.tsx`
4. Extract tool call rendering into `components/messages/ToolCallCard.tsx`
5. Extract thinking block into `components/messages/ThinkingBlock.tsx`

### New component tree

```
MessageBubble (dispatcher, ~50 lines)
├── AssistantMessage (~400 lines)
│   ├── ThinkingBlock (collapsible thinking/reasoning)
│   ├── ToolCallCard[] (each tool call with status/progress/result)
│   ├── KnowledgeChunks (knowledge retrieval display)
│   ├── MessageContent (markdown rendered content)
│   └── MessageActionBar (registry-based)
├── UserMessage (~150 lines)
│   ├── MessageContent
│   ├── AttachmentList (images/files)
│   └── MessageActionBar
└── SystemMessage (~30 lines)
```

## 6. Integration Plan

### Files that change

| File | Change | Description |
|------|--------|-------------|
| `components/MessageBubble.tsx` | Refactor to dispatcher | Keep exports, extract internals |
| `components/messages/` | **New directory** | Role components + action system |
| `components/messages/AssistantMessage.tsx` | New | Extracted from MessageBubble |
| `components/messages/UserMessage.tsx` | New | Extracted from MessageBubble |
| `components/messages/ToolCallCard.tsx` | New | Extracted tool call rendering |
| `components/messages/ThinkingBlock.tsx` | New | Thinking/reasoning collapsible |
| `components/messages/MessageActionBar.tsx` | New | Registry-based action bar |
| `components/messages/actions/` | New | Action definitions + registry |
| `pages/ChatPage.tsx` | Minor | No change needed (already uses MessageBubble) |

### What does NOT change
- `store/chat.ts` message shape (ChatMessage)
- `pages/ChatPage.tsx` message list rendering
- Existing test files (they import from `MessageBubble`)
- Store actions (sendMessage, regenerate, retry, etc.)

## 7. Missing Actions to Implement

| Action | Store method | Status |
|--------|-------------|--------|
| copy | clipboard.writeText | ✅ exists in MessageBubble |
| edit | `editMessage(id, content)` | ✅ exists |
| delete | `deleteMessage(id)` | ✅ exists |
| regenerate | `regenerateMessage(id)` | ✅ exists |
| retry | `retryMessage(id)` | ✅ exists |
| deleteAndRegenerate | `deleteAndRegenerateMessage(id)` | ✅ exists |
| branch | `branchFromMessage(id)` | ✅ exists |
| continue | `continueGeneration(id)` | **New** — send empty message continuing from this assistant msg |

Only `continueGeneration` needs a new store action.
