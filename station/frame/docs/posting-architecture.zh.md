# 发帖功能方案设计与实现步骤

## 目标
- 在联邦网络中以 ActivityPub 为主通道，实现文本/媒体/话题/可见性/CW/投票等发帖
- 保持跨平台适配能力（微信/QQ/微博/Twitter/Facebook），通过适配层降级/转换
- 桌面端（Flutter）提供所见即所得编辑体验，用户不接触技术细节

## 架构概览
- 客户端层（Flutter Desktop）
  - Composer：正文、媒体、话题/@提及、CW、可见性、投票
  - 控制器：构造 `PostInput`，调用后端 API，处理上传与进度
- 服务层（Station/Frame/Touch）
  - PostingService：接收 `PostInput`，校验、持久化、生成 ActivityPub 对象与投递计划
  - APMapper：将 `PostInput` 映射为 `ap.Note` 与 `ap.Activity(Create)`
  - DeliveryEngine：基于 HTTP Signatures 将 Activity 投递到收件人 inbox
  - MediaStore：媒体上传与元数据（MIME、尺寸、哈希、alt 文本）
- 适配层（Bridge/Adapters）
  - PlatformAdapter：将 `PostInput` 转换为各平台 API 负载与能力降级

## 数据模型（服务端）
- PostInput
  - `text`、`attachments[]`、`altText[]`、`tags[]`（hashtag/mention）、`cw`、`sensitive`、`visibility`、`audience[]`、`replyTo`、`poll`、`clientId`
- Persisted Entities
  - `post`（规范化存储，含渲染快照）、`media`、`ap_object`（Note/Question 等）、`ap_activity`（Create）、`delivery_job`

## ActivityPub 映射
- 对象：`ap.Note`
  - `content`：由编辑器渲染的富文本（服务端生成，不暴露给用户）
  - `attachment[]`：媒体（含 `type`/`url`/`name`/`mediaType`/`blurhash`/`alt`）
  - `tag[]`：`Mention` / `Hashtag`
  - `inReplyTo`：回复时设置
  - `sensitive`：配合 CW
  - `summary`：CW 文案（可选）
- 活动：`ap.Activity`，`type=Create`
  - `actor`：本地 Actor
  - `object`：上述 `Note`
  - `to`/`cc`：根据可见性计算（Public、Followers、Direct、Custom）

## 关键流程
- 新建发帖
  1. 客户端提交 `PostInput`
  2. 服务端校验（字数/媒体大小/可见性规则）
  3. 媒体入库并生成链接、元数据
  4. APMapper 生成 `Note` 与 `Create`，写入 `ap_object`、`ap_activity`
  5. 写入 Outbox，并创建 `delivery_job`（收件人集合：本地/远端 followers/inbox）
  6. DeliveryEngine 异步投递（签名、重试、去重）
  7. 返回 `postId`、`activityId`
- 删除/编辑
  - 删除：生成 `Delete`，更新本地状态并通知远端
  - 编辑：生成 `Update`（保留历史），兼容对端策略

## API 设计（服务端）
- `POST /touch/post`
  - Body：`PostInput`
  - Returns：`{ postId, activityId }`
- `POST /touch/media`
  - 上传媒体，返回 `{ mediaId, url, mediaType, alt }`
- `GET /activitypub/outbox` / `POST /activitypub/outbox`
  - 兼容外部联邦访问与本地发起（必要时）

## 可见性与投递计算
- Public：`to=[Public]`、`cc=[Followers]`
- Followers：`to=[Followers]`；计算远端 followers inbox 列表
- Direct：`to=[具体对象]`；不向 `Public`
- Custom：基于 `audience[]`

## 异步投递策略
- 队列：`delivery_job` 按收件人分片
- 重试：指数退避，签名失败或 4xx/5xx 分类处理
- 去重：幂等键（`activityId` + 收件人）
- 速率：实例限流与远端节流

## 客户端实现要点（Flutter Desktop）
- 入口：左侧“发帖”按钮；或发现页浮动工具栏的“笔”图标
- 表单：
  - 文本编辑器（基础格式、话题、@提及）
  - 媒体选择与上传、alt 文本
  - 可见性选择（公开/关注者/仅自己/自定义）
  - CW 开关与文案、敏感媒体标记
  - 投票（选项、截止时间）
- 交互：
  - 提交后展示进度与本地预览卡片，完成后刷新时间线
  - 失败提示与重试

## 与现有代码的衔接
- Outbox/Inbox/Followers 等接口已存在：
  - 获取 Outbox：`station/frame/touch/activitypub/activitypub.go:227`
  - Followers 列表：`station/frame/touch/activitypub/activitypub.go:280`
- 新增：
  - `PostingService.CreatePost`：构造 `Note`/`Create`，持久化与投递
  - `DeliveryEngine.EnqueueAndSend`：签名 HTTP 投递

## 迭代计划
- v1：本地 Actor 发 ActivityPub 帖子（文本/图片/可见性/CW/投票）
- v1.1：编辑/删除、转发/引用、回复线程
- v2：跨平台适配器（微信/QQ/微博/Twitter/Facebook）与降级策略
- v2.1：内容审核、敏感检测、限流与防滥用

## 验证
- 单测：映射与可见性计算、签名与投递
- 集成：本地两实例互联、自我联邦循环验收
- 端到端：桌面发帖->Outbox->远端 Inbox -> 时间线显示

## 版本规划与执行清单

### V1（发帖、媒体、投递、可见性、CW、投票）
- 接口
  - `POST /activitypub/:actor/media` 上传媒体，返回 `{ media_id, url, media_type, alt }`
  - `POST /activitypub/:actor/post` 提交 `PostInput`，返回 `{ post_id, activity_id }`
- 服务
  - `posting.Create(ctx, db, actor, baseURL, in)` 构造 `Note` 与 `Create`，计算 `to/cc` 并调用 `activitypub.ProcessActivity`
  - `posting.StoreMedia(ctx, db, actor, baseURL, file, alt)` 保存媒体并返回元数据
- 入库
  - `activitypub_objects` 写对象，`activitypub_activities` 写活动，`activitypub_collections` 写 Outbox 关联
- 联邦投递
  - 复用 `deliverToRemote` 根据 `to/cc` 解析目标 actor，选择 sharedInbox/inbox，`DeliverActivity` 签名投递
- 桌面端
  - `PostingModule` 注册菜单；`ComposerPage` 编辑器；`PostingController` 负责媒体上传与发帖提交
  - UI 规范：圆角、阴影、透明度、间距遵循 Desktop Prompt；所见即所得，不暴露技术字段
- 验证
  - Outbox 页可见新活动；对端收件箱收到 Create；桌面端弹成功提示并刷新时间线

### V1.1（编辑、删除、转发/引用、回复线程）
- 接口
  - `PUT /activitypub/:actor/post/:id` → 生成 `Update` 并保留历史
  - `DELETE /activitypub/:actor/post/:id` → 生成 `Delete` 或 Tombstone 标记
  - `POST /activitypub/:actor/repost` → `Announce`
  - `POST /activitypub/:actor/quote` → 新 `Note` 引用原帖链接并附评论
- 回复
  - `reply_to` 映射 `Note.inReplyTo`，时间线按线程展示
- 验证
  - 版本历史可查询；删除后对象转 Tombstone；转发/引用/回复链路完整

## 规范对齐说明（代码与目录）
- 命名与目录
  - 领域模型使用独立目录与通用命名：`model/domain/post/post.proto`，包名 `peers_touch.model.post.v1`
  - Go 产物包名统一为 `model`，落位 `station/frame/touch/model`
- 路由注册
  - 作为 ActivityPub 家族路由常量注册：`PostingRouterURLPost`、`PostingRouterURLMedia`
  - 通过 `GetActivityPubHandlers` 添加，包裹 `CommonAccessControlWrapper(model.RouteNameActivityPub)`
- Handler 风格
  - 统一签名 `(context.Context, *app.RequestContext)`，`ctx.Bind` 参数解析，`store.GetRDS` 获取 DB，`SuccessResponse/FailedResponse` 返回
- 服务层与复用
  - 活动处理复用 `activitypub.ProcessActivity`、入库与 Outbox 关联复用现有实现；投递复用 `deliverToRemote` 与 `DeliverActivity`
- 前端规范
  - 目录分层 `features/<feature>/{controller,model,view}`，GetX 状态管理；网络使用 `ApiClient`（拦截器/重试/安全存储）
  - 表单提交使用 proto 的 `toProto3Json`，不暴露 HTML 等技术字段

## 风险与回滚策略
- 远端投递失败：保留活动入库与 Outbox 展示，异步重试（指数退避）；必要时暂停投递队列
- 兼容性：对端不支持编辑或投票时降级表现（追加修订、文本投票说明）；严格校验媒体类型与大小
- 回滚：按活动 ID 幂等处理；删除/更新以 `Delete/Update` 语义回撤，确保对端一致性
