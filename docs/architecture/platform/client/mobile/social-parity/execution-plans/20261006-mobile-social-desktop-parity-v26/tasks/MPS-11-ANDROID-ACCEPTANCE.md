# MPS-11-ANDROID-ACCEPTANCE - Physical Android Interoperation

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MPS-20261006",
  "taskId": "MPS-11-ANDROID-ACCEPTANCE",
  "workstreamId": "MPS-PROOF",
  "title": "Prove same-Station and cross-platform Social parity on the USB-authorized physical Android device",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "mps-android-acceptance",
  "journeyId": "MSP-J01-J10-ANDROID",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/mobile/src/acceptance",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/desktop",
    "apps/mobile",
    "apps/station",
    "docs/architecture/domains/social/core",
    "docs/architecture/domains/social/cross-station"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 10800,
    "cleanupSeconds": 900
  },
  "checks": [
    {
      "id": "mps-android-source",
      "command": "pnpm --dir apps/mobile exec vitest run src/acceptance && python3 -m unittest discover -s tooling/acceptance/gates/mobile -p '*native*test.py'",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mps-android-ux",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate mobile-social-android-native --runtime-cell mobile-ios-android-physical --station-profile station-a=four --station-profile station-b=fiveArm",
      "verificationClass": "UX_REVIEW"
    },
    {
      "id": "mps-android-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate mobile-social-android-native --runtime-cell mobile-ios-android-physical --station-profile station-a=four --station-profile station-b=fiveArm",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "mps-android-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate mobile-social-android-native --runtime-cell mobile-ios-android-physical --station-profile station-a=four --station-profile station-b=fiveArm",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "mps-android-functional",
    "scenarioIds": [
      "rc02-android-same-station",
      "rc05-desktop-to-android",
      "rc06-android-to-desktop",
      "rc07-ios-android"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 6,
    "minWarmReuseRate": 0.75,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": true
  },
  "doneWhen": [
    "The Gate registers one mobile-ios-android-physical cell that composes iOS Simulator and the USB physical Android device",
    "adb devices -l records one authorized physical serial and the evidence records model and Android version",
    "RC02 same-Station Social passes on the physical Android product surface",
    "RC05 and RC06 prove Desktop-to-Android and Android-to-Desktop across two Stations",
    "RC07 proves iOS-to-Android and Android-to-iOS cross-mobile outcomes",
    "Every RC05, RC06 and RC07 direction proves publish/read, comment, reaction, media, process restart, trusted recovery, delete or block and source outage",
    "Android keyboard, safe area, back, accessibility, background, restart and bounded-list assertions pass",
    "Physical-device sessions, forwarded ports, app data fixtures and leases return to baseline"
  ],
  "failureBehavior": [
    "Run make config and make env-check before every Station operation and reject loopback or deploy-environment drift",
    "Never substitute an Android Emulator or unauthorized device",
    "If no authorized USB device exists, record the first deterministic blocker and keep RC02/RC05/RC06/RC07 BLOCKED/UNPROVEN",
    "Do not downgrade a blocked Android matrix into an iOS or static substitute"
  ],
  "updatedAt": "2026-10-06T07:42:44.000Z"
}
```

## Objective

复用已通过的 Social Journey 和双 Station runtime，只补齐 physical Android 特有的
产品面、生命周期和六向互操作证明。

## Current Snapshot

- `adb devices -l` returned no connected authorized device during Plan preparation.
- No serial, model or Android version can be truthfully recorded yet.
- This Task is parkable without invalidating completed iOS closures, but it blocks the aggregate claim.
