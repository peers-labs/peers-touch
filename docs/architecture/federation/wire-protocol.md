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
Station Key Pair (Ed25519)
  ├─ station_public_key: identifies the Station across the federation
  ├─ Used for: station_signature, sequencer_signature
  └─ Managed by: frame/core/auth/federation/local_key.go

Actor Signing (v1: Station-delegated)
  ├─ In v1, Actor does NOT hold an independent key pair
  ├─ actor_signature = Station key signing actor-scoped content
  ├─ The signature proves: "Station vouches that Actor X authorized this action"
  └─ Future: Actor may hold device-bound keys (WebAuthn / passkey)
```

**v1 Constraint**: `actor_signature` and `station_signature` use the same Ed25519 key but sign **different inputs** (§3.3). The field separation allows future key-hierarchy upgrades without wire-format changes.

### 4.3 Signing Inputs

Each signature covers a distinct scope:

#### actor_signature

Proves the actor authorized the governance action:

```text
actor_signature = Ed25519_Sign(station_private_key, canonical_proto_bytes(ActorSignatureInput {
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
5. Verify `actor_signature` using originating station's public key (v1) → reject if invalid.
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

### 7.1 Sync Model: Pull + Relay Notification

```text
Sequencer appends event
  → broadcasts lightweight notification via relay topic "fed.ledger.notify.v1"
  → notification contains: federation_id, new_head_seq, new_head_hash (no payload)
  → member Stations receiving notification trigger pull via FetchEvents RPC
  → member Stations without relay connectivity fall back to polling (interval: 30s)
```

This hybrid model avoids relay carrying full ledger payloads while providing near-realtime sync.

### 7.2 Relay Notification Message

```protobuf
message LedgerAdvanceNotification {
  string federation_id = 1;
  uint64 new_head_seq = 2;
  bytes  new_head_hash = 3;
  string sequencer_station_peer_id = 4;
  int64  timestamp_unix_ms = 5;
}
```

Relay topic: `fed.ledger.notify.v1`. Deny-by-default allow-list. Only sequencer stations may publish.

### 7.3 Lagging Station Catch-up

When a Station detects it is behind (local_head_seq < remote_head_seq):

1. Fetch events in batches of 100 starting from `local_head_seq + 1`.
2. Verify each event in order (hash chain + signatures).
3. Apply to local ledger store and update materialized state.
4. Continue until `has_more == false`.
5. Update sync_cursor status to `healthy`.

If batch verification fails mid-stream, mark `fork_detected` and stop.

### 7.4 Polling Fallback

Stations that cannot receive relay notifications poll `FetchHead` every 30 seconds. If `remote_head_seq > local_head_seq`, trigger catch-up.

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

If sequencer is unreachable and cannot produce a handover event:
- Under `single_admin` policy: Federation enters `orphaned` (read-only, no new events).
- Under future `quorum` policy: remaining admin stations may produce a `SequencerChanged` event with quorum signatures.

### 8.4 Genesis Atomicity

Genesis creation is atomic within a single Station (the creator):

1. Generate `federation_id` (ULID).
2. Build `FederationCreatedPayload`.
3. Compute payload_hash, build EventHashInput, compute event_hash.
4. Sign actor_signature, station_signature, sequencer_signature (creator is first sequencer).
5. Write genesis event + initial materialized state in a single DB transaction.
6. If transaction fails, federation does not exist — no partial state.

**Concurrent creation guard**: `federation_id` is a ULID (globally unique). No two Stations can create the same federation_id. If by protocol error a duplicate is detected, the second one is rejected at FetchEvents verification.

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
4. Relay notification topic MUST be deny-by-default; only current sequencer may publish.
5. FetchEvents response MUST NOT include events beyond what the requesting Station's membership permits.
6. Proposal dedup MUST prevent replay attacks within the dedup window.
7. Fork detection MUST halt state advancement — never silently accept a forked event.

---

## 12. Open Design Decisions (Non-blocking for Phase 1)

These are explicitly deferred and do NOT block Phase 1 implementation:

| Topic | v1 Behavior | Future Path |
|---|---|---|
| Actor independent keys | Station signs on behalf | WebAuthn / device-bound keys |
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
| `federation_sync.proto` | LedgerAdvanceNotification, SyncCursor (§6) |

Existing files to extend:
- `federation_self.proto`: Add `JoinedFederationRef` and field to `FederationSelfView`
- `federation_health.proto`: Add `governance_sync_status` field
