# Service API Capability Ownership — Decisions

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-06 | **Updated**: 2026-09-06
> **Owner**: Architecture Team

---

## Decision Index

| ID | Decision | Status |
|---|---|---|
| AO-D01 | One semantic capability has one client-facing API owner | accepted |
| AO-D02 | Public APIs follow resource owners | accepted |
| AO-D03 | Capability ownership is machine-readable and fail-closed | accepted |
| AO-D04 | Duplicate public routes and truth stores require an atomic hard cut | accepted |
| AO-D05 | Social and Conversation reuse one domain-neutral Federation transport | accepted |
| AO-D06 | Conversation is rebuilt as a Station DDD bounded context | accepted |

---

## AO-D01: One Semantic Capability Has One Client-Facing API Owner

**Status**: accepted
**Date**: 2026-09-06

### Context

The pre-consolidation exact-route collision check permitted two differently named
routes to create the same Conversation business object. Names, packages, and tests
could therefore diverge while every individual handler remained valid.

### Decision

Every Station business capability has one stable capability ID and exactly one
client-facing method/path. Alternate client routes are forbidden. Internal ports and
peer routes are allowed only when their exposure and owner differ explicitly.

### Rationale

Semantic uniqueness is the property the system needs. Exact URL uniqueness is too
weak to prevent parallel business APIs.

### Alternatives Considered

- Permit aliases: rejected because they preserve multiple public contracts and callers.
- Rely on code review: rejected because the current duplicate passed reviews and Gates.

### Consequences

Route additions require a capability registry change. A route rename is a hard cut,
not an aliasing exercise.

---

## AO-D02: Public APIs Follow Resource Owners

**Status**: accepted
**Date**: 2026-09-06

### Context

The word “messaging” was used for both a device delivery engine and Conversation
business authority. That naming overlap allowed a delivery subsystem to acquire a
second public Chat API and second authority store.

### Decision

- Conversation owns Chat business truth and `/conversation/*`.
- Social owns relationship truth and `/api/v1/social/*`.
- Actor Identity owns device enrollment and `/device/*`.
- Conversation Delivery owns the per-device Chat inbox under `/device/inbox/*`.
- Recovery owns opaque archive revision APIs under `/recovery/*`.
- Key Exchange owns prekey, KeyPackage, and DKX APIs under `/key-exchange/*`.
- Federation owns peer transport mechanics and peer-only `/federation/*`.
- The internal Device Messaging Engine remains the client-side crypto, queue,
  recovery, and durable-consumption runtime.
- Internal component names never define Station public API namespaces.

### Rationale

These planes have different state, authorization, retry, and lifecycle semantics.
Naming them separately makes forbidden dependencies enforceable.

### Rejected Patterns

- An implementation-shaped catch-all facade was rejected because every route has a
  precise resource owner and the facade would invite authority drift.
- Putting every support route under `/conversation/*` was rejected because device identity,
  cross-domain recovery, key exchange, and peer transport have different truth owners.
- Letting the Device Messaging Engine own Chat APIs was rejected because it erases the
  established Conversation domain and conflates business authority with endpoint delivery.

### Consequences

The modern authority implementation is retained but moves under Conversation
ownership. Station `subserver/messaging` is decomposed by resource owner and removed.
Desktop/Mobile `messaging-core` remains as an internal runtime.

---

## AO-D03: Capability Ownership Is Machine-Readable And Fail-Closed

**Status**: accepted
**Date**: 2026-09-06

### Context

The repository already contained prose requiring one Conversation framework and a
hard cut. No Gate checked capability identity, route owner, canonical proto family,
or authoritative store family. W11 instead asserted the presence of the duplicate
Messaging routes.

### Decision

Add one reviewed ownership registry and a `station-api-ownership` Gate. The Gate parses
real handler registration with Go AST, compares it with the registry, and fails on an
undeclared route, duplicate capability, owner mismatch, duplicate truth store, or live
superseded symbol.

### Rationale

Architecture that is not connected to build and completion checks cannot stop drift.

### Alternatives Considered

- Prefix deny-lists only: rejected because a new prefix bypasses them.
- Route-name heuristics: rejected because semantic equivalence is not reliably inferred.

### Consequences

The initial registry requires a reviewed baseline. Future route changes are smaller
but cannot merge without an explicit owner and capability classification.

---

## AO-D04: Duplicate Public Routes And Truth Stores Require An Atomic Hard Cut

**Status**: accepted
**Date**: 2026-09-06

### Context

The current Chat split contains routes, proto request families, services, tests, and
tables on both sides. Removing only one URL would leave data and behavior split.

### Decision

The correction is one execution closure:

```text
canonical Conversation implementation ready
  -> every Desktop/Mobile/Acceptance caller switched
  -> canonical runtime Gates pass
  -> duplicate Messaging Conversation routes/types/services/tables deleted
  -> old Conversation implementation pieces replaced by modern authority logic
  -> tree-wide and schema ownership Gates pass
```

No redirect, compatibility handler, dual write, read fallback, or temporary production
feature flag is permitted.

### Rationale

Partial removal would preserve the same ambiguity under another shape.

### Alternatives Considered

- Route redirects: rejected because both contracts remain public.
- Dual write and later migration: rejected because the project is at v1 and duplicate
  authority ordering is unsafe.

### Consequences

The cut has a broad blast radius and requires an approved dependency-ordered plan.
Development data may be reset under the already accepted clean-slate Chat policy; no
new product data migration promise is introduced.

---

## AO-D05: Social And Conversation Reuse One Domain-Neutral Federation Transport

**Status**: accepted
**Date**: 2026-09-06

### Context

Cross-Station Friend Request needs durable delivery, authentication, retry, and dedup.
Using the Chat-specific Messaging service would make Social depend on Chat; building a
Social transport would duplicate infrastructure.

### Decision

Extract the durable outbox/inbox/dispatcher/authentication mechanics into a
domain-neutral Federation transport. Conversation and Social provide typed protobuf
payload adapters and retain all business authorization and mutation.

For Friend Request, receiver Home Station owns the pending decision. Accept/reject is
committed there and returned durably to the sender Home Station. Accepted relationships
are then projected on both Home Stations before Conversation creation is allowed.

### Rationale

This reuses reliability without assigning Social truth to Messaging or Federation.

### Alternatives Considered

- Add Friend Request to the Chat envelope payload: rejected because transport is not a
  Social Graph manager.
- Add a Social-only outbox/inbox: rejected as a second transport stack.
- Let clients call the receiver Station directly: rejected because it bypasses Home
  Station identity, policy, retry, and audit.

### Consequences

Federation transport becomes shared infrastructure with typed domain dispatch. Social
must define idempotent Friend Request command/event contracts before W9-D resumes.

---

## AO-D06: Conversation Is Rebuilt As A Station DDD Bounded Context

**Status**: accepted
**Date**: 2026-09-06

### Context

The current Conversation subserver is a flat package of roughly 14,000 lines. HTTP
registration, application orchestration, GORM persistence, federation forwarding,
membership transition logic, follower projection, and domain policy cross file and
transaction boundaries without a single aggregate owner. Moving Messaging authority
logic into that shape would preserve ambiguity under the canonical route.

### Decision

Conversation becomes a Station DDD bounded context with enforced layers:

- `domain`: aggregate roots, entities, value objects, domain services, domain events,
  repository/UOW ports, and typed domain errors; no HTTP, GORM, or generated transport
  dependencies;
- `application`: command/query use cases, authorization orchestration, idempotency, and
  transaction-scoped ports; no direct GORM or handler logic;
- `infrastructure`: GORM models/repositories, delivery inbox, object store, federation,
  clock, and identity adapters; no business policy;
- `interface/http`: authentication-bound request mapping and typed response/error mapping
  only;
- `composition.go` and `subserver.go`: dependency injection, lifecycle, and route
  registration only.

`Conversation` is the aggregate root for lifecycle, membership, authority head, and
epochs. A command commit persists the aggregate transition, domain events, command
receipt, device-inbox intents, and Federation outbox intents through one application UOW.

### Rationale

The hard cut moves complex authority semantics across packages and stores. A real bounded
context makes invariants and transaction ownership explicit; reorganizing the old flat
files without aggregate and port boundaries would not.

### Alternatives Considered

- Keep the flat Conversation package and only copy modern services: rejected because it
  preserves mixed HTTP/domain/persistence ownership.
- Keep Messaging as the DDD authority behind Conversation handlers: rejected because the
  second owner survives behind an adapter.
- Create a new Conversation package beside the old one and migrate gradually: rejected
  by AO-D04; the production cut must be atomic. Test-only preparation is allowed.

### Consequences

The refactor is broad and must be dependency-planned. All existing Conversation tests are
reclassified into domain, application, infrastructure, interface, and Acceptance gates.
The old flat services, repositories, transition UOWs, follower adapters, and handlers are
deleted after their behavior is covered by the new bounded context.
