# MPS-11B-ANDROID-INTEROP - Physical Android Interoperation

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MPS-20261006",
  "taskId": "MPS-11B-ANDROID-INTEROP",
  "workstreamId": "MPS-PROOF",
  "title": "Prove Desktop and iOS interoperability with the USB-authorized physical Android device",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "mps-android-interoperability",
  "journeyId": "MSP-J05-J10-ANDROID-INTEROP",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/mobile/src",
    "apps/mobile/src-tauri",
    "packages/locales",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/desktop",
    "apps/mobile",
    "apps/station",
    "docs/architecture/domains/social/core",
    "docs/architecture/domains/social/cross-station",
    "docs/architecture/shared/federation",
    "docs/architecture/shared/security/secure-content"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 10800,
    "cleanupSeconds": 900
  },
  "checks": [
    {
      "id": "mps-android-interop-source",
      "command": "python3 -m unittest discover -s tooling/acceptance/gates/mobile -p '*social*test.py' && node tooling/scripts/architecture/module-governance.mjs validate --repo-root .",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mps-android-interop-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate mobile-social-android-interoperability --runtime-cell mobile-ios-android-physical --station-profile station-a=fiveArm --station-profile station-b=three",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "mps-android-interop-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate mobile-social-android-interoperability --runtime-cell mobile-ios-android-physical --station-profile station-a=fiveArm --station-profile station-b=three",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "mps-android-interop-functional",
    "scenarioIds": [
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
    "RC05 proves Desktop-to-Android Social outcomes across two source-attested Stations",
    "RC06 proves Android-to-Desktop Social outcomes across two source-attested Stations",
    "RC07 proves iOS-to-Android and Android-to-iOS cross-mobile outcomes",
    "Every direction proves publish/read, comment, reaction, media, process restart, trusted recovery, delete or block and source outage",
    "The physical Android identity matches the authorized non-Emulator device class and current exact source",
    "All Desktop, Simulator, physical-device, Appium, fixture, port and lease resources return to baseline"
  ],
  "failureBehavior": [
    "Run make config and make env-check before every Station operation and reject loopback or deploy-environment drift",
    "Use fiveArm and three when available; replace one with two only after an active claim or failed environment check",
    "Never substitute an Android Emulator or downgrade missing iOS/Android directions into same-Station proof",
    "Keep RC05, RC06 or RC07 UNPROVEN when its receiver-visible or authoritative evidence is missing"
  ],
  "updatedAt": "2026-10-07T02:06:30.000Z"
}
```

## Objective

在 Android 同站和 iOS 跨站闭环均完成后，复用同一 Android 设备与 Journey adapter，
补齐 Desktop/Android 和 iOS/Android 的双向两 Station 互操作证明。

## Current Snapshot

- This closure intentionally depends on both MPS-11A and MPS-10.
- MPS-11A owns RC02 and physical Android quality; this Task owns only RC05-RC07.
- Source-backed Mobile remediation found during RC05-RC07 remains inside this Task's write boundary.
- `two` is the authorized fallback when either preferred Station profile is unavailable.
