# CSG-01：Chat 存储契约与真实统计

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CSG-20260926",
  "taskId": "CSG-01-storage-observability",
  "workstreamId": "CSG-W01",
  "title": "交付双端真实 Chat 总量与按会话统计",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "csg-storage-observability",
  "journeyId": "CSG-J01",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/chat/storage.proto",
    "packages/messaging-core",
    "apps/desktop",
    "apps/mobile",
    "packages/locales",
    "docs/client/chat",
    "docs/client/desktop",
    "docs/client/mobile",
    "tooling/acceptance"
  ],
  "readSet": [
    "docs/architecture/chat-storage-governance",
    "docs/architecture/messaging-platform",
    "docs/architecture/chat-lifecycle"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "proto-build",
      "command": "python3 tooling/scripts/acceptance-run.py --gate proto-build",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "chat-storage-contract",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-storage-contract",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-storage-accounting-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-storage-accounting-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "One Proto contract defines snapshot, category, conversation usage and typed errors",
    "Shared Core counts SQLCipher, WAL, SHM and managed files without double counting",
    "Desktop and Mobile show the same category definitions and conversation ordering",
    "Measurement failures retain stale truth instead of fabricated zero",
    "Scope switches discard stale scan results",
    "Fixed-zero statistics_get is deleted or replaced by its actual non-Chat owner"
  ],
  "failureBehavior": [
    "Do not estimate physical total by summing logical rows",
    "Do not scan SQLCipher or Engine files from TypeScript",
    "Do not block Chat startup on a full scan"
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

- State: pending；未新增 Proto、Core、adapter 或 UI。
- Next: Owner 批准并在新 worktree 建立 Plan binding 后执行。

## Closure

用户在两个原生客户端看到当前设备真实总量、分类和 per-conversation 占用。

## Concurrency Decision

- Mode: serial foundation。
- Reason: contract、schema、adapter 与 UI 是所有清理能力的共同前置。
