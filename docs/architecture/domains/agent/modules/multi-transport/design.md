# M10: Multi-Transport Architecture — Design

> **Status**: S2 设计
> **Created**: 2026-08-14
> **Scope**: Abstract transport layer, enabling client-side vs server-side agent execution

---

## Problem Statement

Current architecture: single streaming transport (client SSE → Station → stream back).

LobeHub has 3 transport modes:
1. **ClientTransport** — LLM called from client, tools executed locally
2. **GatewayTransport** — LLM called from server, results streamed to client
3. **HeteroTransport** — Long-running server agent, client polls/subscribes for updates

Our Station already supports GatewayTransport semantics (turn/stream endpoint), but the frontend has no abstraction — it's hardcoded to one flow.

---

## Target Architecture

```
┌─────────────────────────────────────────────┐
│  AgentTransport (interface)                  │
├─────────────────────────────────────────────┤
│  send(message, config) → Observable<Event>  │
│  cancel(turnId) → void                      │
│  getCapabilities() → TransportCapabilities  │
└────────────┬──────────────┬─────────────────┘
             │              │
    ┌────────▼───────┐  ┌──▼──────────────────┐
    │ StreamTransport │  │ BackgroundTransport  │
    │ (current impl) │  │ (server-managed)     │
    └────────────────┘  └──────────────────────┘
```

### StreamTransport (current, refactored)
- Client sends message → Station streams SSE events back in real-time
- Client-side tool execution via local tool broker
- Current default for all agents

### BackgroundTransport (new)
- Client sends message → Station acknowledges and executes autonomously
- Client subscribes to event bus for progress updates
- Station manages full turn lifecycle (including retries, tool calls)
- Client can disconnect and reconnect without losing progress
- Suitable for: long-running tasks, multi-step agent workflows, batch operations

---

## Interface Definition

```typescript
// src/store/streaming/transport.ts

interface TransportCapabilities {
  supportsStreaming: boolean;
  supportsBackground: boolean;
  supportsCancel: boolean;
  supportsResume: boolean;
}

interface AgentTransport {
  readonly name: string;
  readonly capabilities: TransportCapabilities;
  
  send(params: TransportSendParams): TransportSubscription;
  cancel(turnId: string): Promise<void>;
  resume?(turnId: string): TransportSubscription;
}

interface TransportSendParams {
  sessionKey: string;
  agentId: string;
  message: string;
  attachments?: ChatAttachmentInput[];
  mentionedAgentIds?: string[];
  config?: { model?: string; temperature?: number };
}

interface TransportSubscription {
  turnId: string;
  events: AsyncIterable<AgentTurnStreamEvent>;
  abort: () => void;
}
```

---

## Implementation Plan

### Phase 1: Extract StreamTransport (refactor)
- Extract current streaming logic from `chat.ts` sendMessage into `StreamTransport` class
- StreamTransport implements `AgentTransport` interface
- `chat.ts` sendMessage delegates to transport
- Zero behavior change, pure refactor

### Phase 2: Transport Registry
- `src/store/streaming/transportRegistry.ts`
- Maps agent config → transport selection
- Default: StreamTransport for all agents
- Agent config gets new field: `transportMode: 'stream' | 'background'`

### Phase 3: BackgroundTransport
- New transport that calls `/agent/turn/execute` (non-streaming) + subscribes to event bus
- Uses existing `/agent/events/subscribe` SSE endpoint for progress
- Handles reconnection: on connect, fetches missed events
- Suitable for orchestration tasks

### Phase 4: Agent Config UI
- Add transport mode selector in Agent Profile → Advanced settings
- "Streaming" (default) vs "Background" mode
- Background mode shows different UI: progress bar instead of token-by-token streaming

---

## Station Dependencies

Already available:
- `/agent/turn/execute` — synchronous turn execution
- `/agent/events/subscribe` — SSE event stream
- `/agent/collaboration/*` — task-based execution

No new Station work needed for Phase 1-2. Phase 3 may need a `/agent/turn/execute-async` endpoint.

---

## Execution Order

| Phase | Scope | Risk | Effort |
|-------|-------|------|--------|
| 1 | Extract StreamTransport | Low (refactor) | 1 session |
| 2 | Transport Registry | Low | 0.5 session |
| 3 | BackgroundTransport | Medium (new behavior) | 1-2 sessions |
| 4 | Config UI | Low | 0.5 session |

Total: ~3-4 sessions for full implementation.

---

## Decision: Defer to Next Batch

M10 is an architecture refactor with medium risk. The current StreamTransport works correctly for all use cases. BackgroundTransport is a "nice to have" for power users running long tasks.

**Recommendation**: Mark M10 as P5 material. Current P4 is complete without it.
