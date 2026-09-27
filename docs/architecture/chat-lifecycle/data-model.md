# Chat Lifecycle - 数据模型

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-22 | **Updated**: 2026-09-22
> **Owner**: Chat Product Team
> **Module**: `model/domain/chat/`, `model/domain/realtime/`, `packages/messaging-core/`

---

## 1. 文档范围

本文定义 CCU 需要统一的跨端类型层级、投影失效通知、状态映射和多设备通话仲裁记录。
完整 Conversation、Device Messaging Engine、MLS、receipt 与 attachment schema 仍以
`docs/architecture/messaging-platform/data-model.md` 和 canonical Proto 为真源。

## 2. 类型真源层级

```text
model/domain/chat + model/domain/realtime
  -> generated Go / Rust / TypeScript bindings
  -> packages/messaging-core local state machine
  -> Desktop / Mobile typed projection adapters
  -> UI-visible state
```

- 跨进程字段、枚举和错误码只在 Proto 定义。
- Messaging Core 拥有本地 durable command、delivery、projection、cursor 和 recovery
  状态机。
- Desktop 与 Mobile adapter 只能映射 canonical 状态，不得重新定义 Friend、Group、
  Message 或 CommandStatus 业务模型。
- 未知枚举、版本不兼容和 unsupported command 必须 fail closed。

## 3. Command 与可见状态映射

| Canonical layer and observation | UI state |
|---|---|
| local draft | `draft` |
| `LOCAL_QUEUED` / local `pending` | `queued` |
| command submission `HOME_ACCEPTED` / `SUBMITTED`; message delivery `SUBMITTED` | `submitting` |
| command submission `RETRY_WAIT`; resolution `HOME_PENDING` / `NOT_FOUND` | `retrying` |
| command submission/resolution `ACCEPTED`; message delivery `COMMITTED` / `HOME_DELIVERED` | `accepted` |
| message delivery `DEVICE_DELIVERED` | `delivered` |
| message delivery `READ` / actor read cursor covers message | `read` |
| submission/resolution `TERMINAL_REJECTED`; message delivery `FAILED`; local `failed` / `superseded` / `attachment_failed` | `failed_actionable` |

`prepared` 仅表示内存中的 command 构造步骤；`terminal` 仅表示结果类别。两者都不是
独立用户可见状态。所有 `UNSPECIFIED` 与未知 enum 均拒绝写入 projection 并以 typed
degraded/error 状态 fail closed。

## 4. Projection Invalidation

跨端 projection notification 是失效提示，不携带第二份业务真相。CCU-D02 的目标
canonical contract 是
`peers_touch.model.chat.v1.MessagingProjectionInvalidation`，必须由
`model/domain/chat/event.proto` 定义：

```protobuf
message MessagingProjectionInvalidation {
  uint32 schema_version = 1;       // current: 1
  string actor_ptid = 2;
  string home_station_peer_id = 3;
  string device_id = 4;
  string conversation_id = 5;
  string event_id = 6;
  int64 lane_sequence = 7;
  MessagingProjectionKind kind = 8;
}

enum MessagingProjectionKind {
  MESSAGING_PROJECTION_KIND_UNSPECIFIED = 0;
  MESSAGING_PROJECTION_KIND_CONVERSATION = 1;
  MESSAGING_PROJECTION_KIND_MESSAGE = 2;
  MESSAGING_PROJECTION_KIND_RECEIPT = 3;
  MESSAGING_PROJECTION_KIND_TYPING = 4;
  MESSAGING_PROJECTION_KIND_MEMBERSHIP = 5;
  MESSAGING_PROJECTION_KIND_SETTINGS = 6;
  MESSAGING_PROJECTION_KIND_ATTACHMENT = 7;
  MESSAGING_PROJECTION_KIND_RESYNC = 8;
}
```

Desktop/Mobile adapter 将 canonical notification 包装到本地
`profile_id + activation_generation` scope。`event_id` 是幂等键；
`lane_sequence` 对 endpoint lane 单调递增。重复事件 no-op；gap、未知
`ProjectionKind` 或可恢复版本差异触发 full reconcile；不支持的
`schema_version` 返回 typed `PROJECTION_VERSION_UNSUPPORTED` 并保持旧 projection，
不得猜测更新。

任何 identity 字段不匹配当前 active scope，或 generation 已失效的事件、timer、
queued callback 与异步 readback 都必须丢弃。Runtime 随后通过 canonical projection
readback 修复可能遗漏的事件。

## 5. Call Resolution Record

```text
CallResolution {
  state                   // OPEN | ACCEPTED | REJECTED | NO_ANSWER
  caller_actor_ptid
  callee_actor_ptid
  session_ulid            // varchar(512), 容纳两个 255-byte PTID 与分隔符
  call_id
  request_sha256
  winning_device_id
  terminal_action       // accept | reject
  ring_deadline_unix_ms
  resolved_at_unix_ms
  expires_at_unix_ms
}

UNIQUE(callee_actor_ptid, call_id)
```

语义：

1. `call_id` 是 caller 生成的 ULID；Home Station 只接受不早于当前时间 30 秒且不晚于
   当前时间 10 秒的 ULID 时间部分。CALL_REQUEST 绑定 caller/callee/session 和请求
   digest，原子创建 `OPEN` record，`ring_deadline = issued_at + 45s`。
2. Callee Home Station 在一个数据库事务内执行 compare-and-set。
3. 首个合法 accept/reject 提交终态；winner 的重复请求返回同一结果。
4. 其他 endpoint 的竞争请求返回 `CALL_ALREADY_HANDLED` 和已提交终态。
5. 到达 ring deadline 且仍为 `OPEN` 时原子提交 `NO_ANSWER`。
6. 终态记录至少保留至 `ring_deadline + 10m`，严格长于 admission window 与最大
   clock skew。
7. Station restart、durable CAS 暂不可用或 replica failover 均 fail closed；未提交
   唯一终态前不得允许媒体建立。
8. TTL 清理只删除过期记录；旧 ULID 的时间窗口已关闭，因此不能重新创建 open
   record。重试必须生成新的 `call_id`。
9. conflicting duplicate CALL_REQUEST、caller/callee/session/digest mismatch、future/
   malformed ULID、revoked endpoint 和 deadline 后 action 均返回 typed rejection。
10. 记录不包含 SDP、ICE、media key、sealed signaling plaintext 或媒体状态。
11. `session_ulid` 必须完整保存 canonical signaling session identity；当前 Direct
    形式由两个最长 255-byte PTID 与一个分隔符组成，因此持久化宽度不得小于 511
    bytes，禁止截断、hash 替代或仅在内存中保留原值。

## 6. Identity 与隐私

- Actor identity 统一使用 `ptid`；`actor_id` 不跨进程。
- Endpoint 使用当前 Actor Directory 验证的 `device_id`。
- Home Station 路由 metadata 与 crypto endpoint identity 分离。
- Station 只持有业务路由和短时仲裁信息；private content 与媒体仍由端侧 owner 持有。
