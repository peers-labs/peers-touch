# UCA-04：Portable Messaging Core Hard Cut

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UCA-20261017",
  "taskId": "UCA-04",
  "workstreamId": "MESSAGING-CORE",
  "title": "把 Desktop 与 Mobile Messaging 平行语义收敛到现有 portable core",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "uca-messaging-core",
  "journeyId": "CCR-J04-messaging-core-hard-cut",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/desktop/src-tauri/src/messaging",
    "apps/desktop/src-tauri/src/interface/http_gateway",
    "apps/desktop/src-tauri/src/interface/tauri_commands",
    "apps/desktop/src-tauri/src/main.rs",
    "apps/desktop/src-tauri/src/state",
    "apps/desktop/src/runtimes",
    "apps/desktop/src/services",
    "apps/mobile/src-tauri/src/messaging",
    "apps/mobile/src-tauri/src/commands",
    "apps/mobile/src-tauri/src/lib.rs",
    "apps/mobile/src-tauri/src/state",
    "apps/mobile/src/runtimes",
    "apps/mobile/src/services",
    "packages/messaging-core",
    "docs/architecture/domains/chat/messaging/README.md",
    "docs/architecture/domains/chat/messaging/design.md",
    "docs/architecture/domains/chat/messaging/decisions.md",
    "docs/architecture/domains/chat/messaging/data-model.md",
    "docs/architecture/domains/chat/messaging/module-layout.md",
    "docs/architecture/domains/chat/messaging/integration.md",
    "docs/architecture/platform/client/cross-client-runtime/design.md",
    "docs/architecture/platform/client/cross-client-runtime/decisions.md",
    "docs/architecture/platform/client/cross-client-runtime/data-model.md",
    "docs/architecture/platform/client/cross-client-runtime/module-layout.md",
    "docs/architecture/platform/client/cross-client-runtime/integration.md",
    "tooling/acceptance/gates/chat/unified_client_core_suite.py",
    "tooling/acceptance/gates/chat/unified_client_core_suite_test.py",
    "tooling/acceptance/gates/unified_client/messaging_owner_zero.py",
    "tooling/acceptance/features/unified-client-messaging-core.yaml",
    "tooling/acceptance/features/unified-client-messaging-runtime.yaml",
    "tooling/acceptance/capabilities/chat.yaml"
  ],
  "readSet": [
    "apps/station/app/subserver/conversation",
    "apps/station/app/subserver/key_exchange",
    "docs/knowledge",
    "model",
    "packages/secure-content-core"
  ],
  "budgets": {
    "focusedCheckSeconds": 3600,
    "functionalRunSeconds": 7200,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "uca04-messaging-source",
      "command": "cargo test --manifest-path packages/messaging-core/Cargo.toml --offline && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml messaging --offline && cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml messaging --offline && python3 -m unittest tooling.acceptance.gates.chat.unified_client_core_suite_test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "uca04-mixed-suite",
      "command": "pnpm --filter @peers-touch/client-chat-core test && pnpm --dir apps/desktop exec vitest run src/runtimes/chatStorageRuntime.test.ts && pnpm --dir apps/mobile exec vitest run src/runtimes/chatStorageRuntime.test.ts",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "uca04-messaging-formal",
      "command": "uv run --with-requirements tooling/acceptance/requirements.txt -- python3 tooling/scripts/acceptance-run.py --gate messaging-owner-hard-cut-zero",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "messaging-core 独占 host-neutral engine、store policy、command outbox、reconciliation、recovery、receipt、attachment transfer 和 lifecycle fencing 语义",
    "Desktop 与 Mobile 只保留 transport、SQLCipher/file backend、key material、event loop、notification 和 OS lifecycle adapter",
    "messaging-core 的 production modules 不再导入 std::fs、std::path、rustix fs 或环境路径；storage_governance 物理测量/删除与 MLS state I/O 只经 typed Host ports",
    "Actor identity scope migration 保留 seed、device_id、device signing key 与证书连续性；Mobile Session 与 Messaging 共享同一 device_id",
    "Direct receipt 使用 committed endpoint truth，Group 继续使用 committed member-device rows，ordinary event 始终进入 authority hash chain",
    "旧 Desktop/Mobile engine/store/recovery owner、重复模型、双写和兼容 facade 的当前源码引用归零",
    "Desktop 与 Mobile adapter 对同一消息、回执、恢复和附件合同通过当前源码的聚焦 smoke",
    "tree-wide owner inventory 和 messaging-owner-hard-cut-zero 证明旧 engine/store/recovery symbols 与调用者引用归零"
  ],
  "failureBehavior": [
    "不把两个现有 engine 包进统一 facade 后称为共享 core",
    "不迁移 Station authority、Model contract 或跨设备业务 truth 到 client crate",
    "持久 schema 变化必须有单一 migration owner；不能让新旧 store 同时写",
    "任一身份、hash chain、receipt 或 recovery invariant 失败即回到 core owner 修复，不能在 Host adapter 补业务判断"
  ],
  "updatedAt": "2026-10-19T16:52:14.000Z"
}
```

## Amendment 2026-10-18

原物理多场景 Suite 留作后续发布证据。本 Plan 只保留 core、两端 adapter 与
owner-zero 的当前源码闭环，不运行跨 Station 或物理设备矩阵。

## 完整闭环

先以当前两端实现生成逐项语义和 store schema inventory，再把共同机制迁入
`packages/messaging-core`。每一批调用者迁移和 focused check 完成后立即删除旧
owner；禁止长期共存。最终以 Desktop、Android Emulator、iOS Simulator 的启动
冒烟确认两端消费者仍可组合该 core，不扩展为完整消息产品 Journey。
