# Federation Architecture

> **Status**: active
> **Version**: v0.3
> **Created**: 2026-05-31 | **Updated**: 2026-10-06
> **Owner**: Architecture Team

---

## 1. Document Scope

本文档集定义：

- Federation 作为独立业务域的 Source of Truth 与 ownership 边界。
- Federation 作为 Peers-Touch 持久虚拟网络实体的架构边界。
- Actor、Station、Federation、Federation Ledger 的关系。
- Station 加入多个 Federation 的治理模型。
- 联邦的产品心智：基础设施渗透而非独立入口。
- Federation Ledger 的可验证、可复制、追加式治理账本模型。
- Federation discovery、scope、security、Station 分层和现有 Catalog / Locator 的关系。

本文档集不定义：

- 普通聊天、点赞、评论、动态等社交数据协议。
- 联邦 IM 的群 authority、Group Event Log、Sender Key 跨站路由；见 `../../../context/architecture/chat/federated-im/README.md`。
- 具体 Desktop 页面实现细节。
- 具体 Station handler、repository、database migration 实现。
- 完整公链、token、gas、PoW/PoS 或通用区块链系统。

---

## 2. 背景与问题

当前系统已有 actor by-handle resolve、locator、profile cache、catalog 等跨站发现基础能力，但它们回答的是“如何找到某个远端用户”。它们不回答：

- 一个 Station 参加哪些联邦。
- 谁有权让 Station 加入或退出联邦。
- 联邦是否是持久实体，是否独立于创建者存在。
- 多个 Station 如何复制和验证联邦治理事实。
- 用户如何不记地址地发现 Federation、Station 和人。

因此需要把 Federation 上升为架构层实体，而不是把它隐藏在 Station-to-Station 连接或用户输入 handle 的交互里。

---

## 3. 设计目标

1. Federation 是持久虚拟网络，不依赖创建者个人存续。
2. Station 是 Federation 的成员节点，一个 Station 可以加入多个 Federation。
3. Actor / Account 是 Federation 内的参与者，但普通用户默认不能管理联邦拓扑。
4. 联邦治理事实由可验证的 Federation Ledger 承载。
5. 普通社交行为不上账本，避免把联邦治理账本变成业务流水账。
6. 用户通过搜索、联系人等日常入口自然接触联邦内的人，不需要记 `@user@host`。
7. 第一阶段采用 permissioned append-only ledger，不引入完整区块链复杂度。
8. 第一阶段采用单 Federation active sequencer 模型，避免在未引入完整共识前出现并发 head 分叉。
9. 所有 Catalog、Resolver、Station list、Public actor list 查询必须显式带 Federation 语境。
10. 跨 Station 身份语义必须复用 `ActorRef` / federated handle / `station_peer_id`，不得发明并行 Account 身份模型。

---

## 4. 文档导航

| 文档 | 说明 |
|------|------|
| [design.md](./design.md) | 核心架构设计、角色边界、用户感知模型、生命周期 |
| [decisions.md](./decisions.md) | 关键设计决策与替代方案 |
| [data-model.md](./data-model.md) | Federation、ledger、membership、role、scope、sync 的概念数据模型 |
| [wire-protocol.md](./wire-protocol.md) | Wire Protocol：hash/签名规范、RPC 定义、payload schema、sync 协议 |
| [integration.md](./integration.md) | 与 Station、Catalog、Resolver、ActivityPub、Client projection 的映射 |
| [execution-plans/phase-1-federation-ledger.md](./execution-plans/phase-1-federation-ledger.md) | Federation Ledger 最小闭环落地计划 |
| [Historical Federated IM](../../../context/architecture/chat/federated-im/README.md) | 已 supersede 的跨 Station 群/私聊、group authority 与事件日志设计 |

---

## 5. 相关文档

- [identity/federation-catalog.md](../identity/federation-catalog.md) — 跨站 actor 目录与发现能力。
- [identity/unified-actor-system.md](../identity/unified-actor-system.md) — actor identity 模型。
- [boundaries/station-desktop-scope-boundary.md](../../platform/station-desktop-boundary.md) — Station 与 Desktop 边界。
- [global/architecture.md](../../../global/architecture.md) — 项目整体架构。
- [station/base.md](../../../station/base.md) — Station app/frame 分层与 subserver 边界。
- [global/domain-model.md](../../../global/domain-model.md) — Proto-First 契约规则。
