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
    "tooling/acceptance",
    "tooling/scripts/local-dev"
  ],
  "readSet": [
    "apps/desktop",
    "apps/station/app/subserver/agent",
    "docs/architecture/agent/modern-chat-agent",
    "model/domain/agent",
    "packages/agent-catalog",
    "tooling/acceptance",
    "tooling/scripts/local-dev"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "minimum-agent-chat-source",
      "command": "python3 -m unittest tooling.acceptance.gates.agent.native_agent_runner_test tooling.acceptance.gates.agent.mcp_lifecycle_development_test tooling.acceptance.tests.test_provisioner_runtime tooling.acceptance.gates.agent.agent_native_static_test && cd apps/station && go test ./app/subserver/agent/service/... ./app/subserver/agent/handler/... ./app/subserver/agent/infrastructure/persistence/... -count=1 && cd ../.. && pnpm --dir apps/desktop check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "minimum-agent-chat-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item AGENT-MINIMUM-USABLE-CHAT-20261001 --gate agent-minimum-usable-chat-native-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "minimum-agent-chat-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate agent-minimum-usable-chat-native-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Desktop Native can create and select an Agent backed by a Direct Model provider",
    "The Agent capability snapshot contains the configured ready MCP binding",
    "A user message starts one Turn, executes one governed capability, and ends with one visible final assistant response",
    "An enabled MCP server exposes tools to the Agent and one real MCP invocation completes through the Station-owned loop",
    "Conversation history and the final assistant response survive Desktop restart",
    "Native, Station, provider fixture, MCP process, port, and storage resources cleanly release",
    "Browser remains explicitly UNPROVEN and does not block this Native closure"
  ],
  "failureBehavior": [
    "Fix the first observed product failure at its owning production layer",
    "Do not replace real Skill or MCP execution with mocks or static evidence",
    "Do not require external Agent runtime, Marketplace, Evaluation, Artifacts, Multi-Agent, Mobile, TTS, image, or video scope",
    "Do not expand to the 419-cell Foundation matrix",
    "Return only the first deterministic failure"
  ],
  "updatedAt": "2026-10-02T10:05:00Z",
  "durableEvidence": []
}
```

## Objective

Ship the smallest Agent Chat product that a user can actually complete:

`Agent configuration -> Skill/MCP binding -> user message -> governed execution
-> final assistant response -> durable restart recovery`.

## Current Snapshot

- Direct Model chat, capability binding, governed tool execution, MCP lifecycle, and
  durable conversation code already exist.
- This Task runs one dedicated Native Gate that composes the existing
  production Harness path into the minimum user Journey.
- The retired broad parity Plan and its 419-cell matrix do not gate this Task.
- Browser remains unproven and non-blocking for this minimum Native release.
