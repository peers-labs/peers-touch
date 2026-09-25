# CSG-04：消息 Redaction 与 Recovery

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CSG-20260926",
  "taskId": "CSG-04-redaction-recovery",
  "workstreamId": "CSG-W04",
  "title": "统一 Hide/Retract 的不可见化、ACK、回收与 Recovery",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "csg-redaction-recovery",
  "journeyId": "CSG-J05-J06",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/chat",
    "packages/messaging-core",
    "apps/station/app/subserver/conversation",
    "apps/desktop",
    "apps/mobile",
    "packages/client-chat-core",
    "packages/locales",
    "docs/architecture/messaging-platform",
    "docs/architecture/encryption",
    "docs/client/chat",
    "tooling/acceptance"
  ],
  "readSet": [
    "docs/architecture/chat-storage-governance/data-model.md",
    "docs/architecture/chat-lifecycle"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 240
  },
  "checks": [
    {
      "id": "redaction-proto-build",
      "command": "python3 tooling/scripts/acceptance-run.py --gate proto-build",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "redaction-core",
      "command": "cargo test --manifest-path packages/messaging-core/Cargo.toml storage_governance::redaction",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-storage-redaction-recovery-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-storage-redaction-recovery-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Desktop and Mobile submit canonical HideMessageForActor",
    "Hide and retract transaction commits tombstone, content removal, FTS removal, consumption marker and cursor before ACK",
    "Physical file cleanup is journaled and cannot block the ordered lane",
    "New Recovery archives exclude redacted plaintext and carry tombstones",
    "Restore reconciles newer authority redactions before exposing projections",
    "Desktop deletedMessageUlids and local-only terminal delete paths are removed"
  ],
  "failureBehavior": [
    "Do not ACK before local redaction transaction commits",
    "Do not restore redacted plaintext from new archive",
    "Do not roll back durable redaction on file deletion failure"
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

- State: pending；双端 Hide 终态与 Recovery redaction 尚未统一。
- Dependency: `CSG-03-retention`。

## Closure

只处理单条 Hide/Retract 与 Recovery，不承担整会话清理。

## Concurrency Decision

- Mode: serial after retention。
- Reason: 共享 projection、tombstone、archive 与 attachment reference schema。
