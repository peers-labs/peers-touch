# Secure Content - Integration And Migration

> **Status**: active
> **Version**: v1.9
> **Created**: 2026-09-13 | **Updated**: 2026-09-24
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

Accepted `SC-D20` adds two Key Exchange-owned client support routes:

```text
POST /key-exchange/content-prekeys/publish
POST /key-exchange/content-prekeys/inventory
```

They reuse the generated Secure Content PreKey contract, require actor JWT plus
fresh device-possession proof, and return the shared protobuf `ErrorResponse`.
Publication/inventory do not move pool, claim or replay ownership into Social.
`ClaimContentPreKeys` and `ValidateContentPreKeyClaims` remain internal.

Conversation retains:

```text
/conversation/attachments/*
```

Social owns:

```text
POST /api/v1/social/moments/prepare-private
POST /api/v1/social/moments/submit-private
GET  /api/v1/social/moments/{post_id}
GET  /api/v1/social/moments/{post_id}/comments
POST /api/v1/social/moments/{post_id}/comments/prepare-private
POST /api/v1/social/moments/{post_id}/comments/submit-private
GET  /api/v1/social/moments/{post_id}/audience

POST /api/v1/social/moments/objects/uploads/begin
GET  /api/v1/social/moments/objects/uploads/{upload_id}
PUT  /api/v1/social/moments/objects/uploads/{upload_id}/chunks/{chunk_index}
POST /api/v1/social/moments/objects/uploads/{upload_id}/complete
POST /api/v1/social/moments/objects/uploads/{upload_id}/cancel
GET  /api/v1/social/moments/objects/{object_id}

GET  /api/v1/social/moments/recoverable
```

The API Ownership and `MP-D23` contracts remain valid. Social adds only Social
capabilities; Conversation keeps Chat attachment authority.

Under accepted `SC-D18`, begin/status/complete/cancel use generated
`secure_content` control messages. Chunk PUT uses a raw
`application/octet-stream` body plus `X-Upload-Generation`,
`X-Chunk-Offset`, `X-Ciphertext-Size`, `X-Ciphertext-SHA256`,
`Content-Length` and `Idempotency-Key`. Object GET maps
`expected_descriptor_sha256` to a lowercase-hex query value and returns
`Accept-Ranges`, `Content-Length`, optional `Content-Range`,
`ETag: "sha256:<hex>"`, `X-Descriptor-SHA256`, and
`X-Total-Ciphertext-Size`. The complete descriptor is already delivered in the
authorized Post/Comment response and is not duplicated into an HTTP header.
Only one explicit or open-ended byte range is accepted; full, partial and
unsatisfiable responses are `200`, `206` and `416`. The Social handler enforces
JWT, `X-Device-ID`, plan ownership and current grants before delegating bytes to
`storage.Backend`. Public OSS routes and rows are never involved.

The two private-submit paths above are defined by `SC-D17`. They keep the
generated private request types distinct from the existing public
`CreatePostRequest` and `CreateCommentRequest` handlers. Content negotiation
does not select public versus private business semantics. Once W6 lands, the
legacy create routes reject non-PUBLIC payloads instead of storing plaintext or
dispatching to the private flow.

Accepted `SC-D19` adds no Social key table or public Secure Content service.
Federation authentication archives public verification keys during its
existing atomic rotation and exposes internal resolve/attest capabilities.
Social verifies plans/proofs through that port and adds a fresh bounded
attestation to private point-read verification metadata. Native anchors the
attestation to the current Station profile key before accepting an historical
proof.

## 4. Audience Ports

Social defines narrow owner ports:

```go
type FriendSnapshotReader interface {
    AcceptedFriends(ctx, authorPTID string) (FriendSnapshot, error)
}

type GroupRecipientSnapshotReader interface {
    PrepareSnapshot(
        ctx context.Context,
        conversationID string,
        authorPTID string,
    ) (GroupRecipientSnapshot, error)

    WithSubmitFence(
        ctx context.Context,
        expected GroupRecipientSnapshot,
        commit func(GroupRecipientSnapshot) error,
    ) error
}
```

`FriendSnapshot` is derived only from accepted `social_relationship_projections`
and includes an immutable snapshot hash/version. It does not read
`friend_chat_friendships` or infer friendship from mutual follows.

`GroupRecipientSnapshot` is returned by a narrow Conversation-owned in-process
query capability and binds the canonical string Conversation ID, membership
epoch, authority head hash, and ordered active `(actor PTID, Home Station)`
members. `PrepareSnapshot` uses the Conversation UOW. On submit,
`WithSubmitFence` opens a Conversation-owned read-only transaction, locks the
canonical Conversation row, verifies byte-for-byte equality with the prepared
snapshot, invokes the supplied Social commit callback, and releases the fence
only after that callback returns. The callback receives only the verified
snapshot, never a Conversation repository or transaction. The global lock
direction is Conversation fence then Social UOW; Conversation operations never
acquire Social locks. A different database identity, reverse call, nested
Conversation UOW, or fence-release failure fails closed before success is
reported.

`Audience` carries a typed `circle_id` / `group_conversation_id` oneof. The old
ambiguous `target_id` is retired. FOLLOWERS, CIRCLE, SELF, and CUSTOM snapshots
remain Social-owned and gain explicit revision/hash contracts.

`CUSTOM_DENY` is `FOLLOWERS` minus the canonical deny list in v1.
`CUSTOM_DENY(PUBLIC)` fails before Content PreKey claim because no complete
federated PUBLIC recipient authority exists. GROUP snapshot expansion likewise
fails before claim when any active member's Home Station differs from the
publisher's. Neither failure may silently remove recipients.

FRIENDS, FOLLOWERS, CIRCLE, and CUSTOM pass their complete candidate set through
an Actor Identity locality port before Content PreKey claim; GROUP uses the
Conversation member Home Station projection. The corresponding owner-provided
read adapter returns a locality digest bound into the authorization snapshot.
Actor Home Station is immutable for a canonical PTID in v1, so submit verifies
the stored locality commitment rather than opening an Actor Identity mutation
transaction. These adapters are read-only and never call Social. A remote Actor
therefore fails identically regardless of the audience that selected it.

Actor Identity's fixture provisioner creates and acknowledges a fiveArm-only
Actor. W8 attaches `station-four` and `station-five-arm` and binds the
provisioner-issued opaque `remote-private-recipient` handle into its runtime
manifest. The scenario resolves the PTID only through the fixture action
channel and proves the unsupported boundary, zero Content PreKey claims, and
absence of partial Social persistence.

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

Under accepted `SC-D20`, source-only W7A lands the Key Exchange routes,
canonical protobuf/error projection, publication receipt and API registry
before W7. W7 then adds the Desktop Native publisher/store/supervisor and proves
persist-before-publish, unknown-outcome replay, root-key-before-key-deletion,
account/Station switching, revocation and teardown through the product Journey.

### 6.1 Proposed W7 Evidence Integration

Under accepted `SC-D21`, W7 evidence integrates through existing owners:

| Boundary | Production owner | Evidence integration |
|---|---|---|
| durable publication state | Desktop Native encrypted store | acceptance-only callback after the production transaction commits |
| request dispatch | Desktop Native production transport | acceptance-only callback after dispatch acceptance and before response projection |
| trusted response | Desktop Native response validator/store | acceptance-only callback after validation and before the production state transaction |
| Browser network interval | Browser network observer | monotonic event sequence plus same-loop terminal marker |
| process restart | W7 runtime owner + machine control plane | typed request, lease-held restart, immutable child manifest |
| account/device/recovery state | Actor Identity, session, Recovery, and Key Exchange provisioners | immutable fixture handles and typed owner actions |
| Station binding | environment/runtime provisioner | approved binding handles in the fixture/runtime manifests |

The Development scenario is attach-only. It may invoke production intents,
await/release observation barriers, persist a bounded resume artifact, request
a runtime-owner action, and consume provisioned fixture actions. It may not:

- call store internals to manufacture a lifecycle state;
- bypass the production transport or inject a synthetic response;
- launch, stop, restart, deploy, reset, or release a product runtime;
- edit runtime manifests after publication;
- create actor, device, Station, revocation, or recovery rows;
- use elapsed time, socket closure, or stream silence as completion evidence.

The runtime manifest binds the fixture-manifest digest and the acceptance
observer endpoint. A post-restart manifest additionally binds its parent,
restart request, changed boot identity, retained-storage identity, and owner
acknowledgement. Any absent or mismatched binding blocks the affected journey
without weakening it to source-only evidence.

### 6.2 Accepted W7-W12 Runtime Integration

Under accepted `SC-D22`, as amended by accepted `SC-D28`, the runtime owner
publishes one `secure-content-development-runtime-v3` manifest using the
canonical Acceptance service/client binding semantics:

| Runtime surface | Owner | Development integration |
|---|---|---|
| `station-four` | Local Dev Control Plane + Station deploy owner | primary `four` service attestation; all single-Station Social Journeys bind here |
| `station-five-arm` | Local Dev Control Plane + Station deploy owner | secondary `fiveArm` service attestation for multi-profile Chat/reset Journeys |
| Desktop Native | Desktop runtime owner | isolated Tauri/WebDriver clients with production Moments/Chat Harness actions |
| Browser | Browser runtime owner | isolated browser sessions with production public Social path and SC-D21 network observer |
| iOS Simulator | Mobile runtime owner | embedded Tauri Mobile build, isolated Appium session/storage, production Mobile Rust + mobile-web actions |
| Android Emulator | Mobile runtime owner | embedded Tauri Mobile build, isolated Appium session/storage, production Mobile Rust + mobile-web actions |
| Business scenarios | Secure Content Development runner | validate/attach/invoke/assert only; no provisioning or topology inference |

The canonical workspace binding remains `four`/slot `5`. Temporary selection of
`fiveArm` for its deploy is a runtime-owner control-plane action and is restored
before manifest publication. The manifest service map, not selection history,
is the topology truth.

Under accepted `SC-D24`, every Station service binding used by a private Social
Journey also carries a `canonical_private_schema_attestation_ref`. The runtime
owner resolves and validates that immutable attestation before client launch.
Accepted `SC-D28` additionally requires `endpoint` to bind the live
connection/service-attestation/Harness identity and
`schema_attestation_endpoint` to reconstruct the canonical activation
service-attestation digest. Neither endpoint is inferred or accepted as a
fallback for the other.
The business scenario cannot create, refresh, or bypass it.

The attestation is produced only by the shared SC-D23 reset owner after one
complete `SCHEMA_ACTIVATION` or `FINAL_CUT` journal. The Local Dev Control Plane
owns declaration and lease validation; a non-public Station maintenance
entrypoint composes Social database reset and OSS object deletion. No product
route, Harness action, or Development scenario receives schema mutation
authority.

The maintenance entrypoint is an OS-authenticated CLI invoked through the
reviewed deploy transport. The local SSH transport is the direct child of the
generic `machine-dev` reset-lease wrapper. Its typed invocation binds the
declaration, plan/task, source, profile, deploy environment, scope, reset
intent, manifest, and expiry. The remote CLI acquires a database advisory lock
keyed by deploy environment and scope, while the journal records accepted
invocation IDs and digests. Exact replay returns current journal state; resume
uses the same reset manifest with a fresh invocation ID. No HTTP/RPC
maintenance surface or reusable bearer token exists.

When a source defect invalidates a reset that has not crossed
`PREPARED`, the next source-bound activation admission uses the same Station
transaction and advisory lock to retain the old manifest, terminalize its
journal as `SUPERSEDED`, and create the fresh manifest and `PREPARED` journal.
No separate cleanup transport or direct control-table mutation exists.

When a source defect is discovered at an unfailed `OBJECTS_DELETED` deployment
handoff or after `STATION_DEPLOYED` reports
`RESET_SCHEMA_TARGET_UNREVIEWED`, accepted `SC-D26` requires the corrected
source's fresh manifest to carry an immutable predecessor record. The record
binds the old reset/manifest identity and pre-transition journal digest. Fresh
invocation admission revalidates the closed state/failure combination, equal
workspace/profile/environment/scope/intent/database/public identities, and
different source/reset identities. Under the same advisory lock, one Station
transaction appends `<predecessor> -> RECOVERY_REPLACED` and creates the fresh
`PREPARED` journal.

Accepted `SC-D27` extends only the source-defect states proven by the reset
owner:

- `OBJECTS_DELETED + RESET_PARTIAL_FAILURE`, where the durable state proves
  database commit and owner-mediated object deletion completed before the
  deployment handoff failed; and
- `STATION_DEPLOYED + RESET_JOURNAL_STATE_CONFLICT`, only when the failed
  manifest is already a recovery successor and its complete predecessor chain
  validates under the admission transaction.

The immutable successor link is the admission authorization and compare-and-
swap token. A separate append-only Station replacement receipt is the
execution proof. The receipt preserves the original predecessor failure,
records the replacement reason, and commits with predecessor terminalization,
fresh `PREPARED` state, and first invocation. Terminal validation requires the
receipt rather than attempting to reconstruct a pre-transition digest from the
changed terminal row.

The predecessor directory remains immutable and receives no completed journal,
attestation, or result. The replacement reset has a fresh source-generation
directory and executes the complete reset contract. Before completion, its
post-audit walks the bounded, cycle-free predecessor chain, loads every target
ledger from Station, and verifies each target through the original Social or
OSS owner. Generic post-commit supersession, direct journal repair, and
evidence relabelling remain forbidden.

Workstream evidence is partitioned as follows:

| Workstream | Scenario/variant identity | Logical Development result root |
|---|---|---|
| W12A source freeze | `source-freeze/<generation>` | `development/secure-content/W12A/source/<generation>/result.json` |
| W12A activation | `schema-activation/{four,fiveArm}` | `development/secure-content/W12A/activation/<generation>/<profile>/<reset-id>/` |
| W12A aggregate | `schema-activation-aggregate` | `development/secure-content/W12A/activation/<generation>/aggregate/result.json` |
| W7 | `desktop-pilot`; `browser-private-boundary`; aggregate | `development/secure-content/W7/<generation>/<variant>/<run-id>/result.json` |
| W8 | `social-expansion/{audience,comment,object,subtype,delete-block,bounds}`; aggregate | `development/secure-content/W8/<generation>/<variant>/<run-id>/result.json` |
| W9 | `mobile-required-matrix/{ios,android,cross-platform}`; aggregate | `development/secure-content/W9/<generation>/<variant>/<run-id>/result.json` |
| W2 | `chat-attachment/{desktop,ios,android}`; aggregate | `development/secure-content/W2/<generation>/<variant>/<run-id>/result.json` |
| W10 | `chat-revalidation/{desktop,ios,android}`; aggregate | `development/secure-content/W10/<generation>/<variant>/<run-id>/result.json` |
| W11 | `hard-cut-regression/<required-runtime-variant>`; aggregate | `development/secure-content/W11/<generation>/<variant>/<run-id>/result.json` |
| W12 final cut | `final-cut/{four,fiveArm}` | `development/secure-content/W12/final-cut/<generation>/<profile>/<reset-id>/` |
| W12 product children | `final-{desktop,browser,ios,android,chat-desktop,chat-ios,chat-android}` | `development/secure-content/W12/product/<generation>/<variant>/<run-id>/result.json` |
| W12 aggregate | `final-cut-product-aggregate` | `development/secure-content/W12/aggregate/<generation>/result.json` |

These are logical paths beneath the machine Development artifact root, never
repository source paths. Aggregate results contain immutable child references;
they are not rewritten as each child finishes.

Each W12A or W12 profile/reset directory contains:

```text
reset-manifest.json
invocations/<invocation-id>.json
completed-reset-journal.json
canonical-private-schema-attestation.json
result.json
```

The source-freeze result binds the exact source commit consumed by both profile
activations. The W12A aggregate accepts only two `COMPLETE` child results for
that source and distinct profiles/scopes. The W12 aggregate accepts fresh
`FINAL_CUT` results plus every named product child. Neither aggregate rewrites
child evidence or accepts an activation child as final-cut evidence.

Artifact ownership and sealing are exact:

| Artifact | Live owner | Immutable writer and seal condition |
|---|---|---|
| source-freeze result | Development source-freeze owner | writes once after all focused source checks pass on a clean checkpoint |
| reset manifest | Development reset owner | writes once at `PREPARED`; retries reuse the same digest |
| live reset journal | Station maintenance CLI in the Station database | advances monotonically under the remote advisory lock; it is not an immutable Evidence Store artifact |
| invocation result | Station maintenance CLI | writes once per fresh invocation ID after its attempt reaches a durable outcome |
| completed journal snapshot | Development reset owner | exports once only after the Station journal reaches `COMPLETE` |
| schema attestation | Development reset owner | writes once after completed-journal, schema, service-attestation, and public-snapshot verification |
| profile child result | Development reset owner | writes once after the matching attestation is sealed |
| product child result | owning runtime adapter | writes once under a fresh run ID after cleanup and final mutable-log export |
| aggregate result | Secure Content result aggregate owner | writes once after verifying the exact required child set and digests |

A failed reset retry remains in the same reset directory and adds only a fresh
invocation artifact. A fresh reset uses a fresh reset ID. A repeated product
attempt uses a fresh run ID. Aggregate generation IDs are immutable and cannot
be reused after a failed or incomplete child set.

A source-invalidated `PREPARED` reset remains in its existing directory and in
Station journal history after `SUPERSEDED`. It has no completed-journal,
attestation, or child result and cannot be consumed by an aggregate.

A source-invalidated `STATION_DEPLOYED` reset remains in its existing directory
and Station journal history after `RECOVERY_REPLACED`. Its original manifest,
invocations, transition history, and failure remain evidence of a non-successful
attempt. Only the successor manifest contains the immutable predecessor link;
only the successor's complete child result may be consumed by an aggregate.

For W7-W11, each task aggregate is stored at
`development/secure-content/<task>/<generation>/aggregate/result.json`.
Its owner is the Secure Content result aggregate component, which accepts only
the task's exact required child identities for one generation. Source
invalidation creates a new generation and leaves all prior run and aggregate
artifacts immutable.

W8 and W9 extend the same product semantics, not the same implementation:

- Desktop and Mobile Native both call the Social proto routes and
  `packages/secure-content-core`;
- Desktop and Mobile each own their encrypted local store, supervisor, typed
  Native adapter, and UI projection;
- Mobile web never receives root keys or performs payload/object crypto;
- Mobile Rust owns persist-before-send, unknown-outcome reconciliation,
  recovery-key handling, transfer checkpoints, and zeroization;
- fixed external debug/telemetry endpoints are removed from Mobile production
  and acceptance-enabled source before W9 checks.

Chat revalidation remains `MP-G13`/`MP-J11`. Its scenarios reuse the runtime
manifest and platform owners but do not enter Social routes, tables, grants, or
acceptance IDs.

## 7. Transaction Integration

Social's UOW commits Post/Comment fact, snapshot, slot mappings, envelopes,
delivery intents, object attachments, grants, and command receipt in one transaction.

Under `SC-D17`, prepare state is durable before Key Exchange claim in
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

Accepted `SC-D23` makes this a full private Social Development-state reset on
only profile `four`/scope `station-four-social-private` and profile
`fiveArm`/scope `station-five-arm-social-private`. It is not a selective
plaintext migration.

Before reset:

- record exact Station/profile scope;
- freeze the exact database/object allowlist and immutable reset-manifest
  digest;
- count all canonical and legacy private rows/objects;
- canonically hash public Post, public Comment/Reaction, and public Social OSS
  rows plus object bytes;
- reject unknown legacy attachment shapes and any public, Conversation, or
  cross-owner object reference.

After reset:

- all private Social Development rows and object references are absent;
- `social_private_posts` has only the canonical encrypted schema;
- `social_private_audience_grants` and the exact retired private Post columns
  are absent;
- public counts/hashes are unchanged;
- new schemas reject plaintext private writes;
- no old route, reader, writer, or fallback remains.

The reset controller calls Social and OSS owner adapters; it does not mutate
backend files, S3 objects, or OSS tables directly. A durable monotonic journal
makes database/object non-atomicity resumable. Station remains quiesced after a
partial failure and is deployed only after all allowlisted deletion and schema
checks pass.

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
