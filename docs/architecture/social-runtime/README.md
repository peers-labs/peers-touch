# Social Runtime Alignment

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-03 | **Updated**: 2026-08-27
> **Owner**: Client Architecture Team
> **Module**: `apps/desktop/src/runtimes/socialRuntime.ts`, `apps/mobile/src/features/social/`

---

## 1. Document Scope

本文档定义：

- Desktop 与 Mobile 社交能力的统一运行时抽象。
- Station 真源、客户端 projection、宿主能力 adapter 的职责边界。
- 双端必须一致的领域语义、状态收敛策略、协议契约和防回退规则。
- 后续收敛 Desktop/Mobile 社交实现的执行顺序。

本文档不定义：

- Station 社交/聊天/通知子服务内部 DDD 设计。
- Desktop 或 Mobile 的视觉设计细节。
- iOS/Android push SDK、Desktop tray/menu 等宿主能力的具体插件实现。
- Chat 设备级私聊与 MLS 密文格式；见 `docs/architecture/encryption/README.md`。
- Group chat 生命周期业务真源；见 `group-lifecycle.md`。
- 跨 Station / Federation IM 架构；见 `docs/architecture/federated-im/README.md`。

---

## 2. Background And Problem

Peers-Touch 的社交能力需要在 Desktop 与 Mobile 上长期共同演进。当前状态是：

- Desktop 已经有较完整的 `socialRealtime`、`socialChat`、notification、group、E2EE、P2P 能力，但历史实现中有服务、store、runtime bridge 职责叠加。
- Mobile 已经完成好友请求、联系人、单聊、通知、profile、realtime、native wakeup 的 runtime-projection 闭环，分层更清晰，但 group、offline queue、E2EE、native push/deep-link 插件侧发射尚未完成。
- 如果继续按端补功能，双端会形成两套理解：同一个“好友请求/通知/消息状态/reconcile”在两个宿主上有不同 owner、不同刷新策略、不同错误模型。

这会提高理解成本、维护成本和长期迭代风险。双端允许宿主能力不同，但业务架构抽象必须一致。

---

## 3. Design Goals

1. Station 是跨端社交业务真源，客户端只维护 runtime projection。
2. Desktop 与 Mobile 使用同一套抽象层级：API Gateway -> Wire Contract -> Normalizer -> Projection Reducer -> Projection Store -> Runtime Supervisor -> Host Adapter -> UI Renderer。
3. 平台差异只能进入 Host Adapter，不能改变好友、消息、通知、presence、typing、profile 等领域语义。
4. 页面只负责渲染 projection 和 dispatch command，不能成为长期 freshness owner。
5. protobuf、HTTP DTO、错误 envelope、reconcile 语义必须逐步收敛，避免一端手写兼容另一端使用生成契约。
6. 所有新增社交能力必须先明确所属 projection domain，再进入 Desktop/Mobile 双端实现。

---

## 4. Document Navigation

| 文档 | 说明 |
| --- | --- |
| [design.md](./design.md) | 双端社交 runtime 架构、抽象层级、核心接口 |
| [group-lifecycle.md](./group-lifecycle.md) | 群创建、加人、退群、解散、历史、事件、Sender Key 轮换的业务真源 |
| [../federated-im/README.md](../federated-im/README.md) | 联邦 IM 架构：跨 Station 群/私聊、group authority、事件日志、Sender Key 边界 |
| [decisions.md](./decisions.md) | Station 真源、Host Adapter、projection owner、防回退等关键决策 |
| [integration.md](./integration.md) | 当前 Desktop/Mobile 文件映射、差异矩阵、迁移策略 |
| [execution-plans/phase-1-runtime-alignment.md](./execution-plans/phase-1-runtime-alignment.md) | 第一阶段落地计划 |
| [execution-plans/20260604-social-chat-product-closure.md](./execution-plans/20260604-social-chat-product-closure.md) | 社交/聊天产品闭环最终形态、四大能力域、长任务执行路径 |
| [execution-plans/20260607-client-chat-framework-standardization.md](./execution-plans/20260607-client-chat-framework-standardization.md) | 本轮 chat framework 标准化执行追踪：已完成、待完成、验证日志 |

---

## 5. Related Sources

| 来源 | 关系 |
| --- | --- |
| `docs/client/desktop/runtime-projections.md` | Desktop Page / Runtime / Boot 平台契约 |
| `docs/client/mobile/execution-plans/20260603-mobile-social-runtime-closure.md` | Mobile social runtime closure 当前实现计划 |
| `docs/architecture/mobile/` | Mobile Shell runtime graph、descriptor navigation 与 `commandRuntime` 平台映射 |
| `docs/architecture/runtime/desktop-runtime-architecture.md` | Desktop 多运行单元边界 |
| `docs/architecture/notification/notification-architecture.md` | 通知系统真源 |
| `docs/architecture/realtime/event-stream.md` | Realtime event stream 真源 |
| `docs/architecture/encryption/README.md` | 设备级私聊、MLS、投递与恢复设计 |
