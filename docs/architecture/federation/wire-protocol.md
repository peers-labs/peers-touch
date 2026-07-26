# Federation Wire Protocol Specification

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-21 | **Updated**: 2026-07-21
> **Owner**: Architecture Team
> **Depends on**: design.md, data-model.md, decisions.md

---

## 1. Scope

This document defines the precise wire-level rules for Federation Ledger:

- Hash algorithm and canonical serialization.
- Signature scheme, key hierarchy, and signing inputs.
- Per-event-type payload message schemas.
- RPC service definitions (transport, auth, pagination).
- Lifecycle state machines (proposal, sync, fork).

It fills the gap between `design.md` (what) and implementation (how). All definitions here are proto-ready: each section maps to specific proto messages or service methods.

---

## 2. Identifier Formats

### 2.1 federation_id

```text
fed_01J6X7K3M9VDGF2N8PWJRST6YZ
└──┘└──────────────────────────┘
prefix   26-char ULID (Crockford Base32)
```

- **Total length**: 30 characters (4 prefix + 26 ULID).
- **Prefix**: `fed_` — distinguishes federation IDs from other project identifiers (`ptid:` for actor, libp2p peer ID for station).
- **ULID body**: 10 chars timestamp (ms precision) + 16 chars cryptographic randomness. Globally unique without coordination, lexicographically sortable by creation time.
- **Character set**: `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (Crockford Base32 — excludes I/L/O/U to avoid ambiguity).
- **Case**: Uppercase canonical. Implementations MUST store and compare in uppercase. Display MAY use lowercase for aesthetics but wire format is uppercase.
- **Generation**: Created by the Station that issues the genesis event. No central registry.
- **Proto type**: `string` (not bytes) — human-readable in logs, URLs, and debug output.

### 2.2 Other Identifiers (Reference)

| Identifier | Format | Example |
|---|---|---|
| `federation_id` | `fed_` + ULID | `fed_01J6X7K3M9VDGF2N8PWJRST6YZ` |
| `event_id` | `evt_` + ULID | `evt_01J6X8P4R2KQNH5TMWYZ3BC7DE` |
| `proposal_id` | `prp_` + ULID | `prp_01J6X9A1F7LSMY6VNQWX4DG8HJ` |
| `station_peer_id` | libp2p Peer ID (multihash) | `12D3KooW...` |
| `actor_id` | ULID (no prefix, legacy) | `01HQX7K3M9VDGF2N8PWJRST6YZ` |

All ULID-based identifiers use the same Crockford Base32 encoding. Typed prefixes prevent accidental cross-entity usage (e.g., passing a proposal_id where federation_id is expected).

---

## 3. Hash & Canonical Serialization

### 3.1 Hash Algorithm

**SHA-256** for all hashing: `event_hash`, `payload_hash`, `prev_hash`, `genesis_hash`.

Rationale: widely adopted, deterministic, 32-byte output, auditable by external tools. Performance is not a bottleneck for governance events (low frequency).

### 3.2 Canonical Proto Serialization

**Problem**: Proto wire format does not guarantee deterministic byte output across implementations (field ordering, default value omission, unknown fields).

**Rule**: Canonical bytes MUST satisfy:

1. Fields serialized in **field-number order** (ascending).
2. **No unknown fields** — messages with unknown fields MUST be rejected before hashing.
3. **No default-value omission for hashed fields** — zero/empty values are explicitly serialized when they are part of the hash input (use wrapper types or explicit presence where needed).
4. **Map fields are forbidden** in hashable messages — use repeated sorted key-value pairs instead.
5. Implementation: Go uses `proto.MarshalOptions{Deterministic: true}`, Rust uses `prost` default (already field-order deterministic), TypeScript uses `@bufbuild/protobuf` with deterministic mode.

**Verification**: Any two implementations serializing the same logical message MUST produce identical bytes. Cross-implementation canonical-bytes conformance tests are required before Phase 1 exits.

### 3.3 Hash Input Construction

`event_hash` is computed as:

```text
event_hash = SHA-256(canonical_proto_bytes(EventHashInput {
  federation_id:    string
  seq:              uint64
  prev_hash:        bytes (32)
  event_type:       string (enum name, e.g. "FEDERATION_CREATED")
  payload_hash:     bytes (32)
}))
```

`payload_hash` is computed as:

```text
payload_hash = SHA-256(canonical_proto_bytes(typed_payload_message))
```

Where `typed_payload_message` is the concrete payload proto (e.g. `FederationCreatedPayload`), NOT the raw `payload_bytes` field. This ensures payload schema evolution is hash-stable.

### 3.4 Genesis Event Bootstrap

Genesis event has no predecessor:

```text
genesis.prev_hash = 32 bytes of 0x00 (SHA-256 null sentinel)
genesis.seq = 0
genesis.event_type = "FEDERATION_CREATED"
```

`genesis_hash` stored on the Federation entity is simply the `event_hash` of the genesis event.

---

## 4. Signature Scheme

### 4.1 Algorithm

**Ed25519** for all signatures (actor, station, sequencer). Matches existing `frame/core/auth/federation` key infrastructure.

### 4.2 Key Hierarchy

```text
Actor Key Pair (Ed25519)
  ├─ actor_public_key: identifies the Actor's signing identity
  ├─ Generated at: account creation on Home Station
  ├─ Private key stored: encrypted in Station DB + synced to Actor's devices
  ├─ Used for: actor_signature (Actor signs their own governance actions)
  └─ Rotation: via StationKeyRotated-style event (future)

Station Key Pair (Ed25519)
  ├─ station_public_key: identifies the Station across the federation
  ├─ Used for: station_signature, sequencer_signature
  └─ Managed by: frame/core/auth/federation/local_key.go
```

**Actor 独立签名**: Actor 持有自己的 Ed25519 key pair。Actor 的消息、数据和治理动作由 Actor 自己的私钥签名，不由 Station 代签。Station 只签自己的 station_signature（证明"本站转发了这个 event"），不替 Actor 做决定。

**Key 生命周期**:
- 创建：Actor 注册时生成 Ed25519 key pair，public key 存入 Actor profile。
- 存储：私钥加密存于 Station DB，同时同步到 Actor 的设备（Desktop/Mobile 通过 Tauri secure storage 保存）。
- 签名场景：Actor 在设备上发起治理动作时，设备端用本地私钥签名；Station 收到后验证 actor_signature，再附加 station_signature 转发给 sequencer。
- 轮换：通过 ledger event 表达（类似 StationKeyRotated），历史 events 保持在旧 key 下有效。

### 4.3 Signing Inputs

Each signature covers a distinct scope:

#### actor_signature

Proves the actor authorized the governance action (signed by Actor's own private key):

```text
actor_signature = Ed25519_Sign(actor_private_key, canonical_proto_bytes(ActorSignatureInput {
  federation_id:          string
  actor_id:               string
  actor_federated_handle: string
  event_type:             string
  payload_hash:           bytes (32)
  timestamp_unix_ms:      int64
}))
```

#### station_signature

Proves the originating Station authored and submitted this event:

```text
station_signature = Ed25519_Sign(station_private_key, canonical_proto_bytes(StationSignatureInput {
  federation_id:    string
  station_peer_id:  string
  event_type:       string
  payload_hash:     bytes (32)
  seq:              uint64
  prev_hash:        bytes (32)
  event_hash:       bytes (32)
}))
```

#### sequencer_signature

Proves the sequencer assigned ordering to this event:

```text
sequencer_signature = Ed25519_Sign(sequencer_private_key, canonical_proto_bytes(SequencerSignatureInput {
  federation_id:    string
  seq:              uint64
  event_hash:       bytes (32)
}))
```

The sequencer signs ONLY the ordering assignment (seq + event_hash), NOT the payload content. This means the sequencer does not "endorse" content — it only confirms "this event is at position N in the ledger".

### 4.4 Signature Verification Order

Receivers MUST verify in this order:

1. Recompute `payload_hash` from typed payload → reject if mismatch.
2. Recompute `event_hash` from EventHashInput → reject if mismatch.
3. Verify `sequencer_signature` using known sequencer public key → reject if invalid.
4. Verify `station_signature` using originating station's public key → reject if invalid.
5. Verify `actor_signature` using actor's public key (from Actor profile on originating Station) → reject if invalid.
6. Verify policy: does actor have permission for event_type? → reject if unauthorized.
7. Verify seq continuity: `prev_hash == local head hash` and `seq == local head seq + 1` → fork_detected if mismatch.

### 4.5 Key Rotation

Station key rotation is expressed as a ledger event (`StationKeyRotated`) that:

- Includes the new public key.
- Is signed by the OLD key (proving the rotating station still controls the old key).
- After this event, all subsequent events from that station MUST use the new key.
- Historical events remain valid under the key that was active at the time.

Implementation: maintain a `key_validity_log` per station, indexed by seq range.

---

## 5. Event Payload Schemas

Each `event_type` has a typed payload message. These are defined in `federation_ledger.proto`.

### 5.1 FederationCreated

```protobuf
message FederationCreatedPayload {
  string federation_id = 1;
  string name = 2;
  string description = 3;
  string policy_type = 4;             // "single_admin" | "owner_admin"
  string sequencer_station_peer_id = 5;
  string creator_actor_id = 6;
  string creator_actor_federated_handle = 7;
  string creator_station_peer_id = 8;
  bytes  creator_station_public_key = 9;
  string creator_station_name = 10;
  string creator_station_url = 11;
}
```

### 5.2 StationInvited

```protobuf
message StationInvitedPayload {
  string target_station_peer_id = 1;
  string target_station_name = 2;
  string target_station_url = 3;
  string invited_by_actor_id = 4;
  string invited_by_actor_federated_handle = 5;
  string message = 6;                 // optional invite message
  int64  expires_at_unix_ms = 7;      // invite TTL
}
```

### 5.3 StationJoinRequested

```protobuf
message StationJoinRequestedPayload {
  string requesting_station_peer_id = 1;
  string requesting_station_name = 2;
  string requesting_station_url = 3;
  bytes  requesting_station_public_key = 4;
  string requesting_actor_id = 5;
  string requesting_actor_federated_handle = 6;
  string message = 7;                 // optional request message
}
```

### 5.4 StationJoinApproved

```protobuf
message StationJoinApprovedPayload {
  string approved_station_peer_id = 1;
  string approved_by_actor_id = 2;
  string approved_by_actor_federated_handle = 3;
  string role = 4;                    // "member_station" | "admin_station"
}
```

### 5.5 StationLeft

```protobuf
message StationLeftPayload {
  string leaving_station_peer_id = 1;
  string leaving_actor_id = 2;
  string leaving_actor_federated_handle = 3;
  string reason = 4;                  // optional
}
```

### 5.6 StationSuspended

```protobuf
message StationSuspendedPayload {
  string target_station_peer_id = 1;
  string suspended_by_actor_id = 2;
  string suspended_by_actor_federated_handle = 3;
  string reason = 4;
}
```

### 5.7 StationRemoved

```protobuf
message StationRemovedPayload {
  string target_station_peer_id = 1;
  string removed_by_actor_id = 2;
  string removed_by_actor_federated_handle = 3;
  string reason = 4;
}
```

### 5.8 AdminGranted

```protobuf
message AdminGrantedPayload {
  string target_actor_id = 1;
  string target_actor_federated_handle = 2;
  string target_station_peer_id = 3;
  string role = 4;                    // "federation_owner" | "federation_admin" | "federation_moderator"
  string granted_by_actor_id = 5;
  string granted_by_actor_federated_handle = 6;
}
```

### 5.9 AdminRevoked

```protobuf
message AdminRevokedPayload {
  string target_actor_id = 1;
  string target_actor_federated_handle = 2;
  string target_station_peer_id = 3;
  string revoked_role = 4;
  string revoked_by_actor_id = 5;
  string revoked_by_actor_federated_handle = 6;
  string reason = 7;
}
```

### 5.10 PolicyUpdated

```protobuf
message PolicyUpdatedPayload {
  string old_policy_type = 1;
  string new_policy_type = 2;
  bytes  policy_params_bytes = 3;     // policy-type-specific params (canonical proto)
  string updated_by_actor_id = 4;
  string updated_by_actor_federated_handle = 5;
}
```

### 5.11 SequencerChanged

```protobuf
message SequencerChangedPayload {
  string old_sequencer_station_peer_id = 1;
  string new_sequencer_station_peer_id = 2;
  string reason = 3;                  // "handover" | "failover" | "policy_change"
  string initiated_by_actor_id = 4;
  string initiated_by_actor_federated_handle = 5;
}
```

### 5.12 StationKeyRotated

```protobuf
message StationKeyRotatedPayload {
  string station_peer_id = 1;
  bytes  old_public_key = 2;
  bytes  new_public_key = 3;
  int64  new_key_valid_from_seq = 4;  // events from this seq onward use new key
}
```

### 5.13 FederationArchived

```protobuf
message FederationArchivedPayload {
  string archived_by_actor_id = 1;
  string archived_by_actor_federated_handle = 2;
  string reason = 3;
}
```

---

## 6. RPC Service Definitions

### 6.1 Transport

All Federation governance RPCs use **HTTP/Protobuf** (matching existing Station Hertz API patterns):

- Content-Type: `application/protobuf`
- Path prefix: `/fed/v1/`
- Authentication: Federation JWT (existing `frame/core/auth/federation` Mint/Verify) with scope `federation_governance`

### 6.2 Auth Scope

New JWT scope for governance RPCs:

```text
scope: "federation_governance"
audience: target_station_peer_id
claims:
  federation_id: string
  source_station_peer_id: string
  actor_federated_handle: string (optional, for actor-initiated proposals)
ttl: 60 seconds (short-lived, per-request)
```

### 6.3 Sequencer RPCs (exposed by active sequencer Station)

#### SubmitProposal

```text
POST /fed/v1/proposal/submit
```

```protobuf
message SubmitProposalRequest {
  string federation_id = 1;
  string proposed_event_type = 2;
  bytes  payload_bytes = 3;           // canonical proto of typed payload
  bytes  payload_hash = 4;
  string actor_id = 5;
  string actor_federated_handle = 6;
  string station_peer_id = 7;
  bytes  actor_signature = 8;
  bytes  station_signature = 9;       // signs: event_type + payload_hash + federation_id
  int64  proposed_at_unix_ms = 10;
}

message SubmitProposalResponse {
  string proposal_id = 1;
  ProposalDecision decision = 2;      // ACCEPTED | REJECTED | PENDING
  string rejection_reason = 3;        // only if REJECTED
  LedgerEvent accepted_event = 4;     // only if ACCEPTED (sequencer immediately appended)
}

enum ProposalDecision {
  PROPOSAL_DECISION_UNSPECIFIED = 0;
  ACCEPTED = 1;
  REJECTED = 2;
  PENDING = 3;                        // for async multi-sig policies (future)
}
```

**Semantics**: Sequencer validates proposal synchronously. For `single_admin` policy, decision is immediate (ACCEPTED or REJECTED). `PENDING` is reserved for future multi-sig policies.

**Deduplication**: Sequencer deduplicates by `(federation_id, station_peer_id, event_type, payload_hash)` within a 5-minute window. Duplicate submissions receive the same response.

#### FetchHead

```text
POST /fed/v1/ledger/head
```

```protobuf
message FetchHeadRequest {
  string federation_id = 1;
}

message FetchHeadResponse {
  string federation_id = 1;
  bytes  head_hash = 2;
  uint64 head_seq = 3;
  string sequencer_station_peer_id = 4;
  int64  last_event_at_unix_ms = 5;
}
```

#### FetchEvents

```text
POST /fed/v1/ledger/events
```

```protobuf
message FetchEventsRequest {
  string federation_id = 1;
  uint64 from_seq = 2;               // inclusive, start fetching from this seq
  uint32 limit = 3;                   // max events to return (cap: 100)
}

message FetchEventsResponse {
  repeated LedgerEvent events = 1;
  bool has_more = 2;
  uint64 next_seq = 3;               // for pagination: next from_seq value
}
```

**Pagination**: Cursor-based via `from_seq`. Limit capped at 100 per request. Caller increments `from_seq = last_received_seq + 1` until `has_more == false`.

### 6.4 Member Station RPCs (exposed by all member Stations)

#### GetMembership

Allows sequencer or other members to verify a station's active membership:

```text
POST /fed/v1/membership/status
```

```protobuf
message GetMembershipStatusRequest {
  string federation_id = 1;
}

message GetMembershipStatusResponse {
  string federation_id = 1;
  string station_peer_id = 2;
  string role = 3;                    // "member_station" | "admin_station" | "founder"
  string status = 4;                  // "active" | "suspended" | "left"
  uint64 local_head_seq = 5;
  bytes  local_head_hash = 6;
}
```

#### AcceptInvite / AcceptJoinApproval

When a Station receives notification that it has been invited or its join was approved:

```text
POST /fed/v1/membership/accept-invite
```

```protobuf
message AcceptInviteRequest {
  string federation_id = 1;
  bytes  station_public_key = 2;      // joining station's public key
  string station_name = 3;
  string station_url = 4;
  string accepting_actor_id = 5;
  string accepting_actor_federated_handle = 6;
}

message AcceptInviteResponse {
  bool success = 1;
  string error_message = 2;
}
```

### 6.5 Projection RPCs (exposed by Home Station to its own Clients)

These are consumed by Desktop Settings and Dashboard, authenticated via standard JWT (not federation JWT):

#### ListFederations

```text
GET /sub-federation/federations
```

```protobuf
message ListFederationsResponse {
  repeated FederationSummary federations = 1;
}

message FederationSummary {
  string federation_id = 1;
  string name = 2;
  string description = 3;
  string status = 4;
  string policy_type = 5;
  uint64 head_seq = 6;
  string sequencer_station_peer_id = 7;
  uint32 member_station_count = 8;
  string my_role = 9;                 // current actor's role in this federation
  ActorCapability capability = 10;
}

message ActorCapability {
  bool can_invite = 1;
  bool can_approve_join = 2;
  bool can_update_policy = 3;
  bool can_view_ledger = 4;
  bool can_remove_station = 5;
  bool can_grant_admin = 6;
  bool can_leave = 7;
  bool can_archive = 8;
}
```

#### ListMemberStations

```text
GET /sub-federation/federations/{federation_id}/stations
```

```protobuf
message ListMemberStationsResponse {
  repeated MemberStationView stations = 1;
}

message MemberStationView {
  string station_peer_id = 1;
  string station_name = 2;
  string station_url = 3;
  string role = 4;
  string status = 5;
  string joined_at = 6;
  string sync_status = 7;            // "healthy" | "lagging" | "unreachable"
}
```

#### GetFederationDetail

```text
GET /sub-federation/federations/{federation_id}
```

Returns full FederationSummary + member list + recent ledger events + sync cursors.

#### CreateFederation (Dashboard only)

```text
POST /sub-federation/federations
```

```protobuf
message CreateFederationRequest {
  string name = 1;
  string description = 2;
  string policy_type = 3;            // default: "single_admin"
}

message CreateFederationResponse {
  string federation_id = 1;
  FederationSummary federation = 2;
}
```

#### JoinFederation

```text
POST /sub-federation/federations/join
```

```protobuf
message JoinFederationRequest {
  string federation_endpoint = 1;     // sequencer station URL or manifest URL
  string federation_id = 2;           // from manifest or known
  string message = 3;                 // optional join message
}

message JoinFederationResponse {
  string status = 1;                  // "submitted" | "approved" | "rejected"
  string proposal_id = 2;
}
```

#### LeaveFederation

```text
POST /sub-federation/federations/{federation_id}/leave
```

```protobuf
message LeaveFederationRequest {
  string federation_id = 1;
  string reason = 2;
}

message LeaveFederationResponse {
  bool success = 1;
}
```

---

## 7. Sync Protocol

### 7.1 Sync Model: SSE Push + HTTP Pull (Unified Architecture)

与群聊消息投递（EnvelopeDelivered via SSE）同架构，联邦 ledger sync 也走 SSE：

```text
Sequencer appends event
  → Sequencer Station 通过 events subserver 的 SSE 向所有在线成员 Station 推送 LedgerEventDelivered
  → 成员 Station 收到后验证并应用 event
  → 离线或断连的成员 Station 重连后通过 FetchEvents HTTP RPC 拉取缺失的 events（cursor-based）
```

**统一架构**: SSE 是项目的全局实时投递方式（chat envelope、federation ledger、presence 等都走同一 events subserver 的 StreamEvent oneof）。不搞单独的 relay notify 或自建 push 通道。

### 7.2 SSE StreamEvent Arm

在现有 `realtime/event.proto` 的 StreamEvent oneof 中新增：

```protobuf
// 在 StreamEvent oneof 中追加:
LedgerEventDelivered ledger_event_delivered = <next_field_number>;

message LedgerEventDelivered {
  string federation_id = 1;
  uint64 seq = 2;
  bytes  event_hash = 3;
  string event_type = 4;
  bytes  payload_bytes = 5;
  bytes  actor_signature = 6;
  bytes  station_signature = 7;
  bytes  sequencer_signature = 8;
  string actor_federated_handle = 9;
  string station_peer_id = 10;
  int64  created_at_unix_ms = 11;
}
```

成员 Station 的 SSE 连接收到此 event 后，执行完整验证（hash chain + signatures + policy），通过后应用到本地 ledger。

### 7.3 Station-to-Station SSE 连接

成员 Station 作为 SSE client 连接到 sequencer Station 的 events 端点：

- 使用 Federation JWT（scope: `federation_governance`）认证。
- 连接参数携带 `federation_id` + `last_seen_seq`，用于断线重连时 replay 缺失的 events。
- Sequencer Station 的 events subserver 维护 per-federation ring buffer，支持 cursor replay。

### 7.4 Lagging Station Catch-up

当 Station 断连较久，ring buffer 已滚动超过其 cursor 时：

1. SSE 连接返回 `CURSOR_EXPIRED` 信号。
2. Station 通过 FetchEvents HTTP RPC 批量拉取（每批 100，cursor-based）。
3. 验证每个 event（hash chain + signatures）。
4. 追赶完毕后恢复 SSE 实时接收。
5. 更新 sync_cursor status 为 `healthy`。

If batch verification fails mid-stream, mark `fork_detected` and stop.

### 7.5 Fork Detection

```text
Receive event with seq == local_next_expected_seq
  BUT event.prev_hash != local_head_hash
  → mark federation as fork_detected
  → stop accepting new events for this federation
  → emit alert to admin via Dashboard projection
  → require manual resolution (operator chooses canonical fork)
```

---

## 8. Lifecycle State Machines

### 8.1 Proposal Lifecycle

```text
           ┌─────────────┐
           │   created    │
           └──────┬──────┘
                  │ submit to sequencer
                  ▼
           ┌─────────────┐
     ┌─────│   pending    │─────┐
     │     └─────────────┘     │
     │ accept                   │ reject
     ▼                         ▼
┌──────────┐           ┌──────────┐
│ accepted │           │ rejected │
└──────────┘           └──────────┘
     │
     │ timeout (5 min no response from sequencer)
     ▼
┌──────────┐
│ expired  │
└──────────┘
```

**Timeout**: If sequencer does not respond within 5 minutes, proposal expires on the proposing Station. Proposer may retry with a new proposal_id.

**Dedup window**: 5 minutes. Same (federation_id, station_peer_id, event_type, payload_hash) within window returns cached response.

### 8.2 Station Membership Lifecycle

```text
                    ┌──────────────┐
                    │   unknown    │
                    └──────┬──────┘
                           │ invite / join_request approved
                           ▼
                    ┌──────────────┐
              ┌─────│    active    │─────┐
              │     └──────────────┘     │
              │ suspend                   │ leave / remove
              ▼                           ▼
       ┌──────────────┐           ┌──────────────┐
       │  suspended   │           │    left      │
       └──────┬──────┘           └──────────────┘
              │ unsuspend (admin event)
              ▼
       ┌──────────────┐
       │    active    │
       └──────────────┘
```

### 8.3 Sequencer Leave Guard

**Rule**: If the current sequencer Station initiates `StationLeft`, the event MUST be preceded by a `SequencerChanged` event in the same proposal batch. Sequencer cannot leave without first handing over.

If sequencer is unreachable and cannot produce a handover event, behavior depends on policy（见 §8.5）:
- `single_admin`: Federation enters `orphaned` (read-only, no new events).
- `quorum`（future）: remaining admin stations may produce a `SequencerChanged` event with quorum signatures.

### 8.4 Genesis Atomicity

Genesis creation is atomic within a single Station (the creator):

1. Generate `federation_id` (ULID).
2. Build `FederationCreatedPayload`.
3. Compute payload_hash, build EventHashInput, compute event_hash.
4. Sign actor_signature, station_signature, sequencer_signature (creator is first sequencer).
5. Write genesis event + initial materialized state in a single DB transaction.
6. If transaction fails, federation does not exist — no partial state.

**Concurrent creation guard**: `federation_id` is a ULID (globally unique). No two Stations can create the same federation_id. If by protocol error a duplicate is detected, the second one is rejected at FetchEvents verification.

### 8.5 Sequencer Policy（策略化设计）

Sequencer 选举和 handover 不写死某一种方式，而是通过 `policy_type` 策略化：

#### 策略接口

```go
type SequencerPolicy interface {
    // ValidateAppend 检查当前 Station 是否有权追加正式 event
    ValidateAppend(ctx context.Context, federation *Federation, station *StationMembership) error

    // ValidateProposal 检查 proposal 是否满足策略要求
    ValidateProposal(ctx context.Context, federation *Federation, proposal *Proposal) error

    // HandleSequencerUnreachable 当 sequencer 不可达时的策略行为
    HandleSequencerUnreachable(ctx context.Context, federation *Federation) (PolicyAction, error)

    // ValidateHandover 检查 handover 请求是否合法
    ValidateHandover(ctx context.Context, federation *Federation, request *HandoverRequest) error
}
```

#### 已定义的策略类型

| policy_type | 描述 | Sequencer 选举 | Handover 条件 | 失联行为 |
|---|---|---|---|---|
| `single_admin` | **v1 实现** — 最简单 | Genesis 创建者指定 | 当前 sequencer 主动发起 `SequencerChanged` | 进入 `orphaned`，等恢复 |
| `owner_admin` | 预留 — Owner 可指定 | Federation owner 通过 `PolicyUpdated` 指定 | Owner 或当前 sequencer 发起 | 进入 `read_only`，owner 可在线时恢复 |
| `quorum` | 预留 — 多签投票 | M-of-N admin stations 签名选举 | M-of-N admin stations 签名同意 | 自动选举（如果足够 admin 在线） |
| `multi_sig` | 预留 — 全签 | 所有 admin stations 签名 | 所有 admin stations 同意 | 任一缺席则冻结 |

#### v1 实现：`single_admin`

```text
创建联邦时：
  → 创建者 Station 成为 sequencer
  → policy_type = "single_admin"
  → sequencer_station_peer_id 写入 genesis event

正常运行：
  → 只有 sequencer Station 可以追加正式 event（非 sequencer → error 40002）
  → 其他 Station 通过 SubmitProposal 提交，sequencer 验证后追加

主动 Handover：
  → 当前 sequencer 发起 SequencerChanged event
  → 新 sequencer 必须是 active member station
  → 新 sequencer 从下一个 seq 开始分配

Sequencer 失联：
  → 其他 Station 检测到 SSE 断连 + FetchHead 超时
  → Federation 标记为 orphaned
  → 不能追加新 event，但可以读取历史和已有 materialized state
  → Sequencer 恢复后自动恢复正常

Sequencer 永久下线：
  → 需要人工介入（通过 Dashboard 运维操作）
  → 未来升级到 quorum policy 后可自动选举
```

#### 策略扩展规则

新增 policy_type 时：
1. 实现 `SequencerPolicy` 接口
2. 在 `federation_policy.proto` 中新增 policy params message
3. 通过 `PolicyUpdated` ledger event 切换策略（不可回滚到更弱策略）
4. 添加对应的验证测试
5. 更新本文档

策略切换本身也是 ledger event，必须由当前 policy 允许的角色发起。

---

## 9. Integration with Existing Discovery Layer

### 9.1 Boundary

```text
Existing Discovery Layer (frame/touch/federation/):
  locator, resolver, cache, profile, invalidation, republisher, health
  → Operates on single-actor identity discovery
  → No federation_id awareness
  → Lives in frame layer

New Governance Layer (app/subserver/federation/):
  ledger, sequencer, membership, policy, projection
  → Operates on federation lifecycle & governance
  → federation_id-scoped
  → Lives in app layer (DDD subserver)
```

### 9.2 Integration Points

| Existing Component | Change Required | How |
|---|---|---|
| `FederationSelfView` (proto) | Add `repeated JoinedFederationRef joined_federations` | New proto field (proto3 additive, backward compatible) |
| `/actor/federation/me` endpoint | Return expanded view including joined federations list | Handler queries new federation subserver for membership list |
| Catalog search | Add `federation_id` to `CatalogSearchRequest` | New field in existing proto (additive) |
| Resolver | No change for v1 | Resolver still resolves by handle; federation_id scoping is on Catalog, not Resolver |
| Routing Health | Add `governance_sync_status` field | New field in `FederationHealthView` proto |
| Invalidation | No change for v1 | Invalidation remains per-actor, not per-federation |

### 9.3 FederationSelfView Extension

```protobuf
message JoinedFederationRef {
  string federation_id = 1;
  string federation_name = 2;
  string my_role = 3;
  string status = 4;
}

// Add to existing FederationSelfView:
// repeated JoinedFederationRef joined_federations = 10;
```

### 9.4 Governance Subserver → Frame Interaction

The new `federation` subserver in app layer calls frame layer via Go interface injection:

```go
// frame provides:
type FederationTransport interface {
    // Send HTTP request to remote station with federation JWT
    SendAuthenticatedRequest(ctx context.Context, targetURL string, scope string, body []byte) ([]byte, error)
}

type RelayPublisher interface {
    // Publish notification to relay topic
    Publish(ctx context.Context, topic string, payload []byte) error
}
```

The governance subserver does NOT import frame internals directly. It uses injected interfaces provided during DI assembly.

---

## 10. Error Handling

### 10.1 Error Codes (federation range: 40000-49999)

| Code | Name | Meaning |
|------|------|---------|
| 40001 | FEDERATION_NOT_FOUND | federation_id does not exist |
| 40002 | NOT_SEQUENCER | This station is not the active sequencer |
| 40003 | PROPOSAL_REJECTED | Proposal failed policy check |
| 40004 | PROPOSAL_EXPIRED | Proposal TTL exceeded |
| 40005 | PROPOSAL_DUPLICATE | Duplicate submission within dedup window |
| 40006 | INVALID_SIGNATURE | Signature verification failed |
| 40007 | INVALID_HASH | Hash mismatch on event or payload |
| 40008 | FORK_DETECTED | seq/prev_hash inconsistency |
| 40009 | STATION_NOT_MEMBER | Requesting station is not an active member |
| 40010 | PERMISSION_DENIED | Actor lacks required role for this action |
| 40011 | SEQUENCER_UNREACHABLE | Cannot reach sequencer station |
| 40012 | FEDERATION_ORPHANED | Federation has no active sequencer |
| 40013 | STATION_SUSPENDED | Target station is suspended |
| 40014 | INVITE_EXPIRED | Invite TTL exceeded |
| 40015 | KEY_ROTATION_REQUIRED | Station key is too old, rotation needed |

### 10.2 Error Response

All RPC errors use the standard `ErrorResponse` proto format with federation error codes.

---

## 11. Security Invariants

1. Ledger event payload MUST NOT contain tokens, passwords, private keys, sessions, emails, or PII.
2. All signatures MUST be verified before applying an event to local state.
3. A suspended/removed Station's future events MUST be rejected, but its historical events remain valid.
4. SSE federation sync 连接 MUST 使用 Federation JWT 认证，scope 为 `federation_governance`。
5. FetchEvents response MUST NOT include events beyond what the requesting Station's membership permits.
6. Proposal dedup MUST prevent replay attacks within the dedup window.
7. Fork detection MUST halt state advancement — never silently accept a forked event.

---

## 12. Open Design Decisions (Non-blocking for Phase 1)

These are explicitly deferred and do NOT block Phase 1 implementation:

| Topic | v1 Behavior | Future Path |
|---|---|---|
| Multi-sig proposals | Immediate accept/reject | PENDING state + quorum collection |
| Ledger snapshot/checkpoint | Full replay from genesis | Periodic snapshot at seq N |
| Cross-federation discovery | Not supported | Explicit federation bridge events |
| Content moderation events | Not on ledger | `federation_moderator` role + moderation event types |
| Archive pre-conditions | Policy decides | Explicit member evacuation flow |

---

## 13. Proto File Mapping

This specification maps to the following proto files (to be created in `model/domain/federation/`):

| Proto File | Content |
|---|---|
| `federation_ledger.proto` | LedgerEvent, EventHashInput, signature input messages, all typed payload messages (§4) |
| `federation_governance_service.proto` | SubmitProposal, FetchHead, FetchEvents RPCs (§5.3) |
| `federation_membership_service.proto` | GetMembershipStatus, AcceptInvite RPCs (§5.4) |
| `federation_projection_service.proto` | ListFederations, ListMemberStations, CreateFederation, JoinFederation, LeaveFederation (§5.5) |
| `federation_sync.proto` | SyncCursor, FetchEvents pagination types (§7) |

Existing files to extend:
- `realtime/event.proto`: Add `LedgerEventDelivered` arm to StreamEvent oneof (§7.2)
- `federation_self.proto`: Add `JoinedFederationRef` and field to `FederationSelfView`
- `federation_health.proto`: Add `governance_sync_status` field
