# MWPU-06-MOMENTS: Moments Usability

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-whole-product-usability-20261008",
  "taskId": "MWPU-06-MOMENTS",
  "workstreamId": "MWPU-PAGES",
  "title": "Close three-client Social feed, composer, detail, like, and recovery workflows",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "mobile-moments-usability",
  "journeyId": "MS-J05",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/desktop/src/pages",
    "apps/desktop/src/runtimes/momentsRuntime.ts",
    "apps/desktop/src/runtimes/momentsRuntime.test.ts",
    "apps/desktop/src/services/privateMomentsNative.ts",
    "apps/desktop/src/services/socialRealtime.ts",
    "apps/mobile/src/pages/MomentsPage.tsx",
    "apps/mobile/src/pages/moments",
    "apps/mobile/src/features/social",
    "apps/mobile/src/styles.css",
    "apps/mobile/scripts/run-three-client-product-journey.mjs",
    "apps/station/app/subserver/social",
    "packages/prototypes/mobile/chat",
    "tooling/acceptance/gates/mobile",
    "tooling/scripts/local-dev/dev-work-schema.mjs",
    "tooling/scripts/local-dev/dev-work.test.mjs"
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
      "command": "node --test tooling/scripts/local-dev/dev-work.test.mjs && pnpm --dir apps/desktop exec vitest run src/acceptance/moments src/runtimes/momentsRuntime.test.ts src/services/socialRealtime.test.ts src/test/moments-store.test.ts && pnpm --dir apps/mobile exec vitest run src/pages/MomentsPage.test.ts src/pages/moments src/features/social/useMomentsDraft.test.ts && node apps/mobile/scripts/run-three-client-product-journey.mjs --self-test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "moments-foreground-functional",
      "command": "node apps/mobile/scripts/run-three-client-product-journey.mjs --phase social",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "moments-foreground-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate development-workflow-control-plane && python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-moments-e2e",
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
    "scenarioIds": ["alice-publish", "bob-like", "coral-publish", "three-client-feed-convergence"],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 3,
    "minWarmReuseRate": 0.66,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "Android Alice publishes a post that Desktop Bob and iOS Coral receive and open through foreground Social UI",
    "Desktop Bob likes Alice's post and the visible like state converges on Android and iOS",
    "iOS Coral publishes a post that Android Alice and Desktop Bob receive, open, and like",
    "feed, composer, detail, media, empty, unavailable, pending, retry, rollback, and relaunch states remain usable and visually aligned across clients",
    "human content dominates protocol metadata and feed/detail/comments remain one continuous reading surface",
    "composer state and recovery stay inside the composer without blocking unrelated navigation",
    "foreground screenshots and interaction traces cover every declared Social workflow on all three clients"
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
