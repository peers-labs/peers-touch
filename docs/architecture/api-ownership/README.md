# Service API Capability Ownership

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-06 | **Updated**: 2026-09-07
> **Owner**: Architecture Team
> **Module**: `apps/station/`, `model/domain/`, `tooling/acceptance/`

---

## 1. Document Scope

Conversation is the sole Chat entry point. It exposes `/conversation/*`; the
resource owners expose `/device/*`, `/device/inbox/*`, `/recovery/*`,
`/key-exchange/*`, and peer-only `/federation/*`. The internal Desktop/Mobile
Device Messaging Engine retains its runtime name and consumes these
resource-owned contracts without defining a Station public namespace.

This document set defines:

- one canonical public API owner for every Station business capability;
- the distinction between business APIs, device delivery APIs, and internal
  Station-to-Station transport;
- the machine-readable ownership registry and fail-closed verification gate;
- the hard-cut rules for duplicate routes, contracts, persistence, and callers.

This document set does not define:

- individual domain business policy;
- client UI or projection behavior;
- transport implementation details that do not change capability ownership.

## 2. Pre-Consolidation Problem Evidence

Before the approved consolidation, the Chat domain exposed equivalent capabilities
through independently registered surfaces backed by separate proto request families,
application services, and persistence tables. Existing checks detected exact route
collisions but did not detect different routes claiming the same semantic capability.

This is a governance defect: architecture prose required one owner and a hard cut,
while no executable contract named the owner, canonical route, retained internal
port, or mandatory deletion set. Exact retired identifiers remain only in the
machine ownership registry and regression fixtures.

## 3. Design Goals

1. Make semantic capability ownership explicit and machine-verifiable.
2. Keep `/conversation/*` as the single client-facing Chat business API.
3. Route support capabilities through their actual Conversation, Device, Recovery,
   Key Exchange, or Federation owner.
4. Keep Social Graph commands under `/api/v1/social/*`.
5. Reuse one domain-neutral durable Federation transport for Conversation and
   Social without making either domain own the other.
6. Require atomic deletion of duplicate routes, contracts, stores, and consumers.

## 4. Document Navigation

| Document | Purpose |
|---|---|
| [design.md](./design.md) | Ownership model, boundaries, allowed calls, and architecture gates |
| [decisions.md](./decisions.md) | Accepted ownership and hard-cut decisions |
| [data-model.md](./data-model.md) | Machine-readable capability registry contract |
| [module-layout.md](./module-layout.md) | Target module and dependency layout |
| [integration.md](./integration.md) | Evidence ledger, root cause, current-to-target mapping, and deletions |
| [station-api-capabilities.yaml](./station-api-capabilities.yaml) | Complete governed-route inventory, target deletion set, DDD layer rules, and fail-closed Gate input |
| [execution-plans/20260906-conversation-authority-hard-cut.md](./execution-plans/20260906-conversation-authority-hard-cut.md) | Dependency-ordered Conversation DDD and full Messaging facade hard cut |
| [execution-plans/20260906-conversation-authority-hard-cut-review-prompt.md](./execution-plans/20260906-conversation-authority-hard-cut-review-prompt.md) | Independent plan review prompt |
| [CA-W5 canonical wire amendment](./proposals/20260907-ca-w5-canonical-wire-contract-amendment.md) | Accepted command identity, authority scope, event truth, and exact-replay contract required to finish CA-W5 |
| [CA-W5 canonical wire review prompt](./proposals/20260907-ca-w5-canonical-wire-contract-review-prompt.md) | Review checklist for AO-D07 |

## 5. Review Status

The Owner accepted AO-D01 through AO-D06, revised MP-D30, and Federated Social
D-07 on 2026-09-06. Conversation is the sole Chat entry point, and the internal
Device Messaging Engine remains a client runtime. The Owner approved the
dependency-ordered execution plan on 2026-09-06. CA-W0 has complete route and
deletion inventory plus registry-driven DDD import enforcement. CA-W1 has
established canonical resource-owned protobuf contracts and generated bindings.
CA-W2 through CA-W4 now have source-complete, test-only implementations for the
Conversation DDD authority, resource-owner services, and shared
Federation/Social reliability semantics. CA-W5 remains the atomic production
registration, store migration, consumer cutover, and old-path deletion boundary;
runtime convergence remains explicitly unproven until CA-W6. The Owner accepted
AO-D07 on 2026-09-07 after CA-W5 exposed incomplete creation, command, event,
and destructive-read wire semantics. Proto-first CA-W5 execution has resumed;
production cutover remains incomplete until the source Gates pass.
