# SRCH-D02：本机 FTS 分词直写与跨会话查询

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SRCH-20261022",
  "taskId": "SRCH-D02",
  "workstreamId": "DEVICE-INDEX",
  "title": "消息 FTS 分词直写、跨会话只读查询与可见性守卫，Mobile 行为保持",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "srch-j02-device-fts",
  "closureId": "srch-d02-device-fts-cjk",
  "runtimeClass": "source-only",
  "writeSet": [
    "packages/messaging-core/src/store/schema.rs",
    "apps/desktop/src-tauri/src/messaging/store.rs"
  ],
  "readSet": [
    "packages/search-core",
    "apps/mobile/src-tauri/src/messaging/adapter.rs",
    "docs/architecture/domains/search/feasibility-evidence.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "srch-d02-messaging-core-tests",
      "command": "cargo test --manifest-path packages/messaging-core/Cargo.toml",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "srch-d02-desktop-store-tests",
      "command": "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml messaging::store",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "srch-d02-mobile-build-awareness",
      "command": "cargo check --manifest-path apps/mobile/src-tauri/Cargo.toml",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "srch-d02-mobile-fts-tests",
      "command": "cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml messaging",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "srch-d02-cjk-write-probe",
      "command": "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml messaging::store::search_fts_cjk_probe",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "FTS 表形、列与 tokenize='unicode61' 不变；Desktop host 写入 plaintext/attachment_filenames 的内容统一经过 search-core 分词，与参数化 MATCH token AND 查询共用同一分析器",
    "共享 schema 不增加搜索 generation、meta 表、版本标记、重建钩子或兼容索引；Desktop 在既有加密 SQLCipher 库的业务写入与恢复投影中直接写分词文本，不产生 plaintext dump、临时明文文件或敏感日志",
    "共享迁移对 Mobile 行为保持：Mobile 继续 raw 内容写入与整串 phrase 查询（adapter.rs 既有 DML/MATCH 不改为前提）；apps/mobile cargo check 与 messaging（含 storage_governance 中 retract 删除 FTS 投影）测试通过",
    "Desktop 暴露跨会话只读查询（仍受会话/消息既有可见性约束）；既有单会话命令 search_message_projections 的语义与排序对拉丁查询不回退，会话内 SearchMessagesModal（socialChat.searchMessages → messaging_search_messages）在新表达式下经同一命令链回归验证，保留为 S-03 局部搜索入口",
    "hidden/retracted/moderation tombstone 与删除路径对新索引同样生效；迟到事件不复活已删条目",
    "中文短词探针（二字词、中英混合、附件名）在使用新写入路径的加密库中命中预期对象；拉丁查询和现有单会话测试不回退",
    "不声明旧 raw FTS 行已自动重分词或旧客户端已兼容；这是新产品直接迭代，无启动迁移、旧查询 fallback 或 downgrade 机制"
  ],
  "failureBehavior": [
    "不通过迁移消息正文到 Station 或任何远端来解决 CJK 召回",
    "不新建与 messaging_message_search_fts 并行的第二张表、兼容 facade 或代际切换；只有原 Messaging FTS owner",
    "不在共享 schema migration 中调用 Desktop 专属分词，不新增 MessagingSchemaBackend 搜索迁移方法",
    "不改 E2EE/恢复/redaction 合同；FTS 永远是可丢弃派生状态",
    "Mobile 既有 DML/查询是已知硬编码复制点（非 DDL）：本任务只守行为，不重构；host 切换属 Mobile 后续计划"
  ],
  "updatedAt": "2026-10-23T02:00:00.000Z"
}
```

## 完整闭环

输入是当前两端 FTS 读写路径的逐符号 inventory；输出是 Desktop 分词直写与跨会话只读查询。共享 FTS 表形不改，Desktop 写入和查询使用同一核心，Mobile 保持原行为。既有会话内 SearchMessagesModal 保留，并复用原命令上的新 MATCH 表达式。全局 overlay 属 D04；本任务不把局部搜索测试作为全局产品证明。
