# Cross-Station Private Social - Design Decisions

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-10-03 | **Updated**: 2026-10-03
> **Owner**: Social / Federation

---

## Decision Index

| ID | Decision | Status |
|---|---|---|
| `CSS-D01` | Receiver Home Station owns Friend Request decisions | accepted |
| `CSS-D02` | Author Home Station remains private resource authority | accepted |
| `CSS-D03` | One durable viewer-scoped frame per remote actor | accepted |
| `CSS-D04` | Recipient Key Exchange owns remote Content PreKey claims | accepted |
| `CSS-D05` | Large object ciphertext remains at source Social | accepted |
| `CSS-D06` | Remote interactions return to source Social authority | accepted |
| `CSS-D07` | Revocation combines local suppression with monotonic source invalidation | accepted |
| `CSS-D08` | Current readiness is Native Desktop only | accepted |
| `CSS-D09` | Federated GROUP extends the SC-D29 snapshot without replacing its authority | accepted |
| `CSS-D10` | Remote Content PreKey submit validation uses a distinct read-only peer contract | accepted |

## CSS-D01: Receiver Home Station Owns Friend Request Decisions

**Status**: accepted
**Date**: 2026-09-06

### Context

A cross-Station private audience depends on a converged relationship. Chat
transport and clients cannot decide Social relationship truth.

### Decision

Public Friend Request APIs remain under `/api/v1/social/*`. The receiver Home
Station owns pending, accepted, and rejected state. Commands and results reuse
the shared Federation transport, and both Home Stations project committed
relationship state.

### Rationale

The receiver is the decision authority while Social remains the business owner.
This preserves the accepted API Ownership boundary in `AO-D05`.

### Alternatives Considered

- Put Friend Request in Chat delivery: rejected because Chat is not Social
  Graph authority.
- Let clients call the receiver Station: rejected because it bypasses Home
  Station policy, audit, and durable retry.
- Add a Social network stack: rejected because it duplicates Federation.

### Consequences

Cross-Station private Social may use only a relationship that has converged on
both Home Stations. Friend Request implementation is a prerequisite and
regression, not a new workstream in this plan.

## CSS-D02: Author Home Station Remains Private Resource Authority

**Status**: accepted
**Date**: 2026-10-03

### Context

The recipient Home Station needs offline feed and recovery, but making both
Stations authoritative would create conflicting writes and revocation order.

### Decision

The author's Home Station owns canonical Post, Comment, Reaction, audience, and
lifecycle truth. A recipient Home Station stores only an actor-scoped,
rebuildable ciphertext projection and tombstone.

### Rationale

One authority preserves Social UOW, parent authorization, and lifecycle
ordering while still supporting local recipient reads.

### Alternatives Considered

- Multi-master Social writes: rejected because conflict and deletion semantics
  are undefined.
- Desktop direct remote access: rejected because it bypasses Home Station
  policy and recovery.

### Consequences

All remote mutations return to source Social. Loss of a recipient projection is
repaired from durable delivery or source-authorized reconcile.

## CSS-D03: One Durable Viewer-Scoped Frame Per Remote Actor

**Status**: accepted
**Date**: 2026-10-03

### Context

A Station-scoped batch would reveal co-recipient identities and envelopes to
the receiving Station and ordinary response paths.

### Decision

Source Social writes one durable Federation frame per target actor. The frame
contains only that actor's ciphertext projection, endpoint/recovery envelopes,
object descriptors, lifecycle revision, and verification proof.

### Rationale

The model enforces metadata minimization and reuses existing Federation
authentication, retry, deduplication, ordering, and backpressure.

### Alternatives Considered

- One frame per Station: rejected because it exposes co-recipients.
- Ephemeral signal delivery: rejected because private Social requires offline
  recovery.
- Federation Ledger: rejected because private business data is not governance.

### Consequences

Inbox receipt and Social projection commit together. Frame size remains bounded
and excludes large object bytes.

## CSS-D04: Recipient Key Exchange Owns Remote Content PreKey Claims

**Status**: accepted
**Date**: 2026-10-03

### Context

One-time endpoint and recovery keys must remain under the recipient Home
Station's Key Exchange authority.

### Decision

Canonical Content PreKey types remain in
`model/domain/secure_content/prekey.proto`. Key Exchange-owned peer wrappers in
`model/domain/key_exchange/key_exchange.proto` carry typed claim requests
through authenticated Federation peer routing. Exact replay binds source
Station, target Station, plan ID, and request hash.

### Rationale

The source cannot copy or shadow a remote one-time-key pool. Exact replay makes
crash recovery deterministic without changing audience.

### Alternatives Considered

- Replicate remote key pools: rejected as a second authority.
- Silently omit recipients without keys: rejected because it changes user
  intent.
- Put Content PreKey types in the direct-message key contract: rejected because
  Secure Content already owns the canonical key shape.

### Consequences

Partially consumed keys may be abandoned, but no Social resource may partially
commit. The source persists its exact claim request before the peer call.

## CSS-D05: Large Object Ciphertext Remains At Source Social

**Status**: accepted
**Date**: 2026-10-03

### Context

Durable Federation frames are bounded and should not carry image or video
bytes.

### Decision

Frames carry encrypted object descriptors only. Recipient Social uses an
authenticated, target-bound Federation peer stream to fetch ciphertext ranges
from the source Social object authority.

### Rationale

Source Social remains the grant authority, queue fairness is preserved, and
clients still verify and decrypt locally.

### Alternatives Considered

- Inline objects in frames: rejected because it violates payload bounds.
- Public object URL: rejected because it breaks the private boundary.
- Client direct remote fetch: rejected because it bypasses the Home Station.

### Consequences

The peer capability binds resource, actor/device, object, range, expiry, and
Federation context.

## CSS-D06: Remote Interactions Return To Source Social Authority

**Status**: accepted
**Date**: 2026-10-03

### Context

Comment and Reaction validity depends on the source Post's current audience,
block state, rate limit, and lifecycle.

### Decision

Recipient Social durably routes typed Comment prepare/submit and
Reaction/unreaction commands to source Social. Source Social revalidates the
parent and returns exact-replay typed results and recipient projection updates.

### Rationale

Parent resource and interaction truth remain in one transaction authority.

### Alternatives Considered

- Receiver-local canonical interactions: rejected as multi-master Social.
- Optimistic local write without source result: rejected because it can survive
  revoked authorization.

### Consequences

Unknown outcomes remain pending under the same command ID. Comment drafts stay
on the Native client.

## CSS-D07: Revocation Combines Local Suppression With Monotonic Source Invalidation

**Status**: accepted
**Date**: 2026-10-03

### Context

Recipient-local block should hide content immediately, while delete and
audience truth remain source-owned.

### Decision

Recipient Social may suppress from local block truth immediately. Source Social
emits viewer-scoped invalidations with monotonic lifecycle revisions. Receiver
tombstones reject every stale or equal delivery revision.

### Rationale

Users get prompt local safety without creating a second canonical lifecycle.

### Alternatives Considered

- Source-only UI delay: rejected because local block would remain visible.
- Local deletion as authority: rejected because reconnect could resurrect or
  conflict with source truth.

### Consequences

Feed, detail, Comment, media, and recovery share the tombstone. The product
never promises deletion of plaintext already exported by a recipient.

## CSS-D08: Current Readiness Is Native Desktop Only

**Status**: accepted
**Date**: 2026-10-03

### Context

Same-Station Native Desktop has product evidence. Mobile does not have the
cross-Station product adapter or required runtime proof. Browser is not a
supported Social product platform.

### Decision

This milestone proves two real Stations and two Tauri Native Desktop clients.
The embedded React surface is part of the Native product. Browser-gateway
Social registration is removed. Mobile remains deferred and unproven.

### Rationale

Runtime readiness cannot be inferred from shared proto or generated bindings.

### Alternatives Considered

- Include Mobile: rejected because it requires a separate product/runtime plan.
- Keep Browser Social as a warning-only surface: rejected because the product
  contract prohibits the surface itself.

### Consequences

Shared proto generation may update tracked Mobile generated output only.
Mobile feature, runtime, UI, and acceptance files remain outside execution
scope.

## CSS-D09: Federated GROUP Extends The SC-D29 Snapshot Without Replacing Its Authority

**Status**: accepted
**Date**: 2026-10-03

### Context

`SC-D29` established the typed canonical Conversation ID, Conversation-owned
`PrepareSnapshot` / `WithSubmitFence` capability, complete member and Home
Station snapshot, and fail-closed recipient rules. It also retained a temporary
same-Station restriction because remote Content PreKey claim and receiver-side
product evidence did not yet exist.

The accepted Social product contract now requires `GROUP` members in the same
active Federation to participate in cross-Station private publish. The
cross-Station architecture supplies the missing authenticated remote PreKey,
viewer-scoped delivery, receiver projection, and two-Station proof boundaries.

### Decision

`SC-D29` remains authoritative for the typed Audience target, Conversation
membership ownership, lock ordering, and byte-for-byte submit fence. The
Conversation snapshot is extended with its canonical Federation ID and
continues to include every active member's canonical PTID and Home Station.

Source Social must:

- obtain the complete snapshot from the co-located Conversation capability;
- verify at prepare and submit that its Federation ID is the selected active
  Federation and every member Home Station is an active member;
- exclude only the author and actors excluded by accepted Social policy;
- bind the Federation ID, Conversation ID, membership epoch, authority head,
  ordered members, and Home Stations into the immutable audience snapshot;
- claim local and remote Content PreKeys through their existing owners; and
- commit no Post, object, grant, delivery intent, or Federation frame unless
  every required recipient remains valid under the submit fence.

This decision supersedes only the `SC-D29` locality rejection for a remote
recipient in the same active Federation. It does not supersede typed targets,
the Conversation read fence, exact recipient coverage,
`CUSTOM_DENY(PUBLIC)` rejection, cross-Federation rejection, or atomic
no-partial-publish behavior.

Social does not query a remote Conversation service and does not copy
Conversation membership into a second authority. Federation transports the
resulting viewer-scoped Social frames but does not decide Group membership.

### Rationale

The existing Conversation snapshot already provides the revision-bound,
enumerable recipient authority that `SC-D29` required before lifting the
locality restriction. Adding Federation identity to that snapshot makes the
cross-Station admission decision explicit without changing ownership or
creating a distributed Social membership service.

### Alternatives Considered

- Keep federated `GROUP` unsupported: rejected because it contradicts the
  accepted `SOC-SEC-C01`, `SOC-SEC-C09`, `SOC-SEC-J10`, and `SOC-SEC-AS18`
  product contract.
- Let Social query each remote Station for Group members: rejected because it
  creates a second membership authority and cannot preserve one submit fence.
- Filter out remote Group members: rejected because it silently narrows user
  intent and violates exact recipient coverage.
- Copy Group membership into Social: rejected because Conversation is the
  canonical membership and authority-head owner.

### Consequences

- `GroupRecipientSnapshot` gains one canonical Federation ID across
  Conversation and Social value projections.
- Existing same-Station Group behavior remains a strict subset of the new
  path.
- Any stale snapshot, inactive Federation, invalid Home Station, missing
  PreKey, cross-Federation member, or changed membership rejects the whole
  publish before Social commit.
- The old remote-recipient `PRIVATE_UNSUPPORTED` guard is deleted only in the
  vertical slice that proves mixed local/remote audience delivery.
- Exact-source two-Station evidence for `SOC-SEC-AS18` is required before the
  federated Group capability is claimed ready.

### Review And Reversal Conditions

Review this decision if Conversation no longer has a co-located authoritative
snapshot, Actor Home Station becomes mutable, or Federation membership cannot
be revalidated at submit. Any replacement must preserve one membership owner,
one immutable recipient snapshot, and atomic no-partial-publish.

## CSS-D10: Remote Content PreKey Submit Validation Uses A Distinct Read-Only Peer Contract

**Status**: accepted
**Date**: 2026-10-04

### Context

`SC-D17` requires Social to revalidate every claimed endpoint profile and
actor-recovery epoch before submit. Local claims already use Key Exchange's
transaction-bound `ValidateContentPreKeyClaims` capability. CSS-02D partitions
remote claims through the accepted `CSS-D04` peer claim route, but its submit
path currently validates only the local partition.

The existing remote claim route cannot satisfy this requirement. Exact replay
proves the persisted claim identity and bytes; it does not prove that the
recipient's endpoint profile or recovery epoch is still current. Changing exact
claim replay to reject stale material would also change the accepted
`CSS-D04` crash-recovery contract.

### Decision

Key Exchange adds a distinct authenticated, read-only Federation peer contract
for submit-time validation. Its canonical request binds:

- source and target Home Station peer IDs plus the active Federation ID;
- the original canonical `ClaimContentPreKeysRequest`;
- the exact persisted `ClaimContentPreKeysResponse`;
- deterministic request and response SHA-256 digests; and
- the source Social plan ID and plan-request digest already carried by the
  claim contract.

The validation-only Federation scope binds `federation_id`,
`authority_plan_id`, `plan_request_sha256`, `canonical_request_sha256`,
`canonical_response_sha256`, `source_station_peer_id`, and
`target_station_peer_id`. The authenticated issuer and audience must equal the
source and target Station fields, and the subject must equal the issuer.

The recipient Key Exchange maps the source plan ID to the same namespaced local
claim-receipt identity used by remote claim, loads that exact receipt, locks and
checks the current endpoint profile and recovery epochs in a local read-only
validation transaction, and returns only a digest-bound validation result. It
does not allocate, release, rotate, or reissue keys.

Source Social validates every remote Station partition before entering its
local Social commit callback. A missing, stale, malformed, unauthenticated, or
unavailable validation rejects the submit with no Social resource rows. The
existing local partition remains validated inside the Social transaction.

Each target Key Exchange validation transaction has its own per-partition
linearization point. Its response carries evidence that this transaction
completed successfully; it is not itself a global linearization point. Multiple
target Stations do not form one global snapshot. Revocation or epoch advancement
completed after a partition's validation transaction is a post-validation
lifecycle change and follows the accepted receiver rejection, tombstone, and
source invalidation path. This contract does not claim a distributed lock,
global snapshot, or atomic transaction across two Stations.

Failure disposition is stable:

| Key Exchange result | Social disposition |
|---|---|
| stale endpoint profile or recovery epoch | terminal `REJECTED_STALE` |
| authenticated peer reports inactive Federation or unauthorized Station pair | terminal `REJECTED_STALE` |
| missing exact claim receipt | terminal `REJECTED_STALE` |
| invalid peer token/scope/claim binding, malformed request/response, digest mismatch, or receipt/response mismatch | terminal `REJECTED_STALE`, surfaced as an integrity failure |
| timeout, transport failure, unavailable peer, membership-store failure, or internal dependency failure | retryable dependency failure; preserve `PREPARED` |

`REJECTED_STALE` remains the only terminal pre-submit plan transition; this
proposal adds no second terminal integrity state. The surfaced typed error still
distinguishes stale authority from protocol-integrity rejection so operators do
not misdiagnose malformed peer traffic as ordinary lifecycle drift.

### Rationale

A separate route preserves exact claim replay, keeps current-key truth at the
recipient Key Exchange, and makes the weaker distributed consistency boundary
explicit. It also avoids holding the source Social transaction open across a
network call.

### Alternatives Considered

- Reuse exact claim replay as validation: rejected because replay identity is
  not current endpoint/recovery proof and stale rejection would break
  deterministic crash recovery.
- Validate only the signed claimed key bytes at source: rejected because the
  source does not own current remote endpoint or recovery epochs.
- Add a distributed validation lease or two-phase commit: rejected for this
  milestone because it mutates remote lifecycle state, adds timeout recovery,
  and contradicts the accepted read-only `SC-D17` capability.
- Skip remote validation and rely only on receiver rejection: rejected because
  it knowingly permits source commit after a stale condition observed before
  submit.

### Consequences

- `model/domain/key_exchange/key_exchange.proto`, Federation peer route/scope,
  Key Exchange handlers, and Social's partitioned validation port require a
  proto-first CSS-02D amendment.
- Validation errors remain typed and privacy-safe; responses expose no key
  material or co-recipient identity.
- Remote partitions are validated in deterministic Station order and fail
  closed before local commit.
- The design guarantees point-in-time remote validation, not cross-Station
  serializability. Exact-source tests must cover deterministic Station order,
  stale endpoint, advanced recovery epoch, inactive membership, malformed
  input, missing receipt, replay preservation, unavailable peer, mixed
  partitions, terminal-versus-retryable disposition, and zero Social rows on
  every pre-commit failure.

### Review And Reversal Conditions

Independent architecture review passed on 2026-10-04 after the design made
per-partition linearization, exact terminal/retryable failure mapping,
validation-scope claims, and complete consumer checks explicit. Revisit this
decision if product semantics require revocation and source commit to be
globally serializable; that stronger guarantee requires a separate mutating
reservation/finalization protocol rather than this read-only contract.
