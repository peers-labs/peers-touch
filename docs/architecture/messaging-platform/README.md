# Messaging Platform

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-08-08 | **Updated**: 2026-09-06
> **Owner**: Messaging Platform Team
> **Module**: `model/domain/chat/`, `apps/station/app/subserver/`, `apps/desktop/`, `apps/mobile/`
>
> **API ownership correction (accepted, 2026-09-06)**: source and history audit
> confirmed that Conversation business capabilities were simultaneously exposed and
> persisted by `conversation` and `messaging` before consolidation. Conversation is
> now the sole Chat entry point at `/conversation/*`; Device, Inbox, Recovery, Key
> Exchange, and Federation APIs are exposed by their resource owners at `/device/*`,
> `/device/inbox/*`, `/recovery/*`, `/key-exchange/*`, and peer-only
> `/federation/*`. Conversation is a DDD bounded context, and a machine ownership
> Gate protects this single-owner model. Read
> [`../api-ownership/README.md`](../api-ownership/README.md) before further route or
> authority work.

---

## 1. Document Scope

本文档集定义：

- Peers-Touch Direct Chat 与 Group Chat 的完整产品合同。
- Model、Station、Device Messaging Engine、Desktop、Mobile 的唯一职责边界。
- 消息命令、权威事件、设备队列、ACK、重放、加密、多设备和恢复语义。
- 从用户动作到持久化、消费、UI 的端到端追踪关系。
- clean-slate 落地所需的原子切换、删除义务和验收证据。

本文档集不定义：

- Chat 页面的视觉布局；见 `docs/client/chat/` 与各平台布局合同。
- Voice/Video signaling；见 `docs/architecture/realtime/voice-video-calls.md`。
- 通用 Station、Desktop、Mobile 编码规范。

## 2. 背景与问题

当前 Chat 能力把消息生命周期拆散在 Station conversation/envelope、Desktop
TypeScript runtimes、Rust commands 和 UI store 中。队列、ACK、ratchet、业务消息
持久化和 UI 投影没有一个完整 owner，导致：

- realtime payload 可被并发处理，DKX 和消息顺序无法保证；
- ACK 可能早于解密与本地提交，失败后无法重放；
- ratchet 推进与 plaintext 持久化跨调用，崩溃可造成永久不可解密；
- command proposal、重试和 dedup 同时存在于内存、`localStorage`、SQLCipher 和
  Station；
- Direct、Group、multi-device、recovery 各自形成局部链路，无法证明整体可用。

本设计借鉴 SimpleX 的 Chat Core / Messaging Agent 分层、持久 command/delivery
worker 和 consumer ACK，但保留 Peers-Touch 的 PTID、多 Station authority、
device-addressed Direct sessions 与 RFC 9420 MLS。

## 3. 设计目标

1. 一个 Device Messaging Engine 完整拥有设备侧消息生命周期。
2. Station 以 authority log 和 per-device ordered queues 提供共享事实。
3. 所有可靠消息均采用 at-least-once delivery 与幂等消费。
4. ACK 只代表设备已经完成本地 durable consumption。
5. Direct 与 Group 共用 command/event/queue/receipt 框架。
6. 每个 active device 有独立 Direct sessions 和 MLS leaf。
7. fresh install 可恢复历史并以 fresh device identity 继续通信。
8. UI 只提交 typed commands、读取 projections、呈现 typed states。
9. 没有双 runtime、兼容 shim、历史 transport 或隐藏 fallback。
10. 每个完成声明必须有可复现的 native receiver evidence。

## 4. 文档导航

| 文档 | 说明 |
|---|---|
| [product-definition.md](./product-definition.md) | 用户、产品承诺与能力范围 |
| [benchmark-disposition.md](./benchmark-disposition.md) | SimpleX 等参考行为的采用与拒绝 |
| [experience-contract.md](./experience-contract.md) | 端到端用户旅程 |
| [product-state-model.md](./product-state-model.md) | 用户可见状态与恢复动作 |
| [acceptance-matrix.md](./acceptance-matrix.md) | receiver-perspective 验收与追踪 |
| [design.md](./design.md) | 整体架构、owner、数据流与 failure semantics |
| [decisions.md](./decisions.md) | 关键设计决策 |
| [data-model.md](./data-model.md) | Proto、状态机和持久化模型 |
| [module-layout.md](./module-layout.md) | 目标模块布局与依赖方向 |
| [integration.md](./integration.md) | 影响面、原子切换与删除矩阵 |
| [../api-ownership/README.md](../api-ownership/README.md) | Accepted canonical API owner, route/store hard cut, Conversation DDD, and cross-domain Federation boundary |
| [execution-plans/20260808-messaging-platform.md](./execution-plans/20260808-messaging-platform.md) | 依赖化执行计划 |
| [execution-plans/20260808-review-prompt.md](./execution-plans/20260808-review-prompt.md) | 独立产品/架构/计划评审提示 |

## 5. 当前门状态

- Product：`PRODUCT_ACCEPTED`
- Architecture：`ARCHITECTURE_ACCEPTED` through revised `MP-D30` and
  `AO-D01..AO-D06`; `MP-D29` follower projection evidence remains valid under
  the Conversation owner, and Conversation DDD plus resource-owned APIs are
  accepted.
- Plan：CA-HC hard-cut plan `PLAN_APPROVED`; the older Messaging Platform plan is
  superseded for Station authority/API ownership while its Device Messaging Engine
  and MP-W14 follower-projection work remain historical input, not a second
  active plan. CA-W0 through CA-W2 are complete; CA-W3 and CA-W4 have source
  checkpoints only. CA-W5 production cutover and CA-W6 runtime/PostgreSQL proof
  remain `UNPROVEN`.
- Execution：live product evidence invalidated the prior MP-W10-E/MP-W12/MP-W11
  receiver-proof claims. `MP-W13` and `MP-W14` below retain historical source and
  Native evidence; CA-HC exclusively owns the Station authority cutover and its
  completion proof.
