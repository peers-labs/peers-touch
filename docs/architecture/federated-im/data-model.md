# Federated IM Architecture — Data Model

> **Status**: draft
> **Version**: v0.4
> **Created**: 2026-07-04 | **Updated**: 2026-08-03
> **Owner**: Architecture Team
> **Module**: `model/domain/actor/`, `model/domain/chat/`, `model/domain/federation/`, `apps/station/app/subserver/conversation/`, `apps/station/frame/touch/actor/`

> **v1 unification update (2026-07-11)**: Per D-08…D-12 (see `decisions.md`), group
> E2EE is MLS (RFC 9420), not Sender Keys. The "SKDM envelope" below is now the MLS
> **key-delivery envelope** (Welcome/Commit/KeyPackage) carried over the single
> Station signaling channel (D-10). Message ciphertext headers carry MLS
> epoch/framing, not a Sender Key ID.

---

## 1. Model Boundary

This document defines conceptual data contracts. Implementation must be proto-first:

- cross-Station payloads belong under `model/domain/federation/` or `model/domain/chat/`;
- Station persistence may use database tables, but database rows must not become the wire contract;
- cross-Station identity must use ActorRef semantics, not local actor IDs;
- signed payload hashes must use deterministic protobuf canonical bytes, not JSON canonicalization;
- generated files are not source of truth.

## 2. Federated Actor Reference

```text
FederatedActorRef
  actor_id_local_hint
  home_station_peer_id
  federated_handle
  actor_identity_public_key
  profile_version
  federation_id
```

Rules:

- `actor_id_local_hint` is optional and meaningful only to the actor's Home Station.
- `home_station_peer_id` is required for cross-Station authorization and routing.
- `federated_handle` is display and resolve metadata, not the only security identity.
- Authority Station must validate the actor's Home Station is active in `federation_id`.

## 3. Federated Group

```text
FederatedGroup
  group_ulid
  federation_id
  authority_station_peer_id
  authority_epoch
  membership_epoch
  status
  owner_actor_ref
  created_by_actor_ref
  created_at_unix_ms
  dissolved_at_unix_ms
  last_committed_seq
  last_event_hash
  history_policy
```

Status:

```text
active
read_only_degraded
orphaned_read_only
dissolved_read_only
```

Invariants:

- `(group_ulid, authority_station_peer_id)` uniquely identifies a federated group truth stream.
- `authority_epoch` changes only through a future signed handover/recovery event.
- `membership_epoch` changes on join, add, leave, remove, and membership policy changes.
- `dissolved_read_only` rejects all write commands except per-actor local projection settings.

## 4. Federated Group Member

```text
FederatedGroupMember
  group_ulid
  actor_ref
  role
  membership_status
  joined_at_seq
  left_at_seq
  removed_at_seq
  invited_by_actor_ref
  joined_membership_epoch
  last_entitled_membership_epoch
```

Role:

```text
owner
admin
member
```

Membership status:

```text
invited
joined
left
removed
```

Rules:

- A member's authority is group-local, not Federation governance authority.
- Owner/admin role changes do not change `authority_station_peer_id`.
- Removed and left members are not entitled to future event delivery or future MLS group secrets (they are removed from the MLS group by the corresponding Commit).

## 5. Group Event Log

```text
GroupEvent
  event_id
  group_ulid
  federation_id
  authority_station_peer_id
  authority_epoch
  group_seq
  prev_event_hash
  event_hash
  event_type
  payload_bytes
  payload_hash
  actor_ref
  actor_signature
  home_station_peer_id
  home_station_signature
  authority_station_signature
  committed_at_unix_ms
```

Event types:

```text
GroupCreated
GroupInvitationCreated
GroupMemberJoined
GroupMemberLeft
GroupMemberRemoved
GroupMemberUpdated
GroupOwnershipTransferred
GroupMessageCommitted
GroupMessageRecalled
GroupMessageEdited
GroupMessageDeleted
GroupSettingsChanged
GroupDissolved
GroupAuthorityChanged   // reserved, not Foundation Profile write path
```

Validation:

```text
group_seq == previous_seq + 1
prev_event_hash == current_group_head_hash
event_hash == hash(canonical(event_type, payload_hash, prev_event_hash, group_seq, group_ulid))
actor_signature is valid for actor_ref
home_station_signature is valid for actor_ref.home_station_peer_id
authority_station_signature is valid for authority_station_peer_id
actor is allowed for event_type
home_station_peer_id is active in federation_id
```

## 6. Retired Remote Proposal Model

```text
GroupProposal
  proposal_id
  group_ulid
  federation_id
  authority_station_peer_id
  observed_authority_epoch
  observed_membership_epoch
  proposed_event_type
  payload_bytes
  payload_hash
  actor_ref
  actor_signature
  home_station_peer_id
  home_station_signature
  idempotency_key
  created_at_unix_ms
```

`GroupProposal` and `GroupProposalResult` are historical contracts. They return
the retired `GroupEvent` truth model, do not wrap the canonical
`ConversationCommand`, and cannot satisfy D-13/D-14/D-17. They are target
deletions, not compatibility paths.

The accepted D-14 current state and accepted D-17 target are defined below.

### 6.1 Accepted D-13 Membership Transition

The following is the accepted conceptual proto contract. Exact field
numbers follow existing schema-evolution rules during implementation; the
message ownership and semantics below are architecture constraints.

```text
MembershipTransitionCommand
  transition_id
  conversation_id
  sender_ptid
  sender_device_id
  from_membership_epoch
  from_mls_epoch
  to_mls_epoch
  changes[]
  opaque_mls_commit_bytes
  commit_sha256
  welcome_deliveries[]
  idempotency_key

MembershipTransitionChange
  ptid
  actor_home_station_peer_id
  action                    # add | remove | leave | role_change | add_device | remove_device
  role

MlsWelcomeDelivery
  recipient_ptid
  recipient_device_id
  recipient_home_station_peer_id
  opaque_welcome_bytes
  welcome_sha256
```

#### Accepted D-15 MLS Device Credential

```text
MlsDeviceCredential
  version = 1
  ptid
  device_id
```

The deterministic protobuf encoding is the complete OpenMLS
`BasicCredential.identity`. The credential is device-local public identity, not
an MLS secret.

Type mapping:

| Business operation | Required leaf mapping |
| --- | --- |
| add actor | add `(ptid, initial_device_id)` |
| add device | add exact `(ptid, device_id)` |
| remove device | remove exact `(ptid, device_id)` |
| remove actor / leave | remove every leaf whose credential PTID matches |

KeyPackage routing metadata and the decoded credential must match exactly.
Malformed, unknown-version, or PTID-only credentials are rejected without
fallback.

#### Accepted D-16 MLS Leave Intent

```text
MlsLeaveIntent
  version = 1
  intent_id
  federation_id
  authority_station_peer_id
  authority_epoch
  home_station_peer_id
  conversation_id
  actor_ptid
  actor_device_id
  actor_signing_key_id
  observed_membership_epoch
  observed_mls_epoch
  created_at_unix_ms
  expires_at_unix_ms
  actor_signature
```

The departing device signs deterministic `MlsLeaveIntentSigningInput` bytes.
The final transition is authored by a non-target active leaf and references
the verified intent through `leave_intent_id`. Intent consumption and the
membership/MLS transition are one transaction.

Authority validation:

```text
command.from_membership_epoch == conversation.membership_epoch
command.from_mls_epoch        == conversation.membership_epoch
command.to_mls_epoch          == conversation.membership_epoch + 1
sha256(opaque_mls_commit_bytes) == commit_sha256
transition_id is unused OR resolves to the exact same accepted command
all changes are authorized against the pre-transition membership snapshot
all Welcome targets are members/devices added by this transition
opaque_mls_commit_bytes <= 128 KiB
welcome payloads total <= 8 MiB
recipient deliveries <= 200
```

The authority produces:

```text
MembershipTransitionCommitted
  transition_id
  conversation_id
  group_seq
  event_hash
  from_membership_epoch
  to_membership_epoch
  from_mls_epoch
  to_mls_epoch
  changes[]
  opaque_mls_commit_bytes
  commit_sha256
  leave_intent_id
  welcome_descriptors[]      # target + hash, no duplicate secret material
  committed_at
```

`MembershipTransitionCommitted` is the canonical ordering fact. Commit bytes
are opaque to Station but retained with the event so resync can recover a lost
delivery. Recipient-specific Welcome bytes are retained in transactional outbox
rows, not copied into the shared event log.

Station validates the declared MLS epochs and opaque payload hash. It does not
claim that the bytes contain a semantically valid MLS Commit. Recipient
OpenMLS processing must verify the actual group/epoch transition; rejection
activates crypto-desynced read-only state.

### 6.2 Accepted D-14 Signed Remote Transition Proposal

```text
MembershipTransitionProposal
  proposal_id
  federation_id
  authority_station_peer_id
  authority_epoch
  home_station_peer_id
  actor_ptid
  actor_device_id
  actor_signing_key_id
  command                    # canonical ConversationCommand
  command_sha256
  actor_signature
  created_at_unix_ms

MembershipTransitionProposalSigningInput
  proposal_id
  federation_id
  authority_station_peer_id
  authority_epoch
  home_station_peer_id
  conversation_id
  transition_id
  actor_ptid
  actor_device_id
  command_sha256
  created_at_unix_ms

MembershipTransitionProposalResult
  proposal_id
  accepted
  committed_event            # canonical CommittedConversationEvent
  reject_code
  required_membership_epoch
  required_mls_epoch
  authority_group_seq
  authority_event_hash
```

Canonical hash and signature rules:

```text
command_sha256 =
  sha256(deterministic_protobuf(command))

actor_signature =
  Ed25519.Sign(
    actor_device_private_key,
    deterministic_protobuf(MembershipTransitionProposalSigningInput)
  )
```

The Home Station federation token binds:

```text
scope = conversation-membership-transition-proposal
issuer = home_station_peer_id
audience = authority_station_peer_id
subject = actor_ptid
claims = federation_id, proposal_id, conversation_id, transition_id,
         actor_device_id, command_sha256, authority_epoch
ttl <= 60 seconds
```

Authority validation order:

1. verify Station token signature, scope, issuer, audience, TTL, and bound
   claims;
2. verify the issuer Station is active in `federation_id`;
3. resolve `actor_signing_key_id` from the verified Actor identity projection;
4. verify actor signature and exact deterministic command hash;
5. verify command sender/device/transition identifiers match the proposal;
6. submit the same canonical command to the D-13 authority service.

The proposal MUST NOT carry a trusted public-key field. A public key supplied
by the proposal cannot establish its own identity. The Actor identity layer
owns:

```text
VerifiedActorSigningKey
  actor_ptid
  actor_device_id
  home_station_peer_id
  signing_key_id
  ed25519_public_key
  profile_version
  verification_source       # local account | verified profile | locator
  valid_from
  revoked_at
```

The projection key is `(actor_ptid, actor_device_id, signing_key_id)`.
Conversation reads it through a narrow resolver and does not copy the key into
membership rows. Missing, expired, revoked, or mismatched keys reject the
proposal before any D-13 transaction write.

### 6.3 Accepted D-17 Generic Signed Command Proposal

D-17 hard-cuts the D-14 membership-only wrapper to one proposal for every
authority-committed remote command:

```text
ConversationCommandProposal
  version = 1
  federation_id
  authority_station_peer_id
  authority_epoch
  home_station_peer_id
  actor_ptid
  actor_device_id
  actor_signing_key_id
  command                    # canonical ConversationCommand
  command_sha256
  actor_signature
  created_at_unix_ms
  expires_at_unix_ms

ConversationCommandProposalSigningInput
  version = 1
  federation_id
  authority_station_peer_id
  authority_epoch
  home_station_peer_id
  conversation_id
  command_id
  command_kind
  actor_ptid
  actor_device_id
  actor_signing_key_id
  command_sha256
  created_at_unix_ms
  expires_at_unix_ms

ConversationCommandProposalResult
  command_id
  accepted
  committed_event            # canonical CommittedConversationEvent
  reject_code
  retryable
  retry_after_unix_ms
  required_membership_epoch
  required_mls_epoch
  authority_group_seq
  authority_event_hash
```

Home-facing durable state contracts:

```text
ConversationCommandSubmissionState
  HOME_ACCEPTED
  SUBMITTED
  RETRY_WAIT
  ACCEPTED
  TERMINAL_REJECTED

SubmitConversationCommandProposalResponse
  conversation_id
  command_id
  state
  result                     # present for accepted/terminal rejection

GetConversationCommandProposalResultResponse
  conversation_id
  command_id
  state
  result
  next_retry_at_unix_ms

ConversationCommandResultDelivery
  conversation_id
  command_id
  state
  result
```

The Home Station stores the state/result and addressed device inbox row in one
local transaction. Result delivery is public authority evidence only; it never
contains plaintext, actor private keys, or MLS private state.

`command_id` is the proposal and authority idempotency identity; D-17 does not
introduce an independent proposal ID. It is required for all durable command
kinds. Authority persistence owns:

```text
ConversationCommandReceipt
  conversation_id
  command_id
  command_sha256
  committed_event_id
  committed_group_seq
  committed_event_hash
  status                     # accepted | terminal_rejected
  reject_code
  created_at_unix_ms
```

Home Station proposal lifecycle:

```text
local_queued
  -> home_accepted
  -> submitted
  -> accepted
  -> terminal_rejected

home_accepted | submitted
  -> retry_wait
  -> submitted
```

Only `accepted` and `terminal_rejected` are terminal. Transport failure,
authority unavailability, `RATE_LIMITED`, `GROUP_READ_ONLY`, and temporary
`ACTOR_KEY_UNAVAILABLE` enter bounded `retry_wait` using the authority's
`retry_after_unix_ms` when supplied. Invalid signature/hash/binding,
`ACTOR_KEY_REVOKED`, stale command epochs, command conflict, unsupported kind,
or permission denial are terminal for that signed command.

Expiry invariants:

```text
created_at_unix_ms < expires_at_unix_ms
expires_at_unix_ms - created_at_unix_ms <= Station command-retention policy
Home Station and authority use the same advertised maximum
expiry is actor-signed and cannot be extended by the Home Station
```

Required uniqueness and replay semantics:

```text
UNIQUE(conversation_id, command_id)

same command_id + same command_sha256
  -> return the original accepted/rejected result

same command_id + different command_sha256
  -> COMMAND_CONFLICT before sequence allocation
```

For an accepted command, the command receipt, canonical committed event, and
all deterministic replication/delivery outbox rows commit in one authority
transaction. A receipt cannot exist without its event and fan-out rows; an event
cannot exist without its receipt and fan-out rows.

The actor signature is:

```text
command_sha256 =
  sha256(deterministic_protobuf(command))

actor_signature =
  Ed25519.Sign(
    actor_device_private_key,
    deterministic_protobuf(ConversationCommandProposalSigningInput)
  )
```

The Home Station peer token binds:

```text
scope = conversation-command-proposal
issuer = home_station_peer_id
audience = authority_station_peer_id
subject = actor_ptid
claims = federation_id, conversation_id, command_id, command_kind,
         actor_device_id, actor_signing_key_id, command_sha256,
         authority_epoch, expires_at_unix_ms
ttl <= 60 seconds
```

Allowed `command_kind` values are the durable authority command oneof cases:

```text
send_message
edit_message
retract_message
dissolve
update_settings
react
pin_message
membership_transition
```

`typing` is forbidden in this proposal and remains an ephemeral signaling
message. Receipts retain their typed receipt API.

Generic reject codes:

```text
INVALID_PROPOSAL
INVALID_STATION_TOKEN
INACTIVE_FEDERATION_STATION
ACTOR_KEY_UNAVAILABLE
ACTOR_KEY_REVOKED
INVALID_ACTOR_SIGNATURE
COMMAND_HASH_MISMATCH
FIELD_BINDING_MISMATCH
NOT_AUTHORITY
PERMISSION_DENIED
MEMBERSHIP_EPOCH_STALE
MLS_EPOCH_MISMATCH
COMMAND_CONFLICT
COMMAND_EXPIRED
GROUP_READ_ONLY
PAYLOAD_TOO_LARGE
TOO_MANY_RECIPIENTS
RATE_LIMITED
UNSUPPORTED_COMMAND
```

Membership-specific D-13 fields and leave-intent checks remain inside the
shared verifier/service path. The D-14 `MembershipTransitionProposal*` types
are target deletions and must be removed atomically across Model, Station,
Desktop App, and Desktop Web.

## 7. Group Message Payload

Station sees metadata and ciphertext only:

```text
GroupMessageCommittedPayload
  message_ulid
  sender_actor_ref
  membership_epoch
  sender_device_id
  encrypted_payload          # opaque wire-encoded MLS application message
  content_type
  reply_to_ulid
  thread_root_ulid
  encrypted_attachment_metadata
  created_at_unix_ms
```

Rules:

- `encrypted_payload` is opaque to Station and contains all MLS framing needed
  by recipient OpenMLS.
- Station validates admission size and business metadata but never parses MLS
  group ID, epoch, sender leaf, or application plaintext.
- attachment metadata must not carry plaintext or encryption key material
  outside encrypted fields.

## 8. Cross-Station MLS Transition Delivery

```text
FederatedMlsKeyDeliveryEnvelope
  envelope_id
  federation_id
  group_ulid
  authority_station_peer_id
  transition_id
  group_seq
  from_membership_epoch
  to_membership_epoch
  from_mls_epoch
  to_mls_epoch
  delivery_kind            # commit | welcome
  payload_sha256
  sender_actor_ref
  sender_device_id
  recipient_actor_ref
  recipient_device_id
  encrypted_mls_bytes
  sender_signature
  home_station_signature
  issued_at_unix_ms
```

Rules:

- Commit delivery is created only from an accepted
  `MembershipTransitionCommitted` authority transaction.
- Welcome delivery targets only a device added by that transition.
- `encrypted_mls_bytes` carries opaque MLS Welcome/Commit bytes for the
  recipient device.
- Station may store and route this envelope but cannot decrypt MLS group secrets.
- Receiver verifies payload SHA-256 before OpenMLS processing.
- Receiver rejects wrong authority, recipient, transition identity, sequence,
  or impossible epoch progression.
- Duplicate `(transition_id, delivery_kind, recipient_device_id, payload_sha256)`
  is acknowledged as a no-op.
- KeyPackage upload/fetch remains a directory API and is not a membership
  transition delivery kind.

## 9. Replication And Delivery Cursor

Authority Station tracks per member Station replication:

```text
GroupReplicationCursor
  group_ulid
  target_station_peer_id
  last_delivered_group_seq
  last_ack_group_seq
  retry_count
  last_error_code
  updated_at_unix_ms
```

Follower Station tracks authority head:

```text
FollowerGroupHead
  group_ulid
  authority_station_peer_id
  authority_epoch
  last_applied_group_seq
  last_applied_event_hash
  membership_epoch
  mls_epoch
  last_transition_id
  last_commit_sha256
  status
  updated_at_unix_ms
```

Idempotency:

- applying the same committed event twice must be a no-op;
- receiving a future `group_seq` with a missing predecessor triggers group resync;
- receiving the same `group_seq` with a different event hash triggers fork protection and read-only state.
- follower membership projection, head advancement, and recipient inbox writes
  are one local database transaction;
- a bounded 128-event reorder buffer may hold future events while resync is in
  progress; overflow remains read-only until snapshot recovery.

## 9.1 Authority Transaction And Outbox

The authority persistence boundary is one transaction:

```text
lock conversation head
  -> allocate group_seq
  -> apply member changes
  -> set membership_epoch
  -> append MembershipTransitionCommitted
  -> insert committed-event replication outbox rows
  -> insert Commit/Welcome delivery outbox rows
commit
```

No network call occurs inside this transaction. Outbox workers retry after
commit. Any failure before commit leaves all affected tables unchanged.

Required uniqueness:

```text
UNIQUE(conversation_id, group_seq)
UNIQUE(conversation_id, transition_id)
UNIQUE(target_station_peer_id, idempotency_key)
UNIQUE(recipient_ptid, recipient_device_id, idempotency_key)
```

## 9.2 Accepted D-17 Generic Command Transaction

Every durable command uses the same authority transaction shape:

```text
lock conversation head
  -> resolve (conversation_id, command_id, command_sha256)
  -> validate command-specific authorization and admission
  -> allocate group_seq
  -> apply command effects
  -> append canonical CommittedConversationEvent
  -> insert ConversationCommandReceipt
  -> insert deterministic replication/delivery outbox rows
commit
```

D-13 membership transition logic is a specialization inside this generic unit
of work. No network call occurs in the transaction. Exact replay returns the
receipt's event without entering the mutation block.

## 10. Pressure And Security Metrics

Foundation Profile pressure test evidence should record:

```text
im_group_send_latency_ms{path=local|remote}
im_command_proposal_home_accept_latency_ms
im_command_proposal_authority_latency_ms{command_kind}
im_command_proposal_outbox_depth{target_station}
im_command_proposal_retry_total{cause}
im_command_proposal_reject_total{code,retryable}
im_command_receipt_replay_total
im_command_receipt_conflict_total
im_group_authority_commit_latency_ms
im_group_fanout_latency_ms
im_group_replication_lag_seq
im_group_sse_delivery_latency_ms
im_group_resync_duration_ms
im_group_key_delivery_success_total
im_group_key_delivery_failed_total{cause}
im_group_decrypt_failed_total{cause}
im_group_security_reject_total{cause}
im_group_authority_degraded_total
im_private_chat_send_latency_ms{path=local|remote}
```

Forbidden metric payload:

- message plaintext;
- raw ciphertext body;
- MLS group secrets or ratchet keys;
- MLS Welcome/Commit plaintext;
- private keys;
- full access tokens.
