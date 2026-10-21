# UCA-04A：Messaging Core 机制完备化

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UCA-20261017",
  "taskId": "UCA-04A",
  "workstreamId": "MESSAGING-CORE",
  "title": "在不切换 Host 的前提下补齐 portable Messaging Core 与 ports",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "uca-messaging-core-contract",
  "journeyId": "CCR-J04A-messaging-core-contract",
  "runtimeClass": "source-only",
  "writeSet": [
    "packages/messaging-core",
    "docs/architecture/domains/chat/messaging/README.md",
    "docs/architecture/domains/chat/messaging/design.md",
    "docs/architecture/domains/chat/messaging/decisions.md",
    "docs/architecture/domains/chat/messaging/data-model.md",
    "docs/architecture/domains/chat/messaging/module-layout.md",
    "docs/architecture/domains/chat/messaging/integration.md",
    "tooling/acceptance/gates/chat",
    "tooling/acceptance/gates/unified_client/unproven.py",
    "tooling/acceptance/features/unified-client-messaging-core.yaml",
    "tooling/acceptance/capabilities/chat.yaml",
    "tooling/acceptance/domains/chat.yaml",
    "tooling/acceptance/registry.yaml",
    "tooling/acceptance/gates.yaml"
  ],
  "readSet": [
    "apps/desktop/src-tauri/src/messaging",
    "apps/mobile/src-tauri/src/messaging",
    "apps/station/app/subserver/conversation",
    "apps/station/app/subserver/key_exchange",
    "docs/knowledge",
    "model",
    "packages/secure-content-core"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "uca04a-core-source",
      "command": "cargo test --manifest-path packages/messaging-core/Cargo.toml --offline",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "uca04a-core-boundary",
      "command": "python3 -m unittest tooling.acceptance.gates.chat.unified_client_core_contract_test",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "uca04a-core-formal",
      "command": "uv run --with-requirements tooling/acceptance/requirements.txt -- python3 tooling/scripts/acceptance-run.py --gate unified-client-messaging-core-contract",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "messaging-core 提供 host-neutral engine、store policy、command outbox、reconciliation、recovery、receipt、attachment transfer 和 lifecycle fencing API",
    "所有 Host 交互通过 transport、encrypted store、file/blob、clock、key material、event sink 和 lifecycle-cancellation ports",
    "portable engine、protocol、recovery、receipt、attachment mechanism 与 ports 不导入 Tauri、OS、Desktop/Mobile app、UI 或 Station business implementation；既有 storage_governance 物理文件 owner 进入 UCA-04 精确 hard-cut inventory 且本项不得扩展",
    "当前 Desktop/Mobile 语义 inventory 的每个待迁移 owner 都映射到 core API、Host port 或明确保留的 Presentation/Host 责任",
    "持久 schema migration contract 在切换消费者前冻结，禁止双写",
    "本项不激活第二 engine；portable core 新路径在 UCA-04 hard cut 前只由测试消费"
  ],
  "failureBehavior": [
    "不通过复制 Desktop 或 Mobile 整个模块树来制造 shared crate",
    "不把 Station authority、Model contract 或跨设备业务 truth 移入 core",
    "无法通过 narrow port 表达的语义必须回到架构 owner，不暴露通用 Host escape hatch",
    "core contract 未完备时阻塞 UCA-04，不在 Host cutover 中临时补第二机制"
  ],
  "updatedAt": "2026-10-19T16:52:14.000Z"
}
```

## 完整闭环

输入是当前两端 engine/store/recovery 的逐符号 inventory；输出是可独立测试但尚未
激活的 portable core。UCA-04 才拥有消费者切换和旧 owner 删除，避免在多个 Task
之间同时运行两套持久 owner。
