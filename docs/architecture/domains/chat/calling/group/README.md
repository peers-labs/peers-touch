# 群聊音视频

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-11-13 | **Updated**: 2026-11-13
> **Owner**: Chat Product Team
> **Module**: `apps/station/app/subserver/groupcall/`, `packages/client-chat-core/src/group-call/`

## 1. Document Scope

定义 `CHAT-C12 / J09 / CHAT-G14` 在 Desktop 与 Mobile 的群媒体授权、
设备生命周期和 SFU 边界。上游是 [Chat 产品合同](../../lifecycle/product-definition.md)、
[状态模型](../../lifecycle/product-state-model.md)、
[验收合同](../../lifecycle/acceptance-matrix.md) 和用户确认的 M15。
本文描述允许的目标结构，不构成实现或原生证明。

## 2. 背景与问题

现有 Desktop 已消费 LiveKit，但 Mobile 缺少群媒体 owner；Station
`RemoveParticipant` 没有生产调用者，六小时、Actor 身份的 token 没有设备撤销边界。
两端不能各自复制 SDK 或以单聊模拟群聊。

## 3. 设计目标

三位及以上群成员真实交换音视频；单聊和群聊共同遵守一个设备媒体占用；
群成员移除和设备撤销阻断未来媒体权限；离开、取消和账号切换释放全部媒体。
原型按钮、参与者布局和状态通过 peers-ui 表达。

## 4. 文档导航

| 文档 | 职责 |
|---|---|
| [design.md](./design.md) | 权限、组件、接口与质量合同 |
| [data-model.md](./data-model.md) | 设备 grant、状态机与类型 |
| [decisions.md](./decisions.md) | 已评审决策及代价 |
| [integration.md](./integration.md) | 原 owner 接入与替换边界 |
| [module-layout.md](./module-layout.md) | 单一实现和依赖 |
