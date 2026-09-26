# SAL-03：接入遗产归零与聚合验收

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SAL-20260926",
  "taskId": "SAL-03-zero-legacy-aggregate",
  "workstreamId": "SAL-W03",
  "title": "证明 Station 接入生命周期与九维遗产归零",
  "workClass": "product-behavior",
  "completionClass": "acceptance-aggregate",
  "executionMode": "build",
  "closureId": "sal-zero-legacy-aggregate",
  "journeyId": "SAL-J01-J05-release",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/station-access-lifecycle",
    "docs/architecture/access-gates",
    "docs/architecture/api-ownership",
    "docs/architecture/federation",
    "docs/architecture/identity",
    "docs/client/desktop",
    "docs/client/mobile",
    "docs/knowledge",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/desktop",
    "apps/mobile",
    "apps/station/frame/touch",
    "apps/station/app/subserver/federation",
    "model/domain/access_gate",
    "model/domain/federation",
    "model/domain/peer",
    "packages/locales",
    "tooling/scripts"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 10800,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "station-access-zero-legacy-source",
      "command": "python3 -m unittest tooling.acceptance.gates.station_access.zero_legacy_test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "station-access-zero-legacy-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-access-zero-legacy-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "desktop-release-build",
      "command": "python3 tooling/scripts/acceptance-run.py --gate desktop-release-build",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "mobile-native-build",
      "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-native-build",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "station-access-lifecycle-aggregate-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-access-lifecycle-aggregate-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "station-access-domain-validation",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-access-domain-validation",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "All plan-completion Gates pass against one exact source",
    "Desktop release build and Mobile native build pass",
    "First access, restart, switch, same-Station and cross-Station journeys pass",
    "Nine-dimensional legacy scan reports zero without allowlist suppression",
    "CCU-20260922 remains completed",
    "Runtime resources are released and the final worktree is clean"
  ],
  "failureBehavior": [
    "Do not waive a failed E2E with unit or screenshot evidence",
    "Do not run Tauri release build with less than 20 GiB free disk",
    "Do not mark complete while any required Gate is stale or not current-source PASS"
  ],
  "updatedAt": "2026-09-26T11:36:10.000Z",
  "durableEvidence": [
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "acceptance-run 20260926T111207959347Z-954df736a40dd1ece23fafa431f124e9; gap detector PROVEN"
    }
  ]
}
```

## Current Snapshot

- State: done。
- Completion run 20/20 PASS；九维遗产扫描、Desktop release、Mobile native、
  聚合 Gate 与 Station Access domain validation 均为 exact-source proof。

## Closure

冻结精确源码后执行零引用、发布构建和完整接入 E2E，只负责证明与收尾。

## Concurrency Decision

- Mode: serial final aggregate。
- Runtime cells 仅在 source freeze 后按资源隔离并行。
