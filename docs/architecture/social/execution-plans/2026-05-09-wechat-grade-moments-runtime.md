# 2026-05-09 WeChat-Grade Moments Runtime Execution Plan

> **Status**: superseded
> **Version**: v1.0
> **Created**: 2026-05-09 | **Updated**: 2026-10-03
> **Owner**: Social / Client Platform
>
> Parent architecture:
> `docs/architecture/social/wechat-grade-moments-runtime-architecture.md`
>
> Method: Domain Responsibility -> Execution Closure -> Dependency Order ->
> Verifiable Delivery.
>
> **Superseded by**:
> `docs/architecture/federated-social-activity/execution-plans/20261003-cross-station-social-native/plan.md`.
> Completed runtime/projection work remains valid. Remaining Native Desktop
> federation closure is re-inventoried there; Mobile is deferred and Browser
> Social is removed.

## 1. 目标

将 `peers-social` 的 Moments 从页面拉取型 feed 升级为 runtime 投影型熟人社交系统。

本计划的完成标准不是“页面看起来像微信”，而是：

- 业务投影有明确 runtime owner。
- 页面只渲染，不再靠 mount-time fetch 维持业务新鲜度。
- Station 形成 delivery / projection sync / interaction visibility 的后端闭环。
- Desktop 形成 event consumption + periodic reconcile 双路径。
- UI 抛光建立在稳定投影之上。

## 2. 当前存量

已存在：

- Station `social` subserver 的 DDD 基础结构。
- `Audience`、Circle、typed Reaction、Comment、Timeline。
- 公开/私密 post repo 分离。
- Desktop `moments` store、页面、Composer、图片上传、lightbox。
- 基础 `docs/client/desktop/runtime-projections.md`，但尚未包含 high-chat 里的 Page / Runtime / Boot kernel 合约完整形态。

主要缺口：

- `peers-social` 尚未合入 `apps/desktop/src/kernel/runtime.ts` / `page.ts` / `boot.ts` / `PageHost.tsx`。
- Moments 没有专属 runtime。
- Station social events 只定义形状或日志，没有接入完整投影事件流。
- HOME timeline 仍以查询合并为主，缺少 viewer-scoped delivery inbox。
- 评论/点赞可见性仍偏 post-level gate，未形成微信式共同关系过滤。

## 3. 领域拆分

| 领域 | Owner | 第一交付物 | 成功判断 |
|---|---|---|---|
| Runtime Kernel | Desktop Web | Page / Runtime / Boot kernel | 页面可声明 runtime 依赖与 keepAlive |
| Moments Runtime | Desktop Web | `momentsRuntime` + projection store | feed 新鲜度不依赖页面 mount |
| Media Runtime | Desktop Web / Rust | 图片预热与 resolve cache | feed 图片首屏无组件级重复 resolve |
| Delivery | Station | viewer-scoped delivery repo/service | HOME feed 可从 inbox 读取 |
| Projection Sync | Station + Desktop | delta sync API + reconcile | 丢事件后可自动校正 |
| Interaction Visibility | Station | 评论/点赞二次可见性判定 | 评论/点赞列表符合熟人关系上下文 |
| Notification / Badge | Station + Desktop | moment interaction notifications | 未打开页面也能产生可靠红点 |
| WeChat-Grade UI | Desktop Web | 相册、原地评论、九宫格、互动消息 | 体验不再像后台 feed |

## 4. 依赖拓扑

```text
Runtime Kernel
  -> Moments Runtime
      -> Event Consumption
      -> Projection Reconcile
  -> PageDescriptor Migration

Station Relationship/Audience hardening
  -> Delivery Inbox
      -> Projection Sync
          -> Moments Runtime Reconcile

Interaction Visibility
  -> Notification Events
      -> Runtime Badge Projection

Media Runtime
  -> Feed Image Prewarm
      -> UI Polish
```

不得跳过：

- 不能先做 UI 大改，再补 runtime。
- 不能先做 delivery API，却没有 runtime reconcile 消费。
- 不能只加 SSE 事件，不加 missed event 对账路径。

## 5. Phase 0 - 同步 Runtime Kernel 合约

### 目标

把 high-chat 已验证的 Page / Runtime / Boot 契约同步到 `peers-social`。

### 任务

1. 更新 `docs/client/desktop/runtime-projections.md`，补齐：
   - `RuntimeDescriptor`
   - `PageDescriptor`
   - Boot phases
   - `kernel/usePrefetch`
   - 页面禁止 mount-time business fetch 的规则
2. 引入或对齐：
   - `apps/desktop/src/kernel/runtime.ts`
   - `apps/desktop/src/kernel/page.ts`
   - `apps/desktop/src/kernel/boot.ts`
   - `apps/desktop/src/kernel/PageHost.tsx`
   - `apps/desktop/src/kernel/usePrefetch.ts`
3. 更新 `services/appRuntime.ts`，注册 kernel runtimes。
4. 保留 legacy `PageRouter` fallback，避免一次性迁移所有页面。

### 验收

- Desktop 能启动。
- 现有 chat/search/settings 页面行为不回退。
- 新增页面必须能通过 PageDescriptor 注册。
- `pnpm run check` 不出现新增 TS 错误。

## 6. Phase 1 - 建立 Moments Runtime

### 目标

让 Moments 投影有唯一 owner。

### 任务

1. 新增 `apps/desktop/src/runtimes/momentsRuntime.ts`。
2. 新增或改造 `apps/desktop/src/services/momentsRealtime.ts`。
3. 将 `useMomentsStore.loadFeed/loadPost/loadComments/listMyCircles` 从页面首屏路径迁移到 runtime bootstrap / reconcile。
4. 新增 projection 状态：
   - `bootstrappedActorId`
   - `projectionStatus`
   - `lastReconciledAt`
   - `degradedReason`
5. 将 `MomentsApp` 注册为 PageDescriptor：
   - `preload: 'idle'`
   - `keepAlive: 'forever'`
   - `runtimes: ['moments']`

### 验收

- 打开应用后未进入 Moments 页面，runtime 也能 bootstrap 基础投影。
- 切入 Moments 页面不触发主路径 feed 首次拉取。
- 切出再切回不丢 feed、detail、评论展开状态之外的业务投影。
- 页面内允许用户显式 refresh，但 refresh 调用 runtime action。

## 7. Phase 2 - Station Events 与 Desktop 消费

### 目标

Moment 创建、删除、评论、点赞有实时投影路径。

### 当前落地状态

Phase 2 的最小端到端 realtime 骨架已落地：

- `kernel/events` 已声明 `moment.created`、`moment.deleted`、`moment.commented`、`moment.reacted`、`moment.resync_requested`。
- `momentsRuntime` 已订阅这些事件，并按事件刷新 HOME / detail / comments / reactions 相关投影。
- `momentsRuntime` 也订阅通用 `realtime.resync`，用周期 reconcile 兜底 missed events。
- `model/domain/realtime/event.proto` 已增加 `MomentEvent` oneof arm，并通过 `./model/build.sh` 生成 Go / TS 代码。
- `services/eventStream.ts` 已能从 Station `StreamEvent.moment` 解出 Moment 事件并派发到 Desktop Web eventBus。
- Station social application 层已新增 `MomentEventPublisher`，在 Moment 创建/删除、评论、点赞/取消点赞成功后 best-effort 发布作者/操作者自己的多端 echo。

尚未完成：

- Delivery Inbox 尚未落地，因此 Station 暂不做全量 audience fan-out，避免把隐私可见性猜测写进 realtime plane。
- `moment.comment_deleted` 还没有 proto kind 和 Desktop runtime 消费分支，评论删除仍依赖后续 reconcile。
- 红点/互动通知 projection 尚未接入，当前事件只刷新 Moments 业务投影。

### 任务

1. 在 `model/domain/realtime` 或 social projection proto 中定义事件。
2. Station social service 在事务成功后发布：
   - `moment.created`
   - `moment.deleted`
   - `moment.commented`
   - `moment.comment_deleted`
   - `moment.reacted`
   - `moment.unreacted`
3. Desktop Rust event stream bridge 解码并转发到 Desktop Web eventBus。
4. `momentsRuntime` 消费事件并更新：
   - HOME feed
   - author feed
   - detail snapshot
   - comments projection
   - reactions projection
   - navigation badge

### 验收

- 两个 Desktop 实例登录不同账号，一个发布 Moment，另一个不进入页面也能收到事件或 badge。
- 已打开 detail 时评论/点赞能即时变化。
- 事件重复投递不造成重复插入。

## 8. Phase 3 - Delivery Inbox

### 目标

将私密 HOME timeline 从运行时查询拼接升级为 viewer-scoped delivery inbox。

### 当前落地状态

最小 Delivery Inbox 已落地：

- Proto 已定义 `MomentDelivery`，作为 HOME 私密投影的 durable viewer-scoped inbox entry。
- Station 新增 `social_moment_deliveries` 表，`MomentDeliveryRepository` 负责 upsert、分页查询和按 post revoke。
- `CreateMoment` 在私密 Moment 写入事务内同步生成 delivery rows。
- `DeleteMoment` 会 revoke 已生成 delivery rows，且先校验作者所有权，避免非作者误撤销。
- HOME timeline 已优先读取 delivery inbox，并合并 self-public / followed-public；PUBLIC Moment 仍走 public feed 路径，不写入 private delivery。

当前限制：

- FOLLOWERS / SELF 可形成有效 delivery。
- CUSTOM_ALLOW / CUSTOM_DENY(FOLLOWERS) 已保留 resolver 路径，但当前默认 noop resolver 下只保证 author delivery。
- CIRCLE / GROUP fan-out 等待真实 ActorResolver / GroupMembershipChecker 暴露 durable local actor IDs；当前 author-only，不猜权限。

### 任务

1. Proto-first 定义 `MomentDelivery`。
2. 新增 Station delivery aggregate / repo / service。
3. `CreateMoment` 成功后根据 Audience 生成 delivery rows。
4. HOME timeline 改为读取当前 viewer delivery inbox。
5. 保留旧多源 merge 作为迁移期 fallback。
6. 关系变化、Circle 变化、删除 Moment 时更新或 revoke delivery。

### 验收

- FOLLOWERS / CIRCLE / GROUP / CUSTOM_ALLOW 的私密 Moment 能进入正确 viewer inbox。
- SELF Moment 只进入作者自己的 inbox。
- CUSTOM_DENY 能撤销被 deny actor 的 delivery。
- 公开 Moment 仍可走 public feed，不污染 private delivery。

## 9. Phase 4 - Projection Sync / Reconcile

### 目标

补齐 missed events、断线、休眠恢复后的对账能力。

### 当前落地状态

最小 Projection Sync / Reconcile 已落地：

- Proto 已定义 `SyncMomentsProjectionRequest/Response`，作为 Desktop runtime 对账入口。
- Station 新增 `POST /api/v1/social/moments/sync`，一次返回 HOME 与 PUBLIC compact snapshot。
- Desktop Tauri BFF 新增 `social_sync_moments_projection`，保持 proto bytes 转发，不引入 JSON 平行模型。
- Desktop `social_api` 新增 `socialSyncMomentsProjection`，`useMomentsStore.syncProjection(reason)` 将 snapshot 归一化写回 HOME / Explore。
- `momentsRuntime` 的 bootstrap、周期 reconcile、`moment.resync_requested`、`realtime.resync` 已改走 sync API。

当前限制：

- Sync 目前是 bounded compact snapshot，不是逐事件 delta replay。
- comments / reactions 仍依赖 `Post` hydrate 后的摘要和 detail projection；评论线程 delta 会在后续补齐。
- degraded 状态尚未显式建模；失败时保留旧 store 数据并记录 warning。

### 任务

1. 定义 `SyncMomentsProjectionRequest/Response`。
2. Station 返回自 cursor 后的 projection events 或 compact snapshot。
3. Desktop `momentsRuntime.reconcile(reason)` 调用 sync API。
4. reconcile 覆盖：
   - feed delta
   - comments delta
   - reactions delta
   - notifications delta
   - delivery revoked
5. 对账失败进入 degraded 状态，不清空旧数据。

### 验收

- 断开 SSE 后产生的 Moment/评论/点赞，在恢复后自动补齐。
- 重复 reconcile 幂等。
- cursor 损坏时可触发 bounded full refresh。

## 10. Phase 5 - Interaction Visibility

### 目标

达到微信式评论/点赞可见性。

### 当前落地状态

最小 Interaction Visibility 已落地：

- Station domain 新增纯函数服务 `InteractionVisibility`。
- 规则：
  - Moment 作者看该 Moment 下全部互动。
  - 互动作者始终能看自己的互动。
  - Moment 作者自己的评论/点赞对所有可读 viewer 可见。
  - 普通 viewer 只看与自己互相关注 actor 的第三方评论/点赞。
- 评论列表 `ListByPost` 已在 parent Moment 可读性之外追加互动 actor 过滤。
- 点赞摘要 `ReactionService.Aggregate` 已改为基于可见 reaction actors 重新聚合计数，避免隐藏 actor 的点赞数量泄露。
- Moment hydration 返回的 `Post.reactions` 已使用 viewer-scoped 聚合。
- 已补充 domain 单测与 application 集成测试，覆盖作者、共同关系、非共同关系视角。

当前限制：

- 当前关系图使用现有 follow 表的 mutual follow 近似“共同好友”；后续可替换为正式 friend/relationship graph。
- 评论分页使用 bounded overscan 过滤不可见评论；极端情况下可能需要下一阶段改为 SQL-level visible actor set 查询。
- 通知内容过滤尚未接入，因为互动通知 projection 还未落地。

### 任务

1. 定义 `InteractionVisibility` 领域服务。
2. 输入：
   - viewer
   - moment author
   - interaction actor
   - relationship graph
   - audience
3. 评论列表和点赞列表应用二次过滤。
4. 通知内容也遵守互动可见性。
5. 补充单元测试矩阵：
   - 作者视角
   - 评论者视角
   - 共同好友视角
   - 非共同好友视角
   - 拉黑/不给看视角

### 验收

- viewer 能看 Moment，不代表能看所有互动。
- 作者始终能看自己 Moment 下的互动。
- 非共同关系互动不泄漏。

## 11. Phase 6 - 微信级 UI

### 目标

在稳定 projection 上做体验升级。

### 当前落地状态

最小 UI 收敛已落地，方向是“符合 Desktop 既有风格，不增加无功能元素”：

- 移除 Moments 顶部统计面板，避免内容流上方出现与当前阅读任务无关的 dashboard。
- MomentCard 去掉无功能 `More` 按钮，Audience 从彩色 Tag 收敛为轻量 secondary text。
- ReactionBar 收敛为轻量 text action，已有互动只显示必要 icon + count。
- Composer 去掉字符计数、Audience 文案标签和冗余图片按钮文案，保留发布、可见范围、图片选择三个必要动作。
- AudiencePicker 只展示当前完整可用的 PUBLIC / FOLLOWERS / SELF，未完整闭环的 Circle / Group / Custom 不作为禁用项占位。
- 删除未使用的 `MomentsStatsPanel`，避免 UI 元素和代码入口漂移。
- 第二轮继续保持克制：
  - Feed 卡片只展示最多两条已缓存评论预览与一个查看评论入口，不在列表内加入输入框。
  - 图片九宫格收敛为更小的固定内容宽度和更紧凑间距，避免图片主导整张卡片。
  - 发布成功后回到 HOME 并滚动到顶部，让新内容即时可见，不增加 toast 之外的额外提示模块。
- 收尾轮统一列表边界：
  - HOME / Explore / User feed 复用同一套空状态、加载态和加载更多样式。
  - 详情页评论区改为轻量 Card 容器，和 MomentCard 的边框/间距保持一致。
  - 评论列表头像、间距、分页按钮继续降噪，避免详情页显得像表单页。

当前限制：

- 这是 Phase 6 的第一轮“减法式”视觉收敛，不引入新视觉资产、封面、营销式模块。
- 评论原地展开、互动消息、Album 月份分组仍属于后续增量，不在本轮增加入口。

### 任务

1. Moments 首页：
   - 熟人 feed 为主入口。
   - Explore 降级为二级入口。
   - 顶部显示发动态、互动消息、个人入口。
2. MomentCard：
   - 评论原地展开。
   - 点赞/评论同区块展示。
   - 九宫格图片与 lightbox 更接近社交产品。
3. Album：
   - 个人封面。
   - 月份/年份分组。
   - author feed 热缓存。
4. Composer：
   - Audience 选择更像微信分组。
   - 草稿进入 runtime/local store，而不是页面状态。
5. Notification:
   - 朋友圈互动消息列表。
   - 红点与 navigation badge 一致。

### 验收

- 页面切换无明显冷启动感。
- 图片首屏展示不等待每个组件各自 resolve。
- 评论/点赞操作有即时反馈和错误回滚。
- LobeUI 优先，antd 仅作兼容 fallback。

## 12. 风险与治理

| 风险 | 治理 |
|---|---|
| 直接从 high-chat 拷代码导致漂移 | 先合约再实现，按 `peers-social` 当前结构落地 |
| Runtime owner 和现有 store 混写 | 每个字段标注 owner，迁移期只允许一处写主投影 |
| Delivery 写放大 | 先支持小规模熟人场景，后续引入批量 fan-out 和异步 outbox |
| SSE 事件丢失 | 每个事件路径必须配套 reconcile |
| UI 先行导致返工 | Phase 6 前不做大规模视觉重构 |
| 隐私泄漏 | Station 权限最终判定，Desktop runtime 不猜权限 |

## 13. 验证命令

Desktop:

```bash
cd apps/desktop
pnpm run check
pnpm run test
pnpm run build
```

Station:

```bash
cd apps/station
gofmt -l .
go test ./...
```

Proto:

```bash
./model/build.sh
```

End-to-end acceptance:

```bash
./tooling/scripts/dev-desktop-app.sh
./tooling/scripts/dev-desktop-web.sh
```

使用两个独立 profile 登录不同账号，验证发布、接收、评论、点赞、断线恢复、红点。

## 14. 完成定义

本计划完成时应满足：

- 架构文档、平台文档、执行计划同步。
- Moments 页面接入 PageDescriptor。
- Moments 投影由 runtime owner 维护。
- Station delivery / sync / event 路径可验证。
- 页面首屏、切回、互动、断线恢复均有明确验收记录。
- 无 mock API、无手写并行模型、无页面级主路径刷新补丁。
