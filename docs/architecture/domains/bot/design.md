# Bot 能力 — 架构设计

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-10-11 | **Updated**: 2026-10-11
> **Owner**: Architecture Team

---

## 1. 核心原则

1. **Bot 是 actor 的一类**：身份走 actor/PTID 体系，消息走统一会话图；不建设平行 bot 通道、平行存储或平行身份。
2. **信任边界诚实**：Station 驻留 Bot 不持有客户端侧 E2EE 语义；Bot 会话使用显式的服务明文投递类型，客户端不得显示端到端加密保证（BOT-D05）。
3. **一个摄入原语**：本机调用方（curl / agent hook）与外部 SaaS 共用同一 webhook 端点与同一条准入管道；凭证只管摄入，不触碰人类会话。
4. **hook 绝不阻塞 agent**：调用方失败语义由调用端按 [对外 Webhook 合同](../../../api/bot/webhook.md) 兜底（固定超时、失败不致命），Station 不向 hook 同步路径施加重试压力，也不提供官方 sender CLI（BOT-D10 superseded）。
5. **通用修补优先**：通知实时化是对所有通知生产方的通用修补，Bot 只是锚定租户。

## 2. 架构适用性评审（AAR）

### 2.1 证据基线（master `9c70d39ed`）

- actor kind 端到端打通：proto enum → PTID 字母 p/g/o/s/a → DB shorthand → signup profile；`ptid.go:88-92` 为类型白名单。
- 直聊聚合根强制密文：`conversation/domain/aggregate/conversation.go:1219-1241`；投递类型共 7 种（`direct_ciphertext`、`mls_application/commit/welcome/retirement`、`public_event`、`conversation_state`，`value_objects.go:305-313`）。
- Station Go 无 X3DH/双棘轮发送方；`packages/messaging-core/src/crypto/`（Rust）仅客户端使用；Go 侧只有 `direct_crypto.pb.go` wire 类型。
- `notification.Service.Produce` 自丢弃 `recipient==actor`（service.go:77-79）、只落库；bridge 存在但零生产调用方。
- `GET /events/stream`（events/handler.go:80）按 actor 扇出；`StreamEvent` 无通知臂；生产方直接 `GetBus().Publish`，无订阅框架。
- Desktop：Tauri 2.0.1；无 tray/notification 插件；通知中心 15 秒轮询（store/notification.ts:13）；`desktop:tray-open`/`desktop:notification-tap` 事件名已预留但无调用方；`peers-touch://` deep-link 已配置。
- 公开无 JWT 路由存在既有先例（login/health/federation）；typed handler 在函数执行前最多缓冲 64 MiB body。

### 2.2 适用性矩阵

| Case | 候选架构 / capability | 触发证据 | 判定 | 落地约束 | 重审触发 |
|---|---|---|---|---|---|
| AAR-C01 | Shared Domain Contract：`model/domain` | 新 actor kind、新 bot/webhook proto、新通知类型、新投递语义跨 Station/Desktop 共享 | required | 全部进 proto：actor、bot、webhook、realtime oneof、notification type；生成物不可手改 | proto 契约变更 |
| AAR-C02 | Desktop runtime projection：runtime-projections / global-context-kernel | tray 是跨窗口、跨登录周期的长期驻留投影 | required | tray/OS 通知属 Rust 运行时与 RuntimeDescriptor；页面保持纯渲染，不挂 mount 拉取 | 多窗口/多账号模型变化 |
| AAR-C03 | i18n：`docs/architecture/i18n` | Bot 设置、通知文案、tray 菜单、错误 | required | 全部走 locale key；Bot 提供的 title/body 作为数据渲染，不做本地化 | 新增支持语言 |
| AAR-C04 | Handler ownership：unified-handler / api-ownership | 新增公开 webhook 路由与 JWT 管理路由 | adapted | webhook 在 JWT 中间件之外挂载，自带 secret 鉴权包装；管理路由复用 JWT owner 解析；唯一 route/能力登记 | 路由或鉴权包装变化 |
| AAR-C05 | Realtime：event-stream / kernel-events | Station→Desktop 实时通知、断线补偿 | adapted | 新增 StreamEvent 通知臂，Desktop SSE 优先；轮询降为补偿；ordering/replay 遵循 events 子服务器既有合同 | 扇出协议变化 |
| AAR-C06 | Storage：unified runtime storage | 新 registry/inbound 表、secret 哈希 | required | Station 侧经既有 RDS/迁移机制；v1 无官方 CLI/spool，调用方缓冲只落其本机配置目录（0600），不入项目目录 | 存储归属变化 |
| AAR-C07 | UI Foundation：LobeUI/packages/ui | Bot 设置页、Bot 消息卡片、tray 菜单 | required | 先复用 LobeUI/现有设置框架；tray 菜单是 Rust 原生菜单，不造 Web 平行实现 | UI 基础件升级 |
| AAR-C08 | Identity/Trust：scope boundary、security | 新 actor 类型、secret 凭据、非 E2EE 会话、公开端点 | required | 服务端 mint 隐藏 actor；secret 仅哈希；新投递类型仅系统发送方可用；客户端去 E2EE 锁；联邦 v1 禁用 | 联邦化/常驻客户端加密落地 |
| AAR-C09 | Logging/Errors | 外部入站、限流、失败路径 | required | 复用 station logger 与字符串错误码+HTTP 状态惯例；禁止日志记录 secret/完整 body | — |
| AAR-C10 | Acceptance：acceptance-framework | 新能力、Journey、负向约束 | required | 按 acceptance-matrix 登记 Domain/Capability/Gate；打包 Desktop Journey 证明 tray 主张；未证即 UNPROVEN | 范围变化 |
| domain | conversation 聚合根（direct delivery） | Bot 消息要进会话图，但密文强制阻塞 | adapted | 会话域 owner 新增 `direct_service_plaintext` 投递类型 + 系统发送方授予端口；Bot 子服务器只依赖应用端口 | Pantalaimon 式常驻客户端加密启动 |
| domain | actor_identity endpoint manifest | 端点路由白名单硬编码六种 kind（endpoint_manifest.go:448-463） | adapted | 白名单与持久化迁移映射增加 AGENT；属 G-BOT-02 强制传播集 | kind 枚举再变更 |
| domain | notification push（APNS/FCM） | 产品文案曾声称"既有 push" | not_applicable（v1） | 仅有设备绑定注册，无分发器；v1 触达=在线 SSE+Desktop OS 通知，离线移动 push 明确不做；重审触发：push 分发器落地 | 分发器实现时 |

## 3. 系统架构

```text
┌──────── 用户机器 / 外部系统 ─────────────────────────────────────────────┐
│ coding agent ─hook→ curl/jq · CI · SaaS · 任意 HTTP 客户端（v1 无官方 CLI） │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ HTTPS  Authorization: Bearer <secret>（调用方固定 ~5s 预算）
┌──────── Station 进程 ─────────▼────────────────────────────────────────┐
│ HTTP edge                                                              │
│  POST /bot/webhook/:webhook_id     （JWT 外，secret 鉴权，流式 32KiB）   │
│  /bot/* 管理路由                    （JWT 内，owner 作用域）             │
│       │                                                                │
│       ▼                                                                │
│ bot 子服务器（DDD）                                                     │
│  IngressGuard → Normalizer → Admission（幂等/限流/折叠）                │
│       │ 准入（共享 RDS 单事务，BOT-D12）                                 │
│       ├─▶ conversation 应用命令端口（系统发送方=Bot PTID，服务明文投递）  │
│       └─▶ notification 事务内生产端口（幂等键）──提交后 Publish（新通知臂）│
│                                        ├─▶ /events/stream SSE          │
│                                        └─▶ 历史/未读（poll 补偿）        │
└───────────────────────────────────────────────────────────────────────┘
                               │
┌──────── Desktop（Tauri 2）────▼────────────────────────────────────────┐
│ Rust：tray 图标/菜单、关窗隐藏、OS 通知、scheme 允许列表、deep-link 路由 │
│ Web：SSE 客户端、Bot 事件卡片、全局层 Bot 设置页                          │
└───────────────────────────────────────────────────────────────────────┘
```

## 4. 核心契约

### 4.1 身份

- `ACTOR_KIND_AGENT = 7`、PTID letter `b`；服务端 mint：无密码、`HIDDEN`（须显式覆盖本地注册默认的 `BY_HANDLE` 并跳过发布；locator 对 hidden actor 天然安全，无需 AGENT 特判）。
- registry 只存能力行：`bot_ptid`、`owner_ptid`、webhook id、secret 哈希、状态、scope、配额。

### 4.2 入站

- 端点：`POST /bot/webhook/:webhook_id`，Hertz 风格路径参数；未知 id 与错误 secret 返回不可区分的 `401 BOT_WEBHOOK_UNAUTHORIZED`。
- 路由处理必须走流式读取 + 32 KiB `LimitReader`（typed handler 会先缓冲 64 MiB，不可直接使用）。
- 准入：per-Bot 令牌桶 + per-IP 溢出桶；`request_id` 24h 幂等窗口；`dedupe_key` 仅在未读且同日折叠。
- 失败码：`BOT_DISABLED(409)`、`BOT_NOT_FOUND(404)`、`BOT_RATE_LIMITED(429)`、`BOT_EVENT_INVALID(400)`、`BOT_SCOPE_NOT_ENABLED(403)`、`BOT_DELIVERY_FAILED(500)`；错误码沿用 Station 字符串码 + HTTP 状态惯例，不臆造数字区间。
- 事件 JSON 为 `model/domain/bot/webhook.proto` 的 proto-JSON；请求体不得携带 actor/recipient/会话 id。

### 4.3 会话投递

- 会话域新增 `direct_service_plaintext`（工作名）：仅 Station 内部系统发送方可用，仅直聊，v1 禁止联邦；fail-closed 点是聚合根系统发送方校验与设备回执 `deliveryKindFromProto`（对未知 kind 拒绝）。
- 线协议必改面（缺一不可，纳入 G-BOT-03 早期证明）：
  - `chat/command.proto`：`PreparedEndpointPayloadKind` 新增值 8 `DIRECT_SERVICE_PLAINTEXT`，明文 payload 结构在 proto 定义；
  - `chat/conversation.proto`：`ConversationMember` 投影新增 `actor_kind`；落库消息记录投递安全标记（service_plaintext），历史判定不依赖参与者资料；
  - `packages/messaging-core`：inbox 新增 service-plaintext processor；consumer 现对未知 kind 报错、direct 仅收密文，需同时把"未实现类型 skip+ack、不毒化持久 inbox"作为共享 crate 语义落地；Desktop 完整渲染，Mobile v1 仅 skip+ack。
- 发送前置：registry ACTIVE、owner 匹配、系统授予 `{bot, owner, bot-direct-conversation}`、CreateDirect 所需 FederationID/AuthorityEpoch/端点路由由内部端口以 Station 身份提供（执行期验证，G-BOT-03）。
- 消息体含 `peers-touch.bot-event.v1` 结构化负载（eventType/severity/source/actionUrl/dedupeKey）与降级文本；去锁标记同时由消息投递安全标记与成员 `actor_kind=AGENT` 表达（客户端 TS 现有 `encryptionEnabled` 信号改由这两个来源推导）。

### 4.4 实时与通知

- 通知 category 复用 TASK(4)，新增 `NOTIFICATION_TYPE_BOT_EVENT = 410`；Produce 增加幂等键入参。
- Bot 准入不走全局 bridge，而走 notification 应用层新增的**事务内生产端口**（可绑定准入事务的 `*gorm.DB`）；bridge 保留给社交等 fire-and-forget 调用方。
- 落库提交后执行 `GetBus().Publish`（post-commit 钩子，新增 StreamEvent 通知臂）；扇出尽力而为，失败不回滚。
- 静音两层不混淆：Station 通知偏好关闭 TASK 时不产生通知行（既有 `Produce` 语义）；OS 通知另由窗口焦点/设备静音判定。会话消息与会话未读始终产生。
- 事件总线为进程内设施：webhook 与 SSE 同进程时秒达；多进程部署跨进程扇出不在 v1，轮询补偿；单节点自托管为 v1 部署基线。

### 4.5 Desktop 驻留

- 关窗默认隐藏（可配置退出）；tray 菜单：打开、静音快捷项、退出。
- **角标语义**：菜单栏/Dock 角标显示**未读会话总数**（消息通道，与应用内会话角标同一真源）；notification 臂 v1 只驱动 OS 横幅与通知中心，不向托盘贡献计数。message 与 notification 两类事件的 OS 横幅共用同一套焦点/可见性/静音判定组件，tray 对消息源类型无感知。
- OS 通知发起条件：无可见聚焦窗口持有目标会话且偏好允许；每设备每事件恰好一条。
- action URL 经 Rust scheme 允许列表（`peers-touch`/`https`/用户首见确认的 IDE scheme）。

## 5. 组件关系

- `bot/interface/http` → `bot/application` → `bot/domain`；infrastructure 实现仓储。
- `bot/application/delivery` 依赖 conversation **应用端口**与 notification **事务内生产端口**；禁止 import 两者的 infrastructure/repository。
- 事务编排（BOT-D12）位于 bot application：inbound 落库、conversation UoW（`BindUnitOfWork` 先例）与 notification 事务端口绑定同一 `*gorm.DB`；实时 Publish 注册为 post-commit 动作。
- Desktop Rust 持有 tray/通知运行时；TS 页面只消费投影；Bot 设置是全局层页面，不嵌任何工作区。

## 6. 失败语义

- 调用方（agent hook / CI）：固定约 5s 超时、失败不致命（`curl --max-time 5 … || true`）；401/400/413 视为终态丢弃；需补偿时用同一 `request_id` 重试（24h 幂等）。v1 不提供官方 CLI / spool，详见 webhook 合同 §8。
- Station 准入后失败：inbound 行补偿为 quarantined 并返回 500；同 request_id 重试幂等驱动消息+通知两件产物，无部分成功稳态。
- 扇出失败：持久化不回滚，SSE resume/轮询收敛。
- 过载：先于 body 解析限流；大 payload fail-closed；无界队列禁止。
- 吊销竞态：准入时鉴权通过的在途事件允许落完；disable/revoke 对后续请求即时生效。
- Desktop 重启：tray/未读从 store 与 SSE resync 重建，Rust 不持有唯一通知状态。

## 7. 质量门

| Gate | 证伪条件 |
|---|---|
| G-BOT-01 | 无正确 secret 的请求产生任何存储产物或通知 |
| G-BOT-02 | AGENT 无法完成一台 Station 托管设备登记与 endpoint manifest 放行（含白名单/迁移映射传播集）。注意：服务明文投递不消费 content prekey/X3DH，prekey 发布不是 Bot 的必验路径 |
| G-BOT-03 | 不经会话 repository 耦合完成服务明文投递不可行，或其线协议面未闭合：PreparedEndpointPayloadKind=8、成员 actor_kind/消息安全标记、messaging-core 明文 processor 与 skip+ack、FederationID 内部来源 |
| G-BOT-04 | 同 request_id 重试产生重复消息，或在通知偏好允许时产生重复通知行 |
| G-BOT-05 | 调用方（agent hook）可能因非零退出或超预算拖慢 agent。v1 无官方 CLI，证伪条件为 webhook 合同 §8 的调用约定无法满足“固定墙上时间 + 失败不致命 + 幂等重试”（以 curl 实测，非推断） |
| G-BOT-06 | 打包 Desktop：隐藏→事件→OS 通知→点击→Bot 会话深链全链路失败 |
| G-BOT-07 | 单 webhook 可突破速率/体积限制填满存储或扇出队列 |
| G-BOT-08 | disable/revoke 对紧随其后的请求不即时生效 |
| G-BOT-09 | Bot 会话出现任何人类 E2EE 保证 UI |
| G-BOT-10 | 服务明文消息在打包 Desktop 可端到端投递并正确渲染；移动端遇未知 delivery kind 不崩溃 |

G-BOT-02/03 为执行早期结构性验证；失败时改设计，禁止实现期打补丁绕过。
