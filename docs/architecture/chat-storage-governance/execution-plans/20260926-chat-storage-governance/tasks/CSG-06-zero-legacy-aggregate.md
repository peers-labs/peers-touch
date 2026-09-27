# CSG-06：Chat 存储遗产归零与聚合验收

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CSG-20260926",
  "taskId": "CSG-06-zero-legacy-aggregate",
  "workstreamId": "CSG-W06",
  "title": "证明 Chat 存储治理、物理回收与九维遗产归零",
  "workClass": "product-behavior",
  "completionClass": "acceptance-aggregate",
  "executionMode": "fix",
  "closureId": "csg-zero-legacy-aggregate",
  "journeyId": "CSG-J01-J06-release",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/chat-storage-governance",
    "docs/architecture/chat-lifecycle",
    "docs/architecture/messaging-platform",
    "docs/architecture/encryption",
    "docs/client/chat",
    "docs/client/desktop",
    "docs/client/mobile",
    "docs/knowledge",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/desktop",
    "apps/mobile",
    "apps/station/app/subserver/conversation",
    "apps/station/frame/touch/model/chat",
    "model/domain/chat",
    "packages/messaging-core",
    "packages/client-chat-core",
    "packages/client-storage",
    "packages/locales",
    "packages/prototypes/desktop/features/social-chat",
    "tooling/scripts"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 14400,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "chat-storage-zero-legacy-source",
      "command": "python3 -m unittest tooling.acceptance.gates.chat_storage.zero_legacy_test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "chat-storage-zero-legacy-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-storage-zero-legacy-e2e",
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
      "id": "chat-storage-governance-aggregate-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-storage-governance-aggregate-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "All completion and full Gates pass against one exact source",
    "Desktop release build and Mobile native build pass",
    "Same-Station, cross-Station, multi-device, restart and fresh Recovery journeys pass",
    "Retention, redaction and clear do not resurrect content",
    "Successful clear lowers SQLCipher, WAL, SHM and managed-file total bytes",
    "Nine-dimensional legacy scan reports zero without allowlist suppression",
    "CCU-20260922 remains completed",
    "Runtime resources are released and final worktree is clean"
  ],
  "failureBehavior": [
    "Do not waive failed E2E with unit or screenshot evidence",
    "Treat compaction_pending as NOT_PROVEN",
    "Do not run Tauri release build with less than 20 GiB free disk",
    "Do not mark complete while any required Gate is stale"
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

- State: pending；无本模块 Acceptance evidence。
- Dependency: `CSG-05-local-clear-hard-cut`。

## Closure

冻结精确源码后执行零引用、发布构建和完整 Chat 存储治理 E2E，只负责证明与收尾。

## Concurrency Decision

- Mode: serial final aggregate。
- Runtime cells 仅在 source freeze 后按资源隔离并行。
