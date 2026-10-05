# CHAT-09 Release Acceptance Aggregate

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CHAT-LIFECYCLE-20260916",
  "taskId": "CHAT-09-release",
  "workstreamId": "CHAT-W08",
  "title": "Current-source full Chat release proof",
  "workClass": "product-behavior",
  "completionClass": "acceptance-aggregate",
  "executionMode": "fix",
  "closureId": "chat-release",
  "journeyId": "CHAT-J08",
  "runtimeClass": "source-only",
  "writeSet": [
    "tooling/acceptance",
    "docs/architecture/chat-lifecycle"
  ],
  "readSet": [
    "docs/architecture/chat-lifecycle",
    "docs/architecture/messaging-platform",
    "docs/architecture/realtime",
    "apps/station/app/subserver",
    "apps/desktop",
    "apps/mobile",
    "packages/messaging-core"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 7200,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "chat-release-structure",
      "command": "python3 tooling/scripts/acceptance-validate.py && python3 tooling/scripts/acceptance-gap-detect.py",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "chat-release-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-release-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "CHAT-G00 through CHAT-G12 and CHAT-G14 pass on one exact source",
    "Required Desktop and Mobile runtime cells have receiver and durable evidence",
    "Old owners and obsolete plan discovery have zero active references",
    "Gap detector, quality evidence, completion audit, and independent review pass"
  ],
  "failureBehavior": [
    "Keep every missing or stale runtime cell explicitly UNPROVEN",
    "Do not merge results from different commits into one release claim"
  ],
  "updatedAt": "2026-09-16T07:45:00Z",
  "durableEvidence": []
}
```

## Objective

Produce the single release claim for product-grade Chat after every functional
closure has already passed its real Journey.

## Current Snapshot

- No current-source release aggregate exists.
- Historical plan verdicts omit newer required Gates or source identity.
- This Task cannot start before all preceding functional closures are done.
