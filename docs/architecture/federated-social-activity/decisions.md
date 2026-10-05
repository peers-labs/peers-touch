# Federated Human Social Activity — 设计决策

> **Status**: draft
> **Version**: v0.2
> **Created**: 2026-06-17 | **Updated**: 2026-09-06
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
