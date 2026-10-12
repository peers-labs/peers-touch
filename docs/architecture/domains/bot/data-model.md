# Bot 能力 — 数据模型与运行语义

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-10-11 | **Updated**: 2026-10-11
> **Owner**: Architecture Team

---

Proto-first：下列契约先落 `model/domain/**/*.proto`，经 `./model/build.sh` 生成；
webhook 边缘的 JSON 是对应 proto 的 proto-JSON，进程间/跨端通信仍只走 protobuf。

## 1. 身份变更

### 1.1 actor kind 与强制传播集

`model/domain/actor/actor.proto`

```proto
ACTOR_KIND_AGENT = 7; // IM bot：可对话的非人类 actor
```

| 层 | 变更 |
|---|---|
| PTID | `frame/touch/activitypub/identity/ptid.go`：新增 `TypeAgent AccountType = "b"`；写入白名单 switch（:88-92）与解析器 |
| DB shorthand | `frame/touch/model/db/actor_kind.go`：`b ↔ ACTOR_KIND_AGENT` 双向映射。注意此文件是仅有的 PERSON 默认点之一（未知名/UNSPECIFIED → `p`），AGENT 必须显式分支 |
| Signup profile | `frame/touch/actor/signup_kind.go`：新增 AGENT case（AP 类型映射 Service）。Bot 不经公开 signup，此为防御性传播；该文件默认 Person 是第二个 PERSON 默认点 |
| Endpoint manifest | `actor_identity/application/endpoint_manifest.go:448-463` 白名单（签发与验证两处）必须接受 AGENT，否则 Bot 端点路由被拒（G-BOT-02 路径上的 fail-closed 点） |
| 持久化迁移映射 | `actor_identity/infrastructure/persistence/repository.go:234-251` 增加 `b` 映射 |
| 社交护栏 | social 好友/联邦请求已对非 PERSON fail-closed（核实）；审计确认 AGENT 归类为"拒绝社交图动作，但允许系统授予直聊" |
| 其他 kind 分支 | 经评审核实为透传、无需改动：accessgate attempt 存储（int 透传）、secure-content canonical（PTID/varint 透传）、dashboard（无 kind 分支）。执行期以 grep 回归确认 |

Bot 由 Station 内部 mint：无密码、`ACTOR_VISIBILITY_HIDDEN`（本地注册辅助默认填
`BY_HANDLE`，内部 mint 路径必须显式覆盖并跳过发布；locator 依据 visibility 工作，
无需 AGENT 特判）。

### 1.2 Bot PTID

普通 actor PTID，account letter `b`，如
`ptid:v1:actor:peers:b:claude-code-notifier:<rand>`，经同一解析器。

## 2. Bot 域 proto

新目录 `model/domain/bot/`。

### 2.1 registry 与管理 API（`bot.proto`）

```proto
package peers_touch.model.bot.v1;

message Bot {
  string bot_ptid = 1;
  string owner_ptid = 2;
  string name = 3;
  BotState state = 4;
  string webhook_id = 5;
  bool secret_delivered = 6;   // 明文永不持久化
  string secret_hint = 7;
  BotDeliveryScope delivery_scope = 8; // v1 恒 OWNER_ONLY
  int32 rate_limit_per_minute = 9;
  int64 created_at_ms = 10;
  int64 disabled_at_ms = 11;
  int64 revoked_at_ms = 12;
}

enum BotState {
  BOT_STATE_UNSPECIFIED = 0; BOT_STATE_DRAFT = 1; BOT_STATE_ACTIVE = 2;
  BOT_STATE_DISABLED = 3; BOT_STATE_REVOKED = 4;
}
enum BotDeliveryScope {
  BOT_DELIVERY_SCOPE_UNSPECIFIED = 0;
  BOT_DELIVERY_SCOPE_OWNER_ONLY = 1;
  reserved 2, 3; // LOCAL_ACTORS / FEDERATED（未来）
}

message CreateBotRequest { string name = 1; }
message CreateBotResponse { Bot bot = 1; string webhook_url = 2; string secret_plaintext = 3; }
message RotateBotSecretRequest { string bot_ptid = 1; }
message RotateBotSecretResponse { string secret_plaintext = 1; }
message SetBotStateRequest { string bot_ptid = 1; BotState target_state = 2; }
message SetBotStateResponse { Bot bot = 1; }
message ListMyBotsRequest {}
message ListMyBotsResponse { repeated Bot bots = 1; }
```

管理端点走 JWT + owner 解析，与 webhook 边缘分离。

### 2.2 webhook 事件（`webhook.proto`）

```proto
message IngestWebhookEventRequest {
  string schema_version = 1;   // "1"
  string request_id = 2;       // 必填，幂等键
  BotEventType event_type = 3;
  BotEventSeverity severity = 4;
  string title = 5;
  string body = 6;
  string group_key = 7;
  string dedupe_key = 8;
  WebhookSource source = 9;
}
message WebhookSource {
  string agent = 1; string workspace = 2; string session_id = 3;
  string action_url = 4; map<string, string> labels = 5;
}
enum BotEventType {
  BOT_EVENT_TYPE_UNSPECIFIED = 0; BOT_EVENT_TYPE_TASK_COMPLETED = 1;
  BOT_EVENT_TYPE_WAITING_INPUT = 2; BOT_EVENT_TYPE_TASK_FAILED = 3;
  BOT_EVENT_TYPE_IDLE = 4; BOT_EVENT_TYPE_CUSTOM = 5;
}
enum BotEventSeverity {
  BOT_EVENT_SEVERITY_UNSPECIFIED = 0; BOT_EVENT_SEVERITY_INFO = 1;
  BOT_EVENT_SEVERITY_ATTENTION = 2; BOT_EVENT_SEVERITY_ERROR = 3;
}
// 来源验真预留（v1 不校验）：X-PT-Signature: sha256=<hmac>、X-PT-Timestamp
message IngestWebhookEventResponse {
  enum Outcome { OUTCOME_UNSPECIFIED = 0; OUTCOME_ACCEPTED = 1; OUTCOME_DEDUPLICATED = 2; }
  Outcome outcome = 1; string event_id = 2;
}
```

### 2.3 notification 扩展

`model/domain/notification/notification.proto`：

```proto
NOTIFICATION_TYPE_BOT_EVENT = 410; // TASK(400-499) 内的 410-419 段
```

不新增 category：沿用 TASK(4) 与现有偏好/静音/推送绑定。

### 2.4 realtime 扩展

`model/domain/realtime/event.proto` 的 `StreamEvent` oneof **新增通知臂**（字段号
接续现有 10–26 之后），载荷最小化：notification id、recipient、category、type、
group_key、created_at；Desktop 收到后按既有 list/投影拉取详情。三端生成物重新生成。

### 2.5 会话投递类型扩展（BOT-D05）

**Station 侧。** 会话域 valueobject 投递类型枚举新增（现有 7 种：
direct_ciphertext、mls_application/commit/welcome/retirement、public_event、
conversation_state；最终命名归会话域 owner）：

```go
DeliveryKindDirectServicePlaintext DeliveryKind = "direct_service_plaintext"
```

**线协议（必改，缺一则消息无法投递）。**

- `model/domain/chat/command.proto`：`PreparedEndpointPayloadKind` 现有值
  0–7，新增 `PREPARED_ENDPOINT_PAYLOAD_KIND_DIRECT_SERVICE_PLAINTEXT = 8`。
  服务明文 payload 不再是 opaque ciphertext，其编码结构（结构化事件 + 降级文本）
  在该 proto 中定义，三端生成物重新生成。
- `model/domain/chat/conversation.proto`：`ConversationMember` 投影新增
  `ActorKind actor_kind`（成员读取投影，唯一新增字段），作为去 E2EE 锁的稳定
  信号之一；落库消息/`MessageCommittedFact` 同步记录投递安全标记（delivery
  security = service_plaintext），保证会话历史在参与者资料缺失时仍可判定。
- Station 全部 kind 分支点同步扩展：聚合根校验（仅直聊 + 系统发送方 + 显式授予）、
  `CommitmentCode`、sealer、HTTP mapper、canonical event writer，以及设备回执
  路径的 `infrastructure/delivery/receipt_recorder.go:deliveryKindFromProto`
  （现对未知 kind fail-closed）。
- fail-closed 边界仅保留：聚合根系统发送方校验与回执记录器；联邦层 payload 对
  Station 不透明，"v1 禁联邦"由系统发送方端口拒绝非 owner 目标实现，不假设
  联邦适配器能按 delivery kind 判别。

**客户端（共享 Rust crate，BOT-D05 的必改面）。**

- `packages/messaging-core/src/inbox`：consumer 现对未知 kind 返回 `Err`
  （consumer.rs）、direct 处理器仅接受 DirectCiphertext（direct.rs）、
  verification.rs 按 kind 分派。新增 service-plaintext processor：把明文
  EndpointPayload 落为普通消息；未实现该类型的旧客户端必须走"skip + ack"
  路径（移动 v1 交付语义：识别枚举、忽略载荷、推进消费位点，不得毒化持久
  inbox），这是对共享 crate 的改动，不是零客户端改动。
- Desktop（直接链接 crate）实现完整渲染；Mobile 仅做 skip+ack，无功能 UI。

**消息负载。** 结构化负载命名空间 `peers-touch.bot-event.v1`（eventType、
severity、botPtid、source、actionUrl、dedupeKey）+ 降级文本。去 E2EE 锁双保险：
投递安全标记（消息级）+ 成员投影 ActorKind=AGENT（会话级）。

## 3. Station 持久化

bot 子服务器自有迁移与 GORM 模型。

### 3.1 `bot_registration`

| 列 | 说明 |
|---|---|
| bot_ptid (PK) | AGENT actor PTID |
| owner_ptid | 索引，人类 actor |
| name | 列表投影用；身份属性以 actor 行为准 |
| state | draft/active/disabled/revoked |
| webhook_id | unique，随机，索引 |
| secret_hash | SHA-256；revoke 后置空 |
| delivery_scope | 枚举，v1 恒 owner_only |
| rate_limit_per_minute | 准入配置 |
| created_at / disabled_at / revoked_at | |

唯一约束：`(owner_ptid, name)` 对 active 行；`webhook_id` 全局唯一。

### 3.2 `bot_inbound_event`

| 列 | 说明 |
|---|---|
| event_id (PK) | Station ULID |
| webhook_id / bot_ptid / owner_ptid | 准入解析后落库 |
| request_id | 幂等键；落库时计算 `idempotency_bucket`（request 时间按 24h 取桶的生成列），`(webhook_id, request_id, idempotency_bucket)` 建唯一索引；超窗行由既有清理任务清除 |
| dedupe_key / group_key | 折叠 |
| payload_canonical | 归一化、脱敏、截断后 JSON |
| admission_state | accepted / deduplicated / rejected / rate_limited / quarantined |
| command_id | 会话命令幂等回执引用 |
| notification_id | 通知引用 |
| source_ip_hash / received_at | 审计/滥用 |

### 3.3 notification 幂等与事务端口扩展

- `notification.Service` 新增**事务内生产端口** `ProduceInTx(ctx, tx, …,
  idempotencyKey)`：接受外部 `*gorm.DB`（与 inbound/会话命令同一事务），repo
  增加 `(recipient_ptid, idempotency_key, idempotency_bucket)` 唯一索引（bucket
  与 inbound 的 24h 取桶一致，超窗同 request_id 作为新通知）与"命中即返回原通知"
  语义；非 bot 调用方与现有 `NewBridge()` 路径传空键、不传 tx，行为不变。
- Bot 准入**不使用**全局 bridge（其 repo 自持事务、service 未注册时静默 nil，
  无法加入共享事务）；bridge 继续服务社交等 fire-and-forget 生产方。
- 实时 `Publish` 在事务提交后执行（准入服务注册 post-commit 钩子，失败不回滚，
  由 SSE resume/轮询收敛），禁止在事务内发布。

## 4. 状态机

### 4.1 Bot registry

```text
DRAFT ──secret 交付──▶ ACTIVE ⇄ DISABLED ──revoke──▶ REVOKED（终态）
```

in-flight：鉴权发生在准入时刻；disable 后在途已准入事件允许落完，后续请求即时被拒。

### 4.2 入站准入

```text
POST → 解析 :webhook_id
  ├─ 未知 id / secret 不匹配 → 401 BOT_WEBHOOK_UNAUTHORIZED（响应不可区分）+ 滥用计数
  ├─ DISABLED → 409 BOT_DISABLED
  ├─ REVOKED  → 404 BOT_NOT_FOUND
  ├─ scope ≠ OWNER_ONLY 的目标 → 403 BOT_SCOPE_NOT_ENABLED（v1 registry 恒 OWNER_ONLY，纵深防御）
  ├─ 令牌桶超限 → 429 BOT_RATE_LIMITED（Retry-After）
  └─ 流式读取(32KiB 上限) → 归一化
        ├─ schema/体积非法 → 400 BOT_EVENT_INVALID
        └─ 幂等检查 → 24h 内同 request_id → 200 deduplicated（返回原引用）
              └─ 共享 RDS 事务：inbound 落库 + 会话命令 + 通知(幂等键)
                    ├─ 成功 → 200 accepted
                    └─ 失败 → 全部回滚/补偿为 quarantined → 500 BOT_DELIVERY_FAILED
```

### 4.3 折叠

同一 `(bot, group_key, dedupe_key)` 的最新组未读且未跨天时，重复事件更新既有消息/
通知组；已读或跨天/类型/严重度不同则新消息。

### 4.4 投递语义

- edge → admitted：at-least-once（调用方重试）+ request_id 折叠为 exactly-one 可见产物。
- 顺序：per webhook id 有界 worker 保序；跨来源不保证。
- 实时扇出：每流位点 at-most-once，靠 resume/轮询收敛。
- 通知与消息在同一事务内创建；扇出在提交后（BOT-D12）。
- **静音语义两层，明确不混淆**：
  1. Station 行级：复用现有 `Produce` 偏好检查，owner 关闭 TASK category 时
     不产生通知**行**（通知中心也不计数）——这是既有语义，Bot 不特殊绕行；
  2. Desktop OS 级：窗口可见/聚焦或设备静音时不弹 OS 通知（独立判定）。
  会话消息与会话未读**始终**产生，不受上述任一静音影响；消息是 durable 真源，
  通知只是提醒层。

> 进程边界：事件总线是进程内总线（非跨进程）。webhook 与 SSE 落在同一 Station
> 进程时 SSE 秒达；多进程/集群部署的跨进程扇出不在 v1 范围，此时新通知由
> Desktop 轮询补偿（15s）。单节点自托管是 v1 部署基线。

## 5. 限流与常量（v1 默认）

| 常量 | 值 |
|---|---|
| body 上限 | 32 KiB（流式 LimitReader，typed handler 的 64 MiB 缓冲不适用） |
| title / 单条 label | 200 / key 128、value 512；labels ≤ 16 |
| request_id | ≤ 128 字符；幂等窗口 24h |
| per-Bot | 60/min（可配置下限 1、上限 600） |
| per-IP 溢出 | 共享突发桶，超限 429 |
| CLI 超时 / spool | 5s 总预算 / 1 MiB / 24h，最旧先丢 |

## 6. 错误码

沿用 Station 现有惯例：字符串错误码 + HTTP 状态 + typed error（仓库不存在数字错误码
注册中心，不引入 20000s 编号说法）。逻辑码：`BOT_WEBHOOK_UNAUTHORIZED`、
`BOT_DISABLED`、`BOT_NOT_FOUND`、`BOT_RATE_LIMITED`、`BOT_EVENT_INVALID`、
`BOT_SCOPE_NOT_ENABLED`、`BOT_DELIVERY_FAILED`。响应不含 secret、owner 身份或内部拓扑。
