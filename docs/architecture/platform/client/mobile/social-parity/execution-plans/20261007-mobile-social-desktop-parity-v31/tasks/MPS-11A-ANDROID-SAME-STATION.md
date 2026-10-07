# MPS-11A-ANDROID-SAME-STATION - Physical Android Native Closure

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MPS-20261006",
  "taskId": "MPS-11A-ANDROID-SAME-STATION",
  "workstreamId": "MPS-PROOF",
  "title": "Align Peers Android branding and confirmed Social UX, then prove same-Station behavior on the USB-authorized physical device",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "mps-android-same-station",
  "journeyId": "MSP-J01-J05-J09-ANDROID",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/mobile/src",
    "apps/mobile/src-tauri",
    "packages/locales",
    "packages/prototypes/mobile/chat",
    "docs/architecture/platform/client/mobile/social-parity/prototype",
    "tooling/acceptance",
    "tooling/scripts/local-dev/dev-session.mjs",
    "tooling/scripts/local-dev/dev-session.test.mjs",
    "tooling/scripts/generate-mobile-brand-assets.py"
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
      "command": "python3 tooling/scripts/generate-mobile-brand-assets.py --check && pnpm --dir apps/mobile exec vitest run src/acceptance src/components src/features/social src/pages src/runtimes && python3 -m unittest discover -s tooling/acceptance/gates/mobile -p '*native*test.py'",
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
    "Android launcher uses the Peers wordmark through adaptive foreground, solid background, monochrome and round-icon resources without a baked vendor mask",
    "OPPO ColorOS applies its own launcher mask with no clipped wordmark, mismatched corner radius or Tauri default icon",
    "Home/Explore, Search/Profile, Circles, Composer/Audience, Thread/Reaction/Media and recovery/lifecycle interactions match the confirmed Mobile Social prototype structure and geometry",
    "Production and prototype use a bottom-anchored composer with the text input as the dominant surface and compact audience/action controls",
    "Alice, Bob and Eve execute the RC02 same-Station suite on that physical Android product surface without an Emulator substitute",
    "RC02 produces receiver-visible and authoritative observations for PA01-PA09, PA14-PA15 and PA18-PA19",
    "Android keyboard, safe area, system back, accessibility, background, restart, scope switch and bounded-list assertions pass",
    "The selected Station is fiveArm, or three then two only after an active claim or failed environment check makes the preceding profile unavailable",
    "Physical-device sessions, forwarded ports, app data fixtures and leases return to baseline without resetting shared accounts"
  ],
  "failureBehavior": [
    "Run make config and make env-check before every Station operation and reject loopback or deploy-environment drift",
    "Never substitute an Android Emulator, unauthorized serial or stale device evidence",
    "Do not modify the prototype to excuse production drift; update both only for an explicit owner-approved product decision",
    "If no authorized USB device exists, record the deterministic blocker and keep RC02 BLOCKED/UNPROVEN",
    "Do not reset accounts, claim cross-platform directions or emit SOCIAL_MOBILE_DESKTOP_PARITY_PROVEN"
  ],
  "updatedAt": "2026-10-07T02:06:30.000Z"
}
```

## Objective

先修正物理 Android 上已确认的品牌与产品交互偏差，再关闭同站产品结果，并建立可被
后续互操作矩阵复用的 Android Journey、设备身份和非破坏性 Suite Runtime。

## Current Snapshot

- MPS-08C lifecycle source is complete at `dcfe62695`.
- Reusable Social Journey actions and non-destructive fixture support exist at `94895fb53` and
  `02075d6bf`.
- `fiveArm`, `three` and `two` are authorized existing remote profiles; `fiveArm` is preferred.
- OPPO PEEM00 serial `dbf93cb7` is USB-authorized and non-emulated.
- v29 diagnostics proved Appium session creation and non-streaming APK install, but the generated
  Android launcher still contains the Tauri default icon.
- The confirmed Social prototype is the product source; production still uses card feed chrome and
  an inline composer that do not match its flat Feed and BottomSheet interaction model.
