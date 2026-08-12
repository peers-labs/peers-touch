# Module 2: Message & Actions — LobeHub Reference Implementation Analysis

> Step 1b of architecture design methodology.
> Source: `external/lobehub/src/`
> Comparison target: `peers-ai-agent/apps/desktop/src/`
> Date: 2026-08-12

---

## 1. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MESSAGE LIFECYCLE (LobeHub)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User Input ──► addUserMessage() ──► optimisticCreateTmpMessage()           │
│                                       │                                     │
│                                       ├─ internal_dispatchMessage(           │
│                                       │    {type:'createMessage', id:tmp})   │
│                                       │                                     │
│                                       ├─ messagesReducer produces new        │
│                                       │   UIChatMessage[] in dbMessagesMap   │
│                                       │                                     │
│                                       ├─ messageService.createMessage()      │
│                                       │   → backend persist                  │
│                                       │                                     │
│                                       └─ replaceMessages(result.messages)    │
│                                           → parse via conversation-flow      │
│                                           → update messagesMap (display)     │
│                                                                             │
│  messagesMap[key] ──► displayMessageSelectors ──► ChatList                  │
│                         .mainDisplayChats()        │                         │
│                                                    ▼                         │
│                                             VirtualizedList (virtua VList)   │
│                                                    │                         │
│                                                    ▼                         │
│                                             MessageItem (role dispatch)      │
│                                              ├─ AssistantMessage             │
│                                              ├─ AssistantGroupMessage        │
│                                              ├─ UserMessage                  │
│                                              ├─ ToolMessage                  │
│                                              ├─ TaskMessage                  │
│                                              └─ CompressedGroupMessage       │
│                                                    │                         │
│                                                    ▼                         │
│                                             MessageActionBar                 │
│                                              (slot-based registry)           │
│                                                    │                         │
│  Action Click ──► handleClick() ──► store action ──► optimisticUpdate*()    │
│                                                      │                      │
│                                                      ├─ dispatchMessage      │
│                                                      │   (instant UI)       │
│                                                      ├─ service.update*()   │
│                                                      │   (persist)          │
│                                                      └─ replaceMessages()   │
│                                                          (reconcile)        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

1. **Dual message maps**: `dbMessagesMap` (raw flat DB records) vs `messagesMap` (parsed display tree with `assistantGroup` nodes). Selectors explicitly target one or the other.
2. **Optimistic update pattern**: Every mutation dispatches to the local reducer first (instant UI), then persists via service, then reconciles with `replaceMessages()`.
3. **Conversation-flow parser**: Server returns flat messages; `@lobechat/conversation-flow` `parse()` transforms them into grouped display structures (assistantGroup, compressedGroup, tasks).
4. **SWR-backed fetch**: `useFetchMessages` uses SWR with cache identity for deduplication, focus revalidation suppression during streaming.

---

## 2. State Machine

### 2.1 Message States

```
                    ┌───────────┐
         create     │  CREATING │  (isCreatingMessage, tmp_ prefix)
        ─────────►  │  loading  │
                    └─────┬─────┘
                          │ server confirms / stream starts
                          ▼
                    ┌───────────┐
                    │ STREAMING │  (isMessageGenerating, isMessageLoading)
                    │  loading  │  content accumulating
                    └─────┬─────┘
                          │ stream complete
                          ▼
                    ┌───────────┐
                    │   DONE    │  normal rendered state
                    └─────┬─────┘
                          │
          ┌───────────────┼────────────────┐
          │               │                │
          ▼               ▼                ▼
    ┌──────────┐   ┌──────────┐    ┌───────────┐
    │ EDITING  │   │  ERROR   │    │ COLLAPSED │
    │ (toggle) │   │ .error   │    │ .metadata │
    └──────────┘   └──────────┘    │ .collapsed│
                         │         └───────────┘
                         ▼
                   ┌──────────┐
                   │REGENERAT-│  (isMessageRegenerating)
                   │   ING    │  new response replaces
                   └──────────┘

    Special states:
    - BRANCHED: message.threadId set, threadMaps populated
    - TOOL_CALLING: isInToolsCalling, isToolCallStreaming
    - CONTINUING: isMessageContinuing (group last block)
    - REASONING: isMessageInChatReasoning
```

### 2.2 Action Bar Visibility Rules

| Message Role | Bar Slots (always visible) | Menu Slots (overflow) |
|---|---|---|
| **assistant** (no tools, no error) | `edit`, `copy` | `edit`, `copy`, `copyOperationId`, `comments`, `branching`, `collapse`, `divider`, `tts`, `translate`, `divider`, `share`, `select`, `divider`, `regenerate`, `delAndRegenerate`, `del` |
| **assistant** (has tools) | `delAndRegenerate`, `copy` | (same as above) |
| **assistant** (error, has content) | `regenerate`, `del` | `edit`, `copy`, `copyOperationId`, `comments`, `divider`, `del` |
| **assistant** (error, empty) | `regenerate`, `del` | `copyOperationId` |
| **assistantGroup** | `edit`, `copy` | adds `continueGeneration` |
| **user** | `edit`, `copy` | `edit`, `copy`, `copyOperationId`, `comments`, `divider`, `regenerate`, `del` |
| **viewer** (read-only) | `copy`, `comments` | (none) |

Mutating actions (`branching`, `continueGeneration`, `del`, `delAndRegenerate`, `edit`, `regenerate`, `translate`, `tts`) are nulled when `canUseResource === false`.

---

## 3. Architecture Mapping Table

| LobeHub Component | Path | Peers-Touch Equivalent | Path | Gap Analysis |
|---|---|---|---|---|
| **Store: ChatMessageState** | `store/chat/slices/message/initialState.ts` | `ChatState` (flat) | `store/chat.ts` | PT uses single flat `messages[]` array; no dual map, no display parsing |
| **Store: messagesReducer** | `slices/message/reducer.ts` (immer-based discriminated union) | Inline `set()` calls | `store/chat.ts` | PT has no formal reducer; mutations scattered across action bodies |
| **Store: MessagePublicApiAction** | `slices/message/actions/publicApi.ts` | Mixed into `useChatStore` | `store/chat.ts` | PT: `sendMessage`, `deleteMessage`, `editMessage`, `regenerateMessage`, `retryMessage`, `branchFromMessage`, `deleteAndRegenerateMessage` exist but are monolithic |
| **Store: MessageOptimisticUpdateAction** | `slices/message/actions/optimisticUpdate.ts` | Inline optimistic patterns | `store/chat.ts` (e.g. `sendMessage` appends temp msg) | PT does optimistic create but no formal optimistic update abstraction for edit/delete |
| **Store: MessageQueryAction** | `slices/message/actions/query.ts` (SWR) | `syncMessages`, `loadSessionMessages` | `store/chat.ts` | PT uses custom cache layer (`agentChatCache`), no SWR |
| **Store: messageStateSelectors** | `slices/message/selectors/messageState.ts` | None (inline checks) | Component-level `message.loading`, `message.error` | PT has no selector layer; components read raw message fields |
| **Store: displayMessageSelectors** | `slices/message/selectors/displayMessage.ts` | None | N/A | PT does not have display-layer parsing or assistantGroup concept |
| **Render: MessageItem** | `features/Conversation/Messages/index.tsx` | `MessageBubble` | `components/MessageBubble.tsx` | PT: single monolithic component (~1335 lines) handles all roles |
| **Render: AssistantMessage** | `Messages/Assistant/index.tsx` | Part of `MessageBubble` | `components/MessageBubble.tsx` | Not decomposed |
| **Render: UserMessage** | `Messages/User/index.tsx` | Part of `MessageBubble` | `components/MessageBubble.tsx` | Not decomposed |
| **Render: ToolMessage** | `Messages/Tool/` | Inline `isTool` branch | `components/MessageBubble.tsx` | Minimal; tool calls rendered inside assistant bubble |
| **Render: AssistantGroupMessage** | `Messages/AssistantGroup/` | None | N/A | PT has no multi-block assistant grouping |
| **Render: CompressedGroupMessage** | `Messages/CompressedGroup/` | None | N/A | PT has no context compression rendering |
| **Render: TaskMessage** | `Messages/Tasks/` | None | N/A | PT has no task-type messages |
| **ActionBar: MessageActionBar** | `Messages/components/MessageActionBar/index.tsx` | Inline MiniButtons + Dropdown | `components/MessageBubble.tsx` (~lines 1302-1332) | PT: hardcoded buttons, no slot/registry system |
| **ActionBar: Action Registry** | `MessageActionBar/useBuildActions.ts` (15 actions) | Menu items literal arrays | `components/MessageBubble.tsx` (~lines 869-895) | PT: static menu definition, no hook-per-action pattern |
| **Action: copy** | `actions/copy.ts` | `handleCopy` | `components/MessageBubble.tsx` | Equivalent |
| **Action: edit** | `actions/edit.ts` | `handleStartEdit` / `handleSaveEdit` | `components/MessageBubble.tsx` | Equivalent functionality |
| **Action: regenerate** | `actions/regenerate.ts` | `handleRegenerate` | `components/MessageBubble.tsx` | Equivalent |
| **Action: delAndRegenerate** | `actions/delAndRegenerate.ts` | `handleDelAndRegenerate` | `components/MessageBubble.tsx` | Equivalent |
| **Action: branching** | `actions/branching.ts` (thread creator) | `handleBranch` (conversation duplication) | `components/MessageBubble.tsx` | Different mechanism: LH uses threads; PT duplicates full session |
| **Action: translate** | `actions/translate.ts` | None | N/A | Missing |
| **Action: tts** | `actions/tts.ts` | None | N/A | Missing |
| **Action: share** | `actions/share.tsx` | None | N/A | Missing |
| **Action: collapse** | `actions/collapse.ts` | Local `collapsed` state | `components/MessageBubble.tsx` | PT: component-local; LH: persisted in message metadata |
| **Action: continueGeneration** | `actions/continueGeneration.ts` | None | N/A | Missing (group-only) |
| **Action: select** | `actions/select.ts` | None | N/A | Missing (multi-select for forward) |
| **Action: comments** | `actions/comments.ts` | None | N/A | Missing |
| **ChatList: VirtualizedList** | `ChatList/components/VirtualizedList.tsx` (virtua VList) | `<div ref={scrollRef}>` with auto-scroll effect | `pages/ChatPage.tsx` | PT: no virtualization; renders all messages into a scrollable div |
| **ChatList: AutoScroll** | `ChatList/components/AutoScroll/` | `useEffect` scrollTop = scrollHeight | `pages/ChatPage.tsx` | PT: naive scroll-to-bottom on every `messages` change |
| **ChatList: BackBottom** | `ChatList/components/BackBottom/` | None | N/A | Missing |
| **ChatList: scroll persistence** | `hooks/useTopicScrollPersist.ts` | None | N/A | Missing |
| **ChatList: spacer/pinning** | `hooks/useConversationScroll.ts` | None | N/A | Missing (viewport-based UX for new message pairs) |
| **Context: MessageActionProvider** | `Messages/Contexts/MessageActionProvider.tsx` | None | N/A | PT: no singleton action bar pattern |

---

## 4. Key Function Signatures

### 4.1 LobeHub Store Actions (Message CRUD)

```typescript
// Public API — src/store/chat/slices/message/actions/publicApi.ts
class MessagePublicApiActionImpl {
  addUserMessage(params: {
    message: string;
    fileList?: string[];
    metadata?: MessageMetadata;
  }): Promise<void>;

  addAIMessage(): Promise<void>;

  deleteMessage(id: string, context?: OptimisticUpdateContext): Promise<void>;
  deleteAssistantMessage(id: string, context?: OptimisticUpdateContext): Promise<void>;
  deleteToolMessage(id: string): Promise<void>;
  deleteDBMessage(id: string): Promise<void>;
  clearMessage(): Promise<void>;

  copyMessage(id: string, content: string): Promise<void>;
  toggleMessageEditing(id: string, editing: boolean): void;
  updateMessageInput(message: string): void;
  modifyMessageContent(id: string, content: string, context?: OptimisticUpdateContext): Promise<void>;
  toggleMessageCollapsed(id: string, collapsed?: boolean, context?: OptimisticUpdateContext): Promise<void>;
  toggleInspectExpanded(id: string, expanded?: boolean, context?: OptimisticUpdateContext): Promise<void>;
}

// Optimistic Update — src/store/chat/slices/message/actions/optimisticUpdate.ts
class MessageOptimisticUpdateActionImpl {
  optimisticCreateMessage(
    message: CreateMessageParams,
    context?: { groupMessageId?: string; operationId?: string; tempMessageId?: string },
  ): Promise<{ id: string; messages: UIChatMessage[] } | undefined>;

  optimisticCreateTmpMessage(message: CreateMessageParams, context?: OptimisticUpdateContext): string;
  optimisticDeleteMessage(id: string, context?: OptimisticUpdateContext): Promise<void>;
  optimisticDeleteMessages(ids: string[], context?: OptimisticUpdateContext): Promise<void>;

  optimisticUpdateMessageContent(
    id: string,
    content: string,
    extra?: {
      imageList?: ChatImageItem[];
      metadata?: MessageMetadata;
      model?: string;
      provider?: string;
      reasoning?: ModelReasoning;
      search?: GroundingSearch;
      tools?: ChatToolPayload[];
    },
    context?: OptimisticUpdateContext,
  ): Promise<void>;

  optimisticUpdateMessageError(id: string, error: ChatMessageError | null, context?: OptimisticUpdateContext): Promise<void>;
  optimisticUpdateMessageMetadata(id: string, metadata: Partial<MessageMetadata>, context?: OptimisticUpdateContext): Promise<void>;
  optimisticUpdateMessagePlugin(id: string, value: Partial<MessagePluginItem>, context?: OptimisticUpdateContext): Promise<void>;
  optimisticUpdateMessagePluginError(id: string, error: ChatMessagePluginError | null, context?: OptimisticUpdateContext): Promise<void>;
  optimisticUpdateMessageRAG(id: string, data: UpdateMessageRAGParams, context?: OptimisticUpdateContext): Promise<void>;
}

// Query — src/store/chat/slices/message/actions/query.ts
class MessageQueryActionImpl {
  revalidateMessages(context?: Partial<ConversationContext>): Promise<void>;
  useFetchMessages(context: ConversationContext, options?: object): SWRResponse;
  refreshMessages(): Promise<void>;
  replaceMessages(messages: UIChatMessage[], options?: { action?: string; context?: ConversationContext }): void;
  prefetchMessages(input: MessageMapKeyInput): Promise<void>;
}
```

### 4.2 LobeHub Reducer Dispatch Types

```typescript
// src/store/chat/slices/message/reducer.ts
type MessageDispatch =
  | { type: 'createMessage'; id: string; value: CreateMessageParams }
  | { type: 'updateMessage'; id: string; value: Partial<UIChatMessage> }
  | { type: 'updateMessages'; value: UIChatMessage[] }
  | { type: 'deleteMessage'; id: string }
  | { type: 'deleteMessages'; ids: string[] }
  | { type: 'updatePluginState'; id: string; key: string; value: any }
  | { type: 'replaceMessagePluginState'; id: string; value: any; metadata?: Partial<...> }
  | { type: 'updateMessageExtra'; id: string; key: string; value: any }
  | { type: 'updateMessageMetadata'; id: string; value: Partial<UIChatMessage['metadata']> }
  | { type: 'updateMessagePlugin'; id: string; value: Partial<MessagePluginItem> }
  | { type: 'updateMessageTools'; id: string; tool_call_id: string; value: Partial<ChatToolPayload> }
  | { type: 'addMessageTool'; id: string; value: ChatToolPayload }
  | { type: 'deleteMessageTool'; id: string; tool_call_id: string };
```

### 4.3 LobeHub Message State Selectors

```typescript
// src/store/chat/slices/message/selectors/messageState.ts
const messageStateSelectors = {
  isCreatingMessage: (s: ChatStoreState) => boolean;
  isInToolsCalling: (id: string, index: number) => (s: ChatStoreState) => boolean;
  isMessageCollapsed: (id: string) => (s: ChatStoreState) => boolean;
  isMessageContinuing: (id: string) => (s: ChatStoreState) => boolean;
  isMessageCreating: (id: string) => (s: ChatStoreState) => boolean;
  isMessageEditing: (id: string) => (s: ChatStoreState) => boolean;
  isMessageGenerating: (id: string) => (s: ChatStoreState) => boolean;
  isMessageInChatReasoning: (id: string) => (s: ChatStoreState) => boolean;
  isMessageLoading: (id: string) => (s: ChatStoreState) => boolean;
  isMessageRegenerating: (id: string) => (s: ChatStoreState) => boolean;
  isPluginApiInvoking: (id: string) => (s: ChatStoreState) => boolean;
  isToolApiNameShining: (messageId: string, index: number, toolCallId: string) => (s: ChatStoreState) => boolean;
  isToolCallStreaming: (id: string, index: number) => (s: ChatStoreState) => boolean;
};
```

### 4.4 LobeHub Action Bar Types

```typescript
// src/features/Conversation/Messages/components/MessageActionBar/types.ts
type MessageRole = 'user' | 'assistant' | 'group';

interface MessageActionContext {
  contentBlock?: AssistantContentBlock;
  data: UIChatMessage;
  id: string;
  role: MessageRole;
}

interface MessageActionDefinition {
  key: string;
  useBuild: (ctx: MessageActionContext) => MessageActionItem | null;
}

type MessageActionSlot = string; // 'copy' | 'edit' | 'divider' | ...

// MessageActionItem (from ../../../types)
interface MessageActionItem {
  key: string;
  icon: LucideIcon;
  label: string;
  handleClick?: () => void;
  disabled?: boolean;
  spin?: boolean;
  children?: MessageActionItem[];
  popupClassName?: string;
}
```

### 4.5 LobeHub ChatList Props

```typescript
// src/features/Conversation/ChatList/index.tsx
interface ChatListProps {
  defaultWorkflowExpandLevel?: WorkflowExpandLevelDefault;
  disableActionsBar?: boolean;
  footerSlot?: ReactNode;
  headerSlot?: ReactNode;
  itemContent?: (index: number, id: string) => ReactNode;
  showWelcome?: boolean;
  welcome?: ReactNode;
}
```

### 4.6 LobeHub MessageItem Props

```typescript
// src/features/Conversation/Messages/index.tsx
interface MessageItemProps {
  className?: string;
  defaultWorkflowExpandLevel?: WorkflowExpandLevelDefault;
  disableEditing?: boolean;
  enableHistoryDivider?: boolean;
  endRender?: ReactNode;
  footerRender?: ReactNode;
  id: string;
  index: number;
  inPortalThread?: boolean;
  isLatestItem?: boolean;
}
```

### 4.7 Peers-Touch Current Signatures

```typescript
// peers-ai-agent/apps/desktop/src/store/chat.ts
interface ChatState {
  sessions: Session[];
  currentSessionKey: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingStartedAt: number | null;
  operations: Record<string, ChatOperation>;
  sessionBuffers: Record<string, ChatMessage[]>;
  abortController: AbortController | null;
  wideScreen: boolean;

  // Actions
  loadSessions: () => Promise<void>;
  selectSession: (key: string, sessionOverride?: Session) => Promise<void>;
  sendMessage: (content: string, attachments?: ChatComposerAttachment[]) => void;
  regenerateMessage: (messageId: string) => void;
  retryMessage: (messageId: string) => void;
  deleteAndRegenerateMessage: (messageId: string) => void;
  branchFromMessage: (messageId: string) => Promise<void>;
  decideToolApproval: (approvalId: string, approved: boolean) => Promise<void>;
  stopStreaming: () => void;
  deleteMessage: (id: string) => Promise<void>;
  editMessage: (id: string, content: string) => Promise<void>;
  syncMessages: () => Promise<void>;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  contentType?: 'text' | 'card';
  images?: string[];
  attachments?: ChatComposerAttachment[];
  toolCalls?: ToolCallInfo[];
  delegationResults?: DelegationTaskInfo[];
  knowledgeChunks?: KnowledgeChunkInfo[];
  loading?: boolean;
  timestamp: number;
  model?: string;
  error?: string;
  errorDetail?: string;
  resolution?: ErrorResolutionAction | null;
  thinking?: string;
  thinkingDone?: boolean;
  processDuration?: number;
  operation?: 'regenerate' | 'retry' | 'branch';
  replacementOf?: string;
  replacedBy?: string;
}

// MessageBubble — peers-ai-agent/apps/desktop/src/components/MessageBubble.tsx
interface Props {
  message: ChatMessage;
  userAvatar?: { url?: string; name: string };
  onOpenArtifact?: (artifact: MessageArtifact) => void;
}
```

---

## 5. Gap Summary (Priority Order)

| # | Gap | Impact | Effort |
|---|---|---|---|
| 1 | No virtualization | Performance degradation at 100+ messages | High |
| 2 | Monolithic MessageBubble (1335 lines) | Unmaintainable; blocks parallel development | Medium |
| 3 | No selector layer | Excessive re-renders; no memoization boundaries | Medium |
| 4 | No reducer/dispatch pattern | Scattered mutations; hard to reason about state transitions | Medium |
| 5 | No display-message parsing (assistantGroup) | Cannot support multi-block responses | Medium |
| 6 | No slot-based action registry | Cannot extend/customize actions per context | Low |
| 7 | No auto-scroll sophistication | Jerky scroll on stream; no back-to-bottom | Low |
| 8 | Missing actions: translate, TTS, share, select, comments, continueGeneration | Feature gaps | Low-per-action |
| 9 | Collapse state is component-local (lost on remount) | UX regression | Low |
| 10 | No SWR-based message fetching | No cache invalidation strategy | Medium |
