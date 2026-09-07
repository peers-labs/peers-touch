# CA-W5 Canonical Wire Contract Amendment

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-09-07 | **Updated**: 2026-09-07
> **Owner**: Architecture Team
> **Module**: `model/domain/`, `apps/station/app/subserver/conversation/`,
> `apps/station/frame/core/federation/`
> **Accepted**: 2026-09-07

---

## 1. Scope

This proposal closes wire-contract gaps discovered while executing the approved
Conversation Authority hard cut. It defines command identity, authority scope,
remote mutation transport, event truth, and destructive-read replay semantics.

It does not change product behavior, add a compatibility interval, redesign
Federation governance, or replace the client Device Messaging Engine.

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence |
|---|---|---|---|
| `CreateDirectConversationRequest` does not carry the caller-owned command identity required by the DDD command service | `verified_fact` | `model/domain/chat/conversation_api.proto`; `application/command/service.go` | high |
| Group preparation does not carry explicit Federation scope, while the DDD service requires it | `verified_fact` | `PrepareConversationGroupRequest`; `command.PrepareGroupRequest` | high |
| Group creation carries duplicated name/genesis fields instead of the one canonical `ChatCommand` consumed by authority | `verified_fact` | `CreateGroupConversationRequest`; `command.CreateGroupRequest` | high |
| Both `ConversationEvent` and `CommittedConversationEvent` remain in active request/response paths | `verified_fact` | `conversation.proto`, `conversation_api.proto`, generated bindings | high |
| Remote command mutation still has both direct peer-route and shared durable-frame mechanisms | `verified_fact` | ownership registry, old Conversation handlers, shared Federation receiver | high |
| The current contracts cannot be mapped to the DDD services without synthesizing identity/scope or retaining old owners | `inference` | failed CA-W5 adapter mapping | high |

## 3. Proposed Decisions

### AO-D07.1: Caller-Owned Creation Identity

- Direct creation carries a required caller-generated `command_id`.
- The replay identity is `(derived conversation_id, command_id)`. The
  Conversation ID is deterministically derived from the two PTIDs; authenticated
  caller PTID, active device, and `federation_id` are bound into the exact
  request bytes and revalidated before mutation.
- The exact deterministic request bytes are the idempotency payload.
- Exact retry returns the original Conversation and creation event.
- Reuse of the same command identity with different bytes is a conflict.
- `peer_station_peer_id` is not trusted as authority input. Station resolves the
  peer Home Station from verified Actor Identity within the requested
  `federation_id`.
- Authority Station and authority epoch are derived from verified Station state,
  not supplied as trusted client values.

### AO-D07.2: Prepared Group Genesis Is The Only Group Creation Input

- Group preparation carries the explicit `federation_id`, proposed name, member
  Actor refs, creator endpoint, and caller-owned conversation identity.
- The preparation identity is `(conversation_id, authority_plan_id)`, and
  creation replay is `(conversation_id, command_id)`.
- Station validates Federation membership and persists one immutable authority
  plan containing name, canonical members, endpoint routes, KeyPackage
  reservations, authority scope, expiry, and plan hash.
- Group creation submits one canonical `ChatCommand` whose membership-transition
  payload references that plan ID/hash.
- Name, members, routes, and reservations are loaded from the persisted plan;
  clients do not resubmit a second competing creation description.

### AO-D07.3: One Local Command Route, One Remote Durable Transport

- `POST /conversation/command` accepts either:
  - a local raw `ChatCommand` from an actor device whose Home Station is the
    local Station and whose Conversation authority is local; or
  - an actor-device-signed `ConversationCommandProposal` for durable forwarding
    when authority is remote.
- Remote mutation crosses Stations only as a signed
  `FederatedDomainFrame`; no synchronous mutation fallback or direct HTTP
  mutation path is allowed.
- The Home Station persists the outgoing frame before reporting
  `accepted_for_forwarding`.
- The authority returns a terminal command result through the same durable
  Federation transport.
- The Home Station validates the result against the original outbox frame and
  enqueues a `COMMAND_RESULT` item into the caller device's canonical Device
  Inbox. No separate `conversation_command_proposals` truth store or polling
  route remains.

### AO-D07.4: `ConversationEvent` Is The Only Committed Event Truth

- `ConversationEvent` is used by command responses, creation responses, event
  queries, follower replay, authority sync, persistence, and Device Inbox
  delivery.
- `CommittedConversationEvent` and its dependent legacy response fields are
  deleted in the CA-W5 atomic cut.
- Client local projections may keep device-local event structures, but their
  Station wire source is `ConversationEvent`.

### AO-D07.5: Signed Social Mutation

- SEND, ACCEPT, and REJECT carry one actor-device-signed
  `FriendRequestCommand`.
- Every command carries explicit `federation_id`, sender and receiver Home
  Station identities, caller-owned command/request identity, signing key ID,
  expiry, and signature.
- The carried Home Station and Federation values are signed assertions, not
  trusted routing truth. The receiving Station resolves and verifies them
  against Actor Identity and active Federation membership before mutation.
- Station never synthesizes an actor signature.
- Receiver Home Station owns durable admission and resolution; result return
  uses shared Federation delivery.

### AO-D07.6: Exact Identity For Destructive Public-Material Reads

- Direct prekey and MLS KeyPackage destructive fetches carry caller-owned
  request identity.
- The replay identity is scoped to the authenticated requester, target resource,
  Home Station, and request ID; those fields are included in the exact
  deterministic request bytes.
- Exact retry returns the exact prior response; identity reuse with different
  request bytes is rejected before mutation.
- Peer reads and claims use canonical resource-owner protobufs with
  route-specific authenticated claims.
- DKX delivery uses shared durable Federation delivery rather than a second
  Conversation or Envelope transport.

## 4. Required Contract Consequences

- Amend `conversation_api.proto` for explicit creation identity/scope and one
  local-or-signed command submission envelope.
- Replace every active `CommittedConversationEvent` field with
  `ConversationEvent`.
- In every AO-D07-modified contract, name Station identity fields
  `*_station_peer_id`; `ConversationEvent.authority_station_peer_id` carries the
  verified authority Station identity.
- Keep `FriendRequestCommand` as the only Social mutation input.
- Add request identity and replay result storage to destructive Key Exchange
  operations.
- Register peer HTTP routes only from Federation; delegate to typed Actor
  Identity, Conversation, Key Exchange, and attachment ports.
- Delete the old command-proposal polling route/store, old synchronous remote
  mutation path, and all superseded generated symbols in the same CA-W5 cut.

## 5. Failure And Replay Semantics

| Condition | Required result |
|---|---|
| Exact command/request retry | Return the exact committed response without another mutation |
| Identity reused with different bytes | Typed conflict before mutation |
| Missing/invalid Federation membership | Typed authorization rejection before mutation |
| Missing/revoked actor-device key | Typed key rejection; no Station-synthesized signature |
| Remote transport unavailable | Durable pending/retry state; no synchronous fallback |
| Authority result does not match original outbox command hash | Terminal integrity conflict; no Device Inbox delivery |
| Unknown or stale event representation | Reject; do not translate through `CommittedConversationEvent` |

## 6. Alternatives Rejected

- Server-generated creation IDs: rejected because clients cannot safely replay
  an ambiguous timed-out mutation.
- Client-supplied authority epoch/Home Station as trusted truth: rejected
  because authority scope belongs to verified Station state.
- Keeping both event messages through a compatibility adapter: rejected by the
  atomic hard-cut rule.
- Keeping the proposal table and polling endpoint beside shared Federation:
  rejected as a second command-result truth.
- Reusing one generic peer token scope for all routes: rejected because claims
  and authorization differ by capability.

## 7. Consequences

Positive:

- Every mutation has a stable caller-owned identity and exact replay behavior.
- Conversation has one committed event type and one authority journal.
- Shared Federation remains the only cross-Station mutation transport.
- Actor, Key Exchange, Social, and Conversation retain their resource ownership.

Negative:

- Proto and all generated bindings must change atomically.
- Desktop and Mobile adapters must be regenerated and migrated in the same cut.
- Existing disposable v1 Chat data and pending command state require reset.
- No partial production deployment is valid while old and new contracts coexist.

## 8. Acceptance Gate

The Owner accepted AO-D07.1 through AO-D07.6 as one amendment on 2026-09-07.
CA-W5 resumes with proto-first changes, complete consumer migration, production
route registration, old-path deletion, and zero-diagnostic ownership Gates.

Architecture acceptance does not prove production cutover. CA-W5, Windows
NDR-W9-D, and Windows NDR-W10-D remain `UNPROVEN` until their execution and
runtime gates pass.
