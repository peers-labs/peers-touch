# SAL-01：可信 Station 与 Access Gate 硬切

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SAL-20260926",
  "taskId": "SAL-01-access-hard-cut",
  "workstreamId": "SAL-W01",
  "title": "统一签名 Station identity、protobuf Access Gate 与 scope",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "sal-access-hard-cut",
  "journeyId": "SAL-J01-J03-J05",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/access_gate",
    "model/domain/peer/station_identity.proto",
    "apps/station/frame/touch",
    "apps/desktop",
    "apps/mobile",
    "docs/architecture/access-gates",
    "docs/architecture/api-ownership",
    "docs/client/desktop",
    "docs/client/mobile",
    "docs/knowledge",
    "tooling/acceptance"
  ],
  "readSet": [
    "docs/architecture/station-access-lifecycle",
    "docs/architecture/identity",
    "docs/architecture/service-coordination.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
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
      "id": "station-access-capability-contract",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-access-capability-contract",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "station-access-auth-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-access-auth-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "station-access-scope-isolation-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-access-scope-isolation-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Desktop and Mobile verify the same signed Station identity before credential submission",
    "Both clients use application/protobuf on the four canonical Access endpoints",
    "Session, Messaging and local projections share Station, Actor and Device scope",
    "Switch and restart expose no stale scope projection",
    "Direct login, auth_login, legacy submission, JSON dual parsing and unscoped keys are deleted",
    "Unknown gate, identity mismatch and expiry produce matching typed outcomes"
  ],
  "failureBehavior": [
    "Never fall back to /actor/login",
    "Never accept reachability metadata as Station identity",
    "Never retain compatibility parsing or migration reads"
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

- State: pending；未修改接入代码。
- Next: Owner 批准并在新 worktree 建立 Plan binding 后执行。

## Closure

真实 Desktop 与 Mobile 从 clean install 完成 identity 验证、Access Gate、runtime
bootstrap、重启恢复和 scope 切换，旧 Station 不在兼容声明内。

## Concurrency Decision

- Mode: serial foundation。
- Reason: 接入协议、scope、客户端 runtime 与 Acceptance 是后续边界的共同前置。
