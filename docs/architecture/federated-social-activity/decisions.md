# Federated Human Social Activity — 设计决策

> **Status**: draft
> **Version**: v0.3
> **Created**: 2026-06-17 | **Updated**: 2026-10-03
> **Owner**: Architecture Team

---

## 决策索引

| ID | 决策 | 状态 |
|----|------|------|
| D-01 | 当前阶段只实现 Human 联邦社交闭环 | accepted |
| D-02 | Feed 首要表达 source / reason / audience，而不是只展示内容 | accepted |
| D-03 | RelationshipReason 是解释模型，不是权限模型 | accepted |
| D-04 | Agent / A2A / Applet 只做扩展预留 | accepted |
| D-05 | 不引入办公、任务、项目等上层形态 | accepted |
| D-06 | Runtime projection 继续拥有 Feed 新鲜度 | accepted |
| D-07 | Friend Request 由 receiver Home Station 授权并复用共享 Federation transport | accepted |
| FHSA-D08 | 当前跨站 Social readiness 只覆盖 Native Desktop | proposed |
| FHSA-D09 | 作者 Home Station 保持私密资源 authority | proposed |
| FHSA-D10 | 每个远端 Actor 使用 viewer-scoped durable Federation frame | proposed |
| FHSA-D11 | Content PreKey 通过 Home Station 分组并执行幂等远端 claim | proposed |
| FHSA-D12 | 大对象留在源 authority，通过 Federation peer stream 读取密文 | proposed |
| FHSA-D13 | 远端互动回到源 Social authority 提交 | proposed |
| FHSA-D14 | 撤销使用本地立即抑制与源 authority 有序失效双路径 | proposed |
| FHSA-D15 | Browser Social 硬禁用，Mobile 后置 | proposed |

---

## D-01: 当前阶段只实现 Human 联邦社交闭环

**Status**: accepted
**Date**: 2026-06-17

### Context

Agent 能力当前不完善，过早设计 Agent 社交会扩大实现范围并干扰 Human 社交主线。

### Decision

当前阶段只实现 Human Actor 之间的联邦社交：发布、阅读、评论、reaction、关注、搜索、profile、circle、federated discovery。

### Rationale

Human 社交是后续 Agent/Applet 社会活动层的基础。如果 Human feed 不能表达 source、reason、audience，未来 Agent 接入会更加混乱。

### Alternatives Considered

- 同时做 Agent 社交：范围过大，依赖不成熟。
- 只做 UI 美化：无法解决联邦语义表达问题。

### Consequences

所有执行计划和 E2E 验收以 Human 社交为主线。

---

## D-02: Feed 首要表达 source / reason / audience，而不是只展示内容

**Status**: accepted
**Date**: 2026-06-17

### Context

联邦社交中，用户需要知道内容来源和可见边界，否则无法建立信任。

### Decision

Feed card 必须表达作者身份、home Station、relationship reason、audience explanation 和 interaction boundary。

### Rationale

这是联邦社交区别于普通信息流的核心产品语言。

### Alternatives Considered

- 隐藏技术语义：更简单，但失去联邦产品价值。
- 展示完整技术细节：信息噪音过高。

### Consequences

UI 需要高密度、可展开、低噪音的语义设计。

---

## D-03: RelationshipReason 是解释模型，不是权限模型

**Status**: accepted
**Date**: 2026-06-17

### Context

用户需要知道为什么看到某条动态，但权限判定必须由 Station truth 和 Audience 决定。

### Decision

`RelationshipReason` 只用于解释和排序，不参与权限判定。

### Rationale

避免 Desktop 或 UI 层自行推导可见性导致越权。

### Alternatives Considered

- UI 根据 relationship 判断可见性：违反 runtime projection 和 Station truth 边界。

### Consequences

Station / runtime 必须提供可解释投影。

---

## D-04: Agent / A2A / Applet 只做扩展预留

**Status**: accepted
**Date**: 2026-06-17

### Context

Agent / A2A / Applet 是长期方向，但不是本阶段交付目标。

### Decision

Human Activity Object 保留扩展槽；UI 保留 action slot；执行计划不包含 Agent 社交、A2A 执行和 Applet 发布对象。

### Rationale

保证模型未来可扩展，同时控制当前阶段范围。

### Alternatives Considered

- 完全不考虑未来扩展：后续可能重构成本高。
- 当前实现未来能力：范围失控。

### Consequences

任何 Agent/Applet 相关任务必须进入后续阶段文档，不得混入本计划。

---

## D-05: 不引入办公、任务、项目等上层形态

**Status**: accepted
**Date**: 2026-06-17

### Context

协作能力未来可能通过 Applet 涌现，但当前阶段是 Human 社交基础设施。

### Decision

当前文档不定义 Task、Project、Approval、Workspace 等办公语义。

### Rationale

避免 Human 社交架构被上层业务形态污染。

### Alternatives Considered

- 在 Feed 中内置任务/协作：偏离当前阶段目标。

### Consequences

执行计划只覆盖 Human social primitives。

---

## D-06: Runtime projection 继续拥有 Feed 新鲜度

**Status**: accepted
**Date**: 2026-06-17

### Context

Desktop 已有 runtime projection 契约，页面不能通过 mount-time fetch 维持业务新鲜度。

### Decision

Human social feed freshness 由 momentsRuntime 或后续 humanSocialRuntime 负责。

### Rationale

保证 event consumption + periodic reconcile 双路径，避免 stale UI。

### Alternatives Considered

- 页面 tab click / mount fetch：违反 Desktop runtime projection 架构。

### Consequences

所有页面和组件只能渲染 projection 和触发用户动作。

---

## D-07: Friend Request 由 Receiver Home Station 授权并复用共享 Federation Transport

**Status**: accepted
**Date**: 2026-09-06

### Context

The current Social Friend Request service writes only the local Station database. In a
two-Station journey, the sender receives success while the receiver Home Station never
materializes a pending request. Chat transport does not own Social Graph truth, and a
Mobile-specific delivery path would create another platform silo.

### Decision

- Public Friend Request APIs remain under `/api/v1/social/*` for every client.
- The receiver actor's Home Station owns pending/accepted/rejected request state.
- Sender Home Station persists the exact signed command and a shared Federation outbox
  row atomically before returning durable acceptance.
- Receiver Home Station validates and materializes the request idempotently, then owns
  accept/reject policy and the committed result.
- Accepted/rejected results return through the same shared Federation transport; both
  Home Stations project their actor-local relationship state.
- Social may request Direct Conversation creation only after accepted relationship
  convergence. Conversation does not own Friend Request.

### Rationale

The receiver is the decision authority, Social remains the business owner, and shared
Federation mechanics provide retry/dedup without becoming a second Social service.

### Alternatives Considered

- Put Friend Request into a Chat envelope: rejected because message delivery is not a
  Social Graph authority.
- Add a Social-only network stack: rejected because retry/auth/dedup infrastructure would
  be duplicated.
- Let Mobile/Desktop call the receiver Station directly: rejected because it bypasses
  Home Station identity, policy, audit, and durable retry.

### Consequences

- Proto-first Social command/event contracts are required.
- Same-Station and cross-Station flows use the same domain handler through local or remote
  transport adapters.
- W9-D Social must prove outage/restart, exact retry, receiver materialization, result
  return, mutual relationship convergence, and event-after-commit.
- This proposal is governed jointly by AO-D05 in
  `docs/architecture/api-ownership/decisions.md`.

Owner accepted D-07 with AO-D01..AO-D06 and revised MP-D30 on 2026-09-06.

---

## FHSA-D08: 当前跨站 Social Readiness 只覆盖 Native Desktop

**Status**: proposed
**Date**: 2026-10-03

### Context

Same-Station private Social 已有 Native Desktop 正式证明。Mobile 尚无对应
Social adapter 与物理设备验收，Browser 不属于目标产品平台。

### Decision

本轮只声明两个真实 Station 上的 Native Desktop 正向跨站 Social。Mobile 由后续
独立计划负责，Browser 不计入降级矩阵。

### Rationale

平台 readiness 必须由真实产品 runtime 证明，不能由共享 proto、Rust 内核或 Browser
替代推断。

### Alternatives Considered

- 同时做 Desktop/Mobile：拒绝，Mobile 会扩大当前依赖和验收面。
- 继续保留 Browser fail-closed UI：拒绝，用户已明确 Social 为 Native-only。

### Consequences

当前计划必须包含 Desktop Native 双 Station Gate 和 Browser 零注册 Gate；Mobile
状态保持 `deferred/unproven`。

---

## FHSA-D09: 作者 Home Station 保持私密资源 Authority

**Status**: proposed
**Date**: 2026-10-03

### Context

跨站接收需要接收者 Home Station 提供 HOME feed 和离线恢复，但复制业务 authority
会产生双写、冲突和不一致撤销。

### Decision

Post、Comment、Reaction、Audience 和 lifecycle 的 canonical truth 始终位于资源
作者 Home Station 的 Social domain。接收 Station 只保存 viewer-scoped、可重建的
密文投影。

### Rationale

单一 authority 保留现有 Social UOW、权限重检和 commit proof 语义，同时让接收端
无需直连远端 Station。

### Alternatives Considered

- 两个 Station 都成为写 authority：拒绝，无法定义冲突和删除顺序。
- Desktop 直接读写远端 Station：拒绝，绕过 Home Station policy、审计和恢复。

### Consequences

远端写入必须以命令回到源 authority；接收投影丢失时从 durable Federation delivery
或 source reconcile 重建。

---

## FHSA-D10: 每个远端 Actor 使用 Viewer-Scoped Durable Federation Frame

**Status**: proposed
**Date**: 2026-10-03

### Decision

源 Social transaction 为每个远端 recipient actor 原子写入一个共享 Federation
outbox frame。Frame 只包含该 actor 的密文投影、endpoint/recovery envelopes、对象
descriptor、commit proof 和最小 audience 解释。

### Rationale

Per-actor frame 防止接收 Station 和普通响应枚举 co-recipient；共享 transport 已提供
Station authentication、持久重试、去重、顺序和 backpressure。

### Alternatives Considered

- 每个 target Station 一个多接收者 frame：拒绝，会向 Station 泄露同站 co-recipient。
- Social 自建队列或 WebSocket：拒绝，复制 Federation transport。
- 把私密 activity 写入 Federation Ledger：拒绝，Ledger 只承载治理事实。

### Consequences

`model/domain/federation/delivery.proto` 只新增 payload kind；Social payload schema
归 `model/domain/social/`。Inbox receipt 与 receiver projection 必须同事务提交。

---

## FHSA-D11: Content PreKey 按 Home Station 分组并幂等 Claim

**Status**: proposed
**Date**: 2026-10-03

### Decision

源 Social 根据 Actor Identity locality 将 endpoint/recovery targets 按 Home Station
分组。本地组调用现有 Key Exchange capability；远端组通过 Federation-owned peer
route 请求 target Home Station Key Exchange。远端以
`(source_station_peer_id, plan_id, plan_request_sha256)` 做 exact replay。

### Rationale

一次性 key 的 authority 必须留在 recipient Home Station。跨站失败可浪费已 claim
的 key，但不得产生部分 Social commit；同一 plan 重试必须返回相同 claim。

### Alternatives Considered

- 同步复制远端 PreKey pool 到源 Station：拒绝，会建立第二个 key authority。
- 远端 recipient 没 key 时静默移除：拒绝，改变用户选择的 audience。

### Consequences

需要 Content PreKey peer inventory/claim route、跨站 claim receipt 持久化和部分
claim 后的 crash/replay 测试。

---

## FHSA-D12: 大对象留在源 Authority，通过 Peer Stream 读取密文

**Status**: proposed
**Date**: 2026-10-03

### Decision

Federation domain frame 只携带 encrypted payload 和 object descriptors，不携带大
对象字节。接收 Station 验证本地 imported grant 后，通过 Federation peer stream
向源 Social object authority 获取 range-capable ciphertext。

### Rationale

这遵守现有 8 MiB frame 上限，复用 Conversation attachment 的 peer-stream 模式，
并让对象 grant 仍由源 Social authority 最终裁决。

### Alternatives Considered

- 把对象字节塞进 durable frame：拒绝，破坏 payload bound 和队列公平性。
- 复制到公共 OSS：拒绝，违反私密对象边界。
- Desktop 直连源 Station：拒绝，绕过 Home Station。

### Consequences

对象 stream 必须绑定 source resource、target actor/device、object ID、range、expiry
和 Federation token；客户端继续验证 descriptor 与 ciphertext hash。

---

## FHSA-D13: 远端互动回到源 Social Authority 提交

**Status**: proposed
**Date**: 2026-10-03

### Decision

远端 Comment/Reaction 由 actor Home Station 持久化签名命令和 outbox，源 Post Home
Station 重验父资源授权后提交 canonical truth，并返回 typed result/projection update。

### Rationale

互动必须与父 Post 生命周期、audience、block 和 rate limit 在同一 authority 内决策。

### Alternatives Considered

- 在接收 Station 本地创建 Comment/Reaction：拒绝，形成双 authority。
- 使用客户端 optimistic state 作为最终结果：拒绝，无法处理 unknown outcome。

### Consequences

Desktop 显示 `REMOTE_PENDING/RETRYING`；command ID exact replay 和 payload-hash
conflict 是必测项。

---

## FHSA-D14: 撤销使用本地立即抑制与源 Authority 有序失效双路径

**Status**: proposed
**Date**: 2026-10-03

### Decision

接收 Station 的本地 block truth 可以立即抑制 UI 和新读取。源 Station 对 delete、
friendship loss、audience loss 和 block 生成单调 lifecycle revision，并通过 durable
Federation invalidation 使所有 recipient projections 收敛。

### Rationale

本地安全响应不能等待网络，但 canonical resource lifecycle 仍必须由源 authority
统一裁决。

### Alternatives Considered

- 只靠 TTL：拒绝，撤销窗口不可控。
- 只靠实时事件：拒绝，断线会永久漏失。

### Consequences

事件消费与 periodic reconcile 都必须存在；旧 revision 不能复活已撤销 projection。

---

## FHSA-D15: Browser Social 硬禁用，Mobile 后置

**Status**: proposed
**Date**: 2026-10-03

### Decision

Browser build 不注册 Social page、runtime、store action 或导航入口。Station 的公开
HTTP/Federation API 继续服务 Native 与互操作，但不得被描述为 Browser Social。
Mobile 不在本计划实现或验收。

### Consequences

计划包含 Browser 零引用/零注册 Gate，并把 Mobile 生成代码、Rust 基础和现有页面
视为非 readiness 证据。
