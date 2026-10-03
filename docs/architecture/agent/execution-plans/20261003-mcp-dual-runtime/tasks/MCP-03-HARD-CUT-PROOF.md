# MCP-03-HARD-CUT-PROOF - Dual-runtime hard cut and proof

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "agent-mcp-dual-runtime-20261003",
  "taskId": "MCP-03-HARD-CUT-PROOF",
  "workstreamId": "MCP-DUAL-RUNTIME",
  "title": "Hard-cut MCP ownership and prove both execution locations",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "MCP-dual-runtime-proof",
  "journeyId": "MCA-J04-DUAL",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop",
    "apps/station/app/subserver/agent",
    "docs/architecture/agent",
    "docs/architecture/architecture-module-governance/architecture-modules.json",
    "docs/README.md",
    "model/domain/agent",
    "tooling/acceptance/gates/agent",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/registry.yaml"
  ],
  "readSet": [
    "apps/desktop",
    "apps/station/app/subserver/agent",
    "docs/architecture/agent",
    "model/domain/agent",
    "tooling/acceptance/gates/agent",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/registry.yaml"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "mcp-dual-runtime-source",
      "command": "make model-gen && cd apps/station && go test ./app/subserver/agent/... -count=1 && cd ../.. && pnpm --dir apps/desktop check && node tooling/scripts/architecture/module-governance.mjs validate",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mcp-dual-runtime-zero-reference",
      "command": "! rg -n 'local_mcp|mcp.invoke.*CLIENT_CAPABILITY' apps/station/app/subserver/agent apps/desktop/src-tauri/src/application/agent_turn docs/architecture/agent --glob '!execution-plans/**' --glob '!modules/**'",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mcp-dual-runtime-functional",
      "command": "cd apps/station && go test ./app/subserver/agent/service/... -run 'Test.*MCP.*(Station|Client|Owner)' -count=1 && cd ../.. && cd apps/desktop/src-tauri && cargo test mcp -- --nocapture",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "mcp-dual-runtime-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate agent-mcp-dual-runtime-source",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Desktop-local stdio executes once through CLIENT_CAPABILITY fencing",
    "Station-local stdio executes once through STATION fencing with Desktop executor offline",
    "HTTP/SSE transport remains independent from execution owner",
    "Station readback is the only MCP catalog/config and Tool manifest truth",
    "Raw secrets are absent from Station projections, logs, ToolCall arguments, and evidence",
    "Generic local_mcp and Desktop Turn tool injection have zero live references",
    "Architecture, implementation, tests, and Gate registry agree on MCA-D16A"
  ],
  "failureBehavior": [
    "Fail closed when owner, Server revision, Tool manifest, binding, readiness, or secret ref is stale",
    "Do not keep compatibility aliases, dual reads, dual writes, or migration TODOs",
    "Do not claim remote deployment or Mobile MCP execution",
    "Return the first deterministic proof failure"
  ],
  "updatedAt": "2026-10-03T02:30:00Z",
  "durableEvidence": []
}
```

## Objective

Finish the ownership cut and prove that both execution locations share one
Station-governed control plane without depending on each other.

## Current Snapshot

- MCA-D16A is accepted and the source architecture reflects the target.
- Station and Desktop implementations still encode the superseded
  Desktop-only MCP catalog and generic manifest.
