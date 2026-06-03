# Desktop Docs

当前 Desktop 文档按"平台层真源 + 相关子主题"组织。

## 平台层真源（Desktop 内部）

按这个顺序读，能避免落到老化的子主题文档里再被反向修正：

1. [base.md](./base.md) — 平台总纲、目录基线、交付检查
2. [lifecycle.md](./lifecycle.md) — Desktop 顶层生命周期：boot、identity/auth gate、runtime bootstrap、steady reconcile
3. [runtime-projections.md](./runtime-projections.md) — `desktop-web` 内部 Page / Runtime / Boot 三组契约的**单点真源**
4. [global-context-kernel.md](./global-context-kernel.md) — 全局上下文内核（与 Page/Runtime/Boot 正交）

## 架构层真源（跨进程）

Desktop 与 `station / desktop-rust / desktop-web / desktop-app` 的跨进程关系：

- [../../architecture/runtime/desktop-runtime-architecture.md](../../architecture/runtime/desktop-runtime-architecture.md)

它在第 11 节明确指出：`desktop-web` 内部的契约归 `runtime-projections.md`，本文不重复定义。

## 相关子主题

- [provider-model-target-architecture.md](./provider-model-target-architecture.md)
- [execution-plans/global-context-kernel-migration.md](./execution-plans/global-context-kernel-migration.md)

## 规范层（写代码前看）

- [page-component.md](../../global/coding-guide/desktop/page-component.md) — 页面 / 视图 / 模块注册
- [store.md](../../global/coding-guide/desktop/store.md) — Zustand Store 与 Runtime ownership 边界
- [kernel-events.md](../../global/coding-guide/desktop/kernel-events.md) — AppEventBus
- [service-api.md](../../global/coding-guide/desktop/service-api.md) — Desktop Web ↔ Desktop Rust 调用约束

## 不确定从哪里开始

- [../../README.md](../../README.md)
