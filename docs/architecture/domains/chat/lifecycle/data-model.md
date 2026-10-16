# Chat Lifecycle - 数据模型

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-22 | **Updated**: 2026-10-16
> **Owner**: Chat Product Team
> **Module**: `model/domain/chat/`, `model/domain/realtime/`, `packages/messaging-core/`

---

## 1. 文档范围

本文定义 CCU 需要统一的跨端类型层级、投影失效通知、状态映射和多设备通话仲裁记录。
完整 Conversation、Device Messaging Engine、MLS、receipt 与 attachment schema 仍以
`docs/architecture/domains/chat/messaging/data-model.md` 和 canonical Proto 为真源。

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

## 7. Group Admission Policy

```protobuf
enum GroupAdmissionMode {
  GROUP_ADMISSION_MODE_UNSPECIFIED = 0;
  GROUP_ADMISSION_MODE_FRIENDS_DIRECT_ADD = 1;
  GROUP_ADMISSION_MODE_FRIENDS_REQUIRE_CONFIRMATION = 2;
}

message GroupAdmissionPreference {
  string actor_ptid = 1;
  GroupAdmissionMode mode = 2;
  uint64 revision = 3;
  google.protobuf.Timestamp updated_at = 4;
}

message RejectedGroup {
  string conversation_id = 1;
  string federation_id = 2;
  string authority_station_peer_id = 3;
  string group_name_snapshot = 4;
  uint64 policy_revision = 5;
  google.protobuf.Timestamp rejected_at = 6;
}
```

Home Station 为每个 actor 保存一条 preference 和零到多条 rejected-group
记录。默认值是 `FRIENDS_DIRECT_ADD`，初始 revision 为 1。所有更新携带
`observed_revision`；冲突返回当前 snapshot，不做 last-write-wins。

拒绝项身份绑定
`(actor_ptid, conversation_id, federation_id, authority_station_peer_id)`。
显示名只是快照，不参与鉴权。移除拒绝项只增加 policy revision，不恢复成员资格。

## 8. Group Invitation

```protobuf
enum GroupInvitationState {
  GROUP_INVITATION_STATE_UNSPECIFIED = 0;
  GROUP_INVITATION_STATE_PENDING = 1;
  GROUP_INVITATION_STATE_ACCEPTED_WAITING_FOR_MLS = 2;
  GROUP_INVITATION_STATE_JOINED = 3;
  GROUP_INVITATION_STATE_DECLINED = 4;
  GROUP_INVITATION_STATE_EXPIRED = 5;
  GROUP_INVITATION_STATE_REVOKED = 6;
}

message GroupInvitation {
  uint32 version = 1;
  string invitation_id = 2;
  string conversation_id = 3;
  string federation_id = 4;
  string authority_station_peer_id = 5;
  int64 authority_epoch = 6;
  string inviter_ptid = 7;
  string invitee_ptid = 8;
  string invitee_home_station_peer_id = 9;
  GroupInvitationState state = 10;
  string group_name_snapshot = 11;
  int64 observed_membership_epoch = 12;
  int64 observed_mls_epoch = 13;
  int64 authority_sequence = 14;
  bytes authority_hash = 15;
  google.protobuf.Timestamp created_at = 16;
  google.protobuf.Timestamp expires_at = 17;
  google.protobuf.Timestamp decided_at = 18;
  string decision_command_id = 19;
  string fulfillment_transition_id = 20;
}
```

Invitee Home Station 持久化 invitation 与 exact decision command/result。唯一活动约束为
`(conversation_id, invitee_ptid)` 上最多一条 `PENDING` 或
`ACCEPTED_WAITING_FOR_MLS`。重复创建返回原 invitation；相同 command 重放返回原
结果；不同 decision 复用 command ID 返回 conflict。

状态转换：

```text
PENDING
  -> ACCEPTED_WAITING_FOR_MLS
  -> DECLINED
  -> EXPIRED
  -> REVOKED

ACCEPTED_WAITING_FOR_MLS
  -> JOINED
  -> EXPIRED
  -> REVOKED
```

`JOINED` 只能在 invitee Home Station 观察到绑定 grant 的 accepted `ADD_ACTOR`
authority transition 后提交。通知已读、删除、客户端本地状态或 acceptance fixture
均不能改变 invitation。

## 9. Admission Grant And Membership Binding

每次准备 Group 创建或 `ADD_ACTOR` 前，Group authority 从 invitee Home Station
取得 source-bound admission result：

```text
DENIED
DIRECT_ADD(grant_id, policy_revision, expires_at)
CONFIRMATION_REQUIRED(invitation_id, policy_revision)
```

grant 绑定：

```text
conversation_id
authority head
inviter/requester endpoint
invitee PTID + Home Station
friendship proof revision
admission policy revision
expiry
```

`PrepareConversationMembershipRequest` 的 `ADD_ACTOR` 必须携带未消费 grant 或已接受
invitation 的 fulfillment identity。该 identity 显式携带
`grant_id + invitation_id + invitee_ptid + invitee_home_station_peer_id +
grant_sha256`，禁止仅凭列表顺序推断被邀请人。Authority plan hash 覆盖该 identity；最终
`MembershipTransitionIntent.authority_plan_sha256` 继续校验完整 MLS transition，
但不承担 invitation 或 preference 语义。

Invitation decision 与 Notification 由 invitee Home Station 在同一 transaction
更新。接受时生成一次性 admission grant；Group authority 只验证并消费 grant，不保存
第二条 invitation row。authority event 回到 invitee Home Station 后，grant 与
invitation 一起转为 consumed/JOINED。

Group genesis 对每个初始目标执行相同 admission。Direct-add 目标可进入 genesis；
confirmation-required 目标只在 group commit 后生成 invitation，不进入 genesis
member/endpoints/MLS Welcome。

## 10. Leave And Reject Saga

`Leave and reject future invitations` 使用 actor Home Station 持久化 saga：

```text
PREPARING
  -> REJECTION_COMMITTED
  -> LEAVE_INTENT_SUBMITTED
  -> COMPLETED

REJECTION_COMMITTED | LEAVE_INTENT_SUBMITTED
  -> LEAVE_RETRY_REQUIRED
```

幂等键是 actor 生成的 `operation_id`。rejection revision、signed leave intent ID
和最终 membership transition ID 均写入 saga。重试不得创建新的拒绝项或逻辑 leave
操作。只有 authority membership projection 显示 actor 已离开后才能进入
`COMPLETED`。
