# Secure Content - Integration And Migration

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-09-13 | **Updated**: 2026-09-14
> **Owner**: Architecture Team

---

## 1. Current-To-Target Mapping

| Current asset | Target |
|---|---|
| `common.EncryptedMediaDescriptor` with inline key fields | key-free `secure_content.EncryptedObjectDescriptor` |
| Chat attachment protobuf wire | retained unchanged; Chat adapter maps to neutral core structs |
| `messaging-core::attachment` generic crypto/FSM | `packages/secure-content-core`; Chat keeps its adapter |
| Conversation attachment routes/tables/UOW | retained under Conversation and refactored to use shared kernels |
| Desktop Social crypto in `oss.rs` | deleted; Native Social adapter uses Secure Content Core |
| `momentAudienceKeys.ts` and signaling envelopes | deleted; Native HPKE plan/envelope flow |
| `Audience.key_envelopes` | removed; viewer-scoped endpoint/recovery envelope |
| Social private plaintext columns | encrypted private Post/Comment payloads |
| Social public ciphertext upload | Social-owned encrypted-object route and grant |
| OSS `storage.Backend` | retained as domain object-plane byte adapter |
| Recovery key catalog proposal | replaced by one-time actor recovery PreKeys and paginated recovery envelopes |
| missing point-read authentication | shared strict Optional JWT |

## 2. Ownership Integration

### Social

Owns:

- Moment/Comment routes, lifecycle, persistence, delivery, audit, and object plane;
- audience and interaction recipient snapshots;
- current block/delete/relation checks;
- exact command receipt and outer UOW;
- FRIENDS truth from accepted `social_relationship_projections`;
- GROUP snapshots through a Conversation query port.

### Conversation

Keeps:

- `/conversation/attachments/*`;
- Conversation attachment tables, UOW, grants, audit, retention, and historical
  recipient semantics;
- Message Private Content, Direct/MLS integration, and receipt behavior.

It replaces generic crypto/validation/FSM code with shared-kernel imports without
moving authority.

### Shared Kernels

- `packages/secure-content-core`: portable Native crypto and transfer FSM.
- `apps/station/app/internal/securecontent`: stateless Go validation, transition,
  policy, typed-error, and repository-conformance kernel.
- `model/domain/secure_content`: cross-platform contract source.

Neither kernel owns routes, persistence, transactions, recipient policy, or workers.

### Actor Identity And Key Exchange

Actor Identity continues to own active/revoked endpoints. Key Exchange adds
separate exact-once endpoint and actor-recovery Content PreKey pools with independent
inventory and replenishment from Direct/MLS material. Under accepted `SC-D15`, Key
Exchange resolves publisher signing material through the Actor Identity
capability, then uses an Actor Identity-owned transaction fence to keep the
verified key/profile/revocation snapshot stable through publication and
unclaimed-key exposure.

### Recovery

The existing 24-word recovery secret derives the actor Content Recovery master.
Recovery continues storing opaque actor revisions; root content keys are recovered
from Social-held recovery envelopes, not copied into a growing whole-archive key
catalog.

### OSS

Public OSS APIs continue serving public assets. Social and Conversation object
adapters use `storage.Backend` directly for private ciphertext. Private objects are
not represented by generic OSS visibility rows and cannot be fetched through
`/oss/file`.

## 3. Domain API Ownership

No `/secure-content/*` public API is introduced.

Conversation retains:

```text
/conversation/attachments/*
```

Social owns:

```text
POST /api/v1/social/moments:prepare-private
POST /api/v1/social/moments:submit-private
GET  /api/v1/social/moments/{post_id}
GET  /api/v1/social/moments/{post_id}/comments
POST /api/v1/social/moments/{post_id}/comments:prepare-private
POST /api/v1/social/moments/{post_id}/comments:submit-private
GET  /api/v1/social/moments/{post_id}/audience

POST /api/v1/social/moments/objects/uploads:begin
GET  /api/v1/social/moments/objects/uploads/{upload_id}
PUT  /api/v1/social/moments/objects/uploads/{upload_id}/chunks/{chunk_index}
POST /api/v1/social/moments/objects/uploads/{upload_id}:complete
POST /api/v1/social/moments/objects/uploads/{upload_id}:cancel
GET  /api/v1/social/moments/objects/{object_id}

GET  /api/v1/social/moments/recoverable
```

The API Ownership and `MP-D23` contracts remain valid. Social adds only Social
capabilities; Conversation keeps Chat attachment authority.

The two `:submit-private` paths above are proposed by `SC-D17`. They keep the
generated private request types distinct from the existing public
`CreatePostRequest` and `CreateCommentRequest` handlers. Content negotiation
does not select public versus private business semantics. Once W6 lands, the
legacy create routes reject non-PUBLIC payloads instead of storing plaintext or
dispatching to the private flow.

## 4. Audience Ports

Social defines narrow owner ports:

```go
type FriendSnapshotReader interface {
    AcceptedFriends(ctx, authorPTID string) (FriendSnapshot, error)
}

type GroupRecipientSnapshotReader interface {
    ActiveGroupRecipients(
        ctx context.Context,
        conversationID string,
        authorPTID string,
    ) (GroupRecipientSnapshot, error)
}
```

`FriendSnapshot` is derived only from accepted `social_relationship_projections`
and includes an immutable snapshot hash/version. It does not read
`friend_chat_friendships` or infer friendship from mutual follows.

`GroupRecipientSnapshot` is returned by Conversation query service and binds
conversation ID, membership epoch, public head hash, active actor set, and endpoint
manifests. Social never reads Conversation persistence.

FOLLOWERS, CIRCLE, SELF, and CUSTOM snapshots remain Social-owned and gain explicit
revision/hash contracts.

## 5. Post Subtype Integration

| Type | Domain behavior |
|---|---|
| TEXT | private text/hashtags/mentions stay in encrypted payload |
| IMAGE/VIDEO | Native creates encrypted objects; real media metadata stays encrypted |
| LINK | Native fetches/generates preview before encryption; Station does not fetch private URLs |
| LOCATION | coordinates/address are encrypted; object rules apply to images |
| POLL | prepare commits opaque option IDs; Station validates votes and stores counts without option labels |
| REPOST | prepare reads source grant; target private recipient set must be a subset of source set |
| COMMENT | independent key and interaction-visible plan |
| REACTION | Station-visible Social fact, returned only after parent authorization |
| MENTION | signed routing PTIDs must be a subset of frozen recipients; notification contains no private text |

## 6. Client Integration

```text
Composer / Detail / Comment UI
  -> Social runtime typed intent
  -> Native Social adapter
  -> Secure Content Core
  -> Social domain routes
```

Desktop and Mobile Native own key access, encryption, transfer checkpoints,
decryption, local SQLCipher projection, and recovery. Web layers own plaintext
composition/rendering but never cryptographic material or transfer state.

Browser supports PUBLIC only and rejects private operations before network send.

## 7. Transaction Integration

Social's UOW commits Post/Comment fact, snapshot, slot mappings, envelopes,
delivery intents, object attachments, grants, and command receipt in one transaction.

Under proposed `SC-D17`, prepare state is durable before Key Exchange claim in
`social_private_content_plans`, including the exact canonical claim request;
the exact claim response and claimed slots are finalized in
`social_private_content_plan_slots`; exact submit replay is owned by
`social_private_command_receipts`. W6 owns this substrate. Before commit,
Social uses an internal Key Exchange claim-validation capability to compare
recovery-slot epochs and uses Actor Identity for endpoint activity/profile
checks. Neither dependency gains Social mutation authority. W5 reads only
committed resource, grant, and recovery-envelope rows after W6 and introduces
no parallel recovery authority.

Conversation keeps its existing event/object/grant transaction.

The shared Go kernel receives the caller's transaction-bound repository and returns
validated state transitions. It cannot commit or reconcile eventually.

Key Exchange PreKey claim is a separate exact-once owner operation. Same plan/hash
replays the same claims; abandoned claims remain consumed.

## 8. Atomic Hard-Cut Inventory

| Surface | Required closure |
|---|---|
| Model | add shared proto; remove `AudienceKeyEnvelope`, inline-key descriptor fields, legacy visibility and generated mirrors |
| Social domain/application | encrypted Post/Comment resources, subtype rules, FRIENDS/GROUP snapshot ports, strict `CanRead` |
| Social persistence | split comments/reactions as required; remove private plaintext/envelope JSON; add Social object/grant/plan tables |
| Social integrations | update stats, Dashboard, moderation, delivery, events, notifications, storage inventory and migrations |
| Desktop | remove Social TS/signaling/chunk crypto; add Native adapter/store/worker |
| Mobile | use the same core and typed Native adapter; no copied crypto |
| Conversation | retain Chat proto and import shared Rust/Go kernels through adapters; retain routes, tables, UOW and grants |
| Key Exchange | Content PreKey types, exact claims, independent quotas and replenishment |
| Recovery | recovery-master derivation and paginated recovery-envelope flow |
| OSS | remove Social private public-upload/read path; retain public assets/backend |
| Generated code | regenerate Go/Desktop/Mobile/Rust outputs; zero old symbols |
| Acceptance | Domain, Feature, Gate, fixture, runtime cells, reports and secret scans |
| Documentation/knowledge | update Social, Encryption, Messaging, API ownership references and supersede stale knowledge |

No row is complete while an old and new path both remain live.

## 9. Legacy Data Reset

Existing private development data is reset, never server-encrypted in place.
Execution requires fresh explicit destructive authorization.

Before reset:

- record exact Station/profile scope;
- count private rows/objects;
- count and hash public rows/objects.

After reset:

- legacy private rows and old private-media objects are absent;
- public counts/hashes are unchanged;
- new schemas reject plaintext private writes;
- no old route, reader, writer, or fallback remains.

## 10. Federation Boundary

Public Moment federation is unchanged. Private Social federation remains
unsupported and fails before partial publish. No private ciphertext, envelope, or
recovery material enters ActivityPub.

## 11. Verification Matrix

| Boundary | Required evidence |
|---|---|
| Shared contracts | clean generation and Go/Rust/Desktop/Mobile parity |
| Native core | payload/HPKE/object known-answer and corruption vectors |
| Station kernel | both domain adapters pass the same conformance suite |
| Social UOW | failpoints prove all-or-nothing Post/Comment/object/grant commit |
| Audience | FRIENDS/GROUP/follower/circle/custom revisions and race tests |
| Recovery | never-opened history, pagination, restart, wrong phrase and revoke |
| Metadata | one-time slot unlinkability and requester-scoped response scans |
| Subtypes | each Post type plus comment/reaction/mention negative and receiver proof |
| Chat regression | existing attachment contract and Native gates remain green |
| Hard cut | source/schema/generated/route/fixture zero-reference scans |
