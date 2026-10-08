# Federation Architecture — 数据模型

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-05-31 | **Updated**: 2026-10-06
> **Owner**: Architecture Team

---

## 1. 模型边界

本文档描述概念数据模型，不是最终数据库 migration 或 proto 定义。落地时必须遵守 Proto-First：

- 跨 Station wire payload 先定义在 `model/domain/federation/*.proto`。
- Station 内部持久化可以使用数据库表，但不得绕过 proto 语义另起一套对外模型。
- JSON 只可作为内部 materialized state 缓存或运维展示，不作为跨 Station 事实源。
- 跨 Station 身份字段必须复用 `ActorRef` 语义；数据库可保留本地 `actor_id`，但 wire payload 不得把本地 ID 当成全局身份。
- Event hash、signature、payload hash 必须基于 deterministic protobuf canonical bytes。

---

## 2. Federation

Federation 是虚拟网络实体。

```text
federation
  id
  federation_id
  name
  description
  avatar_url
  visibility
  status
  genesis_hash
  head_hash
  head_seq
  policy_type
  sequencer_station_peer_id
  discovery_visibility
  created_by_actor_id
  created_by_station_peer_id
  created_at
  updated_at
```

字段说明：

| 字段 | 说明 |
|------|------|
| `federation_id` | Federation 稳定 ID，跨 Station 一致 |
| `genesis_hash` | genesis event hash |
| `head_hash` | 当前 ledger head |
| `head_seq` | 当前 ledger sequence |
| `policy_type` | `single_admin`、`owner_admin`、`multi_sig`、`quorum` 等 |
| `sequencer_station_peer_id` | v1 active sequencer Station，负责分配正式 event seq/head |
| `discovery_visibility` | Federation manifest 是否可通过公开入口发现 |
| `status` | `active`、`orphaned`、`archived`、`suspended` |

---

## 3. Federation Ledger Event

Ledger event 是 Federation 治理事实的唯一追加单元。

```text
federation_ledger_event
  id
  event_id
  federation_id
  seq
  prev_hash
  event_hash
  event_type
  payload_bytes
  payload_hash
  canonical_payload_bytes
  actor_id
  actor_ref_bytes
  actor_federated_handle
  station_peer_id
  sequencer_station_peer_id
  actor_signature
  station_signature
  sequencer_signature
  created_at
```

事件类型：

```text
FederationCreated
StationInvited
StationJoinRequested
StationJoinApproved
StationLeft
StationSuspended
StationRemoved
AdminGranted
AdminRevoked
PolicyUpdated
SequencerChanged
FederationArchived
```

有效事件必须满足：

```text
prev_hash == sequencer_current_head_hash
seq == sequencer_current_head_seq + 1
event_hash == hash(canonical(event_type, payload_hash, prev_hash, seq, federation_id))
actor_signature is valid
station_signature is valid
sequencer_signature is valid
actor has permission for event_type
payload conforms to federation policy
station_peer_id is active member for federation_id
sequencer_station_peer_id is current sequencer for federation_id
```

非 sequencer Station 不能直接生成正式 event。它们只能提交 signed proposal，由 sequencer 追加为正式 event。

### 3.1 Federation Ledger Proposal

Ledger proposal 是治理动作进入 sequencer 前的待处理请求，不是 Federation 真源：

```text
federation_ledger_proposal
  id
  proposal_id
  federation_id
  proposed_event_type
  payload_bytes
  payload_hash
  actor_ref_bytes
  actor_federated_handle
  station_peer_id
  actor_signature
  station_signature
  status
  rejection_reason
  accepted_event_id
  created_at
  decided_at
```

状态：

```text
pending
accepted
rejected
expired
```

Proposal 可以被 Station 本地持久化用于重试和审计，但只有 `accepted_event_id` 指向的正式 ledger event 会进入 Federation Ledger。

---

## 4. Federation Station Membership

Membership 表示某个 Station 在某个 Federation 中的成员身份。

```text
federation_station_membership
  id
  federation_id
  station_peer_id
  station_name
  station_url
  station_public_key
  role
  status
  joined_at
  approved_by_event_id
  last_seen_at
  metadata_bytes
```

角色：

| Role | 说明 |
|------|------|
| `founder` | Genesis Station 或初始成员 Station |
| `admin_station` | 具备 Federation governance 能力的成员 Station |
| `member_station` | 普通成员 Station |
| `observer` | 只读观察者，不能参与治理或公开目录 |

状态：

```text
pending
active
suspended
left
removed
```

Membership 是 ledger replay 的投影。实现可以持久化该表加速查询，但修复不一致时必须以 ledger replay 为准。

---

## 5. Federation Actor Role

Federation Actor Role 表示某个 Actor / Account 在某个 Federation 中的治理角色。Account 只作为产品语言，跨 Station wire identity 必须落到 `ActorRef` 语义。

```text
federation_actor_role
  id
  federation_id
  actor_id
  actor_ref_bytes
  actor_federated_handle
  station_peer_id
  role
  granted_by_event_id
  created_at
  revoked_at
```

角色：

| Role | 说明 |
|------|------|
| `federation_owner` | 初始或转让后的 Federation owner |
| `federation_admin` | 可执行 Federation governance 操作 |
| `federation_moderator` | 可选内容治理角色 |

`actor_id` 是本 Station 内部 ID；跨 Station 展示、签名和 wire payload 必须使用 `actor_ref_bytes`、`actor_federated_handle` 和 `station_peer_id`。`actor_ref_bytes` 对应 `ActorRef` 的 canonical proto bytes。

---

## 6. Station Role Assignment

Station Role Assignment 表示 Station 内部治理权限。

```text
station_role_assignment
  id
  actor_id
  role
  granted_by_actor_id
  created_at
  revoked_at
```

Station 角色：

```text
station_owner
federation_admin
member
```

初始化规则：

- seed 阶段第一个 preset user 成为 `station_owner`。
- 注册阶段如果 Station 没有 owner，第一个成功注册用户成为 `station_owner`。
- 其他用户默认是 `member`。

---

## 7. Materialized State

Materialized state 是 ledger replay 后的缓存，不是真源。

```text
federation_materialized_state
  federation_id
  head_hash
  head_seq
  sequencer_station_peer_id
  state_bytes
  updated_at
```

状态内容包括：

- Federation metadata。
- active member stations。
- station roles。
- actor governance roles。
- policy。
- sequencer。
- audit summary。

如果 materialized state 与 ledger head 不一致，必须丢弃并从 ledger replay。

---

## 8. Federation Discovery Manifest

Discovery manifest 是邀请、导入、首次加入 Federation 的入口材料。它不是 ledger 真源，但必须能把客户端或 Station 引导到可验证的 genesis：

```text
federation_discovery_manifest
  federation_id
  name
  description
  genesis_hash
  bootstrap_station_peer_ids
  bootstrap_station_urls
  relay_hints
  manifest_issued_at
  manifest_expires_at
  signer_station_peer_id
  signature
```

验证规则：

```text
manifest signature is valid
genesis_hash matches fetched genesis event
bootstrap station can provide ledger event seq=0
fetched genesis event federation_id == manifest federation_id
```

Manifest 可以通过 invite link、QR、operator import 或 Home Station Plaza API 传播。它不得成为中央 registry，也不得覆盖 ledger replay 得出的 membership。

---

## 9. Federation Scoped Actor Visibility

全局 actor visibility 仍然存在，但多 Federation 场景需要 scoped visibility 作为降级层：

```text
federation_actor_visibility
  id
  federation_id
  actor_id
  actor_ref_bytes
  station_peer_id
  visibility
  updated_by_actor_id
  updated_at
```

合成规则：

```text
effective_visibility = min_publicity(global_actor_visibility, federation_actor_visibility, federation_policy)
```

约束：

- 全局 `hidden` 时，任何 Federation scoped visibility 都不能使其可发现。
- 全局 `by_handle` 时，scoped visibility 不能升级为 indexed。
- 全局 `indexed` 时，scoped visibility 可以降级为 `by_handle` 或 `hidden`。
- Catalog 只能返回 effective visibility 为 indexed 的 Actor。

---

## 10. Ledger Sync Cursor

每个成员 Station 需要记录自己对其他成员或 sequencer 的同步进度：

```text
federation_ledger_sync_cursor
  federation_id
  remote_station_peer_id
  last_seen_head_hash
  last_seen_head_seq
  last_applied_seq
  last_sync_at
  status
  error_code
  error_message
```

状态：

```text
healthy
lagging
fork_detected
remote_unreachable
policy_rejected
```

当检测到同一 `seq` 对应不同 `event_hash`，必须将对应 Federation 标记为 `fork_detected`，停止自动推进 materialized state，并要求管理员处理。

---

## 11. 测试网 Seed 模型

测试网可以 seed 一个 `Peers Testnet` Federation：

```text
federation_id: peers-testnet
name: Peers Testnet
policy_type: single_admin
sequencer_station_peer_id: node-a
members:
  - node-a / 10.37.94.156:18080
  - node-b / 10.37.195.98:18080
  - node-c / 10.37.246.80:18080
station_owners:
  - node-a/a@p.t
  - node-b/a@p.t
  - node-c/a@p.t
federation_admins:
  - node-a/a@p.t
  - node-b/a@p.t
  - node-c/a@p.t
```

Seed 必须生成与正式流程同构的 genesis 和 membership events，不能只写 materialized state。

---

## 12. Proto 草案方向

落地时建议拆分为：

```text
model/domain/federation/federation.proto
model/domain/federation/federation_ledger.proto
model/domain/federation/federation_membership.proto
model/domain/federation/federation_policy.proto
model/domain/federation/federation_manifest.proto
model/domain/federation/federation_sync.proto
model/domain/federation/federation_discovery.proto
model/domain/federation/relay_transport.proto
```

跨 Station 同步 API 使用 proto bytes，不使用 JSON。

Desktop 展示层可以接收由 Tauri/Rust BFF 转换后的 UI view model，但 Station-to-Station 事实同步必须以 proto 为准。

现有 `model/domain/federation/catalog.proto` 草案方向需要补充 `federation_id`：

```text
FederationCatalogSearchRequest
  federation_id
  prefix
  filters
  pagination
```

没有 `federation_id` 的 Catalog API 只能作为 legacy / advanced handle discovery，不能作为 Federation scoped 发现的默认入口。

---

## 13. Relay Invite 与 Mount

```text
relay_invite
  invite_id
  secret_hash
  intended_station_peer_id?
  allowed_visibility
  requested_limits
  status
  expires_at
  consumed_at?

relay_mount
  mount_id
  station_peer_id
  station_host_public_key
  generation
  credential_jti
  visibility
  limits
  status
  last_heartbeat_at
  revoked_at?
```

约束：

- invite 明文只在创建响应中出现一次，查询接口不能返回；
- `secret_hash` 使用适合随机高熵 token 的 keyed digest，并绑定 Relay issuer；
- invite consume、Station PeerID binding 和 mount generation create 是原子事务；
- `(station_peer_id, generation)` 唯一；
- revoke 先使 generation 无效，再关闭 stream；
- heartbeat 更新 liveness，不能用初始 `mounted_at` 判定健康连接。

## 14. Relay Credential

```text
relay_mount_credential
  issuer_relay_peer_id
  audience
  scopes[]
  jti
  station_peer_id
  mount_id
  generation
  issued_at
  expires_at
  signature
```

允许 scope 示例：

```text
relay.mount.connect
relay.mount.rotate
relay.route.publish
relay.peer.tunnel
```

Relay operator credential 使用独立 audience/scope，不能与 Station app session 或
mount credential 互换。`jti + generation + expires_at` 必须在每次连接、刷新和
route publish 时验证。

## 15. Route Attestation 与 Connection Grant

```text
station_route_attestation
  station_peer_id
  relay_peer_id
  route_id
  mount_generation
  inner_tls_spki_sha256
  capabilities_digest
  visibility
  issued_at
  expires_at
  station_host_public_key
  station_signature

relay_connection_grant
  grant_id
  grant_digest
  route_id
  mount_generation
  remaining_uses
  expires_at
```

attestation 由 Station host key 签名；Relay 只能缓存、过滤过期值和按 grant
返回。grant 原文由 Station 签发给用户，Relay 只存 digest 与使用计数。

## 16. Opaque Tunnel

```text
relay_tunnel
  tunnel_id
  route_id
  mount_generation
  source_class: CLIENT | STATION
  opened_at
  last_activity_at
  bytes_up
  bytes_down
  state
  close_reason
```

Relay 不持久化 inner TLS plaintext、HTTP metadata 或 Station credential。
`TunnelData.ciphertext` 只在有界内存队列中存在。状态为：

```text
opening -> active -> draining -> closed
opening | active -> rejected | revoked | timed_out | overloaded
```

所有 limit 必须在入队前检查。取消 frame 释放 Station dispatcher、pending request
和 Relay queue；超限不能通过截断后继续发送。
