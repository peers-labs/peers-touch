---
kind: invariant
title: Actor Identity Boundary
status: active
owns:
  - apps/station/app/subserver/
  - apps/station/frame/core/social_gate/
  - apps/desktop/src/services/
  - apps/desktop/src-tauri/src/
  - model/domain/
severity: critical
detected: 2026-07-31
---

# Actor Identity Boundary Invariant

## Rule

All API boundaries, inter-subserver interfaces, gate evaluations, cross-station
communication, and cross-device communication MUST use `ptid` (string) as the
actor identity.

`uint64 actor_id` is a **station-internal storage optimization** and MUST NOT
cross any of the following boundaries:

- Proto message fields exposed to clients or federation peers
- Subserver-to-subserver Go interfaces
- Social gate querier / evaluator signatures
- HTTP request/response payloads
- SSE event payloads
- JWT claim values carrying actor identity
- Tauri command parameters or return types
- Frontend store keys visible to components

Verified remote device-key persistence is owned exclusively by the Actor
Identity subserver. Federation profile resolution may verify and cache the
signed public Actor profile, but it MUST NOT write `actor_devices` through the
legacy `frame/touch/actor.DeviceStore`; cryptographic consumers hydrate keys
through Actor Identity capabilities on demand.

## Canonical Source

`docs/architecture/domains/identity/unified-actor-system.md` defines the three-layer
identity model:

| Layer | Type | Scope | May cross process boundary? |
|-------|------|-------|-----------------------------|
| `ptid` | string | Peers-Touch domain-wide, federation-stable | **Yes** — the only allowed cross-boundary actor identifier |
| `actor_id` | uint64 | Station-internal Sonyflake PK | **No** — confined to storage/repository layer |
| `acct` | string | user@host human-readable | Display only; never used for addressing |

## Enforcement

### Code Review Gate

Any PR that introduces a new `uint64` parameter or field carrying actor identity
across a module boundary MUST be rejected. The reviewer checks:

1. Does the new `uint64` appear in a proto field, Go interface signature, HTTP
   handler parameter, Tauri command argument, or frontend service contract?
2. If yes → REJECT. The correct type is `ptid string`.

### Naming Convention

- Proto fields: `ptid`, `sender_ptid`, `recipient_ptid`, `owner_ptid`,
  `invited_by_ptid`, etc.
- Go variables: `ptid`, `senderPtid`, `recipientPtid`, `subjectPtid`, etc.
- GORM columns: `ptid`, `owner_ptid`, `invited_by_ptid`, etc.
- Never: `actor_did`, `actor_id` (in API-facing code), `subject_did`, or any
  self-invented identifier synonym.

### Acceptable uint64 Usage

- Inside a repository implementation as a DB primary key or foreign key
- Inside an adapter that resolves `ptid → actor_id` for legacy infrastructure
  (e.g., social follow/block tables still keyed by uint64)
- In the `touch_actor` table's `id` column itself

### Forbidden Patterns

```go
// WRONG: leaking uint64 across subserver boundary
type RelationshipQuerier interface {
    IsFollowing(ctx context.Context, followerID, targetID uint64) (bool, error)
}

// RIGHT: ptid at the interface, internal resolution hidden
type RelationshipQuerier interface {
    AreMutualFollowers(ctx context.Context, ptidA, ptidB string) (bool, error)
}
```

```protobuf
// WRONG: exposing internal ID
message FetchKeyPackageRequest {
  uint64 actor_id = 1;
}

// RIGHT: ptid is the only cross-boundary identifier
message FetchKeyPackageRequest {
  string ptid = 1;
}
```

## How to verify

- `rg 'uint64\\s+(actor_id|sender_id|recipient_id|owner_id)' model/domain`
  must return no cross-boundary actor identifiers.
- `rg 'actor_did|subject_did' model/domain apps/station/app/subserver
  apps/desktop/src-tauri/src apps/desktop/src/services` must return no
  self-invented actor identity aliases.
- Station adapter tests must resolve `ptid` to numeric IDs only inside
  persistence adapters.

## Rationale

- Federation: `ptid` is stable across station restores, migrations, and merges.
  `uint64` is meaningless outside the originating station's database.
- Security: exposing `uint64` leaks enumeration surface (sequential Sonyflake
  IDs reveal creation order and approximate count).
- Decoupling: subservers that accept `ptid` do not depend on each other's
  storage schema or ID generation strategy.

## Violation History

- Social subserver exposed `uint64 actor_id` in `FollowRepository` and
  `BlockGraphRepository` interfaces, forcing callers to obtain internal IDs.
  Fixed by hiding the translation inside `ConversationRelationshipAdapter`.
- Conversation subserver used field name `actor_did` (self-invented terminology
  not matching canonical `ptid`). Renamed globally in proto + Go + GORM.
