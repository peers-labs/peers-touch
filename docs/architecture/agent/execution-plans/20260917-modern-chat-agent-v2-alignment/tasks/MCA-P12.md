# MCA-P12 - Stateful External Agent Runtime

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-P12",
  "workstreamId": "MCA-P12",
  "title": "Implement the P12 external runtime resume and reset lifecycle",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "V2-P12-external-runtime",
  "journeyId": "MCA-J10",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent/agent.proto",
    "apps/station/app/subserver/agent/agent.go",
    "apps/station/app/subserver/agent/catalog",
    "apps/station/app/subserver/agent/errcode/error.go",
    "apps/station/app/subserver/agent/handler",
    "apps/station/app/subserver/agent/infrastructure/persistence",
    "apps/station/app/subserver/agent/service/externalruntime",
    "apps/station/app/subserver/agent/service/external_runtime_service.go",
    "apps/station/app/subserver/agent/service/provider_service.go",
    "apps/station/app/subserver/agent/service/runtime_admission_service.go",
    "apps/station/app/subserver/agent/service/runtime_authority_service.go",
    "apps/station/app/subserver/agent/service/runtime_evidence_service.go",
    "apps/station/app/subserver/agent/service/turn_service.go",
    "apps/desktop/src-tauri/src",
    "apps/desktop/src/services/desktop_api.ts",
    "apps/desktop/src/store/chat.ts",
    "apps/desktop/src/components/messages/AssistantMessage.tsx",
    "apps/desktop/src/acceptance/agent/harness.ts",
    "packages/locales/en/agent.json",
    "packages/locales/zh-CN/agent.json",
    "tooling/acceptance/gates/agent",
    "tooling/docker/compose.yml",
    "docs/architecture/agent"
  ],
  "readSet": [
    "apps/station/app/subserver/agent",
    "apps/desktop/src",
    "tooling/acceptance/gates/agent"
  ],
  "budgets": {
    "focusedCheckSeconds": 3600,
    "functionalRunSeconds": 10800,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "p12-contract-and-runtime",
      "command": "cd apps/station && go test ./app/subserver/agent/service/... ./app/subserver/agent/handler/... ./app/subserver/agent/infrastructure/persistence/... -count=1 && cd ../.. && pnpm --dir apps/desktop check && python3 -m unittest tooling.acceptance.gates.agent.external_runtime_e2e_test tooling.acceptance.gates.agent.foundation_candidate_producer_test tooling.acceptance.gates.agent.foundation_direct_adapter_test tooling.acceptance.gates.agent.foundation_scenario_runner_test tooling.acceptance.gates.agent.agent_native_static_test tooling.acceptance.tests.test_agent_v2_runtime_matrix",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "p12-external-runtime-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item MCA-P12-PR112 --gate agent-v2-external-runtime-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "p12-external-runtime-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate agent-v2-external-runtime-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "A healthy registered session adapter is advertised while an absent or incomplete adapter is not advertised",
    "The first external Turn persists one Conversation-owned runtime home, session handle, and epoch before output projection",
    "Follow-up and post-Station-restart Turns resume the exact persisted session",
    "Two Conversations never share a writable runtime home or external session",
    "A real resume failure emits RUNTIME_RESUME_UNAVAILABLE without changing the binding",
    "Desktop and Browser show localized Confirm reset without owning the external process",
    "Confirmed reset is actor-scoped, version-fenced, idempotent, cleans exactly once, advances one epoch, and clears the session",
    "Cleanup failure remains durable and blocks new Turn admission until retry succeeds",
    "The next Turn after reset creates a fresh session and all process, session, home, and test resources cleanly release"
  ],
  "failureBehavior": [
    "Do not map Direct Model retry to external resume",
    "Do not start a replacement session after resume failure without confirmation",
    "Do not expose raw runtime-home paths, commands, credentials, or vendor errors",
    "Do not let Browser or Desktop own session, epoch, process, or cleanup truth",
    "Return only the first deterministic failure to its owning layer"
  ],
  "updatedAt": "2026-10-01T01:50:00Z",
  "durableEvidence": []
}
```

## Objective

Activate MCA-P12 through a Station-owned, provider-neutral session CLI
runtime. Preserve the Direct Model path while adding durable external session
creation, exact-session resume across Station restart, explicit reset
confirmation, epoch fencing, isolation, structured activity, and cleanup.

## Current Snapshot

- Product Owner selected full P12 implementation on 2026-10-01.
- MCA-D29 defines the accepted Station-owned session and reset lifecycle.
- Existing proto and Station persistence already carry runtime kind, external
  session ID, epoch, runtime-home reference, and capability snapshot hashes.
- Current execution still hard-codes Direct Model snapshots and advertises P12
  as `NOT_ADVERTISED`.
- Exact-source Foundation run
  `20260930T193102500626Z-608146c5a247c33f1e99ea91a8756df5`
  first failed at Browser English `BASE-RESUME_UNAVAILABLE`; teardown passed.
- MCA-R01 remains blocked until this Task reaches `FUNCTIONAL_PASS`.
- Formal Foundation promotion remains owned by MCA-A08.
