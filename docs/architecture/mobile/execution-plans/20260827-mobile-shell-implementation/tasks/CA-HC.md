# CA-HC - Conversation Authority Hard Cut

## Task Slice

```json
{
    "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "CA-HC",
  "workstreamId": "CA-HC",
  "title": "Conversation Authority DDD source hard cut",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "CA-HC-source",
  "journeyId": "CA-W0..CA-W5",
  "runtimeClass": "source-only",
  "writeSet": ["apps/station", "packages/messaging-core", "docs/architecture/api-ownership", "docs/architecture/messaging-platform"],
  "readSet": ["docs/architecture/federation", "docs/architecture/mobile", "docs/architecture/social-runtime"],
  "budgets": {"focusedCheckSeconds": 600, "functionalRunSeconds": 1800, "cleanupSeconds": 120},
  "checks": [
    {"id": "conversation-authority-focused", "command": "(cd apps/station && go test -race -count=1 ./app/subserver/conversation/...)", "verificationClass": "SOURCE_CHECK"}
  ],
  "doneWhen": ["Conversation is the sole Chat authority in production source", "Retired Messaging, Envelope, duplicate-engine, and compatibility paths are absent"],
  "failureBehavior": ["Do not recreate Messaging or Envelope authorities", "CA-W6 runtime and CA-W7 completion proof remains in CA-HC-PROOF"],
  "updatedAt": "2026-09-16T00:00:00.000Z",
  "durableEvidence": [
    {"verificationClass": "SOURCE_CHECK", "result": "PASS", "ref": "docs/architecture/api-ownership/execution-plans/20260906-conversation-authority-hard-cut.md"},
    {"verificationClass": "SOURCE_CHECK", "result": "PASS", "ref": "docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation/archive/legacy-plan.md#L3043"}
  ]
}
```

## Objective

Provide the sole Conversation source authority required by Mobile Chat.

## Current Snapshot

- Canonical production composition and hard-cut source are integrated.
- CA-W6 runtime Acceptance and CA-W7 completion are isolated in CA-HC-PROOF.
