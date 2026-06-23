# Desktop Docs

当前 Desktop 文档按"平台层真源 + 相关子主题"组织。

## 平台层真源（Desktop 内部）

按这个顺序读，能避免落到老化的子主题文档里再被反向修正：

1. [base.md](./base.md) — 平台总纲、目录基线、交付检查
2. [lifecycle.md](./lifecycle.md) — Desktop 顶层生命周期：boot、identity/auth gate、runtime bootstrap、steady reconcile
3. [identity-lifecycle.md](./identity-lifecycle.md) — Desktop 登录态、profile、account cache、avatar cache 的状态机闭环
4. [runtime-projections.md](./runtime-projections.md) — `desktop-web` 内部 Page / Runtime / Boot 三组契约的**单点真源**
5. [global-context-kernel.md](./global-context-kernel.md) — 全局上下文内核（与 Page/Runtime/Boot 正交）
6. [chat-layout-contract.md](./chat-layout-contract.md) — Desktop Chat 布局、pane、hover、右键菜单、Composer 边界契约

## 架构层真源（跨进程）

Desktop 与 `station / desktop-rust / desktop-web / desktop-app` 的跨进程关系：

- [../../architecture/runtime/desktop-runtime-architecture.md](../../architecture/runtime/desktop-runtime-architecture.md)

它在第 11 节明确指出：`desktop-web` 内部的契约归 `runtime-projections.md`，本文不重复定义。

## 相关子主题

- [applet-launcher-ux-contract.md](./applet-launcher-ux-contract.md)
- [provider-model-target-architecture.md](./provider-model-target-architecture.md)
- [execution-plans/global-context-kernel-migration.md](./execution-plans/global-context-kernel-migration.md)

## 跨端 Chat 体验

- [../chat/chat-ux-contract.md](../chat/chat-ux-contract.md) — Desktop 与 Mobile 共同遵守的 Chat / IM 产品体验契约
- [chat-layout-contract.md](./chat-layout-contract.md) — Desktop 对跨端 Chat 契约的平台化约束

## 产品原型

- [prototype/chat/私聊与群聊系统原型 v1.0/readme.md](./prototype/chat/私聊与群聊系统原型%20v1.0/readme.md) — 私聊 / 群聊系统交互原型
- 语音 / 视频通话原型已迁入统一原型工作区：见 [原型总账](../../architecture/prototypes/README.md) 与 [realtime/prototype/README.md](../../architecture/realtime/prototype/README.md)

## 跨端通用 UX

- [../common/ux-design-methodology.md](../common/ux-design-methodology.md) — 客户端 UX 问题从案例沉淀成准则、契约、invariant 的方法论
- [../common/ui-identity/README.md](../common/ui-identity/README.md) — Peers Touch 客户端通用 UI Identity、模块 UI ID、跨模块 patterns
- [../common/ui-identity/modules/social/desktop.md](../common/ui-identity/modules/social/desktop.md) — Desktop Social UI ID，约束 feed/detail/comment/composer/reaction/moderation 表达
- [../common/form-control-ux-contract.md](../common/form-control-ux-contract.md) — 跨端表单控件与组合输入控件体验契约

## 规范层（写代码前看）

- [page-component.md](../../global/coding-guide/desktop/page-component.md) — 页面 / 视图 / 模块注册
- [store.md](../../global/coding-guide/desktop/store.md) — Zustand Store 与 Runtime ownership 边界
- [kernel-events.md](../../global/coding-guide/desktop/kernel-events.md) — AppEventBus
- [service-api.md](../../global/coding-guide/desktop/service-api.md) — Desktop Web ↔ Desktop Rust 调用约束

## 不确定从哪里开始

- [../../README.md](../../README.md)
