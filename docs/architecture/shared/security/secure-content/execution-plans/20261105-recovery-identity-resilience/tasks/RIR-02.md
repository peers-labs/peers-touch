# RIR-02：portable-core 恢复身份生命周期

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RIR-20261105",
  "taskId": "RIR-02",
  "workstreamId": "CORE",
  "title": "三域 KDF、master 包装链与 Recovery Identity lifecycle 状态机（host 端口契约）",
  "workClass": "infrastructure",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "rir-core",
  "journeyId": "RG-4",
  "runtimeClass": "source-only",
  "writeSet": [
    "packages/secure-content-core"
  ],
  "readSet": [
    "docs/architecture/shared/security/secure-content/recovery-identity-resilience-amendment.md",
    "docs/architecture/shared/security/secure-content/security.md"
  ],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 300, "cleanupSeconds": 60},
  "checks": [
    {"id": "rir02-cargo", "command": "cargo test --offline --manifest-path packages/secure-content-core/Cargo.toml -q", "verificationClass": "SOURCE_CHECK"},
    {"id": "rir02-kdf-vectors", "command": "cargo test --offline --manifest-path packages/secure-content-core/Cargo.toml recovery -- -q", "verificationClass": "STRUCTURAL_CHECK"}
  ],
  "doneWhen": [
    "identity-vault / identity-master-wrap / SC-D16 三域 transcript 字节确定且各有规范向量",
    "lifecycle ABSENT/CREATING/READY/ROTATING/RECOVERED/RESET 状态转移与非法转移全部单测覆盖",
    "wrapped master AEAD 绑定 (actor, epoch, entry_version) AAD，挪移/重排条目必失败；key-material host 端口扩展为 create/rotate/recover 三类"
  ],
  "failureBehavior": [
    "core 不持网络、不生成 UI、不持久化明文短语",
    "缺旧 epoch master 时禁止用当前 epoch 替代，错误为类型化 key-unavailable"
  ],
  "updatedAt": "2026-11-05T00:00:00.000Z"
}
```
