# AFL-01 · signed-log 内核抽取（含 canonical 流派裁决）

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AFL-20261106",
  "taskId": "AFL-01",
  "workstreamId": "KERNEL",
  "title": "抽取无业务类型 signed-log 内核，治理链回归等价，裁决 securecontent canonical 关系",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "journeyId": "afl-j01-kernel",
  "closureId": "afl-01-signed-log-kernel",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/station/frame/core/signedlog",
    "packages/station-trust",
    "apps/station/app/subserver/federation/domain",
    "model/domain/federation/federation_ledger.proto"
  ],
  "readSet": [
    "apps/station/app/subserver/federation",
    "apps/station/app/internal/securecontent/canonical.go",
    "packages/station-trust",
    "model/domain/federation/federation_ledger.proto"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "afl01-go",
      "command": "go -C apps/station/app test ./subserver/federation/domain && cargo test --manifest-path packages/station-trust/Cargo.toml feed_log::tests",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl01-fmt",
      "command": "cd apps/station/app && gofmt -l .",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "afl01-purity",
      "command": "bash -lc '! rg -n \"subserver/(social|federation)\" apps/station/frame/core/signedlog'",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "共享 Frame 内核接收 bytes 或无业务类型 proto.Message，不 import federation pb 或业务类型；调用方自构 signing-input",
    "replay.go 的 applyEvent 等纯业务态留在 federation 包；actor_key.go（含 Station 代管明文 seed）不进内核",
    "产出 canonical 流派裁决文档：deterministic-marshal 与 internal/securecontent 手写 protowire 域分隔编码是统一还是域分隔并存；Rust 侧验签落点（station-trust 新增 feed 模块）同步定义",
    "author-ordered 与 sequencer-ordered 的连续性和准入策略归各自领域，字节级哈希/验签原语共用；治理 wire 字节不变",
    "federation hash/signature 不再直接调用 SHA-256 或 Ed25519 操作；治理回归与 Go/Rust 独立签名向量通过，未运行双站 Journey 保持 UNPROVEN"
  ],
  "failureBehavior": [
    "不改治理链 wire 格式与 sequencer 语义",
    "actor_key 业务策略不进内核",
    "不接入朋友圈"
  ],
  "updatedAt": "2026-11-06T13:30:00.000Z"
}
```

## 完整闭环

输入是治理链现有哈希/验签实现与 securecontent canonical 传统；输出是无业务类型内核 + canonical 流派裁决 + 治理链等价回归。审查专项结论：hash/signature 机制层可抽，但函数现绑定 federation pb，调用方须自构 hash-input；author-ordered 策略当前零代码，是新设计。
