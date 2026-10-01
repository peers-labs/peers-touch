# AMU-01 - Minimum Usable Agent Chat

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "minimum-usable-agent-chat-20261001",
  "taskId": "AMU-01",
  "workstreamId": "AMU",
  "title": "Close the minimum usable Direct Model Agent Chat journey",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "AMU-functional",
  "journeyId": "AMU-J01",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop",
    "apps/station/app/subserver/agent",
    "docs/architecture/agent",
    "model/domain/agent",
    "packages/agent-catalog",
    "packages/locales",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/desktop",
    "apps/station/app/subserver/agent",
    "docs/architecture/agent/modern-chat-agent",
    "model/domain/agent",
    "packages/agent-catalog",
    "tooling/acceptance"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "minimum-agent-chat-source",
      "command": "cd apps/station && go test ./app/subserver/agent/service/... ./app/subserver/agent/handler/... ./app/subserver/agent/infrastructure/persistence/... -count=1 && cd ../.. && pnpm --dir apps/desktop check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "minimum-agent-chat-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item AGENT-MINIMUM-USABLE-CHAT-20261001 --gate agent-conversation-e2e --gate agent-v2-capability-binding-e2e --gate agent-v2-governed-tool-loop-e2e --gate agent-v2-mcp-lifecycle-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "minimum-agent-chat-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate agent-conversation-e2e --gate agent-v2-capability-binding-e2e --gate agent-v2-governed-tool-loop-e2e --gate agent-v2-mcp-lifecycle-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Desktop Native and Browser can create or select an Agent backed by a Direct Model provider",
    "The Agent capability snapshot contains the configured Skill and MCP bindings",
    "A user message starts one Turn, streams visible output, and ends with one final assistant response",
    "A governed Skill or tool call requires explicit approval and its result is incorporated into the final response",
    "An enabled MCP server exposes tools to the Agent and one real MCP invocation completes through the Station-owned loop",
    "Stop, retry, and regenerate do not duplicate the authoritative assistant message",
    "Conversation history and the final assistant response survive Desktop restart",
    "Provider, permission, and MCP failures are visible and recoverable without silent fallback",
    "All Native, Browser, Station, fixture, and storage resources cleanly release"
  ],
  "failureBehavior": [
    "Fix the first observed product failure at its owning production layer",
    "Do not replace real Skill or MCP execution with mocks or static evidence",
    "Do not require external Agent runtime, Marketplace, Evaluation, Artifacts, Multi-Agent, Mobile, TTS, image, or video scope",
    "Do not expand to the 419-cell Foundation matrix",
    "Return only the first deterministic failure"
  ],
  "updatedAt": "2026-10-01T09:23:00Z",
  "durableEvidence": []
}
```

## Objective

Ship the smallest Agent Chat product that a user can actually complete:

`Agent configuration -> Skill/MCP binding -> user message -> governed execution
-> final assistant response -> durable restart recovery`.

## Current Snapshot

- Direct Model chat, Skill binding, governed tool execution, MCP lifecycle, and
  durable conversation code already exist.
- This Task runs only the four focused product Gates needed by the minimum
  release and repairs any concrete failures they expose.
- The retired broad parity Plan and its 419-cell matrix do not gate this Task.
