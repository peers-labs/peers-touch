# Mobile Shell — 设计决策

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-27 | **Updated**: 2026-08-29
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
| MS-D11 | Station identity proof is signed by the libp2p Ed25519 host key | accepted |
| MS-D12 | OAuth secrets and credential delivery remain native | accepted |
| MS-D13 | Station finalizes OAuth grant and session atomically | accepted |
| MS-D14 | Native OAuth proof uses an isolated Appium hybrid harness | accepted |

W2-E2 physical-proof refinements are isolated in
[`native-oauth-proof/decisions.md`](./native-oauth-proof/decisions.md).
MOP-D01..MOP-D04 were accepted by the Owner on 2026-08-29.

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

## MS-D11: Libp2p Host-Key-Signed Station Identity

**Status**: accepted
**Date**: 2026-08-27

### Context

The existing Federation signing key is independent from the libp2p host key.
Its signature therefore cannot prove ownership of a claimed libp2p PeerID.
Unsigned bootstrap and health responses prove reachability only.

### Decision

The Station identity endpoint signs a deterministic protobuf
`StationIdentityStatement` with the Station libp2p Ed25519 host private key.
The response includes the marshalled host public key. Clients derive the
PeerID from that key, compare it to the signed `station_peer_id`, and verify the
signature over:

```text
"peers-touch/station-identity/v1\0"
  || deterministic_protobuf(StationIdentityStatement)
```

The statement binds an exact 32-byte client challenge, canonical origin,
UTF-8-byte-sorted capability IDs, issue time, and expiry. Signed lifetime is at
most 60 seconds; clients allow at most 30 seconds of clock skew.

Handshake HTTP redirects are rejected. Required capabilities use subset
matching; unknown capabilities are ignored. Host-key rotation changes the
PeerID and requires explicit Station replacement.

### Rationale

The host key is the only existing key whose derived identity is the claimed
Station PeerID. Challenge, origin, capability, and time binding prevents replay
and prevents a reachable endpoint from impersonating an already pinned
Station.

### Alternatives Considered

- Sign with the Federation profile key. Rejected because it is not
  cryptographically bound to the libp2p PeerID.
- Trust `/sub-bootstrap/info` or TLS hostname. Rejected because neither binds
  the client challenge to Station identity.
- Follow redirects and compare only the final URL. Rejected because URL
  continuity is not identity continuity.

### Consequences

- Station must expose its host signer through a narrow identity service.
- Mobile must implement libp2p public-key decoding, PeerID derivation, and
  deterministic statement verification in Rust.
- Existing URL-only registry entries become unverified and cannot inherit
  sessions, caches, commands, or drafts.
- There is no compatibility reader or silent host-key rotation path.

### Reversal Trigger

Review only if the system adopts a stronger signed Station identity with an
explicit PeerID migration proof. A URL alias or unrelated signing key is not a
valid replacement.

## MS-D12: Native-Owned OAuth Secrets And Credential Delivery

**Status**: accepted
**Date**: 2026-08-28

### Context

The current Rust OAuth helper persists PKCE and nonce material but returns the
verifier, nonce, authorization code, and raw callback data to Mobile Web for
Station completion. Activated status polling can also return newly minted
bearer credentials. This violates the accepted rule that Web renders OAuth
projection state but cannot inspect attempt secrets.

### Decision

Mobile Rust owns provider callback validation and the Station
complete/status/cancel/acknowledge transport. It generates and securely stores
an attempt secret plus an ephemeral X25519 credential-delivery key pair.
Station binds their hash/public key at attempt start.

Station returns one persisted encrypted credential envelope. Mobile Rust
decrypts and stores the credential, acknowledges durable receipt, and exposes
only a public session projection to Web. Status retries return the same
envelope until acknowledgement and never mint another credential.

### Rationale

This keeps PKCE, nonce, callback code, and Station credentials out of Web while
making response loss recoverable without duplicate session creation.

### Alternatives Considered

- Return secret material to Web and delete it immediately. Rejected because
  JavaScript observes the secret before deletion.
- Return a fresh token from each status call. Rejected because attempt IDs
  become a reusable credential-minting capability.
- Make credential delivery strictly at-most-once. Rejected because a lost
  response could create an unrecoverable active session.

### Consequences

- Rust requires generated OAuth transport bindings and encrypted envelope
  handling.
- Station temporarily persists one encrypted envelope until acknowledgement or
  expiry.
- Web APIs that need authorization must use the Rust-owned active session
  transport instead of persisted Web tokens.

### Reversal Trigger

Review only if the platform provides a stronger native authorization session
whose secret and restart guarantees meet the same boundary.

## MS-D13: Transactional OAuth Authorization Finalizer

**Status**: accepted
**Date**: 2026-08-28

### Context

Access Gate re-evaluation, candidate activation, session creation, and attempt
completion currently cross separate transactions. Cancellation, policy denial,
or process failure can race with session activation.

### Decision

Station introduces one authorization finalizer that locks Access Attempt, OAuth
Attempt, and candidate in a fixed order. It validates final grant, current
Station/device/generation bindings, creates or reuses one candidate-keyed
session, persists the encrypted delivery envelope, and commits terminal attempt
state in one transaction.

Cancellation uses the same lock order. Legacy authorization codes are consumed
by one conditional update before token creation. The Station authorization
surface derives actor identity from an authenticated subject and explicit
consent, never from caller-supplied actor parameters.

### Rationale

One transaction removes the grant/activation gap and gives retries a stable,
idempotent result.

### Alternatives Considered

- Best-effort revocation after partial activation. Rejected because revocation
  can fail and leave an unauthorized live session.
- Application mutexes. Rejected because they do not coordinate multiple
  Station processes.
- Client-side final grant checks. Rejected because Station owns access policy.

### Consequences

- Session persistence gains candidate, Access Attempt, Station, device,
  lifecycle-generation, and decision-revision bindings.
- All activation and cancellation paths must use the finalizer.
- Existing active-session status behavior is deleted rather than retained as a
  compatibility path.

### Reversal Trigger

Review only if session issuance moves to another Station-owned transactional
authority with equivalent locking, idempotency, and audit semantics.

## MS-D14: Appium Hybrid Native Acceptance

**Status**: accepted
**Date**: 2026-08-28

### Context

The Mobile native Gate currently validates service manifests and then fails
closed because no iOS/Android Driver or Harness exists. Static checks and Xcode
project enumeration cannot prove browser launch, OS callback delivery, secure
storage, restart recovery, or visible Access Gate behavior.

### Decision

Use Appium 2 with XCUITest and UiAutomator2 drivers. Acceptance builds expose a
typed `window.__PEERS_MOBILE_ACCEPTANCE__` registry only when
`VITE_ACCEPTANCE_HARNESS=1`; drivers switch to the WebView context and invoke
production actions through that registry.

Simulator/emulator cells prove deterministic build, launch, callback routing,
failure, and cleanup behavior. MS-AG03 proof additionally requires physical iOS
and Android devices plus real disposable GitHub and Google accounts. Every
client receives isolated app data, Station/device identity, and cleanup leases.

### Rationale

Appium supplies one cross-platform orchestration model while preserving the
real Tauri WebView, native browser, OS deep-link, Rust secure-storage, and
Station paths.

### Alternatives Considered

- Browser-only Playwright. Rejected because it cannot prove native browser,
  deep-link, secure storage, or lifecycle behavior.
- Store mutation through test-only JavaScript. Rejected because it bypasses
  production runtime ownership.
- Platform-specific XCTest and UiAutomator suites without a shared Harness.
  Rejected because evidence semantics and action names would drift.

### Consequences

- The environment contract must declare Appium server/driver versions, device
  allocation, OAuth credential sources, build identity, ports, storage, and
  cleanup.
- Physical-device availability and provider credentials remain hard proof
  prerequisites.
- The acceptance-only registry must be absent from production builds.

### Reversal Trigger

Review if Tauri ships a supported cross-platform native WebDriver that proves
the same WebView, OS callback, secure-storage, and evidence contracts.
