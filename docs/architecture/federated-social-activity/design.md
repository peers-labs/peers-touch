# Federated Human Social Activity — 架构设计

> **Status**: draft
> **Version**: v0.2
> **Created**: 2026-06-17 | **Updated**: 2026-09-06
> **Owner**: Architecture Team

---

## 1. 设计命题

当前阶段只做 Human 联邦社交闭环。Agent、A2A、Applet 只作为未来扩展点预留，不进入当前产品闭环。

核心命题：

> 在联邦网络中，人不是只发布内容，而是在 Station 和关系边界内产生可理解的社会行为。Feed 的职责是把这些行为解释清楚。

如果这个问题不解决，Human 社交会退化成普通帖子列表：

- 用户不知道作者来自哪里。
- 用户不知道为什么看到这条内容。
- 用户不知道这条内容会不会跨站传播。
- 用户不知道自己和作者的关系。
- 用户不知道互动会发生在哪个边界内。

---

## 2. 产品架构

### 2.1 产品总图

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                      Peers-Touch Human 联邦社交空间                          │
│                                                                              │
│   目标：让人和人在多个 Station 之间建立可理解、可控、可信的社交关系。          │
├──────────────────────────────────────────────────────────────────────────────┤
│  用户入口                                                                     │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Home Feed    │  │ Federated    │  │ Actor Profile│  │ Search       │      │
│  │ 可信关系流   │  │ 跨站公共流   │  │ 人的身份主页 │  │ 找人/找站点  │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                 │                 │              │
├─────────┴─────────────────┴─────────────────┴─────────────────┴──────────────┤
│  社交对象                                                                     │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Post         │  │ Comment      │  │ Reaction     │  │ Follow       │      │
│  │ 动态         │  │ 评论/回复    │  │ 表情互动     │  │ 关系建立     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                                              │
│  每个对象都必须说明：谁、从哪来、为什么可见、可见范围、关系、下一步操作。      │
├──────────────────────────────────────────────────────────────────────────────┤
│  社交原语                                                                     │
│                                                                              │
│  Human Actor │ Station Source │ Relationship │ Audience │ Delivery │ Policy  │
│  人的身份    │ 来源边界       │ 关系路径     │ 谁能看   │ 怎么到达 │ 可控规则│
├──────────────────────────────────────────────────────────────────────────────┤
│  联邦底座                                                                     │
│                                                                              │
│  Station Boundary │ Federation Scope │ Actor Resolver │ Projection Runtime   │
│  节点边界         │ 联邦语境         │ 身份解析       │ 投影新鲜度           │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 当前阶段产品空间

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Home Feed                                                                    │
│ 我关注的人、我的圈子、与我有明确关系路径的人产生的动态。                     │
└──────────────────────────────────────────────────────────────────────────────┘
        │
        ├── 打开作者
        ▼
┌──────────────────────┐
│ Actor Profile        │
│ 这个人是谁？          │
│ - 显示名 / handle     │
│ - home Station        │
│ - 与我的关系          │
│ - 可见动态            │
└──────────────────────┘
        │
        ├── 探索公共内容
        ▼
┌──────────────────────┐
│ Federated Feed       │
│ 跨 Station 公共内容   │
│ - 来源 Station        │
│ - federation scope    │
│ - 本地信任状态        │
│ - 关注 / 屏蔽入口     │
└──────────────────────┘
        │
        ├── 管理小范围关系
        ▼
┌──────────────────────┐
│ Circles              │
│ 发布者私有关系分组    │
│ - circle audience     │
│ - member preview      │
│ - 发布范围解释        │
└──────────────────────┘
```

### 2.3 Human Actor 社交关系图

```text
                         ┌────────────────────────┐
                         │      Federation         │
                         │  多 Station 的公共语境  │
                         └───────────┬────────────┘
                                     │
        ┌────────────────────────────┴────────────────────────────┐
        │                                                         │
┌───────▼────────┐                                      ┌─────────▼───────┐
│   Station A    │                                      │    Station B    │
│ 我的 home 节点  │◄──────────── 公共发现 / 关系同步 ────►│ 远端可信节点    │
└───────┬────────┘                                      └─────────┬───────┘
        │                                                         │
        │ hosts                                                   │ hosts
        │                                                         │
┌───────▼────────┐       follow / comment / mention       ┌──────▼────────┐
│ Human: Alice   │────────────────────────────────────────►│ Human: Bob    │
│ @alice@a       │◄────────────────────────────────────────│ @bob@b        │
└───────┬────────┘       reply / reaction / follow back    └──────┬────────┘
        │                                                         │
        │ posts to audience                                      │ posts to audience
        ▼                                                         ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Activity Feed                                                                │
│ 每条动态解释：作者、Station、关系路径、Audience、投递原因、互动边界。          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.4 Feed 卡片产品结构

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Avatar] Alice        @alice@station-a.example      12m      Public / Circle │
│          来自 Station A · 因为你关注了 Alice / 同在 Infra Circle              │
│                                                                              │
│          正文内容                                                             │
│          图片 / 链接 / 媒体                                                    │
│                                                                              │
│          Reply   React   Repost   Follow / View profile   More               │
│                                                                              │
│          预览评论：Bob: ...                                                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

Feed 卡片必须表达：

- **Identity**：显示名、handle、home Station。
- **Source**：本地 / 远端 Station、Federation context。
- **Reason**：为什么我看到它。
- **Audience**：谁能看见，是否可跨站互动。
- **Relationship**：是否关注、同圈子、被提及、远端公共内容。
- **Actions**：回复、互动、关注、查看主页、屏蔽、举报或隐藏。

### 2.5 产品分层

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ L4 Experience Layer                                                          │
│ Home Feed、Federated Feed、Profile、Search、Circles。                        │
├──────────────────────────────────────────────────────────────────────────────┤
│ L3 Activity Object Layer                                                     │
│ Post、Comment、Reaction、Follow Event、Audience Explanation。                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ L2 Social Graph Layer                                                        │
│ Human Actor、Follow、Circle、Mention、Block、Relationship Reason。            │
├──────────────────────────────────────────────────────────────────────────────┤
│ L1 Federation Boundary Layer                                                 │
│ Station、Federation Scope、Actor Resolver、Delivery Projection、Policy。      │
└──────────────────────────────────────────────────────────────────────────────┘
```

| 层 | 责任 | 当前阶段不负责 |
|----|------|----------------|
| Experience Layer | Human 社交界面与交互路径 | Agent 社交、Applet 深度场景 |
| Activity Object Layer | 人类动态、评论、互动、关注事件 | Agent Result、A2A Trace |
| Social Graph Layer | 人与人关系、圈子、提及、屏蔽 | Agent delegation |
| Federation Boundary Layer | Station 来源、联邦语境、投递和权限边界 | Federation Ledger 细节 |

---

## 3. 当前阶段接口契约

以下为架构契约，不是最终 proto 字段。实现必须遵循 Proto-First。

```ts
interface HumanActivityObject {
  id: string;
  kind: 'post' | 'comment' | 'reaction' | 'follow_event';
  author: HumanActorRef;
  source: ActivitySource;
  audience: ActivityAudience;
  relationshipReason: RelationshipReason;
  interactionState: InteractionState;
  extensionSlots?: FutureExtensionSlots;
}

interface HumanActorRef {
  actorId: string;
  displayName: string;
  handle: string;
  homeStationDomain: string;
  relationshipToViewer: 'self' | 'following' | 'follower' | 'mutual' | 'circle' | 'mentioned' | 'public' | 'unknown';
}

interface FutureExtensionSlots {
  agent?: 'reserved';
  applet?: 'reserved';
  trace?: 'reserved';
}
```

---

## 4. 组件关系

| 组件 | 职责 | 当前阶段交付 |
|------|------|--------------|
| Actor Resolver | 解析本地/远端 Human Actor | handle、home Station、profile summary |
| Relationship Service | 维护 follow、circle、block、mention 关系 | relationship reason |
| Social Post Service | 发布、读取、评论、reaction | Human post lifecycle |
| Delivery Projection | 生成 viewer-scoped feed | home/federated/profile feeds |
| Desktop Moments Runtime | 消费事件、reconcile、维护投影 | runtime-owned freshness |
| Feed Renderer | 高密度表达 identity/source/reason/audience | modern Human social UI |
| Search View | 找人、找远端 actor | actor discovery |
| Circle View | 发布者私有小范围关系 | audience management |

### 4.1 Accepted Cross-Station Friend Request Boundary

Friend Request is a Social Graph command, not a Chat message and not a client runtime
protocol. The target flow is:

```text
Desktop/Mobile
  -> sender Home Station /api/v1/social/friend-request/send
  -> Social validates sender and writes command + Federation outbox atomically
  -> shared Federation transport authenticates, retries, and deduplicates
  -> receiver Home Station Social authority materializes PENDING
  -> receiver accepts or rejects through /api/v1/social/*
  -> Social commits result + return outbox atomically
  -> both Home Stations converge relationship projections
  -> accepted relationship permits Social to request canonical Conversation creation
```

Ownership:

| Concern | Owner | Forbidden owner |
|---|---|---|
| Friend Request state and policy | receiver Home Station Social | Client, Conversation, Messaging |
| Sender outgoing status | sender Home Station Social replica | UI-only optimistic state |
| Relationship edges | each actor's Home Station Social graph | Federation transport |
| Durable cross-Station delivery | shared Federation transport | Social-specific or Mobile-specific transport |
| Direct Conversation | Conversation authority after accepted relationship | Friend Request repository |

Required semantics include exact command replay, hash conflict rejection, bounded retry,
receiver-owned decision, event-after-commit, and durable result return. Same-Station
delivery invokes the same Social command receiver through a local adapter.

This boundary is accepted by D-07 and AO-D05 as of 2026-09-06.

---

## 5. Future Extension Points

当前阶段只预留，不实现：

| 扩展点 | 预留方式 | 不做什么 |
|--------|----------|----------|
| Agent Actor | Actor kind / card slot | 不让 Agent 发动态，不做 Agent 社交 |
| A2A Result | trace/result slot | 不做跨站 Agent 调用 |
| Applet Surface | object action slot | 不做 Applet 发布社交对象 |
| Coordination Object | object kind reserved | 不做协作/共识闭环 |

这些预留点的目标是避免 Human 社交模型未来无法扩展，但不得让当前阶段实现范围膨胀。
