# MPS-11A-ANDROID-SAME-STATION - Physical Android Native Closure

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MPS-20261006",
  "taskId": "MPS-11A-ANDROID-SAME-STATION",
  "workstreamId": "MPS-PROOF",
  "title": "Prove complete same-Station Social behavior on the USB-authorized physical Android device",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "mps-android-same-station",
  "journeyId": "MSP-J01-J05-J09-ANDROID",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/mobile/src/acceptance",
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
    "functionalRunSeconds": 10800,
    "cleanupSeconds": 900
  },
  "checks": [
    {
      "id": "mps-android-same-station-source",
      "command": "pnpm --dir apps/mobile exec vitest run src/acceptance src/features/social src/pages/moments src/runtimes && python3 -m unittest discover -s tooling/acceptance/gates/mobile -p '*native*test.py'",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mps-android-same-station-ux",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate mobile-social-android-native --runtime-cell mobile-android-physical --station-profile station-a=fiveArm",
      "verificationClass": "UX_REVIEW"
    },
    {
      "id": "mps-android-same-station-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate mobile-social-android-native --runtime-cell mobile-android-physical --station-profile station-a=fiveArm",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "mps-android-same-station-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate mobile-social-android-native --runtime-cell mobile-android-physical --station-profile station-a=fiveArm",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "mps-android-same-station-functional",
    "scenarioIds": [
      "rc02-home-explore",
      "rc02-search-profile",
      "rc02-circles-publish",
      "rc02-thread-reaction",
      "rc02-recovery-lifecycle",
      "rc02-native-quality"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 3,
    "minWarmReuseRate": 0.8,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "adb records one authorized physical serial plus model, Android version, API level, ABI and a false or empty ro.kernel.qemu value",
    "Alice, Bob and Eve execute the RC02 same-Station suite on that physical Android product surface without an Emulator substitute",
    "RC02 produces receiver-visible and authoritative observations for PA01-PA09, PA14-PA15 and PA18-PA19",
    "Android keyboard, safe area, system back, accessibility, background, restart, scope switch and bounded-list assertions pass",
    "The selected Station is fiveArm, or three then two only after an active claim or failed environment check makes the preceding profile unavailable",
    "Physical-device sessions, forwarded ports, app data fixtures and leases return to baseline without resetting shared accounts"
  ],
  "failureBehavior": [
    "Run make config and make env-check before every Station operation and reject loopback or deploy-environment drift",
    "Never substitute an Android Emulator, unauthorized serial or stale device evidence",
    "If no authorized USB device exists, record the deterministic blocker and keep RC02 BLOCKED/UNPROVEN",
    "Do not reset accounts, claim cross-platform directions or emit SOCIAL_MOBILE_DESKTOP_PARITY_PROVEN"
  ],
  "updatedAt": "2026-10-06T18:22:10.000Z"
}
```

## Objective

先关闭不依赖 iOS 的 physical Android 同站产品结果，并建立可被后续互操作矩阵复用的
Android Journey、设备身份和非破坏性 Suite Runtime。

## Current Snapshot

- MPS-08C lifecycle source is complete at `dcfe62695`.
- Reusable Social Journey actions and non-destructive fixture support exist at `94895fb53` and
  `02075d6bf`.
- `fiveArm`, `three` and `two` are authorized existing remote profiles; `fiveArm` is preferred.
- No Android serial was visible to `adb devices -l` when v29 was prepared, so runtime proof remains
  blocked until macOS enumerates and authorizes the USB device.
