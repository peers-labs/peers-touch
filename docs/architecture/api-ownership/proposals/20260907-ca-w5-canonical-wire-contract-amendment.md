# CA-W5 Canonical Wire Contract Amendment

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-09-07 | **Updated**: 2026-09-07
> **Owner**: Architecture Team
> **Module**: `model/domain/`, `apps/station/`, `packages/messaging-core/`, `apps/desktop/`, `apps/mobile/`

---

## 1. Document Scope

This amendment closes the six wire-contract gaps discovered while executing
CA-W5. It defines:

- caller-owned identity for Direct and Group creation;
- one local/remote Conversation command submission contract;
- `ConversationEvent` as the only committed Chat event truth;
- actor-device-signed public Friend Request mutations;
- typed peer contracts for remote Direct/MLS material and durable DKX;
- retry, replay, failure, and hard-deletion semantics for those contracts.

It does not change:

- Conversation as the sole Chat business authority and `/conversation/*` entry;
- Social as Friend Request and relationship authority;
- Key Exchange as Direct/MLS public-material and DKX owner;
- Federation as domain-neutral peer transport;
- Device Messaging Engine as a client-local crypto and durable queue runtime;
- the CA-W5 atomic hard-cut rule.

The proposal is `AO-D07`. No proto or production registration may implement this
proposal before Owner acceptance.

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| Direct creation cannot carry caller-owned retry identity | `verified_fact` | `model/domain/chat/conversation_api.proto` `CreateDirectConversationRequest` has only peer fields; Conversation DDD `CreateDirectRequest` requires `CommandID` and exact bytes | high | none |
| Group prepare is canonical but Group commit cannot carry its exact prepared command | `verified_fact` | `PrepareConversationGroupResponse`; Messaging Core persists an exact `ChatCommand`; public `CreateGroupConversationRequest` still carries the older membership type | high | none |
| Remote authority commands require an actor-device signature | `accepted_decision` | Federated IM D-17; Conversation DDD `ForwardedCommandRequest` | accepted | canonical active proto mapping |
| `ConversationEvent` replaced the ciphertext-bearing event shape | `accepted_decision` | Messaging Platform MP-D13; `model/domain/chat/event.proto`; Conversation DDD event sealer | accepted | complete old-type deletion |
| Public Friend Request mutations cannot carry the signed command required by Social | `verified_fact` | `relationship.proto` mutation requests versus `FederatedFriendRequestService.SubmitFriendRequestCommand` | high | canonical client wrappers |
| Direct bundle and plain MLS fetch consume one-time material | `verified_fact` | Key Exchange canonical store and service | high | exact-response replay contract |
| Shared Federation has no Key Exchange payload kind or complete peer fetch contracts | `verified_fact` | `model/domain/federation/delivery.proto`; Key Exchange `FederationPort` | high | canonical peer contracts |
| All six gaps can be closed without changing user-visible product behavior | `inference` | accepted AO-D01..AO-D06, MP-D13/18/19/30, Federated Social D-07, and existing DDD services | high | Owner architecture acceptance |

## 3. Governing Invariants

1. A client creates every durable command or destructive-read identity before the
   first network attempt and persists the exact deterministic protobuf bytes.
2. Authentication binds the request actor and device; request fields never replace
   JWT/device authentication.
3. Same identity plus the same canonical hash returns the same durable result.
4. Same identity plus a different canonical hash fails before mutation.
5. `ConversationEvent` is the only committed Conversation event on client, peer,
   persistence, query, result, and device-delivery boundaries.
6. A Home Station cannot create an actor signature for a remote authority command
   or Friend Request command.
7. Asynchronous delivery uses the shared durable Federation frame. Synchronous
   reads and destructive key-material claims use typed peer request/response
   capabilities.
8. A successful Home Station response means local durable admission unless an
   embedded terminal authority result proves more.
9. No alias, compatibility message, dual event model, fallback read, or second
   transport is retained after CA-W5.

## 4. Conversation Creation

### 4.1 Direct Creation

The caller creates, signs, and durably stores this command before submission:

```protobuf
message AcceptedRelationshipAuthorityFacts {
  uint32 format_version = 1;
  string relationship_id = 2;
  string federation_id = 3;
  ActorRef left_actor = 4;
  ActorRef right_actor = 5;
  string left_home_station_peer_id = 6;
  string right_home_station_peer_id = 7;
  int64 left_home_binding_epoch = 8;
  int64 right_home_binding_epoch = 9;
}

message DirectAuthorityBinding {
  AcceptedRelationshipAuthorityFacts relationship_facts = 1;
  string accepted_friend_request_event_id = 2;
  bytes accepted_friend_request_event_hash = 3;
  string authority_station_peer_id = 4;
  int64 authority_binding_epoch = 5;
  bytes binding_sha256 = 6;
}

message CreateDirectConversationCommandBody {
  uint32 format_version = 1;
  string command_id = 2;
  ActorDeviceRef creator = 3;
  ActorRef peer = 4;
  DirectAuthorityBinding authority_binding = 5;
  google.protobuf.Timestamp client_timestamp = 6;
  google.protobuf.Timestamp expires_at = 7;
}

message CreateDirectConversationCommandSigningInput {
  CreateDirectConversationCommandBody body = 1;
  string signing_key_id = 2;
  string authority_station_peer_id = 3;
}

message CreateDirectConversationCommand {
  CreateDirectConversationCommandBody body = 1;
  string signing_key_id = 2;
  string authority_station_peer_id = 3;
  bytes actor_device_signature = 4;
}

message CreateDirectConversationRequest {
  CreateDirectConversationCommand command = 1;
}

enum ConversationCreationDisposition {
  CONVERSATION_CREATION_DISPOSITION_UNSPECIFIED = 0;
  CONVERSATION_CREATION_DISPOSITION_CREATED = 1;
  CONVERSATION_CREATION_DISPOSITION_EXISTING = 2;
  CONVERSATION_CREATION_DISPOSITION_REPLAY = 3;
}

enum DirectConversationCreationSubmissionState {
  DIRECT_CONVERSATION_CREATION_SUBMISSION_STATE_UNSPECIFIED = 0;
  DIRECT_CONVERSATION_CREATION_SUBMISSION_STATE_HOME_ACCEPTED = 1;
  DIRECT_CONVERSATION_CREATION_SUBMISSION_STATE_RETRY_WAIT = 2;
  DIRECT_CONVERSATION_CREATION_SUBMISSION_STATE_AUTHORITY_RESOLVED = 3;
  DIRECT_CONVERSATION_CREATION_SUBMISSION_STATE_TERMINAL_REJECTED = 4;
}

message DirectConversationCreationResult {
  string command_id = 1;
  string conversation_id = 2;
  bytes command_sha256 = 3;
  ConversationCreationDisposition disposition = 4;
  Conversation conversation = 5;
  ConversationEvent creation_event = 6;
  ConversationCommandRejectCode reject_code = 7;
}

message DirectConversationCreationSubmission {
  string command_id = 1;
  DirectConversationCreationSubmissionState state = 2;
  DirectConversationCreationResult result = 3;
  google.protobuf.Timestamp next_retry_at = 4;
}

message CreateDirectConversationResponse {
  DirectConversationCreationSubmission submission = 1;
}

message GetDirectConversationCreationResultRequest {
  string command_id = 1;
}

message GetDirectConversationCreationResultResponse {
  DirectConversationCreationSubmission submission = 1;
}
```

Rules:

- accepted Social relationship convergence creates immutable
  `AcceptedRelationshipAuthorityFacts`; Direct creation without that proof is
  rejected;
- `left_actor` and `right_actor` in those facts are bytewise-sorted canonical
  PTIDs;
- the accepted Friend Request event embeds only those relationship facts in its
  hash input; its post-commit projection attaches the accepted event ID/hash;
- Social emits those facts only when both actor identity projections report
  `home_binding_epoch = 1` with no migration marker. Home migration has no v1
  activation path and therefore cannot mint contradictory accepted facts;
- Conversation, not Social, derives authority as the accepted-event Home Station
  of `left_actor`, sets `authority_binding_epoch = 1`, and computes
  `binding_sha256` over the relationship facts, accepted event ID/hash, selected
  authority, and binding epoch;
- the elected authority transaction locks the deterministic Direct ID, loads the
  accepted Social relationship projection, recomputes and validates the exact
  Conversation binding before any Conversation or receipt mutation;
- the non-authority Home Station durably forwards the signed creation command
  through shared Federation delivery;
- the authenticated PTID and device must equal `command.body.creator`;
- `conversation_id` remains deterministically derived from the sorted actor pair;
- any different binding hash or epoch for the same deterministic Direct ID is an
  authority conflict with zero mutation;
- an existing Direct keeps its recorded authority when either actor later moves.
  Authority handover is a separate future protocol; until accepted, the
  conversation is read-only if that authority is unavailable;
- the initial authority epoch is server-derived;
- the actor signature covers a domain separator plus deterministic
  `CreateDirectConversationCommandSigningInput` bytes, including the selected
  authority Station;
- the exact signature input is
  `ASCII("peers-touch/create-direct-conversation") + 0x00 +` deterministic
  protobuf bytes;
- the signed command lifetime is positive and at most five minutes;
- `command_sha256` is SHA-256 of deterministic signed
  `CreateDirectConversationCommand` bytes;
- `(conversation_id, command_id, command_sha256)` is the authority identity;
- exact retry returns the original `ConversationEvent` with `REPLAY`;
- the same command ID with another hash returns `COMMAND_CONFLICT`;
- a new command ID for an already existing, matching actor-pair Direct returns the
  existing conversation and original creation event with `EXISTING`; the authority
  records the new no-op receipt against that event so its retry is exact;
- an occupied deterministic ID with different participants or authority scope is an
  integrity conflict, never an `EXISTING` result;
- concurrent creation at opposite Home Stations converges at the same elected
  authority and cannot create two event logs for the deterministic ID;
- local durable admission at a non-authority Home Station returns
  `HOME_ACCEPTED` or `RETRY_WAIT`, never a fabricated Conversation;
- the authority returns a terminal creation result through a typed
  `CONVERSATION_DIRECT_CREATE_RESULT` Federation frame;
- every terminal result, including a rejection, contains mandatory `command_id`,
  deterministic `conversation_id`, `command_sha256`, and reject/disposition
  fields; `conversation` and `creation_event` are required only for created,
  existing, or replay results;
- response loss and restart recover through
  `GET /conversation/direct/result`;
- the HTTP result does not advance the Device Engine authority head; ordered
  Device Inbox consumption remains the projection boundary.

Remote Direct creation uses these typed payload kinds through
`POST /federation/delivery`:

```text
CONVERSATION_DIRECT_CREATE_COMMAND -> CreateDirectConversationCommand
CONVERSATION_DIRECT_CREATE_RESULT  -> DirectConversationCreationResult
```

### 4.2 Group Genesis

The existing prepare response remains the only source for the hidden authority
plan. Commit uses one canonical command:

```protobuf
message CreateGroupConversationRequest {
  ChatCommand genesis_command = 1;
}

message CreateGroupConversationResponse {
  Conversation conversation = 1;
  ConversationEvent creation_event = 2;
  bytes command_sha256 = 3;
  bool replay = 4;
  ConversationCommandRejectCode reject_code = 5;
}
```

Rules:

- `genesis_command` must contain a `membership_transition`;
- its sender must equal the authenticated endpoint;
- its sender must also equal the stored plan requester/creator; another
  authenticated endpoint cannot consume the plan;
- its source membership and MLS epochs are zero and its target MLS epoch is one;
- `delivery_plan_sha256` and the transition's `authority_plan_sha256` must both
  equal the loaded plan hash;
- plan ID/hash, conversation ID, authority Station/epoch, source epochs, ordered
  membership changes, pre/post/added/removed endpoint sets, and reserved
  KeyPackage IDs/hashes must exactly match the loaded plan;
- the exact command separately binds transition ID, target epoch, opaque MLS
  Commit bytes/hash, and every Welcome recipient/payload hash; Welcome targets
  must equal the plan's added endpoints and use only its exact reservations;
- the Station derives name, members, Federation scope, authority, endpoint set,
  and reserved KeyPackages from the stored plan;
- no duplicate top-level name, member, plan, delivery, or Federation fields remain;
- stale or expired plan is terminal for that command attempt and creates no
  Conversation, event, member, receipt, queue, outbox, or consumed KeyPackage;
- retry after a stale plan requires a fresh plan, command ID, exact command bytes,
  and pending OpenMLS state.

## 5. Conversation Command And Event Truth

### 5.1 Canonical Submission

`ConversationCommandProposal` moves to the canonical command contract and wraps
`ChatCommand`, not the superseded `ConversationCommand`.

```protobuf
message ConversationCommandProposal {
  uint32 format_version = 1;
  string federation_id = 2;
  string authority_station_peer_id = 3;
  int64 authority_epoch = 4;
  string home_station_peer_id = 5;
  ActorDeviceRef actor = 6;
  string actor_signing_key_id = 7;
  ChatCommand command = 8;
  bytes command_sha256 = 9;
  google.protobuf.Timestamp created_at = 10;
  google.protobuf.Timestamp expires_at = 11;
  bytes actor_device_signature = 12;
}

message ConversationCommandProposalSigningInput {
  uint32 format_version = 1;
  string federation_id = 2;
  string authority_station_peer_id = 3;
  int64 authority_epoch = 4;
  string home_station_peer_id = 5;
  string conversation_id = 6;
  string command_id = 7;
  ConversationCommandKind command_kind = 8;
  ActorDeviceRef actor = 9;
  string actor_signing_key_id = 10;
  bytes command_sha256 = 11;
  google.protobuf.Timestamp created_at = 12;
  google.protobuf.Timestamp expires_at = 13;
}

message SubmitConversationAuthorityCommandRequest {
  oneof submission {
    ChatCommand local_authority_command = 1;
    ConversationCommandProposal remote_authority_proposal = 2;
  }
}

enum ConversationCommandResultKind {
  CONVERSATION_COMMAND_RESULT_KIND_UNSPECIFIED = 0;
  CONVERSATION_COMMAND_RESULT_KIND_ACCEPTED = 1;
  CONVERSATION_COMMAND_RESULT_KIND_TERMINAL_REJECTED = 2;
}

enum ConversationCommandSubmissionState {
  CONVERSATION_COMMAND_SUBMISSION_STATE_UNSPECIFIED = 0;
  CONVERSATION_COMMAND_SUBMISSION_STATE_HOME_ACCEPTED = 1;
  CONVERSATION_COMMAND_SUBMISSION_STATE_SUBMITTED = 2;
  CONVERSATION_COMMAND_SUBMISSION_STATE_RETRY_WAIT = 3;
  CONVERSATION_COMMAND_SUBMISSION_STATE_ACCEPTED = 4;
  CONVERSATION_COMMAND_SUBMISSION_STATE_TERMINAL_REJECTED = 5;
}

message ConversationCommandResult {
  string conversation_id = 1;
  string command_id = 2;
  bytes command_sha256 = 3;
  ConversationCommandResultKind kind = 4;
  ConversationEvent event = 5;
  ConversationCommandRejectCode reject_code = 6;
}

message ConversationCommandSubmission {
  ConversationCommandSubmissionState state = 1;
  ConversationCommandResult result = 2;
  google.protobuf.Timestamp next_retry_at = 3;
}

message SubmitConversationAuthorityCommandResponse {
  ConversationCommandSubmission submission = 1;
  PrepareConversationCommandResponse current_plan = 2;
}

message ConversationCommandResultDelivery {
  string conversation_id = 1;
  string command_id = 2;
  ConversationCommandSubmissionState state = 3;
  ConversationCommandResult result = 4;
}
```

The route remains:

```text
POST /conversation/command
```

Rules:

- local authority requires `local_authority_command` and authenticated endpoint
  binding;
- remote authority requires `remote_authority_proposal`, including the device
  signature over the complete proposal signing input;
- `command_sha256` is SHA-256 of deterministic `ChatCommand` bytes;
- `actor_device_signature` is Ed25519 over
  `ASCII("peers-touch/conversation-command-proposal") + 0x00 +`
  deterministic `ConversationCommandProposalSigningInput` bytes;
- the verifier requires exact equality among proposal, signing input, command,
  authenticated endpoint, verified actor-device key, Home Station token,
  Federation scope, authority Station/epoch, command kind/hash, and immutable
  creation/expiry times;
- the Home Station token binds the same fields, has the authority as audience,
  and expires within 60 seconds without changing actor-signed bytes;
- a raw command for a remote authority is rejected;
- a signed proposal for a local-authority command is rejected as the wrong
  submission form;
- Home durable admission returns `HOME_ACCEPTED`, `SUBMITTED`, or `RETRY_WAIT`;
- only an authority receipt can produce `ACCEPTED` or `TERMINAL_REJECTED`;
- retryable transport/admission outcomes do not become terminal authority
  results and retain the original signed proposal.

### 5.2 Durable Result Readback

Response loss and restart are recovered through:

```protobuf
message GetConversationCommandResultRequest {
  string conversation_id = 1;
  string command_id = 2;
}

message GetConversationCommandResultResponse {
  ConversationCommandSubmission submission = 1;
}
```

```text
GET /conversation/command/result
```

The authenticated actor may read only its own submission. Home Station stores a
terminal authority result and the addressed originating-device notification in
one transaction.

### 5.3 Peer Delivery

Remote command proposals and results use typed payloads inside:

```text
POST /federation/delivery
```

The retained payload kinds are:

```text
CONVERSATION_AUTHORITY_COMMAND -> ConversationCommandProposal
CONVERSATION_AUTHORITY_RESULT  -> ConversationCommandResultDelivery
```

The specialized peer mutation route
`/federation/conversation/command-proposal` is removed. Peer read capabilities
such as command preparation and authority event synchronization remain separate
typed request/response routes because they return data synchronously and do not
represent durable delivery.

### 5.4 One Event Type

These fields all become `ConversationEvent`:

- creation responses;
- command results and result deliveries;
- client event history;
- message and thread queries;
- peer authority-event synchronization;
- follower apply;
- persisted canonical event bytes;
- Device Inbox `DeviceEventDelivery`.

`CommittedConversationEvent` and its payload family are deleted after all
consumers move. A permanent translator between old and new events is forbidden
because it would preserve two hash inputs and two authority truths.

## 6. Signed Friend Request Mutations

The native Social adapter constructs `FriendRequestCommand`, and the client
Actor Identity signer signs it with the enrolled device key. TypeScript supplies
user intent only; Device Messaging Engine does not own Social command state.

```protobuf
enum FriendRequestCommandSubmissionState {
  FRIEND_REQUEST_COMMAND_SUBMISSION_STATE_UNSPECIFIED = 0;
  FRIEND_REQUEST_COMMAND_SUBMISSION_STATE_HOME_ACCEPTED = 1;
  FRIEND_REQUEST_COMMAND_SUBMISSION_STATE_SUBMITTED = 2;
  FRIEND_REQUEST_COMMAND_SUBMISSION_STATE_RETRY_WAIT = 3;
  FRIEND_REQUEST_COMMAND_SUBMISSION_STATE_AUTHORITY_RESOLVED = 4;
  FRIEND_REQUEST_COMMAND_SUBMISSION_STATE_TERMINAL_FAILED = 5;
}

message FriendRequestCommandSubmission {
  string command_id = 1;
  string request_id = 2;
  FriendRequestCommandSubmissionState state = 3;
  FriendRequestCommandResult result = 4;
  FriendRequestCommandErrorCode last_error_code = 5;
  bool duplicate = 6;
  google.protobuf.Timestamp retry_after = 7;
}

message SendSocialFriendRequestRequest {
  FriendRequestCommand command = 1;
}

message AcceptSocialFriendRequestRequest {
  FriendRequestCommand command = 1;
}

message RejectSocialFriendRequestRequest {
  FriendRequestCommand command = 1;
}

message GetSocialFriendRequestCommandResultRequest {
  string authority_station_peer_id = 1;
  string command_id = 2;
}

message GetSocialFriendRequestCommandResultResponse {
  FriendRequestCommandSubmission submission = 1;
}
```

Each response contains one `FriendRequestCommandSubmission`. The route validates
that the signed command action matches `send`, `accept`, or `reject`, and binds
JWT PTID plus the device header to `authorizing_device`.

Principal equations are mandatory:

```text
SEND:
  authorizing_device.actor == sender
  source Home Station == sender Home Station
  authority Station == receiver Home Station

ACCEPT | REJECT:
  authorizing_device.actor == receiver
  source Home Station == receiver Home Station == authority Station
  persisted pending request sender/receiver == command sender/receiver
```

The verified actor-device key must match `signing_key_id`; a self-supplied public
key is never accepted.

The exact signature is:

```text
Ed25519.Sign(
  enrolled_actor_device_private_key,
  ASCII("peers-touch/friend-request-command") + 0x00
  + deterministic_protobuf(FriendRequestCommandSigningInput)
)
```

The signing input contains the complete command body and `signing_key_id`.
Unknown protobuf fields, JSON canonicalization, and signatures over only the
request ID or action are forbidden.

`SocialFriendRequest` adds:

- sender Home Station peer ID;
- receiver Home Station peer ID;
- authority Station peer ID;
- `authority_confirmed`.

An `ACCEPTED` `FriendRequestEvent` carries only
`AcceptedRelationshipAuthorityFacts` in its canonical hash input. After commit,
its `SocialFriendRequest` projection exposes those facts plus the accepted event
ID/hash. Conversation consumes that Social proof and derives its own
`DirectAuthorityBinding`; Social never selects or certifies Conversation
authority. Non-accepted events and projections must not carry relationship
authority facts.

This is enough for clients to construct a later signed decision and distinguish a
sender-local provisional projection from receiver-authority truth.

Durable readback uses:

```text
GET /api/v1/social/friend-request/command/result
```

keyed by authority Station and command ID. Exact retry returns the current
submission. Same-Station operations still traverse the durable outbox, local
Federation adapter, typed Social receiver, and result return path.

Readback authorization and reconciliation are:

- JWT PTID must equal the actor that authorized the outgoing command;
- the device header must identify any currently active device of that actor;
- the sender Home Station command record is the only client-readable submission
  source of truth;
- the receiver authority command record is the terminal business source of truth;
- only an exact, verified `FriendRequestCommandResult` frame can move a remote
  Home record to `AUTHORITY_RESOLVED`;
- the Home Station never infers authority success from transport disposition,
  local projection state, or timeout;
- if a terminal result frame is lost, the Home Station retries the original
  signed command; receiver exact replay recreates the same result frame, and the
  readback remains non-terminal until that frame is durably applied;
- same-Station loopback commits authority result, outgoing record, and projection
  through the same transaction/receiver semantics before readback reports
  `AUTHORITY_RESOLVED`.

HTTP success is not remote materialization. `ACCEPT` or `REJECT` does not alter
client business truth until the authority result/event is projected. Direct
Conversation creation starts only after accepted relationship convergence.

## 7. Federated Key Exchange

### 7.1 Destructive Fetch Identity

Both Direct bundle fetch and plain MLS KeyPackage fetch consume one-time public
material. Their client requests gain caller-owned `request_id`, `created_at`,
and `expires_at` fields. The Key Exchange owner persists the exact response
under:

```text
(authenticated requester endpoint, request_id, canonical request hash)
```

Receipt lookup precedes expiry validation:

1. same identity/hash with a retained full response returns identical bytes,
   including after request expiry;
2. same identity with another hash returns conflict;
3. a retained tombstone returns `RESPONSE_RETIRED` and consumes no material;
4. only a previously unseen identity reaches expiry validation and possible
   material consumption.

The request lifetime is positive and at most five minutes, with at most 30
seconds of accepted clock skew. The complete response receipt is retained until
exactly 24 hours after request expiry. After that instant, identical bytes are
no longer promised: the response is replaced atomically by an
identity/hash/outcome tombstone retained for 30 days. An unseen expired request
returns `REQUEST_EXPIRED`; a tombstoned retry returns `RESPONSE_RETIRED`.
Neither consumes material. There is no client ACK requirement; callers use a
new request ID only for a new fetch intent.

Plain MLS fetch is not used for Group genesis or membership. Those operations
must use authority-plan claim.

### 7.2 Typed Peer Reads And Claims

Synchronous peer capabilities are:

```text
POST /federation/key-exchange/keys/bundle/fetch
POST /federation/key-exchange/mls-key-package/fetch
POST /federation/key-exchange/mls-key-package/claim
```

The canonical wrappers bind:

```text
FederatedDirectBundleFetchRequest
  requester ActorDeviceRef
  query FetchDirectKeyBundlesRequest

FederatedDirectBundleFetchResponse
  request_id                     # echoes query.request_id
  home_station_peer_id
  result FetchDirectKeyBundlesResponse

FederatedMlsKeyPackageFetchRequest
  requester ActorDeviceRef
  query FetchMlsKeyPackageRequest

FederatedMlsKeyPackageFetchResponse
  request_id                     # echoes query.request_id
  home_station_peer_id
  result FetchMlsKeyPackageResponse

FederatedMlsKeyPackageClaimRequest
  federation_id
  conversation_id
  authority_plan_sha256
  claim ClaimMlsKeyPackageRequest

FederatedMlsKeyPackageClaimResponse
  result ClaimMlsKeyPackageResponse
```

Each response also carries:

```text
FederatedKeyExchangeDisposition
  FULFILLED | UNAVAILABLE | DUPLICATE |
  RETRYABLE_REJECTION | TERMINAL_REJECTION | HASH_CONFLICT

FederatedKeyExchangeErrorCode
  INVALID_REQUEST | UNAUTHENTICATED_SOURCE | WRONG_TARGET |
  REQUEST_EXPIRED | RESPONSE_RETIRED | MATERIAL_UNAVAILABLE | RATE_LIMITED |
  IDENTITY_PROJECTION_UNAVAILABLE |
  REQUEST_HASH_CONFLICT | PLAN_CONFLICT

retry_after
```

Peer authentication binds source Station, target Station, request hash, requester
or authority-plan identity, and a maximum 60-second token. The signed claims are:

```text
KeyExchangePeerAuthorizationClaims
  scope
  token_id
  issuer_station_peer_id
  audience_station_peer_id
  request_sha256
  requester ActorDeviceRef
  authority_plan_id
  issued_at
  expires_at
  signing_key_id
```

The verifier requires `issuer == authenticated source`, `audience == local
Station`, exact request hash and identity binding, `expires_at - issued_at <= 60
seconds`, and at most 30 seconds of clock skew. An exact token replay for the
same request is allowed within its lifetime; the same token ID with another
request hash is rejected. Signing keys are resolved from the active Federation
peer identity projection; revoked keys are terminal and a temporarily stale
projection is retryable.

Key Exchange owns validation, one-time material mutation, exact-response
receipts, and typed errors. Federation owns authentication, request bounds,
routing, and route registration.

Route-specific equations are mandatory:

```text
Direct bundle fetch | plain MLS fetch:
  request_sha256 == SHA-256(deterministic protobuf complete peer wrapper)
  issuer == requester verified current Home Station
  audience == target actor/device verified current Home Station == local Station
  requester device is ACTIVE at issuer
  nested query request_id/created_at/expires_at are complete and canonical

MLS authority-plan claim:
  request_sha256 == SHA-256(deterministic protobuf complete claim wrapper)
  issuer == wrapper.claim.authority_station_peer_id
  issuer == current Conversation authority for wrapper.conversation_id
  audience == claim.target verified current Home Station == local Station
  wrapper federation/conversation/plan hash and claim ID/target/expiry match the
  canonical authority plan
```

Valid response combinations are:

| Disposition | Result | Error | Retry |
|---|---|---|---|
| `FULFILLED` | required | unspecified | absent |
| `DUPLICATE` | exact retained result required | unspecified | absent |
| `UNAVAILABLE` | absent | `MATERIAL_UNAVAILABLE` | optional bounded hint |
| `RETRYABLE_REJECTION` | absent | `RATE_LIMITED` or `IDENTITY_PROJECTION_UNAVAILABLE` | required |
| `TERMINAL_REJECTION` | absent | invalid, unauthenticated, wrong target, expired, retired, or plan conflict | absent |
| `HASH_CONFLICT` | absent | `REQUEST_HASH_CONFLICT` | absent |

Any other result/error/retry combination is an invalid peer response and cannot
resolve or mutate a fetch receipt.

`MlsKeyPackageReservation` is self-contained and includes:

- authority plan ID when plan-bound;
- Home Station peer ID;
- plan expiry when plan-bound;
- irreversible-consumption state.

Claim identity is:

```text
(authenticated authority Station, authority plan ID, target endpoint)
```

The same canonical claim returns the original package. Changed plan hash, target,
scope, or expiry conflicts. A consumed package is never rolled back.

### 7.3 Durable DKX

The client `SendDirectKeyExchangeRequest` gains caller-owned `delivery_id`.
The typed peer payload is:

```text
FederatedDirectKeyExchangeDelivery
  format_version
  delivery_id
  sender ActorDeviceRef
  sender_home_station_peer_id
  recipient ActorDeviceRef
  recipient_home_station_peer_id
  session_id
  session_generation
  payload_kind
  opaque_key_material
  conversation_id
```

The target Home Station returns a durable, target-signed admission proof:

```protobuf
message DirectKeyExchangeAdmissionSigningInput {
  uint32 format_version = 1;
  string delivery_id = 2;
  ActorDeviceRef sender = 3;
  ActorDeviceRef recipient = 4;
  string conversation_id = 5;
  string session_id = 6;
  uint64 session_generation = 7;
  DirectKeyExchangePayloadKind payload_kind = 8;
  bytes delivery_sha256 = 9;
  string target_home_station_peer_id = 10;
  string target_inbox_item_id = 11;
  int64 target_lane_sequence = 12;
  google.protobuf.Timestamp admitted_at = 13;
  string signing_key_id = 14;
}

message DirectKeyExchangeAdmissionProof {
  DirectKeyExchangeAdmissionSigningInput input = 1;
  bytes target_station_signature = 2;
}
```

The signature is Ed25519 over
`ASCII("peers-touch/direct-key-exchange-admission") + 0x00 +` deterministic
signing-input bytes. `delivery_sha256` is SHA-256 of the complete deterministic
`FederatedDirectKeyExchangeDelivery` bytes. The proof is returned through
`FEDERATED_DOMAIN_PAYLOAD_KIND_KEY_EXCHANGE_DIRECT_ADMISSION`; target inbox
insert, lane allocation, proof construction, and return-outbox insertion are one
target transaction.

It uses the shared durable route:

```text
POST /federation/delivery
FEDERATED_DOMAIN_PAYLOAD_KIND_KEY_EXCHANGE_DIRECT_DELIVERY
FEDERATED_DOMAIN_PAYLOAD_KIND_KEY_EXCHANGE_DIRECT_ADMISSION
```

`delivery_id` binds the client retry, frame payload ID, frame idempotency key,
and target Device Inbox item. Same ID plus different bytes is a hash conflict.
The target transaction commits Federation inbox dedup and the target-owned Device
Inbox row together.

Client-visible submission state is:

```protobuf
enum DirectKeyExchangeSubmissionState {
  DIRECT_KEY_EXCHANGE_SUBMISSION_STATE_UNSPECIFIED = 0;
  DIRECT_KEY_EXCHANGE_SUBMISSION_STATE_HOME_ACCEPTED = 1;
  DIRECT_KEY_EXCHANGE_SUBMISSION_STATE_RETRY_WAIT = 2;
  DIRECT_KEY_EXCHANGE_SUBMISSION_STATE_TARGET_ADMITTED = 3;
  DIRECT_KEY_EXCHANGE_SUBMISSION_STATE_TERMINAL_REJECTED = 4;
}

message DirectKeyExchangeSubmission {
  string delivery_id = 1;
  DirectKeyExchangeSubmissionState state = 2;
  FederatedKeyExchangeErrorCode last_error_code = 3;
  google.protobuf.Timestamp next_retry_at = 4;
  DirectKeyExchangeAdmissionProof admission = 5;
}

message GetDirectKeyExchangeResultRequest {
  string delivery_id = 1;
}

message GetDirectKeyExchangeResultResponse {
  DirectKeyExchangeSubmission submission = 1;
}
```

`SendDirectKeyExchangeResponse` contains the same submission, and durable
readback uses:

```text
GET /key-exchange/dkx/result
```

Frame acceptance means target durable admission, not device consumption. The
source Home Station records `TARGET_ADMITTED` only from the authenticated target
admission frame and exact signed proof.

When a Direct endpoint payload depends on a newly established session, its
`PreparedEndpointPayload` carries the exact
`DirectKeyExchangeAdmissionProof`. The proof recipient, session ID, DKX payload
kind, session generation, conversation ID, complete delivery hash, target
Station, inbox item, and lane sequence must match the decoded Direct
ciphertext/session dependency. The Conversation authority verifies the target
Station signature and current endpoint route before committing the message.

The canonical `PreparedEndpointPayload` gains:

```protobuf
DirectKeyExchangeAdmissionProof required_dkx_admission = 5;
```

The Device Engine may submit the dependent command only after
`TARGET_ADMITTED`. The later Conversation delivery then reaches the target Home
Station after the proven DKX row and receives a greater lane sequence, so the
fenced lane consumer processes DKX first without a separate device-consumption
receipt. Already established session generations omit the proof; a new
generation without its exact proof is rejected. Realtime may wake status
reconciliation but is never the state source.

## 8. Failure And Recovery Semantics

| Failure | Required outcome |
|---|---|
| Direct or Group exact retry | original event/result, no second sequence or fan-out |
| Direct authority binding differs from accepted Social event or existing Conversation | authority conflict; zero mutation |
| command ID with another hash | terminal conflict before mutation |
| stale Group plan | terminal attempt; zero shared mutation; prepare a new attempt |
| Group plan submitted by another endpoint | unauthorized; plan remains unconsumed |
| remote raw Chat command | reject; actor signature cannot be synthesized by Home Station |
| missing/revoked actor signing key | retryable unavailable or terminal revoked, respectively |
| lost Home response | recover by exact retry or command-result readback |
| old Conversation event payload | reject after hard cut; no translation fallback |
| unsigned Friend Request mutation | reject before local command/outbox persistence |
| Friend Request transport outage | retain exact signed command and expose non-terminal submission state |
| destructive key fetch retry | return exact stored material; do not consume another key |
| unseen destructive key fetch after signed expiry | return `REQUEST_EXPIRED`; do not consume material |
| destructive key fetch after full-response retention | return `RESPONSE_RETIRED`; do not consume material |
| DKX frame duplicate | no-op with the same target inbox item |
| DKX frame hash conflict | terminal security conflict before target inbox mutation |
| DKX target not yet admitted | keep dependent traffic durably blocked and retry exact frame |
| missing or mismatched DKX admission proof | reject dependent command before authority mutation |

## 9. Deletion Obligations

CA-W5 must remove:

- `CommittedConversationEvent` and its old payload family;
- old `ConversationCommand` and proposal wrappers that reference it;
- `/conversation/command-proposal`;
- `/federation/conversation/command-proposal`;
- unsigned Friend Request mutation request shapes and optimistic final-state callers;
- direct Mobile Web Friend Request network mutation ownership;
- old Social local-only service/repository wiring and duplicate relationship truth;
- raw JSON or Chat-owned Key Exchange peer adapters;
- non-idempotent destructive key fetches;
- synchronous remote DKX delivery;
- any regenerated binding for a superseded symbol.

## 10. Architecture Gates

The amendment is complete only when:

1. deterministic proto generation produces one command/event family for Go,
   Desktop, Mobile, and Messaging Core;
2. exact retry and hash-conflict tests cover Direct create, Group genesis,
   Conversation command, Friend Request command, Direct bundle fetch, MLS fetch,
   MLS claim, and DKX;
3. opposite-Home Direct create, binding hash/epoch conflict, actor migration
   after relationship acceptance, and concurrent retries converge or fail closed
   without two authority logs;
4. foreign-requester Group plan submission and every plan/command mismatch
   preserve plan, KeyPackages, and Conversation state;
5. local and remote Conversation commands reach the same DDD authority service;
6. event/result/query/follower/device-delivery paths contain zero
   `CommittedConversationEvent`;
7. all Friend Request mutation routes reject unsigned, wrong-action, and
   wrong-principal commands, and lost result delivery converges by exact replay;
8. same-Station Friend Request uses the same durable receiver path;
9. peer Key Exchange requests enforce route-specific Station authentication,
   response-state validity, exact-response replay, and tombstone behavior;
10. DKX outage/restart/duplicate/hash-conflict tests prove target-owned durable
    Device Inbox admission and reject dependent commands without the exact
    target-signed proof;
11. ownership registry and zero-reference Gates pass;
12. CA-W5 still lands as one production cut with no partial registration.

## 11. Review Record

Four focused contract audits and four iterative independent blocker reviews were
run against the verified CA-W5 worktree. The reviews initially rejected:

- mutable Direct authority election and a circular relationship-event hash;
- incomplete Group plan/principal equality;
- under-bound Conversation and Friend Request signatures;
- ambiguous Social result recovery;
- destructive key-material retry without bounded receipts;
- unenforceable peer Key Exchange trust equations;
- DKX dependency ordering without a target-signed admission proof;
- Social selection of Conversation authority.

Each finding is resolved in this proposal. The final independent blocker review
on 2026-09-07 reported zero P0/P1 findings and returned:

```text
APPROVE AO-D07
```

This is architecture-review evidence only. Owner acceptance remains mandatory.

## 12. Decision Requested

Accept `AO-D07` as one package:

- caller-owned deterministic creation and destructive-read identities;
- typed local-versus-remote command submission through one Conversation client route;
- `ConversationEvent` as the only committed Chat event truth;
- signed Social mutation requests with durable submission state;
- typed synchronous peer Key Exchange reads/claims;
- durable DKX through shared Federation delivery;
- atomic deletion of every replaced contract and route.

There is no user-visible product choice in this amendment. It makes the already
accepted authority, security, retry, and ownership semantics expressible on the
wire.
