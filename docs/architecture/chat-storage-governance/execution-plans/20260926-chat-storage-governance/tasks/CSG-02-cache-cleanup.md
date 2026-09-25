# CSG-02：可再生成缓存清理

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CSG-20260926",
  "taskId": "CSG-02-cache-cleanup",
  "workstreamId": "CSG-W02",
  "title": "统一双端 Chat cache 分类、journal 与物理清理",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "csg-cache-cleanup",
  "journeyId": "CSG-J02-J06",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "packages/messaging-core",
    "apps/desktop",
    "apps/mobile",
    "packages/locales",
    "tooling/acceptance"
  ],
  "readSet": [
    "model/domain/chat/storage.proto",
    "docs/architecture/chat-storage-governance/data-model.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "storage-cache-check",
      "command": "cargo check --manifest-path packages/messaging-core/Cargo.toml",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "storage-cache-core",
      "command": "cargo test --manifest-path packages/messaging-core/Cargo.toml storage_governance::cache",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-storage-cache-clear-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-storage-cache-clear-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Regenerable and protected Chat storage classes are centrally declared",
    "Desktop and Mobile clear the same Engine-managed cache classes",
    "Drafts, active transfers, reliability state, crypto and exported files remain intact",
    "Candidate items are immutable after confirmation",
    "Interrupted cleanup resumes idempotently from its journal",
    "UI reports actual physical bytes released"
  ],
  "failureBehavior": [
    "Abort when the candidate set includes a protected class",
    "Keep failed file items retryable",
    "Never translate partial cleanup into full success"
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

- State: pending；未修改 cache 分类或 cleanup worker。
- Dependency: `CSG-01-storage-observability`。

## Closure

只交付“清理可再生成 Chat 缓存”，不删除消息或执行 retention。

## Concurrency Decision

- Mode: serial after CSG-01。
- Reason: 与后续 Task 共享 Core、journal 和双端 adapter。
