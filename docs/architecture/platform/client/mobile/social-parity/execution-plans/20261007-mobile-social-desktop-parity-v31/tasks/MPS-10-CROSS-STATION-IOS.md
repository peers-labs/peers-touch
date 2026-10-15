# MPS-10-CROSS-STATION-IOS - Desktop iOS Two-Station Proof

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MPS-20261006",
  "taskId": "MPS-10-CROSS-STATION-IOS",
  "workstreamId": "MPS-PROOF",
  "title": "Prove Desktop and iOS bidirectional Social convergence, security and recovery across two Stations",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "mps-cross-station-ios",
  "journeyId": "MSP-J07-J08-J10-CROSS-STATION-IOS",
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
      "id": "mps-cross-station-source",
      "command": "python3 -m unittest discover -s tooling/acceptance/gates/mobile -p '*social*test.py' && node tooling/scripts/architecture/module-governance.mjs validate --repo-root .",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mps-cross-station-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate mobile-social-cross-platform --runtime-cell mobile-ios-simulator --station-profile station-a=fiveArm --station-profile station-b=three",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "mps-cross-station-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate mobile-social-cross-platform --runtime-cell mobile-ios-simulator --station-profile station-a=fiveArm --station-profile station-b=three",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "mps-cross-station-functional",
    "scenarioIds": [
      "rc03-desktop-to-ios",
      "rc04-ios-to-desktop",
      "rc08-trusted-recovery",
      "rc09-authorization",
      "rc10-convergence"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 6,
    "minWarmReuseRate": 0.8,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": true
  },
  "doneWhen": [
    "Desktop Alice on Station A publishes and iOS Bob on Station B reads and interacts",
    "iOS Alice on Station A publishes and Desktop Bob on Station B reads and interacts",
    "Each RC03 and RC04 direction proves publish/read, comment, reaction, media, process restart, trusted recovery, delete or block and source outage",
    "RC03, RC04, RC08, RC09 and RC10 pass against one exact source and two authorized profiles",
    "Outage, duplicate, reorder, restart and lost interaction response converge to one source-authoritative projection",
    "Eve and Anonymous obtain no private content, media, key or sensitive metadata using real identifiers",
    "Delete, friend loss, block, unblock, recovery and revoke invalidate all affected projections and caches"
  ],
  "failureBehavior": [
    "Run make config and make env-check before every Station operation and reject loopback or deploy-environment drift",
    "Do not direct-call the remote Station or bypass shared Federation delivery",
    "Do not claim Android directions or SOCIAL_MOBILE_DESKTOP_PARITY_PROVEN"
  ],
  "updatedAt": "2026-10-07T02:06:30.000Z"
}
```

## Objective

完成所有 Desktop/iOS、两 Station、安全、恢复和故障收敛证明，并把结论严格限定为
iOS parity，直到 Android 互操作 closure 独立通过。

## Current Snapshot

- Profiles fiveArm and three are the preferred remote non-loopback pair; two is the authorized
  fallback.
- Current Mobile Social evidence does not prove Desktop-to-iOS and iOS-to-Desktop across two Stations.
- Cross-Station security, outage and interaction-return assertions need one source-bound Gate.
