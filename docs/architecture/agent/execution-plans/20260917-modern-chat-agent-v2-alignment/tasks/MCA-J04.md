# MCA-J04 - MCP Product Lifecycle

## Task Slice

```json
{
  "schemaVersion": 1,
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-J04",
  "workstreamId": "MCA-J04",
  "title": "MCP install through governed invocation functional closure",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "V2-J04-functional",
  "journeyId": "V2-J04",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop",
    "apps/station/app/subserver/agent",
    "model/domain/agent",
    "packages/locales",
    "tooling/acceptance",
    "docs/architecture/agent"
  ],
  "readSet": [
    "docs/architecture/agent/modern-chat-agent"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 3000,
    "cleanupSeconds": 240
  },
  "checks": [
    {
      "id": "mcp-focused",
      "command": "(cd apps/desktop/src-tauri && cargo test application::mcp --lib) && pnpm --dir apps/desktop exec vitest run src/store/agentCapabilities.test.ts src/runtimes/toolRuntime.test.ts",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mcp-native-journey",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item mca-v2-j04 --gate agent-v2-mcp-lifecycle-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "MCP manifest/config, install, test, connect, bind, invoke, cancel, retry, and recovery form one visible lifecycle",
    "Desktop owns local process and secret handling while Station owns operation and ToolCall lineage",
    "Disconnect and restart reconcile process and connection state without false success",
    "Timeout, takeover, replay, late result, secret canary, process, and port cleanup pass on a disposable MCP server"
  ],
  "failureBehavior": [
    "Do not move device-local stdio process or secret ownership into Station",
    "Do not keep client-only terminal operation truth",
    "Unknown side effects block automatic repeat and cleanup failure remains visible"
  ],
  "updatedAt": "2026-09-16T16:36:26Z",
  "durableEvidence": []
}
```

## Objective

Close V2-J04 across MCP configuration, Desktop execution, Station operation
lineage, Agent binding, and real ToolCall continuation.

## Current Snapshot

- Desktop Rust supports persisted stdio/http/sse MCP configuration, discovery,
  policy checks, and tool execution.
- Station exposes local MCP Tool registration and capability operations.
- Unified operation progress, cancellation/recovery, and exact-source product
  proof remain incomplete.
