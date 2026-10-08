# MWPU-05-CONTACTS: Contacts And Groups Usability

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-whole-product-usability-20261008",
  "taskId": "MWPU-05-CONTACTS",
  "workstreamId": "MWPU-PAGES",
  "title": "Close Contacts, profile, request, and group-creation surfaces",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "mobile-contacts-usability",
  "journeyId": "MS-J04",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/mobile/src/pages/ContactsPage.tsx",
    "apps/mobile/src/features/social",
    "apps/mobile/src/styles.css",
    "packages/prototypes/mobile/chat",
    "tooling/acceptance/gates/mobile"
  ],
  "readSet": [
    "apps/mobile/src/runtimes/socialProjectionRuntime.ts",
    "apps/mobile/src/runtimes/messagingRuntime.ts",
    "docs/architecture/domains/social",
    "docs/client/common/ui-identity/modules/social"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 4200,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "contacts-source",
      "command": "pnpm --dir apps/mobile exec vitest run src/pages/ContactsPage.window.test.tsx src/features/social",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "contacts-foreground-functional",
      "command": "node apps/mobile/scripts/review-mobile-surfaces.mjs --surface-set contacts --mode functional",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "contacts-foreground-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-social-convergence-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "contacts-foreground-ux-review",
      "command": "node apps/mobile/scripts/review-mobile-surfaces.mjs --surface-set contacts",
      "verificationClass": "UX_REVIEW"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "contacts-foreground-functional",
    "scenarioIds": ["contacts-list", "contact-profile", "contact-overlays"],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 2,
    "minWarmReuseRate": 0.66,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "Contacts list, request sections, local search, federated lookup, profile detail, Find People, Create Group, and role-denied states are each operated in foreground iOS",
    "no-result, duplicate, pending, unavailable, permission, and destructive actions have distinct human-readable recovery",
    "long names and technical identifiers do not break row or modal layout",
    "foreground screenshots and interaction traces cover every declared Contacts row"
  ],
  "failureBehavior": [
    "do not treat empty and unavailable as the same state",
    "do not expose unsupported request or membership actions",
    "do not advance while any Contacts inventory row is unvisited or visually blocked"
  ],
  "updatedAt": "2026-10-08T00:00:00.000Z"
}
```

## Current Snapshot

- Contacts, requests, profiles, Find People, and Create Group are implemented
  in one route-scoped page.
- Existing proof emphasizes command/readback behavior; it does not certify all
  list, detail, overlay, long-copy, unavailable, or role-denied presentation.
