# Service API Capability Ownership — Data Model

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-06 | **Updated**: 2026-09-06
> **Owner**: Architecture Team

---

Conversation is the sole Chat entry point at `/conversation/*`. Device, Inbox,
Recovery, Key Exchange, and Federation resource owners expose `/device/*`,
`/device/inbox/*`, `/recovery/*`, `/key-exchange/*`, and peer-only
`/federation/*` respectively.

## 1. Ownership Registry

The machine-readable projection lives at:

```text
docs/architecture/engineering/api-governance/station-api-capabilities.yaml
```

Top-level shape:

```yaml
schema_version: 1
status: accepted_target
activation:
  state: accepted_pending_implementation
  gate_enabled: false
governed_prefixes:
  - /conversation/
  - /device/
  - /recovery/
  - /key-exchange/
  - /api/v1/social/friend-request
  - /api/v1/social/friend-requests
  - /federation/
owner_roots:
  station.conversation:
    - apps/station/app/subserver/conversation/
ddd_layers:
  - name: conversation.domain
    root: apps/station/app/subserver/conversation/domain/
    forbidden_imports:
      - gorm.io
      - net/http
capabilities: []
```

Each capability entry contains:

```yaml
id: chat.conversation.create_direct
domain_owner: station.conversation
truth_owner: conversation.authority
exposure: client
canonical_route:
  method: POST
  path: /conversation/direct
request_proto: peers_touch.model.chat.v1.CreateDirectConversationRequest
response_proto: peers_touch.model.chat.v1.CreateDirectConversationResponse
truth_stores:
  - conversations
  - conversation_members
allowed_dependencies:
  - actor.device_directory.read
  - conversation.delivery.enqueue
  - federation.delivery.enqueue
forbidden_aliases: []
superseded_symbols:
  - peers_touch.model.chat.v1.CreateMessagingDirectConversationRequest
  - peers_touch.model.chat.v1.CreateMessagingDirectConversationResponse
```

Rules:

- `id` is stable and unique.
- `canonical_route` is required for `client` and `peer` exposure.
- one `client` capability has one canonical route; aliases are forbidden.
- a store may be authoritative for only one truth owner.
- `allowed_dependencies` are ports, not concrete package imports.
- `superseded_symbols` must have zero live references at hard-cut completion.

## 2. DDD Layer Rules

Each `ddd_layers` entry binds a target source root to import prefixes that are
forbidden in production Go files under that root. The Gate parses Go imports and
ignores `_test.go` composition so black-box tests may wire real adapters.

The accepted Conversation rules enforce:

- `domain` has no HTTP, GORM, Station frame, generated transport, application,
  infrastructure, or interface imports;
- `application` has no HTTP, SQL/GORM, generated transport, concrete
  infrastructure, or interface imports;
- `infrastructure` does not import the HTTP interface layer;
- `interface/http` does not import concrete infrastructure.

Missing layer rules or any forbidden import make the registry Gate fail.

## 3. Exposure Types

| Exposure | Caller | Authentication | May own business truth |
|---|---|---|---|
| `client` | Desktop/Mobile through Home Station | actor session + device binding as required | yes, in declared domain |
| `peer` | authenticated remote Station | scoped Station credential | no; dispatches to domain owner |
| `internal` | in-process application port/worker | process-local composition | no independent public route |

A capability cannot be both `client` and `peer` through one handler. The two trust
boundaries require separate capability IDs even when they carry related payloads.

## 4. Governed Chat And Social Capabilities

| Capability ID | Canonical route | Owner |
|---|---|---|
| `chat.conversation.create_direct` | `POST /conversation/direct` | Conversation |
| `chat.conversation.list` | `GET /conversation/list` | Conversation |
| `chat.command.prepare` | `POST /conversation/command/prepare` | Conversation |
| `chat.command.submit` | `POST /conversation/command` | Conversation |
| `chat.group.genesis.prepare` | `POST /conversation/group/prepare` | Conversation |
| `chat.membership.prepare` | `POST /conversation/membership/prepare` | Conversation |
| `chat.read_cursor.submit` | `POST /conversation/read-cursor` | Conversation |
| `chat.delivery.receipt` | `POST /conversation/delivery/receipt` | Conversation Delivery |
| `actor.device.enroll` | `POST /device/enroll` | Actor Identity |
| `chat.device.queue.claim` | `POST /device/inbox/claim` | Conversation Delivery |
| `chat.device.queue.ack` | `POST /device/inbox/ack` | Conversation Delivery |
| `chat.device.queue.reject` | `POST /device/inbox/reject` | Conversation Delivery |
| `recovery.revision.put` | `POST /recovery/revision` | Recovery |
| `recovery.revision.latest` | `GET /recovery/latest` | Recovery |
| `social.friend_request.send` | `POST /api/v1/social/friend-request/send` | Social |
| `social.friend_request.accept` | `POST /api/v1/social/friend-request/accept` | Social |
| `social.friend_request.reject` | `POST /api/v1/social/friend-request/reject` | Social |
| `social.friend_request.list` | `GET /api/v1/social/friend-requests` | Social |

The registry inventories all current routes under the governed prefixes. Routes
that have no target capability are listed under `target_absent_routes`, so their
presence fails as explicit deletion debt instead of being misclassified as an
undeclared capability.

### 4.1 Canonical Proto Sources

CA-W1 assigns each canonical request/response symbol to exactly one capability:

| Resource owner | Proto source | Canonical responsibility |
|---|---|---|
| Conversation | `model/domain/chat/conversation_api.proto` | create/list/query, prepare/submit, membership, settings, read, and typing |
| Conversation Delivery | `model/domain/chat/queue.proto`, `model/domain/chat/receipt.proto` | fenced Device Inbox and typed receipt/read-cursor submission |
| Actor Identity | `model/domain/actor/actor.proto` | Actor Device enrollment, listing, revocation, and endpoint manifests |
| Recovery | `model/domain/recovery/recovery.proto` | opaque encrypted archive revisions |
| Key Exchange | `model/domain/key_exchange/key_exchange.proto` | Direct public material, MLS KeyPackages, exact-once claims, and DKX |
| Federation | `model/domain/federation/delivery.proto` | authenticated domain-neutral frame, disposition, and typed transport failure |
| Social | `model/domain/social/relationship.proto` | Friend Request API plus signed command/event/result payloads |

The target types are additive until CA-W5. Existing handlers and clients remain on
their current generated types until the atomic route/consumer cutover; the registry
marks those types as superseded deletion obligations rather than aliases.

## 5. Canonical Conversation Persistence

The target Conversation authority has one store family:

```text
conversations
conversation_members
conversation_member_devices
conversation_events
conversation_command_receipts
conversation_authority_plans
conversation_member_settings
conversation_read_cursors
```

`conversation_members` also stores the Conversation-authoritative moderation
projection:

```text
role                 member | admin | owner
muted                boolean
muted_until          nullable timestamp
```

These fields are part of the hashed authority post-state. They are distinct
from `conversation_member_settings`, which remains actor-local UI preference
state.

AO-D10 member commands use `(conversation_id, command_id)` in
`conversation_command_receipts`. An accepted command atomically persists:

```text
conversation aggregate + all member rows
+ one ConversationEvent
+ exact command receipt
+ device delivery intents
+ Federation follower projection outbox
```

Member role/mute updates and owner transfer advance `membership_epoch` once
while preserving `mls_epoch`, because no MLS leaf is added or removed. Owner
transfer stores the old owner as `admin`, the target as the sole `owner`, and
the new `owner_ptid` in the same transaction.

For Group conversations both epochs remain non-zero and
`membership_epoch >= mls_epoch`. MLS membership transitions advance both
epochs once; authority-only role/mute/owner transitions advance only
`membership_epoch`. Equality is therefore a genesis condition, not a durable
invariant.

The modern authority transaction semantics currently implemented under the Messaging
package move to this owner. The parallel `messaging_conversations`,
`messaging_conversation_members`, `messaging_conversation_member_devices`,
`messaging_events`, `messaging_command_receipts`, and `messaging_authority_plans`
families are target deletions.

The following remain delivery-plane state and are not Conversation truth:

```text
device_queue_lanes
device_queue_items
recovery_revisions
conversation_attachment_*
```

Final exact table names must match the accepted architecture and generated migration
manifest. A second table family may not be retained for compatibility.

## 6. Typed Cross-Station Friend Request Contract

The exact field numbers are assigned proto-first during execution. The required
semantic contract is:

```text
FriendRequestCommand
  body: FriendRequestCommandBody
    command_id
    request_id
    action: SEND | ACCEPT | REJECT
    sender_actor_ref
    receiver_actor_ref
    sender_home_station_peer_id
    receiver_home_station_peer_id
    message
    observed_request_state
    created_at
    expires_at
    authorizing_device
    federation_id
  signing_key_id
  actor_device_signature

FriendRequestEvent
  event_id
  request_id
  authority_station_peer_id
  state: PENDING | ACCEPTED | REJECTED
  sender_actor_ref
  receiver_actor_ref
  sender_home_station_peer_id
  receiver_home_station_peer_id
  federation_id
  sequence
  committed_at
  previous_hash
  event_hash
```

Authority and idempotency:

```text
authority = receiver_actor_ref.home_station
command identity = (authority, command_id)
request identity = request_id
exact retry + same hash -> same result
same identity + different hash -> conflict before mutation
```

Receiver authority transaction:

```text
validate sender/Home Station/signature/policy
  + resolve exact retry
  + persist request state/event
  + persist return-delivery outbox
  = one commit
```

Accept transaction additionally creates receiver-local relationship projection and
outbox facts needed for sender-local projection. Conversation creation is a subsequent
Social-owned integration call after accepted relationship convergence; it is not part of
the Federation transport.

## 7. Canonical Command And Destructive-Read Identity

AO-D07 fixes the replay identity for every mutation or read that consumes
one-time material:

```text
Direct creation
  identity = (derived conversation_id, command_id)
  exact payload = deterministic CreateDirectConversationRequest bytes

Group creation
  preparation identity = (conversation_id, authority_plan_id)
  creation identity = (conversation_id, ChatCommand.command_id)
  name, members, routes, and reservations = persisted authority plan only

Conversation command
  local authority = raw ChatCommand
  remote authority = actor-device-signed ConversationCommandProposal
  cross-Station transport = FederatedDomainFrame only
  terminal result = ConversationCommandResultDelivery through Federation

Destructive Key Exchange read
  identity = (authenticated requester, request_id)
  exact payload = deterministic request bytes containing target and Home Station
  exact retry = persisted original response
```

Signed Home Station and Federation fields are assertions that must match Actor
Identity and active Federation membership. They are never trusted routing
inputs. `ConversationEvent` is the sole committed Conversation event type, and
AO-D07-modified Station identity fields use the `*_station_peer_id` name.

## 8. Gate Result

The ownership Gate emits a canonical report:

```text
StationApiOwnershipReport
  registry_digest
  discovered_routes[]
  capability_bindings[]
  undeclared_routes[]
  duplicate_capabilities[]
  owner_mismatches[]
  duplicate_truth_stores[]
  live_superseded_symbols[]
  status: PASS | FAIL
```

Missing registry coverage is `FAIL`, not a warning or partial pass.
