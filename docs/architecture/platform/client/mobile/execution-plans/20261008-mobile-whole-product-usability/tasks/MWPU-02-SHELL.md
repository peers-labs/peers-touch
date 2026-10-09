# MWPU-02-SHELL: Shared Mobile And Desktop Foundation

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-whole-product-usability-20261008",
  "taskId": "MWPU-02-SHELL",
  "workstreamId": "MWPU-FOUNDATION",
  "title": "Align Mobile and Desktop shell, identity, runtime, and recovery composition",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "mobile-shell-foundation",
  "journeyId": "MS-J08",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/desktop/src",
    "apps/mobile/scripts",
    "apps/mobile/src-tauri/gen/apple/peers-touch-mobile_iOS/Info.plist",
    "apps/mobile/src-tauri/plugins/platform-permissions/ios/Sources/PlatformPermissionsPlugin.swift",
    "apps/mobile/src/App.tsx",
    "apps/mobile/src/components",
    "apps/mobile/src/pages/SettingsPage.tsx",
    "apps/mobile/src/runtimes/sessionRuntime.ts",
    "apps/mobile/src/runtimes/sessionRuntime.test.ts",
    "apps/mobile/src/styles.css",
    "apps/mobile/src/app/mobileI18n.tsx",
    "apps/station/app/subserver/actor_identity",
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
      "command": "pnpm --dir apps/desktop run check && pnpm --dir apps/mobile run check:web && pnpm --dir apps/mobile run check:recovery-ui && pnpm --dir apps/mobile exec vitest run src/runtimes/sessionRuntime.test.ts && python3 apps/mobile/scripts/ios_build_archive_test.py",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "shell-foreground-functional",
      "command": "node apps/mobile/scripts/run-three-client-product-journey.mjs --phase shell",
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
    "scenarioIds": ["android-alice-shell", "desktop-bob-shell", "ios-coral-shell"],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 3,
    "minWarmReuseRate": 0.66,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "Android, Desktop, and iOS shell typography, spacing, identity, navigation, notices, sheets, and modal layers follow their production UI contracts",
    "friendly names are primary and technical identifiers are diagnostic-only",
    "module degradation stays inside the owning surface and never obstructs unrelated navigation or input",
    "the confirmed prototype and production shell have no unexplained visible drift",
    "foreground Android Alice, Desktop Bob, and iOS Coral screenshots show stable composition and no stale installed package"
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
