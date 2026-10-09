# MWPU-07-FRONTIER: Final Exact-Source Functional Frontier

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-whole-product-usability-20261008",
  "taskId": "MWPU-07-FRONTIER",
  "workstreamId": "MWPU-PROOF",
  "title": "Rerun and remediate the complete Android, Desktop, and iOS product frontier",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "mobile-final-functional-frontier",
  "journeyId": "MS-J08",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/desktop",
    "apps/mobile/src",
    "apps/mobile/src-tauri/src",
    "apps/mobile/scripts",
    "apps/station",
    "packages/locales",
    "packages/prototypes/mobile/chat",
    "tooling/acceptance/gates/mobile"
  ],
  "readSet": [
    "docs/architecture/domains/chat",
    "docs/architecture/domains/social",
    "docs/architecture/platform/client/mobile",
    "docs/architecture/platform/station/access",
    "docs/client/common/ui-identity",
    "docs/client/desktop",
    "docs/client/mobile",
    "reports/mobile-infra-chat-usable/README.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 10800,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "three-client-final-functional-source",
      "command": "pnpm --dir apps/desktop run check && pnpm --dir apps/mobile run check && go test ./apps/station/app/subserver/conversation/... ./apps/station/app/subserver/social/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "three-client-final-functional",
      "command": "node apps/mobile/scripts/run-three-client-product-journey.mjs --phase all",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "three-client-final-functional-ux-review",
      "command": "node apps/mobile/scripts/review-mobile-surfaces.mjs --surface-set all --mode review",
      "verificationClass": "UX_REVIEW"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "three-client-final-functional",
    "scenarioIds": ["entry", "shell", "direct", "group", "voice", "call", "social", "recovery"],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 3,
    "minWarmReuseRate": 0.85,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "all earlier closures are rerun against the final Desktop, Mobile, Station, shared locale, runtime, and component source",
    "Android Alice, Desktop Bob, and iOS Coral complete the full foreground journey without stale binaries or stale sessions",
    "any regression discovered here is fixed at its owning page or shared layer and the complete frontier is rerun",
    "the final exact-source functional result is ready for formal Acceptance promotion"
  ],
  "failureBehavior": [
    "do not promote stale page evidence after shared-source changes",
    "do not enter formal Acceptance until this complete frontier passes",
    "do not defer a source-backed visual finding to the aggregate Task"
  ],
  "updatedAt": "2026-10-08T00:00:00.000Z"
}
```

## Current Snapshot

- Page Tasks are serial and share `styles.css`, localization, runtime, and
  common component sources.
- Without a final all-surface rerun, later page fixes can invalidate earlier
  foreground evidence while leaving each historical Task marked done.
