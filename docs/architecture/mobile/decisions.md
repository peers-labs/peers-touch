# Mobile Shell — 设计决策

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-27 | **Updated**: 2026-08-27
> **Owner**: Mobile Architecture Team

---

## Decision Index

| ID | Decision | Status |
|---|---|---|
| MS-D01 | One lifecycle kernel owns top-level transitions | accepted |
| MS-D02 | Runtime registry becomes executable | accepted |
| MS-D03 | Mobile keeps active-only primary tab trees | accepted |
| MS-D04 | Detail navigation uses descriptors, not store identity as route | accepted |
| MS-D05 | OAuth is a pre-session auth-runtime flow through native deep links | accepted |
| MS-D06 | PTID is the only Mobile actor identity | accepted |
| MS-D07 | Proto gateway cutover removes parallel domain models | accepted |
| MS-D08 | Unknown writes converge through a durable command ledger | accepted |
| MS-D09 | Teardown is externally atomic through generation fencing | accepted |
| MS-D10 | Station scope is pinned by verified peer ID, not URL | accepted |

## MS-D01: One Lifecycle Kernel

**Status**: accepted
**Date**: 2026-08-27

### Context

`App.tsx` currently coordinates Station restore, access gates, session restore,
logout, and Station change through component state and effects. Ordering,
cancellation, and stale-result rejection are not represented by one state
machine.

### Decision

**Decision**: Replace distributed `App.tsx` transition effects with one explicit
lifecycle kernel and reducer.

### Rationale

**Rationale**: Station switch, revocation, restore, bootstrap, and resume must
cancel and clear state atomically.

### Alternatives Considered

- Keep component-local effects. Rejected because transition ordering and stale
  result rejection cannot be proven.
- Put lifecycle in the navigation router. Rejected because native
  foreground/background and secure-session state are not navigation concerns.

### Consequences

- Positive: lifecycle state and failures become observable and testable.
- Negative: boot and transition infrastructure becomes more explicit and all
  existing entry paths must use it.

### Reversal Trigger

Reverse only if a replacement provides one equally explicit transition owner,
generation fencing, and the same lifecycle evidence.

## MS-D02: Executable Runtime Registry

**Status**: accepted
**Date**: 2026-08-27

### Context

The current registry is a descriptive status catalog; runtime lifecycle is
implemented independently by feature modules.

### Decision

**Decision**: Runtime descriptors own install/bootstrap/suspend/resume/reconcile/
teardown. Every descriptor declares scope, entry policy, dependencies, and
bootstrap/teardown budgets. Hard `dependsOn` controls readiness order; optional
`uses` disables only the affected capability.

### Rationale

One registry lets the lifecycle kernel validate an acyclic graph and enforce
topological bootstrap, reverse teardown, bounded reconcile, and generation
checks consistently.

### Alternatives Considered

- Preserve ad hoc runtime controllers. Rejected because readiness and teardown
  remain incomparable.
- Make every runtime shell-blocking. Rejected because a Moments or notification
  outage must not invalidate an otherwise valid session.

### Consequences

- Positive: runtime state is observable and module degradation is explicit.
- Negative: existing social/group controllers require descriptor adapters.

### Reversal Trigger

Reverse if the registry becomes a central business orchestrator rather than a
lifecycle mechanism; domain commands must remain with their owning runtimes.

## MS-D03: Active-Only Primary Tabs

**Status**: accepted
**Date**: 2026-08-27

### Context

Keeping every primary page mounted increases hidden render work and memory on
Mobile, while remounting can lose scroll state or delay return navigation.

### Decision

**Decision**: Retain `on-visit + none` for primary tabs until native evidence
justifies bounded LRU.

### Rationale

Runtime projections outlive pages, so active-only page trees do not sacrifice
business freshness.

### Alternatives Considered

- Keep every tab mounted. Rejected due to hidden-render and memory risk.
- Adopt LRU immediately. Rejected because no native measurement currently
  justifies a cache size.

### Consequences

- Positive: bounded component lifetime and lower hidden work.
- Negative: pages must restore view state explicitly and may pay remount cost.

### Reversal Trigger

P95 return-to-visible or scroll recovery misses the
accepted budget after selector and virtualization work.

## MS-D04: Descriptor-Owned Detail Navigation

**Status**: accepted
**Date**: 2026-08-27

### Context

Current store fields such as active session/group identity also determine which
detail UI appears. That conflates business selection with route lifetime.

### Decision

**Decision**: Conversation/contact/group/moment/setting details are navigation
entries. Domain stores may hold selection, but do not define route structure.

### Rationale

**Rationale**: Back behavior, tab-bar visibility, deep links, focus, and cache
lifetime belong to navigation.

### Alternatives Considered

- Continue deriving routes from stores. Rejected because deep-link and back-stack
  behavior becomes implicit.
- Introduce URL routing as the authority. Rejected because native stack and
  overlay lifetime still require a Mobile navigation owner.

### Consequences

- Positive: route identity and page lifetime become deterministic.
- Negative: deep links and current store selections need explicit adapters.

### Reversal Trigger

Reverse only if a replacement retains descriptor-owned lifetime, focus,
back-stack, and tab-bar semantics.

## MS-D05: OAuth Through Pre-Session Auth Runtime

**Status**: accepted
**Date**: 2026-08-27

### Context

Mobile has a native deep-link event but no complete provider attempt,
PKCE/state/nonce, callback exchange, timeout, or replay contract.

### Decision

**Decision**: Provider launch, state/PKCE binding, deep-link callback, Station
exchange, cancellation, and timeout belong to station-scoped `authRuntime`.
`sessionRuntime` starts only after the access chain returns a PTID-bearing
session and final access grant. Earlier login responses remain secure,
attempt-scoped candidates and cannot authorize business runtimes. Web UI
renders state and dispatches intent.

### Rationale

Secrets and callback validation cross Web, Rust, native OS, and Station trust
boundaries and require one generation-aware owner.

### Alternatives Considered

- Simulate redirects in React. Rejected outside prototypes.
- Let native plugins exchange provider tokens. Rejected because plugins must not
  mutate Station business sessions.

### Consequences

- Positive: authentication has no dependency on a session that does not exist
  yet; callback replay and Station/provider mismatch fail closed.
- Negative: requires Model/Station contract work and native deep-link evidence
  on both platforms.

### Reversal Trigger

Review if the platform adopts an OS-managed authentication session that can
preserve the same Station binding, one-time state, and secret ownership.

## MS-D06: PTID-Only Mobile Identity

**Status**: accepted
**Date**: 2026-08-27

### Context

Current auth Proto and TypeScript compatibility models expose legacy numeric
actor identifiers, while the active identity invariant permits only PTID across
API, process, Station, device, store, and route boundaries.

### Decision

Mobile consumes and emits actor identity only as `ptid: string`. Numeric
`actor_id` fields are discarded at bounded compatibility ingress and removed
from Mobile-facing wire, projection, and service contracts at cutover.

### Rationale

PTID is federation-stable and prevents Station-local storage identity from
leaking into client ownership.

### Alternatives Considered

- Keep both PTID and numeric IDs in Mobile. Rejected because dual identity
  permits mismatched cache and authorization keys.
- Normalize numeric IDs into strings. Rejected because representation changes
  do not make a Station-local ID federation-stable.

### Consequences

- Positive: one identity key across API, cache, command, event, and navigation.
- Negative: legacy auth/OAuth responses without `ActorRef.ptid` become blocking
  contract failures until Station is corrected.

### Reversal Trigger

None within the current identity architecture. Changing this requires a
cross-project identity architecture decision.

## MS-D07: Proto Gateway Cutover

**Status**: accepted
**Date**: 2026-08-27

### Context

Mobile social APIs mix JSON compatibility envelopes, generated Proto, and
manual TypeScript domain types.

### Decision

All Station-facing Mobile business contracts converge on generated Proto. During
cutover, wire compatibility may exist only inside the API gateway; pages,
runtimes, stores, and storage consume canonical projections derived from
generated types. The old JSON/manual path is deleted after parity evidence.

### Rationale

This preserves one contract truth while allowing an evidence-backed migration
from existing endpoints.

### Alternatives Considered

- Keep permanent JSON DTOs beside Proto. Rejected as a duplicate source of
  domain semantics.
- Big-bang endpoint replacement. Rejected because current production paths need
  per-domain parity and rollback evidence.

### Consequences

- Positive: generated contracts become enforceable end to end.
- Negative: the temporary gateway adapter adds bounded migration complexity.

### Reversal Trigger

Stop a domain cutover if generated-Proto parity or Station compatibility cannot
be proven; do not retain both paths after parity succeeds.

## MS-D08: Durable Unknown-Outcome Convergence

**Status**: accepted
**Date**: 2026-08-27

### Context

A mutation may commit at Station while its response is lost. Blind retry can
duplicate effects, while dropping local state hides the result.

### Decision

Retriable mutations use a generated typed envelope in one Rust-owned encrypted,
bounded Station/PTID ledger. Unknown outcomes query command status or
authoritative readback before any retry. Replay requires an idempotency
guarantee for the same command ID.

### Rationale

This converts network ambiguity into a durable, inspectable state that can
converge after reconnect or restart.

### Alternatives Considered

- Retry every timeout. Rejected because non-idempotent effects may duplicate.
- Never retry writes. Rejected because known pre-dispatch failures are safely
  recoverable.
- Optimistically assume success. Rejected because it fabricates Station truth.

### Consequences

- Positive: exactly-once visible effect can be proven where Station supports it.
- Negative: unsupported mutations remain visibly unresolved; capacity limits
  can reject new writes rather than risk data loss.

### Reversal Trigger

Review if Station offers a universal transactional command protocol that fully
replaces the client ledger while preserving restart recovery.

## MS-D09: Generation-Fenced Teardown

**Status**: accepted
**Date**: 2026-08-27

### Context

Station change, logout, revocation, and resume can race with inflight requests,
streams, timers, secure storage, and projection persistence.

### Decision

Each identity transition advances a lifecycle generation, synchronously hides
old projections, closes old command admission, and performs bounded teardown.
Late results are rejected by generation. Cleanup or secure-storage failure
keeps the lifecycle outside Shell.

Local isolation and credential deletion are mandatory. Remote revocation is
attempted before deletion but is bounded best-effort; failure records
`remote-revocation-unconfirmed` without retaining a retry credential.

### Rationale

The transition cannot be physically transactional across OS storage, network,
and JavaScript runtimes, but it can be externally atomic and fail closed.

### Alternatives Considered

- Await every subsystem without a deadline. Rejected because one stuck runtime
  can hang logout indefinitely.
- Enter the new Shell and clean old state in background. Rejected because it can
  expose cross-actor data.
- Restore the old Shell after partial failure. Rejected because old credentials
  or producers may already be invalidated.

### Consequences

- Positive: no old-generation mutation or projection can contaminate the next
  session.
- Negative: cleanup failures are user-visible and may require retry or explicit
  local reset.

### Reversal Trigger

Reverse only if a stronger transactional runtime can prove the same
cross-process isolation and cleanup guarantees.

## MS-D10: Peer-ID-Pinned Station Scope

**Status**: accepted
**Date**: 2026-08-27

### Context

Mobile currently stores Station URLs and probes reachability/label, while OAuth,
sessions, caches, and durable commands require a stable security scope. URLs can
change ownership, redirect, or move without representing the same Station.

### Decision

The explicit first-add flow pins a challenge-verified `station_peer_id`. OAuth,
sessions, caches, and command records use that peer ID as their Station scope;
URLs remain mutable connection hints. A saved URL returning another peer ID
fails closed and requires explicit Station replacement.

### Rationale

The peer ID is bound to Station signing identity and remains stable across
address changes, while URL equality proves neither continuity nor ownership.

### Alternatives Considered

- Key scope by normalized URL. Rejected because URL reuse could expose cached
  credentials or commands to another Station.
- Trust display label or TLS hostname alone. Rejected because labels are not
  identities and local-development HTTP remains an allowed environment.

### Consequences

- Positive: redirect/domain changes cannot silently inherit identity-scoped
  state.
- Negative: first add requires a signed handshake and explicit replacement when
  Station identity legitimately changes.

### Reversal Trigger

Review only if a higher-level Station identity architecture replaces peer IDs
with another signed, migration-safe identifier and defines state transfer.
