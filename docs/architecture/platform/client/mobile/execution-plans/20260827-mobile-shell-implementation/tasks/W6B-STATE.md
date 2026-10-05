# W6B-STATE - Moments Refresh And Deletion Semantics

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W6B-STATE",
  "workstreamId": "W6B",
  "title": "Moments refresh preservation and deletion state",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "fix",
  "closureId": "W6B-state-source",
  "journeyId": "MS-J05-refresh-delete",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/src/features/social/momentsFeedStore.test.ts",
    "apps/mobile/src/features/social/momentsFeedStore.ts",
    "apps/mobile/src/runtimes/socialProjectionRuntime.test.ts",
    "apps/mobile/src/runtimes/socialProjectionRuntime.ts"
  ],
  "readSet": [
    "docs/architecture/platform/client/mobile/experience-contract.md",
    "docs/architecture/domains/social/runtime"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 300,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "moments-state-focused",
      "command": "pnpm --dir apps/mobile exec vitest run src/features/social/momentsFeedStore.test.ts src/runtimes/socialProjectionRuntime.test.ts src/pages/MomentsPage.test.ts",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Authoritative refresh preserves already visible paginated content",
    "Realtime deletion projects the accepted deleted detail state",
    "Late or superseded refreshes cannot overwrite current state"
  ],
  "failureBehavior": [
    "Do not replace retained pagination with the first refresh page",
    "Do not map an authoritative deletion to generic unavailable state",
    "Policy-hidden and encrypted-media owner contracts remain in W6B"
  ],
  "updatedAt": "2026-09-16T14:45:15.000Z"
}
```

## Objective

Close the two Mobile-owned Moments state regressions found by the post-cutover
audit.

## Current Snapshot

- Cold load, authoritative refresh, and forward pagination now use distinct
  merge modes. Refresh replaces overlapping first-page rows while retaining
  already visible non-overlapping pages within the 200-row bound.
- Realtime deletion removes the feed row, projects an already visible selected
  detail as deleted, and fences older detail/comment readbacks.
- Feed revision and request-sequence fencing reject late pagination, initial
  load, refresh, inline readback, and reconciliation results.

## Concurrency Decision

- Execution is serial. `W6B-STATE` is current after `W6B-WIRE`; its feed-store
  contract and runtime deletion ingress share one state transition and one
  focused test boundary.
- `W7-SOURCE-SYNC` is dependency-ready with a disjoint write set, but the Plan
  Package permits only one current Task. It remains queued until this Task is
  verified and advanced.
- The integrator owns the four declared source/test files, this Task snapshot,
  manifest advancement, and final reconciliation. No subagent lane or
  generated artifact is required.

## Verification Snapshot

- Task-focused Moments store/runtime/page suite: 49/49 PASS.
- `pnpm --dir apps/mobile run check:web`: PASS, including Social wire,
  runtime-boundary checks, boundary self-tests, and TypeScript.
