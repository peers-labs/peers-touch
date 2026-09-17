# MCA-J03 - Governed Tool Turn

## Task Slice

```json
{
  "schemaVersion": 1,
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-J03",
  "workstreamId": "MCA-J03",
  "title": "Governed ToolCall lineage functional closure",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "V2-J03-functional",
  "journeyId": "V2-J03",
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
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "governed-tool-focused",
      "command": "pnpm --dir apps/desktop exec vitest run src/runtimes/toolRuntime.test.ts src/components/messages/ToolCallCard.test.ts src/store/chatMerge.test.ts && (cd apps/station && go test ./app/subserver/agent/service -run 'Tool|CapabilityOperation') && python3 -m unittest tooling.acceptance.gates.agent.governed_tool_development_test tooling.acceptance.tests.test_provisioner_runtime.ProvisionerBlockingTests.test_agent_v2_governed_tool_provisions_profile_two_clients",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "governed-tool-native-journey",
      "command": "python3 tooling/acceptance/gates/agent/governed_tool_development.py",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "Proposal, policy, approval decision, execution claim, result, and continuation share one durable ToolCall lineage",
    "Manual approval creates exactly one decision and at most one side effect",
    "Expiry, timeout, cancellation, disconnect, replay, and unknown-side-effect recovery remain visible and fail closed",
    "The deterministic exact-source native Journey passes without relying on model tool-choice luck"
  ],
  "failureBehavior": [
    "Do not retry the nondeterministic live-model prompt loop as the proof oracle",
    "Do not drop live ToolCall projection while the authoritative assistant message is temporarily unkeyed",
    "Do not continue the model before an authoritative terminal result"
  ],
  "updatedAt": "2026-09-16T16:36:26Z",
  "durableEvidence": []
}
```

## Objective

Finish V2-J03 by proving the current governance UI and Station lineage with a
deterministic sanctioned fixture.

## Current Snapshot

- Governance metadata, approval hydration, and unkeyed-message reconciliation
  fixes are implemented in the current dirty source.
- Focused tests, TypeScript, and production build previously passed.
- The dedicated Development runner uses a source-attested OpenAI-compatible
  provider fixture through the production provider boundary; the formal
  86-tuple Gate remains owned by MCA-A01.
- Timeout/disconnect taxonomy and retry-command lineage remain
  `DESIGN_AMENDMENT_REQUIRED` and are not invented by this slice.
- Post-fix exact-source native functional evidence remains unproven.

## Concurrency Decision

- Mode: hybrid.
- Integrator owns this Task, Harness, Home Station provisioning, provider
  Fixture/tunnel, commits, deployment, and functional evidence.
- Desktop runtime/status/UI corrections are path-isolated until integration.
- Shared plan/tracking files and runtime resources remain serial.
