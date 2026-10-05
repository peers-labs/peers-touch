# Streaming Runtime — Peers-Touch Architecture Design

> **Module**: P0-M1 Streaming Runtime
> **Step**: S2 — Peers Design
> **Status**: superseded by `docs/architecture/domains/agent/modern-chat-agent/`
> **Depends on**: reference-analysis.md (S1 complete)
> **ADR compliance**: ADR-1 (Station is sole executor)
> **Historical note**: the `local_tool_request` bridge and Rust approval waiter
> were deleted by MCA-D19 G1-E. Current client execution uses Station-issued
> fenced capability envelopes.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           STATION (Go)                                       │
│                                                                             │
│  HandleExecuteTurn ──► AgentLoop ──► LLM Provider / CLI                    │
│       │                    │                                                │
│       │                    ├── tool_call ──► local_tool_request (SSE)       │
│       │                    ├── text_delta (SSE)                              │
│       │                    ├── thinking (SSE)                                │
│       │                    ├── progress (SSE)                                │
│       │                    └── done / error (SSE)                            │
│       │                                                                     │
│       ▼                                                                     │
│  SSE Response Stream (/sub-agent/agent/turn/stream)                         │
└─────────────────────────────────────────────────────────────────────────────┘
        │ HTTP SSE
        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     RUST BFF (Tauri, Desktop)                                │
│                                                                             │
│  agent_execute_turn_stream()                                                │
│       │                                                                     │
│       ├── parse_sse_frame() → (event_type, data)                           │
│       ├── handle local_tool_request (approval + execution)                  │
│       ├── emit_turn_stream_event() → Tauri event bus                        │
│       └── cancel via AtomicBool registry                                    │
│                                                                             │
│  Responsibilities: SSE transport, tool approval mutex, error resolution     │
└─────────────────────────────────────────────────────────────────────────────┘
        │ Tauri Event: "agent:turn-stream-event"
        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     TYPESCRIPT LAYER (React + Zustand)                       │
│                                                                             │
│  ┌──────────────────┐   ┌───────────────────┐   ┌───────────────────────┐  │
│  │  Operation Store │   │ StreamingHandler   │   │   Run Lifecycle       │  │
│  │                  │   │                    │   │                       │  │
│  │ tracks in-flight │   │ accumulates chunks │   │ state machine for     │  │
│  │ ops with abort   │   │ into renderable    │   │ turn progression      │  │
│  │ + typed status   │   │ message state      │   │                       │  │
│  └────────┬─────────┘   └────────┬───────────┘   └───────────┬───────────┘  │
│           │                      │                            │              │
│           └──────────────────────┼────────────────────────────┘              │
│                                  ▼                                            │
│                        useChatStore (Zustand)                                │
│                                  │                                            │
│                                  ▼                                            │
│                        React UI (messages, tool cards, thinking)             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Station is sole agent-loop executor | ADR-1; no client-side multi-step |
| D2 | SSE through Rust BFF (no WebSocket/gateway) | Self-hosted; Tauri event bus is natural bridge |
| D3 | Operation system lives in TS store | UI needs abort, status display; Rust only holds cancel flag |
| D4 | StreamingHandler is a pure function reducer | Easier to test; no side effects in accumulation |
| D5 | Run lifecycle is a finite state machine | Predictable transitions; every state has defined exit |
| D6 | All cross-layer event types defined as proto enums | Proto-first; `TurnEventType` already exists |

---

## 2. Event Protocol Definition

Station already defines `TurnEventType` in `model/domain/agent/agent.proto`. The streaming runtime requires expanding the event payload semantics for the TS layer.

### 2.1 Complete Event Type Set

The proto `TurnEventType` enum is the source of truth. The SSE `event:` field maps to these string names:

| SSE Event Name | Proto Enum | Payload Shape | Description |
|---|---|---|---|
| `text` | `TEXT_DELTA` | `{ content: string, model?: string }` | Incremental text chunk |
| `thinking` | (new) `THINKING` | `{ content: string, done?: boolean }` | Reasoning/CoT chunk |
| `tool_call` | `TOOL_CALL` | `{ id, name, args, server_name?, source? }` | Tool invocation started |
| `tool_result` | `TOOL_RESULT` | `{ id, name, content, is_error? }` | Tool execution result |
| `local_tool_request` | `LOCAL_TOOL_REQUEST` | `{ turnId, toolCallId, toolName, arguments, serverName, source }` | Station asks Desktop to run a local tool |
| `tool_approval_required` | `TOOL_APPROVAL_REQUIRED` | `{ approvalId, turnId, toolCallId, source, serverName, toolName, arguments }` | Human approval gate |
| `tool_approval_decision` | `TOOL_APPROVAL_DECISION` | `{ approvalId, approved, actor, decidedAt }` | Decision confirmed |
| `progress` | `PROGRESS` | `{ stage, message?, pct?, result? }` | Progress indicator (e.g. knowledge retrieval) |
| `image` | (new) `IMAGE` | `{ url }` | Inline image output |
| `conversation_created` | (new) `CONVERSATION_CREATED` | `{ conversation_id }` | Draft resolved to real conversation |
| `error` | `ERROR` | `{ error, detail?, resolution?, providerId? }` | Terminal or recoverable error |
| `done` | `DONE` | `{ model?, task_id? }` | Turn completed successfully |

### 2.2 Proto Extension (to be created in S3)

```protobuf
// model/domain/agent/turn_stream.proto (new file, S3)

enum TurnStreamEventType {
  TURN_STREAM_EVENT_UNSPECIFIED = 0;
  TURN_STREAM_EVENT_TEXT_DELTA = 1;
  TURN_STREAM_EVENT_THINKING = 2;
  TURN_STREAM_EVENT_TOOL_CALL = 3;
  TURN_STREAM_EVENT_TOOL_RESULT = 4;
  TURN_STREAM_EVENT_LOCAL_TOOL_REQUEST = 5;
  TURN_STREAM_EVENT_TOOL_APPROVAL_REQUIRED = 6;
  TURN_STREAM_EVENT_TOOL_APPROVAL_DECISION = 7;
  TURN_STREAM_EVENT_PROGRESS = 8;
  TURN_STREAM_EVENT_IMAGE = 9;
  TURN_STREAM_EVENT_CONVERSATION_CREATED = 10;
  TURN_STREAM_EVENT_ERROR = 11;
  TURN_STREAM_EVENT_DONE = 12;
}

message TurnStreamEvent {
  int64 seq = 1;
  string turn_id = 2;
  string conversation_id = 3;
  TurnStreamEventType type = 4;
  // Polymorphic payload — only the fields relevant to `type` are populated.
  string text = 5;             // TEXT_DELTA, THINKING
  bool done = 6;               // THINKING (thinking complete)
  string tool_call_id = 7;     // TOOL_CALL, TOOL_RESULT, LOCAL_TOOL_REQUEST, APPROVAL_*
  string tool_name = 8;        // TOOL_CALL, TOOL_RESULT, LOCAL_TOOL_REQUEST
  string arguments = 9;        // TOOL_CALL, LOCAL_TOOL_REQUEST (JSON string)
  string result = 10;          // TOOL_RESULT, PROGRESS (knowledge JSON)
  bool is_error = 11;          // TOOL_RESULT, ERROR
  string source = 12;          // TOOL_CALL source (mcp/builtin/plugin)
  string server_name = 13;     // TOOL_CALL, LOCAL_TOOL_REQUEST
  string approval_id = 14;     // APPROVAL_REQUIRED, APPROVAL_DECISION
  bool approved = 15;          // APPROVAL_DECISION
  string actor = 16;           // APPROVAL_DECISION
  string stage = 17;           // PROGRESS
  string message = 18;         // PROGRESS
  int32 pct = 19;              // PROGRESS (0-100)
  string image_url = 20;       // IMAGE
  string model = 21;           // DONE, TEXT_DELTA
  string error_detail = 22;    // ERROR
  string provider_id = 23;     // ERROR
  string task_id = 24;         // DONE
  google.protobuf.Timestamp created_at = 25;
}
```

---

## 3. Operation System Design

### 3.1 State Shape

```typescript
// store/streaming/types.ts

type OperationType =
  | 'sendMessage'
  | 'regenerate'
  | 'retry'
  | 'branch';

type OperationStatus =
  | 'running'
  | 'waiting_for_approval'
  | 'completed'
  | 'cancelled'
  | 'failed';

interface Operation {
  id: string;                    // unique per operation (session + timestamp)
  sessionKey: string;            // conversation this op belongs to
  type: OperationType;
  status: OperationStatus;
  assistantMessageId: string;    // the message being streamed into
  abortController: AbortController;
  startedAt: number;
  endedAt?: number;
  error?: OperationError;
  pendingApprovalId?: string;    // set when status === 'waiting_for_approval'
}

interface OperationError {
  message: string;
  detail?: string;
  resolution?: ErrorResolutionAction;
  providerId?: string;
}
```

### 3.2 Store Slice

```typescript
// Integrated into useChatStore or extracted as useOperationStore

interface OperationSlice {
  // State
  operations: Record<string, Operation>;  // keyed by sessionKey (one active per session)

  // Actions
  startOperation: (params: {
    sessionKey: string;
    type: OperationType;
    assistantMessageId: string;
    abortController: AbortController;
  }) => string; // returns operation id

  completeOperation: (sessionKey: string) => void;
  failOperation: (sessionKey: string, error: OperationError) => void;
  cancelOperation: (sessionKey: string) => void;
  parkOperation: (sessionKey: string, approvalId: string) => void;
  resumeOperation: (sessionKey: string) => void;

  // Selectors
  getActiveOperation: (sessionKey: string) => Operation | undefined;
  isOperationRunning: (sessionKey: string) => boolean;
  isWaitingForApproval: (sessionKey: string) => boolean;
}
```

### 3.3 Operation Lifecycle

```
startOperation()
    │
    ▼
 ┌────────┐
 │running │◄─── resumeOperation()
 └──┬──┬──┘         ▲
    │  │             │
    │  │  parkOperation(approvalId)
    │  │             │
    │  └────► ┌──────────────────────┐
    │         │waiting_for_approval  │
    │         └──────────────────────┘
    │
    ├── completeOperation() ──► completed (terminal)
    ├── cancelOperation()   ──► cancelled (terminal)
    └── failOperation()     ──► failed (terminal)
```

---

## 4. StreamingHandler Design

The StreamingHandler is a **pure reducer** that transforms `(currentMessage, streamEvent) → nextMessage`. This is already partially implemented as `applyStreamEvent()` in `chat.ts`.

### 4.1 Design Decision: Keep Reducer, Add Accumulator Wrapper

The existing `applyStreamEvent()` function is architecturally sound. The design formalizes it and adds a thin wrapper for lifecycle management.

```typescript
// store/streaming/handler.ts

interface StreamingAccumulator {
  // Immutable snapshot of accumulated state
  readonly content: string;
  readonly thinking: string;
  readonly thinkingDone: boolean;
  readonly toolCalls: ToolCallInfo[];
  readonly knowledgeChunks: KnowledgeChunkInfo[];
  readonly images: string[];
  readonly model: string;
  readonly error: OperationError | null;
  readonly isDone: boolean;
  readonly lastEventAt: number;
}

// Core reducer (already exists as applyStreamEvent, to be extracted)
function reduceStreamEvent(message: ChatMessage, event: TurnStreamEvent): ChatMessage;

// Accumulator factory for operation lifecycle
function createStreamingAccumulator(): StreamingAccumulator;
function accumulateEvent(acc: StreamingAccumulator, event: TurnStreamEvent): StreamingAccumulator;

// Terminal detection
function isTerminalEvent(event: TurnStreamEvent): boolean;
// Returns true for: done, error (non-recoverable)
```

### 4.2 Event-to-Message Mapping (expanded `applyStreamEvent`)

Current implementation already handles: `text`, `tool_call`, `tool_result`, `tool_approval_required`, `tool_approval_decision`, `image`, `thinking`, `progress`, `error`, `done`.

Additions needed:

| Event | Gap | Action |
|-------|-----|--------|
| `thinking` | Accumulates but no duration tracking | Add `thinkingStartedAt` to compute duration on `done` |
| `conversation_created` | Handled in `sendMessage` closure | Formalize as event handler in the reducer |
| Typing indicator | No throttle | Add configurable render throttle (16ms default) |

### 4.3 Render Throttle

Stream events arrive faster than React can re-render. The handler batches updates:

```typescript
interface StreamingHandlerOptions {
  throttleMs: number;           // default 16 (one frame)
  onMessageUpdate: (msg: ChatMessage) => void;
  onOperationStateChange: (status: OperationStatus) => void;
}
```

---

## 5. Run Lifecycle State Machine

### 5.1 States

```
                    ┌───────────┐
                    │   idle    │  (no active turn)
                    └─────┬─────┘
                          │ sendMessage / regenerate / retry
                          ▼
                    ┌───────────┐
         ┌─────────│ streaming │◄──────────────┐
         │         └──┬──┬──┬──┘               │
         │            │  │  │                  │
         │            │  │  │ tool_approval    │
         │            │  │  │ _required        │
         │            │  │  ▼                  │
         │            │  │ ┌──────────────┐    │
         │            │  │ │  approval    │    │
         │            │  │ │  _pending    │    │
         │            │  │ └───┬──────┬───┘    │
         │            │  │     │      │        │
         │            │  │  approve  deny      │
         │            │  │     │      │        │
         │            │  │     │      ▼        │
         │            │  │     │   ┌───────┐   │
         │            │  │     │   │denied │→ (Station continues with denial result)
         │            │  │     │   └───────┘   │
         │            │  │     └───────────────┘
         │            │  │
         │            │  │ tool_call + tool_result (Station loop, no approval needed)
         │            │  └─────────── (stays in streaming) ──────────┘
         │            │
         │            │ error event
         │            ▼
         │      ┌───────────┐
         │      │  failed   │ (terminal)
         │      └───────────┘
         │
         │ done event
         ▼
   ┌───────────┐
   │ completed │ (terminal)
   └───────────┘

   User cancels at any non-terminal state:
       → cancelled (terminal)
```

### 5.2 State Definition

```typescript
type RunState =
  | 'idle'
  | 'streaming'
  | 'approval_pending'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface RunLifecycle {
  state: RunState;
  turnId?: string;
  conversationId: string;
  pendingApproval?: {
    approvalId: string;
    toolName: string;
    serverName: string;
    arguments: string;
  };
}
```

### 5.3 Transition Table

| From | Event/Action | To | Side Effects |
|------|---|---|---|
| `idle` | `startOperation()` | `streaming` | Create operation, optimistic messages |
| `streaming` | `text` / `thinking` / `tool_call` / `tool_result` / `progress` | `streaming` | Accumulate into message |
| `streaming` | `tool_approval_required` | `approval_pending` | Park operation, show approval UI |
| `streaming` | `done` | `completed` | Complete operation, sync messages |
| `streaming` | `error` | `failed` | Fail operation, show error |
| `streaming` | user cancel | `cancelled` | Abort controller, stop chat API |
| `approval_pending` | user approves | `streaming` | Resume operation, send decision to Rust |
| `approval_pending` | user denies | `streaming` | Send denial, Station continues with denial result |
| `approval_pending` | user cancel | `cancelled` | Abort, stop chat |
| `approval_pending` | timeout (300s) | `failed` | Fail with timeout error |
| `completed` | — | `idle` | (automatic on next sendMessage) |
| `failed` | — | `idle` | (automatic on next sendMessage) |
| `cancelled` | — | `idle` | (automatic on next sendMessage) |

### 5.4 Hooks (called by state transitions)

```typescript
interface RunLifecycleHooks {
  onRunStarted: (context: { sessionKey: string; operationType: OperationType }) => void;
  onRunStreaming: (event: TurnStreamEvent) => void;
  onApprovalRequired: (approval: PendingApproval) => void;
  onApprovalDecided: (approvalId: string, approved: boolean) => void;
  onRunCompleted: (context: { sessionKey: string; taskId?: string }) => void;
  onRunFailed: (context: { sessionKey: string; error: OperationError }) => void;
  onRunCancelled: (context: { sessionKey: string }) => void;
}
```

---

## 6. Integration Plan

### 6.1 Files That Change

| File | Change Type | Description |
|------|---|---|
| `model/domain/agent/agent.proto` | Extend | Add `TURN_EVENT_TYPE_THINKING`, `TURN_EVENT_TYPE_IMAGE`, `TURN_EVENT_TYPE_CONVERSATION_CREATED` to existing enum |
| `model/domain/agent/turn_stream.proto` | **New** | Full `TurnStreamEvent` message for cross-layer contract |
| `apps/desktop/src/store/chat.ts` | Refactor | Extract operation logic, integrate with StreamingHandler |
| `apps/desktop/src/store/streaming/types.ts` | **New** | Operation, RunState, TurnStreamEvent TS types |
| `apps/desktop/src/store/streaming/handler.ts` | **New** | `reduceStreamEvent()` extracted + `StreamingAccumulator` |
| `apps/desktop/src/store/streaming/operations.ts` | **New** | Operation lifecycle actions |
| `apps/desktop/src/store/streaming/index.ts` | **New** | Barrel export |
| `apps/desktop/src-tauri/src/application/agent_turn/mod.rs` | Minor | No structural change needed; already emits all event types correctly |

### 6.2 Migration Strategy

The refactor is **internal restructuring** — no API changes, no proto wire format changes, no Station changes in S3.

1. **Extract** `applyStreamEvent()` into `store/streaming/handler.ts` (pure move)
2. **Extract** `ChatOperation` + operation helpers into `store/streaming/operations.ts`
3. **Introduce** typed `TurnStreamEvent` interface replacing `StreamEvent { event: string; data: Record<string, unknown> }`
4. **Wire** the new typed handler back into `useChatStore.sendMessage()` / `regenerateMessage()` / `retryMessage()`
5. **Add** run lifecycle state to operation (replaces ad-hoc `isStreaming` boolean)

### 6.3 What Does NOT Change

- Station SSE endpoint (already emits all needed events)
- Rust BFF streaming logic (already correctly forwards all events)
- Rust tool approval mechanism (already works)
- UI components (consume the same `ChatMessage` shape)

---

## 7. Component Ownership Table

| Component | Owner Layer | Responsibility | Source of Truth |
|---|---|---|---|
| Agent loop (multi-step) | Station (Go) | Execute turn, call LLM, orchestrate tools | Station subserver |
| SSE event emission | Station (Go) | Serialize `TurnStreamEvent` as SSE frames | Station handler |
| SSE transport + parse | Rust BFF | HTTP SSE client, frame parsing, Tauri event emission | `agent_turn/mod.rs` |
| Local tool execution | Rust BFF | MCP/builtin/plugin tool calls on Desktop | `agent_turn/mod.rs` + `mcp.rs` + `tools.rs` |
| Tool approval gate | Rust BFF | Condvar wait, timeout, decision forwarding | `agent_turn/mod.rs` |
| Cancel mechanism | Rust BFF | `AtomicBool` registry, abort SSE read loop | `agent_turn/mod.rs` |
| Operation tracking | TS Store | Operation lifecycle, abort controller, status | `store/streaming/operations.ts` |
| Event accumulation | TS Store | Reduce events into `ChatMessage` | `store/streaming/handler.ts` |
| Run lifecycle FSM | TS Store | State machine transitions + hooks | `store/streaming/operations.ts` |
| Message persistence | TS Store + Cache | Optimistic messages, server sync, merge | `store/chat.ts` + `agentChatCache` |
| UI rendering | React components | Render `ChatMessage[]` from store | `components/` |
| Proto definitions | `model/domain/agent/` | Cross-layer event contract | `agent.proto` / `turn_stream.proto` |

---

## 8. Error Design

### 8.1 Error Categories

| Category | Source | Handling |
|---|---|---|
| Transport error | Rust BFF (HTTP failure, timeout) | `emit_resolved_error()` → TS `failOperation()` |
| Provider error | Station (LLM auth, rate limit, context overflow) | Station emits `error` event with classified reason |
| Tool execution error | Rust BFF (MCP/builtin failure) | Tool result with `is_error: true` — Station decides next step |
| Tool approval timeout | Rust BFF (300s condvar timeout) | Submitted as error result to Station |
| User cancel | TS → Rust (abort flag) | `cancelOperation()` → finalize messages |
| Stream corruption | Rust BFF (malformed SSE) | Log + skip frame, continue |

### 8.2 Error Resolution Actions

Already implemented in `error_resolver.rs`. The TS layer receives structured `ErrorResolutionAction`:

```typescript
interface ErrorResolutionAction {
  type: 'reauthCli' | 'openProviderSettings' | 'checkConnection';
  cliId?: string;
  providerId?: string;
  label: string;  // i18n key
}
```

### 8.3 Error State Recovery

- After `failed`: user can `retryMessage()` or `regenerateMessage()` — starts new operation
- After `cancelled`: same recovery path
- `approval_pending` timeout: Station gets error result, may continue with fallback or terminate turn

---

## 9. Sequence Diagrams

### 9.1 Happy Path: Send Message

```
User          TS Store           Rust BFF            Station
 │               │                  │                   │
 │ sendMessage() │                  │                   │
 │──────────────►│                  │                   │
 │               │ startOperation() │                   │
 │               │ optimistic msgs  │                   │
 │               │                  │                   │
 │               │ streamAgentTurn()│                   │
 │               │─────────────────►│                   │
 │               │                  │ POST /turn/stream │
 │               │                  │──────────────────►│
 │               │                  │                   │ (agent loop)
 │               │                  │◄──── SSE: text    │
 │               │◄── tauri event ──│                   │
 │               │ reduceStreamEvent│                   │
 │               │                  │◄──── SSE: done    │
 │               │◄── tauri event ──│                   │
 │               │ completeOp()     │                   │
 │               │ syncMessages()   │                   │
 │◄──────────────│                  │                   │
```

### 9.2 Tool Approval Flow

```
Station          Rust BFF              TS Store              User
 │                  │                     │                    │
 │ SSE: local_tool  │                     │                    │
 │  _request        │                     │                    │
 │─────────────────►│                     │                    │
 │                  │ emit approval_req   │                    │
 │                  │────────────────────►│                    │
 │                  │                     │ parkOperation()    │
 │                  │                     │ show approval UI   │
 │                  │                     │───────────────────►│
 │                  │                     │                    │
 │                  │                     │◄── approve/deny ───│
 │                  │                     │ resumeOperation()  │
 │                  │◄── decide_approval──│                    │
 │                  │ condvar.notify()    │                    │
 │                  │                     │                    │
 │                  │ (if approved)       │                    │
 │                  │ execute MCP tool    │                    │
 │                  │                     │                    │
 │◄── POST result ──│                     │                    │
 │ (continue loop)  │                     │                    │
```

---

## 10. Future Considerations (Not In Scope)

- **Multi-turn streaming** (Station streams multiple LLM calls in one turn) — already supported by the event protocol; the FSM stays in `streaming` across tool iterations.
- **Resumable streams** (reconnect after disconnect) — requires `TurnEvent.seq` cursor; Station already has `StreamConversationEventsRequest`. Not needed for v1.
- **Parallel operations** (multiple sessions streaming simultaneously) — already supported by the `operations: Record<string, Operation>` keyed by sessionKey.
