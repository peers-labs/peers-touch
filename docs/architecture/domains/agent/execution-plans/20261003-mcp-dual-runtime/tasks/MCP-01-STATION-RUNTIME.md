# MCP-01-STATION-RUNTIME - Station-local MCP closure

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "agent-mcp-dual-runtime-20261003",
  "taskId": "MCP-01-STATION-RUNTIME",
  "workstreamId": "MCP-DUAL-RUNTIME",
  "title": "Execute a governed MCP tool inside the Station runtime",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "MCP-station-runtime",
  "journeyId": "MCA-J04-STATION",
  "runtimeClass": "service",
  "writeSet": [
    "model/domain/agent",
    "apps/station/app/subserver/agent",
    "docs/architecture/domains/agent"
  ],
  "readSet": [
    "model/domain/agent",
    "apps/station/app/subserver/agent",
    "docs/architecture/domains/agent/modern-chat-agent"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "station-mcp-source",
      "command": "cd apps/station && go test ./app/subserver/agent/service/... ./app/subserver/agent/handler/... ./app/subserver/agent/infrastructure/persistence/... -count=1",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "station-mcp-functional",
      "command": "cd apps/station && go test ./app/subserver/agent/service/... -run 'Test.*MCP.*Station' -count=1",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "station-mcp-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-agent-unit",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Station persists actor-scoped MCP Server revisions and redacted configuration",
    "Each discovered Tool publishes an immutable manifest with STATION execution owner",
    "Station-local stdio executes through the existing Station ToolCall claim/receipt/continuation path",
    "Station-local MCP requires no client capability lease and succeeds with no Desktop executor",
    "Owner change invalidates old readiness without changing an in-flight ToolCall owner"
  ],
  "failureBehavior": [
    "Reject raw secret material from MCP read projections",
    "Reject transport-derived or ToolCall-argument-derived execution owner",
    "Do not add a parallel MCP dispatch protocol",
    "Return the first deterministic Station failure"
  ],
  "updatedAt": "2026-10-03T02:30:00.000Z"
}
```

## Objective

Close the Station-owned half of MCA-D16A using the existing Station ToolCall
execution owner and fencing machinery.

## Current Snapshot

- ToolCall already supports `STATION` and has Station claim/receipt/continuation.
- MCP configuration and execution currently exist only in Desktop Rust.
- The generic `local_mcp` manifest is client-owned and cannot represent this
  closure.
