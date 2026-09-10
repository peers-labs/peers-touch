# Messaging Platform — 数据模型

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-08-08 | **Updated**: 2026-09-05
> **Owner**: Messaging Platform Team

---

Conversation is the sole Chat entry point at `/conversation/*`. Device, Inbox,
Recovery, Key Exchange, and Federation resources are exposed only by their
owners. `messaging_*` Station schemas and request names retained below describe
pre-consolidation implementation evidence unless explicitly identified as
Device Messaging Engine local state.

## 1. Canonical Identifiers

| Identifier | Scope |
|---|---|
| `PTID` | actor identity |
| `device_id` | actor 下唯一 device installation |
| `CryptoEndpoint` | `(PTID, device_id)` |
| `conversation_id` | authority conversation |
| `command_id` | client-generated idempotent intent |
| `event_id` | authority committed fact |
| `sequence` | conversation monotonic sequence |
| `lane_sequence` | recipient device monotonic delivery sequence |
| `item_id` | device queue item |
| `consumer_epoch` | inbox consumer fencing generation |
| `session_generation` | Direct endpoint-pair session generation |
| `mls_epoch` | MLS group cryptographic epoch |
| `attachment_id` | message-local logical attachment identity |
| `object_id` | Authority-owned immutable ciphertext object |
| `upload_id` | resumable upload session |
| `chunk_index` | encrypted object chunk ordinal |

Identity invariant：

- `event_id` 表示一条用户可见逻辑消息或其他 committed fact。
- `item_id` 只表示一次目标设备投递，不得成为 UI message identity。
- 多个 device queue items 可以引用同一 `event_id`。
- 每台设备以 `(conversation_id, event_id)` 幂等写入 projection。
- 同一用户各设备看到的是同一消息，不是相互独立的消息副本。

## 2. Protocol Families

CA-W1 target contract roots:

```text
model/domain/
├── actor/actor.proto                 # Actor Device identity and endpoint manifests
├── chat/
│   ├── attachment.proto
│   ├── command.proto
│   ├── conversation.proto
│   ├── conversation_api.proto
│   ├── direct_crypto.proto
│   ├── endpoint.proto
│   ├── event.proto
│   ├── group_mls.proto
│   ├── queue.proto
│   └── receipt.proto
├── federation/delivery.proto        # domain-neutral durable delivery
├── key_exchange/key_exchange.proto  # Direct and MLS public material
├── recovery/recovery.proto          # opaque encrypted revisions
└── social/relationship.proto        # Friend Request command/event/result
```

Proto 定义跨端语义；Go、Rust、TypeScript 和 Mobile bindings 必须从同一 source 生成。
The older Chat-owned device, recovery, and Federation request families remain
superseded input to the CA-W5 atomic cut and are not target ownership.

### 2.1 Authority Event And Device Delivery

> `MP-D13` amendment status: accepted (Owner accepted 2026-08-08)

```protobuf
message ConversationEvent {
  string event_id = 1;
  string conversation_id = 2;
  int64 sequence = 3;
  bytes previous_hash = 4;
  bytes event_hash = 5;
  repeated bytes delivery_commitments = 6;
  oneof payload { /* public committed facts */ }
}

message DeviceEventDelivery {
  ConversationEvent event = 1;
  CryptoEndpoint recipient = 2;
  QueuePayloadType payload_type = 3;
  bytes endpoint_payload = 4;
  bytes endpoint_payload_sha256 = 5;
  bytes delivery_commitment = 6;
}
```

Authority event 不直接包含 endpoint identity 或 ciphertext。它包含 bytewise-sorted
opaque delivery commitments。每个 queue item 的 `DeviceEventDelivery` 只包含当前
endpoint 的 Direct ciphertext、MLS application payload 或 public-fact marker。

Direct endpoint payload 使用 typed `DirectDeviceCiphertext`。其
`DoubleRatchetCiphertext` 显式携带 wire version、sender ratchet public key、
message counter、previous chain length、nonce 和 AEAD ciphertext；禁止把这些字段拆到
UI JSON 参数或未定义 opaque bytes。AEAD additional data 是 deterministic protobuf
`DirectCiphertextAad`，绑定 command/message/conversation、sender/recipient endpoint、
session ID/generation 和 protocol version。`ciphertext_sha256` 绑定完整 deterministic
`DoubleRatchetCiphertext` bytes。

Commitment 绑定：

```text
domain separator + schema version + conversation_id + event_id
+ recipient endpoint + payload type + SHA-256(endpoint_payload)
```

event hash 绑定完整 commitment set；queue `payload_sha256` 绑定完整 deterministic
`DeviceEventDelivery` bytes。所有整数使用 unsigned big-endian fixed-width encoding，
所有 UTF-8 string 使用 `uint32_be(length) + bytes`，禁止 delimiter-based encoding。

## 3. Station Persistence

### 3.1 Authority

```sql
conversations(
  conversation_id primary key,
  kind, authority_station_id,
  current_sequence, membership_epoch,
  lifecycle_state,
  created_at, updated_at
)

conversation_events(
  event_id primary key,
  conversation_id, sequence,
  command_id, actor_ptid, actor_device_id,
  event_type, opaque_payload,
  previous_hash, event_hash,
  committed_at,
  unique(conversation_id, sequence),
  unique(conversation_id, command_id)
)

conversation_members(
  conversation_id, ptid, home_station_id, role,
  active, joined_sequence, left_sequence,
  primary key(conversation_id, ptid)
)

messaging_event_projection_targets(
  conversation_id, event_id,
  target_home_station_id, entitlement_reason,
  primary key(conversation_id, event_id, target_home_station_id)
)

conversation_member_devices(
  conversation_id, ptid, device_id,
  active, joined_sequence, left_sequence,
  primary key(conversation_id, ptid, device_id)
)

conversation_authority_snapshot(
  conversation_id, kind, name, owner_ptid,
  active_members(ptid, home_station_id, role),
  active_endpoints(ptid, device_id),
  membership_epoch, mls_epoch
)

messaging_authority_plans(
  plan_id primary key,
  plan_kind, conversation_id,
  requester_ptid, requester_device_id,
  intent_bytes, authority_snapshot_bytes,
  authority_plan_sha256,
  state, expires_at, consumed_at,
  unique(conversation_id, authority_plan_sha256)
)

messaging_plan_key_packages(
  plan_id, target_ptid, target_device_id,
  package_id, package_sha256,
  key_package_bytes,
  primary key(plan_id, target_ptid, target_device_id),
  unique(package_id)
)
```

`lifecycle_state`只允许`ACTIVE`、`LEFT`、`DISSOLVED`等已提交共享状态。group genesis
prepare reservation不写`conversations`；它只写短TTL `messaging_authority_plans`。
因此不存在可被list/read的epoch-zero placeholder group。

actor membership和device leaf membership必须独立存储。actor暂时没有active device时仍可
保持group member；每个active MLS leaf则由`conversation_member_devices`精确表达。
不得通过“是否存在leaf”反推actor membership。

`conversation_authority_snapshot`不是独立mutable table或API。它是membership transition
event中的deterministic post-state value，进入event hash。Fresh MLS endpoint以明确添加
自己的Welcome event作为首个checkpoint时，使用该snapshot在同一SQLCipher transaction
初始化conversation/member projection；snapshot之外不得推断或补写共享membership。

`ConversationAuthorityMember` target contract增加verified `home_station_id`。
Authority membership admission从signed actor/endpoint directory绑定该route，持久化到
member row，并把它纳入每个post-transition snapshot hash。Client command不得自行选择
member Home Station。

`ConversationCreatedFact` target contract以
`repeated ConversationAuthorityMember members`替换PTID-only member list。Creation
event和membership `post_state`因此都完整携带`ptid + home_station_id + role`，follower
不得从本地directory猜测缺失字段。Hard cut后PTID-only creation member list必须删除。

`messaging_event_projection_targets`是Authority transaction产生的immutable replay
entitlement ledger。每个event记录当时有权接收public projection的Home Stations；
membership transition使用pre/post Home Station union。它不是membership truth，
不能独立授权，只用于限制event-log replay。

authority plan状态：

```text
PREPARED -> CONSUMED
PREPARED -> EXPIRED
PREPARED -> SUPERSEDED
```

plan不是锁定device set的长期租约。command submit必须重新锁定当前conversation、
membership和actor device rows，并验证plan hash；不一致时plan转`SUPERSEDED`且零event、
membership、epoch或queue mutation。KeyPackage reservation只在成功transition中消费；
expired/superseded plan释放未消费package。

### 3.2 Device Queue

```sql
device_queue_lanes(
  recipient_ptid, recipient_device_id,
  next_sequence, acked_through,
  active_consumer_epoch,
  primary key(recipient_ptid, recipient_device_id)
)

device_queue_items(
  item_id primary key,
  recipient_ptid, recipient_device_id,
  lane_sequence,
  event_id, idempotency_key,
  payload_type, opaque_payload,
  state, attempt_count,
  lease_owner, consumer_epoch, lease_expires_at,
  next_attempt_at, expires_at,
  consumed_at, acked_at, last_error_code,
  unique(recipient_ptid, recipient_device_id, lane_sequence),
  unique(recipient_ptid, recipient_device_id, idempotency_key)
)
```

`conversation_events` 与全部 required `device_queue_items` 必须由同一 Station database
transaction 提交。

包含 PTID、device ID 或其他可变长度 identity tuple 的 queue `idempotency_key`
必须先做 length-prefixed canonical encoding，再存储固定长度 SHA-256 digest。禁止把
完整 identity tuple 直接拼接进 bounded varchar，也禁止截断 identity。

不对应 Authority committed fact 的 synthetic receipt/read queue reference 也必须
使用 length-prefixed canonical tuple 的固定 64 字符 SHA-256 hex 作为 `event_id`。
它只提供 bounded transport correlation，不得伪装或替换真正的 Authority event ID。

### 3.3 Federation

```sql
federation_outbox(
  outbox_id primary key,
  source_station_id,
  target_station_id, idempotency_key,
  frame_bytes, state,
  lease_owner, lease_expires_at,
  attempt_count, next_attempt_at,
  delivered_at, last_error_code,
  unique(target_station_id, idempotency_key)
)

federated_endpoint_manifests(
  actor_ptid, home_station_id,
  directory_version,
  manifest_bytes, manifest_sha256,
  issued_at, expires_at,
  primary key(actor_ptid, home_station_id)
)

federation_inbox(
  source_station_id, idempotency_key,
  frame_id, frame_sha256,
  received_at,
  primary key(source_station_id, idempotency_key)
)

messaging_follower_conversations(
  conversation_id primary key,
  authority_station_id,
  kind, name, owner_ptid,
  current_sequence, current_event_hash,
  membership_epoch, mls_epoch,
  state, updated_at
)

messaging_follower_members(
  conversation_id, ptid,
  home_station_id, role, active,
  joined_sequence, left_sequence,
  primary key(conversation_id, ptid)
)

messaging_follower_event_receipts(
  conversation_id, sequence,
  event_id, event_hash, previous_hash,
  event_kind, applied_at,
  primary key(conversation_id, sequence),
  unique(conversation_id, event_id)
)

messaging_follower_pending_events(
  conversation_id, sequence,
  event_id, event_hash, previous_hash,
  public_event_bytes, expires_at,
  primary key(conversation_id, sequence)
)
```

`ActorEndpointManifest`是routing snapshot，不是crypto identity。manifest必须由
actor Home Station签名并绑定monotonic `directory_version`、active endpoints、public
bundle/KeyPackage hashes和expiry。Authority plan引用manifest hash；过期或version回退
不得用于新command。

一个authority transaction同时写local device queues与remote federation outbox rows。
Target Home Station以`(source_station_id, idempotency_key)`幂等ingest；相同key不同hash
是安全冲突，不得覆盖。

### 3.3.1 Authority-Signed Follower Membership

> `MP-D29` amendment status: accepted (Owner accepted 2026-09-05)

`messaging_follower_*`只保存 Authority 签名的 public event/projection，不保存
endpoint-private payload、Direct ciphertext、MLS bytes、plaintext 或 key material。

Authority transaction除endpoint-specific queue batch外，还为每个受影响actor Home
Station写一个Station-addressed `FOLLOWER_PROJECTION` outbox row。Membership transition
使用pre/post member Home Station union，因此zero-device actor和removed actor的Home
Station仍会收到final projection。

Target Home Station ingest `FOLLOWER_PROJECTION` 时在一个 transaction 中完成：

```text
federation_inbox idempotency row
+ follower event receipt/head/membership mutation
```

Device queue batch保持独立：它可deterministic-unmarshal
`DeviceEventDelivery`外层验证public event binding，但`endpoint_payload`保持opaque。
Matching follower event已apply时，batch仍需写exact local queue rows；future/gapped batch
不写、不ACK，由source保留private payload并retry。Follower replay不生成private payload。

Follower state：

```text
ACTIVE
  -> GAP_WAITING_RESYNC
  -> ACTIVE

ACTIVE | GAP_WAITING_RESYNC
  -> FORK_PROTECTED_READ_ONLY

GAP_WAITING_RESYNC
  -> RESYNC_UNAVAILABLE_READ_ONLY
```

Apply 规则：

1. exact next sequence + previous hash：apply；
2. exact duplicate event/hash：no-op；
3. existing sequence + different event ID/hash、existing event ID + different
   sequence/hash、或exact-next + wrong previous hash：fork-protected；
4. future sequence：只buffer public event，最多128 events或4 MiB，10分钟expiry，并触发
   authority event-log replay；
5. missing base：请求 authority-signed event-log replay，未完成前 membership read
   fail closed；
6. empty follower可从self-contained `ConversationCreatedFact.members`，或明确ADD并在
   `post_state.active_members`包含local actor/Home Station的membership transition建立
   首个checkpoint；frame source/event authority必须等于hashed owner Home Station；
7. `ConversationCreatedFact`初始化成员；membership transition以`post_state`替换成员；
   ordinary event不改变成员。

`FORK_PROTECTED_READ_ONLY`不可自动恢复；只有operator-authorized forensic rebootstrap
可以清除。

Pending public event expiry会删除bytes但保持`GAP_WAITING_RESYNC`，随后使用fresh nonce
重新请求event-log replay。Buffer overflow不写入新event，返回typed retryable
overload；不得丢弃gap后继续推进。

`RESYNC_UNAVAILABLE_READ_ONLY`表示Authority在合法terminal tombstone之前无法提供
co-retained event/grant。该状态不允许自动清空follower head；只能等待Authority恢复，
或由operator依据forensic evidence执行显式purge/rebootstrap。

Authority projection/replay contract：

```text
MessagingFollowerProjection {
  format_version
  authority_station_id
  target_home_station_id
  conversation_event
}

GetMessagingFollowerEventsRequest {
  format_version
  conversation_id
  authority_station_id
  target_home_station_id
  after_sequence
  after_event_hash
  request_nonce
  page_limit
}

MessagingFollowerEventsPage {
  format_version
  authority_station_id
  target_home_station_id
  conversation_id
  request_nonce
  repeated conversation_events
  repeated event_projection_grants
  next_sequence
  has_more
  generated_at
  expires_at
  signing_key_id
  authority_signature
}

MessagingFollowerEventsPageSigningInput {
  format_version
  authority_station_id
  target_home_station_id
  conversation_id
  request_nonce
  after_sequence
  after_event_hash
  events_sha256
  event_projection_grants_sha256
  next_sequence
  has_more
  generated_at
  expires_at
  signing_key_id
}
```

Request 使用 Home-to-Authority peer authentication。Response signature 绑定所有字段；
Target Station必须验证pinned authority identity、target Station、request nonce、
expiry、non-regressing sequence/hash和deterministic event bytes。Replay只能按hash
chain顺序apply原始public events，不能以current-state assertion覆盖现有head，也不能
推进device lane。

Authority对每个returned event必须读取immutable
`messaging_event_projection_targets`并证明requesting Home Station在该event的grant
集合中。Target同样验证page中的grant与自身Station ID；pre-join和post-removal event
不得返回。`event_projection_grants_sha256`绑定ordered
`(event_id, target_home_station_id, entitlement_reason)` tuples；Replay page不能把
member current state扩大为historical entitlement。

Initial `ConversationCreatedFact`只有在frame source、event authority和verified
`owner_ptid` Home Station一致时才能建立authority pin。后续projection/replay必须通过
该pinned Station identity与`auth_peer_keys` continuity；key mismatch进入
fork-protected read-only，不能以response自带key自动替换。

Late-join Welcome在没有existing conversation authority pin时，Target必须先通过signed
Federation Actor locator/profile独立resolve `post_state.owner_ptid`的Home Station。
只有resolved owner Home Station、frame source和event authority三者一致时，才能建立
首个authority pin；event自身携带的owner route不能单独建立信任。

Applied follower receipt只保留event identity/hash/kind/timestamp。完整public event只在
bounded pending buffer中暂存，apply后删除。Follower repository不得复制actor device
identity、endpoint payload或private content。

Authority `ConversationEvent`与对应`messaging_event_projection_targets`必须co-retain：
active conversation生命周期内不得单独GC任一方。Conversation purge前，Authority必须
向所有仍有grant的Home Stations提交并获得signed terminal projection tombstone ACK；
之后才可同时删除event与grant。若event/grant在合法tombstone前不可用，replay返回typed
`FOLLOWER_REPLAY_UNAVAILABLE`，Target进入`RESYNC_UNAVAILABLE_READ_ONLY`，不得清空或
重建membership来伪装恢复。

Canonical membership read：

```text
local authority conversation
  -> messaging authority member row

remote authority conversation
  -> messaging follower member row
```

Legacy `conversation_members`/`conversation_follower_members`不得参与 canonical
Messaging authorization。

### 3.4 Devices And Backups

```sql
actor_identity_keys(
  ptid primary key,
  public_key, fingerprint,
  profile_version,
  created_at, updated_at
)

actor_devices(
  ptid, device_id,
  signing_key_id, public_key,
  profile_version, verification_source,
  revoked, created_at, revoked_at,
  primary key(ptid, device_id)
)

encrypted_backup_revisions(
  revision_id primary key,
  ptid, format_version,
  ciphertext, ciphertext_sha256,
  created_by_device_id, created_at,
  unique(ptid, revision_id)
)
```

Station 不存储 phrase、backup key、plaintext 或 private crypto state。

### 3.5 Device Enrollment Proof

`MessagingDeviceCertificate` 是 deterministic protobuf signing input，绑定：

```text
format_version + PTID + device_id
+ actor_identity_public_key + SHA-256(actor_identity_public_key)
+ device_signing_public_key + SHA-256 key ID
+ observed_profile_version
```

Actor IK 对完整 certificate bytes 生成 `actor_cross_signature`。Station 在一个 Actor
identity transaction 中绑定 JWT PTID、`X-Device-ID` 与 certificate，验证 fingerprint、
signing-key ID、Ed25519 signature、identity continuity 和 monotonic profile version，
写 verified device row 后才返回 `ACTIVE`。

`revoked=false` 不等于 active。只有拥有 non-unspecified verification source 和 32-byte
DSK public key 的 device 才可被 Messaging fan-out/queue authorization 读取。Revoked
device 不可通过重放旧 certificate 复活。

### 3.5 Send-Preparation Snapshot

> **Status**: accepted by `MP-D17`

```text
PrepareConversationCommandRequest {
  conversation_id
  sender: (ptid, device_id)
}

PrepareConversationCommandResponse {
  conversation_kind
  authority_sequence
  authority_hash
  membership_epoch
  mls_epoch
  required_direct_endpoints[]
  delivery_plan_sha256
}
```

`delivery_plan_sha256`对 schema domain、conversation、authority head、epochs和
bytewise-sorted endpoint tuples进行 canonical hash。`ChatCommand`携带该 hash；
Authority在持锁 transaction中重算，不一致时返回`STALE_DELIVERY_PLAN`且不得写
event/queue。

一个 logical pending message可关联多个 command attempts：

```text
pending_message(message_id, conversation_id, plaintext, state)
command_attempt(command_id, message_id, delivery_plan_sha256, state, exact_bytes)
```

stale attempt转`SUPERSEDED`；logical message保持 pending并创建新 attempt。已推进的
ratchet/MLS state不回滚。

### 3.6 Outbound Timeout And Cancellation Boundary

> **Status**: accepted by `MP-D28`

```text
local draft --cancel before prepare--> discarded

local_commands / command_outbox
  pending -> retry_wait -> pending
  pending/retry_wait -> submitted -> committed
  pending/retry_wait -> failed
```

- `cancelled` 不属于 durable command/outbox/interaction intent 状态。
- Station 不持久化 command cancellation tombstone；Model 不定义 pending-command
  cancellation request/response。
- transport timeout 只进入 `retry_wait`，并保留 exact command bytes、logical intent
  和原始 visible content。
- accepted 之后的撤回由新的 `RetractMessage` command 与 Authority event 表达。
- ratchet/MLS state在任何 timeout、retry 或 terminal failure中都不回滚。

## 4. Device SQLCipher Persistence

```sql
device_identity
direct_sessions
direct_skipped_keys
mls_groups
mls_pending_transitions
logical_group_genesis_intents
logical_membership_intents
membership_command_attempts
local_commands
command_outbox
message_projections
attachment_projections
consumption_markers
device_lane_cursors
receipt_outbox
actor_read_cursors
backup_metadata
message_search_fts
```

关键 transaction：

### Send Transaction

```text
crypto advance
+ encrypted command bytes
+ local plaintext projection
+ command_outbox
```

### MLS Transition Prepare Transaction

```text
logical genesis/membership intent
+ exact authority plan snapshot
+ pending OpenMLS transition state
+ exact command attempt bytes
+ command_outbox
```

pending OpenMLS transition在authority marker commit前不得merge为live session。stale或
expired plan只supersede attempt并discard该pending transition；logical intent保留，
随后从fresh plan重新prepare。

### Receive Transaction

```text
crypto advance / transition apply
+ plaintext projection
+ attachment metadata
+ consumption marker(item_id, payload_hash)
+ lane cursor
```

### Restore Transaction

```text
validated replacement database
+ history/index/trust
+ per-conversation recovery_ready marker
```

使用 atomic file replacement；失败时保留原数据库。

`recovery_ready`只能由validated archive staging写入。对应conversation完成fresh-device
ADD Welcome checkpoint时，它与current MLS state、authority head、cursor、consumption
marker和receipt在同一transaction清除；restored message projections不删除。

## 5. Queue State Machine

```text
PENDING
  -> CLAIMED(lease_owner, consumer_epoch, lease_expires_at)
  -> CONSUMED(consumed_at)
  -> ACKED(acked_at)
  -> GC

CLAIMED --lease timeout--> PENDING
PENDING/CLAIMED --retryable--> RETRY_WAIT --> PENDING
PENDING/CLAIMED --terminal--> DEAD_LETTER
```

只有匹配 endpoint、item、lane sequence 和 consumer epoch 的 ACK 可生效。

## 6. Idempotency And Replay

| Boundary | Idempotency key |
|---|---|
| Client command | `(conversation_id, command_id)` |
| Authority event | `event_id` |
| Device queue | `(endpoint, idempotency_key)` |
| Federation | `(target_station, idempotency_key)` |
| Local consumption | `(item_id, payload_hash)` |
| Receipt | `(endpoint, event_id, receipt_kind)` |

重复 receive：

1. consumption marker 存在且 hash 相同：不推进 crypto，重发 ACK。
2. marker 存在但 hash 不同：安全错误，进入 dead-letter/diagnostic。
3. marker 不存在：执行正常 receive transaction。

### 6.1 MLS Endpoint Retirement And Rejoin

```text
ACTIVE
  -- MLS_RETIREMENT(REMOVE_ACTOR|REMOVE_DEVICE) -->
RETIRED(retirement_sequence, retirement_hash, endpoint, epochs)
  -- MLS_WELCOME(ADD_ACTOR|ADD_DEVICE) -->
ACTIVE(new_join_sequence, new_join_hash, new MLS state)
```

`RETIRED` transaction删除live `messaging_mls_groups`和pending transition，但保留
conversation projection与retired checkpoint。Retired endpoint没有发送资格，也不接收
缺席期间device-lane items。

Rejoin transaction要求Welcome的local endpoint、ADD change、post-state和本地retired
checkpoint完全绑定。它原子安装新MLS state、更新projection/authority head、清除retired
checkpoint并提交marker/cursor/receipt。任何普通非连续event、无retired checkpoint的
非fresh Welcome或伪造snapshot均fail closed。

## 7. Retention And Backpressure

- queue batch 和 lease 数量有硬上限；
- per-device pending bytes/items 有 quota；
- durable message 不因普通 TTL 静默删除；
- ephemeral signaling 使用独立短 TTL；
- ACKED items 在审计窗口后 GC；
- dead-letter 保留 redacted metadata，不保留额外 plaintext；
- overload 在 command admission 处 fail closed，并返回 typed retry policy。

## 8. Attachment Transfer And Local Search

> `MP-D23`–`MP-D25` amendment status: accepted (Owner accepted 2026-08-10).

### 8.1 Message Private Content

```protobuf
message MessagePrivateContent {
  uint32 format_version = 1;
  string text = 2;
  repeated AttachmentPlaintextMetadata attachments = 3;
}

message EncryptedObjectDescriptor {
  string object_id = 1;
  string storage_ref = 2;
  uint64 ciphertext_size = 3;
  bytes ciphertext_sha256 = 4;
  string media_type = 5;
  uint32 chunk_size = 6;
  uint32 chunk_count = 7;
  AttachmentEncryptionSuite encryption_suite = 8;
  uint32 tag_size = 9;
  AttachmentNonceStrategy nonce_strategy = 10;
  repeated bytes chunk_ciphertext_sha256 = 11;
}
```

`MessagePrivateContent` 完整 protobuf bytes 才进入 Double Ratchet/OpenMLS。Authority
event 只保存 descriptor；filename、plaintext hash、key、nonce 不可进入 public fact。

Descriptor validation：

- `object_id/storage_ref/media_type` 非空；
- whole hash 和每个 chunk hash 均为 32 bytes；
- `chunk_count > 0` 且等于 chunk hash 数量；
- `chunk_size`、`tag_size`、suite、nonce strategy 属于已注册值；
- `ciphertext_size` 等于各 chunk ciphertext size 之和；
- object 已 complete、属于同 conversation/uploader/message/attachment commitment；
- attachment count、descriptor bytes、chunk count 和 total bytes 不超过 policy。

### 8.2 Upload State

```text
CREATED
  -> RECEIVING_PARTS
  -> VERIFYING
  -> COMPLETE_UNATTACHED
  -> ATTACHED(event_id)

CREATED/RECEIVING_PARTS -- expiry/cancel --> ABORTED
VERIFYING -- missing/hash/size mismatch --> RECEIVING_PARTS | TERMINAL_CORRUPT
COMPLETE_UNATTACHED -- orphan TTL --> GC
```

Authority 持久化：

```text
messaging_attachment_uploads(
  upload_id PK,
  conversation_id,
  message_id,
  attachment_id,
  uploader_ptid,
  uploader_device_id,
  descriptor_commitment,
  expected_ciphertext_size,
  expected_ciphertext_sha256,
  chunk_size,
  chunk_count,
  received_bitmap,
  state,
  expires_at,
  object_id NULL,
  generation
)

messaging_attachment_upload_parts(
  upload_id,
  chunk_index,
  byte_offset,
  ciphertext_size,
  ciphertext_sha256,
  storage_part_ref,
  PRIMARY KEY(upload_id, chunk_index)
)

messaging_attachment_objects(
  object_id PK,
  conversation_id,
  message_id,
  attachment_id,
  uploader_ptid,
  storage_ref,
  ciphertext_size,
  ciphertext_sha256,
  descriptor_bytes,
  event_id NULL,
  state,
  created_at
)

messaging_attachment_grants(
  object_id,
  recipient_ptid,
  event_id,
  PRIMARY KEY(object_id, recipient_ptid)
)
```

`complete` 只把 upload 变为 `COMPLETE_UNATTACHED`。Authority message transaction 同时：

```text
ConversationEvent + device queue/federation outbox
+ object ATTACHED(event_id)
+ immutable recipient PTID grants
```

任何一步失败全部 rollback。

### 8.3 Device Transfer Checkpoint

```text
messaging_attachment_projections(
  message_id,
  attachment_id,
  object_id,
  storage_ref,
  filename,
  mime_type,
  plaintext_size,
  plaintext_sha256,
  object_key,
  base_nonce,
  descriptor_bytes,
  availability_state,
  local_cache_path NULL,
  PRIMARY KEY(message_id, attachment_id)
)

messaging_attachment_transfers(
  attachment_id,
  direction,
  upload_id NULL,
  descriptor_hash,
  completed_chunk_bitmap,
  partial_path,
  attempt_count,
  next_attempt_at,
  last_error_code,
  state,
  PRIMARY KEY(attachment_id, direction)
)
```

checkpoint 与 descriptor hash 绑定。hash 变化、partial size 不匹配或 chunk hash 不匹配时
删除 partial bytes 并 fail closed，不复用 cursor。

### 8.4 Download Range Semantics

- request 必须携带 `conversation_id/object_id`、caller PTID auth 和 expected ETag；
- `Range: bytes=start-end` 成功返回 `206`、`Content-Range`、immutable ETag；
- 无 Range 的 bounded whole request 返回 `200`；非法或越界 range 返回 `416`；
- `If-Match` 不匹配返回 `412`，禁止返回新 object bytes；
- Home-to-Authority proxy 透传 backpressure/cancellation，不把 bytes 写入 federation outbox。

### 8.5 Search Index

```text
messaging_message_search_fts(
  conversation_id UNINDEXED,
  message_id UNINDEXED,
  plaintext,
  attachment_filenames,
  tokenize = unicode61
)
```

FTS row 与 message/attachment projection 同 transaction 创建或删除。Restore staging
从 archive projection 重建，禁止备份 SQLite FTS internal pages。查询必须以
`conversation_id` 限定，并使用 bounded result count/cursor。
