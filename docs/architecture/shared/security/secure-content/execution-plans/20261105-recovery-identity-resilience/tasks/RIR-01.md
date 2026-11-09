# RIR-01：Station Identity Recovery Vault 能力

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RIR-20261105",
  "taskId": "RIR-01",
  "workstreamId": "VAULT",
  "title": "Actor Identity 托管客户端密文 Recovery Vault（GET JWT-only / PUT 设备证明 + 单调 epoch）",
  "workClass": "infrastructure",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "rir-vault",
  "journeyId": "RG-2",
  "runtimeClass": "source-only",
  "writeSet": [
    "model/domain/actor",
    "apps/station/app/subserver/actor_identity",
    "apps/station/frame/core/types",
    "docs/architecture/domains/identity"
  ],
  "readSet": [
    "docs/architecture/shared/security/secure-content/recovery-identity-resilience-amendment.md",
    "docs/architecture/domains/identity/unified-actor-system.md"
  ],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 300, "cleanupSeconds": 60},
  "checks": [
    {"id": "rir01-build", "command": "go -C apps/station build ./frame/... ./app/...", "verificationClass": "SOURCE_CHECK"},
    {"id": "rir01-actor-tests", "command": "go -C apps/station test ./app/subserver/actor_identity/... -count=1 -timeout=120s", "verificationClass": "SOURCE_CHECK"},
    {"id": "rir01-contract", "command": "./model/build.sh", "verificationClass": "STRUCTURAL_CHECK"}
  ],
  "doneWhen": [
    "proto-first vault 消息与路由落地，GET 仅 actor JWT，PUT 需要新增 active-device 持有证明包装",
    "PUT 同事务强制 record version CAS 与 recovery_epoch、sealing transcript 非递减，旧 blob 回滚返回 stale 错误，Station 永不解析密文",
    "vault 行按 actor 唯一限定，缺省/越权响应同形，速率限制生效，actor_identity 单测全过"
  ],
  "failureBehavior": [
    "Station 不得解析或记录 sealed_vault 明文",
    "未 enroll 设备无法满足 PUT 证明；GET 不得挂设备持有证明中间件"
  ],
  "updatedAt": "2026-11-05T00:00:00.000Z"
}
```
