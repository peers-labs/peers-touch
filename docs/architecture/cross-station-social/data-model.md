# Cross-Station Private Social - Data Model

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-10-03 | **Updated**: 2026-10-04
> **Owner**: Social / Federation

---

## 1. Contract Roots

| Path | Ownership |
|---|---|
| `model/domain/secure_content/prekey.proto` | Canonical endpoint/recovery Content PreKey types; unchanged unless a separate Secure Content decision requires it |
| `model/domain/key_exchange/key_exchange.proto` | Key Exchange-owned federated Content PreKey claim wrapper |
| `model/domain/social/private_federation.proto` | Private Social delivery, invalidation, interaction, and object-read messages |
| `model/domain/federation/delivery.proto` | Domain-neutral durable payload kind enumeration only |
| `model/domain/social/private_content.proto` | Existing same-Station resource, proof, payload, and private Comment contracts |

The new Social contract imports existing Secure Content resource, payload,
envelope, proof, and descriptor messages. It does not duplicate them.

## 2. Federation Payload Kinds

`FederatedDomainPayloadKind` adds durable kinds:

```proto
FEDERATED_DOMAIN_PAYLOAD_KIND_SOCIAL_PRIVATE_RESOURCE = ...;
FEDERATED_DOMAIN_PAYLOAD_KIND_SOCIAL_PRIVATE_INVALIDATION = ...;
FEDERATED_DOMAIN_PAYLOAD_KIND_SOCIAL_PRIVATE_INTERACTION_COMMAND = ...;
FEDERATED_DOMAIN_PAYLOAD_KIND_SOCIAL_PRIVATE_INTERACTION_RESULT = ...;
```

All four kinds use durable outbox/inbox delivery. They never use the ephemeral
signal path or Federation Ledger.

## 3. Remote Content PreKey Claim

Conceptual shape:

```proto
message ClaimFederatedContentPreKeysRequest {
  uint32 format_version = 1;
  string source_home_station_peer_id = 2;
  string target_home_station_peer_id = 3;
  string federation_id = 4;
  peers_touch.model.secure_content.v1.ClaimContentPreKeysRequest request = 5;
  bytes canonical_request_sha256 = 6;
}

message ClaimFederatedContentPreKeysResponse {
  peers_touch.model.secure_content.v1.ClaimContentPreKeysResponse response = 1;
}
```

The authenticated Federation peer identity supplies the source Station
principal. A caller-provided source field is a consistency assertion, not an
authentication mechanism.

Exact replay identity:

```text
source_home_station_peer_id
+ target_home_station_peer_id
+ plan_id
+ plan_request_sha256
```

### 3.1 Remote Submit Validation

`CSS-D10` defines a distinct read-only peer message pair:

```proto
message ValidateFederatedContentPreKeyClaimsRequest {
  uint32 format_version = 1;
  string source_home_station_peer_id = 2;
  string target_home_station_peer_id = 3;
  string federation_id = 4;
  peers_touch.model.secure_content.v1.ClaimContentPreKeysRequest request = 5;
  peers_touch.model.secure_content.v1.ClaimContentPreKeysResponse response = 6;
  bytes canonical_request_sha256 = 7;
  bytes canonical_response_sha256 = 8;
}

message ValidateFederatedContentPreKeyClaimsResponse {
  uint32 format_version = 1;
  string plan_id = 2;
  bytes canonical_request_sha256 = 3;
  bytes canonical_response_sha256 = 4;
  google.protobuf.Timestamp validated_at = 5;
}
```

The request and response digests bind the exact persisted pair without changing
claim replay identity. The target derives the same namespaced local plan ID
used by the federated claim route before loading its receipt. The dedicated
validation scope binds the Federation, source/target Stations, authority plan,
plan-request digest, canonical request digest, and canonical response digest.
Success means the receipt and all current endpoint/recovery epochs matched in
that target's validation transaction; `validated_at` reports that completed
per-partition check and does not claim a global snapshot.

Stale material, authenticated inactive-Federation rejection, and a missing
receipt map to terminal `REJECTED_STALE`. Invalid peer authentication claims,
malformed input or response, digest mismatch, and receipt/response mismatch
also terminate as `REJECTED_STALE` while surfacing an integrity error; no new
terminal plan state is introduced. Timeout, transport failure, peer
unavailability, membership-store failure, and internal dependency failure
preserve `PREPARED` for an exact retry. No validation response carries key
material.

### 3.2 Federated Group Recipient Snapshot

The existing Conversation-owned in-process snapshot remains the only `GROUP`
recipient authority and gains one canonical Federation field:

```go
type GroupRecipientSnapshot struct {
    FederationID       string
    ConversationID     string
    AuthorPTID         string
    MembershipEpoch    uint64
    AuthorityHeadSHA256 []byte
    Members            []GroupRecipientMember
}
```

The Social value projection and its canonical persisted bytes carry the same
field. `FederationID`, Conversation identity, epoch, head hash, ordered member
PTIDs, and member Home Stations participate in byte-for-byte prepare/submit
equality. An empty or changed Federation ID, an inactive member Station, or a
cross-Federation member rejects the whole plan before Content PreKey claim or
Social commit.

### 3.3 Durable Recipient Locality Binding

The canonical `SocialPrivateContentPlan` authority row persists the normalized
prepare-time recipient locality projection:

```text
recipient_localities_bytes
recipient_localities_sha256
```

The versioned canonical bytes contain the ordered
`actor_ptid + home_station_peer_id + federation_id` tuple for every recipient
other than the author. Submit verifies the digest and canonical encoding before
partitioning claims. Remote validation consumes this frozen projection before
the Social transaction; local validation consumes the same projection inside
the transaction and compares it with the freshly fenced audience snapshot.
Submit never re-resolves mutable Actor Identity locality outside the authority
fence.

## 4. Private Resource Delivery

Conceptual shape:

```proto
enum FederatedPrivateResourceKind {
  FEDERATED_PRIVATE_RESOURCE_KIND_UNSPECIFIED = 0;
  FEDERATED_PRIVATE_RESOURCE_KIND_POST = 1;
  FEDERATED_PRIVATE_RESOURCE_KIND_COMMENT = 2;
}

message FederatedPrivateResourceDelivery {
  uint32 format_version = 1;
  string federation_id = 2;
  string delivery_id = 3;
  string source_station_peer_id = 4;
  string target_station_peer_id = 5;
  peers_touch.model.actor.v1.ActorRef target_actor = 6;
  FederatedPrivateResourceKind resource_kind = 7;
  peers_touch.model.secure_content.v1.SecureResourceRef resource = 8;
  uint64 lifecycle_revision = 9;
  oneof metadata {
    PostMetadata post = 10;
    CommentMetadata comment = 11;
  }
  peers_touch.model.secure_content.v1.EncryptedPayload payload = 12;
  repeated peers_touch.model.secure_content.v1.ViewerContentKeyEnvelope
      target_actor_envelopes = 13;
  repeated peers_touch.model.secure_content.v1.EncryptedObjectDescriptor
      objects = 14;
  PrivateContentVerification verification = 15;
  AudienceExplanation audience_explanation = 16;
  google.protobuf.Timestamp committed_at = 17;
}
```

Metadata reuses the existing typed private-resource projections. Final field
names and numbers are fixed before generation. Signed canonical messages reject
unknown fields.

## 5. Invalidation

```proto
message FederatedPrivateResourceInvalidation {
  uint32 format_version = 1;
  string federation_id = 2;
  string source_station_peer_id = 3;
  string target_station_peer_id = 4;
  peers_touch.model.actor.v1.ActorRef target_actor = 5;
  peers_touch.model.secure_content.v1.SecureResourceRef resource = 6;
  uint64 lifecycle_revision = 7;
  PrivateResourceInvalidationReason reason = 8;
  google.protobuf.Timestamp committed_at = 9;
}
```

Revision is monotonic per source resource generation. A receiver applies only a
strictly newer transition. A tombstone is retained long enough to reject stale
durable delivery and reconcile responses.

## 6. Interaction Commands And Results

```proto
enum FederatedPrivateInteractionOperation {
  FEDERATED_PRIVATE_INTERACTION_OPERATION_UNSPECIFIED = 0;
  FEDERATED_PRIVATE_INTERACTION_OPERATION_PREPARE_COMMENT = 1;
  FEDERATED_PRIVATE_INTERACTION_OPERATION_SUBMIT_COMMENT = 2;
  FEDERATED_PRIVATE_INTERACTION_OPERATION_REACT = 3;
  FEDERATED_PRIVATE_INTERACTION_OPERATION_UNREACT = 4;
}

message FederatedPrivateInteractionCommand {
  uint32 format_version = 1;
  string federation_id = 2;
  string command_id = 3;
  bytes canonical_command_sha256 = 4;
  peers_touch.model.actor.v1.ActorDeviceRef actor = 5;
  string actor_home_station_peer_id = 6;
  string source_resource_station_peer_id = 7;
  peers_touch.model.secure_content.v1.SecureResourceRef parent = 8;
  FederatedPrivateInteractionOperation operation = 9;
  bytes canonical_operation = 10;
  string actor_signing_key_id = 11;
  bytes actor_device_signature = 12;
}

message FederatedPrivateInteractionResult {
  uint32 format_version = 1;
  string command_id = 2;
  bytes canonical_command_sha256 = 3;
  FederatedPrivateInteractionResultKind kind = 4;
  bytes canonical_result = 5;
  bytes canonical_result_sha256 = 6;
}
```

`canonical_operation` decodes to an allowlisted Social protobuf selected by
`operation`. Unknown fields, mismatched operation types, or hash changes are
terminal.

Comment prepare and submit requests carry the actor signing-key ID and a
device signature over the domain-separated operation plus canonical request
bytes with the signature field cleared. The source Station verifies that
signature after authenticating the actor's Home Station frame. A successful
remote prepare also carries a source proof-key attestation; the Home Station
re-attests that key before returning the source-signed plan to Native Desktop.
For a Comment authored away from the source-resource Station, the source also
embeds the actor key it verified at commit time so each receiver can validate
the envelope without treating the source Station as the actor's Home Station.

## 7. Object Peer Read

```proto
message FederatedPrivateObjectGrantBinding {
  uint32 format_version = 1;
  string federation_id = 2;
  string delivery_id = 3;
  string source_station_peer_id = 4;
  string target_station_peer_id = 5;
  string target_actor_ptid = 6;
  peers_touch.model.secure_content.v1.SecureResourceRef resource = 7;
  uint64 lifecycle_revision = 8;
  string object_id = 9;
  bytes descriptor_sha256 = 10;
}

message FederatedPrivateObjectRange {
  uint64 start = 1;
  uint64 end_exclusive = 2;
}

message ReadFederatedPrivateObjectRequest {
  uint32 format_version = 1;
  string federation_id = 2;
  peers_touch.model.actor.v1.ActorDeviceRef viewer = 3;
  peers_touch.model.secure_content.v1.SecureResourceRef resource = 4;
  string object_id = 5;
  reserved 6, 7;
  reserved "range_start", "range_end_exclusive";
  bytes imported_grant_sha256 = 8;
  FederatedPrivateObjectRange range = 9;
}

message ReadFederatedPrivateObjectResponse {
  bytes descriptor_sha256 = 1;
  FederatedPrivateObjectRange range = 2;
  uint64 total_ciphertext_size = 3;
}
```

`imported_grant_sha256` is
`SHA-256(CanonicalProtoBytes(FederatedPrivateObjectGrantBinding))`.
`descriptor_sha256` includes `storage_ref` through the existing canonical
descriptor projection. Source and recipient consume one checked-in
known-answer fixture.

Each peer request carries one canonical half-open range of at most 1 MiB. The
response body is raw ciphertext. `ReadFederatedPrivateObjectResponse` is
canonical-encoded, strict unpadded-base64url encoded, and placed in the bounded
metadata header; its decoded/encoded maxima are 69/92 bytes. The body and
metadata never contain an object key or plaintext.

## 8. Recipient Persistence

Recipient Home Station uses separate projection tables:

```text
social_remote_private_resources
  source_station_peer_id
  content_id
  generation
  target_actor_ptid
  lifecycle_revision
  resource_kind
  viewer_metadata_bytes
  encrypted_payload_bytes
  object_descriptor_set_bytes
  verification_bytes
  audience_explanation_bytes
  state
  committed_at
  updated_at

social_remote_private_envelopes
  source_station_peer_id
  content_id
  generation
  target_actor_ptid
  recipient_key_kind
  recipient_device_id
  one_time_key_id
  envelope_bytes
  principal_epoch

social_remote_private_tombstones
  source_station_peer_id
  content_id
  generation
  target_actor_ptid
  lifecycle_revision
  reason
  committed_at

social_remote_private_commands
  actor_ptid
  command_id
  source_station_peer_id
  canonical_command_sha256
  command_bytes
  result_bytes
  state
  created_at
  resolved_at
```

Every unique key includes source Station and target actor. Equal content IDs
from different authorities cannot collide.

## 9. State Machines

### Resource projection

```text
ABSENT
  -> ACTIVE(revision=N)
  -> ACTIVE(revision>N)
  -> REVOKED(revision>N)

REVOKED(N)
  + delivery(revision<=N) -> REVOKED(N)
  + invalidation(revision>N) -> REVOKED(new revision)
```

### Delivery

```text
PREPARED
  -> DURABLY_ADMITTED
  -> RETRYING
  -> ACCEPTED | TERMINAL_REJECTED | EXPIRED
```

`DURABLY_ADMITTED` is the first state that may produce
`REMOTE_DELIVERY_PENDING` in the UI.

### Interaction command

```text
DRAFT_LOCAL
  -> DURABLY_ADMITTED
  -> PENDING_RESULT
  -> COMMITTED | RETRYABLE | TERMINAL_REJECTED
```

Unknown outcome remains `PENDING_RESULT` and reuses the same command identity.

## 10. Bounds

- At most 256 recipient actors and 1000 endpoint/recovery slots per publish.
- One durable resource or invalidation frame targets one actor.
- Frame payload remains below the Federation transport limit.
- Object bytes never enter a frame.
- Interaction command and result payloads are bounded before persistence.
- Identifier, metadata, envelope, descriptor, and proof counts reuse existing
  Secure Content limits unless a stricter Social limit is defined.
