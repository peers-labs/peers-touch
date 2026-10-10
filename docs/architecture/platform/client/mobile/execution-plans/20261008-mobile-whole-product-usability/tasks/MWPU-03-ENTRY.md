# MWPU-03-ENTRY: Launch, Station, And Access Usability

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-whole-product-usability-20261008",
  "taskId": "MWPU-03-ENTRY",
  "workstreamId": "MWPU-PAGES",
  "title": "Close Mobile and Desktop launch, Station selection, login, and access usability",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "mobile-entry-usability",
  "journeyId": "MS-J01",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/desktop/src/components/common/StationPicker.tsx",
    "apps/desktop/src/pages/login",
    "apps/desktop/src/services",
    "apps/mobile/src/App.tsx",
    "apps/mobile/src/features/auth",
    "apps/mobile/src/features/station",
    "apps/mobile/scripts/run-three-client-product-journey.mjs",
    "apps/mobile/src/styles.css",
    "apps/station/app/subserver/actor_identity",
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
      "command": "pnpm --dir apps/desktop exec vitest run src/pages/login src/components/common && pnpm --dir apps/mobile exec vitest run src/features/auth src/features/station src/App.stationIdentity.test.ts",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mobile-simulator-access-e2e",
      "command": "node apps/mobile/scripts/run-three-client-product-journey.mjs --phase entry",
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
    "scenarioIds": ["android-alice-entry", "desktop-bob-entry", "ios-coral-entry"],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 3,
    "minWarmReuseRate": 0.66,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "Android Alice, Desktop Bob, and iOS Coral each complete boot, Station selection, verification, login, session restore, logout, and relaunch in foreground UI",
    "one primary next action, friendly Station identity, field-level recovery, keyboard safety, and accessible labels are visible in every state",
    "no raw URL, peer ID, internal gate name, or untranslated key dominates the interface",
    "a single configured healthy Station becomes active without an extra hidden activation step while multiple Station selection remains explicit",
    "foreground evidence records every declared entry state on all three clients"
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
