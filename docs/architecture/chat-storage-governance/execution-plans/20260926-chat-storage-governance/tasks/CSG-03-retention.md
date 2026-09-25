# CSG-03：本机消息保留周期

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CSG-20260926",
  "taskId": "CSG-03-retention",
  "workstreamId": "CSG-W03",
  "title": "交付四档本机 retention 与安全 pruning worker",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "csg-retention",
  "journeyId": "CSG-J03-J06",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "model/domain/chat/storage.proto",
    "packages/messaging-core",
    "apps/desktop",
    "apps/mobile",
    "packages/locales",
    "tooling/acceptance"
  ],
  "readSet": [
    "docs/architecture/chat-storage-governance/data-model.md",
    "docs/architecture/messaging-platform"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 3000,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "storage-retention-check",
      "command": "cargo check --manifest-path packages/messaging-core/Cargo.toml",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "storage-retention-core",
      "command": "cargo test --manifest-path packages/messaging-core/Cargo.toml storage_governance::retention",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-storage-retention-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-storage-retention-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Forever, 365-day, 90-day and 30-day presets share one enum and meaning",
    "Policy is scoped to current Station, actor and device",
    "Only durable-consumed projections and zero-reference media are eligible",
    "Reliability, crypto, drafts and active transfers are preserved",
    "Pruning boundary is frozen by authority sequence and hash",
    "Ordinary reconcile and history pagination respect the floor",
    "New Recovery archives preserve floor without pruned plaintext"
  ],
  "failureBehavior": [
    "Stop pruning on uncertain dependency",
    "Do not advance floor after failed transaction",
    "Do not claim Station-side or cross-device retention"
  ],
  "updatedAt": "2026-09-26T00:00:00.000Z",
  "durableEvidence": [
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "NOT_RUN",
      "ref": "Prepared plan; execution not started"
    }
  ]
}
```

## Current Snapshot

- State: pending；未新增 retention schema、worker 或 UI。
- Dependency: `CSG-02-cache-cleanup`。

## Closure

以真实时间边界、重启和离线消息证明 retention，不以短 fixture 或 UI 状态代替。

## Concurrency Decision

- Mode: serial after CSG-02。
- Reason: 与 cache cleanup 共享 Core/schema/worker ownership。
