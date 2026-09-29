# MCA-P01 - Core Agent Creation And Roster Lifecycle

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-P01",
  "workstreamId": "MCA-P01",
  "title": "Close real Agent creation and roster CRUD",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "V2-agent-core-lifecycle",
  "journeyId": "V2-agent-core-lifecycle",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src/components/agent/create",
    "apps/desktop/src/components/agent/workbench/AgentRail.tsx",
    "apps/desktop/src/components/agent/workbench/TopicRail.tsx",
    "apps/desktop/src/hooks/useCommandMenuItems.ts",
    "apps/desktop/src/pages/AgentCanvasPage.tsx",
    "apps/desktop/src/pages/AgentProfilePage.tsx",
    "apps/desktop/src/pages/HomePage.tsx",
    "apps/desktop/src/store/agent.ts",
    "apps/station/app/subserver/agent/errcode/error.go",
    "apps/station/app/subserver/agent/infrastructure/persistence/agent.go",
    "apps/station/app/subserver/agent/service/agent_service.go",
    "packages/locales",
    "tooling/acceptance/capabilities/agent.yaml",
    "tooling/acceptance/features/agent-core-lifecycle.yaml",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/gates/agent/native_agent_runner.py",
    "tooling/acceptance/gates/agent/native_agent_runner_test.py",
    "tooling/acceptance/matrices/agent-core-lifecycle-native.yaml",
    "tooling/acceptance/provisioners/home_station.py",
    "tooling/acceptance/tests/test_provisioner_runtime.py",
    "tooling/acceptance/registry.yaml"
  ],
  "readSet": [
    "apps/desktop/src-tauri/src/application/agents",
    "apps/desktop/src-tauri/src/interface/tauri_commands/agents.rs",
    "docs/architecture/agent/modern-chat-agent"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "agent-core-lifecycle-source",
      "command": "pnpm --dir apps/desktop check && pnpm --dir apps/desktop exec vitest run src/components/agent/create/agentCreateFlow.test.ts src/components/agent/create/agentCreateModel.test.ts src/store/agent.test.ts && cd apps/station && go test ./app/subserver/agent/service ./app/subserver/agent/handler -count=1",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "agent-core-lifecycle-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item MCA-P01 --gate agent-core-lifecycle-native-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "Opening or cancelling Agent creation performs no Station write",
    "Saving once creates exactly one Station Agent and opens its Profile",
    "Every product Create Agent entry uses the same creation flow",
    "Repeated duplicate actions produce unique selectable Agents",
    "Delete and default changes reconcile the roster and selection",
    "The exact-source Native lifecycle Journey passes with Station readback and cleanup"
  ],
  "failureBehavior": [
    "Never persist placeholder Agents before explicit Save",
    "Never use Agent display names as ambiguous identities",
    "Keep failed or unrun native proof explicitly UNPROVEN"
  ],
  "updatedAt": "2026-09-28T08:35:00Z",
  "durableEvidence": []
}
```

## Objective

Replace premature placeholder persistence with a real creation workbench, then
prove the complete native roster lifecycle from UI action through Station
readback.

## Current Snapshot

- Product audit found create buttons that persisted placeholders, opened the
  current profile, navigated to Settings, or navigated to Marketplace.
- The registered core-lifecycle Gate referenced an unsupported runner journey.
- The lifecycle Gate must reuse the existing profile-two actor without a
  destructive Station reset and must not require an HTTP Provider credential;
  provider execution is proved separately by the primary CLI Provider Journey.
- Implementation and Gate repair are present locally but remain unproven until
  the main-agent exact-source run passes.
