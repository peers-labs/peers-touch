# Secure Content - Data Model

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-09-13 | **Updated**: 2026-09-14
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
  PostResource post = 1;
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
- exact Station-signed `ViewerContentCommitProof` bytes;
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

## 13. Limits

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
