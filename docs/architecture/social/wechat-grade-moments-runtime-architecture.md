# WeChat-Grade Moments Runtime Architecture

> Status: Draft, 2026-05-09
>
> Scope: 将现有 Moments / Social 能力从“页面拉取型朋友圈”升级为
> “熟人社交实时投影系统”。本文是 architecture-layer source，约束
> Station、Desktop Rust BFF、Desktop Web runtime、页面与未来 Mobile
> 的职责边界。
>
> Related:
>
> - `docs/architecture/social/moments.md`
> - `docs/architecture/secure-content/README.md`
> - `docs/client/desktop/runtime-projections.md`
> - `docs/architecture/runtime/desktop-runtime-architecture.md`
>
> Private payload/key/object mechanics are owned by Secure Content. This
> document owns Social runtime projections and must not introduce a second
> encryption, envelope, object-transfer, or recovery implementation.

## 1. 真实升级目标

### 1.1 背景

现有 Moments 已具备基础能力：`Audience`、公开/私密存储分离、Circle、
Reaction、Comment、Timeline、图片上传与 lightbox。但整体体验仍偏
“公开社交 feed + 朋友圈皮肤”，不具备微信朋友圈的熟人关系感、即时感、
隐私感和连续性。

根因不是单个页面不够精致，而是能力仍以页面加载和 store 缓存为中心：

- Feed 的新鲜度依赖页面挂载、按钮刷新或局部调用。
- Comment / Reaction 没有完整事件投影和通知闭环。
- Circle / Group / Custom audience 的真实身份与关系依赖仍未完全接入。
- Desktop 没有专门的 Moments runtime owner 来维护长生命周期投影。
- 图片与媒体预热仍偏组件级调用，缺少 runtime 级策略。

### 1.2 升级定义

本次升级不是“补几个朋友圈功能”，而是领域升级：

```text
from: page-driven social feed
to:   runtime-projected trusted relationship moments network
```

目标状态：

- Station 持有跨端业务真源、权限判定、投递事实、审计事实。
- Desktop Rust 是本地 BFF / 网关 / 本地能力编排层，不被 Desktop Web 绕过。
- Desktop Web 通过长生命周期 runtime 持有业务投影，页面只做纯渲染和用户动作。
- 每个可见业务状态同时具备事件消费路径和周期 reconcile 路径。
- Moments 主体验围绕熟人动态、个人相册、互动消息、隐私控制，而不是公开 Explore。

### 1.3 非目标

- 不在本设计中重写 ActivityPub 入站/出站。
- 不把微信所有商业功能照搬进 Peers-Touch。
- 不允许为了快速展示而引入 mock API。
- 不允许绕过 proto-first 和 runtime projection 规则直接堆页面逻辑。
- 不要求一次性完成 Mobile UI，但协议与 Station 设计必须为 Mobile 保持一致真源。

## 2. 领域责任

### 2.1 `relationship`

熟人关系域，负责回答“谁和谁具备什么关系”。

职责：

- 双向好友、好友申请、拉黑、删除好友。
- 单向关注作为 public / federation 关系保留，但不作为朋友圈主关系。
- 关系附加策略：不看他、不给他看、仅聊天、备注、分组。
- 共同好友判断，为互动可见性提供上下文。

不负责：

- 决定一条 Moment 的最终读权限。
- 保存 feed 投递结果。

### 2.2 `audience`

发布时可见性域，负责回答“这条 Moment 理论上允许谁看”。

职责：

- 保存发布时冻结的 Audience。
- 校验 Circle / Group / Custom allow / Custom deny 的合法性。
- 将熟人关系策略纳入可见性决策。
- 输出投递候选集合给 delivery 域。

不负责：

- 维护每个 viewer 的收件箱游标。
- 管理评论/点赞通知。

### 2.3 `delivery`

投递域，负责回答“某个 viewer 是否收到过这条 Moment”。

职责：

- 为私密 Moment 生成 viewer-scoped delivery 事实。
- 为 HOME timeline 提供权威读取源。
- 记录投递版本、投递原因、失效原因。
- 在关系变化、Circle 变化、删除、拉黑时执行失效或重算。

关键决策：

- 私密朋友圈 HOME timeline 不应长期依赖运行时多源 SQL 拼接。
- 写入时生成 delivery，读取时按 viewer inbox 拉取。
- Station 仍做权限最终判定；Desktop runtime 只消费已授权投影。

### 2.4 `interaction`

互动域，负责评论、回复、Reaction、转发包装。

职责：

- 创建、删除、分页读取评论。
- typed reaction 聚合与 viewer 个人状态。
- 一层回复模型。
- 互动可见性：viewer 只能看到自己有权看到的互动作者产生的互动。

微信级差异：

- “我能看到这条 Moment”不等于“我能看到所有评论/点赞人”。
- 评论/点赞列表需要基于共同关系、作者、viewer 与互动者关系做二次过滤。

### 2.5 `notification`

通知域，负责互动消息和红点事实。

职责：

- Moment 被评论、被点赞、被 @、被回复。
- 好友申请、好友通过、关系变化。
- 未读计数、会话化的互动消息列表。
- 通知事件进入 Desktop runtime 投影。

不负责：

- 页面上的局部 badge 展示逻辑。

### 2.6 `album`

个人相册域，负责长期资产呈现。

职责：

- 用户主页 Moment 时间轴。
- 月份/年份分组。
- 公开资料和朋友圈封面。
- 本人可见的隐私内容与他人可见内容分离读取。

### 2.7 `momentsRuntime`

Desktop Web 长生命周期 runtime，负责 Moments 投影新鲜度。

职责：

- 登录后 bootstrap Moments 首页、个人资料摘要、Circle 摘要、未读互动计数。
- 消费 Station events / notification，立即更新 feed、detail、comments、reactions、badge。
- 周期 reconcile，覆盖 SSE 丢失、窗口休眠、网络重连、进程暂停。
- 调用 media runtime 预热首屏图片和 detail 大图。
- 对页面暴露稳定 store selector。

不负责：

- 自行判断 Station 权限。
- 绕过 Desktop Rust 直接访问 Station。
- 在页面 mount 时补业务新鲜度。

## 3. 标准生命周期

### 3.1 发布 Moment

```text
Desktop Page
  -> momentsRuntime action
  -> desktop-rust social command
  -> Station social.CreateMoment
  -> audience validate
  -> delivery fan-out
  -> moment.created event
  -> notification / realtime stream
  -> momentsRuntime projects local feed
  -> reconcile validates projection
```

要求：

- Composer 只收集输入和触发 action。
- 发布成功后 runtime 将返回的 Moment 插入本地 HOME / author album 投影。
- Station 事件到达后 runtime 去重，不重复插入。
- reconcile 以 Station truth 覆盖本地乐观状态。

### 3.2 接收 Moment

```text
Station delivery row created
  -> realtime event: moment.created
  -> desktop-rust event stream bridge
  -> desktop-web eventBus
  -> momentsRuntime consumes
  -> momentsStore feed projection updated
  -> navigationBadge updated
  -> mediaRuntime prewarms thumbnails
```

要求：

- 新动态不依赖用户进入 Moments 页面才出现。
- 页面未打开时只更新 badge / unread / feed cache，不强制渲染页面。
- 页面打开时读取已热的 projection。

### 3.3 互动

```text
User reacts/comments
  -> runtime optimistic projection
  -> Station interaction service
  -> moment.reacted/commented event
  -> runtime confirms or corrects
  -> notification projection updates
```

要求：

- 乐观更新必须可回滚。
- 评论列表需要 detail projection owner，不由 detail page 自己持有真源。
- 互动事件必须带足够字段支持投影去重。

### 3.4 恢复与对账

触发：

- 登录恢复。
- SSE reconnect。
- 桌面从睡眠恢复。
- 网络从 degraded 恢复。
- 周期 timer。
- 用户显式 refresh。

行为：

- `momentsRuntime.reconcile(reason)` 拉取 delivery delta、interaction delta、notification count。
- 对账更新 feed cursor、detail snapshot、comments cursor、reaction summary。
- 对账失败只降级当前 projection，不破坏页面可见旧数据。

## 4. 运行单元边界

### 4.1 Station

Station 是跨端真源。

负责：

- Proto-defined domain model。
- Moment / Audience / Delivery / Interaction / Notification 的业务规则。
- 权限判定与审计。
- 事件生产。
- 私密与公开存储边界。

禁止：

- 为 Desktop UI 特化存储形状。
- 把页面状态、滚动位置、展开状态写入业务真源。

### 4.2 Desktop Rust

Desktop Rust 是本地 BFF 和本地网关。

负责：

- Tauri command / HTTP gateway。
- Station API 编排。
- 本地安全存储、会话、OSS URL resolve、系统通知。
- Station event stream 到 Desktop Web eventBus 的桥接。

禁止：

- 把 Desktop Web 绕过 Rust 直连 Station。
- 在 Rust 中复制 Station 权限规则作为第二套真源。

### 4.3 Desktop Web

Desktop Web 是渲染和投影消费层。

负责：

- RuntimeDescriptor 管理长生命周期投影。
- Store 保存 runtime projection。
- PageDescriptor 声明页面挂载、keepAlive、runtime 依赖。
- 页面纯渲染与用户动作。

禁止：

- 页面 mount-time 首屏业务 fetch 作为主要加载机制。
- tab click / modal open 才刷新业务真源。
- 多个 runtime 共同写同一 projection 字段。

## 5. Desktop Runtime 目标结构

```text
apps/desktop/src/
├── kernel/
│   ├── runtime.ts
│   ├── page.ts
│   ├── boot.ts
│   ├── PageHost.tsx
│   └── usePrefetch.ts
├── runtimes/
│   ├── momentsRuntime.ts
│   ├── relationshipRuntime.ts
│   ├── notificationRuntime.ts
│   └── mediaRuntime.ts
├── services/
│   ├── momentsRealtime.ts
│   ├── social_api.ts
│   └── desktop_api.ts
├── store/
│   ├── moments.ts
│   ├── relationships.ts
│   ├── notification.ts
│   └── navigationBadges.ts
└── pages/moments/
    ├── MomentsApp.descriptor.tsx
    ├── MomentsApp.tsx
    ├── MomentsFeedPage.tsx
    ├── MomentDetailPage.tsx
    ├── MomentsUserPage.tsx
    └── CircleManagePage.tsx
```

初始迁移可先只有 `momentsRuntime`，后续再按责任拆出
`relationshipRuntime` 与 `notificationRuntime`。拆分标准是“投影 owner
是否不同”，不是页面是否不同。

## 6. Store 投影边界

`momentsStore` 保存：

- `homeFeed`: viewer inbox feed。
- `publicFeed`: public Explore feed，低优先级。
- `authorFeeds`: 用户相册 feed。
- `details`: Moment detail snapshot。
- `commentsByPost`: comment projection。
- `reactionsByPost`: reaction summary projection。
- `circles`: publisher-private circle projection。
- `interactionInbox`: 朋友圈互动消息摘要。
- `projectionStatus`: bootstrap / reconciling / degraded metadata。

`momentsStore` 不保存：

- Station 权限规则。
- Tauri session。
- OSS resolve 全局缓存。
- 页面滚动位置和局部展开状态。

## 7. Station 目标结构

```text
apps/station/app/subserver/social/
├── application/
│   ├── moment_service.go
│   ├── delivery_service.go
│   ├── interaction_service.go
│   ├── relationship_policy_service.go
│   ├── album_service.go
│   └── projection_sync_service.go
├── domain/
│   ├── moment.go
│   ├── audience.go
│   ├── delivery.go
│   ├── relationship_policy.go
│   ├── interaction_visibility.go
│   └── events.go
└── infrastructure/
    ├── delivery_repo.go
    ├── projection_cursor_repo.go
    ├── private_post_repo.go
    ├── public_post_repo.go
    └── interaction_repo.go
```

关键新增：

- `Delivery` 是 private HOME timeline 的读取真源。
- `ProjectionSyncService` 为 Desktop runtime 提供 delta reconcile。
- `InteractionVisibility` 是评论/点赞可见性的唯一领域判定器。

## 8. Proto 方向

Proto 仍是唯一真源。后续新增或扩展应优先落在：

- `model/domain/social/delivery.proto`
- `model/domain/social/projection.proto`
- `model/domain/social/interaction.proto`
- `model/domain/social/relationship.proto`
- `model/domain/realtime/event.proto`

建议消息形状：

- `MomentDelivery`: `moment_id`, `viewer_actor_id`, `reason`, `delivered_at`, `revoked_at`, `version`
- `SyncMomentsProjectionRequest`: `cursor`, `limit`, `include_notifications`
- `SyncMomentsProjectionResponse`: `events`, `next_cursor`, `has_more`
- `MomentProjectionEvent`: `event_id`, `event_type`, `moment`, `comment`, `reaction`, `occurred_at`
- `InteractionVisibilityContext`: `viewer_id`, `moment_author_id`, `interaction_actor_id`

## 9. 评价体系

### 9.1 资产层

- 是否形成 `momentsRuntime`、delivery、projection sync、interaction visibility 等长期资产。
- 是否减少页面内 mount-time fetch。
- 是否减少重复权限判断和重复 store 写入。

### 9.2 行为层

- 新 Moment 是否能在未打开 Moments 页面时进入投影和 badge。
- 评论/点赞是否能即时出现在已打开 detail。
- 断网重连后 feed、评论、红点是否自动校正。
- 切换页面后 Moments 是否保持热状态。

### 9.3 对照层

- 和当前 `feature/social-moments-p3-images` 对比首开、切回、互动延迟。
- 和 high-chat runtime 模型对比是否具备事件消费 + reconcile 双路径。

### 9.4 反指标

- 新增页面级 `useEffect(...loadFeed...)` 作为主加载机制。
- Desktop Web 直连 Station。
- 未经 Station 权限判定的端侧私密可见性猜测。
- 评论/Reaction 只改 UI 数字但不进入 projection sync。
- runtime 多处写同一 store 字段且无 owner。

## 10. 验收标准

- `moments` 页面具备 PageDescriptor，声明 runtime 依赖。
- `momentsRuntime` install / bootstrap / reconcile 幂等。
- Moment create / comment / reaction 至少有一条事件消费路径。
- 至少一个周期 reconcile 能覆盖 missed events。
- HOME feed 的新鲜度不依赖页面 mount。
- 图片缩略图预热由 media runtime 或等价 runtime owner 负责。
- Station 端所有新增模型 proto-first。
- Desktop `pnpm run check && pnpm run test && pnpm run build` 通过。
- Station `gofmt -l . && go test ./...` 通过。
