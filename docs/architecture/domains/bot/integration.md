# Bot 能力 — 集成与映射

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-10-11 | **Updated**: 2026-10-11
> **Owner**: Architecture Team

---

现有模块引用均在 master（`9c70d39ed`）核实；新组件标 **NEW**。

## 1. 集成映射

| 现有 owner | 集成性质 | 说明 |
|---|---|---|
| actor / identity | adapted | 新 kind、PTID 字母、内部 mint、manifest 白名单 |
| conversation（DDD） | adapted | 新投递类型 + 系统发送方端口 + 显式授予 |
| notification | adapted | 新增事务内生产端口 ProduceInTx + 幂等键；bridge 保留给 fire-and-forget 调用方；实时事件 |
| events | adapted | StreamEvent 新增通知臂；直 Publish，不新建订阅框架 |
| key_exchange / actor_identity | reused（受限） | Bot 设备登记/prekey 设施 kind 无关，但 Bot 消息 v1 不消费密文路径 |
| Desktop runtime（tray/通知/投影） | NEW | tray、OS 通知、SSE 优先、设置页、Bot 卡片 |
| Station HTTP edge | adapted | JWT 外公开路由 + 流式大小限制 |

## 2. 身份集成

- Bot 创建走 Station 内部 mint（非 `ActorSignRequest` 公开注册）：创建 HIDDEN 的
  AGENT actor，再经 actor_identity/key_exchange 既有服务登记一台 Station 持有的
  actor 设备（G-BOT-02）。
- registry 只存能力状态与 `bot_ptid`/`owner_ptid` 引用，不复制资料/密钥字段。
- **传播集（执行清单）**：`ptid.go`、`db/actor_kind.go`、`signup_kind.go`
  （防御性，内部 mint 不经此路径）、`actor_identity/application/endpoint_manifest.go`
  签发+验证两处白名单、`actor_identity/infrastructure/persistence/repository.go`
  kind 迁移映射；社交护栏确认 AGENT 被人类图动作拒绝。
- 评审确认仅两处 PERSON 默认风险点（`KindFromProto`、`fromProtoActorKind`）；
  accessgate attempt 存储、secure-content canonical、dashboard 为透传/无分支，
  执行时以全量 grep 回归兜底。
- 内部 mint 必须显式置 HIDDEN：本地注册辅助默认 `BY_HANDLE` 并触发发布；locator
  对 hidden 行不发布，无需 AGENT 专用特判。

## 3. 会话集成

- 会话域新增 `direct_service_plaintext` 投递类型（命名归会话 owner）：聚合根校验
  增加"直聊 + 系统发送方 + 显式授予"分支；CommitmentCode、sealer/事件投影、mapper
  与设备回执路径 `infrastructure/delivery/receipt_recorder.go:deliveryKindFromProto`
  （现对未知 kind fail-closed）同步扩展；人类设备命令路径无法构造该类型。
- **线协议（BOT-D05 必改面）**：
  - `model/domain/chat/command.proto`：`PreparedEndpointPayloadKind`（现值 0–7）
    新增 `…_DIRECT_SERVICE_PLAINTEXT = 8`，明文 payload 结构在 proto 定义；
  - `model/domain/chat/conversation.proto`：`ConversationMember` 新增
    `ActorKind actor_kind`；落库消息增加投递安全标记；
  - 三端生成物重新生成。
- **客户端共享 crate（`packages/messaging-core`）**：inbox consumer 现对未知 kind
  返回 `Err`（consumer.rs）、direct 处理器仅收 `DirectCiphertext`（direct.rs）、
  verification 按 kind 分派。新增 service-plaintext processor；并把"未实现的已知
  类型 skip+ack、推进位点、不毒化持久 inbox"定义为 crate 级语义。Desktop 链接该
  crate 做完整渲染；Mobile v1 仅消费 skip+ack（这是共享 crate 改动，不属于"移动端
  功能开发"）。TS 侧 `encryptionEnabled` 信号改由消息安全标记 + 成员 actor_kind 推导。
- Bot 处理器经会话**应用层**命令端口提交（不写会话表、不走 HTTP 自调用）；前置
  条件：registry ACTIVE、owner 匹配、系统授予存在；CreateDirect 所需
  FederationID/AuthorityEpoch/已验证端点路由由内部端口以 Station 身份提供
  （进程内先例：`EnsureAcceptedRelationshipDirectConversation`，其 Creator 现硬编码
  PERSON，执行时适配 AGENT）。这是 G-BOT-03 的验证内容；若端口只能接受设备签名
  HTTP 调用方，则在会话应用层新增窄系统发送构造器，bot 子服务器不得获得会话
  repository 访问权。
- v1 非 owner/联邦目标在系统发送方端口直接拒绝（联邦层 payload 不透明，不能依赖
  其按 kind 判别）。
- 读路径不变：历史/未读/回执走现有投影；客户端按消息安全标记与参与者
  ActorKind=AGENT 选择 Bot 卡片渲染并去除 E2EE 锁（G-BOT-09 的明确 wire 合同，
  非客户端猜测）。

## 4. 通知与 events 集成

- Bot **不经** `notification.NewBridge()`：bridge 是全局 fire-and-forget 单例，
  repo 自持事务、service 未注册时静默 nil，无法加入准入共享事务。Bot 走
  notification 应用层**新增的事务内生产端口** `ProduceInTx(ctx, tx, …,
  idempotencyKey)`；bridge 保留给社交等既有/未来非事务调用方（当前仍零生产调用，
  Bot 是首个真实租户，但是走新端口而非 bridge）。
- `notification.Service.Produce` 现有偏好语义保持：owner 关闭 TASK category 时
  不产生通知行；Bot 不绕过。会话消息始终创建，不受偏好影响。
- 落库后 post-commit 直 `GetBus().Publish`（现有模式，参考 social/application
  发布位置），事件为 StreamEvent 新通知臂；不引入订阅框架。事件总线为进程内设施，
  跨进程扇出不在 v1。
- Desktop `store/notification.ts` 从 15s 轮询改为 SSE 优先（复用现有
  `services/eventStream.ts` 客户端），轮询保留为重连补偿。
- webhook 请求本身不经 `/realtime/signal`；扇出只在事务提交后开始。
- **push 边界澄清**：Station 目前只有 APNS/FCM 设备绑定模型与保护存储，没有任何
  推送分发器。v1 触达 = 在线 SSE + Desktop OS 通知 + 历史未读；离线移动 push 不
  在 v1 范围，待分发器能力单独立项。

## 5. Desktop 集成

Rust（`apps/desktop/src-tauri`）：

- Cargo：tauri 依赖启用 `tray-icon` feature（现仅 `protocol-asset`；tray-icon
  crate 已在 Cargo.lock 但 feature 未开），并新增 `tauri-plugin-notification`；
  tray 用核心 `TrayIconBuilder`（不是新第三方 crate）。
- 新运行时模块：`application/tray`（图标/菜单/未读投影）、
  `application/os_notification`（发起策略与 action 路由）；遵循 runtime-projections
  合同：长期投影归 RuntimeDescriptor，页面纯渲染。
- 复用已预留事件 `desktop:tray-open`、`desktop:notification-tap`（现无调用方）与
  `peers-touch://` deep-link；Rust 侧 scheme 允许列表后再交 OS 打开。
- 关窗拦截（现状 main.rs 仅处理 Resized）：默认 hide，设置可改 quit；tray 菜单
  打开/静音/退出；无 tray 的 Linux 降级为窗口模式。

TypeScript（`apps/desktop/src`）：

- 全局层 Settings 新增 Bots 管理区（创建/轮换/停用/吊销、URL 与 curl 接入片段复制）。
- `peers-touch.bot-event.v1` Bot 事件卡片（状态字形、严重度、来源、主操作按钮）。
- 通知 SSE 摄入改造；tray 角标只消费既有未读 store，不新建真源。
- 全部可见文案走 i18n；Bot 提供的 title/body 作为数据渲染。

## 6. HTTP 边缘集成

- `POST /bot/webhook/:webhook_id`（Hertz `:param` 语法）挂在 JWT 中间件**之外**，
  公开路由有既有先例（login/health/federation）；认证仅为 Bearer secret，
  常量时间比较；无 cookie/CSRF 面。
- typed handler 在调用业务函数前缓冲至 64 MiB，**不能**用于该端点；webhook 处理器
  使用流式 `BodyStream()` + 32 KiB `LimitReader` 包装，超限即 413。
- 管理路由 `/bot/...` 走既有 JWT 包装与 owner subject 解析。
- 端点无状态：同库任意 Station 进程均可接收，集群拓扑无需粘性会话。
- 进程注册：新子服务器经 `app/cmd/...main.go` 的 `server.WithSubServer(...)` 挂载（
  module-layout 已列）。

## 7. 调用方集成（v1 无官方 CLI）

v1 不提供、不维护 sender CLI（BOT-D10 superseded）。对外只交付
[webhook-api.md](./webhook-api.md)：任意 HTTP 客户端（curl、CI、SaaS、agent hook 脚本）
直接调用同一端点。要点：

- 调用方发送 canonical proto-JSON（严格拒绝未知字段，枚举用完整名）；hook 原生 JSON
  →canonical event 的映射（Claude Code `Stop`→task_completed、`Notification`→
  waiting_input/task_failed）是调用方职责，webhook-api.md §9 给了 curl/jq 片段。
- 凭证来自环境变量 / 本地 0600 配置（如 `PEERS_BOT_URL`、`PEERS_BOT_SECRET`），Station
  不规定其装载方式。
- 不阻塞 agent 由调用方保证：固定约 5s 超时、失败不致命（`|| true`）；401/400/413 终态
  丢弃，需补偿时用同一 `request_id` 重试（24h 幂等）。v1 不提供官方 spool。
- 未来若官方维护发送端，它是 `apps/` 下的一等公民（独立生命周期/发布），不落在 `tooling/`。

## 8. 联邦边界

- v1：HIDDEN actor、不发布 DHT、scope OWNER_ONLY。服务明文不出站的**主**强制点是
  系统发送方端口（拒绝任何非 owner/联邦目标）；联邦适配器侧的拒绝仅作纵深防御，
  且因其 payload 不透明，不作为主判别。
- 未来启用时复用 conversation 现有 federation sender/receiver，不造 Bot 私有联邦
  协议；新增的只是策略位（`FEDERATED`）与能力条目。

## 9. 影响面汇总

| 改动面 | 程度 |
|---|---|
| model/domain（actor/bot/notification/realtime/chat 五个 proto 域） | 新增 bot 域；actor/notification/realtime 枚举或 oneof 扩展；chat command/conversation 投递类型与成员投影扩展；全端重新生成 |
| packages/messaging-core（Rust 共享 crate） | service-plaintext processor、未知类型 skip+ack 语义 |
| Station identity 链 | 枚举传播集（含 manifest 白名单、迁移映射） |
| Station conversation | 投递类型、系统发送方端口、授予校验、sealer/投影/回执 |
| Station notification/events | 事务内生产端口、幂等键、post-commit Publish、StreamEvent 臂 |
| Station 新 bot 子服务器 | 全新 DDD 模块 |
| Desktop Rust | tray-icon feature、官方通知插件、两个运行时模块 |
| Desktop TS | 设置页、卡片、SSE 通知摄入、i18n |
| 调用方集成（无官方 CLI） | 仅文档化 HTTP 合同 webhook-api.md；不在本仓库新增发送端代码（S4 deferred） |
| Mobile | 仅共享 crate 的 skip+ack 行为；无功能 UI 开发 |

## 10. 观测与文档触点

- 结构化日志：按 webhook_id 哈希/bot_ptid/outcome 记录；不打 secret 与完整 body。
- 指标：admitted/rejected/rate-limited、准入延迟、扇出延迟；Settings 展示
  last-used 与近期失败计数；webhook 投递失败不产生通知（避免递归告警）。
- 文档：`docs/architecture/domains/identity/unified-actor-system.md`（AGENT kind）、
  `docs/architecture/domains/notification/notification-architecture.md`（实时扇出）、
  `docs/client/desktop/` tray 投影合同、
  `packages/locales`。
