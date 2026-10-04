# Cross-Station Private Social - Architecture Design

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-10-03 | **Updated**: 2026-10-03
> **Owner**: Social / Federation

---

## 1. Core Principles

1. **Social remains authoritative.** The author's Home Station owns canonical
   Post, Comment, Reaction, audience, and lifecycle truth.
2. **Federation transports opaque domain payloads.** It owns authentication,
   durable retry, ordering, deduplication, and dispatch, but no Social policy.
3. **Every remote projection is viewer-scoped.** One frame targets one actor and
   contains no co-recipient identities or envelopes.
4. **Clients keep plaintext.** Both Stations persist ciphertext, proofs,
   descriptors, and minimum routing metadata only.
5. **Remote writes return to source.** A recipient Home Station never becomes
   authoritative for a remote Post or interaction.
6. **Platform claims are runtime-specific.** Tauri Native Desktop is required;
   Mobile is deferred; browser-gateway Social is prohibited.

## 2. Architecture Applicability Review

| Case | Trigger | Owner | Disposition | Integration contract | No parallel truth | Required evidence |
|---|---|---|---|---|---|---|
| `AAR-C01` Shared Domain Contract | Cross-runtime Social, Federation, and Key Exchange messages | Model owners for Social, Federation, Key Exchange, and Secure Content | `adapted` | Extend canonical proto roots and import Secure Content types; regenerate all scoped consumers from one source generation. | No hand-written wire DTO, duplicate enum, compatibility reader, or second generator. | Generator check, generated parity test, and `social-cross-station-contract`. |
| `AAR-C02` Global Context / Runtime | Projection spans pages, login sessions, actor/Station switches, and background recovery | Desktop GlobalContext for lifecycle; `momentsRuntime` for Social freshness | `adapted` | GlobalContext emits actor/session/Station lifecycle; `momentsRuntime` bootstraps, reconciles, and tears down the scoped projection. | Pages, stores, and feature-private listeners never own long-lived freshness or lifecycle truth. | Runtime unit tests plus Native hidden-page, logout, actor-switch, and Station-switch receiver evidence. |
| `AAR-C03` i18n | New pending, retry, unavailable, recovery, denial, and validation states | Shared locale packages and Desktop error presenter | `reused` | Add matching `moments` / `errors` keys to every supported locale and map typed errors through the existing resolver. | No React, Rust, or Go human-readable product error becomes a second copy source. | Locale parity check, error-mapping tests, and Native visible-state assertions. |
| `AAR-C04` API / Handler Ownership | New peer routes, Social commands, and typed receiver handlers | Key Exchange owns PreKey routes; Social owns business commands; Federation owns peer transport | `adapted` | Register canonical capability IDs, proto request/response types, route owners, middleware, and typed receiver dispatch. | No Social transport, Federation business authorization, alias route, or duplicate handler owner. | API ownership Gate, route inventory tests, and wrong-owner negative tests. |
| `AAR-C05` Event / Realtime Notification | Committed Social changes refresh hidden or unopened Desktop surfaces | Station event stream, Rust host adapter, Desktop kernel EventBus, then `momentsRuntime` | `adapted` | Publish typed wake metadata only after commit; bridge once into the kernel catalog; reconcile gaps from Station truth. | No payload-bearing event truth, direct Tauri-to-store mutation, module-private stream, or page-owned polling. | `social-cross-station-eventbus-contract` and Native hidden-page, duplicate, reorder, gap, and teardown proof. |
| `AAR-C06` Storage / Cache | Receiver projection, encrypted local projection, recovery, and purge | Source Social for canonical rows; receiver Social for rebuildable projection; Desktop unified storage for local cache | `adapted` | Separate canonical/projection tables, actor-scoped encrypted local roots, monotonic tombstones, bounded purge, and source-authorized rebuild. | Cache never becomes business truth; recipient Social never becomes remote canonical authority. | Migration/repository tests, restart/recovery proof, purge assertions, and stale-delivery non-resurrection evidence. |
| `AAR-C07` UI Foundation | Existing Moments UI gains remote states and Native-only registration | Existing Moments UI and shared UI packages | `reused` | Reuse LobeUI/theme/icons/navigation/feedback and existing Social page structure; add only required state rendering. | No duplicate component system, Browser fallback surface, or second Moments page. | Desktop type/tests, source registration scan, and Native user-visible assertions. |
| `AAR-C08` Identity / Security / Privacy | Cross-Station trust, credentials, private payloads, grants, and revocation | Federation authentication, Key Exchange keys, Social authorization, Native key custody | `reused` | Authenticate Station peers, verify actor/device/resource bindings, use one-time PreKeys, and keep plaintext/content keys client-only. | No Station decryption, copied key pool, public object URL, client direct-remote call, or co-recipient disclosure. | Tamper/target/signature/grant negatives, database/log plaintext scan, and receiver-scoped envelope proof. |
| `AAR-C09` Logging / Metrics / Errors | Durable retry, replay, reconcile, rejection, recovery, and latency claims | Federation and Social operation owners; Desktop runtime for client transitions | `adapted` | Preserve trace context, typed error codes, bounded labels, retry/replay/reject/resync counters, and latency histograms at owner boundaries. | Logs and metrics are observations only; they cannot become delivery state or expose payload, actor lists, keys, or secrets. | Deterministic metric/error tests plus exact-source runtime artifacts linking trace, disposition, retry, and visible state. |
| `AAR-C10` Acceptance | New cross-Station journeys and negative guarantees | Acceptance Framework with Social Capability, Feature, Gate, and Evidence owners | `adapted` | Register fail-closed Social gates, one reusable two-Station Native Suite Runtime, receiver-visible assertions, and exact-source evidence. | Harness/API checks cannot substitute for Native UI evidence; missing/stale evidence remains `UNPROVEN`. | Plan/domain validation, runtime-reuse audit, Social focused Gates, gap audit, and immutable cleanup-complete reports. |

No baseline case is `not_applicable`: this change crosses shared contracts, global lifecycle, user-visible UI, persistence, trust boundaries, background delivery, and product Acceptance. Domain-specific Federation, Secure Content, Key Exchange, and Social authority candidates are defined below.

## 3. Target Topology

```text
Alice Native Desktop
  | local encrypt/decrypt
  v
Station A
  Social source authority
  +-- audience snapshot
  +-- private resource UOW
  +-- Federation outbox port
  +-- object ciphertext authority
  |
  | authenticated durable Federation delivery / peer route
  v
Station B
  Federation inbox
  +-- Social typed receiver
  +-- Bob viewer-scoped ciphertext projection
  +-- local delivery/reconcile state
  |
  v
Bob Native Desktop
  local proof verification + decrypt + recovery
```

No Desktop connects directly to a remote Station. No private Social payload
enters Federation Ledger.

## 4. Sources Of Truth

| Concern | Owner | Stored truth |
|---|---|---|
| Post/Comment/Reaction lifecycle | author Home Station Social | canonical domain rows and revisions |
| Audience authorization | source Social | immutable publish snapshot plus current revoke facts |
| Endpoint/recovery Content PreKeys | recipient Home Station Key Exchange | one-time pools and exact replay receipts |
| Durable cross-Station movement | Federation | signed frame, outbox/inbox, disposition, ordering |
| Remote viewer projection | recipient Home Station Social | rebuildable actor-scoped ciphertext projection |
| Large encrypted objects | source Social object authority | ciphertext, descriptor, grants, range state |
| Plaintext and content keys | Native client | encrypted local store and active memory only |
| Product freshness | Native Desktop `momentsRuntime` | event consumption plus periodic reconcile |

### 4.1 Desktop Event And Projection Contract

This section is the canonical Social freshness contract. Plans, Tasks, and review prompts may repeat it for execution emphasis but cannot redefine it.

```text
committed Social fact -> Station event stream -> Rust host adapter -> Desktop typed event bus -> momentsRuntime -> projection stores
```

- Only committed facts publish wake events. Payloads carry identity, scope, revision/cursor, and dedup metadata, never private content objects.
- GlobalContext owns identity, session, and Station lifecycle signals. `momentsRuntime` consumes them for bootstrap, reconcile, and complete actor-scoped teardown; it does not create a parallel global context.
- `momentsRuntime` is the only long-lived Post, Comment, Reaction, revocation, and resync projection owner. Pages render projection and dispatch commands; page mount, polling, or private Tauri listeners cannot own freshness.
- Immediate typed wake and Station-backed periodic reconcile are both required. Duplicate/reordered events are idempotent; cursor gaps trigger reconcile.
- Subscriptions are scoped to actor/session/Station and are removed on logout, identity switch, Station switch, runtime teardown, and test cleanup.

## 5. Publish Lifecycle

```text
select audience
  -> source Social freezes actor/device/recovery targets and locality
  -> local Key Exchange claims local Content PreKeys
  -> Federation-authenticated peer request claims remote Content PreKeys
  -> Native Desktop encrypts one canonical resource
  -> source Social atomically commits:
       canonical resource
       local delivery intents
       one Federation outbox frame per remote actor
  -> receiver Federation verifies/authenticates/deduplicates
  -> receiver Social atomically commits inbox receipt + viewer projection
  -> Bob Desktop verifies source proof and decrypts
```

### 5.1 Admission

- Every recipient must resolve to one canonical ActorRef and Home Station.
- All Home Stations must belong to the same active Federation selected by the
  source operation.
- `GROUP` uses the Conversation-owned snapshot and submit fence from `SC-D29`.
  That snapshot binds the canonical Federation ID, Conversation ID, membership
  epoch, authority head, ordered active members, and member Home Stations.
- Source Social revalidates the Group snapshot and Federation membership at
  prepare and submit. Same-Federation remote Group members are admitted through
  the same remote PreKey and viewer-scoped delivery path as other audiences;
  Social does not query remote Conversation services or copy membership truth.
- Required endpoint and recovery slots are frozen before encryption.
- Any unresolved identity, missing required PreKey, cross-Federation recipient,
  unsupported audience, or size-limit breach rejects the whole publish.
- Consumed one-time keys may be abandoned after failure; recipient sets may
  never be silently reduced.

### 5.2 Remote Content PreKey Claim

The canonical Content PreKey types remain in
`model/domain/secure_content/prekey.proto`. Key Exchange-owned peer wrappers
live in `model/domain/key_exchange/key_exchange.proto`.

The target Key Exchange authority binds exact replay to:

```text
(source_station_peer_id, target_station_peer_id, plan_id,
 plan_request_sha256)
```

The same tuple returns identical claims. Reusing the identity with another hash
is terminal. Federation membership and target Station are verified before any
claim is returned.

### 5.2.1 Remote Submit Validation

`CSS-D10` defines a second Key Exchange peer operation for read-only
submit-time validation. Source Social sends each remote Station partition's
exact persisted claim request and response with deterministic digests. The
recipient Key Exchange verifies the authenticated Station pair, active
Federation membership, exact claim receipt, current endpoint profiles, and
current recovery epochs without consuming or rotating key material.

Remote validation completes before the source Social transaction begins. Local
claims remain fenced inside that transaction. Each target validation
transaction has a separate per-partition linearization point, and its response
carries evidence of successful completion. There is no global multi-Station
snapshot. Lifecycle changes completed after a partition's validation point use
normal receiver rejection, tombstone, and source invalidation semantics. No
cross-Station lock or distributed transaction is implied.

Claim replay and validation remain separate contracts. Replay recovers the same
irreversibly consumed keys after an unknown outcome; validation proves that
those exact claims are current at submit time.

### 5.3 Source Commit

The Social UOW uses the shared Federation outbox repository as a
transaction-scoped port. Canonical resource rows and every required remote
frame either commit together or do not commit. There is no post-commit
best-effort fan-out step.

## 6. Delivery And Read

### 6.1 Frame Shape

Each durable frame carries exactly one target actor's:

- encrypted payload;
- endpoint and recovery envelopes;
- encrypted object descriptors;
- source resource identity and monotonic lifecycle revision;
- audience explanation safe for that viewer;
- source commit proof and retained proof-key attestation.

The frame does not carry plaintext, content keys, co-recipient identities,
large object bytes, or business authorization decisions.

### 6.2 Receiver Commit

Federation authenticates the source Station and validates frame bounds before
dispatch. The Social receiver then verifies:

- target Station and target actor;
- payload hash and canonical domain message;
- active Federation scope;
- source proof and resource binding;
- monotonic lifecycle revision;
- envelope principal and object descriptor binding.

Inbox receipt and Social projection mutation commit in one receiver
transaction. Duplicate delivery is a no-op. Same identity with another hash is
terminal.

### 6.3 Object Read

Large object bytes remain at the source Social object authority.

```text
Bob Desktop
  -> Station B Social checks Bob's imported projection
  -> Station B Federation opens a target-bound peer stream
  -> Station A Social revalidates source resource + actor grant + object/range
  -> ciphertext range returns through Station B
  -> Bob Desktop verifies descriptor/hash and decrypts locally
```

The peer capability binds source resource, target actor/device, object ID,
range, expiry, and Federation identity. A capability cannot be replayed for
another object, actor, or range.

## 7. Remote Interaction Lifecycle

Private Comment uses the existing prepare/submit split across the source
authority:

```text
Bob Desktop -> Station B Social durable PREPARE command
  -> Station A Social revalidates parent and creates encryption plan
  -> typed result returns to Bob
  -> Bob encrypts Comment locally
  -> Station B Social durable SUBMIT command
  -> Station A Social commits canonical Comment + recipient deliveries
```

Reaction and unreaction use typed mutation commands without a plaintext
payload. Every command has one immutable command ID and canonical request hash.
The source returns exact replay results; hash conflict is terminal.

Unknown outcomes remain pending and retry with the same command ID. Comment
draft text stays on Bob's Native Desktop.

## 8. Revocation And Recovery

### 8.1 Revocation

Delete, friendship loss, audience loss, device revoke, and block produce a
monotonic source lifecycle revision. The source emits one viewer-scoped
invalidation per affected remote actor.

Receiver behavior:

- locally known block may suppress immediately;
- a tombstone fences every lower or equal delivery revision;
- stale delivery cannot resurrect content;
- feed, detail, Comment, object, and recovery reads share the same denial;
- ordinary local ciphertext/cache is purged without claiming deletion of
  exported or maliciously retained plaintext.

### 8.2 Recovery

The recipient projection retains the actor recovery envelope, source commit
proof, and required retained-key attestation. After trusted recovery, a
replacement Native Desktop can decrypt authorized never-opened history without
the author being online. Revoked devices, expired Federation membership, or a
higher invalidation revision remain denied.

## 9. Native Desktop Boundary

The supported runtime is:

```text
Tauri product window
  -> embedded React Social surface
  -> Tauri command boundary
  -> Desktop Rust Secure Content runtime
```

The embedded React surface is part of Native Desktop. The browser-gateway shell
is a separate runtime and must not register:

- Moments pages or routes;
- `momentsRuntime`;
- Social navigation entries;
- public or private Social actions.

Registration is controlled by an explicit host capability/policy at boot. It
must not rely on a page-level warning after the route has already been exposed.

### 9.1 Shared Client And Operability Contracts

- User-visible states and typed errors use the existing i18n namespace/key pipeline; no React or Rust human-readable literals are introduced.
- Existing Moments and shared UI primitives remain authoritative for theme, icons, feedback, navigation, and interaction patterns.
- Desktop encrypted projection/cache paths use the unified storage owner and participate in actor-scoped cleanup and recovery; cache never becomes truth.
- Background delivery and recovery preserve trace context and expose bounded, owner-attributable retry, rejection, replay, resync, and latency metrics.

## 10. Failure Semantics

| Failure | Result |
|---|---|
| remote identity or PreKey unavailable before commit | preserve draft; no Post or partial audience |
| source committed, receiver unavailable | one durable delivery remains pending/retrying |
| duplicate frame | one projection; duplicate disposition |
| hash conflict, wrong target, or untrusted source | terminal rejection; no Social mutation |
| source unavailable during object/interaction request | existing verified content may remain readable; new operation is retryable |
| parent deleted or authorization revoked | interaction terminally rejected |
| stale delivery after invalidation | tombstone wins |
| missing recovery material | explicit recovery state; no plaintext fallback |
| Browser route attempt | no registered Social route or action |

## 11. Forbidden Relationships

- Social must not implement another network transport or outbox/inbox stack.
- Federation must not authorize Social reads or mutations.
- Recipient Social must not authoritatively write a remote resource.
- Secure Content must not become a Social business authority.
- Station must not decrypt private Social content.
- Client must not call a remote Station directly.
- Large object bytes must not enter durable Federation frames.
- Private Social facts must not enter Federation Ledger.
- Mobile implementation must not be added under this plan.
