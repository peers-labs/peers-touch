# ActivityPub 路由与接口差异记录

## 目标
- 明确本项目在 `activitypub` 分组下的标准联邦端点与为前端提供的便利端点差异，确保兼容 ActivityPub，同时满足应用接口需求。

## 标准端点（联邦互通，已实现）
- `GET /activitypub/:actor/actor`：Actor 文档（含 `inbox/outbox/followers/following/liked/publicKey/endpoints.sharedInbox`）
- `GET /activitypub/:actor/inbox`、`POST /activitypub/:actor/inbox`：服务器间收件箱（S2S）
- `GET /activitypub/:actor/outbox`、`POST /activitypub/:actor/outbox`：客户端到服务器（C2S）发布端点
- `GET /activitypub/:actor/followers`：Followers 集合
- `GET /activitypub/:actor/following`：Following 集合
- `GET /activitypub/:actor/liked`：Liked 集合
- `GET /activitypub/inbox`、`POST /activitypub/inbox`：Shared Inbox（规范推荐的可选优化）

说明：标准端点的路径形态由实例定义，但必须与 Actor 文档中的 IRI 一致，并遵循 ActivityPub 对收发与内容类型的要求。

## 便利端点（应用层接口，底层仍走标准联邦链路）
- `POST /activitypub/:actor/follow`：根据请求体生成 `Follow` 活动，发布到本地 outbox 并联邦投递到对方 inbox。
- `POST /activitypub/:actor/unfollow`：根据请求体生成 `Undo(Follow)` 活动（对象为原 `Follow`），发布到 outbox 并联邦投递。

说明：上述接口并非 ActivityPub 标准定义，参考 Mastodon 的客户端 API 设计，用于提升前端开发效率。联邦交互依然通过标准 outbox/inbox 完成，保证兼容性。

## 受众与投递策略
- 缺省受众映射（与 Mastodon 对齐）：
  - `public/unlisted`：`to = PublicNS`，`cc = {baseURL/{actor}/followers}`
  - `private`：`to = {baseURL/{actor}/followers}`
  - `direct`：需明确收件人（通常解析 @mention）；默认不设置 `to/cc`。
- Followers 集合展开：分发阶段遇到 `{baseURL/{actor}/followers}`，查询本地 `ActivityPubFollow` 关系，展开为每个关注者的 Actor IRI 并逐一投递。
- Shared Inbox 优先：对目标 Actor 解析其文档，优先使用 `endpoints.sharedInbox`，否则使用个人 `inbox`。
- 公共标识：`PublicNS` 仅表示公开，不是实际可投递目标；分发时跳过该 IRI。

## 安全
- 发送端设置 `Accept/Content-Type/Date/Digest/Host/Signature`，签名头覆盖 `(request-target) host date digest`，RSA-SHA256；接收端验证 HTTP Signature 与 Digest。

## 兼容性声明
- 我们不会引入或修改 ActivityPub 标准端点的语义；所有便利端点仅作为应用层入口，最终转换为标准活动并通过 outbox/inbox 完成联邦交互。

## 变更理由（为何新增便利端点）
- 降低前端集成复杂度：提供批量关系查询与统一搜索入口，避免前端直接拼装 ActivityPub 活动。
- 保持与生态实践一致：参考 Mastodon 的 API 经验，满足常见的产品需求（搜索、关系、关注操作）。

## 接口对齐一览（表格）

| 接口 | 功能描述 | 是否标准activitypub | 是否兼容mastodon | 兼容性声明 | 差异性缘由 |
| --- | --- | --- | --- | --- | --- |
| GET /activitypub/:actor/actor | 返回 Actor 文档 | 是 | 是 | 路径由本域定义，Actor 文档中的 IRI 指向本端点；Mastodon 可解析 | W3C ActivityPub Recommendation（Actor）要求 |
| GET /activitypub/:actor/inbox | 查看收件箱集合 | 是 | 是 | 收件箱集合用于分页读取；S2S 收件链路兼容 | W3C ActivityPub（Inbox 集合）要求 |
| POST /activitypub/:actor/inbox | 接收远端活动 | 是 | 是 | 验证 HTTP Signature 与 Digest；按类型处理（Follow/Accept/Undo/Create 等） | W3C ActivityPub S2S 投递；HTTP Signatures（Fediverse 事实标准） |
| GET /activitypub/:actor/outbox | 查看发件箱集合 | 是 | 是 | OrderedCollection/分页；与 Actor 文档一致 | W3C ActivityPub C2S（Outbox 集合）要求 |
| POST /activitypub/:actor/outbox | 发布活动（C2S） | 是 | 是 | 客户端向 outbox 提交 Create/Follow/Undo 等；再联邦投递 | W3C ActivityPub C2S 发布模型 |
| GET /activitypub/:actor/followers | Followers 集合 | 是 | 是 | 集合 IRI 与 Actor 文档一致；分页返回关注者 IRI | W3C ActivityPub（Followers 集合）要求 |
| GET /activitypub/:actor/following | Following 集合 | 是 | 是 | 集合 IRI 与 Actor 文档一致；分页返回被关注 IRI | W3C ActivityPub（Following 集合）要求 |
| GET /activitypub/:actor/liked | Liked 集合 | 是 | 是 | 集合 IRI 与 Actor 文档一致 | W3C ActivityStreams（Liked 集合）实践 |
| GET /activitypub/inbox | Shared Inbox 列表 | 是（可选） | 是 | 规范推荐的共享收件箱；用于公共/粉丝帖子聚合接收 | W3C ActivityPub §7.1.3 Shared Inbox Delivery：降低 fan-out 负载 |
| POST /activitypub/inbox | 接收至 Shared Inbox | 是（可选） | 是 | 验签入库；实例内部 fan-out | 同上；Mastodon/Pleroma/GoToSocial 广泛实现 |
| POST /activitypub/:actor/follow | 关注（便利端点） | 否 | 否（路径不兼容） | 后端生成 `Follow` 并通过标准 outbox→inbox 投递；不影响联邦 | 提供 REST 糖接口；等价于 C2S 向 outbox 提交 Follow 活动 |
| POST /activitypub/:actor/unfollow | 取消关注（便利端点） | 否 | 否（路径不兼容） | 后端生成 `Undo(Follow)` 并标准联邦投递；关系行置为未关注 | 提供 REST 糖接口；等价于 C2S 向 outbox 提交 Undo(Follow) |
| POST /activitypub/:actor/like | 点赞（便利端点） | 否 | 否（路径不兼容） | 生成 `Like` 并标准联邦投递 | 前端易用；底层是 ActivityStreams Like 活动 |
| POST /activitypub/:actor/undo | 撤销（便利端点） | 否 | 否（路径不兼容） | 生成 `Undo`（对象为原活动）并标准联邦投递 | 前端易用；对应 ActivityStreams Undo 活动 |
| GET /activitypub/nodeinfo/2.1 | NodeInfo 2.1 | 否（非 AP） | 是（生态通用） | 遵循 NodeInfo 2.1 文档；供聚合/发现使用 | NodeInfo 规范（diaspora 社区）；被 Mastodon/GoToSocial 聚合器消费 |

### Well-Known（/.well-known）

| 接口 | 功能描述 | 是否标准activitypub | 是否兼容mastodon | 兼容性声明 | 差异性缘由 |
| --- | --- | --- | --- | --- | --- |
| GET /.well-known/webfinger | 解析 acct/URL，返回 JRD 自发现信息 | 否（WebFinger 标准） | 是 | Fediverse 通用入口；结果包含 `self` 指向 Actor | RFC 7033 WebFinger；Mastodon/Pleroma/GoToSocial 必需 |
| GET /.well-known/host-meta | 返回 lrdd 指向 WebFinger 的 XML | 否 | 是 | 指向 WebFinger 模板，不影响 AP | OASIS XRD；部分客户端通过 host-meta 引导 WebFinger |
| GET /.well-known/nodeinfo | 返回 NodeInfo 链接（2.1） | 否 | 是 | 指向 `/nodeinfo/2.1`，生态约定 | NodeInfo 发现约定；被目录站与监控采集 |

### Mastodon 兼容接口（应用层）

| 接口 | 功能描述 | 是否标准activitypub | 是否兼容mastodon | 兼容性声明 | 差异性缘由 |
| --- | --- | --- | --- | --- | --- |
| POST /api/v1/apps | 注册应用 | 否 | 是 | 仅用于 Mastodon 客户端接入；不影响联邦 | Mastodon REST API：应用注册（OAuth 客户端） |
| GET /api/v1/accounts/verify_credentials | 校验登录凭据 | 否 | 是 | 账户校验与凭据转换；不影响联邦 | Mastodon REST API：账户凭据校验 |
| POST /api/v1/statuses | 创建状态（映射 Create Note） | 否 | 是 | 服务层生成 AP 活动并走 outbox 联邦投递 | Mastodon REST API：发帖；映射 ActivityStreams Note/Create |
| GET /api/v1/statuses/:id | 查询状态 | 否 | 是 | 从对象存储读取并返回 | Mastodon REST API：获取状态详情 |
| POST /api/v1/statuses/:id/favourite | 点赞（Like） | 否 | 是 | 生成 Like 活动并联邦投递 | Mastodon REST API：favourite；映射 ActivityStreams Like |
| POST /api/v1/statuses/:id/unfavourite | 取消点赞（Undo Like） | 否 | 是 | 生成 Undo 活动并联邦投递 | Mastodon REST API：unfavourite；映射 Undo Like |
| POST /api/v1/statuses/:id/reblog | 转载（Announce） | 否 | 是 | 生成 Announce 并联邦投递 | Mastodon REST API：reblog；映射 Announce |
| POST /api/v1/statuses/:id/unreblog | 取消转载（Undo Announce） | 否 | 是 | 生成 Undo 并联邦投递 | Mastodon REST API：unreblog；映射 Undo Announce |
| GET /api/v1/timelines/home | 首页时间线 | 否 | 部分 | 依赖本地 inbox/outbox 汇总；联邦不受影响 | Mastodon REST API：home timeline；由关系+收件箱构建 |
| GET /api/v1/timelines/public | 公共时间线 | 否 | 部分 | 依赖 IsPublic 标志与活动集合 | Mastodon REST API：public timeline；由 IsPublic 标志与集合构建 |
| GET /api/v1/instance | 实例信息 | 否 | 是 | 提供实例元信息（兼容版本号） | Mastodon REST API：instance 元数据（兼容客户端） |
| GET /api/v1/directory | 账户目录 | 否 | 是 | 本地用户枚举；不影响联邦 | Mastodon REST API：directory（账户发现） |

## Actor 端点（应用层）

- `GET /actor/profile`：读取当前登录用户的扩展资料（适配 Peers Touch 视图）。
- `POST /actor/profile`：更新当前登录用户的资料。支持字段：`profile_photo`、`gender`、`region`、`email`、`whats_up`。

说明：上述接口由服务层适配器提供多视图映射，底层统一数据模型，面向 Peers Touch、ActivityPub 与 Mastodon 兼容查询。

### Peer/Registry（节点与链路）

| 接口 | 功能描述 | 是否标准activitypub | 是否兼容mastodon | 兼容性声明 | 差异性缘由 |
| --- | --- | --- | --- | --- | --- |
| POST /peer/set-addr | 设置本地对等地址 | 否 | 否 | 内部网络管理；与 AP 无关 | Peers Touch 网络框架（libp2p 等）配置 |
| GET /peer/get-my-peer-info | 获取本地对等信息 | 否 | 否 | 内部网络管理；与 AP 无关 | 网络状态查询（节点标识/地址） |
| POST /peer/touch-hi-to | 与远端建立链路/握手 | 否 | 否 | 内部网络管理；与 AP 无关 | 链路拨号/握手；非社交协议需求 |
| GET /nodes | 列举注册节点 | 否 | 否 | 内部注册表；与 AP 无关 | Station 节点注册/监控 |
| GET /nodes/:id | 查询节点详情 | 否 | 否 | 内部注册表；与 AP 无关 | Station 节点详情查询 |
| POST /nodes | 注册节点 | 否 | 否 | 内部注册表；与 AP 无关 | Station 节点上报注册 |
| DELETE /nodes/:id | 注销节点 | 否 | 否 | 内部注册表；与 AP 无关 | Station 节点注销 |

### Message（会话/消息）

| 接口 | 功能描述 | 是否标准activitypub | 是否兼容mastodon | 兼容性声明 | 差异性缘由 |
| --- | --- | --- | --- | --- | --- |
| POST /conv | 创建会话 | 否 | 否 | 内部消息模型；与 AP 无关 | Peers Touch 消息子系统（站内会话） |
| GET /conv/:id | 查询会话 | 否 | 否 | 内部消息模型；与 AP 无关 | 会话读取接口 |
| GET /conv/:id/state | 会话状态（epoch） | 否 | 否 | 内部消息模型；与 AP 无关 | 会话版本/快照用途 |
| POST /conv/:id/members | 更新成员 | 否 | 否 | 内部消息模型；与 AP 无关 | 会话成员管理 |
| GET /conv/:id/members | 成员列表 | 否 | 否 | 内部消息模型；与 AP 无关 | 会话成员查询 |
| POST /conv/:id/key-rotate | 会话密钥轮换 | 否 | 否 | 内部消息模型；与 AP 无关 | 端到端安全与密钥治理 |
| POST /conv/:id/msg | 追加消息 | 否 | 否 | 内部消息模型；与 AP 无关 | 会话消息写入 |
| GET /conv/:id/msg | 列举消息 | 否 | 否 | 内部消息模型；与 AP 无关 | 会话消息读取 |
| GET /conv/:id/stream | 消息流 | 否 | 否 | 内部消息模型；与 AP 无关 | 拉流/长连接通道 |
| POST /conv/:id/receipt | 上报回执 | 否 | 否 | 内部消息模型；与 AP 无关 | 送达/已读回执 |
| GET /conv/:id/receipts | 获取回执 | 否 | 否 | 内部消息模型；与 AP 无关 | 回执查询 |
| POST /conv/:id/attach | 上传附件元数据 | 否 | 否 | 内部消息模型；与 AP 无关 | 附件索引与校验 |
| GET /attach/:cid | 获取附件元数据 | 否 | 否 | 内部消息模型；与 AP 无关 | 附件检索 |
| GET /conv/:id/search | 搜索消息 | 否 | 否 | 内部消息模型；与 AP 无关 | 站内搜索 |
| GET /conv/:id/snapshot | 获取快照 | 否 | 否 | 内部消息模型；与 AP 无关 | 历史快照读取 |
| POST /conv/:id/snapshot | 生成快照 | 否 | 否 | 内部消息模型；与 AP 无关 | 历史快照生成 |

### Management（管理）

| 接口 | 功能描述 | 是否标准activitypub | 是否兼容mastodon | 兼容性声明 | 差异性缘由 |
| --- | --- | --- | --- | --- | --- |
| GET /health | 健康检查 | 否 | 否 | 内部管理；与 AP 无关 | 服务健康监测（SRE/运维） |
| GET /ping | Ping | 否 | 否 | 预留/待启用；与 AP 无关 | 快速连通性与路由校验 |
