# Streaming Runtime — Reference Implementation Analysis

> **Module**: P0-M1 Streaming Runtime
> **Reference**: LobeHub (`external/lobehub/src/store/chat/slices/agentRun/`, `src/store/chat/agents/`, `src/services/agentRuntime/`)
> **Step**: S1
> **Status**: complete

---

## 1. Data Flow Diagram

### Complete Message Lifecycle: User Input → Streaming Response → Rendered

```
User Input (ChatInput component)
    │
    ▼
[1] ConversationLifecycleActionImpl.sendMessage()
    File: store/chat/slices/agentRun/actions/entries/conversationLifecycle.ts
    │
    ├─ selectRuntimeType() → determines 'client' | 'gateway' | 'hetero'
    │   File: store/chat/slices/agentRun/actions/dispatch/agentDispatcher.ts
    │
    ├─ startOperation({ type: 'sendMessage', ... })
    │   Creates AbortController + operationId
    │
    ├─ optimisticCreateTmpMessage() × 2 (user + assistant placeholder)
    │
    ├─ aiChatService.sendMessageInServer() → persists to DB, returns real message IDs
    │
    └─ Dispatches to one of three runtime branches:
         │
         ├── BRANCH A: runtimeType === 'client'
         │   ▼
         │   [2] StreamingExecutorActionImpl.executeClientAgent()
         │       File: store/chat/slices/agentRun/actions/transports/client/streamingExecutor.ts
         │       │
         │       ├─ internal_createAgentState() → resolves agent config, tools, intervention
         │       ├─ new GeneralChatAgent → new AgentRuntime(agent, { executors })
         │       ├─ createClientRuntimeExecutors() → buildClientRuntimeHost()
         │       │   Returns AgentRuntimeHost with transports:
         │       │     ├── ClientLLMTransport      (calls chatService.createAssistantMessage)
         │       │     ├── ClientMessageTransport  (CRUD messages in store)
         │       │     ├── ClientToolTransport     (tool execution dispatch)
         │       │     ├── ClientSubAgentTransport (sub-agent orchestration)
         │       │     ├── ClientCompressionTransport (context window management)
         │       │     ├── ClientContextBuilder    (system prompt + context assembly)
         │       │     └── ClientRuntimeStreamSink (event publishing to store)
         │       │
         │       └─ LOOP: while (state.status !== 'done' && state.status !== 'error')
         │           ├─ runtime.step(state, nextContext)
         │           ├─ ClientLLMTransport.callLLM() → HTTP SSE to /webapi/chat/[provider]
         │           ├─ StreamingHandler.handleChunk(chunk) per SSE event
         │           │   Accumulates: output, thinkingContent, contentParts, tools
         │           │   Fires: onContentUpdate, onReasoningUpdate, onToolCallsUpdate
         │           └─ StreamingHandler.handleFinish() → StreamingResult
         │
         ├── BRANCH B: runtimeType === 'gateway'
         │   ▼
         │   [2b] executeGatewayAgent() → WebSocket to cloud agent gateway
         │        Receives AgentStreamEvent, routes via createGatewayEventRouter()
         │
         └── BRANCH C: runtimeType === 'hetero'
             ▼
             [2c] executeHeterogeneousAgent() → Desktop IPC to external CLI
```

### Callback Chain: Stream → Store → UI

```
StreamingHandler callbacks
    ├── onContentUpdate(content, reasoning) → store.internal_dispatchMessage('updateMessage')
    ├── onReasoningUpdate(reasoning)        → store.internal_dispatchMessage('updateMessageReasoning')
    ├── onToolCallsUpdate(tools)            → store.internal_dispatchMessage('updateMessage')
    └── toggleToolCallingStreaming(id, arr)  → streamingStates.internal_toggleToolCallingStreaming()
         │
         ▼
    Zustand store mutation → React re-render
```

---

## 2. State Machine

### Operation Status

```
              ┌──────────┐
              │ pending  │
              └────┬─────┘
                   │ startOperation()
                   ▼
            ┌──────────┐
     ┌──────│ running  │──────────────────┐
     │      └────┬─────┘                  │
     │           │                        │
cancelOperation  │ completeOperation  failOperation
     │           │                        │
     ▼           ▼                        ▼
┌───────────┐ ┌───────────┐        ┌──────────┐
│ cancelled │ │ completed │        │  failed  │
└───────────┘ └───────────┘        └──────────┘
```

### Agent Runtime Status (runtime loop)

```
  ┌──────┐
  │ init │
  └──┬───┘
     │ first step()
     ▼
 ┌────────────┐
 │  running   │◄─────────────────────────────────┐
 └──┬───┬──┬──┘                                  │
    │   │  │                                     │
    │   │  └── 'human_approve_required'          │
    │   │          ▼                             │
    │   │    ┌─────────────────────┐             │
    │   │    │ waiting_for_human   │             │
    │   │    └──────────┬──────────┘             │
    │   │               │ user approves/rejects  │
    │   │               └────────────────────────┘
    │   │
    │   └── 'waiting_for_async_tool'
    │           ▼
    │     ┌─────────────────────────┐
    │     │ waiting_for_async_tool  │
    │     └──────────┬──────────────┘
    │                │ tool result arrives
    │                └───────────────────────────┘
    │
    ├── cancelled → interrupted (terminal)
    ├── error event → error (terminal)
    └── done event → done (terminal)
```

### Stream Chunk Types

| Type | Payload | UI Effect |
|------|---------|-----------|
| `text` | `{ text }` | Accumulates output, fires content callback |
| `reasoning` | `{ text }` | Accumulates thinking, fires reasoning callback |
| `reasoning_part` | `{ content, mimeType, partType }` | Multimodal reasoning |
| `content_part` | `{ content, mimeType, partType }` | Multimodal content |
| `tool_calls` | `{ tool_calls[], isAnimationActives? }` | Shows tool call cards |
| `grounding` | `{ grounding? }` | Shows search sources |
| `base64_image` | `{ image, images }` | Inline image display |
| `stop` | `{}` | Ends reasoning timer |

### User Actions → State Transitions

| Action | Function | Effect |
|--------|----------|--------|
| Send message | `sendMessage()` | → operation running → runtime init |
| Stop generation | `stopGenerateMessage()` | → operation cancelled → runtime interrupted |
| Approve tool | `approveToolCalling()` | waiting_for_human → new operation running |
| Reject tool | `rejectToolCalling()` | waiting_for_human → complete |
| Reject + continue | `rejectAndContinueToolCalling()` | waiting_for_human → new operation running |
| Submit interaction | `submitToolInteraction()` | waiting_for_human → new operation running |
| Skip interaction | `skipToolInteraction()` | waiting_for_human → new operation running |
| Cancel send | `cancelSendMessageInServer()` | operation cancelled, editor restored |

---

## 3. Architecture Mapping Table

| LobeHub Component | Role | Peers-Touch Equivalent | Status | Divergence Rationale |
|---|---|---|---|---|
| `ConversationLifecycleActionImpl` | sendMessage orchestration, topic auto-create, runtime dispatch | `useChatStore.sendTurn()` in `store/chat.ts` | Partial — simpler, no operation system | |
| `ConversationControlActionImpl` | Stop, cancel, approve/reject tool calls | `useChatStore` cancel/approval methods | Partial | |
| `StreamingExecutorActionImpl` | Client-side agent runtime loop (multi-step) | `agent_execute_turn_stream()` in Rust BFF → Station SSE | **Architecture divergence** | Peers delegates multi-step to Station (ADR-1: Station is sole executor). No client-side loop. |
| `StreamingHandler` (class) | Stateful chunk accumulator (text, reasoning, tools, images) | `CollectedTurn` struct in `agent_turn/mod.rs` | Minimal — text only | Needs expansion for all chunk types |
| `AgentRuntime` + `GeneralChatAgent` | Multi-step agent loop with tool calling | Station `HandleExecuteTurn` endpoint | Server-side only | Station owns execution per ADR-1 |
| `ClientLLMTransport` | LLM streaming call + retry | Station SSE endpoint | Server-side | Station calls providers, not client |
| `ClientToolTransport` | Tool execution dispatch | Station tool execution | Server-side | |
| `ClientMessageTransport` | CRUD messages in store | `useChatStore` message state | Partial | |
| `ClientRuntimeStreamSink` | Runtime events → store | Tauri event `agent:turn-stream-event` | Exists | |
| `buildRunLifecycle()` | Transport-agnostic hooks (complete, park, resume) | **None** | **Needs to be built** | |
| `selectRuntimeType()` | Runtime selection: client/gateway/hetero | Implicit — always Station-proxied or CLI | **Needs formalization** | Peers has 2 modes: Station-direct and CLI-via-Station |
| Operation system | Unified async operation tracking | **None** — ad-hoc `loading` booleans | **Core gap** | |
| `StreamingContext` / `StreamingCallbacks` / `StreamingResult` types | Type contracts for streaming | Ad-hoc types in chat.ts | **Needs formalization** | |
| Gateway transport (WebSocket) | Cloud agent gateway | None (Peers uses Station-direct) | **Not needed** — architecture difference | Peers is self-hosted, no cloud gateway |
| Hetero transport (CLI IPC) | External CLI delegation | Rust BFF `stream_station_turn` with `cli_command` | Exists | Already routes CLI through Station |

---

## 4. Key Function Signatures

### Entry Points

```typescript
// LobeHub: conversationLifecycle.ts
interface SendMessageWithContextParams extends SendMessageParams {
  context: ConversationContext;
  inputEditor?: ChatInputEditor | null;
  onTopicCreated?: (topicId: string) => void | Promise<void>;
}

interface SendMessageResult {
  assistantMessageId: string;
  createdThreadId?: string;
  createdTopicId?: string;
  userMessageId: string;
}
```

### Runtime Dispatch

```typescript
// LobeHub: agentDispatcher.ts
type AgentRuntimeType = 'client' | 'gateway' | 'hetero';

function selectRuntimeType(ctx: RuntimeSelectionContext): AgentRuntimeType;

interface RuntimeSelectionContext {
  boundDeviceId?: string;
  executionTarget?: DeviceExecutionTarget;
  heterogeneousProvider?: HeterogeneousProviderConfig;
  isGatewayMode: boolean;
  isWorkspaceAgent?: boolean;
  parentRuntime?: AgentRuntimeType;
}
```

### StreamingHandler

```typescript
// LobeHub: StreamingHandler.ts
class StreamingHandler {
  constructor(context: StreamingContext, callbacks: StreamingCallbacks);
  handleChunk(chunk: StreamChunk): void;
  handleFinish(finishData: FinishData): Promise<StreamingResult>;
  getOutput(): string;
  getThinkingContent(): string;
  getThinkingDuration(): number | undefined;
  getIsFunctionCall(): boolean;
  getTools(): ChatToolPayload[] | undefined;
}

interface StreamingContext {
  agentId: string;
  groupId?: string;
  messageId: string;
  operationId?: string;
  topicId?: string | null;
}

interface StreamingCallbacks {
  onContentUpdate: (content: string, reasoning?: ReasoningState) => void;
  onGroundingUpdate: (grounding: GroundingData) => void;
  onReasoningUpdate: (reasoning: ReasoningState) => void;
  onToolCallsUpdate: (tools: ChatToolPayload[]) => void;
  toggleToolCallingStreaming: (messageId: string, isAnimationActives?: boolean[]) => void;
}

interface StreamingResult {
  content: string;
  isFunctionCall: boolean;
  metadata: { reasoning?: ReasoningState; search?: GroundingData; usage?: ModelUsage };
  toolCalls?: MessageToolCall[];
  traceId?: string;
}
```

### Operation System

```typescript
// LobeHub: operation/types.ts
type OperationType =
  | 'sendMessage' | 'createTopic' | 'regenerate' | 'continue'
  | 'execAgentRuntime' | 'callLLM' | 'reasoning'
  | 'toolCalling' | 'executeToolCall' | 'approveToolCalling'
  | 'contextCompression' | 'translate' | /* ... */;

type OperationStatus = 'pending' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';

interface Operation {
  id: string;
  type: OperationType;
  status: OperationStatus;
  metadata?: Record<string, unknown>;
  abortController: AbortController;
  parentOperationId?: string;
  createdAt: number;
}
```

### Run Lifecycle

```typescript
// LobeHub: lifecycle/types.ts
interface AgentRunLifecycle {
  afterRunComplete: (event: RunCompleteEvent) => Promise<void>;
  afterUserMessagePersisted: (event: UserMessagePersistedEvent) => Promise<void>;
  beforeRunComplete: (event: RunCompleteEvent) => Promise<void>;
  completeRun: (event: RunCompleteEvent) => Promise<RunCompleteResult>;
  onRunError: (event: RunErrorEvent) => Promise<void>;
  onRunParked: (event: RunParkedEvent) => Promise<void>;
  onRunResumed: (event: RunResumedEvent) => Promise<void>;
  onRunStarted: (event: RunStartedEvent) => Promise<void>;
}

type RunParkedReason = 'waiting_for_async_tool' | 'waiting_for_human';
type RunTerminalStatus = 'cancelled' | 'completed' | 'failed';
```

### Stream Events (Service Layer)

```typescript
// LobeHub: services/agentRuntime
interface StreamEvent {
  data?: any;
  operationId?: string;
  stepIndex?: number;
  timestamp: number;
  type: 'connected' | 'agent_runtime_init' | 'agent_runtime_end'
      | 'stream_start' | 'stream_chunk' | 'stream_end'
      | 'visible_output_end' | 'stream_retry'
      | 'step_start' | 'step_complete' | 'error' | 'heartbeat';
}
```

---

## 5. Key Architectural Insights

1. **Operation-centric state** — Every async action is a typed Operation with lifecycle. This is the single biggest gap vs Peers (which uses ad-hoc booleans).

2. **Three-runtime architecture** — Client (browser loop), Gateway (cloud WebSocket), Hetero (CLI IPC). Peers has Station-proxied + CLI-via-Station only.

3. **Client-side multi-step loop** — LobeHub runs `AgentRuntime.step()` in a while loop IN THE BROWSER. Peers delegates ALL multi-step logic to Station (ADR-1). This is a fundamental, intentional architecture divergence.

4. **Unified run lifecycle** — `buildRunLifecycle()` provides transport-agnostic hooks invoked by all runtimes. Peers has no equivalent.

5. **StreamingHandler as accumulator** — Stateful class handling all chunk types with throttled UI updates. Peers `CollectedTurn` is text-only.

6. **Parked state pattern** — Agent loop exits but operation stays alive when waiting for human input. A NEW operation resumes the same logical run. More sophisticated than Peers' synchronous tool_approval mutex.
