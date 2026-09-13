# Secure Content - Data Model

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-13 | **Updated**: 2026-09-13
> **Owner**: Architecture Team
> **Module**: `model/domain/secure_content/`, `model/domain/social/`, `model/domain/key_exchange/`

---

## 1. Identity Vocabulary

| Term | Meaning |
|---|---|
| `resource_ref` | Pre-commit cryptographic identity: owner domain, client-generated content ID, generation |
| `content_id` | Client-generated immutable ULID available before Station commit |
| `authorization_snapshot` | Domain-owned immutable recipient/policy commitment |
| `plan_id` | Domain-owned exact prepare identity |
| `recipient_slot_id` | Random plan-local identifier mapped to one endpoint or recovery principal only at Station |
| `content_prekey` | One-time endpoint X25519 key used for normal content delivery |
| `recovery_prekey` | One-time actor X25519 key derivable from the recovery secret |
| `root_content_key` | Independent random 256-bit key for one private Post or Comment |
| `object_id` | Domain-owned immutable ciphertext object |
| `domain_commit_id` | Post/Comment ID or Conversation event ID that atomically attaches objects/grants |

## 2. Contract Roots

```text
model/domain/
├── actor/actor.proto
├── key_exchange/key_exchange.proto
├── secure_content/
│   ├── content.proto
│   └── object.proto
├── social/
│   ├── post.proto
│   ├── comment.proto
│   └── private_content.proto
└── chat/attachment.proto
```

`secure_content` owns the new domain-neutral crypto/object contract used by Social
and future consumers. Chat retains its existing attachment wire for compatibility
with the accepted Conversation architecture; a typed adapter maps it to the same
neutral core semantics. Both domains retain typed business requests and responses.

## 3. Shared Payload And Object Types

```protobuf
enum SecureContentOwnerDomain {
  SECURE_CONTENT_OWNER_DOMAIN_UNSPECIFIED = 0;
  SECURE_CONTENT_OWNER_DOMAIN_CONVERSATION = 1;
  SECURE_CONTENT_OWNER_DOMAIN_SOCIAL = 2;
}

message SecureResourceRef {
  SecureContentOwnerDomain owner_domain = 1;
  string content_id = 2;
  uint64 generation = 3;
}

enum PayloadEncryptionSuite {
  PAYLOAD_ENCRYPTION_SUITE_UNSPECIFIED = 0;
  PAYLOAD_ENCRYPTION_SUITE_AES_256_GCM = 1;
}

message EncryptedPayload {
  uint32 format_version = 1;
  SecureResourceRef resource = 2;
  PayloadEncryptionSuite suite = 3;
  bytes nonce = 4;
  bytes ciphertext = 5;
  bytes ciphertext_sha256 = 6;
  bytes aad_sha256 = 7;
}

enum ObjectEncryptionSuite {
  OBJECT_ENCRYPTION_SUITE_UNSPECIFIED = 0;
  OBJECT_ENCRYPTION_SUITE_AES_256_GCM_CHUNKED = 1;
}

enum ObjectNonceStrategy {
  OBJECT_NONCE_STRATEGY_UNSPECIFIED = 0;
  OBJECT_NONCE_STRATEGY_COUNTER32_BE = 1;
}

message EncryptedObjectUploadSpec {
  SecureResourceRef resource = 1;
  string object_id = 2;
  uint64 ciphertext_size = 3;
  bytes ciphertext_sha256 = 4;
  uint32 chunk_size = 5;
  uint32 chunk_count = 6;
  ObjectEncryptionSuite encryption_suite = 7;
  uint32 tag_size = 8;
  ObjectNonceStrategy nonce_strategy = 9;
  repeated bytes chunk_ciphertext_sha256 = 10;
}

message EncryptedObjectDescriptor {
  SecureResourceRef resource = 1;
  string object_id = 2;
  string storage_ref = 3;
  EncryptedObjectUploadSpec commitment = 4;
}
```

Filename, real MIME type, dimensions, plaintext size/hash, object key, base nonce,
and alt text stay inside the encrypted domain payload.

## 4. One-Time Key Contracts

Key Exchange owns separate pools:

```protobuf
enum ContentPreKeyKind {
  CONTENT_PREKEY_KIND_UNSPECIFIED = 0;
  CONTENT_PREKEY_KIND_ENDPOINT = 1;
  CONTENT_PREKEY_KIND_ACTOR_RECOVERY = 2;
}

message ContentOneTimePreKey {
  ContentPreKeyKind kind = 1;
  string key_id = 2;
  bytes x25519_public_key = 3;
  oneof principal {
    peers_touch.model.actor.v1.ActorDeviceRef endpoint = 4;
    peers_touch.model.actor.v1.ActorRef recovery_actor = 5;
  }
  uint64 profile_or_recovery_epoch = 6;
  bytes issuer_signature = 7;
}

message ContentPreKeyClaimTarget {
  ContentPreKeyKind kind = 1;
  oneof principal {
    peers_touch.model.actor.v1.ActorDeviceRef endpoint = 2;
    peers_touch.model.actor.v1.ActorRef recovery_actor = 3;
  }
}

message ClaimedContentPreKey {
  string claim_id = 1;
  ContentPreKeyClaimTarget target = 2;
  ContentOneTimePreKey prekey = 3;
  bool irreversibly_consumed = 4;
}

message ClaimContentPreKeysRequest {
  string plan_id = 1;
  bytes plan_request_sha256 = 2;
  repeated ContentPreKeyClaimTarget targets = 3;
}

message ClaimContentPreKeysResponse {
  repeated ClaimedContentPreKey claims = 1;
  bool exact_replay = 2;
}
```

Claims are exact-once and irreversible when public material is disclosed. Chat
Direct prekeys and Content PreKeys use separate types, stores, quotas, and APIs.

## 5. Encryption Plan And Envelope Binding

Social owns typed prepare requests:

```protobuf
message PreparePrivateMomentRequest {
  string content_id = 1;
  Audience audience = 2;
  uint32 object_count = 3;
  string command_id = 4;
}

message PreparePrivateCommentRequest {
  string post_id = 1;
  string comment_content_id = 2;
  string reply_to_comment_id = 3;
  uint32 object_count = 4;
  string command_id = 5;
}
```

Shared plan projection:

```protobuf
message RequiredContentRecipientSlot {
  string recipient_slot_id = 1;
  ContentPreKeyKind key_kind = 2;
  string one_time_key_id = 3;
  bytes one_time_public_key = 4;
  bytes principal_binding_sha256 = 5;
}

message ContentEncryptionPlan {
  uint32 format_version = 1;
  string plan_id = 2;
  SecureResourceRef resource = 3;
  peers_touch.model.actor.v1.ActorDeviceRef author = 4;
  bytes authorization_snapshot_sha256 = 5;
  repeated RequiredContentRecipientSlot required_slots = 6;
  repeated string object_ids = 7;
  google.protobuf.Timestamp expires_at = 8;
  bytes canonical_plan_sha256 = 9;
  string station_signing_key_id = 10;
  bytes station_signature = 11;
}

message ContentKeyEnvelopeBinding {
  uint32 format_version = 1;
  string plan_id = 2;
  bytes canonical_plan_sha256 = 3;
  SecureResourceRef resource = 4;
  string recipient_slot_id = 5;
  ContentPreKeyKind recipient_key_kind = 6;
  string recipient_key_id = 7;
  bytes principal_binding_sha256 = 8;
  bytes authorization_snapshot_sha256 = 9;
  bytes payload_ciphertext_sha256 = 10;
  bytes object_descriptor_set_sha256 = 11;
  google.protobuf.Timestamp plan_expires_at = 12;
  peers_touch.model.actor.v1.ActorDeviceRef sender = 13;
  string sender_signing_key_id = 14;
}

message PreparedContentKeyEnvelope {
  ContentKeyEnvelopeBinding binding = 1;
  bytes binding_sha256 = 2;
  bytes hpke_encapsulated_key = 3;
  bytes hpke_ciphertext = 4;
  bytes sender_signature = 5;
}

message ViewerContentKeyEnvelope {
  ContentKeyEnvelopeBinding binding = 1;
  oneof recipient {
    peers_touch.model.actor.v1.ActorDeviceRef endpoint = 2;
    peers_touch.model.actor.v1.ActorRef recovery_actor = 3;
  }
  bytes binding_sha256 = 4;
  bytes hpke_encapsulated_key = 5;
  bytes hpke_ciphertext = 6;
  bytes sender_signature = 7;
  uint64 principal_epoch = 8; // recipient profile or recovery epoch
}
```

Plan canonicalization requires:

- `recipient_slot_id` ascending order and no duplicate slot/key claim;
- one random slot per exact claimed endpoint or recovery principal;
- `principal_binding_sha256 = SHA-256(plan_id || slot_id || canonical principal
  || claim_id || one_time_key_id || one_time_public_key)`;
- only the binding hash, one-time key ID, and one-time public key leave Station;
- exact required-slot envelope coverage with no additional envelope;
- plan hash coverage of resource, author, authorization snapshot, object IDs,
  all slots, expiry, and claimed-key receipts.

The deterministic binding bytes are simultaneously HPKE `info`, HPKE AEAD AAD,
and the Ed25519 signature input. Submit requires exactly one envelope per required
slot and rejects extra, missing, expired, remapped, or non-canonical envelopes.

Station maps slots to principals only inside the domain UOW. Ordinary reads emit
one `ViewerContentKeyEnvelope` with the authenticated caller principal instead of
the opaque slot.

## 6. Social Private Payloads

```protobuf
message PrivateMomentContent {
  uint32 format_version = 1;
  oneof body {
    PrivateTextContent text = 2;
    PrivateImageContent image = 3;
    PrivateVideoContent video = 4;
    PrivateLinkContent link = 5;
    PrivatePollContent poll = 6;
    PrivateRepostContent repost = 7;
    PrivateLocationContent location = 8;
  }
}

message PrivateCommentContent {
  uint32 format_version = 1;
  string content_id = 2;
  string parent_content_id = 3;
  string text = 4;
  repeated Mention mentions = 5;
}

message PrivateAttachmentMetadata {
  string attachment_id = 1;
  string filename = 2;
  string mime_type = 3;
  uint64 plaintext_size = 4;
  bytes plaintext_sha256 = 5;
  bytes object_key = 6;
  bytes base_nonce = 7;
  EncryptedObjectDescriptor object = 8;
  uint32 width = 9;
  uint32 height = 10;
  uint32 duration_ms = 11;
  string alt_text = 12;
}
```

Subtype Station-visible facts:

| Type | Visible facts required for authority |
|---|---|
| TEXT/IMAGE/VIDEO/LINK/LOCATION | no private body fields; only resource/object commitments |
| POLL | opaque option IDs, option commitment, expiry, vote actor/result facts |
| REPOST | original resource reference and source recipient-snapshot commitment |
| mentions | signed mentioned-actor routing facts constrained to the frozen grant |
| reactions | actor, reaction kind, parent resource and counters after parent authorization |

Private repost prepare proves the target recipient actor set is a subset of the
source private grant. Private poll voting validates opaque option IDs against the
committed option set without reading labels.

```protobuf
message PrivatePollAuthority {
  string post_id = 1;
  repeated bytes opaque_option_ids = 2;
  bytes option_set_sha256 = 3;
  uint32 min_choices = 4;
  uint32 max_choices = 5;
  google.protobuf.Timestamp expires_at = 6;
}

message VotePrivatePollRequest {
  string post_id = 1;
  repeated bytes opaque_option_ids = 2;
  string command_id = 3;
}
```

The encrypted payload binds readable option labels to the same opaque option IDs
and `option_set_sha256`. Social validates parent access, expiry, choice cardinality,
option membership, and exact vote replay before mutating vote facts.

## 7. Resource Projection

```protobuf
message PostResource {
  PostMetadata metadata = 1;
  oneof body {
    PublicPostContent public_content = 2;
    PrivateContentAccess private_content = 3;
  }
}

message PrivateContentAccess {
  EncryptedPayload payload = 1;
  ViewerContentKeyEnvelope viewer_envelope = 2;
  repeated EncryptedObjectDescriptor objects = 3;
}
```

Private resources never carry legacy plaintext `Post.content`,
`Audience.actor_ptids`, or unrelated envelopes.

## 8. Cryptographic Derivation

```text
K_content = random(32)

K_payload = HKDF-SHA256(
  ikm  = K_content,
  salt = authorization_snapshot_sha256,
  info = protocol_version
       || owner_domain
       || content_id
       || generation
       || payload_kind
)
```

Each resource and object uses independent random key material and nonce domains.
`parent_content_id` is authenticated Comment metadata, never a key source.

## 9. Domain-Owned Persistence

Public Social tables:

```text
social_public_posts
social_public_comments
social_public_reactions
```

Private Social tables:

```text
social_private_posts
social_private_comments
social_private_audience_snapshots
social_private_recipient_grants
social_private_content_envelopes
social_private_object_uploads
social_private_object_parts
social_private_objects
social_private_object_grants
social_private_object_audit
```

| Table | Primary identity | Required bindings |
|---|---|---|
| `social_private_posts` | `post_id`, unique `content_id` | author, generation, snapshot ID, canonical encrypted payload bytes/hash, counters, lifecycle |
| `social_private_comments` | `comment_id`, unique `content_id` | post, parent comment, author, interaction snapshot, canonical encrypted payload bytes/hash |
| `social_private_audience_snapshots` | `snapshot_id`, unique `post_id` | audience kind/target, source revision, canonical snapshot hash |
| `social_private_recipient_grants` | `(snapshot_id, recipient_ptid)` | grant time, revoke time/reason |
| `social_private_content_envelopes` | `(content_id, key_kind, recipient principal, one_time_key_id)` | exact plan/binding/envelope/signature hashes |
| `social_private_object_uploads` | `(upload_id, generation)` | content ID, uploader endpoint, descriptor commitment, bitmap, state, expiry |
| `social_private_object_parts` | `(upload_id, generation, chunk_index)` | offset, size, ciphertext hash, storage key |
| `social_private_objects` | `object_id` | content ID, uploader, canonical descriptor, state, domain commit ID |
| `social_private_object_grants` | `(object_id, principal kind, principal)` | domain commit ID, grant/revoke facts |
| `social_private_object_audit` | `audit_id` | redacted operation/outcome, byte/count buckets, timestamp |

All resource, slot, key, and command uniqueness constraints are database-backed.
Private payload bytes are stored once as canonical `EncryptedPayload`; indexed
hash columns are generated/validated mirrors and cannot be independently updated.

Conversation keeps its accepted `conversation_attachment_*` table family.
There is no shared `secure_content_*` authority table.

Private Social Post/Comment rows contain canonical encrypted payload bytes and
indexed commitments, not duplicated plaintext or independently mutable nonce/body
representations.

## 10. Transaction Contract

```go
type DomainSecureContentRepository interface {
    ValidateAndAttachObjects(
        ctx context.Context,
        transaction DomainTransaction,
        commit DomainCommit,
        descriptors []EncryptedObjectDescriptor,
        grants []DomainGrant,
    ) error
}
```

The domain UOW creates the transaction and passes a transaction-bound repository.
The shared kernel validates pure transitions and cannot commit independently.

Social submit atomically writes:

- Post or Comment fact;
- audience/interaction snapshot;
- slot-to-principal mappings and envelopes;
- delivery intents;
- object attachment and grants;
- exact command receipt.

Conversation retains its current event/object/grant atomic UOW.

## 11. State Machines

Plan:

```text
PREPARING
  -> PREKEYS_CLAIMED
  -> PREPARED
  -> CONSUMED(domain_commit_id)

PREPARING/PREKEYS_CLAIMED -> RETRY_WAIT
PREPARED -> EXPIRED | REJECTED_STALE
```

Object:

```text
CREATED -> RECEIVING_PARTS -> VERIFYING -> COMPLETE_UNATTACHED
COMPLETE_UNATTACHED -> ATTACHED(domain_commit_id)
CREATED/RECEIVING_PARTS -> CANCELLED | EXPIRED
VERIFYING -> RECEIVING_PARTS | TERMINAL_CORRUPT
COMPLETE_UNATTACHED -> GC_CLAIMED -> GARBAGE_COLLECTED
```

Exact identity/hash replay returns the original result. Same identity with another
hash is terminal conflict.

## 12. Recovery Query

```protobuf
message ListRecoverablePrivateContentRequest {
  string cursor = 1;
  uint32 limit = 2;
}

message RecoverablePrivateContent {
  SecureResourceRef resource = 1;
  ViewerContentKeyEnvelope recovery_envelope = 2;
  bytes payload_ciphertext_sha256 = 3;
}
```

Social lists only currently authorized resources and maps actor recovery slots to
the caller. The recovered device derives the claimed recovery private key from
the recovery secret, recovery epoch, and one-time key ID. Results are cursor
paginated and restartable; no root-key list is embedded in the whole Recovery
archive.

## 13. Limits

| Resource | Initial bound |
|---|---|
| private payload ciphertext | 1 MiB |
| objects per resource | 10 |
| object plaintext | 2 GiB |
| object chunks | 2048 at fixed 1 MiB plaintext |
| recipient actors per plan | 256 |
| endpoint plus recovery slots per plan | 1000 |
| active plans per actor | 4 |
| plan lifetime | 5 minutes |
| active uploads per actor/domain | 4 |
| unattached object TTL | 24 hours |
| recovery page | 100 resources |

Limits fail closed with typed errors and require benchmark/abuse evidence before
increase.
