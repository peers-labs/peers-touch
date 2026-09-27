# MOBILE-FRONTIER-PROOF - Final Exact-Source Functional Verification

## Task Slice

```json
{
    "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "MOBILE-FRONTIER-PROOF",
  "workstreamId": "MOBILE-FRONTIER",
  "title": "Verify the complete Mobile functional frontier after the hard cut",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "mobile-final-functional",
  "journeyId": "MS-J01..MS-J07-final-functional",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "tooling/acceptance/gates/mobile",
    "tooling/acceptance/features",
    "tooling/acceptance/registry.yaml",
    "docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation"
  ],
  "readSet": [
    "apps/mobile",
    "apps/station",
    "docs/architecture/mobile",
    "model",
    "packages"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 7200,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "mobile-feature-frontier-source",
      "command": "pnpm --dir apps/mobile run check:web",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mobile-feature-frontier-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item mobile-shell-implementation --gate mobile-simulator-runtime-lifecycle-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "A clean exact-source checkpoint exists after all architecture-defined source functionality and W8 hard cut are complete",
    "Real sender and receiver Journeys cover MS-J01..MS-J07 without legacy owner calls",
    "The verified runtime is prepared for W9 formal Acceptance only after the development functional run passes"
  ],
  "failureBehavior": [
    "Any product failure returns execution to a source implementation Task",
    "Do not substitute build, stale, sender-only, or source evidence for a real Journey",
    "Do not run formal Acceptance or prepare delivery from this Task"
  ],
  "updatedAt": "2026-09-18T07:30:00.000Z",
  "durableEvidence": []
}
```

## Objective

Run one final exact-source development Journey only after the complete feature
frontier and semantic hard cut are closed.

## Current Snapshot

- The prior source-frontier audit is preserved by `MOBILE-FRONTIER`.
- This final functional rerun is pending directly behind W8.
- It owns no formal Acceptance Gate and cannot make the W9 readiness claim.

## Verification Order

1. Focused source checks.
2. Clean checkpoint and exact-source runtime alignment.
3. Real functional journeys.
4. W9 formal Acceptance handoff.

## Concurrency Decision

- Runtime provisioning, deployment, and functional journeys are serialized
  around exact source identity and shared device resources.
- Formal Gate execution is not part of this Task; W9 owns that later aggregate.
