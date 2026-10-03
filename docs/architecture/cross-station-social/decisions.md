# Cross-Station Private Social - Design Decisions

> **Status**: active
> **Version**: v1.0
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
