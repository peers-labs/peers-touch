# MWPU-03-RECOVERY: Session And Recovery Usability

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-whole-product-usability-20261008",
  "taskId": "MWPU-03-RECOVERY",
  "workstreamId": "MWPU-PAGES",
  "title": "Close returning-session and degraded-recovery surfaces",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "mobile-recovery-usability",
  "journeyId": "MS-J02",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/mobile/scripts/ios_native_correctness_test.py",
    "apps/mobile/scripts/run-three-client-product-journey.mjs",
    "apps/mobile/src/App.tsx",
    "apps/mobile/src/acceptance",
    "apps/mobile/src/components/recovery",
    "apps/mobile/src/runtimes",
    "apps/mobile/src/styles.css",
    "apps/mobile/src-tauri/gen/apple",
    "apps/mobile/src-tauri/src/commands",
    "packages/prototypes/mobile/chat",
    "tooling/acceptance/gates/mobile"
  ],
  "readSet": [
    "apps/mobile/src/app/lifecycle",
    "apps/mobile/src/features/auth",
    "docs/architecture/platform/client/mobile",
    "docs/architecture/platform/station/access",
    "docs/client/common/ui-identity"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 5400,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "recovery-source",
      "command": "pnpm --dir apps/mobile run check:lifecycle-runtime && pnpm --dir apps/mobile run check:recovery-ui",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "recovery-foreground-functional",
      "command": "node apps/mobile/scripts/review-mobile-surfaces.mjs --surface-set recovery --mode functional",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "recovery-foreground-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-runtime-lifecycle-e2e && python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-station-lifecycle-e2e && python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-recovery-e2e && python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-recovery-ui-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "recovery-foreground-ux-review",
      "command": "node apps/mobile/scripts/review-mobile-surfaces.mjs --surface-set recovery",
      "verificationClass": "UX_REVIEW"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "recovery-foreground-functional",
    "scenarioIds": ["returning-session", "degraded-recovery"],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 2,
    "minWarmReuseRate": 0.5,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": true
  },
  "doneWhen": [
    "valid restore, revoked session, stale projection, unknown outcome, capacity, draft restoration, and module degradation are each operated in foreground iOS",
    "global blocking recovery is used only when the complete authenticated scope is unsafe",
    "module-local failure preserves unrelated navigation and readable content",
    "foreground screenshots and interaction traces cover every declared recovery row"
  ],
  "failureBehavior": [
    "do not hide a failed runtime behind fabricated empty data",
    "do not blind-retry an unknown write outcome",
    "do not advance while any recovery inventory row is unvisited or visually blocked"
  ],
  "updatedAt": "2026-10-08T00:00:00.000Z"
}
```

## Current Snapshot

- Returning-session and failure-state Gates prove lifecycle facts but do not
  judge complete product composition.
- A current Session-class screenshot shows a degradable runtime notice
  obstructing the Chat page, proving the recovery layer is mis-scoped.
