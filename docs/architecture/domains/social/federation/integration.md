# Federated Human Social Activity — 集成关系

> **Status**: draft
> **Version**: v0.2
> **Created**: 2026-06-17 | **Updated**: 2026-09-06
> **Owner**: Architecture Team

---

## 1. Integration Scope

本文档定义当前 Human 联邦社交阶段与现有模块的映射、影响面和迁移策略。

当前阶段不集成 Agent 社交、A2A 执行、Applet 发布社交对象。

---

## 2. 现有模块映射

| 模块 | 当前职责 | 本阶段使用方式 |
|------|----------|----------------|
| `model/domain/actor/` | Actor / ActorRef / ActorKind | Human Actor 身份真源 |
| `model/domain/social/post.proto` | Post、Audience、Reaction、Timeline、FeedObjectExplanation | Human post / audience / reaction / explanation 真源 |
| `model/domain/social/comment.proto` | 评论与回复 | Comment thread 真源 |
| `model/domain/social/circle.proto` | 发布者私有圈子 | Circle audience 和 circle feed |
| `docs/architecture/domains/social/core/` | Moments 基础架构 | 下游能力实现约束 |
| `docs/architecture/domains/federation/` | Federation / Station scope | source station、federated public feed 语境 |
| `apps/desktop/src/runtimes/momentsRuntime.ts` | Moments 投影 owner | 当前阶段继续作为 Human feed runtime |
| `apps/desktop/src/store/moments.ts` | Feed / post / comments / reactions store | 增加 source/reason/audience explanation 投影 |
| `apps/desktop/src/pages/moments/` | Moments UI | 升级为 Human federated social UI |

---

## 3. 边界约束

### 3.1 Identity

- 任何跨边界身份必须使用 ActorRef 或其生成类型。
- Display name、avatar、bio 只是 profile projection，不是身份真源。
- 远端 Human Actor 必须显示 home Station。

### 3.2 Visibility

- `Audience` 是权限真源。
- `RelationshipReason` 是解释模型，不参与权限判定。
- 页面不能根据 relationship 自行判断可见性。

### 3.3 Federation

- Public federated feed 必须显示 source Station。
- Station trust / block policy 可以影响展示和互动入口。
- 普通 Human post 不进入 Federation Ledger。

### 3.4 Runtime

- Desktop Web 页面保持纯渲染。
- `momentsRuntime` 或后续 `humanSocialRuntime` 负责 bootstrap、事件消费、periodic reconcile。
- 显式分页、发布、评论、reaction 是用户动作，可以调用 store action。

### 3.5 Future Capability

- Agent / A2A / Applet 不进入本阶段 runtime freshness 闭环。
- UI 可以预留 object action slot，但不得出现不可用的假入口。

---

## 4. Migration Strategy

### Step 1: Feed Semantics

- MomentCard 显示 author home Station。
- Feed 显示 relationship reason。
- Audience badge 改为可解释的人类语言。
- 远端公开内容和本地关系内容视觉区分。

### Step 2: Projection Shape

- Store 增加 `feedExplanations`，按 `Post.id` 保存 `FeedObjectExplanation`。
- Runtime 在 projection sync 后消费 Station 返回的解释投影。
- 现有 postsById/feedIds 结构保留。

### Step 3: Human Social Surfaces

- Home Feed：可信关系流。
- Federated Feed：跨站公共流。
- Profile：远端/本地 Human Actor 主页。
- Search：找人和远端 actor。
- Circles：小范围发布关系。

### Step 4: Interaction Closure

- 发布、评论、reaction、关注、取消关注、屏蔽 actor/station。
- 所有操作有 loading/error/retry 状态。
- 错误消息走 i18n，不暴露底层异常。

### Step 5: E2E Harness

- 两 Station、三用户、public/followers/circle/self audience。
- 验证投递、关系解释、互动和 reload/reconnect recovery。

---

## 5. Impact Surface

| 层 | 影响 |
|----|------|
| Proto | 已补 `FeedObjectExplanation`、`ActivitySource`、`RelationshipReason`、`AudienceExplanation`、`BlockExplanation` |
| Station | timeline / projection sync / profile / detail 返回 source/reason/audience/block explanation |
| Desktop Rust | social command bridge 保持 proto bytes，由 Tauri build.rs 生成 Rust proto |
| Desktop Web Runtime | momentsRuntime 继续拥有 projection freshness |
| Store | 已增加 `feedExplanations` map |
| UI | Feed card、Profile、Search、Circles 重构 |
| Locales | 所有新增文案进入 `packages/locales` |
| E2E | 多 Station Human 社交验收脚本 |

Station block integration boundary:

- Actor block 已由 Station social block graph 接入 Moments feed exclusion。
- Station-level block / moderation 需要独立 Station policy source，见 `moderation-projection.md`。
- Desktop 只能渲染 Station 返回的 `BlockExplanation`，不能根据缺失 feed item 或 remote domain 自行判断 station block。

---

## 6. Compatibility

- Existing Post / Comment / Reaction 仍是当前阶段核心对象。
- Existing Audience 不改语义，只增加解释投影。
- Existing Circle 仍是发布者私有关系分组，不联邦化。
- Existing Moments runtime 保持投影 owner，后续可重命名但不以页面 fetch 替代。
- Agent / A2A / Applet 文档仍有效，但不作为当前阶段实现依赖。

## 7. Accepted Friend Request Federation Integration

The D-07 implementation boundary is cross-domain but not cross-owned:

| Layer | Integration | Ownership rule |
|---|---|---|
| Model | typed Social Friend Request command/event and typed Federation frame | Social semantics remain separate from Chat payloads |
| Sender Social | local validation, exact command persistence, outgoing projection, outbox insertion | no direct remote database mutation |
| Federation | Station authentication, delivery, retry, dedup, bounded admission | no Friend Request policy or relationship mutation |
| Receiver Social | idempotent materialization, accept/reject, relationship projection, result outbox | receiver Home Station is decision authority |
| Conversation | create/reuse Direct only after accepted Social relationship | no Friend Request persistence |
| Desktop/Mobile | call the same `/api/v1/social/*` API and render projection | no platform-specific protocol |

The dependency and deletion contract is owned by
`docs/architecture/engineering/api-governance/integration.md`. AO-D01 through AO-D06 and D-07
were accepted on 2026-09-06; implementation follows the linked execution plan.
