# W6B-FEED-RECOVERY - Retained Moments Feed Recovery

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W6B-FEED-RECOVERY",
  "workstreamId": "W6B",
  "title": "Retained Moments feed failure and retry recovery",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "fix",
  "closureId": "W6B-feed-recovery-source",
  "journeyId": "MS-J05-feed-recovery",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/src/features/social/momentsFeedStore.ts",
    "apps/mobile/src/features/social/momentsFeedStore.test.ts",
    "apps/mobile/src/features/social/useMomentsFeed.ts",
    "apps/mobile/src/pages/MomentsPage.tsx",
    "apps/mobile/src/pages/MomentsPage.test.ts"
  ],
  "readSet": [
    "docs/architecture/mobile/experience-contract.md",
    "docs/architecture/mobile/product-state-model.md",
    "docs/architecture/social-runtime"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 300,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "moments-feed-recovery-focused",
      "command": "pnpm --dir apps/mobile exec vitest run src/features/social/momentsFeedStore.test.ts src/pages/MomentsPage.test.ts",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Initial, refresh, and pagination failures retain distinct recovery identity",
    "A refresh or pagination failure preserves already visible posts",
    "The retained feed exposes the correct retry action and visible refreshing state",
    "Pagination retry continues from the same authoritative cursor"
  ],
  "failureBehavior": [
    "Do not erase retained feed rows on refresh or pagination failure",
    "Do not silently convert a failure into end-of-list",
    "Policy-hidden producer semantics remain owner-blocked"
  ],
  "updatedAt": "2026-09-17T03:16:00.000Z"
}
```

## Objective

Make every accepted Moments feed failure recoverable while retaining the last
committed projection and cursor.

## Current Snapshot

- The store preserves retained rows, but its page surface renders an error only
  when the feed is empty.
- Retained-feed refresh and load-more failures therefore remove the only
  reachable retry control.

## Source Closure

- Feed failures now preserve an explicit `initial`, `refresh`, or `load-more`
  identity together with the last committed rows, cursor, and `hasMore`.
- Pagination can retry from its unchanged authoritative cursor after failure.
  Refresh retries the first-page read without replacing retained pages.
- The page renders retained posts alongside visible failure recovery and a
  visible refreshing state instead of hiding both behind empty-only handling.

## Verification Snapshot

- Focused Moments store/page suite: 53/53 PASS.
- TypeScript and scoped diff validation: PASS.
- Formal Moments Acceptance remains deferred until the source frontier closes.

## Concurrency Decision

- This slice is independent of media decryption, draft persistence, Settings,
  and native lifecycle work.
- The current Task owns store failure identity and its matching page action.
