# Federated Human Social Activity

> **Status**: draft
> **Version**: v0.3
> **Created**: 2026-06-17 | **Updated**: 2026-10-03
> **Owner**: Architecture Team
>
> **Friend Request federation amendment (accepted, 2026-09-06)**: D-07 defines
> receiver-Home-Station Social authority over Friend Request and reuse of one
> domain-neutral durable Federation transport. It does not introduce a Mobile,
> Desktop, Social, or Messaging-specific network stack. See
> [`../api-ownership/README.md`](../api-ownership/README.md).

---

## 1. Document Scope

本文档集定义当前阶段的 **Federated Human Social Activity**：

- Human Actor 在 Peers-Touch 联邦网络中的社交产品模型。
- Activity Feed 如何表达人、内容、Station、Federation、关系路径、可见范围和互动。
- Human 社交对象、身份展示、关系图谱、可见性、投递、互动、搜索与发现的架构边界。
- 同一 active Federation 内 Native Desktop 私密 Moment 的远端 PreKey、
  viewer-scoped 投递、读取、互动、恢复和撤销闭环。
- 当前阶段的执行计划、任务跟踪和 E2E 验收机制。
- Agent / A2A / Applet 能力在未来如何接入本层的预留点。

本文档集不定义：

- Agent 之间的社交、Agent 发布动态、Agent 协作流和 A2A 执行闭环。
- Applet 的具体业务 UI、Applet 市场或 Applet 内部状态模型。
- 办公、项目管理、治理、研发协作等上层业务形态。
- Federation Ledger 的底层治理账本细节，见 `docs/architecture/federation/`。
- A2A 协议集成细节，见 `docs/architecture/agent/a2a/`。
- Mobile Social 产品实现与验收；由后续独立计划负责。
- Browser Social；Browser 不注册 Social 页面、runtime 或动作。

---

## 2. 一句话命题

当前阶段要解决的不是“把 Moments 做漂亮”，而是：

> 让不同 Station 上的人，能在一个可信、可理解、边界清晰的联邦社交空间里发现彼此、理解彼此、建立关系、分享内容并参与互动。

这意味着 Feed 不是普通帖子列表。每条内容都必须让用户知道：

- 这个人是谁。
- 来自哪个 Station。
- 我为什么能看到。
- 这条内容的可见范围是什么。
- 我和作者有什么关系。
- 我能如何互动、关注、屏蔽或进一步了解。

---

## 3. 第一性原理

### 3.1 Human 社交的最小单位是“可理解的人类行为”

社交不是 Post 数据流，而是 Human Actor 在某个关系和边界内做出的可理解行为：

```text
某个人，在某个 Station 和 Federation 边界内，向某个 Audience 分享了一个对象，并允许其他人按规则回应。
```

### 3.2 联邦社交的核心价值是边界可见

中心化社交隐藏来源和边界；联邦社交必须表达来源和边界。

用户需要一眼看懂：

- 作者属于哪个 Station。
- 内容是本地、远端、公开、关注关系、圈子还是提及而来。
- 当前互动会留在本地、跨站同步，还是受可见范围限制。

### 3.3 高级用户需要“简单但信息量大”

当前阶段的目标不是弱化复杂性，而是组织复杂性：

- 默认视图简洁。
- 关键语义可见。
- 细节可展开。
- 操作路径短。
- 状态可验证。

### 3.4 Agent / Applet 是未来扩展，不进入当前闭环

Agent、A2A、Applet 将来会接入同一社会活动层，但当前阶段只做 Human 社交闭环。文档中保留扩展点，禁止当前阶段引入 Agent 社交实现。

---

## 4. 设计目标

1. 建立 Human Actor 为中心的联邦社交产品语言。
2. 将 Activity Feed 从 Post 列表升级为“可解释的联邦社交活动流”。
3. 明确 Actor Identity、Station Source、Relationship Reason、Audience、Interaction 的展示和数据边界。
4. 支持 Home、Federated、Profile、Circle、Search 等 Human 社交核心场景。
5. 保持页面为 runtime projection 的纯渲染，不用页面刷新弥补投影新鲜度。
6. 保留 Agent / A2A / Applet 的字段和 UI 插槽，但不在当前阶段实现其社交闭环。
7. 建立覆盖多 Station、多用户、多关系、多可见范围的 E2E 验收机制。
8. 让私密 Post、Comment、Attachment 和 Reaction 在两个真实 Station 间保持
   E2EE、单一 Social authority、可恢复投递和可验证撤销。

---

## 5. 文档导航

| 文档 | 说明 |
|------|------|
| [design.md](./design.md) | Human 联邦社交产品架构、产品空间、对象模型和分层 |
| [data-model.md](./data-model.md) | 当前阶段数据模型、投影模型、扩展预留 |
| [integration.md](./integration.md) | 与现有 Actor、Social、Federation、Desktop Runtime 的映射 |
| [moderation-projection.md](./moderation-projection.md) | Actor / Station block 与 moderation projection 边界 |
| [decisions.md](./decisions.md) | 当前阶段关键设计决策 |
| [../api-ownership/README.md](../api-ownership/README.md) | API owner, shared Federation transport, and hard-cut governance |
| [e2e-acceptance.md](./e2e-acceptance.md) | Human 联邦社交 E2E 验收机制 |
| [execution-plans/20260617-federated-human-social-activity.md](./execution-plans/20260617-federated-human-social-activity.md) | 已 supersede 的早期公共 Feed / 产品语言计划；完成项保留为历史证据 |
| [execution-plans/20261003-cross-station-social-native/plan.md](./execution-plans/20261003-cross-station-social-native/plan.md) | Native Desktop 跨 Station Social 正向投递、互动、恢复和正式验收后继计划 |

---

## 6. Source Relationship

本模块是当前阶段 Human 联邦社交活动层的架构真源。下游文档必须在本文允许的边界内展开：

- Social / Moments 能力：`docs/architecture/social/`
- Social Private Moments 产品合同：`docs/architecture/social/product-definition.md`
- 私密加密、envelope、对象与恢复机制：`docs/architecture/secure-content/`
- Federation 网络与治理账本：`docs/architecture/federation/`
- Actor 身份模型：`docs/architecture/identity/unified-actor-system.md`
- Desktop Runtime Projection：`docs/client/desktop/runtime-projections.md`
- Agent / A2A 未来扩展：`docs/architecture/agent/`、`docs/architecture/agent/a2a/`
- Applet 未来扩展：`docs/architecture/applet-runtime/`

The 2026-06-17 execution plan is superseded for unfinished work. Its completed
product-language and projection-contract outputs remain evidence; all remaining
Desktop Native federation closure moves to the 2026-10-03 successor plan.
