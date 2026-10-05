# P1-M1: Tool Execution Runtime — Peers Design (S2)

> **Module**: P1-M1 Tool Execution Runtime
> **Step**: S2 — Peers Design
> **Status**: superseded by `docs/architecture/domains/agent/modern-chat-agent/`
> **Depends on**: P0 streaming runtime (tool_call/tool_result events already flow)
> **Historical note**: `local_tool_request`, Web approval/execution, and
> `/turn/local-tool-result` were deleted by MCA-D19 G1-E. Do not implement this
> draft as current architecture.

---

## 1. Scope

This module delivers:
- Desktop client handles `local_tool_request` events from Station's turn stream
- Client-side tool executor registry (file read, list dir, clipboard, etc.)
- Tool approval UI (auto-approve / ask-user / deny per tool)
- Tool execution → result submission back to Station (closing the loop)
- Tool call rendering improvements (progress, arguments, result display)

Out of scope (deferred to P1-M2 MCP):
- MCP server management (install, configure, connect)
- External tool discovery
- Custom plugin development

---

## 2. Architecture Overview

```
Station (turn_service.go)
    │ LLM response contains tool_calls
    │ processToolCalls() dispatches:
    │   ├── Server tool → toolRegistry.Dispatch() → inline result
    │   └── Local tool  → emit "local_tool_request" SSE event
    │                      └── localToolBroker.Await() (120s timeout)
    ▼
Desktop Client (streaming handler)
    │ receives "local_tool_request" event
    │ routes to ToolExecutionService
    ▼
store/tool/
    ├── types.ts             ← ToolDefinition, ToolExecutor, ToolResult, ToolApprovalPolicy
    ├── registry.ts          ← ToolExecutorRegistry (Map<name, ToolExecutor>)
    ├── executors/           ← built-in executor implementations
    │   ├── file-read.ts
    │   ├── list-dir.ts
    │   ├── clipboard.ts
    │   ├── shell.ts         (P1 stretch — gated by approval)
    │   └── oauth-resource.ts
    ├── approval.ts          ← ToolApprovalService (auto/ask/deny per tool)
    └── index.ts             ← store (Zustand) managing pending tools, results, history

components/messages/ToolCallCard.tsx  ← enhanced: shows approval prompt, progress, result
```

---

## 3. Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Client-side executor registry (same as LobeHub) | Tools like file-read/list-dir must run on the user's machine. Station cannot access the local filesystem. |
| D2 | Approval policy is per-tool, persisted in agent config | Matches LobeHub's `humanIntervention` pattern. Safe defaults: file-read=auto, shell=ask. |
| D3 | Structured result contract `{ content: string; isError: boolean }` | Matches Station's `ToolResult` struct and LobeHub's pattern. Never throw. |
| D4 | 120s timeout aligns with Station's `localToolTimeout` | If client doesn't respond in 120s, Station fails the tool call. |
| D5 | Executor invoked via Tauri command, not in renderer JS | File operations should use Rust-backed commands for safety and performance. |
| D6 | Tool history stored in message (existing `toolCalls[]` on ChatMessage) | No separate tool history store needed — results are part of the conversation. |

---

## 4. Types

```typescript
// store/tool/types.ts

interface ToolDefinition {
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>; // JSON Schema
  approvalPolicy: ToolApprovalPolicy;
}

type ToolApprovalPolicy = 'auto' | 'ask' | 'deny';

interface ToolExecutionRequest {
  turnId: string;
  callId: string;
  toolName: string;
  arguments: string; // JSON string
  agentId: string;
  conversationId: string;
}

interface ToolExecutionResult {
  turnId: string;
  callId: string;
  content: string;
  isError: boolean;
}

interface ToolExecutor {
  name: string;
  execute(args: Record<string, unknown>, meta: ToolExecutionRequest): Promise<ToolExecutionResult>;
}
```

---

## 5. Flow

### 5.1 Happy Path (auto-approve)

1. Station LLM → tool_call → `processToolCalls` → local tool → emit `local_tool_request` SSE
2. Desktop `reduceStreamEvent` receives event, extracts `{ turnId, callId, toolName, arguments }`
3. Chat store dispatches to `ToolExecutionService.handleRequest(request)`
4. Service looks up `ToolExecutorRegistry.get(toolName)`
5. Checks approval policy → `auto` → proceeds
6. Calls `executor.execute(parsedArgs, meta)`
7. Executor invokes Tauri command (e.g., `agent_local_tool_file_read`)
8. Result returned → service calls `api.resolveAgentLocalToolRequest({ turnId, callId, content, isError })`
9. Station receives result → `localToolBroker.Submit()` → turn continues
10. Stream continues with LLM seeing the tool result

### 5.2 Approval Required

1. Steps 1-4 same as above
2. Policy is `ask` → service sets `pendingApproval` state on the operation
3. UI renders approval prompt in `ToolCallCard` (tool name, arguments preview, approve/deny buttons)
4. User clicks approve → executor runs → steps 7-10
5. User clicks deny → service submits `{ content: "Tool execution denied by user", isError: true }`
6. Stream continues with LLM seeing denial

### 5.3 Timeout

1. If user doesn't respond within 110s (slightly below Station's 120s), auto-deny with timeout message

---

## 6. Integration Points

### 6.1 Streaming Handler Update

```typescript
// In reduceStreamEvent (handler.ts), add case:
case 'local_tool_request': {
  // Don't mutate the message directly — dispatch to tool service
  // Return msg unchanged; tool execution is async side-effect
  return msg;
}
```

The actual handling happens in `chat.ts` where the stream event loop runs:
```typescript
if (event.event === 'local_tool_request') {
  toolExecutionService.handleRequest({
    turnId: String(event.data.turnId),
    callId: String(event.data.callId),
    toolName: String(event.data.toolName),
    arguments: String(event.data.arguments),
    agentId,
    conversationId: sessionKey,
  });
}
```

### 6.2 Tauri Commands (Rust BFF)

New commands needed in `src-tauri/`:
- `agent_local_tool_file_read` — Read file content
- `agent_local_tool_list_dir` — List directory
- `agent_local_tool_shell_exec` — Execute shell command (requires approval)
- `agent_local_tool_clipboard` — Read/write clipboard

These delegate to Rust implementations with sandboxing (approved workspace only).

### 6.3 Tool Registry Config

Tool definitions and approval policies stored in agent config:
```json
{
  "tools": {
    "file_read": { "enabled": true, "approval": "auto" },
    "list_dir": { "enabled": true, "approval": "auto" },
    "shell": { "enabled": true, "approval": "ask" },
    "clipboard": { "enabled": true, "approval": "ask" }
  }
}
```

---

## 7. Files to Create/Modify

| File | Change |
|------|--------|
| `apps/desktop/src/store/tool/types.ts` | **New** — Type definitions |
| `apps/desktop/src/store/tool/registry.ts` | **New** — Executor registry |
| `apps/desktop/src/store/tool/approval.ts` | **New** — Approval service |
| `apps/desktop/src/store/tool/executors/file-read.ts` | **New** — File read executor |
| `apps/desktop/src/store/tool/executors/list-dir.ts` | **New** — Directory list executor |
| `apps/desktop/src/store/tool/executors/clipboard.ts` | **New** — Clipboard executor |
| `apps/desktop/src/store/tool/executors/oauth-resource.ts` | **New** — OAuth resource executor |
| `apps/desktop/src/store/tool/index.ts` | **New** — Tool store |
| `apps/desktop/src/store/chat.ts` | **Modify** — Handle local_tool_request in stream loop |
| `apps/desktop/src/store/streaming/handler.ts` | **Modify** — Add local_tool_request to reduceStreamEvent |
| `apps/desktop/src/components/messages/ToolCallCard.tsx` | **Modify** — Add approval prompt UI |
| `apps/desktop/src/services/desktop_api.ts` | **Verify** — resolveAgentLocalToolRequest already exists |

---

## 8. What Does NOT Change

- Station `turn_service.go` — already handles the full loop
- Station `local_tool_broker.go` — already awaits/submits
- Station `tool_registry_service.go` — already registers built-in tools
- The streaming event protocol — `local_tool_request` event type already defined
- `ToolCallCard.tsx` public interface — enhance, don't break
