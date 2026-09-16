# CHAT-08 Cross-Station And Device Continuity

## Task Slice

```json
{
  "schemaVersion": 1,
  "kind": "peers-touch-task-slice",
  "planId": "CHAT-LIFECYCLE-20260916",
  "taskId": "CHAT-08-continuity",
  "workstreamId": "CHAT-W07",
  "title": "Cross-Station, multi-device, revoke, and recovery continuity",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "chat-continuity",
  "journeyId": "CHAT-J07",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/chat",
    "model/domain/realtime",
    "apps/station/app/subserver",
    "apps/station/frame/core/federation",
    "apps/desktop",
    "apps/mobile",
    "packages/messaging-core",
    "tooling/acceptance"
  ],
  "readSet": [
    "docs/architecture/chat-lifecycle",
    "docs/architecture/messaging-platform",
    "docs/architecture/realtime"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "chat-continuity-source",
      "command": "python3 -m unittest tooling.acceptance.gates.chat.native_recovery_runner_test tooling.acceptance.gates.chat.native_group_mls_runner_test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "chat-continuity-functional",
      "command": "python3 -m tooling.acceptance.gates.chat.lifecycle_continuity",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-continuity-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-continuity-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Cross-Station Direct, Group, relationship, voice-note, and live-voice journeys pass",
    "Two active devices receive independent private delivery and revoked devices receive none",
    "Fresh-install recovery restores entitled history and continues with a fresh device identity",
    "Station/client restart and network interruption preserve ordered product truth"
  ],
  "failureBehavior": [
    "Fail closed on route, generation, membership, authority, or recovery mismatch",
    "Do not recover through client-provided truth, old routes, or copied live crypto state"
  ],
  "updatedAt": "2026-09-16T07:45:00Z",
  "durableEvidence": []
}
```

## Objective

Prove that the completed Chat product survives the topology and lifecycle
boundaries users encounter outside a single online client.

## Current Snapshot

- Historical Desktop evidence exists for selected continuity paths.
- Current exact-source and Mobile continuity matrices are absent.
- Cross-Station product proof remains incomplete.
