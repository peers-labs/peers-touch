# MCP-02-DESKTOP-RUNTIME - Desktop-local MCP closure

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "agent-mcp-dual-runtime-20261003",
  "taskId": "MCP-02-DESKTOP-RUNTIME",
  "workstreamId": "MCP-DUAL-RUNTIME",
  "title": "Execute a Station-configured MCP tool inside Desktop Rust",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "MCP-desktop-runtime",
  "journeyId": "MCA-J04-DESKTOP",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent",
    "apps/station/app/subserver/agent",
    "apps/desktop",
    "docs/architecture/agent"
  ],
  "readSet": [
    "model/domain/agent",
    "apps/station/app/subserver/agent",
    "apps/desktop",
    "docs/architecture/agent/modern-chat-agent"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "desktop-mcp-source",
      "command": "pnpm --dir apps/desktop check && cd apps/desktop/src-tauri && cargo test application::mcp application::desktop_executor_worker",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "desktop-mcp-functional",
      "command": "cd apps/desktop/src-tauri && cargo test mcp -- --nocapture",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "desktop-mcp-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate desktop-check",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Desktop lists and mutates MCP Servers through Station-owned config APIs",
    "Desktop stores only client-owned secret material and process state",
    "Each Desktop-local MCP ToolCall is pinned CLIENT_CAPABILITY and uses the existing device-authenticated fenced receipt path",
    "Desktop-local stdio, HTTP, and SSE remain supported",
    "A Station-owned MCP Server never enters the Desktop executor queue"
  ],
  "failureBehavior": [
    "Reject missing or stale local secret refs before side effects",
    "Reject Station-owned capability IDs in the Desktop executor",
    "Do not retain a fallback Desktop MCP catalog",
    "Return the first deterministic Desktop failure"
  ],
  "updatedAt": "2026-10-03T02:30:00.000Z"
}
```

## Objective

Keep true device-local MCP in Desktop Rust while moving catalog and routing
truth to Station.

## Current Snapshot

- Desktop Rust already supports stdio, HTTP, and SSE plus fenced ToolCall
  receipts.
- Its encrypted MCP store currently combines catalog, secrets, operations, and
  process state and must be narrowed to executor-local state.
