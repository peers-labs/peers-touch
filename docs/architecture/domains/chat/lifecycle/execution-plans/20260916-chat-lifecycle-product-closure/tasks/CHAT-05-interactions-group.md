# CHAT-05 Interactions And Group Lifecycle

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CHAT-LIFECYCLE-20260916",
  "taskId": "CHAT-05-interactions-group",
  "workstreamId": "CHAT-W04",
  "title": "Message interactions and complete Conversation-owned groups",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "chat-interactions-group",
  "journeyId": "CHAT-J04",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/chat",
    "apps/station/app/subserver/conversation",
    "apps/desktop",
    "packages/messaging-core",
    "tooling/acceptance",
    "packages/locales"
  ],
  "readSet": [
    "docs/architecture/chat-lifecycle",
    "docs/architecture/messaging-platform",
    "docs/architecture/social-runtime",
    "docs/client/chat"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 240
  },
  "checks": [
    {
      "id": "chat-interactions-group-source",
      "command": "python3 -m unittest tooling.acceptance.gates.chat.native_interactions_static_test tooling.acceptance.gates.chat.native_group_mls_runner_test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "chat-interactions-group-functional",
      "command": "python3 -m tooling.acceptance.gates.chat.lifecycle_interactions_group",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-interactions-group-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-interactions-group-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Direct and Group interactions converge after offline, duplicate, and restart paths",
    "CHAT-UR05: an accepted thread reply never shows terminal failure, and root count plus both participants' thread panels converge on identical message IDs and order",
    "Group create, add/remove, leave, roles, owner, rename, and dissolve use Conversation authority",
    "UI readiness follows committed membership and MLS projection",
    "Active clients contain no legacy Group mutation owner"
  ],
  "failureBehavior": [
    "Preserve pending interaction or group transition until authority outcome is known",
    "Stop on false thread failure, thread/main projection divergence, authority-head mismatch, split ownership, or premature ready state"
  ],
  "updatedAt": "2026-09-17T07:00:00Z",
  "durableEvidence": []
}
```

## Objective

Repair the failing interaction boundary and finish the Group lifecycle without
legacy `/group-chat/*` mutation ownership.

## Current Snapshot

- Most interaction and MLS source paths exist.
- The repository-local interaction run is failed.
- Group mutations and readiness remain split across canonical and legacy paths.
