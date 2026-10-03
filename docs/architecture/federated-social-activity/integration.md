# Federated Human Social Activity — 集成关系

> **Status**: draft
> **Version**: v0.3
> **Created**: 2026-06-17 | **Updated**: 2026-10-03
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
| `docs/architecture/social/` | Moments 基础架构 | 下游能力实现约束 |
| `docs/architecture/federation/` | Federation / Station scope | source station、federated public feed 语境 |
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
- Existing Circle 仍是发布者 Home Station 私有关系分组，不复制为联邦共享对象；
  其成员可以引用同一 active Federation 内的远端 Actor。
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
| Native clients | call the same `/api/v1/social/*` API and render projection; Desktop is current, Mobile later | no platform-specific protocol |

The dependency and deletion contract is owned by
`docs/architecture/api-ownership/integration.md`. AO-D01 through AO-D06 and D-07
were accepted on 2026-09-06; implementation follows the linked execution plan.

---

## 8. Cross-Station Private Social Integration

### 8.1 Current Foundation And Missing Closure

| Existing asset | Reuse | Missing closure |
|---|---|---|
| `station/frame/core/federation/delivery` | durable signed outbox/inbox, retry, dedup, ordering | four Social private payload kinds and receivers |
| `social/application/private_content_service.go` | prepare/submit UOW, commit proof, grants, envelopes | remote locality admission and atomic remote outbox |
| `social/private_content_ports.go` | remote endpoint-manifest resolution | grouped remote Content PreKey claim |
| `key_exchange/content_prekey_capability.go` | one-time endpoint/recovery key authority | authenticated Federation inventory/claim peer routes |
| `social/infrastructure/federated_*` | Social Friend Request and relationship delivery pattern | private resource/interaction receiver and stores |
| `social/private_object_service.go` | source-owned encrypted object grant | Federation-authenticated ciphertext stream |
| Desktop `privateMomentsNative` and `momentsRuntime` | local decrypt, SQLCipher projection, event/reconcile | remote source identity and pending delivery projection |

### 8.2 Contract And Generation Impact

Proto-first work touches:

- `model/domain/social/private_federation.proto` (new);
- `model/domain/federation/delivery.proto` (new payload kinds only);
- `model/domain/key_exchange/key_exchange.proto` (federated Content PreKey wrappers);
- `model/domain/error/error.proto` only if existing typed errors cannot express
  remote pending, source unavailable or terminal federation rejection.

Generated Go, Rust, Desktop TypeScript and Mobile TypeScript outputs must be
regenerated together. Mobile generation is contract compatibility only and does
not enable Mobile product code or readiness.

### 8.3 Station Composition

`apps/station/app/subserver/social` remains the business owner:

- source-side coordinator groups recipients by Home Station;
- source submit transaction persists canonical resource and Federation frames;
- receiver registers typed Social private receivers before runtime seal;
- receiver projection repository serves local authenticated Social reads;
- interaction coordinator returns remote commands to source authority;
- invalidation coordinator advances target projections monotonically.

`apps/station/app/subserver/key_exchange` owns remote Content PreKey
inventory/claim endpoint behavior. `station/frame/core/federation` owns only
peer routes, authentication and domain-neutral transport.

### 8.4 API Ownership

Client-facing APIs remain under the canonical Social resource owner:

```text
/api/v1/social/moments/*
/api/v1/social/private/*
```

Federation-owned peer routes are internal:

```text
/federation/key-exchange/content-prekeys/inventory
/federation/key-exchange/content-prekeys/claim
/federation/social/private/objects/:object_id
```

Durable private resource and interaction frames use
`/federation/delivery`. No second public Social API family is introduced.

### 8.5 Persistence

Source Station:

- retains canonical private Post/Comment/Reaction truth;
- retains all audience grants and commit proof;
- atomically inserts remote Federation outbox frames during submit/revoke.

Recipient Station:

- stores viewer-scoped remote resource/envelope projections;
- stores local remote-command state for pending/retry/result presentation;
- never writes source-authority Post/Comment tables;
- can rebuild projections from replay/reconcile.

### 8.6 Desktop Native

Desktop Rust keeps one Social transport facade. It reads local and imported
resources through the same Home Station API and validates source Station proof
attestations before decryption. Desktop Web keeps `momentsRuntime` as projection
owner and adds only typed states/actions for remote pending, source unavailable,
retry and invalidation.

No page mount fetch, direct remote Station URL, second Social store or Browser
fallback is allowed.

### 8.7 Browser Hard Cut

The implementation inventory must remove or gate out Browser registrations for:

- Moments page descriptors and navigation entries;
- `momentsRuntime` installation;
- Social publish/read/comment/reaction actions;
- private key, recovery and encrypted object handlers.

The public Station HTTP API and Federation peer routes remain available to
Native clients and infrastructure. A source gate must prove Browser build
entrypoints cannot reach Social product code.

### 8.8 Migration And Cutover

1. Add contracts and generated artifacts with old remote rejection still active.
2. Add remote Content PreKey routes and exact replay tests.
3. Add receiver projections, payload receivers and object stream.
4. Add source outbox and remote interactions behind the existing locality guard.
5. Add Desktop pending/retry/read/recovery projection.
6. Run two-Station shadow tests while production behavior still rejects remote
   recipients.
7. Atomically remove the locality rejection and enable positive remote audience.
8. Prove Browser zero registration and two-Station Native acceptance.

No permanent feature flag, dual write or legacy remote-rejection fallback
remains after cutover.
