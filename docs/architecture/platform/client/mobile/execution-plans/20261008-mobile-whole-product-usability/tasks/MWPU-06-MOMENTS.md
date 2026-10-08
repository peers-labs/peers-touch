# MWPU-06-MOMENTS: Moments Usability

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-whole-product-usability-20261008",
  "taskId": "MWPU-06-MOMENTS",
  "workstreamId": "MWPU-PAGES",
  "title": "Close Moments feed, detail, composer, and recovery surfaces",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "mobile-moments-usability",
  "journeyId": "MS-J05",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/mobile/src/pages/MomentsPage.tsx",
    "apps/mobile/src/pages/moments",
    "apps/mobile/src/features/social",
    "apps/mobile/src/styles.css",
    "packages/prototypes/mobile/chat",
    "tooling/acceptance/gates/mobile"
  ],
  "readSet": [
    "apps/mobile/src/runtimes/privateMomentsRuntime.ts",
    "apps/mobile/src/runtimes/socialProjectionRuntime.ts",
    "docs/architecture/domains/social/core",
    "docs/client/common/ui-identity/modules/social"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 4200,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "moments-source",
      "command": "pnpm --dir apps/mobile exec vitest run src/pages/MomentsPage.test.ts src/pages/moments src/features/social/useMomentsDraft.test.ts",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "moments-foreground-functional",
      "command": "node apps/mobile/scripts/review-mobile-surfaces.mjs --surface-set moments --mode functional",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "moments-foreground-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-moments-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "moments-foreground-ux-review",
      "command": "node apps/mobile/scripts/review-mobile-surfaces.mjs --surface-set moments",
      "verificationClass": "UX_REVIEW"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "moments-foreground-functional",
    "scenarioIds": ["moments-feed", "moment-detail", "moment-composer"],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 2,
    "minWarmReuseRate": 0.66,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "feed, pagination, detail/comments, composer, audience, media, empty, filtered, policy-hidden, unavailable, pending, and rollback states are each operated in foreground iOS",
    "human content dominates protocol metadata and feed/detail/comments remain one continuous reading surface",
    "composer state and recovery stay inside the composer without blocking unrelated navigation",
    "foreground screenshots and interaction traces cover every declared Moments row"
  ],
  "failureBehavior": [
    "do not fabricate an empty feed when projection is unavailable",
    "do not discard draft or successful attachments on retryable failure",
    "do not advance while any Moments inventory row is unvisited or visually blocked"
  ],
  "updatedAt": "2026-10-08T00:00:00.000Z"
}
```

## Current Snapshot

- Moments feed, detail, comments, composer, and owner-specific recovery sources
  exist.
- Current evidence does not prove their complete foreground composition,
  content hierarchy, media bounds, draft recovery, and empty/error distinction.
