# Federated IM Architecture — Data Model

> **Status**: draft
> **Version**: v0.2
> **Created**: 2026-07-04 | **Updated**: 2026-08-02
> **Owner**: Architecture Team
> **Module**: `model/domain/chat/`, `model/domain/federation/`, `model/domain/realtime/`, `apps/station/app/subserver/group_chat/`

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

## 6. Remote Proposal

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

Proposal status on sender Home Station:

```text
pending
submitted
accepted
rejected
expired
retry_wait
```

Authority response:

```text
GroupProposalResult
  proposal_id
  accepted
  committed_event_id
  committed_group_seq
  reject_code
  required_membership_epoch
  required_authority_epoch
  authority_head_hash
```

Reject codes:

```text
not_group_member
not_active_federation_station
group_dissolved
group_degraded
member_muted
membership_epoch_stale
authority_epoch_stale
invalid_signature
permission_denied
payload_too_large
rate_limited
duplicate_idempotency_key
```

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

## 7. Group Message Payload

Station sees metadata and ciphertext only:

```text
GroupMessageCommittedPayload
  message_ulid
  sender_actor_ref
  membership_epoch
  sender_key_id
  sender_device_id
  ciphertext_bytes
  ciphertext_header_bytes
  reply_to_ulid
  thread_root_ulid
  attachment_metadata
  created_at_unix_ms
```

Rules:

- `ciphertext_bytes` is opaque to Station.
- `ciphertext_header_bytes` may include MLS framing (group id, epoch, content type, sender leaf) and signature, but not plaintext.
- attachment metadata must not carry encryption key material outside ciphertext.

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

## 10. Pressure And Security Metrics

Foundation Profile pressure test evidence should record:

```text
im_group_send_latency_ms{path=local|remote}
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
