# Chat 本机存储治理 - 模块目录结构

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-27 | **Updated**: 2026-09-27
> **Owner**: Device Messaging Engine

---

## 1. 目录树

```text
model/domain/chat/
└── storage.proto

packages/messaging-core/src/storage_governance/
├── mod.rs
├── cache.rs
├── conversation_clear.rs
├── redaction.rs
└── retention.rs

packages/client-chat-core/src/
└── storageBatch.ts

apps/desktop/
├── src/components/settings/ChatStorageSettings.tsx
├── src/runtimes/chatStorageRuntime.ts
└── src-tauri/src/messaging/
    ├── engine.rs
    └── store.rs

apps/mobile/
├── src/pages/settings/SettingsSections.tsx
├── src/runtimes/chatStorageRuntime.ts
└── src-tauri/src/messaging/
    ├── adapter.rs
    ├── commands.rs
    ├── engine.rs
    └── storage_governance_test.rs

tooling/acceptance/gates/
├── chat/storage_*.py
└── mobile/simulator_social_e2e.py
```

## 2. 文件职责

| 路径 | 职责 |
|---|---|
| `model/domain/chat/storage.proto` | 定义统计、策略、清理进度、结果和错误的跨端协议 |
| `packages/messaging-core/src/storage_governance/` | 唯一拥有计量、保留、清理、journal 和 redaction 语义 |
| `packages/client-chat-core/src/storageBatch.ts` | 串行编排 canonical 单会话清理并汇总部分失败 |
| `apps/desktop/src/components/settings/ChatStorageSettings.tsx` | Desktop 选择、确认、进度、结果和重试 projection |
| `apps/desktop/src/runtimes/chatStorageRuntime.ts` | Desktop scope-fenced runtime projection |
| `apps/desktop/src-tauri/src/messaging/{engine.rs,store.rs}` | Desktop Device Messaging Engine 适配与持久化接入 |
| `apps/mobile/src/pages/settings/SettingsSections.tsx` | Mobile 窄屏存储治理交互 |
| `apps/mobile/src/runtimes/chatStorageRuntime.ts` | Mobile scope-fenced runtime projection |
| `apps/mobile/src-tauri/src/messaging/{adapter.rs,commands.rs,engine.rs}` | Mobile Device Messaging Engine 适配、命令与执行入口 |
| `tooling/acceptance/gates/chat/storage_*.py` | Desktop、共享契约和聚合证明 |
| `tooling/acceptance/gates/mobile/simulator_social_e2e.py` | Mobile 原生 Journey 与正式 Gate |

## 3. 依赖关系

```text
storage.proto
  -> messaging-core/storage_governance
      -> Desktop/Mobile native messaging adapters
          -> Desktop/Mobile chatStorageRuntime
              -> platform Storage UI

client-chat-core/storageBatch
  -> platform chatStorageRuntime.clearConversation
      -> canonical native single-conversation command
```

依赖方向固定：页面只持有短生命周期选择和反馈状态，runtime 持有 scope
projection，native adapter 调用 shared Rust Core。批量 helper 不拥有持久化、
并发清理协议或第二套删除语义。
