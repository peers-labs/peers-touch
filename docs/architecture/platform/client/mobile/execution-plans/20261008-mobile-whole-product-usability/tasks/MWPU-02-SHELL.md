# MWPU-02-SHELL: Shared Mobile Visual Foundation

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-whole-product-usability-20261008",
  "taskId": "MWPU-02-SHELL",
  "workstreamId": "MWPU-FOUNDATION",
  "title": "Repair shared Mobile shell, scale, identity, and recovery composition",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "mobile-shell-foundation",
  "journeyId": "MS-J08",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/mobile/src/components",
    "apps/mobile/src/styles.css",
    "apps/mobile/src/app/mobileI18n.tsx",
    "packages/locales",
    "packages/prototypes/mobile/chat",
    "tooling/acceptance/gates/mobile"
  ],
  "readSet": [
    "apps/mobile/src/app",
    "apps/mobile/src/features",
    "apps/mobile/src/pages",
    "apps/mobile/src/runtimes",
    "docs/client/common/ui-identity",
    "docs/client/mobile"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "shell-source",
      "command": "pnpm --dir apps/mobile run check:web && pnpm --dir apps/mobile run check:recovery-ui",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "shell-foreground-functional",
      "command": "node apps/mobile/scripts/review-mobile-surfaces.mjs --surface-set shell --mode functional",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "shell-foreground-ux-review",
      "command": "node apps/mobile/scripts/review-mobile-surfaces.mjs --surface-set shell",
      "verificationClass": "UX_REVIEW"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "shell-foreground-functional",
    "scenarioIds": ["shell-navigation", "shell-degraded-module"],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 1,
    "minWarmReuseRate": 0.5,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "shared typography, spacing, touch targets, safe areas, headers, tabbar, notices, sheets, and modal layers follow Mobile UI Identity",
    "friendly names are primary and technical identifiers are diagnostic-only",
    "module degradation stays inside the owning surface and never obstructs unrelated navigation or input",
    "the confirmed prototype and production shell have no unexplained visible drift",
    "foreground iOS screenshots show stable composition at normal and maximum supported text size"
  ],
  "failureBehavior": [
    "do not hide runtime failure or fabricate readiness",
    "do not keep a global blocking overlay for a degradable module",
    "do not change Mobile tab lifetime or projection ownership without a reviewed architecture amendment"
  ],
  "updatedAt": "2026-10-08T00:00:00.000Z"
}
```

## Current Snapshot

- The authenticated Shell can render a degradable-runtime notice as a large
  app-obstructing card over otherwise usable content.
- Shared visual rules exist, but production scale, hierarchy, identity
  projection, safe-area composition, and recovery placement are not enforced
  as one release contract.
