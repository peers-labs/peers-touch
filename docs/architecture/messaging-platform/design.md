# Messaging Platform — 架构设计

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-08-08 | **Updated**: 2026-08-10
> **Owner**: Messaging Platform Team
> **Module**: `model/domain/chat/`, `apps/station/`, `apps/desktop/`, `apps/mobile/`

---

## 1. 核心原则

| ID | 原则 |
|---|---|
| MP-A01 | Crypto endpoint 永远是 `(PTID, device_id)`；逻辑消息身份永远是共享的 `event_id`，不得按设备复制为多条消息 |
| MP-A02 | Station authority 与 device delivery 是共享事实 |
| MP-A03 | 每个 device 只有一个有 fencing 的有序 inbox consumer |
| MP-A04 | Realtime 只 wake，durable queue 是唯一消费路径 |
| MP-A05 | Device Engine 原子拥有 decrypt、local commit、dedup 和 ACK boundary |
| MP-A06 | 所有网络提交由 durable workers 驱动，不由 UI timer 驱动 |
| MP-A07 | Device registry 是 active/revoked truth，fresh device 使用 fresh sessions |
| MP-A08 | Group 使用 RFC 9420 MLS，每 active device 一个 leaf |
| MP-A09 | accepted、consumed、delivered、read 是不同事实 |
| MP-A10 | 重试、过载、poison、lease、shutdown 都有显式语义 |
| MP-A11 | 大 payload 使用 opaque object plane，不进入 message control frame |
| MP-A12 | Model proto 是跨端唯一 contract root |
| MP-A13 | Authority event 只保存公共事实与 opaque delivery commitments；每个 queue item 只携带当前 endpoint 的私有 payload |
| MP-A14 | 每个相关 active device 都通过自己的 lane 观察完整 authority sequence；sending endpoint 使用无 ciphertext 的 public-event marker |
| MP-A15 | Device enrollment 只有在 Station 验证 actor-cross-signed fresh DSK proof 后才可 ACTIVE |
| MP-A16 | Fresh MLS endpoint 只能以明确添加自己的 Welcome event + hashed post-state snapshot 建立首个 authority checkpoint |

### 1.1 Delivery Commitment Amendment

> **Amendment status**: accepted (`MP-D13`, Owner accepted 2026-08-08)

Evidence ledger：

| Claim | Class | Evidence | Confidence |
|---|---|---|---|
| Canonical `command.proto` and `event.proto` are missing | verified_fact | `model/domain/chat/` source tree | high |
| Current authority event hash covers all Direct device ciphertexts | verified_fact | `hashCommittedEvent` deterministically marshals the complete `CommittedConversationEvent` | high |
| Filtering a current event per recipient breaks authority hash verification | inference | filtered protobuf bytes differ from the committed hash input | high |
| Sending the complete current event exposes other endpoints' ciphertexts | inference | every `DeviceEncryptedPayload` is embedded in the delivered event | high |
| Public delivery commitments plus endpoint-private payloads preserve both properties | accepted_decision | `MP-D13` | accepted |

### 1.2 Portable Messaging Core Amendment

> **Amendment status**: accepted (`MP-D16`, Owner accepted 2026-08-09)

Evidence ledger：

| Claim | Class | Evidence | Confidence |
|---|---|---|---|
| Desktop 已有 Direct、OpenMLS、atomic receive、recovery 和 queue drain Rust implementation | verified_fact | `apps/desktop/src-tauri/src/messaging/` 与 28 个 Messaging tests | high |
| Mobile Rust 仍拥有 Sender Keys，且没有 OpenMLS/Device Messaging Engine | verified_fact | `apps/mobile/src-tauri/src/domain/crypto/sender_keys.rs`、`sender_key_store.rs`、`commands/group_crypto.rs` | high |
| Desktop 与 Mobile 分别维护协议实现会形成第二套 crypto/queue/recovery state machine | inference | 两个独立 Tauri crate 当前没有共享 Messaging Rust dependency | high |
| 一个 portable Rust core 加平台 adapters 让双端执行同一协议与 transaction semantics | accepted_decision | `MP-D16` | accepted |

Proposed boundary：

```text
                    model/domain/chat/*.proto
                               │
                               ▼
                 packages/messaging-core (Rust)
        Direct │ OpenMLS │ Queue FSM │ Recovery │ Projection
                               │
             ┌─────────────────┴─────────────────┐
             ▼                                   ▼
 Desktop Messaging Adapter              Mobile Messaging Adapter
 SQLCipher/keychain/HTTP/lifecycle       SQLCipher/keychain/HTTP/push/lifecycle
```

Portable core 不依赖 Tauri、React/Lynx、platform keychain API、concrete HTTP client 或
平台文件路径。它通过 typed ports 取得 encrypted store transaction、key material、
clock、randomness、queue transport 和 projection sink。Desktop/Mobile adapters 只能实现
这些 ports，不得复制 Direct、OpenMLS、dedup、cursor、ACK、recovery codec 或 receipt
state machine。

## 2. 系统架构

```text
┌──────────────── Client Presentation ────────────────┐
│ Desktop Web / Mobile UI                             │
│ typed intents, drafts, plaintext projections       │
└──────────────────────┬─────────────────────────────┘
                       │ ChatCommand / LocalEvent
┌──────────────────────▼─────────────────────────────┐
│ Device Messaging Engine                            │
│                                                    │
│ Identity │ Direct Crypto │ MLS │ Inbox │ Outbox    │
│ Receipt  │ Recovery      │ Search │ Attachment     │
│                                                    │
│ one process owner + SQLCipher transaction boundary │
└───────────────┬───────────────────────┬────────────┘
                │ HTTPS commands        │ SSE/push wake
┌───────────────▼───────────────────────▼────────────┐
│ Station Messaging Platform                         │
│                                                    │
│ Conversation Authority │ Device Queue Service      │
│ Federation Transport   │ Device/Key Directory      │
│ Backup Repository      │ Object Metadata           │
└───────────────┬────────────────────────────────────┘
                │ signed durable federation frames
                ▼
          Remote Home/Authority Stations
```

## 3. Sources Of Truth

| Concern | Source of truth | 禁止 owner |
|---|---|---|
| Conversation/membership/sequence | Conversation Authority | UI、device cache |
| Active/revoked devices | Device Directory | crypto store |
| Public bundles/key packages | Key Directory | page lifecycle |
| Device lane sequence/items | Device Queue Service | SSE connection |
| Federation delivery | Federation outbox/inbox | request goroutine memory |
| Direct ratchet/skipped keys | Device SQLCipher | Station、TypeScript |
| MLS private state | Device SQLCipher/OpenMLS | Station、UI |
| Plaintext history/search | Device SQLCipher | Station |
| Device consumption dedup | Device SQLCipher | frontend `Set` |
| Recovery revisions | Station opaque repository | localStorage |
| Draft/selection/scroll | UI | Station |

## 4. Runtime Units

### 4.1 Device Messaging Engine

单一长生命周期 owner，Desktop 落在 Rust runtime，Mobile 使用相同 domain contract
与平台 Rust/native adapter。它负责：

- identity/device enrollment 和 trust；
- Direct X3DH/Double Ratchet；
- OpenMLS state 与 transitions；
- durable command/outbox workers；
- single ordered inbox worker；
- SQLCipher plaintext projections、search 和 consumption markers；
- receipt/read cursor 提交；
- backup/restore codec；
- typed local events。

它不得：

- 渲染 UI；
- 自行改变 Station membership/device truth；
- 通过 browser event handlers 执行协议；
- 把 private state 传给 Web runtime。

### 4.2 Conversation Authority

负责 command admission、membership/role、monotonic conversation sequence、event hash
chain、idempotent command receipt 和 fan-out intent。一个 command commit 与所有目标
device queue rows 必须在一个 Station unit of work 中完成。

### 4.3 Device Queue Service

每个 `(PTID, device_id)` 维护独立 lane：

- 原子分配 `lane_sequence`；
- at-least-once delivery；
- claim lease 与 consumer epoch fencing；
- retry/backoff、expiry、dead-letter；
- consumption ACK ownership validation；
- bounded resume batches；
- SSE/push wake-up。

Queue 不解析 ciphertext 或决定业务权限。

### 4.4 Federation Transport

以 `(source_station, target_station, idempotency_key)` 提供 durable forwarding。
Dispatcher 使用 lease/`SKIP LOCKED` claim；目标 Station 幂等写入 authority inbox 或
device lanes。网络失败不改变 authority event identity。

> **Routing amendment status**: accepted (`MP-D19`)

`CryptoEndpoint`不包含Home Station。跨Station prepare必须消费Home Station签名的短TTL
endpoint manifest：

```text
FederatedEndpointManifest
  = actor + home_station + directory_version
  + active endpoints + public material hashes
  + issued/expiry + Home Station signature
```

Authority plan绑定manifest及endpoint routes。Authority commit将delivery按Home Station
分区：

```text
local endpoints  -> local device queues
remote endpoints -> per-Home-Station FederatedDeviceQueueBatch
                 -> durable federation outbox
```

authority event、全部local queue rows、全部remote outbox rows和command receipt必须在
同一database transaction提交。Target Home Station验证frame后原子写inbox与local
device lanes，并再次过滤已revoked endpoint。network dispatcher不得成为event或queue
truth owner。

非authority Station上的client command通过durable `AUTHORITY_COMMAND` frame转发；
authority result不直接推进device authority head，ordered queue marker仍是唯一推进路径。

## 5. Canonical Command And Event Contracts

```protobuf
message ChatCommand {
  string command_id = 1;
  string conversation_id = 2;
  CryptoEndpoint sender = 3;
  int64 observed_membership_epoch = 4;
  oneof payload {
    SendMessage send_message = 10;
    EditMessage edit_message = 11;
    RetractMessage retract_message = 12;
    MembershipTransition membership_transition = 13;
    Reaction reaction = 14;
  }
}

message ConversationEvent {
  string event_id = 1;
  string conversation_id = 2;
  int64 sequence = 3;
  bytes previous_hash = 4;
  bytes event_hash = 5;
  repeated bytes delivery_commitments = 6;
  oneof payload { /* committed facts */ }
}

message DeviceEventDelivery {
  ConversationEvent event = 1;
  CryptoEndpoint recipient = 2;
  QueuePayloadType payload_type = 3;
  bytes endpoint_payload = 4;
  bytes endpoint_payload_sha256 = 5;
  bytes delivery_commitment = 6;
}

message DeviceQueueItem {
  string item_id = 1;
  int64 lane_sequence = 3;
  string idempotency_key = 4;
  string event_id = 4;
  string idempotency_key = 5;
  QueuePayloadType payload_type = 6;
  bytes opaque_payload = 7;
  bytes payload_sha256 = 8;
```

Direct event 含每目标 device 独立 ciphertext。Group event 含一个 MLS application
`ConversationEvent.delivery_commitments` 按 bytewise ascending 排序，并进入 authority
event hash。每个 commitment 是以下 canonical input 的 SHA-256：

```text
ASCII("peers-touch/device-delivery-commitment") + 0x00
+ uint32_be(schema_version = 1)
+ uint32_be(len(conversation_id)) + UTF8(conversation_id)
+ uint32_be(len(event_id)) + UTF8(event_id)
+ uint32_be(len(recipient_ptid)) + UTF8(recipient_ptid)
+ uint32_be(len(recipient_device_id)) + UTF8(recipient_device_id)
+ uint32_be(payload_type)
+ endpoint_payload_sha256[32]
```

event 不携带 endpoint、Direct ciphertext 或 MLS application ciphertext。Queue 的
`opaque_payload` 是 deterministic `DeviceEventDelivery` bytes；queue
`payload_sha256` 绑定完整 delivery bytes。Direct 每个 endpoint 有独立 ciphertext；
Group 每个 active MLS leaf 有独立 commitment，可引用同一个 MLS application
ciphertext hash。

Device Engine 必须依次验证：

1. authority event hash 和 previous hash；
2. queue recipient 等于 local endpoint；
3. `SHA-256(endpoint_payload)` 等于 `endpoint_payload_sha256`；
4. recomputed commitment 存在于 event 的 sorted commitments；
5. `SHA-256(DeviceEventDelivery bytes)` 等于 queue `payload_sha256`。
多设备 fan-out 必须保持两层身份：


```text
Logical message: (conversation_id, event_id, sequence)
  -> Device delivery: (recipient endpoint, lane_sequence, ciphertext)
  -> Device projection: upsert by (conversation_id, event_id)
```

同一用户的不同设备接收独立 ciphertext 和 queue item，但解密后以同一 `event_id`
投影为同一条消息。发送者的其他 active devices 通过 sender-sync delivery 得到相同
逻辑消息。设备在 event commit 后才加入时，不追补 live queue ciphertext；历史由
Recovery 恢复，未来消息从该设备 activation sequence 开始 fan-out。

## 6. End-To-End Send

```text
UI intent
  -> Engine persists command intent
  -> resolve active endpoints / authority head
  -> prepare Direct fan-out or MLS ciphertext
  -> SQLCipher: crypto advance + exact command + outbox
  -> worker submits command
  -> Authority: validate + event + device queue fan-out (atomic)
  -> result updates durable command submission state
  -> sending endpoint consumes ordered public-event marker
  -> Engine atomically promotes pending sender projection and authority head
  -> UI receives accepted state
```

失败时 exact command bytes 重放，不重新加密或再次推进 ratchet。

### 6.1 Sending Endpoint Ordering Amendment

> **Amendment status**: accepted (`MP-D14`)

Command response 与 device queue 是两个独立到达路径。若 response 直接推进 sender
authority head，它可能越过先提交但尚未 drain 的 event；若不推进 head，后续 queue
event 的 `previous_hash` 又无法验证。

因此每个 committed event 必须为 sending endpoint 生成一个
`PREPARED_ENDPOINT_PAYLOAD_KIND_PUBLIC_EVENT` queue item。该 item：

- 携带 public authority event 和 endpoint-bound commitment；
- 不携带 Direct ciphertext、MLS application ciphertext 或 plaintext；
- 在本地 transaction 中将 pending sender projection 升级为 committed；
- 与普通 receive 共用 marker、cursor、authority head 和 post-commit ACK；
- command response 只改变 command/outbox submission state，不写 authority head。

### 6.2 Send-Preparation Snapshot Amendment

> **Amendment status**: accepted (`MP-D17`)

Engine不得从本地 session缓存猜测 required fan-out。Station必须通过 authenticated
send-preparation snapshot返回 authority head、membership/MLS epoch和当前 required
active endpoints，并对这些字段生成 deterministic `delivery_plan_sha256`。

`ChatCommand`绑定该 hash。Authority在 event/queue transaction内重算；任何
activation/revoke/membership变化导致 typed `STALE_DELIVERY_PLAN`且零 authority
mutation。Engine保留 logical draft与`message_id`，supersede旧 command attempt，并从
已持久化的下一 ratchet/MLS state重新准备；禁止 rollback或重放 stale ciphertext。

### 6.3 MLS Authority Plan Amendment

> **Amendment status**: accepted (`MP-D18`)

Group genesis和membership transition不能复用只描述当前recipient set的send plan。
Station必须提供两种短TTL authority plan：

```text
PrepareGroupGenesis
  intent(group_id, name, owner, member actors)
  -> plan_id, expires_at, prospective_endpoints[],
     reserved_key_packages[], authority_plan_sha256

PrepareMembershipTransition
  intent(conversation_id, sender, action, target actor/device, role)
  -> plan_id, expires_at, authority head, source epochs,
     pre_endpoints[], post_endpoints[], added_endpoints[],
     removed_endpoints[], reserved_key_packages[],
     authority_plan_sha256
```

plan是不可见control-plane reservation，不是conversation truth，不冻结device set。
提交时Authority重新锁定并验证conversation、membership和device rows；snapshot变化或
expiry返回typed stale/expired result且零shared mutation。

Genesis只有在OpenMLS command提交成功时才原子创建conversation-created event、
epoch `0→1` transition、actor/device membership rows和全部device queue items。
prepare失败或reservation expiry不会产生可见conversation。

后续transition在一个Station transaction中完成event、membership mutation、epoch
advance、queue fan-out、KeyPackage consume和command receipt。payload矩阵：

| Endpoint class | Delivery |
|---|---|
| surviving sender | ordered `PUBLIC_EVENT` marker |
| surviving existing non-sender leaf | wrapped `MLS_COMMIT` |
| newly added leaf | wrapped `MLS_WELCOME` |
| voluntarily leaving sender | ordered public removal marker |
| removed actor endpoint | keyless typed removal-state fact |
| already revoked device | no new queue item |

Engine只接受logical membership intent。它持久化intent、exact attempt bytes和pending
OpenMLS state；authority stale时discard尚未merge的pending commit并生成新attempt。
UI不得读取epoch、枚举devices、claim KeyPackage、组装transition或accept MLS state。

## 7. End-To-End Receive

```text
SSE/push wake
  -> Engine claims next lane sequence
  -> validate recipient, sequence, event binding
  -> process DKX / MLS transition / message / receipt
  -> SQLCipher transaction:
       crypto state
       skipped keys
       plaintext/attachment metadata
       consumption marker
       local cursor
  -> commit
  -> ACK(item_id, endpoint, lane_sequence, consumer_epoch)
  -> publish LocalProjectionEvent
  -> UI renders durable plaintext
```

若本地 transaction 未 commit，Station item 保持 unacked，lane 停在该 sequence。

## 8. Ordering And Dependencies

- Authority sequence 负责 conversation fact ordering。
- Device lane sequence 负责该设备 transport/dependency ordering。
- DKX、MLS transition 和依赖消息必须进入同一 device lane。
- 一个 lane 不允许越过未消费 item。
- Independent devices、conversations 和 federation targets 可并行。
- Typing/call signaling 使用独立 ephemeral channel，不得阻塞 durable lane。

## 9. Delivery And Receipt Semantics

| 事实 | 定义 |
|---|---|
| persisted | Station 已原子写入 event/queue |
| notified | SSE/push wake 已尝试 |
| consumed | device local transaction 已 commit |
| delivered | 至少一个 required recipient device consumed |
| fully_delivered | command 声明的 required devices 均 consumed/revoked |
| read | recipient actor read cursor 越过 event sequence |

服务端 `notified` 不得映射为 delivered。

## 10. Failure, Retry, And Overload

- Claim lease 超时：item 回到 pending，由 consumer epoch 防止旧 consumer ACK。
- Retryable dependency：lane 保持，指数 backoff，wake 可提前触发。
- Corrupt payload：进入 dead-letter/diagnostic，禁止静默 ACK。
- Queue full：command admission fail closed，sender durable draft/outbox 保留。
- Storage locked/full：receiver 不 ACK；UI 显示 actionable state。
- Duplicate：consumption marker/readback 后 ACK，不推进 crypto。
- Shutdown：停止 admission，等待 in-flight local transaction，释放 lease。
- Station failover：authority/queue operations 依赖数据库 transaction 和 fencing。

## 11. Multi-Device And Recovery

- Direct session key包含 conversation、本地 endpoint、对端 endpoint 和 generation。
- required fan-out 包含全部 active recipient devices 和发送者其他 active devices。
- revoke 与后续 fan-out selection 在 Station transaction boundary 上有序。
- MLS membership transition 对 actor/device leaf 明确建模。
- Membership transition event携带进入event hash的完整公共post-state snapshot。
- Fresh MLS endpoint不接收加入前event replay。只有本地无该conversation任何
  head/session/projection/marker，且Welcome、ADD change、snapshot和当前endpoint完全
  绑定时，Engine才可将join event原子安装为首个authority checkpoint。
- Removed MLS endpoint接收typed retirement payload，在同一个local transaction中删除
  live MLS state、记录retired checkpoint、推进authority head/cursor/marker并写receipt。
- 同一有效endpoint重新加入时，Welcome只有与本地retired checkpoint、ADD change和
  post-state完整绑定，才可跨缺席sequence原子替换MLS state并建立rejoin checkpoint；
  缺席期间events/plaintext不补发。
- Join checkpoint之后恢复普通严格连续sequence规则；其他gap进入
  `waiting-for-epoch`且不得ACK。
- Recovery 恢复 actor identity/history/trust，排除 SPK/OPK、ratchet、MLS live state。
- fresh install 完成 restore 后才 enroll fresh device，随后重建 sessions/leaves。
- Restore为每个conversation写one-shot `recovery_ready`；只有当前fresh endpoint的
  ADD Welcome可在无head/session/marker时原子安装current checkpoint并清除该状态，
  同时保留archive中的合法旧history。

## 12. Attachments And Search

> `MP-D23`–`MP-D25` amendment status: accepted (Owner accepted 2026-08-10).

### 12.0 Evidence Ledger

| Claim | Class | Evidence | Missing proof |
|---|---|---|---|
| AES-GCM fixed-size chunk encryption and whole plaintext/ciphertext hashes exist | verified_fact | Desktop `oss.rs` and `client-media-security` | cross-language canonical vectors |
| Generic OSS persists opaque bytes and storage backends expose byte-range ports | verified_fact | Station OSS service/storage interfaces | HTTP Range route parity |
| Canonical send/event proto already references `EncryptedObjectDescriptor` | verified_fact | `attachment.proto`, `command.proto`, `event.proto` | runtime validation and projection |
| Current upload/download is whole-file and Messaging Engine never persists attachment metadata | verified_fact | Desktop OSS/cache and Messaging send/store paths | none |
| Current chat object ACL depends on legacy friend-chat state | verified_fact | Station OSS permission adapter | none |
| Authority-hosted object sessions eliminate duplicate ACL truth | accepted_decision | MP-D23 | native cross-Station gate |
| Per-chunk commitments are sufficient for bounded resumable integrity | accepted_decision | MP-D24 | known-answer, conflict and corruption gates |
| SQLCipher FTS can remain atomic with message/attachment projection | accepted_decision | MP-D25 | crash/restore and query gates |

### 12.1 Ownership And Topology

- Conversation Authority Station 拥有 attachment transfer session、opaque object、
  committed event grant 和 retention；generic OSS 只作为其 byte-store adapter。
- Device Messaging Engine 拥有 plaintext、filename、object key、base nonce、chunk
  crypto、transfer checkpoint、local decrypted cache 和 SQLCipher projection。
- Home Station 只做代理：验证本地 actor session，把远端 upload/download stream 转为
  signed federation data-plane request；不得缓存 key 或 plaintext。
- command/event 只携带 Station-visible `EncryptedObjectDescriptor`。`object_key`、
  `base_nonce`、filename 和 plaintext hash 只存在于 Direct/OpenMLS encrypted
  `MessagePrivateContent` 与 recovery archive。

```text
UI typed intent
  -> Engine encrypts chunks + persists checkpoint
  -> Home Station proxy (when remote)
  -> Authority attachment transfer session
  -> opaque OSS byte store
  -> Authority validates descriptor and atomically grants object with message event
  -> recipient Home proxy
  -> recipient Engine range-resumes, verifies, decrypts and atomically promotes cache
```

### 12.2 Upload Contract

- `begin` 绑定 `(conversation_id, message_id, attachment_id, uploader endpoint,
  descriptor commitment)`，返回 `upload_id`、part size、expiry 和已提交 part bitmap。
- part identity 为 `(upload_id, chunk_index)`。相同 bytes/hash 重放成功；相同 index
  不同 hash 返回 conflict，禁止覆盖。
- 每 part 同时验证 offset、ciphertext size 和 chunk SHA-256。`complete` 只有在全部
  chunks 到齐、whole ciphertext size/hash 匹配时成功，并返回 immutable descriptor。
- 完成前 object 只对 uploader 可见；message authority transaction 成功后，object 与
  `event_id` 和 committed recipient PTIDs 原子绑定。未引用 object 按 bounded orphan
  TTL 回收。
- upload session、part count、part size、总 bytes、并发数和 expiry 都有硬上限；
  overload 返回 typed retry policy，不接收无界临时数据。

### 12.3 Download Contract

- 下载授权基于 message commit 时固化的 recipient PTID grant，不基于“当前仍在群里”。
  因此被移除成员可继续读取其已接收历史附件，但不能读取移除后的 object。
- remote download 经 recipient Home Station 使用 signed federation request 代理到
  Authority Station；data bytes 不进入 durable messaging federation outbox。
- object immutable ETag 等于 descriptor whole ciphertext hash。客户端使用
  `Range + If-Match` 按 ciphertext chunk 拉取；合法范围返回 `206`，越界返回 `416`，
  descriptor/ETag 变化 fail closed。
- Engine 只在每个 chunk hash、whole ciphertext hash、AEAD tag、whole plaintext hash
  全部通过后，把 `.part` 原子提升为可见 cache。失败保留可重试 checkpoint，不暴露
  partial plaintext。

### 12.4 Local Projection And Search

- sender 在 durable draft transaction 中持久化 attachment metadata 与 upload
  checkpoint；command prepare 只消费 `complete` descriptor。
- receiver 在 message receive transaction 中原子写 plaintext、attachment metadata、
  FTS row、consumption marker、lane cursor 和 receipt outbox；任一失败不 ACK。
- FTS 与 plaintext 同属 SQLCipher，索引 text 与 filename，不索引 object key、nonce、
  ciphertext URL 或 transfer token。restore 从 validated archive 重建 FTS。
- transfer checkpoint 和 decrypted cache 不进入 recovery；descriptor、private metadata、
  plaintext hash 和 trust 进入 recovery。fresh device 按需重新下载 ciphertext。

### 12.5 Forbidden Relationships

- UI 直接生成 attachment key、提交 part、判断 hash success 或维护 resume cursor。
- generic OSS 根据 legacy friend/group tables 判定 canonical Messaging authorization。
- Home Station 或 Authority Station 记录 filename、plaintext hash、key、nonce 或
  decrypted bytes。
- whole-file fetch 后才声称“resumable”、直接写 final cache、hash mismatch 后继续解密。
- command commit 引用未 complete、非本 conversation、非本 uploader 的 object。

### 12.6 Bounded Policy And Evidence

默认 policy：

- attachment plaintext 单文件不超过 2 GiB；每消息不超过 10 个、合计不超过 2 GiB；
- AES-256-GCM fixed chunk 为 1 MiB、tag 16 bytes、最大 2048 chunks；
- 每 actor 同时不超过 4 个 active transfer sessions，每 session 同时不超过 4 parts；
- incomplete upload 和 unattached complete object TTL 为 24 hours；
- retry 使用 jittered exponential backoff，1 second 起、5 minutes 封顶；terminal
  integrity/auth errors 不重试；
- Engine transfer memory 上限为 `2 * chunk_size + 16 MiB`，禁止 whole-file buffering。

Architecture gate 除 MP-G13/MP-G14 外还必须证明：

- 100 MiB object 在 25%/50%/75% upload 与 download interruption 后只传 missing chunks；
- duplicate part exact replay、conflicting part、wrong ETag/range、whole/chunk hash、AEAD
  和 plaintext hash 分别有 terminal evidence；
- local LAN profile 的 resumed first-byte P95 小于 2 seconds，统计至少 30 次；网络吞吐不
  作为实现正确性门，但必须报告 P50/P95；
- slow recipient、cancel、Station restart 和 client `SIGKILL` 下 memory/session/part
  admission 保持 bounded；
- native high-chat/group-chat 记录 exact source/output SHA-256、message/event/object IDs、
  transfer bitmap、Station grants 和 receiver-visible result。

### 12.7 APIs And Typed Errors

Control metadata 使用 protobuf；chunk body 使用 bounded `application/octet-stream`：

```text
POST /messaging/attachments/uploads:begin
GET  /messaging/attachments/uploads/{upload_id}
PUT  /messaging/attachments/uploads/{upload_id}/chunks/{chunk_index}
POST /messaging/attachments/uploads/{upload_id}:complete
POST /messaging/attachments/uploads/{upload_id}:cancel
GET  /messaging/attachments/objects/{object_id}
```

Chunk PUT headers 绑定 `Content-Range`、`Digest: sha-256`、upload generation 和
idempotency key；download GET 使用 `Range`、`If-Match`。Home Station proxy 不改变这些
字段，只附加 peer JWT、caller PTID assertion、target Authority Station 和 request
signature。

Typed errors 至少包含：

```text
ATTACHMENT_UPLOAD_EXPIRED
ATTACHMENT_PART_CONFLICT
ATTACHMENT_RANGE_INVALID
ATTACHMENT_DESCRIPTOR_MISMATCH
ATTACHMENT_INTEGRITY_FAILED
ATTACHMENT_NOT_GRANTED
ATTACHMENT_QUOTA_EXCEEDED
ATTACHMENT_RETRY_LATER(retry_after)
```

client cancel 终止当前 stream，但不自动 cancel durable session；只有显式 user cancel
或 expiry 才进入 `ABORTED`。Process shutdown 停止新 part admission，已完成 checkpoint
保留给下次启动。

## 13. Forbidden Relationships

- UI → DKX/ratchet/MLS/queue ACK。
- SSE payload → async browser business handlers。
- frontend `localStorage` → command/outbox/cursor/device identity truth。
- Station → plaintext/private key/recovery phrase。
- authority event → endpoint-private ciphertext 或可枚举 device identity。
- device queue item → 其他 endpoint 的 ciphertext。
- ACK before local durable consumption。
- ratchet advance 与 plaintext persistence 分离。
- actor-wide crypto endpoint。
- group Sender Keys/Megolm/fully-connected member fan-out。
- permanent compatibility runtime、dual source、fallback transport。
- fixed sleep、page refresh 或 polling 作为 correctness。

## 14. Architecture Gates

架构完成只由 `acceptance-matrix.md` 的 MP-G01 至 MP-G14 证明。所有 native claim
必须记录 runtime profile、commit/digest、device IDs、Station rows、Engine transaction
evidence 和 exact UI plaintext。
