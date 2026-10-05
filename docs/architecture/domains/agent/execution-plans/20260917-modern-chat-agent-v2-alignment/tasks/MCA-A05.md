# MCA-A05 - MCP Formal Candidate Closure

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-A05",
  "workstreamId": "MCA-A05",
  "title": "Produce the complete V2-J04 MCP lifecycle candidate",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "V2-J04-formal-candidate",
  "journeyId": "V2-J04",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src/acceptance/agent",
    "apps/station/app/subserver/agent/service/capability_operation_service.go",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/desktop/src-tauri",
    "apps/station/app/subserver/agent",
    "model/domain/agent"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 10800,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "mcp-candidate-tests",
      "command": "python3 -m unittest tooling.acceptance.gates.agent.mcp_lifecycle_development_test",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "mcp-candidate-functional",
      "command": "python3 tooling/acceptance/gates/agent/mcp_lifecycle_development.py --formal-candidate",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "All 41 reviewed Desktop local, Browser unavailable, and Mobile-contract tuples execute independently",
    "Process, port, secret, receipt, replay, side-effect, unavailable-state, and cleanup evidence covers exactly its applicable tuples",
    "No unavailable or contract tuple creates a local MCP process or ToolCall",
    "The exact-source candidate passes the full semantic validator"
  ],
  "failureBehavior": [
    "Keep agent-v2-mcp-lifecycle-e2e UNPROVEN",
    "Fail the tuple on any surviving process, port, secret canary, or dirty fixture",
    "Do not represent unavailable Browser or Mobile contract paths as successful MCP runtime execution"
  ],
  "updatedAt": "2026-09-19T01:34:00Z",
  "durableEvidence": []
}
```

## Objective

Close the MCP formal candidate with real local lifecycle evidence and explicit
zero-execution semantics for unsupported platforms.

## Current Snapshot

- MCA-D23 is accepted; MCA-A04 owns the shared J03-J05 scenario-control
  implementation prerequisite.
- Native MCP prepare/recover/cleanup has passed.
- Browser unavailable, Mobile contract, exact tuple, and full validator
  coverage are incomplete.
- Final `PROVEN` promotion remains owned by MCA-A08.
