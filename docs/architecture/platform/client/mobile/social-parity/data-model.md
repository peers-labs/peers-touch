# Mobile Social Desktop Parity - Data Model

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-06 | **Updated**: 2026-10-06
> **Owner**: Mobile / Social / Client Architecture
> **Module**: `model/domain/social/`, `apps/mobile/`

---

## 1. Canonical Contract Roots

No new business model is introduced. Mobile consumes:

| Concern | Canonical root |
|---|---|
| Post, Audience, Reaction, feed explanation | `model/domain/social/post.proto` |
| Comment and reply | `model/domain/social/comment.proto`, `private_content.proto` |
| Circle and member | `model/domain/social/circle.proto` |
| Relationship and block | `model/domain/social/relationship.proto` |
| Private payload/object/envelope | `model/domain/secure_content/` |
| Group Audience identity | canonical Conversation ID and member authority |
| Federation delivery | shared Federation delivery contracts |
| Mobile command/draft durability | existing Mobile reliability and draft Proto |

TypeScript projection types are read models over generated messages. They must not redefine enum values,
identity, authorization or persistence semantics.

## 2. Scope Identity

```ts
interface MobileSocialScope {
  stationPeerId: string;
  actorPtid: string;
  deviceId: string;
  lifecycleGeneration: string;
  federationContextIds: readonly string[];
}
```

Every projection, draft, command, object URL and callback is owned by exactly one scope. URL is a
connection hint and is not identity.

## 3. Experience Projection

```ts
interface SocialFeedProjection {
  scope: 'home' | 'explore' | 'profile';
  items: readonly SocialMomentProjection[];
  cursor?: string;
  hasMore: boolean;
  state: FeedVisibleState;
  revision: string;
}

interface SocialMomentProjection {
  post: Post;
  source: SocialSourceProjection;
  audience: AudienceSummaryProjection;
  reason?: FeedObjectExplanation;
  privacy: 'PUBLIC' | 'PRIVATE';
  content: SocialContentProjection;
  comments: SocialCommentSummaryProjection;
  reactions: readonly ReactionSummary[];
  delivery?: RemoteDeliveryProjection;
  recovery?: PrivateRecoveryProjection;
}
```

`content` is either public canonical content or a verified plaintext projection issued by Mobile Rust.
It never contains a root key, content key or other recipient envelope.

### 3.1 Content projection

```ts
type SocialContentProjection =
  | { kind: 'TEXT'; text: string }
  | { kind: 'IMAGE'; text: string; media: readonly OpaqueMediaProjection[] }
  | { kind: 'VIDEO'; text: string; media: readonly OpaqueMediaProjection[] }
  | { kind: 'LINK'; text: string; title: string; url: string }
  | { kind: 'POLL'; text: string; question: string; options: readonly string[] }
  | { kind: 'REPOST'; comment: string; sourcePostId: string; source: RepostSummaryProjection }
  | { kind: 'LOCATION'; text: string; name: string; address?: string };
```

All seven canonical kinds are required read/render outcomes for public and private resources. Authoring
controls are enabled independently from rendering and only when the current canonical capability snapshot
advertises the create operation. Unknown kinds produce an explicit unsupported state; they never coerce to
`TEXT`.

## 4. Composer Intent

```ts
interface MomentIntentBase {
  draftId: string;
  revision: string;
  audience: Audience;
  mentions: readonly Mention[];
}

type CanonicalMomentIntent =
  | (MomentIntentBase & { kind: 'TEXT'; text: string })
  | (MomentIntentBase & { kind: 'IMAGE'; text: string; media: readonly OpaqueMediaHandle[] })
  | (MomentIntentBase & { kind: 'VIDEO'; text: string; media: readonly OpaqueMediaHandle[] })
  | (MomentIntentBase & { kind: 'LINK'; text: string; link: CanonicalLinkDraft })
  | (MomentIntentBase & { kind: 'POLL'; text: string; poll: CanonicalPollDraft })
  | (MomentIntentBase & { kind: 'REPOST'; comment: string; sourcePostId: string })
  | (MomentIntentBase & {
      kind: 'LOCATION';
      text: string;
      location: CanonicalLocationDraft;
      media: readonly OpaqueMediaHandle[];
    });
```

- Every branch adapts the matching generated `PostType` payload; these are not parallel business types.
- `Audience` is generated Proto.
- `GROUP` target is a complete canonical Conversation ID.
- `CUSTOM_DENY` base is `FOLLOWERS` only.
- private actor/slot limits are validated before encryption.
- opaque media handles are scope-bound and not reusable by another draft/actor.

## 5. Projection Composition

```text
public timeline resource --------------------+
                                              +-> canonical Post identity -> one item
private Native receiver projection ----------+
interaction/revocation event ----------------+
```

Rules:

1. private projection replaces only content/trust fields for the same canonical Post; it is not a second Post.
2. source Station order/rank wins; Mobile does not rank remote resources.
3. duplicate resource IDs produce one item and one transition.
4. revoke/delete tombstone wins over stale content.
5. unknown Audience or content kind fails closed.

## 6. State Machines

### Publish

```text
DRAFT
 -> AUDIENCE_REQUIRED
 -> CHECKING_PRIVATE_READINESS | READY_PUBLIC
 -> CHECKING_REMOTE_READINESS
 -> READY_PRIVATE
 -> PUBLISHING
 -> PUBLISHED | REMOTE_DELIVERY_PENDING | PUBLISH_UNKNOWN_OUTCOME | PUBLISH_FAILED

REMOTE_DELIVERY_PENDING -> REMOTE_DELIVERY_RETRYING -> PUBLISHED | terminal
PUBLISH_UNKNOWN_OUTCOME -> reconciling -> PUBLISHED | retryable | terminal | unknown
```

### Read

```text
LOADING_AUTHORIZED_RESOURCE
 -> CONTENT_READY
 -> WAITING_FOR_REMOTE_DELIVERY
 -> WAITING_FOR_PRIVATE_KEY
 -> RECOVERY_REQUIRED
 -> DECRYPTING
 -> CONTENT_READY
 -> DELETED_OR_REVOKED
```

Error transitions may enter authentication, not-found, integrity or source-unavailable states but never
partial plaintext.

### Interaction

```text
EDITING/IDLE -> PENDING -> COMMITTED
                         -> UNKNOWN -> RECONCILING -> terminal/retryable/unknown
                         -> FAILED_ROLLBACK
```

## 7. Persistence

| Data | Owner | Persistence |
|---|---|---|
| Social business truth | Station | canonical Social storage |
| remote delivery | Federation/source Social | durable outbox/inbox |
| private ciphertext/key refs | Mobile Rust private engine | encrypted local store |
| may-commit commands | Mobile Rust command ledger | encrypted, bounded, scope-keyed |
| composer/comment drafts | Mobile Rust draft store | encrypted, revisioned, scope-keyed |
| verified plaintext projection | Mobile Rust/Web memory + bounded ordinary cache | generation-scoped, purgeable |
| feed/profile/circle projection | Mobile runtime cache | bounded and scope-keyed |
| scroll/query/focus | navigation presentation memory | bounded, non-authoritative |
| media object URL | Web render lifecycle | memory only, revoked on item/scope teardown |

Private plaintext, tokens and key material are prohibited from `localStorage`, logs, screenshot metadata,
command JSON and push payloads.

## 8. Error Mapping

Typed owner errors map to product states:

| Owner error | Product state |
|---|---|
| auth missing/expired/revoked | `AUTHENTICATION_REQUIRED` |
| private not-found/unauthorized | `NOT_FOUND_OR_NOT_AUTHORIZED` |
| recipient PreKey unavailable | `RECIPIENT_KEY_UNAVAILABLE` |
| Audience actor/slot bound exceeded | `AUDIENCE_TOO_LARGE` |
| unsupported audience/platform/federation | `PRIVATE_UNSUPPORTED` |
| response lost after may-commit | `PUBLISH_UNKNOWN_OUTCOME` / interaction unknown |
| object/grant mismatch | `MEDIA_ACCESS_DENIED` |
| hash/AEAD mismatch | `INTEGRITY_FAILURE` |
| source unavailable with verified cache | `REMOTE_SOURCE_UNAVAILABLE` |
| delete/relationship/device revoke | `DELETED_OR_REVOKED` |

Generic string parsing is forbidden when a canonical error code exists.

## 9. Versioning

- generated Proto evolution follows existing compatibility policy;
- projection schema changes are internal but versioned where persisted;
- a new Audience, content kind or interaction cannot be enabled until Station, Rust, Web state,
  i18n, prototype and Acceptance mappings are complete;
- unknown enum values are unsupported states, not PUBLIC/default.
