# Moments —— 朋友圈 / 动态 / 时刻

> Status: Draft, 2026-04-27
>
> Scope: 在现有 `social` subserver 的基础上，扩展出"朋友圈/动态"能力，
> 服务于家庭、小团队等"小封闭半开放"场景，兼顾未来公开/联邦使用。
> v1 的目标是**基础通用能力**——发动态、看动态、点赞、评论、@、转发，
> 加上一套清晰的可见性模型和**隐私/公开物理分离**的存储底座。
>
> 本文档是 architecture-layer source（见 `AGENTS.md §3`），
> 描述边界与约束；具体 proto 字段、表 DDL、handler 路由由实施 PR
> 落地，不在本文锁定。
>
> **Security ownership amendment (2026-09-13)**: private payload encryption,
> key envelopes, opaque object transfer, recovery integration, optional
> authentication, and legacy plaintext removal are governed by the proposed
> [`../../../shared/security/secure-content/`](../../../shared/security/secure-content/README.md) architecture. This document
> continues to own Social audience and Moment semantics; its older media-key and
> private-storage implementation sketches do not override Secure Content.
> Specifically, the key-envelope shape in §4, private plaintext schema in §6,
> authentication wiring in §8, media path in §10, legacy route aliases, and
> phased implementation notes are superseded for this security hard cut.

## 1. 目标与非目标

### 1.1 目标

1. **隐私优先**。一条动态发出时，作者必须**显式选择**它的受众；
   没有"默认公开"。后端的存储与代码路径，从物理上把"公开内容"
   和"隐私内容"分开，避免任何一处 SQL 或代码失误把私密内容
   泄漏出去。
2. **不搞烟囱**。不新增 `moments` subserver，不复制 `chat.Group`
   的成员关系，不另建一套媒体上传/通知/事件总线——所有现成
   能力一律复用，扩展点放在 `social` 内部。
3. **跨端一致由协议保证**。Desktop / Mobile 各自实现 UI，但
   `model/domain/social/*.proto` 是唯一真实来源；
   AudienceSelector、Reaction、Comment 的语义跨端一致来自协议。
4. **为未来联邦留口子**。v1 不实现 ActivityPub 出/入站，但今天
   的存储分层和投递队列结构已经按"未来联邦只能读公开存储"的
   方向预留。

### 1.2 非目标（v1 不做）

- ❌ ActivityPub 出/入站（公开内容会先入 `outbox_public`，但
  v1 不消费它）
- ❌ Story / 24 小时阅后即焚 / 直播 / 语音空间
- ❌ 算法推荐 feed（v1 严格按时间 + 关注/圈子/群关系）
- ❌ 广告、计费、商业化
- ❌ 复杂权限矩阵（角色、标签嵌套、共享相册）
- ❌ 富文本编辑器（用 Markdown 渲染 + 纯文本输入）

## 2. 概念模型

```
Actor ──┬──── posts ────▶ Moment ──┬── Attachments  (oss://...)
        │                          ├── Reactions    (typed)
        │                          ├── Comments     (1 级 reply)
        │                          ├── Mentions     (@actor)
        │                          ├── LinkPreview  (服务端解析+镜像)
        │                          └── Audience  ⭐ 可见性核心
        │
        └──── owns ─────▶ Circle  (发布者私有的人选清单)
                          └── members: Actor[]
```

### 2.1 Moment（动态）

一条动态。**对应现有 `social.proto` 的 `Post`**——本设计扩展该
message，不另起新名。"Moments" 是产品语义，"Post" 是协议语义。

字段层面新增的核心：

- `audience` —— 可见性
- `attachments` —— 取代 `media_urls` 的 typed 数组
- `mentions` —— @用户
- `link_preview` —— 服务端解析 + 镜像到本地 OSS 的预览
- `repost_of_id` —— 把转发关系从隐式（`repost_count`）变显式

### 2.2 Audience（受众）

一条 Moment 的可见范围。Moments 的灵魂概念。

| `Audience.kind` | 语义 | 示例 |
|---|---|---|
| `PUBLIC`        | 全网可见，未来对接 ActivityPub | 一条公开技术随笔 |
| `FOLLOWERS`     | 仅当前 Station 上的关注者可见 | 给关注者的近况 |
| `CIRCLE`        | 仅指定 Circle 成员可见 | "家人"圈 |
| `GROUP`         | 仅指定 chat.Group 成员可见 | "项目组 A" |
| `SELF`          | 仅自己可见 | 草稿、私密日记 |
| `CUSTOM_ALLOW`  | 显式允许的 actor 列表 | 临时分享给 3 个人 |
| `CUSTOM_DENY`   | 在公开/关注者中**排除**特定人 | "不给老板看" |

**v1 不可变约束**：`audience` 一旦写入**不可变更**。要换可见性 =
删了重发。这条让"分离存储"在实现上极其干净（无跨表搬移）。

### 2.3 Circle（圈子）

> 这是和 `chat.Group` **不同的概念**，最容易混淆。

| | **Circle**（发布者圈子） | **chat.Group**（聊天群） |
|---|---|---|
| 本质 | 发布者的**私有标签**——"我心里的一组人" | **共享空间**——成员互相能看到彼此 |
| 谁能看成员名单 | **只有圈主自己** | 群里所有成员 |
| 主要用途 | 选择性发动态 | 聊天 + 顺便发动态 |
| 是否双向 | 单向：成员不知道自己被划进哪个圈 | 双向：成员之间互通有无 |
| 对应微信 | "朋友圈分组" | 微信群 |

`Audience.kind = CIRCLE` 引用 Circle id，`= GROUP` 直接复用
`chat.Group` 的成员关系，**不再做一份**。

### 2.4 Comment / Reaction

- **Comment**：一级 reply，`parent_comment_id` 至多一层。UI 上
  扁平展示带 `@回复某条评论` 的引用块，**不渲染嵌套树**。
- **Reaction**：typed (`LIKE / LOVE / LAUGH / WOW / CELEBRATE`)，
  现有的 `LikePost / UnlikePost` 接口扩展为带 `kind` 的
  `ReactToPost`。UI 默认折叠为单个 Like 按钮，长按/右键展开类型。

## 3. 复用矩阵（不搞烟囱的体现）

| 能力 | 已有资产 | Moments 的复用方式 |
|------|----------|--------------------|
| Post / Like / Repost / Comment / Follow 基础 | `model/domain/social/social.proto` | **扩展该 proto，不新建 moments.proto** |
| Timeline 服务 + cursor 分页 | `app/subserver/social/application/timeline_service.go` | 在其上加可见性过滤 + Circle/Group 维度 |
| DDD 分层骨架 | `app/subserver/social/{application,domain,infrastructure}/` | 在同一 subserver 内增加 audience / circle 子域 |
| 群成员关系 | `chat.Group` + `chat/group_chat.proto` | `Audience.kind=GROUP` 直接引用 group_id |
| 媒体上传 / `cid` URI | `peers-oss` + `chat_upload_attachment` | 附件用 `cid`（与 chat 完全一致） |
| 跨 subserver 通知 | `notification.Bridge` + `POST_LIKED/POST_COMMENTED/POST_REPOSTED` 已存在 | 直接发布，新增 `POST_MENTIONED / COMMENT_REPLIED` |
| 异步 fan-out 模式 | `friend_chat / group_chat` 的 outbox tick | 复用同一模式（`outbox_relay`） |
| 实时新动态推到在线客户端 | `events` subserver + `event.broker`（SSE/WebSocket） | 发 `MomentCreated` 域事件 |
| HTTP 路由 / 鉴权 | `server.NewTypedHandler` + `RequireJWT` + `CommonAccessControlWrapper(RouteNameSocial)` | 完全复用 |
| Desktop UI 组件 | `UserSquareAvatar / Markdown / AttachmentItem / theme.useToken()` | 直接拼装 `MomentCard` |
| Desktop 模块注册 | `apps/desktop/src/modules/registry.ts` | Moments 用 `registerModule` 接入，非 `CORE_PAGES` 一等公民（除非顶级 Tab） |
| i18n | `packages/locales` + `useTranslation('xxx')` | 新增 `'moments'` 命名空间 |

## 4. Proto 扩展（Iron Law: Proto-First）

> 字段编号、最终命名以实施 PR 为准。本节给出**形状**与**编号区间**，
> 防止与现有字段冲突。

### 4.1 在 `model/domain/social/social.proto` 内扩展

**新增的 message：**

- `Audience` —— `kind` 枚举 + `target_id` + `actor_dids`
- `Attachment` —— `kind / cid / thumbnail_cid / mime_type / size_bytes / width / height / duration_ms`
- `Mention` —— `actor_did / offset / length`
- `LinkPreview` —— `url / title / description / image_cid`
- `ReactionSummary` —— 列表每种 kind 的 count + 是否 me

**`Post` 新增字段（编号 ≥ 12，沿用现有）：**

| 字段 | 类型 | 备注 |
|---|---|---|
| `audience` | `Audience` | 必填，创建后不可变 |
| `attachments` | `repeated Attachment` | 取代 `media_urls`（保留 `media_urls` 一段时间作 read-side 兼容字段） |
| `mentions` | `repeated Mention` | |
| `link_preview` | `LinkPreview` | 服务端写回，客户端只读 |
| `repost_of_id` | `string` | 形如 `oss://{station}/post/{id}` 跨站 ready；同站可写裸 id |
| `reactions` | `repeated ReactionSummary` | 计算字段，`liked_by_me / like_count` 进入 deprecated 路径 |

**`Comment` 新增：**

- `parent_comment_id`（`uint64`，最多一层）
- `mentions`（`repeated Mention`）

**新增 RPC（接口形状，路由由 handler 决定）：**

- `CreateMoment / DeleteMoment / GetMoment`（语义同 `CreatePost / DeletePost / GetPost`，
  扩展 `audience`；旧接口保留为 thin wrapper 以避免老客户端立即破坏）
- `ReactToPost(post_id, kind)` / `UnreactToPost(post_id, kind)`
- `ListReactions(post_id, kind?, cursor)`
- `ListComments(post_id, cursor)`（替代 `GetPostComments`，改为 cursor 分页）

### 4.2 新增 `model/domain/social/circle.proto`

```
package peers_touch.model.social.v1;

message Circle {
  uint64 id = 1;
  string owner_did = 2;
  string name = 3;
  string emoji = 4;
  int32  member_count = 5;
  google.protobuf.Timestamp created_at = 6;
}

message CircleMember {
  uint64 circle_id = 1;
  string actor_did = 2;
  google.protobuf.Timestamp added_at = 3;
}

// RPC: CreateCircle / RenameCircle / DeleteCircle
//      AddCircleMember / RemoveCircleMember
//      ListMyCircles / ListCircleMembers
```

`circle` 是 social 的子域，**不**单独建 proto 目录。

## 5. Station 端目录结构

在现有 `apps/station/app/subserver/social/` **内增量**：

```
apps/station/app/subserver/social/
├── subserver.go               (existing — 注册 wrappers / repos)
├── handler.go                 (existing — 增加 moments / circle / reaction 路由)
├── application/
│   ├── timeline_service.go    (existing — 改：加 audience filter + 多源合并)
│   ├── post_service.go        (existing — 改：审核 audience 合法性 + 路由到正确 repo)
│   ├── moment_service.go      ⭐ NEW：写入路径的对外门面（薄壳）
│   ├── circle_service.go      ⭐ NEW
│   ├── reaction_service.go    ⭐ NEW（升级 like → typed reaction）
│   ├── comment_service.go     ⭐ NEW（cursor + threaded 1-level）
│   └── outbox_dispatcher.go   ⭐ NEW：私密走 Relay；公开入 outbox_public 待消费
├── domain/
│   ├── post.go                (existing)
│   ├── audience.go            ⭐ NEW：可见性决策的"唯一真理"
│   ├── circle.go              ⭐ NEW
│   ├── reaction.go
│   ├── comment.go
│   ├── events.go              ⭐ MomentCreated/Reacted/Commented/Deleted 域事件
│   └── repository.go          ⭐ 仓库接口集中处（按可见性分接口，见 §6）
└── infrastructure/
    ├── post_repo_public.go    ⭐ NEW：仅访问 social_public schema
    ├── post_repo_private.go   ⭐ NEW：仅访问 social_private schema
    ├── circle_repo.go         ⭐ NEW
    ├── reaction_repo.go
    ├── comment_repo.go
    ├── outbox_repo.go
    └── relay_gateway.go       ⭐ 私密 fan-out 经由 Relay
```

## 6. 隐私 / 公开内容的物理分离存储

**这是本设计最重要的架构决策**。

### 6.1 决策动机

1. **爆炸半径隔离**：公开 timeline 查询哪怕 SQL 写错，也物理上读不到私密表。
2. **备份策略不同**：公开数据可镜像、可快照；私密数据严格加密备份、有明确擦除路径。
3. **未来联邦绝对清晰**：未来 ActivityPub 出站代码路径**只允许**访问公开存储；
   架构上杜绝"Bug 把私密帖泄漏到 federation outbox"。
4. **审计/合规清晰**：导出/删除请求时，私密内容的范围非常明确。

### 6.2 物理布局：单实例 PostgreSQL，三个 schema

```
PostgreSQL（单实例，单备份，单运维）
│
├── schema: social_public
│   ├── posts                     ── audience.kind = PUBLIC
│   ├── attachments_ref           ── (post_id, cid, ...)
│   ├── reactions
│   ├── comments
│   ├── reposts
│   └── outbox_public             ── 未来 AP 投递队列（v1 写入，不消费）
│
├── schema: social_private
│   ├── posts                     ── audience.kind ∈ {FOLLOWERS, CIRCLE, GROUP, SELF, CUSTOM_*}
│   ├── attachments_ref
│   ├── reactions
│   ├── comments
│   ├── reposts
│   ├── audience_targets          ── (post_id, kind, target_id) for CIRCLE/GROUP
│   ├── audience_actor_grants     ── CUSTOM_ALLOW/DENY 的 actor_did 列表
│   ├── circles                   ── Circle 元数据
│   ├── circle_members            ── 成员（圈子人员名单也算隐私元数据）
│   └── outbox_relay              ── 私密 Relay 投递队列
│
└── （social_shared 暂不引入 —— circle / circle_members 放 social_private 更保守一致）
```

### 6.3 仓库接口按可见性分接口（编译期防越界）

仓库接口在 `domain/repository.go` 集中定义；**接口签名上就强制可见性边界**：

```go
package domain

// PublicPostRepository —— 仅触达 social_public schema
type PublicPostRepository interface {
    Create(ctx context.Context, p *Post) error
        // 实现首行：if !p.Audience.IsPublic() { panic("public repo only accepts PUBLIC posts") }
    GetByID(ctx context.Context, id uint64) (*Post, error)
        // 公开就是公开，无需 viewer 参数
    ListPublic(ctx context.Context, cursor *Cursor, limit int) ([]*Post, error)
    ListByAuthor(ctx context.Context, authorID uint64, cursor *Cursor, limit int) ([]*Post, error)
}

// PrivatePostRepository —— 仅触达 social_private schema
type PrivatePostRepository interface {
    Create(ctx context.Context, p *Post) error
        // 实现首行：if p.Audience.IsPublic() { panic("private repo rejects PUBLIC posts") }

    // ⭐ 必带 viewerID —— 签名上就杜绝"忘了做权限检查"这类 bug
    GetByID(ctx context.Context, id, viewerID uint64) (*Post, error)
    ListByFollowing(ctx context.Context, viewerID uint64, cursor *Cursor, limit int) ([]*Post, error)
    ListByCircle(ctx context.Context, circleID, viewerID uint64, cursor *Cursor, limit int) ([]*Post, error)
    ListByGroup(ctx context.Context, groupID, viewerID uint64, cursor *Cursor, limit int) ([]*Post, error)
    ListByAuthorVisibleTo(ctx context.Context, authorID, viewerID uint64, cursor *Cursor, limit int) ([]*Post, error)
}
```

应用服务（`MomentService.Create`）按 `audience.kind` 分发：

```go
if post.Audience.Kind == domain.AudiencePublic {
    s.publicRepo.Create(ctx, post)
    s.publicOutbox.Enqueue(ctx, post.ID)   // 给未来 AP
} else {
    s.privateRepo.Create(ctx, post)
    s.relayOutbox.Enqueue(ctx, post.ID)    // 给 Relay
}
```

**绝不存在"先写到一个表再判断"的代码**——分发在最早的应用入口。

### 6.4 Timeline 读取的合并

合并是**显式的**，不是 SQL `UNION`——这正是分离存储的价值：
你永远清楚每一条返回结果"来自哪个库"。

```go
// HOME timeline
publicPosts,  _ := s.publicRepo.ListPublicForFollowing(ctx, viewerID, cursor, limit)
privatePosts, _ := s.privateRepo.ListByFollowing(ctx, viewerID, cursor, limit)
circlePosts,  _ := s.privateRepo.ListVisibleByMyCircles(ctx, viewerID, cursor, limit)
groupPosts,   _ := s.privateRepo.ListVisibleByMyGroups(ctx, viewerID, cursor, limit)

merged := mergeByCreatedAtDesc(publicPosts, privatePosts, circlePosts, groupPosts, limit)
```

游标 `cursor` 编码"四源各自的 offset/last_id"，让分页仍然单调。

## 7. 数据流

### 7.1 写入路径（创作 Moment）

```
Client ──Tauri invoke──▶ Rust ──HTTP/proto──▶ Station: POST /social/moments
                                                │
                                                ▼
                            handler.handleCreateMoment
                                                │  JWT ✓ + CommonAccessControlWrapper(RouteNameSocial)
                                                ▼
                            application.MomentService.Create
                                ├─ audience.ValidateForAuthor(viewer, audience)
                                │     · CIRCLE：圈必须本人持有
                                │     · GROUP：作者必须群成员
                                │     · CUSTOM_ALLOW/DENY：actor_dids 解析
                                ├─ resolveLinkPreview（异步标记，不阻塞返回）
                                ├─ 路由到 publicRepo.Create / privateRepo.Create   (TX)
                                ├─ 路由到 publicOutbox / relayOutbox.Enqueue       (TX)
                                └─ events.Publish(MomentCreated{IsPublic, AuthorID, ...})
                                                │
                                                ▼
            ┌──────────────────────────────┬───────────────────────────┐
            ▼                              ▼                           ▼
    events.broker (SSE)         outbox_dispatcher (2s tick)        notification.Bridge
    推给在线 followers          - PUBLIC：暂存 outbox_public        - 给 @mentioned 发通知
                                  （v1 不消费）                      - 给作者 followers 选择性发
                                - 其它：Relay 投递

```

### 7.2 读取路径（拉 Timeline）

```
GET /social/timeline?type=HOME&cursor=...
   │
   ▼
TimelineService.GetTimeline
   ├─ HOME    : 公开 + 私密 + Circle + Group（见 §6.4）
   ├─ USER    : publicRepo.ListByAuthor ∪ privateRepo.ListByAuthorVisibleTo
   ├─ PUBLIC  : publicRepo.ListPublic
   ├─ CIRCLE  : privateRepo.ListByCircle(circle_id, viewer)
   └─ GROUP   : privateRepo.ListByGroup(group_id, viewer)
   ▼
audience.FilterReadable(viewer, posts)   ── 第二道防线（防御性，应当 no-op）
   ▼
Hydrate(attachments + reactions(grouped) + comment_count + link_preview)
```

### 7.3 入站联邦（v1 不实现，仅占位）

入站 ActivityPub 处理器在 v1 之后引入，路径示意：
`POST /inbox` → 验证签名 → `IngestRemoteCreate(activity)` →
解析 `to/cc/bto/bcc` 派生 audience → 镜像媒体到本地 OSS →
**仅写入** `social_public` 或 "联邦私密镜像" schema（待设计）。
**入站永远不允许直接写入** `social_private`——确保私密 schema 的
作者必须是本站用户。

## 8. 鉴权与可见性（防御深度）

三道防线，缺一不可：

| 防线 | 位置 | 形式 |
|---|---|---|
| ① 创作时校验 | `application.MomentService.Create` | `audience.ValidateForAuthor` 拒绝非法受众 |
| ② SQL 层过滤 | `infrastructure.post_repo_private.go` | `WHERE` 条件由仓库构造，调用方无法绕过 |
| ③ 应用层兜底 | `domain.audience.FilterReadable(viewer, posts)` | 返回前再过一遍——正常情况下应是 no-op |

`domain.audience.go::CanRead(viewer, post) (bool, reason)` 是
**唯一**的可见性决策函数；任何 `if post.Audience.Kind == ...` 散布
在其他文件的代码 review 时一律拒绝。

## 9. 通知集成

直接复用 `notification.Bridge`。已有事件类型够用：
`POST_LIKED / POST_COMMENTED / POST_REPOSTED`。**新增**：

- `POST_MENTIONED`
- `COMMENT_REPLIED`

通知**继承 Post 可见性**——你不会因为别人的私密帖被 like 而收到
通知，除非你本来就在该帖的可见受众里。

## 10. 媒体

- 上传走 OSS 既有 `chat_upload_attachment` 通道，返回 `cid =
  oss://{origin}/{key}`。
- `Post.attachments[].cid` 存 `cid` 字符串；**不存第三方 URL**。
- 入站联邦在 v1 之后引入时，远端 URL **必须**镜像到本地 OSS 后
  rewrite 为本地 `cid`——避免追踪 + 防失效（详见 `oss/file-storage.md`
  的 federation 章节）。
- LinkPreview 的 `image_cid` 同理：服务端抓取后**镜像到本地 OSS**，
  不让客户端直接对外发请求。

## 11. Desktop 前端结构

> 详细组件契约由前端 PR 落地；此处只锁定**结构**和**复用边界**。

```
apps/desktop/src/
├── pages/moments/
│   ├── MomentsFeedPage.tsx         (Home: 多源合并)
│   ├── MomentsExplorePage.tsx      (Public)
│   ├── MomentsCirclePage.tsx
│   ├── MomentsUserPage.tsx
│   ├── MomentDetailPage.tsx
│   └── CircleManagePage.tsx
├── components/moments/
│   ├── MomentCard.tsx              ── 单条卡片
│   ├── MomentComposer.tsx          ── 发新动态（drawer/modal）
│   ├── MediaGrid.tsx               ⭐ 1/2/3/4/9 图自适应
│   ├── AudienceSelector.tsx        ⭐ 唯一统一入口（见下）
│   ├── ReactionBar.tsx             ── 默认折叠的 typed reactions
│   ├── CommentThread.tsx           ── 1 级 reply 扁平展示
│   ├── MentionInput.tsx
│   └── LinkPreviewCard.tsx
├── store/moments.ts                ── Zustand: feeds[] / postsById / comments / reactions / circles
└── modules/moments/index.ts        ── registerModule({ id: 'moments', page, sidebarEntry })
```

`AudienceSelector` 在前端给用户**统一体验**（虽然后端是 Circle/Group
两个对象）：

```
┌─ 谁可以看？─────────────────┐
│ ⚪ 公开                      │
│ ⚪ 仅关注者                   │
│ ─────我的圈子─────            │
│ ⚪ 家人 (3)                  │
│ ⚪ 老同学 (12)                │
│ ─────我的群组─────            │
│ ⚪ 项目组 A (5)               │
│ ⚪ 家庭群 (4)                │
│ ─────自定义─────              │
│ ⚪ 仅自己                     │
│ ⚪ 不给某些人看…              │
└──────────────────────────────┘
```

群组列表**直接读** `useSocialChatStore` 暴露的 groups——不另起
独立 group endpoint。

UI 层一律使用 LobeUI（`Markdown / TextArea / EmojiPicker / Button /
ActionIcon`）+ antd `theme.useToken()` + `react-layout-kit
Flexbox`，与 chat 视觉完全一致。

## 12. 不变约束（Invariants）

> 这些约束写成 Go 单测 + DB CHECK 约束 + handler 层断言。

1. **`social_public` schema 的所有写入**必须满足 `audience.kind == PUBLIC`。
2. **`social_private` schema 的所有写入**必须满足 `audience.kind != PUBLIC`。
3. **`audience.kind` 创建后不可变**（v1）；要换 = 删了重发。
4. **`outbox_public` 的来源**有且仅有 `social_public.posts`。
5. **`outbox_relay` 的来源**有且仅有 `social_private.posts`。
6. **可见性决策**只能调用 `domain.audience.CanRead`；其它处直接读
   `post.Audience.Kind` 做分支的代码不允许进 main。
7. **媒体引用**只能是 `oss://...` 形式的 `cid`；不允许第三方 URL
   直接持久化。
8. **转发不允许放大可见性**：转发 PUBLIC 帖可任选受众；转发
   非 PUBLIC 帖时，目标受众**不能比源帖更宽**（服务端硬拒绝）。
9. **Comment / Reaction 的可见性继承自父 Post**——不存在父 Post
   不可见但其评论可见的状态。
10. **联邦入站（v1 之后）**永远不允许直接写入 `social_private`。

## 13. 落地路线（建议分 4 个 PR）

| Phase | 内容 | 验收 |
|-------|------|------|
| **P0 — Proto & Domain Skeleton** | 扩展 `social.proto`（Audience / Attachment / Mention / LinkPreview / Reaction.kind / parent_comment_id），新建 `circle.proto`，跑 `./model/build.sh`。新建 `domain/audience.go`、`domain/circle.go`，单测覆盖 `CanRead` 全分支。 | proto 通过 + audience 单测 100% 分支覆盖 |
| **P1 — Station Backend** | 建 `social_public / social_private` schema 与 `AutoMigrate`；`PublicPostRepository / PrivatePostRepository` 按可见性分接口实现；`MomentService / CircleService / ReactionService / CommentService`；`outbox_dispatcher` 双通道；handler 加路由。 | `cd apps/station && go test ./...` 通过；本地两 actor 自测：4 种 audience 创建 + 跨 actor 可见性正确 |
| **P2 — Desktop Frontend** | `pages/moments/*` + `components/moments/*` + `store/moments.ts` + `modules/moments`。`AudienceSelector` 与 chat groups store 打通。i18n 命名空间 `'moments'`。 | `pnpm run check && pnpm run test && pnpm run build` 通过；E2E：能创建 4 种 audience 帖子并正确显示在合适 feed |
| **P3 — Notifications & Polishing** | `POST_MENTIONED / COMMENT_REPLIED` 接入 `notification.Bridge`；`LinkPreview` 服务端抓取 + 镜像 OSS；性能调优（multi-source cursor merge）。 | 跨 actor mention 出现在 NotificationBell；HOME timeline 多源合并稳定有序 |

每个 Phase 一个 PR，遵循 `pt-github-pr` skill。所有 commit 走
`pt-github-commit` skill。

## 14. Open work / 后续扩展

- **ActivityPub 出/入站**：`outbox_public` 已存在；新增 dispatcher
  消费它，`POST /inbox` 验签 + 入站映射；私密内容**永远不进** AP。
- **Story / 临时动态**：增加 `Post.expires_at`；schema 增加
  `social_private.posts_ttl` partial index；定时清理。
- **算法/兴趣 feed**：在 `TimelineService.GetTimeline` 增加
  `type=DISCOVER` 分支，依赖单独的 ranking 子服务。
- **共享相册 / 多人维护**：Circle/Group 内多人协作的 album 概念；
  需要一个新的 aggregate（不要塞进 Post）。
- **审计/操作日志**：dashboard 视角下的"我的动态历史"——参考
  `oss_audit` 的 append-only 设计。
- **跨 station 私密分享**（联邦私密内容）：方案分歧大（端到端
  加密 vs 信任目标 station），单开 ADR 讨论。
- **媒体 GC**：动态删除时附件何时回收？参考 `oss/file-storage.md`
  的 LRU 思路，触发点放在 `MomentDeleted` 域事件。
