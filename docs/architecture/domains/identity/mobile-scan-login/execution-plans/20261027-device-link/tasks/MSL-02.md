# MSL-02：Schema 链接与码图闭环

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MSL-20261027",
  "taskId": "MSL-02",
  "workstreamId": "SCHEMA",
  "title": "统一 typed action 编码解析与标准 QR 展示",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "msl-schema",
  "journeyId": "SCH-A01",
  "runtimeClass": "source-only",
  "writeSet": ["model/domain/schema", "model/domain/auth/device_link.proto", "model/domain/peer/bootstrap_blob.proto", "model/build.sh", "apps/desktop", "apps/mobile", "packages/schema", "packages/schema-core", "pnpm-lock.yaml", "docs/architecture/shared/schema"],
  "readSet": ["docs/architecture/domains/identity/mobile-scan-login", "packages/station-trust", "docs/knowledge"],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 300, "cleanupSeconds": 30},
  "checks": [
    {"id": "msl02-source", "command": "pnpm --dir packages/schema-core run check", "verificationClass": "SOURCE_CHECK"},
    {"id": "msl02-roundtrip", "command": "pnpm --dir packages/schema run verify:qr", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["所有旧 QR 与 DeepURL 消费者切换后删除旧 helper 和依赖", "classic peers avatar 实际 encoder 密度受限，独立 decoder 还原相同字节", "安全核对和外部频道保持 presentation-only 原始载荷"],
  "failureBehavior": ["不得自己实现 QR 纠错或掩码", "无法保护功能模块则降级标准样式，超密不得缩小模块"],
  "updatedAt": "2026-10-27T01:00:00.000Z"
}
```
