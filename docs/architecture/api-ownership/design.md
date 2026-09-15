# Service API Capability Ownership — Architecture Design

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-06 | **Updated**: 2026-09-15
> **Owner**: Architecture Team
> **Module**: `apps/station/`, `model/domain/`, `tooling/acceptance/`

---

Conversation is the sole Chat entry point at `/conversation/*`. Actor Identity,
Conversation Delivery, Recovery, Key Exchange, and Federation expose
`/device/*`, `/device/inbox/*`, `/recovery/*`, `/key-exchange/*`, and peer-only
`/federation/*`. Desktop and Mobile retain Device Messaging Engine as an internal
runtime term only.

## 1. Core Principles

1. **Capability before package name.** A Go package or runtime name does not earn
   a public API namespace. The business capability owner does.
2. **One public mutation path.** One semantic capability has exactly one
   client-facing method/path and one canonical request/response family.
3. **One shared truth.** A capability cannot have parallel authoritative table,
   event-log, command-receipt, or projection families.
4. **Planes are explicit.** Business APIs, device delivery APIs, and peer transport
   APIs have different owners and must not be combined by naming convenience.
5. **Hard cut, not aliases.** A replaced route, proto, store, and caller is deleted in
   the same closure. Redirects and compatibility handlers are forbidden.
6. **Architecture is executable.** A machine-readable registry and a fail-closed Gate
   enforce the same ownership described by the documents.

## 2. Target System Boundary

```text
Desktop / Mobile
  |
  +-- /api/v1/social/* ---------> Social Graph Authority
  |                                friend request / relationship / block
  |
  +-- /conversation/* ----------> Conversation Authority
  |                                create / list / command / membership / read
  |                                typing / receipts / attachment grants
  |
  +-- /device/* ----------------> Actor Device Identity
  +-- /device/inbox/* ----------> Conversation Device Delivery
  +-- /recovery/* --------------> Opaque Recovery Repository
  +-- /key-exchange/* ----------> Direct/MLS/Content PreKey public material

Social Graph Authority -----------+
                                  | typed domain command/event adapters
Conversation Authority -----------+
                                  v
                         Durable Federation Transport
                         outbox / inbox / retry / dedup
                                  |
                                  v
                            Remote Station
```

The route prefix follows the semantic owner:

- `conversation` means shared Chat business truth;
- `social` means relationship business truth;
- `messaging` remains an internal Device Messaging Engine component name and
  does not own a public Station namespace;
- `federation` means authenticated Station-to-Station transport, never a business
  truth owner.

## 3. Sources Of Truth And Ownership

| Capability | Authority owner | Public API owner | Retained support owner |
|---|---|---|---|
| Direct/group conversation | Station Conversation | `/conversation/*` | Device Messaging delivery |
| Chat command/event sequence | Station Conversation | `/conversation/command*` | Device inbox + Federation transport |
| Conversation membership/settings/read cursor | Station Conversation | `/conversation/*` | Device projection |
| Friend request/relationship/block | Station Social | `/api/v1/social/*` | Federation transport |
| Device enrollment | Actor Identity | `/device/*` | Device Messaging Engine caller |
| Per-device Chat inbox | Conversation Delivery | `/device/inbox/*` | Device Messaging Engine consumer |
| Device consumption/delivery receipt | Conversation Delivery | `/conversation/delivery/receipt` | per-device inbox state |
| Actor read position | Station Conversation | `/conversation/read-cursor` | Device projection |
| Recovery revision | Recovery | `/recovery/*` | opaque Station storage |
| Attachment byte transfer | Conversation Authority data plane | `/conversation/attachments/*` | opaque byte-store adapter |
| Direct/MLS key packages and DKX | Key Exchange | `/key-exchange/*` | Actor Device Identity |
| Content PreKey publish/inventory (`SC-D20` proposed) | Key Exchange | `/key-exchange/content-prekeys/*` | Actor Device Identity verified-key capability |
| Cross-Station delivery | Federation transport | peer-only `/federation/*` | typed domain adapters |

## 4. Runtime Units And Boundaries

### 4.1 Conversation Authority

Owns:

- conversation identity and lifecycle;
- direct/group creation;
- membership, roles, settings, and actor read cursor;
- command admission, command receipt, event ordering, event hash, and authority
  plans;
- transactional creation of delivery intents.

It calls Device Messaging and Federation through transaction-scoped ports. It must
not own endpoint queue workers, device-local crypto, or transport retry loops.

### 4.2 Device Messaging Delivery Plane

Owns:

- client-side Direct/OpenMLS state and cryptographic progression;
- durable local command/outbox and one ordered inbox consumer;
- atomic SQLCipher consumption, projection, deduplication, and post-commit ACK;
- recovery and attachment transfer clients through typed Station ports.

It is an internal Desktop/Mobile runtime, not a Station public API namespace or
business truth owner. It must not create conversations, decide membership, allocate
conversation sequence, or register Station public routes. Station delivery, identity,
recovery, attachment, key-exchange, and Federation handlers are registered by their
resource owners and expose typed ports to the Engine.

### 4.3 Social Graph Authority

Owns Friend Request and relationship state. For cross-Station Friend Request:

```text
sender Home Station
  -> validate sender and persist exact command + federation outbox atomically
  -> receiver Home Station idempotently materializes receiver-owned request
  -> receiver accepts or rejects under Social policy
  -> accepted/rejected event is durably returned to sender Home Station
  -> both Home Stations apply their actor-local relationship projections
  -> Social invokes Conversation create-direct only after accepted relationship
```

Receiver Home Station owns the pending request decision. Neither Desktop nor Mobile
is an authority. Same-Station delivery uses the same command handler through a local
transport adapter; it is not a separate fast path with weaker semantics.

### 4.4 Durable Federation Transport

Owns only delivery mechanics:

- authenticated source and target Station identity;
- bounded outbox/inbox, retry, deduplication, ordering lane, and observability;
- typed payload dispatch to the registered domain adapter.

It must not authorize a Conversation command, decide a Friend Request, mutate Social
or Conversation truth, or use untyped `string + unknown` payloads.

## 5. Allowed And Forbidden Dependencies

Allowed:

```text
Social -> ConversationCreatePort       # only after accepted relationship
Social -> FederationDeliveryPort       # typed Friend Request command/event
Conversation -> DeviceInboxPort        # queue intents in authority transaction
Conversation -> FederationDeliveryPort # typed Chat frames
Device Inbox -> ConversationReadPort   # narrow authorization read only
Attachment -> ConversationGrantPort    # immutable recipient grant
Federation -> DomainDeliveryRegistry   # dispatch typed payload after auth/dedup
```

Forbidden:

- `messaging` mutating Conversation truth;
- `conversation` maintaining a second device queue or delivery worker;
- `social` importing Messaging business services to send Friend Requests;
- Federation handlers deciding Social or Conversation policy;
- Desktop/Mobile selecting different Station business routes;
- a new public route without a registered capability ID and owner;
- multiple authoritative table families for one capability.

## 6. Canonical API Families

### 6.1 Client-Facing Business APIs

```text
/conversation/*
/api/v1/social/*
```

Business action names use domain language. Device details may appear in typed input
where required for security without changing capability ownership.

### 6.2 Client-Facing Support APIs

```text
/device/*
/device/inbox/*
/recovery/*
/key-exchange/*
/conversation/attachments/*
/conversation/delivery/receipt
/conversation/typing
```

Each route is owned by the named resource domain. No implementation-shaped public
facade or second Chat subserver is permitted.

### 6.3 Peer-Only APIs

```text
/federation/*
```

Peer routes require Station authentication and an explicit typed payload capability.
They are not client-visible aliases for business APIs.

### 6.4 Proposed Canonical Wire Boundary

`AO-D07` is proposed to make the accepted owner and transaction semantics
expressible on the wire:

```text
caller-owned deterministic command/request bytes
  -> authenticated resource-owner client route
  -> local authority commit OR durable Home Station admission
  -> typed peer request or shared Federation frame
  -> resource-owner validation and mutation
  -> canonical result/event projection
```

The proposal requires:

- command identity on Direct creation and one exact `ChatCommand` for Group genesis;
- a local-command versus signed-remote-proposal union on
  `POST /conversation/command`;
- `ConversationEvent` as the sole committed Chat event;
- signed Friend Request commands and non-final Home admission states;
- exact-response replay for destructive Direct/MLS material fetches;
- synchronous typed peer routes for Key Exchange reads/claims and shared durable
  Federation delivery for DKX.

The full contract, failure semantics, and deletion obligations are defined in
[`proposals/20260907-ca-w5-canonical-wire-contract-amendment.md`](./proposals/20260907-ca-w5-canonical-wire-contract-amendment.md).
Until `AO-D07` is accepted, these relationships are proposals and CA-W5 remains
blocked before production registration.

## 7. Capability Registration Contract

Every governed handler is represented by one registry entry containing:

- stable `capability_id`;
- `domain_owner` and `truth_owner`;
- exposure: `client`, `peer`, or `internal`;
- canonical method/path and request/response proto types;
- authoritative store family;
- allowed dependency ports;
- forbidden aliases and superseded symbols.

The registry is the machine projection of accepted architecture, not a second design
source. Human-readable decisions remain authoritative; the registry must match them.

## 8. Failure Semantics

- Undeclared route or capability: build/CI fails.
- Two client routes for one capability: build/CI fails.
- Route owner differs from registry owner: build/CI fails.
- Duplicate authoritative store family: completion Gate fails.
- Superseded route, proto, table, or consumer remains: hard-cut Gate fails.
- Federation delivery fails: domain command remains durable and retryable; no remote
  success is claimed.
- Duplicate Federation frame: same payload is a no-op; same identity with another hash
  is a security conflict.
- Missing accepted ownership decision: implementation remains blocked at DESIGN.

## 9. Architecture Gates

`station-api-ownership` must:

1. parse registered Station handlers with Go AST;
2. compare every governed method/path with the ownership registry;
3. require exactly one client-facing route per capability;
4. reject undeclared aliases and owner mismatches;
5. verify canonical proto request/response ownership;
6. verify every governed authoritative table belongs to one capability owner;
7. run zero-reference scans for superseded routes, types, stores, and callers.

The Chat closure additionally proves that Desktop and Mobile use the same canonical
Conversation and Social routes. The Social two-Station Gate proves Friend Request
outage/retry/dedup, receiver materialization, accept/reject return, and event-after-commit.

## 10. Quality Outcome

The architecture is successful only when a repository query can answer, without
human interpretation, all of the following for any Station capability:

- Who owns the business truth?
- Which single public route mutates it?
- Which proto messages define the contract?
- Which stores are authoritative?
- Which internal services may be called?
- Which old routes, types, stores, and callers must be absent?
