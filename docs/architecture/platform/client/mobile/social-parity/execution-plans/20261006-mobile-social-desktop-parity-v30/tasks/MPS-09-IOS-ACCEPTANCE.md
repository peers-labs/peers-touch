# MPS-09-IOS-ACCEPTANCE - iOS Native Functional Closure

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MPS-20261006",
  "taskId": "MPS-09-IOS-ACCEPTANCE",
  "workstreamId": "MPS-MOBILE-SOCIAL",
  "title": "Inject reusable Social Journeys and prove complete same-Station behavior on isolated iOS Simulators",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "mps-ios-acceptance",
  "journeyId": "MSP-J01-J09-IOS",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/mobile/src",
    "apps/mobile/src-tauri",
    "packages/locales",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/mobile",
    "apps/station",
    "docs/architecture/domains/social/core",
    "docs/architecture/platform/client/mobile/social-parity"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 7200,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "mps-ios-source",
      "command": "pnpm --dir apps/mobile exec vitest run src/acceptance src/features/social src/pages/moments src/runtimes && python3 -m unittest tooling.acceptance.gates.mobile.simulator_social_e2e_test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mps-ios-ux",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate mobile-social-ios-native --runtime-cell mobile-ios-simulator --station-profile station-a=fiveArm",
      "verificationClass": "UX_REVIEW"
    },
    {
      "id": "mps-ios-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate mobile-social-ios-native --runtime-cell mobile-ios-simulator --station-profile station-a=fiveArm",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "mps-ios-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate mobile-social-ios-native --runtime-cell mobile-ios-simulator --station-profile station-a=fiveArm",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "mps-ios-functional",
    "scenarioIds": [
      "rc01-home-explore",
      "rc01-search-profile",
      "rc01-circles-publish",
      "rc01-thread-reaction",
      "rc01-recovery-lifecycle",
      "rc01-native-quality"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 2,
    "minWarmReuseRate": 0.8,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": true
  },
  "doneWhen": [
    "Reusable production Journey actions cover Home, Explore, Search, Profile, Circles, Audience, publish, thread, reactions, recovery and scope switch",
    "Two isolated iOS Simulators exercise Alice, Bob and Eve against a source-attested real Station and OSS",
    "RC01 produces receiver-visible and authoritative same-Station iOS observations for the aggregate",
    "Inline comments, media overlay, keyboard, safe area, accessibility, long text and bounded list budgets pass",
    "Appium sessions, Simulators, object URLs, accounts and runtime leases return to their declared cleanup baseline"
  ],
  "failureBehavior": [
    "Do not use prototype, web-only, source-only or stale-source evidence as Native proof",
    "Do not provision inside a business Gate or replace a prepared runtime during a Scenario",
    "Do not claim Android, cross-Station or full parity from this closure"
  ],
  "updatedAt": "2026-10-07T02:06:30.000Z"
}
```

## Objective

先建立可复用的 Mobile Social Journey adapter，再以真实 iOS product surface 关闭
same-Station functional loop，为跨 Station 和 Android 复用同一动作契约。

## Current Snapshot

- Reusable Social Journey actions exist at `94895fb53`.
- Non-destructive iOS fixture support exists at `02075d6bf`.
- Source checks passed; the earlier Android-first pause is lifted by the Owner-approved v30 Plan Run.
- Any cross-platform production remediation discovered by iOS exact-source proof remains inside this
  Task's Mobile write boundary.
