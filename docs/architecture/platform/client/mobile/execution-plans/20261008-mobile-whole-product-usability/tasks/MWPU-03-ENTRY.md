# MWPU-03-ENTRY: Launch, Station, And Access Usability

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-whole-product-usability-20261008",
  "taskId": "MWPU-03-ENTRY",
  "workstreamId": "MWPU-PAGES",
  "title": "Close launch, Station selection, login, and access-gate usability",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "mobile-entry-usability",
  "journeyId": "MS-J01",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/mobile/src/App.tsx",
    "apps/mobile/src/features/auth",
    "apps/mobile/src/features/station",
    "apps/mobile/src/styles.css",
    "packages/prototypes/mobile/chat",
    "tooling/acceptance/gates/mobile"
  ],
  "readSet": [
    "apps/mobile/src/app/lifecycle",
    "apps/mobile/src/runtimes",
    "docs/architecture/platform/station/access",
    "docs/client/common/ui-identity/modules/auth",
    "docs/client/mobile/form-control-layout-contract.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "entry-source",
      "command": "pnpm --dir apps/mobile exec vitest run src/features/auth src/features/station src/App.stationIdentity.test.ts",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mobile-simulator-access-e2e",
      "command": "node apps/mobile/scripts/review-mobile-surfaces.mjs --surface-set entry --mode functional",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "mobile-simulator-access-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-access-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "entry-foreground-ux-review",
      "command": "node apps/mobile/scripts/review-mobile-surfaces.mjs --surface-set entry",
      "verificationClass": "UX_REVIEW"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "mobile-simulator-access-e2e",
    "scenarioIds": ["station-selection", "access-gate"],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 1,
    "minWarmReuseRate": 0.5,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "boot, Station selection, address entry, verification, identity mismatch, login, OAuth progress, access gates, and runtime preparation are each usable in foreground iOS",
    "one primary next action, friendly Station identity, field-level recovery, keyboard safety, and accessible labels are visible in every state",
    "no raw URL, peer ID, internal gate name, or untranslated key dominates the interface",
    "foreground evidence records every declared entry-state inventory row"
  ],
  "failureBehavior": [
    "do not bypass Station identity or access gates for visual proof",
    "do not use fabricated authentication success",
    "do not continue to Chat until entry surfaces pass their own walkthrough"
  ],
  "updatedAt": "2026-10-08T00:00:00.000Z"
}
```

## Current Snapshot

- Launch, Station, Auth, and Access Gate sources exist and have scenario-level
  tests.
- The current required layout Gate visits only launch surfaces and does not
  establish a complete human-readable entry journey through every state.
