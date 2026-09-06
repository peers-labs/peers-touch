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
docs/architecture/api-ownership/station-api-capabilities.yaml
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

## 2. Exposure Types

| Exposure | Caller | Authentication | May own business truth |
|---|---|---|---|
| `client` | Desktop/Mobile through Home Station | actor session + device binding as required | yes, in declared domain |
| `peer` | authenticated remote Station | scoped Station credential | no; dispatches to domain owner |
| `internal` | in-process application port/worker | process-local composition | no independent public route |

A capability cannot be both `client` and `peer` through one handler. The two trust
boundaries require separate capability IDs even when they carry related payloads.

## 3. Governed Chat And Social Capabilities

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

Attachment, typing, peer Federation, and the rest of the existing Conversation route
family must be inventoried in the same registry before the Gate becomes required.
They cannot be omitted from the governed prefixes in the accepted artifact.

## 4. Canonical Conversation Persistence

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

## 5. Typed Cross-Station Friend Request Contract

The exact field numbers are assigned proto-first during execution. The required
semantic contract is:

```text
FriendRequestCommand
  command_id
  request_id
  action: SEND | ACCEPT | REJECT
  sender_actor_ref
  receiver_actor_ref
  message
  observed_request_state
  created_at
  expires_at
  actor_device_signature

FriendRequestEvent
  event_id
  request_id
  authority_station_id
  state: PENDING | ACCEPTED | REJECTED
  sender_actor_ref
  receiver_actor_ref
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

## 6. Gate Result

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
