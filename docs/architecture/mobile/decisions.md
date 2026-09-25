# Mobile Shell — 设计决策

> **Status**: active; iOS simulator-canonical Acceptance amendment accepted
> **Version**: v1.3
> **Created**: 2026-08-27 | **Updated**: 2026-09-21
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
| MS-D15 | Durable command and draft persistence use generated, scope-keyed v2 contracts | accepted |
| MS-D16 | Generic Access Gate actions are schema-bound and Station-finalized | accepted |
| MS-D17 | Rust owns authenticated Mobile business transport | accepted |
| MS-D18 | Mobile consumes the canonical Conversation member authority | accepted |
| MS-D19 | Social owns directional block and relationship projection | accepted |
| MS-D20 | Forward, retract, actor-hide, and moderation are distinct Conversation actions | accepted |
| MS-D21 | Mobile consumes Moments policy truth and Rust-owned media staging | accepted |
| MS-D22 | Settings preserve Actor, Notification, Social, and device ownership | accepted |
| MS-D22A | Current Settings use owner-specific aggregate CAS and no new account-preference owner | accepted |
| MS-D23 | Native push, scheduled wakeup, and picker callbacks are generation-fenced | accepted |
| MS-D23A | Push registration is PTID/device-bound, credential-protected, and reconcile-only | accepted |
| MS-D23B | Native scheduling and media selection have one terminal owner | accepted |
| MS-D24 | Owner cutovers delete legacy semantics atomically | accepted |
| MS-D25 | Moments typed outcomes and native media lifecycle close as one owner-composed flow | accepted |
| MS-D26 | Required Mobile proof uses isolated iOS Simulator cells | accepted |
| MS-D27 | Current Mobile product proof uses one Station; cross-Station and Relay proof is deferred | accepted |

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
failure, and cleanup behavior. Under MS-D26 they are the required MS-AG03
proof surface. Physical iOS and Android devices plus real disposable GitHub and
Google accounts remain optional provider diagnostics.

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
- Physical-device availability and provider credentials are optional
  diagnostic prerequisites and never block required completion.
- The acceptance-only registry must be absent from production builds.

### Reversal Trigger

Review if Tauri ships a supported cross-platform native WebDriver that proves
the same WebView, OS callback, secure-storage, and evidence contracts.

## MS-D15: Generated Scope-Keyed Reliability Persistence V2

**Status**: accepted
**Date**: 2026-09-11

### Context

`MS-D08` accepts one generated, encrypted, Station/PTID-scoped reliability
ledger, but the current v1 skeleton does not implement that contract:

- `commandRuntime` submits `command_type + payload_json`; Rust allocates a
  second command ID and drops the caller's idempotency key.
- Command rows have no Station or actor scope, and draft keys contain only
  `kind + domain_key`.
- Both stores derive encryption keys from a caller-provided session secret.
  Logout deletes session credentials, while accepted recovery semantics retain
  exact-scope commands and drafts across restart and re-authentication.
- Friend Request is the only non-Chat family with a generated signed command,
  deterministic payload hash, stable command ID, and durable Station command
  record. At decision time, Mobile received only a projection response and had
  no command-ID result lookup, so it was not eligible for durable admission.
- Block/unblock, Moment reaction, and Moment comment/reply requests have no
  generated command identity and authoritative result/readback contract.
  Their current best-effort ledger calls cannot prove recovery.

These were the verified source facts at review time. The Owner accepted the
contract below on 2026-09-11. The authenticated Friend Request command-result
lookup required by item 2 and the Mobile schema-v2 implementation are now
source-complete; required simulator proof remains `UNPROVEN`, while physical
native proof is optional diagnostics under MS-D26.

### Decision

Introduce a generated Mobile reliability contract owned under `model/domain/`
and a schema-v2 Rust persistence boundary:

1. `MobileDurableCommandEnvelope` stores one canonical command ID, verified
   `station_peer_id`, actor PTID, ordering key, deterministic payload bytes and
   SHA-256 digest, lifecycle generation for stale-callback fencing, attempt
   state, and one generated payload variant. The v2 payload membership contains
   only `FriendRequestCommand`. Chat and Group commands remain exclusively in
   the Device Messaging Engine. Any later variant requires its own accepted
   Model/Station command, idempotency, result/readback, and resolver contract.
2. Runtime admission is compile-time closed. A generated payload variant is
   unusable until a domain resolver exists for preparation, exact-byte
   dispatch, authoritative result lookup, projection checkpointing, and typed
   error classification. Station now exposes command-ID result lookup. The
   Friend Request variant remains disabled until Mobile completes the same-ID,
   exact-signed-byte persistence, dispatch, and resolver cutover.
3. `InteractionAdmission` owns admission and persistence, not actor-device
   identity. For Friend Request, the Device Messaging Engine remains the sole
   enrollment/signing-key owner and returns immutable signed command bytes,
   command ID, and hash through a typed Rust port. W4 atomically persists that
   exact result before network dispatch and must not load, copy, or manage
   device signing keys. Web cannot supply a string command kind, opaque JSON
   payload, alternate command ID, or human-readable persisted error.
4. Validation, schema, signing, and deterministic policy failures are
   `failed_terminal`. A retryable local availability failure before dispatch
   leaves the command queued without incrementing `attempt_count`. Each
   dispatch and authoritative readback attempt has a 30-second runtime-owned
   deadline, matching the existing Mobile Station transport request bound. Any
   dispatch deadline, cancellation, timeout, disconnect, or response-decode
   failure after dispatch begins enters `unknown_outcome`; a readback deadline
   remains `unresolved` and never authorizes replay. Replay uses the same bytes,
   ID, hash, signature, and domain expiry. Automatic retries use full-jitter
   exponential backoff from 1 second to 60 seconds, stop after eight transport
   attempts or domain expiry, and then expose `unresolved`. Process restart and
   foreground/background transitions never reset the attempt count. Explicit
   cancellation races the dispatcher through one persisted compare-and-swap:
   cancel may commit only from `queued`/`retry_wait`, while dispatch first
   commits `dispatch_fenced` and increments the attempt count. Whichever
   transaction commits first wins. A crash after `dispatch_fenced` is
   conservatively `unknown_outcome`, even if no bytes were sent. After that
   fence, a local discard stops tracking and does not claim Station
   cancellation.
5. A Station-owned result is accepted only when command ID and payload hash
   match. The command row is removed only after the authoritative result and
   the corresponding local projection checkpoint commit in one transaction.
   Station remains the audit source; Mobile does not retain a duplicate
   committed-command log. Terminal rejection/conflict remains visible until
   explicit acknowledgement, then its row is removed. Unresolved rows are
   never silently purged.
6. `MobileDraftEnvelope` is a generated, independent store keyed by
   `station_peer_id + actor_ptid + surface_kind + target_id`. Its v2 payload
   membership is exactly Chat composer draft and Moment composer draft.
   Payloads contain text and encrypted blob references, never media bytes,
   credentials, provider secrets, or command frames.
7. Rust owns key material. It generates a random per-install key-encryption key
   in native Keychain/Keystore and a random data-encryption key for each exact
   Station/PTID scope. The install key wraps the scope key, whose wrapped record
   remains in Rust-owned secure storage; HKDF-SHA256 derives distinct
   command-ledger and draft-store AEAD keys from the scope key. Session
   credentials authorize scope activation but never derive, wrap, or cross the
   Web/Rust boundary as persistence keys. Authenticated scope/schema metadata
   must verify before crash recovery mutates any row; missing key material fails
   closed and cannot be regenerated over existing ciphertext.
8. Logout and Station replacement always close admission and quarantine
   unresolved commands under their original Station/PTID scope; the transition
   cannot discard those commands. Chat and Moment drafts independently use the
   accepted product-state retain/discard decision. Until that draft decision
   commits, lifecycle remains outside the next Shell with the closed store
   retained. Draft retain preserves exact-scope rows. Draft discard deletes
   only draft rows and fails closed with retry/reset if deletion cannot
   complete. Exact Station/PTID re-authentication may reopen retained drafts
   and unresolved commands. The scope key is removable only when no unresolved
   command or retained draft remains, or during explicitly authorized whole-app
   local reset.
9. The install key is a versioned, device-only, non-synchronizing secure-storage
   record with stable `kek_id` and a random app-data `install_epoch`. Wrapped
   scope keys bind `kek_id`, install epoch, Station/PTID, schema revision, and
   AEAD metadata. A Keychain/Keystore key surviving reinstall cannot open a
   different epoch. Reset is journaled and idempotent: close stores, remove
   scope-key records and databases, remove the old install key, then create a
   new install key only when fresh v2 storage initializes. Missing or invalid
   keys remain a blocking recovery state while any ciphertext exists.
10. Existing unscoped v1 databases, including WAL and SHM companions, enter a
   crash-recoverable opaque quarantine transaction before any v2 store opens.
   Rust closes all handles, creates and fsyncs a manifest, renames every
   existing file on the same filesystem, fsyncs source and destination
   directories, and atomically marks the manifest complete. Any partial or
   ambiguous state keeps admission closed until recovery completes. V1 content
   is never decrypted to guess ownership, replayed, restored into editors, or
   counted against v2 capacity. The only actions are:
   - `retain`: keep the opaque archive and keep command admission closed;
   - `discard legacy`: remove the archive and continue with a fresh v2 store;
   - `reset all local reliability data`: remove v1/v2 data and rotate the
     install key.
11. Cleanup evidence reports logical record/path/key absence. It must not claim
    secure physical deletion unless the platform proves that every ciphertext,
    snapshot, backup, WAL copy, and unique scope key is irrecoverable.

### Rationale

One generated identity from preparation through Station result eliminates the
current split-brain ledger/domain IDs. Compile-time resolver membership prevents
unsupported mutations from appearing durable. Per-scope keys preserve
restart/re-authentication recovery without coupling persistent data to expiring
credentials, while opaque quarantine prevents unscoped v1 data from leaking
into a guessed account.

### Alternatives Considered

- Migrate `command_type + payload_json` and infer the current Station/PTID.
  Rejected because the payload is not the dispatched signed command and v1 has
  no trustworthy scope provenance.
- Derive store keys from access/refresh/session credentials. Rejected because
  credential deletion or rotation would make retained exact-scope state
  unreadable.
- Treat successful HTTP return as every domain's authoritative commit.
  Rejected because Friend Request local durable acceptance is not remote
  business completion and other domains expose different semantics.
- Retry timeout failures with a new command ID or fresh signature. Rejected
  because it defeats Station idempotency and can duplicate effects.
- Keep committed payloads as a Mobile audit log. Rejected because Station owns
  business audit truth and a second retained log expands privacy and capacity
  risk.
- Import or display legacy rows under the next authenticated account. Rejected
  because v1 cannot prove Station/PTID ownership.

### Consequences

- Positive: one exact generated command identity spans signing, persistence,
  dispatch, readback, and projection convergence.
- Positive: logout/re-authentication can preserve same-scope drafts and
  unresolved commands without retaining session credentials.
- Negative: v2 initially admits no production command. Friend Request becomes
  the first variant only after its result lookup and Mobile resolver land.
- Negative: Moment, block/unblock, notification, settings, and other writes
  remain online-only or draft-only until their owners provide complete typed
  contracts.
- Negative: legacy v1 rows cannot be recovered automatically; retaining them
  keeps writes closed until the user chooses discard or reset.
- Negative: eight failed transport attempts can require explicit user action
  even before the domain command expires.

### Reversal Trigger

Review if Station adopts one universal transactional command protocol that
supplies exact payload identity, authoritative outcome lookup, projection
checkpoint semantics, and restart recovery for every admitted Mobile domain.
Do not broaden v2 membership merely because an endpoint accepts an
idempotency-key-shaped string.

## MS-D16: Schema-Bound Generic Access Gate Actions

**Status**: accepted
**Date**: 2026-09-18

### Context

Station can advertise terms, device-trust, maintenance, and custom gates with
`input_schema_json`, but `SubmitAccessGateRequest` can submit only login,
invite-code, or session data. Letting a client turn `submit_action` into an
arbitrary URL would move policy and routing authority into Mobile.

### Decision

Access Gate defines one generated submission envelope bound to the active
attempt, gate, action, Station peer ID, device, lifecycle generation, schema
revision/digest, and stable submission ID. Login, session restore, OAuth,
invite, and device trust remain typed oneof actions. Terms/custom scalar fields
use a canonical schema-bound value set. Secret-bearing values use dedicated
typed native handles and are forbidden in the generic field set.

Station validates the exact advertised action, executes policy, records
idempotent outcome, and advances the gate. The client renders the schema and
submits intent only. Final session activation remains exclusively with the
Station authorization finalizer after the complete chain is granted.

### Rejected

- Treating `submit_action` as a client-selected HTTP route.
- Sending arbitrary JSON and relying on server-side best effort.
- Letting a successful gate action activate a session before final grant.
- Treating an unknown gate as skipped.

### Consequences

- Every advertised actionable gate has a submission contract.
- Stale schema/action submissions fail closed and request a fresh decision.
- Generic gate support requires Model and Station work before Mobile enables
  those surfaces.

## MS-D17: Rust-Owned Authenticated Business Transport

**Status**: accepted
**Date**: 2026-09-18

### Context

OAuth credentials are accepted as Rust-owned secrets, but ordinary Mobile Web
gateways currently receive `accessToken` and attach bearer headers directly.
This splits credential ownership and permits each gateway to implement its own
origin, redirect, timeout, and refresh behavior.

### Decision

All authenticated Mobile business requests use typed Web-to-Rust commands.
Rust resolves the current Station/PTID/generation scope, pins the verified
Station origin, attaches credentials in memory, rejects redirects, enforces
generated operation and size bounds, and returns only public generated data or
typed errors. Session refresh is single-owned by `sessionRuntime`.

The transport is not an arbitrary URL proxy. Web names a generated operation
and provides its typed input. Public unauthenticated resources use a separate
explicit allowlist.

### Rejected

- Exposing bearer credentials to Web for convenience.
- Cookie-based `credentials: include` as a parallel session mechanism.
- A generic Tauri HTTP proxy with caller-selected URLs or headers.
- Per-gateway token refresh and retry.

### Consequences

- `MobileAuthSession.accessToken` and direct authenticated Web `fetch` are
  removed at cutover.
- Existing Device Messaging Engine transport is a reusable pattern, not a
  second credential owner.
- Domain gateways continue to own generated serialization and response
  normalization.

## MS-D18: Canonical Conversation Member Authority

**Status**: accepted
**Date**: 2026-09-18

### Context

AO-D10 has accepted canonical target-member role/mute and atomic ownership
transfer semantics, while Mobile still has two executable `/group-chat/*`
callers.

### Decision

Mobile consumes `ConversationMemberAuthorityCommand` through
`POST /conversation/member/update` and
`POST /conversation/ownership/transfer`. Device Messaging Engine prepares the
exact deterministic command. Group runtime reconciles command result, ordered
authority event, member snapshot, owner, authority head, membership epoch, and
mute deadline before reporting completion.

Owner transfer remains one aggregate transition. Actor-local member settings
remain separate and cannot change another member's authority.

### Rejected

- Adapting the retired Group routes behind a new Mobile method name.
- Two-step demote/promote owner transfer.
- Client-side role or owner patches before authority readback.

### Consequences

- The two legacy Group callers can be deleted once the canonical consumer path
  and proof exist.
- Stale head/epoch responses require reconcile-before-retry.
- Mobile does not redefine AO-D10.

## MS-D19: Social Directional Block Authority

**Status**: accepted
**Date**: 2026-09-18

### Context

Social already enforces a block graph when filtering follow, feed, and private
content reads, but public generated block/unblock/list/status commands do not
exist. Mobile therefore still calls four retired Friend Chat routes.

### Decision

Social owns a directional `actor -> target` block edge at the actor's Home
Station. Either direction denies protected pair interactions. Block and
unblock are idempotent generated commands with stable identity, payload hash,
deadline, revision, result lookup, and ordered relationship event.

Block atomically removes both follow directions visible to the pair and
invalidates pending relationship eligibility and dependent private-content
grants. Unblock removes only the caller's edge and restores nothing
implicitly. Blocked-list returns only the authenticated actor's outgoing edges
with cursor pagination. Relationship status exposes the viewer's own block and
allowed actions; it does not disclose that the peer blocked the viewer.

Cross-Station propagation uses signed, idempotent Social Federation events.
Each Home Station enforces its local actor's source edge and materializes the
remote deny projection. Stale or unavailable remote policy fails closed for
new protected interactions.

### Rejected

- Keeping block under Chat or Friend Chat.
- Hiding follow rows while restoring them automatically on unblock.
- Returning peer block direction to the caller.
- Letting Mobile join follow and block tables.

### Consequences

- Social must add generated mutation/list/status/readback contracts before the
  four Mobile callers can move.
- Conversation, Moments, and Secure Content consume Social deny projections.
- Existing block-filtered read behavior becomes one consumer of the same owner,
  not evidence that mutation contracts already exist.

## MS-D20: Distinct Conversation Message Actions

**Status**: accepted
**Date**: 2026-09-18

### Context

Mobile requires forwarding and deletion, but existing sources conflate user
forwarding with Federation forwarding and legacy message deletion with shared
retract, actor-local visibility, and group moderation.

### Decision

Conversation exposes four distinct semantics:

1. Retract for everyone uses the existing author-authorized, policy-bounded
   retract command and commits a shared tombstone.
2. Delete for me is an actor-scoped hide command that persists across that
   actor's devices without changing another member's view or deleting the
   ordered fact.
3. Moderation remove is a role-authorized group command that commits a shared
   moderation tombstone and audit fact without E2EE plaintext.
4. Forward is a new send in the destination conversation. Device Messaging
   Engine snapshots locally entitled content, re-encrypts it for destination
   endpoints, re-authorizes encrypted objects, and optionally carries bounded
   provenance only inside the endpoint-encrypted destination payload.

Completion is the matching Conversation command ID/hash plus ordered event and
destination or actor-scoped projection readback. Federation command forwarding
is unrelated to the user-facing forward action.

### Rejected

- Physical deletion of the authority message row.
- Mapping every "delete" label to the same endpoint.
- Copying ciphertext or object grants between conversations.
- A Mobile-only forward record or optimistic row removal.

### Consequences

- UI labels and permissions must name the exact action.
- Actor-hide, moderation, and user-forward remain unavailable until their
  generated owner contracts exist.
- Existing retract may be wired independently because its canonical owner and
  event already exist.

## MS-D21: Moments Policy Projection And Native Media Staging

**Status**: accepted
**Date**: 2026-09-18

### Context

Social and Secure Content already own audience, block, encryption, grant, and
object rules. Mobile has viewer-scoped explanations for visible rows, but an
empty response cannot always distinguish true empty, filtered empty,
policy-hidden, deleted, or unavailable. Native picker completion and retained
file access are also undefined.

### Decision

Social returns typed feed/detail visibility outcomes and bounded policy summary
without leaking hidden object identity, author, content, or block direction.
Mobile renders that projection and never derives policy from local
relationship fields.

Native selection is a Rust-owned staging lifecycle. A request binds request ID,
surface, capability, generation, and deadline. Rust copies or secures selected
bytes into app-owned staging before returning an opaque handle, sanitized
metadata, and digest. Secure Content encrypts before upload; Social receives
only committed object descriptors. Cancel, permission change, late callback,
process death, publish success, draft discard, and scope teardown each have one
explicit retention or cleanup outcome.

### Rejected

- Treating an empty list as proof that no content exists.
- Guessing deleted versus hidden from a failed detail request.
- Passing arbitrary filesystem paths or durable OS grants into Web.
- Uploading plaintext directly from a native picker callback.

### Consequences

- Existing visible-row explanations remain reusable but need page-level and
  detail outcome completion.
- Restored drafts reference Rust staging handles, not paths or raw bytes.
- Policy and media correctness require owner readback and native lifecycle
  evidence.

## MS-D22: Explicit Settings Ownership

**Status**: accepted
**Date**: 2026-09-18

### Context

Mobile Settings combines profile, privacy, notification, account, device,
storage, permission, and blocked-user controls. Some contracts exist, while the
presence of `ActorPreferences` has been mistaken for a complete public API.

### Decision

Settings composes owners without a generic settings store:

- Station policy, capability, and server configuration remain Station-owned
  read-only projections; the Station registry and selection are device-local;
- Actor Profile owns profile plus the four existing privacy fields.
- Notification owns category preferences and push-device registrations.
- Social owns blocked users.
- This release has no additional account-preference fields or owner. A future
  owner requires a product amendment that enumerates its fields and behavior.
- `deviceSettingsRuntime` owns theme, font size, compact density, device-local
  language, cache controls, permission state, and app metadata.

Every Station-owned save uses authoritative readback and explicit conflict
state. An unavailable owner disables its section without retained defaults.
Local device settings never claim cross-device synchronization.

### Rejected

- Treating all Settings controls as `ActorPreferences`.
- Falling back from unavailable Station preferences to local persistence.
- Projecting an empty blocked list when Social has no public contract.

### Consequences

- Existing profile privacy and notification preference paths are retained.
- No placeholder account-preference section or hollow runtime is created.
- Settings drafts stay presentation state and never become business truth.

## MS-D22A: Owner-Specific Settings CAS Hard Cut

**Status**: accepted
**Date**: 2026-09-19

### Context

The existing Profile mutation has no observed revision and updates
`touch_actor` and `touch_actor_meta` outside one transaction. Notification
updates one category per request, so a multi-category Settings save can commit
partially. Desktop and Mobile share these Station routes, which rules out
Mobile-only revision enforcement or an optional compatibility path.

### Decision

1. Actor Profile stores one dedicated monotonic `profile_revision` with
   `touch_actor_meta`. It covers only editable profile/privacy values. The
   mutation locks and updates the Actor and meta rows in one transaction;
   follower/following/status counters do not advance it.
2. Notification stores one aggregate monotonic
   `notification_preferences_revision` per actor. One generated batch mutation
   validates all categories, compares one observed revision, commits all
   changed rows, and advances the revision once in one transaction.
3. Applied, unchanged, and stale-revision outcomes are typed response values
   with the canonical latest snapshot. All return HTTP `200`; invalid input is
   `400`, missing authentication is `401`, and owner failure is `500`.
4. A zero/missing revision, empty mutation, unspecified category, or duplicate
   category is invalid. An equal-value mutation returns `UNCHANGED` without
   incrementing revision. `CONFLICT` performs no write.
5. Desktop, Mobile Rust, Mobile Web, generated Go/Rust/TypeScript bindings, and
   Station switch atomically. The superseded unrevisioned Profile and
   single-category Notification mutation semantics are deleted.
6. A Settings detail saves only its selected owner. Owner status is
   independent; no cross-owner transaction or aggregate saved claim exists.
7. After a lost response, the client reads the owner snapshot before retry.
   Exact draft equality confirms commit; newer divergent state is conflict;
   unchanged revision permits an explicit retry.

### Rejected

- Optional revision for older clients.
- A revision per Notification category.
- Sequential category writes.
- Reusing identity/device `profile_version` as editable Profile revision.
- Incrementing Profile revision for counter-only updates.
- Saving Profile and device or Notification state in one cross-owner action.

### Consequences

- Shared route consumers must cut over together.
- Notification preference writes become atomic across every changed category.
- Profile and Notification drafts can retain precise conflict state and
  reconcile uncertain responses without reporting false success.
- A future account-preference capability still requires a separate product and
  architecture amendment.

See
[`20260919-settings-account-preference-revision-amendment.md`](./proposals/20260919-settings-account-preference-revision-amendment.md).

## MS-D23: Generation-Fenced Native Delivery Lifecycles

**Status**: accepted
**Date**: 2026-09-18

### Context

Native lifecycle and permission fencing exist, but push registration,
scheduled-work completion, and media-picker result ownership are incomplete.

### Decision

Native plugins own APNs/FCM/UnifiedPush token acquisition, OS receipt/tap
callbacks, scheduler registration, and picker UI. Rust owns device binding,
authenticated registration, generation fencing, deduplication, staging,
bounded reconciliation, and terminal callback state.

Push carries only a bounded wakeup/notification envelope, never credentials,
private content, or authority state. Receipt marks projections stale; tap
navigates only after current-scope validation and Station reconcile.

WorkManager/BGTaskScheduler installs one versioned work identifier per
application/environment, emits a wakeup only, honors expiration/cancellation,
and calls OS completion exactly once. It never dispatches business commands or
advances cursors.

Picker requests emit exactly one of selected-handle, cancelled,
permission-required, expired, or failed. Late and duplicate callbacks are
discarded.

### Rejected

- Native plugins mutating business stores.
- Push payload as durable message or read truth.
- Background scheduler as a second command/retry owner.
- Web-owned picker paths or callbacks.

### Consequences

- Native source and simulator evidence are required independently on iOS and
  Android; physical evidence is optional diagnostics.
- Missing provider configuration degrades to foreground/pull reconciliation;
  it does not invalidate the session.
- Token and staged-media cleanup become explicit lifecycle obligations.

## MS-D23A: PTID Push Registration And Reconcile Boundary

**Status**: accepted
**Date**: 2026-09-19

### Context

MS-D23 assigned native callback and Rust lifecycle ownership but did not define
the shared request, persistence, idempotency, credential-protection, readback,
or cleanup contract. The Notification architecture still described
`actor_id`, token-bearing device readback, and push preview content that
violated the PTID and reconcile-only boundaries.

### Decision

Notification owns one active push registration per authenticated
actor/device/channel/environment. The actor is always the authenticated PTID;
the submitted device must equal the authenticated device assertion. APNs, FCM,
and UnifiedPush use typed provider bindings, an explicit development or
production environment, a stable request ID, and a 32-byte app-install epoch
digest.

Register and unregister are idempotent. Exact request replay returns the same
redacted response; request-ID/body mismatch and provider reuse across another
actor/device fail without mutation. Token rotation for the same tuple
atomically replaces the old credential.

Provider bindings are write-only, encrypted at rest with AES-256-GCM under a
versioned Notification key derived from the Station deployment root secret,
and absent from all readback, Web state, errors, and logs. A root-key change
invalidates existing push registrations and requires native re-registration;
there is no old-key fallback or plaintext migration.

Native callbacks carry Rust-supplied lifecycle generation and a monotonic
native sequence. Rust discards stale, duplicate, expired, inactive-scope, or
mismatched callbacks before Station or Web effects. Push receipt and tap emit
only a bounded reconcile intent. Navigation is allowed only after current
Station/PTID/device validation and authoritative reconciliation.

Provider payloads contain only version, wakeup kind, notification/category
identity, a typed target hint, and timing. They never contain title, body,
private content, credentials, decryption material, read state, or authority
truth.

### Rejected

- The old `actor_id` and token-bearing push device schema.
- Optional request, install-epoch, environment, or device semantics.
- Native Swift/Kotlin calling Station directly.
- Web-visible provider credentials or raw provider-token digests.
- Push preview content or navigation before authoritative reconcile.
- Compatibility routes or dual old/new registration storage.

### Consequences

- Station key rotation deliberately drops push availability until each active
  native installation registers again.
- Logout, actor switch, Station replacement, provider rotation, permission
  revocation, and provider invalidation require explicit cleanup.
- Source completion can prove contract and callback fencing; provider delivery
  remains unproven until independent W7-PROOF evidence exists.

See
[`20260919-native-push-registration-amendment.md`](./proposals/20260919-native-push-registration-amendment.md).

## MS-D23B: One Native Scheduler And Picker Terminal Owner

**Status**: accepted
**Date**: 2026-09-19

### Context

MS-D23 required one scheduled wakeup identity and exactly one picker result but
did not freeze identifiers, cadence, acknowledgement, bounds, or staging
ownership.

### Decision

Android WorkManager and iOS BGTaskScheduler use only
`com.peers.touch.mobile.reconcile.v1.{development|production}`, a minimum
15-minute cadence, and network availability. Native callbacks carry the armed
Rust generation and monotonic sequence. Rust performs bounded reconciliation;
native success, failure, cancellation, and expiration race through one
exactly-once completion guard with a 25-second deadline.

Native media selection accepts one bounded request at a time. It copies
selected items to native private cache, returns temporary paths only to Rust,
and emits exactly one selected, cancelled, permission-required, expired, or
failed result. Rust verifies count, size, hash, generation, deadline, and scope,
moves bytes to app-owned staging, deletes every native temporary, and exposes
only opaque handles and metadata to Web.

### Rejected

- Per-feature/actor scheduler identities.
- Native business command dispatch.
- Completion before Rust acknowledgement.
- Web-owned native paths or content URIs.
- Empty success for cancellation or permission denial.
- Unbounded picker count/bytes/deadline.

### Consequences

- OS scheduling remains best effort; source completion does not prove cadence.
- Simulator expiration/cancellation and picker behavior remain W7-PROOF;
  physical behavior is optional diagnostics.
- Native and Rust cleanup paths become mandatory source checks.

See
[`20260919-native-scheduler-picker-amendment.md`](./proposals/20260919-native-scheduler-picker-amendment.md).

## MS-D24: Atomic Owner Cutover And Semantic Audit

**Status**: accepted
**Date**: 2026-09-18

### Context

The Mobile hard-cut currently fails on exactly six production calls: two Group
member-authority calls and four Social block/list/status calls. Raw string scans
alone cannot distinguish executable aliases from generated comments,
historical documents, tests, or fixtures.

### Decision

Each owner cutover is atomic: canonical producer contract, consumer, projection,
authoritative readback, focused checks, and rollback boundary become ready
before the replaced caller is deleted in the same change. No compatibility
adapter, alias endpoint, dual write, or duplicate owner survives.

The final repository audit is semantic. Every retired-route reference is
classified as executable production use, generated compatibility commentary,
test/fixture input, or historical documentation. Executable production use
must be zero. Non-executable references may remain only when their ownership or
historical status is explicit.

### Rejected

- Deleting UI behavior before its canonical owner exists.
- Renaming a legacy path and counting it as cut over.
- Keeping fallback calls for rollback.
- Requiring a repository-wide literal string count of zero.

### Consequences

- The two Group and four Social callers form the current measurable baseline.
- Rollback reverts the complete owner cutover; it does not reactivate a hidden
  compatibility path.
- Final exact-source functional and Native Acceptance proof occur only after
  production inventory reaches zero.

## MS-D25: Moments Outcome And Media Lifecycle Closure

**Status**: accepted
**Date**: 2026-09-19

### Context

MS-D21 assigned Moments policy projection and Rust media staging, while
MS-D23B bounded the native picker. W6B required one integrated contract that
keeps typed Social outcomes, native selection, Secure Content encryption, OSS
upload, Mobile draft state, and cleanup under their existing owners.

### Decision

Social returns generated feed and detail outcomes that keep true empty,
filtered empty, hidden, deleted, and unavailable distinct. Hidden outcomes
carry only bounded explanation aggregates and never leak hidden payload,
author identity, or block direction. Mobile renders those outcomes and does
not infer policy from local relationships, HTTP status, or an empty list.

Moment media uses the MS-D23B picker contract and a Rust-owned staging
lifecycle. Rust validates request identity, generation, deadline, count, size,
file status, and digest; moves bytes into scoped app-owned staging; invokes the
existing Secure Content and OSS owners; and returns canonical descriptors.
Web receives opaque handles and sanitized metadata only. Publish, discard,
cancel, timeout, stale or duplicate callback, scope teardown, and failure each
have one deterministic cleanup outcome.

### Rejected

- Mobile-derived policy classification.
- Browser `File` as the native product upload path.
- Web-visible native paths, content URIs, bookmarks, or durable grants.
- Plaintext upload directly from a picker callback.
- A second media store, retry owner, or compatibility path.

### Consequences

- W6B source closure may rely on generated Social outcomes and Rust staging.
- W6B-PROOF and W7-PROOF require simulator picker, permission, interruption,
  multi-actor, and receiver-perspective evidence.
- Simulator success does not claim the optional physical diagnostic scope.

See
[`20260919-moments-outcome-media-lifecycle-amendment.md`](./proposals/20260919-moments-outcome-media-lifecycle-amendment.md).

## MS-D26: iOS Simulator-Canonical Mobile Acceptance

**Status**: accepted
**Date**: 2026-09-21

### Context

The Mobile Plan made physical iOS and Android devices mandatory for every
runtime closure even when the asserted business behavior is owned above the
hardware boundary. That coupled product completion to scarce device leases,
provider accounts, and hardware availability while several required
`mobile-native-*` scenarios were only catalogued placeholders.

### Decision

The canonical required Mobile runtime cell is source-bound iOS Simulator.
Single-client journeys use one pinned iOS Simulator. Journeys that require
concurrent sessions, cross-actor truth, or cross-Station truth use two isolated
iOS Simulators with distinct devices, Appium sessions, ports, profiles, and
storage roots, plus real source-attested services, disposable actors,
authoritative readback, and deterministic cleanup.

The required client identities are `sim-ios` for the primary client and
`sim-ios-peer` for the independent peer. A missing peer client is `BLOCKED` for
takeover, cross-actor, cross-device, or receiver-perspective assertions; those
assertions must not degrade to a single shared session.

Required simulator Gates must execute production actions through
`window.__PEERS_MOBILE_ACCEPTANCE__`; they cannot replace runtime evidence with
source scans, mocks, injected success results, or stale artifacts. Platform
callbacks, restart, lifecycle, recovery, layout, accessibility, Moments,
Settings, Chat, Contacts, and Social convergence are proved on their declared
simulator cells.

Android Emulator and the existing `mobile-native-*` physical-device
environment remain optional diagnostics. They may strengthen Android-specific
and hardware-specific confidence for real provider browsers,
Keychain/AndroidKeyStore behavior, VoiceOver/TalkBack, OEM scheduling,
camera/photo providers, and pinned-hardware performance. Their absence,
failure to provision, or missing provider credentials does not block a Mobile
Task, W8 hard cut, W9 completion, or the required Acceptance bundle. Optional
Android or physical evidence must never be relabeled as required iOS Simulator
evidence, and iOS Simulator evidence must never claim Android or physical
execution.

OAuth's required proof boundary is the Station-bound access attempt,
callback-routing, finalization, replay/mismatch rejection, secure-session
projection, and restart behavior that can run deterministically on simulator
cells. A live GitHub/Google browser authorization remains an optional provider
diagnostic and does not own product completion.

### Rejected

- Keeping physical devices as hidden completion prerequisites.
- Keeping Android Emulator as a hidden completion prerequisite.
- Treating an unavailable optional physical Gate as `BLOCKED` required work.
- Reusing `mobile-native-*` IDs for simulator runs.
- Replacing missing runtime journeys with static checks or fabricated Harness
  state.
- Keeping dual required bundles with different completion truth.

### Consequences

- Feature, Capability, Registry, Plan, and Task contracts reference only iOS
  Simulator Gates for required Mobile runtime proof.
- Two-client product assertions retain independent receiver evidence through
  two isolated iOS Simulator clients; they are not collapsed into one session.
- Missing simulator Journey coverage is implemented before the corresponding
  proof Task can close.
- Android and physical Gate artifacts remain separately named and explicitly
  optional.
- This Plan makes no Android runtime-readiness claim. Android regressions do
  not block completion until a later product decision restores Android to the
  required platform matrix.
- Historical physical-proof evidence remains truthful historical evidence but
  is not a current blocker or substitute for the canonical simulator run.

## MS-D27: Same-Station Direct Proof For The Current Mobile Plan

**Status**: accepted
**Date**: 2026-09-21

### Context

`mobile-shell-20260827` coupled every two-actor Mobile product Gate to the
`mobile-social-simulator` topology: two Stations plus Relay. That topology is
necessary for cross-Station delivery claims, but it is not necessary to prove
the current same-Station Direct, command recovery, draft recovery, receiver
projection, Chat, Contacts, Group, or Moments journeys. The coupling made
Relay availability a blocker for evidence that does not cross a Station
boundary.

### Decision

The current Mobile Plan requires two isolated iOS Simulator clients and two
distinct actors bound through typed client-service bindings to one
source-attested disposable Station. The canonical environment is
`mobile-direct-simulator`; it reuses the production Harness and the existing
scenario-specific product oracles without a Relay.

Cross-Station or Relay-backed Social, Chat, Contacts, Moments, and recovery
proof is excluded from `mobile-shell-20260827`. It remains `UNPROVEN` and must
be planned together with the corresponding Desktop cross-Station work.
Station-switch lifecycle evidence remains valid and separate because it proves
scope teardown and rebinding, not cross-Station business delivery.

### Rationale

The topology now matches the claimed receiver journey. Two client processes,
devices, Appium sessions, ports, profiles, and storage roots preserve the
independent receiver boundary, while one Station removes an unrelated Relay
dependency. Keeping `mobile-social-simulator` intact preserves a dedicated
future topology without weakening its two-Station assertions.

### Alternatives Considered

- Keep Relay as a prerequisite for all Mobile product Gates: rejected because
  it tests a stronger topology than the current product claim and blocks
  unrelated same-Station proof.
- Reconfigure `mobile-social-simulator` in place to use one Station: rejected
  because it would silently weaken the existing cross-Station environment.
- Use one simulator session for both actors: rejected because it would remove
  receiver and device isolation.

### Consequences

- Current required two-actor Gates run on `mobile-direct-simulator`.
- Both simulator clients bind `services.station`; no Relay service or second
  Station appears in that runtime manifest.
- Same-Station evidence cannot satisfy a future cross-Station/Relay claim.
- Cross-Station scope stays visible in product, architecture, and Acceptance
  documents as deferred and unproven.
