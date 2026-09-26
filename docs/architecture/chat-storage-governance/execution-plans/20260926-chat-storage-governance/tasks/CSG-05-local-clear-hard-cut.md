# CSG-05：按会话清理与旧语义硬切

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CSG-20260926",
  "taskId": "CSG-05-local-clear-hard-cut",
  "workstreamId": "CSG-W05",
  "title": "交付 sequence-bound 会话清理并删除旧 clear、timer 与 compat schema",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "csg-local-clear-hard-cut",
  "journeyId": "CSG-J04-J06",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "model/domain/chat",
    "apps/station/frame/touch/model/chat",
    "apps/station/app/subserver/conversation",
    "packages/messaging-core",
    "apps/desktop",
    "apps/mobile",
    "packages/client-chat-core",
    "packages/locales",
    "packages/prototypes/desktop/features/social-chat",
    "packages/prototypes/mobile/chat",
    "docs/architecture/chat-lifecycle",
    "docs/architecture/messaging-platform",
    "docs/client/chat",
    "tooling/acceptance",
    "tooling/scripts"
  ],
  "readSet": [
    "docs/architecture/chat-storage-governance/legacy-inventory.json"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "conversation-clear-core",
      "command": "cargo test --manifest-path packages/messaging-core/Cargo.toml storage_governance::conversation_clear",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-storage-dead-contract-zero-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-storage-dead-contract-zero-e2e",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "chat-storage-delete-reclaim-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-storage-delete-reclaim-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Manual clear freezes verified authority sequence and hash",
    "Current device removes eligible projection, FTS, completed transfer metadata and zero-reference media",
    "Ordinary sync and pagination cannot restore cleared plaintext while new messages continue",
    "cleared_at, 24-hour restore and disappear timer are zero-reference",
    "Affected backfills, compatibility readers and old archive schema are absent",
    "Both native clients prove physical byte reduction after successful compact"
  ],
  "failureBehavior": [
    "Do not mutate Station authority or another device",
    "Do not advance floor when deletion transaction fails",
    "Treat compaction_pending as incomplete physical evidence",
    "Do not implement disappearing messages"
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

- State: pending；当前仍有旧 clear/restore、timer 与 compatibility schema。
- Dependency: `CSG-04-redaction-recovery`。

## Closure

新本机会话清理与旧 actor-wide clear 不能并存；同一 closure 完成替换、删除和物理证明。

## Concurrency Decision

- Mode: serial hard cut。
- Reason: floor、projection schema、Station legacy fields 与双端 UI 必须同提交一致。
