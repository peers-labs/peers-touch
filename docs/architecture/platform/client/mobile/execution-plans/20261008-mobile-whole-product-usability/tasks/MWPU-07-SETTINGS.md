# MWPU-07-SETTINGS: Me And Settings Usability

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-whole-product-usability-20261008",
  "taskId": "MWPU-07-SETTINGS",
  "workstreamId": "MWPU-PAGES",
  "title": "Close Me, Settings details, Station change, and logout surfaces",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "mobile-settings-usability",
  "journeyId": "MS-J06",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/mobile/src/pages/SettingsPage.tsx",
    "apps/mobile/src/pages/settings",
    "apps/mobile/src/features/station",
    "apps/mobile/src/styles.css",
    "packages/prototypes/mobile/chat",
    "tooling/acceptance/gates/mobile"
  ],
  "readSet": [
    "apps/mobile/src/runtimes",
    "docs/architecture/domains/notification",
    "docs/architecture/domains/social",
    "docs/architecture/platform/station/access",
    "docs/client/common/ui-identity"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 4200,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "settings-source",
      "command": "pnpm --dir apps/mobile exec vitest run src/pages/settings src/pages/SettingsPage.test.ts",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "settings-foreground-functional",
      "command": "node apps/mobile/scripts/review-mobile-surfaces.mjs --surface-set settings --mode functional",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "settings-foreground-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-settings-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "settings-foreground-ux-review",
      "command": "node apps/mobile/scripts/review-mobile-surfaces.mjs --surface-set settings",
      "verificationClass": "UX_REVIEW"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "settings-foreground-functional",
    "scenarioIds": ["settings-summary", "settings-details", "settings-scope-exit"],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 2,
    "minWarmReuseRate": 0.66,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "Me summary and every registered Settings detail are each opened and operated in foreground iOS",
    "profile/privacy, notifications, blocked users, appearance, language, storage, Station change, and logout expose correct owner and state",
    "dirty, saving, saved, conflict, unavailable, permission, failure, and destructive confirmation states preserve task context",
    "foreground screenshots and interaction traces cover every declared Settings row"
  ],
  "failureBehavior": [
    "do not invent a cross-owner Settings save",
    "do not show raw PTID or Station URL as the primary identity",
    "do not advance while any Settings inventory row is unvisited or visually blocked"
  ],
  "updatedAt": "2026-10-08T00:00:00.000Z"
}
```

## Current Snapshot

- Me and Settings expose owner-specific sections and selected-only details.
- Existing tests verify state wiring, but there is no foreground proof that
  every detail, long label, permission state, conflict, Station change, and
  logout confirmation remains understandable and operable.
