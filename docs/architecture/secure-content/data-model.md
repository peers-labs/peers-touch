# Secure Content - Data Model

> **Status**: active
> **Version**: v1.9
> **Created**: 2026-09-13 | **Updated**: 2026-09-21
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
| `runtime_manifest_digest` | Immutable digest of the runtime owner's exact source/profile/client/boot binding |
| `boot_identity` | Process-instance identity that must change across an acknowledged restart |
| `barrier_token` | One-shot acceptance-only release capability for one production lifecycle observation |
| `fixture_handle` | Opaque, digest-bound reference to state provisioned by its business/runtime truth owner |

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

message EncryptedObjectDescriptorCommitmentInput {
  uint32 format_version = 1;
  SecureResourceRef resource = 2;
  string object_id = 3;
  EncryptedObjectUploadSpec upload_spec = 4;
}

enum EncryptedObjectTransferState {
  ENCRYPTED_OBJECT_TRANSFER_STATE_UNSPECIFIED = 0;
  ENCRYPTED_OBJECT_TRANSFER_STATE_CREATED = 1;
  ENCRYPTED_OBJECT_TRANSFER_STATE_RECEIVING_PARTS = 2;
  ENCRYPTED_OBJECT_TRANSFER_STATE_VERIFYING = 3;
  ENCRYPTED_OBJECT_TRANSFER_STATE_COMPLETE_UNATTACHED = 4;
  ENCRYPTED_OBJECT_TRANSFER_STATE_ATTACHED = 5;
  ENCRYPTED_OBJECT_TRANSFER_STATE_CANCELLED = 6;
  ENCRYPTED_OBJECT_TRANSFER_STATE_EXPIRED = 7;
  ENCRYPTED_OBJECT_TRANSFER_STATE_TERMINAL_CORRUPT = 8;
  ENCRYPTED_OBJECT_TRANSFER_STATE_GC_CLAIMED = 9;
  ENCRYPTED_OBJECT_TRANSFER_STATE_GARBAGE_COLLECTED = 10;
  ENCRYPTED_OBJECT_TRANSFER_STATE_RETRY_WAIT = 11;
  ENCRYPTED_OBJECT_TRANSFER_STATE_CLEANUP_FAILED = 12;
}

message BeginEncryptedObjectUploadRequest {
  uint32 format_version = 1;
  string plan_id = 2;
  SecureResourceRef resource = 3;
  string object_id = 4;
  EncryptedObjectUploadSpec upload_spec = 5;
  bytes descriptor_commitment_sha256 = 6;
  string command_id = 7;
}

message BeginEncryptedObjectUploadResponse {
  string upload_id = 1;
  uint64 generation = 2;
  EncryptedObjectTransferState state = 3;
  bytes received_chunk_bitmap = 4;
  google.protobuf.Timestamp expires_at = 5;
  bool exact_replay = 6;
}

message GetEncryptedObjectUploadRequest {
  string upload_id = 1;
  uint64 generation = 2;
}

message GetEncryptedObjectUploadResponse {
  string upload_id = 1;
  uint64 generation = 2;
  string object_id = 3;
  EncryptedObjectTransferState state = 4;
  bytes received_chunk_bitmap = 5;
  google.protobuf.Timestamp expires_at = 6;
  EncryptedObjectDescriptor descriptor = 7;
}

message PutEncryptedObjectChunkResponse {
  string upload_id = 1;
  uint64 generation = 2;
  uint32 chunk_index = 3;
  EncryptedObjectTransferState state = 4;
  bytes received_chunk_bitmap = 5;
  bool exact_replay = 6;
}

message CompleteEncryptedObjectUploadRequest {
  string upload_id = 1;
  uint64 generation = 2;
  bytes descriptor_commitment_sha256 = 3;
  string command_id = 4;
}

message CompleteEncryptedObjectUploadResponse {
  EncryptedObjectDescriptor descriptor = 1;
  EncryptedObjectTransferState state = 2;
  bool exact_replay = 3;
}

message CancelEncryptedObjectUploadRequest {
  string upload_id = 1;
  uint64 generation = 2;
  string command_id = 3;
}

message CancelEncryptedObjectUploadResponse {
  string upload_id = 1;
  uint64 generation = 2;
  EncryptedObjectTransferState state = 3;
  bool exact_replay = 4;
}
```

Filename, real MIME type, dimensions, plaintext size/hash, object key, base nonce,
and alt text stay inside the encrypted domain payload.

`SC-D18` keeps large ciphertext out of these control messages. Chunk PUT and
object GET bodies are raw `application/octet-stream`; path parameters and
bounded headers carry generation, offset, size, hash, idempotency and range
metadata. Begin/complete/cancel canonical hashes bind every typed field above.
`descriptor_commitment_sha256` hashes the canonical
`EncryptedObjectDescriptorCommitmentInput`; Station-owned `storage_ref` is not
part of that client commitment.

Status maps `generation` to `?generation=<canonical-u64>`. A received bitmap
has exactly `ceil(chunk_count / 8)` bytes; bit `i` represents chunk `i`,
least-significant bit first within byte `i / 8`, and unused high bits are zero.
Object GET is a bounded raw-byte route rather than a typed body: the descriptor
already arrives through the authorized Post/Comment projection.

## 4. One-Time Key Contracts

Key Exchange owns separate pools and their claim/replay lifecycle. The neutral
wire types below live in `model/domain/secure_content/prekey.proto`, so the
Station `frame` contract layer never imports the app-owned Key Exchange
subserver package:

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

### Proposed Content PreKey Signature Canonicalization

Under accepted `SC-D15`, `prekey.proto` adds:

```protobuf
message ContentPreKeySigningInput {
  uint32 format_version = 1;
  ContentPreKeyKind kind = 2;
  string key_id = 3;
  bytes x25519_public_key = 4;
  oneof principal {
    peers_touch.model.actor.v1.ActorDeviceRef endpoint = 5;
    peers_touch.model.actor.v1.ActorRef recovery_actor = 6;
  }
  uint64 pool_epoch = 7;
  uint64 expected_pool_epoch = 8;
  peers_touch.model.actor.v1.ActorDeviceRef publisher = 9;
  string publisher_signing_key_id = 10;
  uint64 publisher_profile_version = 11;
}

message PublishContentPreKeysRequest {
  peers_touch.model.actor.v1.ActorDeviceRef publisher = 1;
  string publisher_signing_key_id = 2;
  uint64 publisher_profile_version = 3;
  uint64 expected_pool_epoch = 4;
  repeated ContentOneTimePreKey prekeys = 5;
}

message ContentPreKeyInventory {
  ContentPreKeyClaimTarget target = 1;
  uint64 current_epoch = 2;
  uint32 available = 3;
  uint32 capacity = 4;
  uint32 replenish_at_or_below = 5;
  bool needs_replenishment = 6;
}

message PublishContentPreKeysResponse {
  ContentPreKeyInventory inventory = 1;
}

message GetContentPreKeyInventoryRequest {
  peers_touch.model.actor.v1.ActorDeviceRef publisher = 1;
  ContentPreKeyClaimTarget target = 2;
}

message GetContentPreKeyInventoryResponse {
  ContentPreKeyInventory inventory = 1;
}
```

The publisher signs:

```text
content_prekey_signing_bytes =
  "peers-touch:secure-content:prekey:v1\0"
  || canonical(ContentPreKeySigningInput)
```

Publication carries publisher and compare-and-swap fields once per batch plus one
`ContentOneTimePreKey` per key. Key Exchange reconstructs a fresh signing input
for each key and requires exact equality with the request-level publisher,
signing-key, profile-version and compare-and-swap epoch fields. The canonical
encoder follows the project rules used by the other Secure Content
hash/signature inputs.

The authenticated publisher's verified Actor Identity device signing key
verifies each signature before mutation and again before an unclaimed key is
exposed. Endpoint pool epochs equal the current device profile version.
Recovery-pool epochs use compare-and-swap: `0 -> 1` creates the pool, `N -> N`
replenishes it, and `N -> N+1` rotates it. Stale expected epochs and jumps fail.
Completed claim receipts remain replayable after issuer revocation because the
public material was already irreversibly exposed.

Unknown fields at every nested message level fail before semantic
normalization. A future raw-wire publication endpoint additionally requires
decode/re-encode equality to reject duplicate singular fields, non-minimal
varints, and non-canonical field order. The signature authenticates publication;
it does not attest recovery-secret derivation.

### Proposed Content PreKey Client Projection

Proposed `SC-D20` extends `prekey.proto` without replacing fields:

- `PublishContentPreKeysRequest.command_id = 6`;
- `PublishContentPreKeysRequest.proof = 7`;
- `PublishContentPreKeysResponse.exact_replay = 2`;
- `GetContentPreKeyInventoryRequest.request_id = 3`;
- `GetContentPreKeyInventoryRequest.proof = 4`;
- `ContentPreKeyClientSigningInput` and `ContentPreKeyClientProof`.

The proof signs the capability ID, local Station peer ID, validated JWT session
ID, active actor/device, current signing-key ID and profile version, request ID,
SHA-256 of the canonical request with proof cleared, a 32-byte nonce and
issued-at timestamp. Publication command ID is the domain-prefixed SHA-256 of
canonical request fields 1 through 5, so one semantic batch has one command
identity.

The shared `model/domain/error/error.proto` gains Content PreKey error codes
`30201..30209` in the governed content range; responses keep using the
canonical `ErrorResponse` message.
Retry timing is an HTTP `Retry-After` header rather than another error model.

Key Exchange adds:

```text
key_exchange_content_prekey_publication_receipts
```

Its primary identity is `(publisher_ptid, publisher_device_id, command_id)`.
It stores the proof-free request bytes/hash, response bytes/hash,
`PENDING|COMPLETED` state and timestamps in the same transaction as key/pool
mutation. A first-time completed receipt must add at least one immutable key
row. Response bytes persist for the endpoint lifetime; a non-secret command
hash tombstone remains while corresponding immutable key rows remain.

Native command state is independent from per-key state:

```text
command: PENDING_PUBLICATION -> IN_FLIGHT -> UNKNOWN_COMMIT | PUBLISHED
key:     PENDING_PUBLICATION -> PUBLISHED -> ROOT_COMMITTED
```

Only the exact key whose envelope root key committed may enter
`ROOT_COMMITTED`. Orphaned send leases become `UNKNOWN_COMMIT` at bootstrap.
Endpoint keys are not deleted heuristically while Station may reference them.

### Proposed Recovery PreKey Derivation

Under `SC-D16`, the maintained BIP39 parser applies NFKD, validates
the English word list and checksum, and emits exactly 32 bytes of entropy for
the accepted 24-word recovery phrase. The KDF receives only those bytes.
`actor_ptid` and `key_id` are encoded as exact canonical UTF-8 bytes with no
normalization performed by the KDF: both are non-empty, unchanged by trimming,
NUL-free, and bounded to 255 and 128 bytes respectively. `recovery_epoch` is in
`1..2^63-1`. Integers are unsigned big-endian.

```text
master_salt_input =
  u32be(len(actor_ptid)) || actor_ptid || u64be(recovery_epoch)

K_sc_recovery = HKDF-SHA256(
  ikm  = BIP39_mnemonic_entropy,
  salt = SHA-256(
    "peers-touch:secure-content:recovery-master-salt:v1\0"
    || master_salt_input
  ),
  info = "peers-touch:secure-content:recovery:v1\0",
  L    = 32
)

prekey_context =
  u32be(len(actor_ptid)) || actor_ptid
  || u64be(recovery_epoch)
  || u32be(len(key_id)) || key_id

K_recovery_prekey = HKDF-SHA256(
  ikm  = K_sc_recovery,
  salt = SHA-256(
    "peers-touch:secure-content:recovery-prekey-salt:v1\0"
    || prekey_context
  ),
  info = "peers-touch:secure-content:recovery-prekey:v1\0"
         || prekey_context,
  L    = 32
)
```

The 32-byte output is the input to the maintained X25519 static-secret type,
which owns RFC 7748 clamping. There is no retry counter. Native must compare the
derived public key with the claimed recovery PreKey before HPKE open.

## 5. Encryption Plan And Envelope Binding

Social owns typed prepare requests:

```protobuf
enum PrivateMomentKind {
  PRIVATE_MOMENT_KIND_UNSPECIFIED = 0;
  PRIVATE_MOMENT_KIND_TEXT = 1;
  PRIVATE_MOMENT_KIND_IMAGE = 2;
  PRIVATE_MOMENT_KIND_VIDEO = 3;
  PRIVATE_MOMENT_KIND_LINK = 4;
  PRIVATE_MOMENT_KIND_POLL = 5;
  PRIVATE_MOMENT_KIND_REPOST = 6;
  PRIVATE_MOMENT_KIND_LOCATION = 7;
}

message PreparePrivateMomentRequest {
  string content_id = 1;
  Audience audience = 2;
  uint32 object_count = 3;
  string command_id = 4;
  PrivateMomentKind kind = 5;
  PrivateRepostAuthority repost_authority = 6;
  PrivatePollAuthority poll_authority = 7;
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
  bytes domain_binding_sha256 = 12;
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

message ViewerContentCommitProof {
  uint32 format_version = 1;
  string domain_commit_id = 2;
  bytes canonical_plan_sha256 = 3;
  SecureResourceRef resource = 4;
  peers_touch.model.actor.v1.ActorDeviceRef author = 5;
  bytes authorization_snapshot_sha256 = 6;
  bytes domain_binding_sha256 = 7;
  bytes encrypted_payload_sha256 = 8;
  bytes object_descriptor_set_sha256 = 9;
  bytes mention_routing_sha256 = 10;
  bytes subtype_authority_sha256 = 11;
  google.protobuf.Timestamp committed_at = 12;
  string station_signing_key_id = 13;
  bytes station_signature = 14;
}

message StationContentSigningKeyAttestation {
  uint32 format_version = 1;
  string station_peer_id = 2;
  string proof_signing_key_id = 3;
  bytes proof_ed25519_public_key = 4;
  string attesting_signing_key_id = 5;
  google.protobuf.Timestamp issued_at = 6;
  google.protobuf.Timestamp expires_at = 7;
  bytes station_signature = 8;
}
```

Plan canonicalization requires:

- `recipient_slot_id` ascending order and no duplicate slot/key claim;
- `domain_binding_sha256` coverage by the plan signature and payload AAD;
- one random slot per exact claimed endpoint or recovery principal;
- `principal_binding_sha256 = SHA-256(plan_id || slot_id || canonical principal
  || claim_id || one_time_key_id || one_time_public_key)`;
- only the binding hash, one-time key ID, and one-time public key leave Station;
- exact required-slot envelope coverage with no additional envelope;
- plan hash coverage of resource, author, authorization snapshot, object IDs,
  all slots, expiry, and claimed-key receipts.

`ViewerContentCommitProof` is a separate Station signature over exactly fields
`1..13` in deterministic protobuf order. Social selects `domain_commit_id`,
`committed_at`, and a retained Station signing-key ID, computes the signature,
and persists the exact proof bytes and command receipt inside the same UOW as
the Post/Comment, envelopes, deliveries, objects, and grants. Signing failure
rolls back the UOW. Exact replay returns the stored proof bytes, so a crash or
later key rotation cannot change the result. The proof exposes no recipient
slot, key claim, or unrelated envelope.

The deterministic binding bytes are simultaneously HPKE `info`, HPKE AEAD AAD,
and the Ed25519 signature input. Submit requires exactly one envelope per required
slot and rejects extra, missing, expired, remapped, or non-canonical envelopes.

`StationContentSigningKeyAttestation` is not part of the immutable command
receipt or commit-proof signature. Federation generates it on point read for
the proof's retained public key and signs fields `1..7` with the currently
trusted Station key. Its expiry can change across reads without changing the
business result or proof bytes.

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
  bytes mention_commitment_salt = 9;
}

message PrivateTextContent {
  string text = 1;
  repeated string hashtags = 2;
  repeated Mention mentions = 3;
}

message PrivateImageContent {
  string text = 1;
  repeated PrivateAttachmentMetadata images = 2;
  repeated string hashtags = 3;
  repeated Mention mentions = 4;
}

message PrivateVideoVariant {
  string variant_id = 1;
  uint32 bitrate = 2;
  string codec = 3;
  uint32 width = 4;
  uint32 height = 5;
  PrivateAttachmentMetadata media = 6;
}

message PrivateVideoContent {
  string text = 1;
  PrivateAttachmentMetadata source = 2;
  PrivateAttachmentMetadata poster = 3;
  repeated PrivateVideoVariant variants = 4;
  repeated string hashtags = 5;
  repeated Mention mentions = 6;
}

message PrivateLinkContent {
  string text = 1;
  LinkPreview link = 2;
  repeated string hashtags = 3;
  repeated Mention mentions = 4;
}

message PrivatePollOption {
  bytes opaque_option_id = 1;
  string label = 2;
}

message PrivatePollContent {
  string text = 1;
  string question = 2;
  repeated PrivatePollOption options = 3;
  bytes option_set_sha256 = 4;
  uint32 min_choices = 5;
  uint32 max_choices = 6;
  google.protobuf.Timestamp expires_at = 7;
  repeated Mention mentions = 8;
}

enum PrivateRenderedSourceKind {
  PRIVATE_RENDERED_SOURCE_KIND_UNSPECIFIED = 0;
  PRIVATE_RENDERED_SOURCE_KIND_TEXT = 1;
  PRIVATE_RENDERED_SOURCE_KIND_IMAGE = 2;
  PRIVATE_RENDERED_SOURCE_KIND_VIDEO = 3;
  PRIVATE_RENDERED_SOURCE_KIND_LINK = 4;
  PRIVATE_RENDERED_SOURCE_KIND_POLL = 5;
  PRIVATE_RENDERED_SOURCE_KIND_LOCATION = 6;
}

message SocialPostSourceRef {
  string post_id = 1;
  string private_content_id = 2;
  uint64 private_generation = 3;
}

message PublicRenderedSourceSnapshot {
  SocialPostSourceRef source = 1;
  peers_touch.model.actor.v1.ActorRef author = 2;
  google.protobuf.Timestamp created_at = 3;
  PrivateRenderedSourceKind kind = 4;
  repeated Mention typed_mentions = 5;
  oneof body {
    TextPost text = 10;
    ImagePost image = 11;
    VideoPost video = 12;
    LinkPost link = 13;
    PollPost poll = 14;
    LocationPost location = 15;
  }
}

message PrivateRenderedSourceSnapshot {
  SocialPostSourceRef source = 1;
  peers_touch.model.actor.v1.ActorRef author = 2;
  google.protobuf.Timestamp created_at = 3;
  PrivateRenderedSourceKind kind = 4;
  oneof body {
    PrivateTextContent text = 10;
    PrivateImageContent image = 11;
    PrivateVideoContent video = 12;
    PrivateLinkContent link = 13;
    PrivatePollContent poll = 14;
    PrivateLocationContent location = 15;
  }
}

message RenderedSourceSnapshot {
  oneof source_class {
    PublicRenderedSourceSnapshot public_source = 1;
    PrivateRenderedSourceSnapshot private_source = 2;
  }
}

message PrivateRepostContent {
  string comment = 1;
  SocialPostSourceRef original_source = 2;
  RenderedSourceSnapshot rendered_source = 3;
  repeated Mention mentions = 4;
  bytes rendered_source_commitment_salt = 5;
}

message PrivateLocationContent {
  string text = 1;
  Location location = 2;
  repeated PrivateAttachmentMetadata images = 3;
  repeated string hashtags = 4;
  repeated Mention mentions = 5;
}

message PrivateCommentContent {
  uint32 format_version = 1;
  string content_id = 2;
  string parent_content_id = 3;
  string text = 4;
  repeated Mention mentions = 5;
  bytes mention_commitment_salt = 6;
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

message MentionRoutingFact {
  peers_touch.model.actor.v1.ActorRef mentioned_actor = 1;
  bytes mention_commitment = 2;
}

message SignedMentionRouting {
  uint32 format_version = 1;
  SecureResourceRef resource = 2;
  bytes authorization_snapshot_sha256 = 3;
  bytes encrypted_payload_sha256 = 4;
  repeated MentionRoutingFact facts = 5;
  peers_touch.model.actor.v1.ActorDeviceRef sender = 6;
  string sender_signing_key_id = 7;
  bytes canonical_facts_sha256 = 8;
  bytes sender_signature = 9;
}
```

Both rendered-source body unions intentionally exclude REPOST. A canonical
PUBLIC snapshot maps only source ID, canonical actor, creation time, non-zero
kind, and the selected immutable body. It excludes `PostStats`,
`PostInteraction`, reactions, viewer state, audience envelopes, feed
explanations, and nested `original_post`. Public image/video/location media use
their source-owned URL attachment messages; `media_encryption` must be absent.
Legacy username-only `mentions` arrays inside the selected public body must be
empty; `typed_mentions` copies canonical `Post.typed_mentions` with UTF-16
offset/length and preserves authoritative order. Other lists preserve
authoritative stored order. Private video variants are ordered by `variant_id`,
unique, and bounded to eight. Attachment and object references in the outer
private body must match its plan's exact object set; references nested in a
private rendered repost snapshot remain bound to the authenticated source
descriptor set defined in section 7.

`mention_commitment_salt` is a random 32-byte per-resource secret stored only
inside the encrypted payload. `mention_commitment` is
HMAC-SHA256(`mention_commitment_salt`,
`"peers-touch:secure-content:mention:v1" || deterministic Mention bytes`).
Facts sort by canonical actor bytes and then commitment bytes.
`canonical_facts_sha256` hashes the canonical routing bytes defined in
`design.md`, including `encrypted_payload_sha256`; the author-device signature
covers that digest. Station cannot enumerate mention offsets or display text;
Native verifies exact commitments after decryption.

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
  SecureResourceRef resource = 1;
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

message PrivateMomentDomainBinding {
  uint32 format_version = 1;
  PrivateMomentKind kind = 2;
  bytes subtype_prepare_authority_sha256 = 3;
}

message PrivateCommentDomainBinding {
  uint32 format_version = 1;
  string post_id = 2;
  string reply_to_comment_id = 3;
}

message PreparePrivateMomentHashInput {
  uint32 format_version = 1;
  string command_id = 2;
  string content_id = 3;
  PrivateMomentKind kind = 4;
  bytes audience_sha256 = 5;
  uint32 object_count = 6;
  bytes subtype_prepare_authority_sha256 = 7;
}

message PreparePrivateCommentHashInput {
  uint32 format_version = 1;
  string command_id = 2;
  string post_id = 3;
  string comment_content_id = 4;
  string reply_to_comment_id = 5;
  uint32 object_count = 6;
}

message EnvelopeSubmitCommitment {
  string recipient_slot_id = 1;
  bytes binding_sha256 = 2;
  bytes envelope_sha256 = 3;
}

message ObjectSubmitCommitment {
  string object_id = 1;
  bytes descriptor_sha256 = 2;
}

message SubmitPrivateContentHashInput {
  uint32 format_version = 1;
  string command_id = 2;
  bytes canonical_plan_sha256 = 3;
  bytes encrypted_payload_sha256 = 4;
  repeated EnvelopeSubmitCommitment envelopes = 5;
  repeated ObjectSubmitCommitment objects = 6;
  bytes mention_routing_sha256 = 7;
  bytes subtype_authority_sha256 = 8;
}

message VotePrivatePollHashInput {
  uint32 format_version = 1;
  string command_id = 2;
  string post_id = 3;
  repeated bytes opaque_option_ids = 4;
}
```

The encrypted payload binds readable option labels to the same opaque option IDs
and `option_set_sha256`. Social validates parent access, expiry, choice cardinality,
option membership, and exact vote replay before mutating vote facts.

Hash inputs use deterministic protobuf encoding after canonicalization:

- "deterministic protobuf encoding" means the Secure Content project canonical
  encoder, not a language runtime's `deterministic` option. The encoder emits
  known fields in ascending field-number order, emits the selected `oneof` at
  its field-number position, uses minimal scalar and length encodings, preserves
  each explicitly canonicalized repeated-field order, omits protobuf defaults,
  and rejects unknown or duplicate singular fields before hashing or signing;
- W2 implements this encoder once in `packages/secure-content-core` and the
  stateless Station Go kernel, with cross-language vectors. W1 generated
  consumers only prove that every runtime can decode and semantically
  round-trip the same legal wire values;

- `audience_sha256` hashes `kind`, `target_id`, `base_kind`, and ascending
  `actor_ptids`; legacy `key_envelopes` are forbidden;
- the non-zero `PrivateMomentKind` and its canonical Social
  `domain_binding_sha256` are covered by prepare replay, the signed plan, and
  payload AAD;
- `subtype_prepare_authority_sha256` is required for POLL or REPOST and hashes
  exactly one complete deterministic `PrivatePollAuthority` or
  `PrivateRepostAuthority`; Social validates poll bounds or source grant and
  target-audience subset before claiming any Content PreKey;
- envelope commitments sort by `recipient_slot_id` and hash the complete
  deterministic `PreparedContentKeyEnvelope`;
- object commitments sort by `object_id` and hash the complete deterministic
  `EncryptedObjectDescriptor`;
- `encrypted_payload_sha256` hashes the complete deterministic
  `EncryptedPayload`, including format, resource, suite, nonce, ciphertext,
  ciphertext commitment, and AAD commitment;
- `mention_routing_sha256` hashes the complete deterministic
  `SignedMentionRouting`, including its signature;
- `subtype_authority_sha256` hashes exactly one deterministic poll or repost
  authority, or is empty when the payload subtype requires neither;
- poll option IDs sort by unsigned byte order.

The canonical request hash is SHA-256 over the deterministic hash-input message.
Duplicate stable identities, unknown fields, non-canonical ordering, or omitted
transport fields are rejected before lookup or mutation.

## 7. Resource Projection

```protobuf
message PostResource {
  PostMetadata metadata = 1;
  oneof body {
    PublicPostContent public_content = 2;
    PrivateContentAccess private_content = 3;
  }
}

message PrivatePollProjection {
  repeated PrivatePollOptionResult options = 1;
  uint64 voter_count = 2;
}

message PrivateContentVerification {
  ViewerContentCommitProof commit_proof = 1;
  SignedMentionRouting mention_routing = 2;
  oneof subtype_authority {
    PrivatePollAuthority poll_authority = 3;
    PrivateRepostAuthority repost_authority = 4;
  }
  StationContentSigningKeyAttestation station_signing_key_attestation = 5;
}

message PrivateContentAccess {
  EncryptedPayload payload = 1;
  ViewerContentKeyEnvelope viewer_envelope = 2;
  repeated EncryptedObjectDescriptor objects = 3;
  PrivatePollProjection poll = 4;
  PrivateContentVerification verification = 5;
}
```

Accepted `SC-D14` completes the W1 Social wire:

```protobuf
message PreparePrivateMomentResponse {
  ContentEncryptionPlan plan = 1;
}

message PreparePrivateCommentResponse {
  ContentEncryptionPlan plan = 1;
}

message PublicRepostSourceProof {
  bytes canonical_public_post_sha256 = 1;
}

message PrivateRepostSourceProof {
  SecureResourceRef source_resource = 1;
  bytes source_authorization_snapshot_sha256 = 2;
  bytes source_encrypted_payload_sha256 = 3;
  bytes source_commit_proof_sha256 = 4;
}

message PrivateRepostAuthority {
  SocialPostSourceRef source = 1;
  peers_touch.model.actor.v1.ActorRef source_author = 2;
  bytes rendered_source_commitment = 3;
  oneof source_proof {
    PublicRepostSourceProof public_source = 4;
    PrivateRepostSourceProof private_source = 5;
  }
}

message SubmitPrivateMomentRequest {
  ContentEncryptionPlan plan = 1;
  EncryptedPayload payload = 2;
  repeated PreparedContentKeyEnvelope envelopes = 3;
  repeated EncryptedObjectDescriptor objects = 4;
  SignedMentionRouting mention_routing = 5;
  PrivatePollAuthority poll_authority = 6;
  PrivateRepostAuthority repost_authority = 7;
  string command_id = 8;
}

message SubmitPrivateMomentResponse {
  PostResource post = 1;
  bool exact_replay = 2;
}

message SubmitPrivateCommentRequest {
  ContentEncryptionPlan plan = 1;
  EncryptedPayload payload = 2;
  repeated PreparedContentKeyEnvelope envelopes = 3;
  repeated EncryptedObjectDescriptor objects = 4;
  SignedMentionRouting mention_routing = 5;
  string command_id = 6;
}

message SubmitPrivateCommentResponse {
  CommentResource comment = 1;
  bool exact_replay = 2;
}

message PostMetadata {
  string post_id = 1;
  string content_id = 2;
  peers_touch.model.actor.v1.ActorRef author = 3;
  PostType type = 4;
  Audience.Kind audience_kind = 5;
  google.protobuf.Timestamp created_at = 6;
  google.protobuf.Timestamp updated_at = 7;
  bool is_deleted = 8;
  PostStats stats = 9;
}

message CommentMetadata {
  string comment_id = 1;
  string content_id = 2;
  string post_id = 3;
  string reply_to_comment_id = 4;
  peers_touch.model.actor.v1.ActorRef author = 5;
  google.protobuf.Timestamp created_at = 6;
  google.protobuf.Timestamp updated_at = 7;
  bool is_deleted = 8;
  int64 reactions_count = 9;
  int64 replies_count = 10;
}

message PublicPostContent {
  Post post = 1;
}

message PublicCommentContent {
  string text = 1;
  repeated Mention mentions = 2;
}

message CommentResource {
  CommentMetadata metadata = 1;
  oneof body {
    PublicCommentContent public_content = 2;
    PrivateContentAccess private_content = 3;
  }
}

message GetMomentResourceRequest {
  string post_id = 1;
}

message GetMomentResourceResponse {
  // Wire-compatible with GetPostResponse for existing public Moment clients.
  .peers_touch.model.social.v1.Post post = 1;
  .peers_touch.model.social.v1.FeedObjectExplanation explanation = 2;
  PostResource resource = 3;
}

message GetMomentCommentResourceRequest {
  string post_id = 1;
  string comment_id = 2;
}

message GetMomentCommentResourceResponse {
  CommentResource comment = 1;
}

message ListMomentCommentsRequest {
  string post_id = 1;
  string cursor = 2;
  uint32 limit = 3;
}

message ListMomentCommentsResponse {
  repeated CommentResource comments = 1;
  string next_cursor = 2;
  bool has_more = 3;
}

message PrivatePollOptionResult {
  bytes opaque_option_id = 1;
  uint64 vote_count = 2;
  bool selected_by_viewer = 3;
}

message VotePrivatePollResponse {
  repeated PrivatePollOptionResult options = 1;
  uint64 voter_count = 2;
  bool exact_replay = 3;
}
```

The signed plan's visible `PrivateMomentKind` determines whether poll or repost
authority is required. Station validates authority presence, its prepare/submit
hash equality, poll bounds or source-grant subset, exact envelope/object
coverage, canonical mention routing, plan expiry/revision, and command replay
inside the Social UOW. It never inspects encrypted subtype fields. Sender Native
validates plaintext subtype-to-authority equality before encryption; recipient
Native repeats that validation after authenticated decryption. Point and list
reads project at most the authenticated endpoint's
`ViewerContentKeyEnvelope`; unauthorized private resources use the uniform
not-found shape.

`PrivateContentAccess.verification` carries only the Station-signed viewer
commit proof, signed routing bundle, and applicable visible subtype authority.
It never carries another recipient, slot mapping, private text, or object key.
Recipient Native verifies the Station signature and every commit-proof binding,
then verifies the endpoint envelope, encrypted payload, decrypted subtype, and
decrypted mention commitments before publishing the local plaintext projection.

`PrivateContentAccess.poll` is present only for private POLL resources. Its
opaque option IDs must exactly match the committed `PrivatePollAuthority`;
counts and `selected_by_viewer` are viewer-scoped Social facts, while option
labels remain exclusively inside `EncryptedPayload`.

For reposts, Native requires `PrivateRepostContent.original_source`,
the selected rendered snapshot's `source`, and
`PrivateRepostAuthority.source` to be byte-identical. The selected snapshot
class must match the authority's source-proof class.
`PrivateRepostAuthority.source_author` must match authenticated Social metadata,
and `rendered_source_commitment` is HMAC-SHA256 over the domain
`"peers-touch:secure-content:repost-snapshot:v1"` and the complete deterministic
`RenderedSourceSnapshot`, keyed by the random 32-byte
`rendered_source_commitment_salt` stored only inside `PrivateRepostContent`.
PUBLIC sources require
`PublicRepostSourceProof.canonical_public_post_sha256` to equal SHA-256 over the
selected deterministic `PublicRenderedSourceSnapshot`; private sources require
the exact private `SecureResourceRef`, authorization snapshot, encrypted-payload
hash, and viewer commit-proof hash. Recipient Native fetches the source through
`source.post_id`, verifies the applicable public or private proof, derives the
same rendered snapshot, and rejects any attribution or content mismatch. The
selected snapshot kind must be non-zero and select exactly the corresponding
body field; unspecified, mismatched, missing, or multiple body representations
are rejected.

Attachments nested in `PrivateRenderedSourceSnapshot` retain their original
source-bound `EncryptedObjectDescriptor`. They are excluded from the repost
plan's object set, are never copied or reattached by the repost UOW, and are
fetched through `source.post_id` under current source authorization. Attachments
in `PublicRenderedSourceSnapshot` retain source-owned public media IDs/URLs and
are revalidated through the public source route. Attachments owned by the outer
repost body, if any, remain repost-bound and must match the repost plan's exact
object set. If the source Post or object is deleted, blocked, or otherwise
unavailable, Native does not render the stored source snapshot as a substitute.

`ListMomentCommentsRequest.limit` and
`ListRecoverablePrivateContentRequest.limit` accept `1..100`; zero, overflow,
or malformed cursors fail closed. A private poll accepts `2..20` unique opaque
option IDs, with `1 <= min_choices <= max_choices <= option_count`.

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
social_private_content_plans
social_private_content_plan_slots
social_private_content_envelopes
social_private_command_receipts
social_private_object_uploads
social_private_object_parts
social_private_objects
social_private_object_grants
```

| Table | Primary identity | Required bindings |
|---|---|---|
| `social_private_posts` | `post_id`, unique `content_id` | author, generation, snapshot ID, canonical encrypted payload bytes/hash, counters, lifecycle |
| `social_private_comments` | `comment_id`, unique `content_id` | post, parent comment, author, interaction snapshot, canonical encrypted payload bytes/hash |
| `social_private_audience_snapshots` | `snapshot_id`, unique `post_id` | audience kind/target, source revision, canonical snapshot hash |
| `social_private_recipient_grants` | `(snapshot_id, recipient_ptid)` | grant time, revoke time/reason |
| `social_private_content_plans` | `plan_id`; unique `(author_ptid, prepare_command_id)`; unique `(content_id, generation)` | canonical prepare bytes/hash, exact audience bytes/hash, exact subtype prepare-authority bytes/hash, exact Key Exchange claim-request bytes/hash and ordered targets, exact claim-response bytes/hash, resource kind, author endpoint, snapshot ID, exact signed plan bytes/hash, state, expiry, optional domain commit |
| `social_private_content_plan_slots` | `(plan_id, recipient_slot_id)`; globally unique `claim_id`; unique `(plan_id, one_time_key_id)` | key kind, recipient actor/device, principal epoch, exact claimed PreKey bytes/hash including issuer signature, principal-binding hash |
| `social_private_content_envelopes` | `(content_id, key_kind, recipient principal, one_time_key_id)` | exact plan/binding/envelope/signature hashes |
| `social_private_command_receipts` | `(author_ptid, command_id)` | canonical submit hash, resource kind/content/generation, domain commit ID, exact response bytes/hash, completion time |
| `social_private_object_uploads` | `(upload_id, generation)`; unique `(uploader_ptid, begin_command_id)` | content ID, uploader endpoint, upload spec, descriptor commitment, bitmap, state, expiry, canonical begin/complete/cancel command bytes and hashes, verify/GC lease owner/generation/expiry, attempts, next retry and terminal outcome hash |
| `social_private_object_parts` | `(upload_id, generation, chunk_index)`; unique `(upload_id, generation, idempotency_key)` | offset, size, ciphertext hash, canonical idempotency key, immutable storage key, WRITING/STORED state, lease owner/generation/expiry, attempts and next retry |
| `social_private_objects` | `object_id` | content ID, uploader, canonical descriptor, state, domain commit ID, GC lease owner/generation/expiry and immutable tombstone/result hash |
| `social_private_object_grants` | `(object_id, principal kind, principal)` | domain commit ID, grant/revoke facts |

All resource, slot, key, and command uniqueness constraints are database-backed.
Private payload bytes are stored once as canonical `EncryptedPayload`; indexed
hash columns are generated/validated mirrors and cannot be independently updated.
Command receipts store canonical business-result bytes with
`exact_replay=false`; exact replay validates those bytes and sets
`exact_replay=true` only on the returned clone.

Conversation keeps its accepted `conversation_attachment_*` table family.
There is no shared `secure_content_*` authority table.

Private Social Post/Comment rows contain canonical encrypted payload bytes and
indexed commitments, not duplicated plaintext or independently mutable nonce/body
representations.

Federation authentication separately owns
`auth_station_content_signing_key_history`, keyed by
`(station_peer_id, signing_key_id)`, with the retained Ed25519 public key,
`first_active_at`, `last_active_at`, `retired_at`, and immutable
`retirement_reason`. It stores no content row, proof, audience fact or old
private key. Social accesses it only through the `SC-D19` read/attestation
capability.

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
- exact Station-signed `ViewerContentCommitProof` bytes;
- exact command receipt.

Conversation retains its current event/object/grant atomic UOW.

## 11. State Machines

Plan:

```text
PREPARING -> PREKEYS_CLAIMED -> PREPARED -> CONSUMED(domain_commit_id)
PREPARING -> RETRY_WAIT | CANCELLED | EXPIRED
PREKEYS_CLAIMED -> PREPARED | RETRY_WAIT | CANCELLED | EXPIRED
RETRY_WAIT -> PREPARING | CANCELLED | EXPIRED
PREPARED -> CONSUMED | REJECTED_STALE | CANCELLED | EXPIRED
```

`PREPARING` is persisted before the external Key Exchange claim. If the process
stops after irreversible claim but before `PREPARED`, exact prepare replay
reuses the persisted canonical claim request with the same `plan_id`, validates
the exact Key Exchange response, then persists the same slots and signed plan.
Cancellation or expiry never releases a claimed PreKey, and terminal states
never return to `PREPARING`. Submit locks the plan and
`(author_ptid, command_id)` receipt before any domain write. It revalidates
current endpoint activity/profile, the recovery-pool epoch, and the FRIENDS
snapshot; drift transitions the plan to `REJECTED_STALE`.

Object:

```text
CREATED -> RECEIVING_PARTS -> VERIFYING -> COMPLETE_UNATTACHED
COMPLETE_UNATTACHED -> ATTACHED(domain_commit_id)
CREATED/RECEIVING_PARTS -> CANCELLED | EXPIRED
VERIFYING -> RECEIVING_PARTS  # retriable storage interruption before verdict
VERIFYING -> TERMINAL_CORRUPT # decided hash/size/bitmap mismatch
CREATED/RECEIVING_PARTS/VERIFYING/COMPLETE_UNATTACHED/
  CANCELLED/EXPIRED/TERMINAL_CORRUPT
  -> GC_CLAIMED -> GARBAGE_COLLECTED
```

Exact identity/hash replay returns the original result. Same identity with another
hash is terminal conflict. An `ATTACHED` object cannot use the pre-attachment
GC transition; later domain deletion must revoke every grant before scheduling
its separate cleanup.

Under accepted `SC-D18`, begin persists the canonical request before any chunk
write. Chunk identity is `(upload_id, generation, chunk_index)` and exact replay
also binds offset, size, hash and idempotency key. Complete and cancel store
their canonical command hashes on the upload row, so a restart returns the same
descriptor/state while a conflicting command cannot reinterpret existing bytes.

## 12. Recovery Query

```protobuf
message ListRecoverablePrivateContentRequest {
  string cursor = 1;
  uint32 limit = 2;
}

message PrivateCommentLocator {
  string post_id = 1;
  string comment_id = 2;
}

message SocialPrivateContentLocator {
  oneof resource {
    string post_id = 1;
    PrivateCommentLocator comment = 2;
  }
}

message RecoverablePrivateContent {
  SecureResourceRef resource = 1;
  SocialPrivateContentLocator locator = 2;
  ViewerContentKeyEnvelope recovery_envelope = 3;
  bytes payload_ciphertext_sha256 = 4;
}

message ListRecoverablePrivateContentResponse {
  repeated RecoverablePrivateContent resources = 1;
  string next_cursor = 2;
  bool has_more = 3;
}
```

Social lists only currently authorized resources, includes the exact domain
locator required by the existing point-read route, and maps actor recovery slots
to the caller. Locator kind must match the `SecureResourceRef` owner/domain fact
and resolve to the same content ID and generation; mismatches are rejected. The
recovered device derives the claimed recovery private key from the recovery
secret, recovery epoch, and one-time key ID, then fetches the viewer-scoped
payload and object descriptors through that locator. Results are cursor
paginated and restartable; no root-key list is embedded in the whole Recovery
archive.

## 13. Deterministic Lifecycle Evidence Model

`SC-D21` adds Development/Acceptance control records. They are not product
business messages and do not enter Social, Conversation, Key Exchange, or
Secure Content public APIs. Their wire projection belongs to the existing
versioned Development runtime-manifest/scenario schema and must remain typed
and canonical.

```text
LifecycleBarrierRecord {
  schema_version
  run_id
  operation_id
  barrier_kind
  ordinal
  source_checkpoint
  runtime_manifest_digest
  boot_identity
  session_generation
  production_state
  command_digest?
  request_digest?
  state_digest?
  release_token
  created_at
}

RuntimeRestartRequest {
  schema_version
  run_id
  request_id
  client_id
  parent_runtime_manifest_digest
  expected_source_checkpoint
  expected_profile
  retained_storage_identity_digest
  resume_artifact_digest
}

RuntimeRestartAcknowledgement {
  schema_version
  request_id
  owner_id
  parent_runtime_manifest_digest
  child_runtime_manifest_digest
  previous_boot_identity
  current_boot_identity
  session_generation
  retained_storage_identity_digest
  lease_evidence_ref
}

StreamTerminalMarker {
  schema_version
  capture_id
  action_id
  runtime_manifest_digest
  final_observer_sequence
  open_stream_identity_digests[]
  capture_interval_digest
}

FixtureManifest {
  schema_version
  fixture_set_id
  source_checkpoint
  handles[]
  manifest_digest
}

FixtureHandle {
  kind
  opaque_id
  owner
  capability
  expected_identity_digest
  secret_channel_ref?
}
```

Rules:

- `barrier_kind` is exactly `persisted-before-send`,
  `sent-before-response`, or `response-before-local-commit`.
- One operation has ordinals `1`, `2`, and `3` in that order. A journey may
  stop at an earlier barrier only when its declared assertion requires it.
- `release_token` is random, run-local, single-use, and never written to the
  final evidence bundle.
- Barrier digests bind canonical production-owned state but cannot contain
  plaintext, key material, signatures, credentials, PTIDs, device IDs, raw
  request/response bytes, or local paths.
- A child runtime manifest binds exactly one parent manifest and restart
  request. `previous_boot_identity == current_boot_identity` is invalid.
- Retained restart continuity requires equal storage identity digests and
  unchanged source/profile/client bindings; it does not expose the storage path.
- `final_observer_sequence` closes the capture interval inclusively. Events
  after it are outside that interval even if a listed stream remains open.
- A fixture manifest is immutable after scenario attachment. Its digest is
  bound into the runtime manifest and result evidence.
- `secret_channel_ref` is an ephemeral delivery reference, not secret material.
  It is consumed by Native and omitted from result serialization.

Lifecycle controller state:

```text
DISABLED
  -> ARMED(operation_id, boot_identity, session_generation)
  -> WAITING(barrier_1) -> RELEASED(barrier_1)
  -> WAITING(barrier_2) -> RELEASED(barrier_2)
  -> WAITING(barrier_3) -> RELEASED(barrier_3)
  -> COMPLETED

any state -> FAILED_CLOSED
process restart -> DISABLED
```

A controller never survives process restart. Continuation creates a new
controller under the child runtime manifest and consumes the immutable resume
artifact. The runtime owner, not the controller, owns process lifecycle.

## 14. Accepted Development Runtime Manifest v3

Accepted `SC-D22`, as amended by accepted `SC-D28`, replaces the
single-profile Development attachment schema with one immutable multi-service
manifest and hard-cuts its service identity shape from v2 to v3:

```text
DevelopmentRuntimeManifestV3 {
  schema_version = 3
  kind = "secure-content-development-runtime"
  run_id
  journey_id
  source {
    canonical_worktree
    workspace_id
    commit
    worktree_set_digest
    workspace_digest = "clean"
  }
  controller_binding {
    profile_id = "four"
    slot = 5
  }
  services {
    <service_id> {
      kind
      profile_id
      deployment_environment
      endpoint
      schema_attestation_endpoint
      live_commit
      protocol_digest
      runtime_identity
      attestation_artifact_ref
      canonical_private_schema_attestation_ref
    }
  }
  clients[] {
    id
    actor_role
    actor_role_digest
    runtime_kind
    required_service_roles[]
    service_bindings {
      <role> {
        service_id
        required_kind
      }
    }
    storage_identity_digest
    boot_identity
    session_generation
    automation_attachment_ref
    harness_identity_digest
  }
  fixture_manifest_ref
  fixture_manifest_digest
  lifecycle_observer_capabilities[]
  created_at
  manifest_digest
}
```

Rules:

- `source.commit` equals the clean current checkpoint and every Station
  `live_commit` required by the Journey equals that checkpoint.
- `services` is the only Station/Relay topology truth. A service role is stable
  and cannot encode `four`, `fiveArm`, an endpoint, or list position.
- `clients[].id` is unique and stable within the environment. Actor role is not
  client identity.
- each required service role has exactly one binding to a same-manifest service
  whose kind matches `required_kind`;
- client runtime kind is exactly `native-tauri`, `browser`,
  `tauri-ios-simulator`, or `tauri-android-emulator`;
- storage, boot, session, automation, Harness, actor, and Station identities
  are observed from the live client and bind to the runtime-owner allocation;
- `endpoint` is the exact runtime connection route consumed by clients,
  scenarios, the live service attestation, and Harness identity validation;
- `schema_attestation_endpoint` is the profile-owned canonical deployment
  route used only to reconstruct the service-attestation binding digest carried
  by `CanonicalPrivateSchemaAttestationV1`; the canonical digest projection
  copies the service identity fields, substitutes this value into its
  `endpoint` member, and excludes the live `endpoint`; it is never inferred
  from `endpoint`, profile ID, deployment environment, service ID, or CLI
  order;
- both endpoint values are non-secret connection data and are independently
  syntax-validated and manifest-digest-bound; credentials, tokens, keys,
  plaintext, raw device handles, and local storage paths are excluded;
- the two endpoint values may be equal when the runtime connects directly, but
  a missing field, cross-use, fallback, or digest mismatch fails closed before
  the first private product action;
- the manifest is outside the repository, owned by the current user, mode
  `0600`, immutable after publication, and hash-verified before and after every
  scenario action;
- CLI profile selectors must equal the manifest service-profile set exactly and
  never become an alternate topology source;
- v2 and v3 are not accepted concurrently. The implementation cut replaces the
  v2 reader/writer and fixtures in the same checkpoint; no compatibility
  reader, alias, or migration path remains.

Each child Development result contains:

```text
DevelopmentScenarioResult {
  schema_version
  workstream_id
  journey_id
  scenario_id
  variant_id
  runtime_kind
  client_ids[]
  service_ids[]
  source_commit
  runtime_manifest_digest
  fixture_manifest_digest
  status
  first_failure?
  observation_digests[]
  cleanup_result
}
```

An aggregate result contains only immutable child-result references and their
digests. Missing, stale, duplicate, wrong-runtime, or non-PASS required child
results keep the aggregate `UNPROVEN`.

## 15. Accepted Reset Manifest And Audit Model

Accepted `SC-D23` introduces one immutable reset identity per profile:
accepted `SC-D24` adds `reset_intent`, the bounded invocation, and the schema
attestation before the first implementation, so the control records remain
version `1`.

```text
SecureContentResetManifestV1 {
  schema_version = 1
  reset_id
  reset_intent = SCHEMA_ACTIVATION | FINAL_CUT
  source_commit
  workspace_id
  profile_id
  deployment_environment
  destructive_scope
  database_identity_digest
  public_snapshot_before
  database_targets[]
  canonical_private_object_targets[]
  legacy_oss_object_targets[]
  out_of_scope_table_names[]
  recovery_predecessor?
  created_at
  manifest_digest
}

ResetRecoveryPredecessorV1 {
  reset_id
  reset_manifest_digest
  journal_digest
  state = OBJECTS_DELETED | STATION_DEPLOYED
  failure_code = RESET_SOURCE_SUPERSEDED | RESET_SCHEMA_TARGET_UNREVIEWED
}

SecureContentResetInvocationV1 {
  schema_version = 1
  invocation_id
  reset_id
  reset_intent
  reset_manifest_digest
  plan_id
  task_id
  declaration_digest
  source_commit
  workspace_id
  profile_id
  deployment_environment
  destructive_scope
  issued_at
  expires_at
  invocation_digest
}

DatabaseResetTarget {
  table
  operation
  predicate?
  expected_schema_before_digest
  expected_row_count
}

ObjectResetTarget {
  owner_domain
  owner_identity_digest
  backend
  storage_key_digest
  metadata_digest
  blob_digest
  source_row_digest
  reference_classification
}

PublicSocialSnapshotV1 {
  schema_version = 1
  profile_id
  public_post_schema_digest
  public_post_rows_digest
  public_comment_rows_digest
  public_reaction_rows_digest
  public_object_metadata_digest
  public_object_bytes_digest
  counts
  snapshot_digest
}

ResetJournalV1 {
  schema_version = 1
  reset_manifest_digest
  current_state
  accepted_invocations[]
  transitions[]
  failure?
}

ResetInvocationAcceptance {
  invocation_id
  invocation_digest
  accepted_at
}

CanonicalPrivateSchemaAttestationV1 {
  schema_version = 1
  source_commit
  workspace_id
  profile_id
  deployment_environment
  destructive_scope
  station_service_id
  station_peer_id
  station_runtime_identity
  service_attestation_digest
  reset_intent
  reset_manifest_digest
  completed_journal_digest
  canonical_private_schema_digest
  retired_columns_absent
  public_snapshot_digest
  created_at
  attestation_digest
}
```

The database operation vocabulary is closed:

```text
CLEAR_TABLE
DELETE_WHERE_POST_CLASS_PRIVATE
DROP_RETIRED_TABLE
REBUILD_CANONICAL_PRIVATE_POST_TABLE
```

The manifest's table/predicate pairs are exactly:

| Target | Operation |
|---|---|
| `social_private_content_plans` | `CLEAR_TABLE` |
| `social_private_content_plan_slots` | `CLEAR_TABLE` |
| `social_private_command_receipts` | `CLEAR_TABLE` |
| `social_private_posts` | `CLEAR_TABLE` |
| `social_private_comments` | `CLEAR_TABLE` |
| `social_private_audience_snapshots` | `CLEAR_TABLE` |
| `social_private_recipient_grants` | `CLEAR_TABLE` |
| `social_private_content_envelopes` | `CLEAR_TABLE` |
| `social_private_delivery_intents` | `CLEAR_TABLE` |
| `social_private_object_uploads` | `CLEAR_TABLE` |
| `social_private_object_parts` | `CLEAR_TABLE` |
| `social_private_objects` | `CLEAR_TABLE` |
| `social_private_object_grants` | `CLEAR_TABLE` |
| `social_private_commit_proofs` | `CLEAR_TABLE` |
| `social_comments` | `DELETE_WHERE_POST_CLASS_PRIVATE` |
| `social_reactions` | `DELETE_WHERE_POST_CLASS_PRIVATE` |
| `social_moment_deliveries` | `CLEAR_TABLE` |
| `social_private_audience_grants` | `DROP_RETIRED_TABLE` |
| `social_private_posts` | `REBUILD_CANONICAL_PRIVATE_POST_TABLE` after clear |

The private-post rebuild retains only the canonical
`SocialPrivateContentPost` columns and indexes. The retired-column allowlist is
owned by `SC-D23`; discovery of an additional non-canonical column returns
`RESET_SCHEMA_TARGET_UNREVIEWED` before mutation.

Object targets are keyed by digests in durable artifacts, while the live
owner-specific deletion adapter receives the resolved key through an ephemeral
run context. This prevents storage keys and user identities from leaking into
reviewable evidence. Each target must be exclusively private or shared-CAS-safe;
an unknown or public/Conversation reference returns
`RESET_OBJECT_REFERENCE_AMBIGUOUS`.

Journal transitions are monotonic:

```text
PREPARED
  -> DATABASE_SCHEMA_COMMITTED
  -> OBJECTS_DELETED
  -> STATION_DEPLOYED
  -> POST_AUDIT_PASSED
  -> COMPLETE

PREPARED
  -> SUPERSEDED

STATION_DEPLOYED
  -> RECOVERY_REPLACED

OBJECTS_DELETED
  -> RECOVERY_REPLACED
```

`DATABASE_SCHEMA_COMMITTED` means the allowlisted row deletion and canonical
private-post table rebuild committed in one database transaction. On resume,
the owner revalidates the exact schema and data state before continuing; it
does not repeat conflicting DDL.

Only the exact same manifest digest may resume a partial journal.
`SUPERSEDED` is terminal non-success and is legal only from `PREPARED`.
Admission of a fresh authorized manifest atomically supersedes the older
`PREPARED` journal when workspace, profile, deployment environment, destructive
scope, and intent match but source commits differ. Same-source conflicts and
all post-commit states remain active conflicts. Public snapshot inequality,
extra target rows/columns, source/runtime drift, lease loss, or incomplete
deletion blocks `COMPLETE`.

Accepted `SC-D26` adds one narrow exception for the verified W12A source
contradiction and a source defect found at the deployment handoff. A fresh
manifest may carry one `recovery_predecessor` only when the existing active
journal is an unfailed `OBJECTS_DELETED` journal or exactly
`STATION_DEPLOYED` with `RESET_SCHEMA_TARGET_UNREVIEWED`. The predecessor
record binds its reset and manifest identities plus the complete pre-transition
journal digest. The
predecessor and fresh manifest must have equal workspace, profile, deployment
environment, destructive scope, reset intent, database identity, and public
snapshot, while source commits and reset IDs differ.

Fresh invocation admission re-reads and locks the predecessor. Only an exact
match may atomically append `<predecessor> -> RECOVERY_REPLACED` and create the
fresh `PREPARED` journal. A `STATION_DEPLOYED` predecessor retains its original
schema failure; an `OBJECTS_DELETED` predecessor records
`RESET_SOURCE_SUPERSEDED`. It is excluded from active-scope conflicts but
cannot resume, advance, emit an attestation, or satisfy an aggregate. No other
post-commit state or failure code is replaceable.

Accepted `SC-D27` adds an append-only
`social_secure_content_reset_replacements` execution receipt:

```text
predecessor_reset_id            primary key, FK -> reset manifests
initial_successor_reset_id      unique, FK -> reset manifests
predecessor_manifest_digest
predecessor_journal_digest
predecessor_state
predecessor_failure_code        nullable
terminal_failure_code           nullable
replacement_reason
deployment_environment
destructive_scope
provenance_mode                 LOCKED_ADMISSION | REVIEWED_MIGRATION
replaced_at
```

The fresh manifest is audited and persisted before mutation. The receipt is
then inserted in the same invocation transaction as predecessor
terminalization, fresh journal persistence, and first successor invocation
acceptance. The predecessor journal retains its original failure projection;
the replacement reason exists only in the receipt. The exact allowed tuples
are:

```text
OBJECTS_DELETED + no failure
  -> RESET_SOURCE_SUPERSEDED
OBJECTS_DELETED + RESET_PARTIAL_FAILURE
  -> RESET_SOURCE_SUPERSEDED
STATION_DEPLOYED + RESET_SCHEMA_TARGET_UNREVIEWED
  -> RESET_SCHEMA_TARGET_UNREVIEWED
STATION_DEPLOYED + RESET_JOURNAL_STATE_CONFLICT + existing recovery ancestry
  -> RESET_SOURCE_SUPERSEDED
```

For the ancestry-qualified journal-conflict branch, the complete predecessor
chain must validate inside the admission transaction before replacement. The
manifest's `predecessor_journal_digest` is a compare-and-swap token verified
against the locked live projection. Terminal validation consumes the
append-only receipt and never reconstructs that historical digest from the
terminal row.

If SC-D25 later supersedes an uncommitted recovery successor, the replacement
receipt continues to name the initial successor. The newer manifest inherits
the exact predecessor link and validates against the same receipt.

The optional field does not alter canonical JSON or digests for existing
manifests when absent. A recovery manifest includes it in its canonical digest.
If SC-D25 supersedes an uncommitted `PREPARED` recovery manifest, its successor
inherits the exact same predecessor link so the ancestry cannot be truncated.
The fresh reset still executes the full SC-D23 target set. Its post-audit also
walks the bounded, cycle-free predecessor chain, loads every persisted object
target, and requires each original Social or OSS owner to prove the target
remains deleted. It earns success only through its own complete journal.

Under accepted `SC-D24`, reset intent is closed and immutable. A
`SCHEMA_ACTIVATION` completion emits the schema attestation required by W7-W11
runtime manifests. `FINAL_CUT` creates a new manifest and journal and cannot
reuse or relabel the activation result. A schema attestation is valid only for
its exact source, profile, deployment environment, destructive scope, Station
service/peer/runtime identity, service attestation, completed journal, schema
digest, and public snapshot.

The reset invocation is a bounded control record delivered through
OS-authenticated SSH stdin. The remote maintenance CLI acquires a database
advisory lock keyed by deployment environment and destructive scope. The
journal records each accepted invocation ID and digest. Exact replay returns
the current journal state; a conflicting digest for one invocation ID fails.
Resume retains the reset manifest and journal identity but uses a fresh
invocation ID. Expired, wrong-source, wrong-environment, wrong-scope, or
different-manifest invocation fails before mutation.

## 16. Limits

| Resource | Initial bound |
|---|---|
| private payload ciphertext | 1 MiB |
| objects per resource | 10 |
| object plaintext | 2 GiB |
| object chunks | 2048 at fixed 1 MiB plaintext |
| encrypted video variants | 8 |
| rendered repost depth | 1 non-recursive snapshot |
| mention routing facts | 256 |
| private poll options | 20 |
| comment page | 100 resources |
| recipient actors per plan | 256 |
| endpoint plus recovery slots per plan | 1000 |
| active plans per actor | 4 |
| plan lifetime | 5 minutes |
| active uploads per actor/domain | 4 |
| unattached object TTL | 24 hours |
| recovery page | 100 resources |

Limits fail closed with typed errors and require benchmark/abuse evidence before
increase.
