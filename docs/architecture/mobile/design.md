# Mobile Shell — 架构设计

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-27 | **Updated**: 2026-08-27
> **Owner**: Mobile Architecture Team
> **Module**: `apps/mobile/`

---

## 1. Core Principles

1. **Station truth, Mobile projection**: shared business state is authoritative only after Station commit; Mobile caches and projects it.
2. **Lifecycle kernel before pages**: boot, Station, access, session, runtime, shell, background, and resume transitions have one owner.
3. **Runtime owns freshness**: pages render projections and dispatch commands; they do not install streams, polling, or mount-time truth refresh.
4. **Proto-first boundaries**: cross-runtime and cross-client semantics use generated contracts from `model/domain/`.
5. **Mobile-native presentation**: stack navigation, bottom sheets, safe-area and keyboard occlusion refine shared semantics.
6. **Fail closed**: unknown Station, access, session, trust, or write outcome
   never becomes an optimistic success claim.

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| Tauri v2 Mobile is the mainline | verified_fact | `docs/client/mobile/base.md`, `apps/mobile/src-tauri/` | high | none |
| Station selection/access gates exist; probe lacks stable identity | verified_fact | `App.tsx`, `features/auth/`, `features/station/`, `station.rs` | high | signed peer handshake + native E2E |
| Friend/group projection runtimes exist | verified_fact | `features/social/`, `features/group/` | high | lifecycle/performance evidence |
| Runtime registry is descriptive only | verified_fact | `runtimeRegistry.ts` contains status metadata, not lifecycle methods | high | executable kernel absent |
| Moments currently supports publish only | verified_fact | `MomentsPage.tsx` has no feed/reaction/comment projection | high | read-side runtime |
| OAuth coordinator is absent | verified_fact | deep-link event exists without provider authorization/session coordination | high | OAuth runtime and Station endpoints |
| Auth contracts expose legacy actor identifiers | verified_fact | `auth.proto`, `oauth.proto`, and `authSession.ts` expose numeric/legacy IDs | high | canonical PTID cutover |
| Unknown writes do not survive uniformly | verified_fact | no common durable ledger or outcome lookup exists | high | durable command protocol |
| Prototype defines intended experience | verified_fact | previously confirmed core journey plus seven reviewed recovery/destructive-state screenshots and L3 audit | high | Owner confirmation remains open; production acceptance is separate |

## 3. System Architecture

```text
Tauri Mobile App
  |
  +-- MobileLifecycleKernel
  |     app boot / Station / access / session / runtime / resume
  |
  +-- MobileNavigationHost
  |     primary tabs / stack details / overlays / focus restoration
  |
  +-- RuntimeRegistry
  |     stationRuntime
  |     authRuntime
  |     accessRuntime
  |     sessionRuntime
  |     commandRuntime
  |     socialRuntime
  |     groupRuntime
  |     momentsRuntime
  |     notificationRuntime
  |     profileRuntime
  |     settingsRuntime
  |     deviceSettingsRuntime
  |
  +-- Projection Stores
  |     generated proto contracts + device-local UI projections
  |
  +-- Mobile Platform Ports
        mobile-web -> mobile-rust -> native plugins
          secure storage / deep link / push / lifecycle / media
                                   |
                                   v
                                Station
                  access / identity / chat / social truth
```

## 4. Ownership

| Concern | Source of truth | Mutation authority | Mobile owner |
|---|---|---|---|
| Station target | URL registry is device-local; `station_peer_id` is Station-attested | `stationRuntime` selects; Station handshake attests | Station registry storage adapter |
| Access gate order and decision | Station | Station | `accessRuntime` projection |
| Login/OAuth attempt and pre-session secrets | Station + device secure storage | Station + `authRuntime` | `authRuntime` projection |
| Session credentials | Station-issued/revoked, device-held | Station; `sessionRuntime` requests rotation only | secure storage port |
| Durable pending commands | device-local reliability state | `commandRuntime` | Rust encrypted command store |
| Shell route and overlays | device local | navigation host | navigation store |
| Conversations/messages/groups | Station | Station APIs | social/group runtimes |
| Moments/posts/comments/reactions | Station | Station APIs | moments runtime |
| Profile/account preferences | Station | Station APIs | profile/settings runtimes |
| Device preferences | device local | `deviceSettingsRuntime` | client storage/native port |
| Push/deep-link payload | OS event only | native plugin | host adapter; never business store |

No page may own any row whose source of truth is Station.

### 4.1 Canonical actor identity

- Every Mobile boundary uses `ptid: string` as actor identity: generated Proto, Station API, SSE payload, Tauri command, deep-link handoff, cache partition, runtime command, projection key, and route parameter.
- Numeric `actor_id` is Station persistence detail only. Mobile must not parse, store, compare, route, or emit it, including when a legacy response still contains the field.
- During bounded migration, `ActorRef.ptid` is the only consumed identity; the target Mobile-facing generated identity is PTID-only. Missing PTID blocks session activation.
- `acct` and display names are labels, never lookup or authorization keys.
- Existing `AuthActorInfo.actor_id`, `OAuthBridgeResponse.actor_id_num`, and corresponding manual TypeScript fields are migration residue, not valid target-state inputs.
- Verified `station_peer_id` scopes OAuth, sessions, caches, and commands; URL is only a connection hint and peer-ID mismatch fails closed.

## 5. Runtime Contracts And Criticality

```ts
interface MobileRuntimeDescriptor {
  id: string;
  scope: 'app' | 'station' | 'session';
  dependsOn: readonly string[];
  uses: readonly string[];
  entryPolicy: 'pre-shell-gate' | 'shell-blocking' | 'degradable';
  bootstrapTimeoutMs: number;
  teardownTimeoutMs: number;
  install(context: MobileRuntimeContext): void;
  bootstrap(context: MobileRuntimeContext): Promise<RuntimeReadiness>;
  suspend(context: MobileRuntimeContext, reason: MobileSuspendReason): Promise<void>;
  resume(context: MobileRuntimeContext, reason: MobileResumeReason): Promise<void>;
  reconcile(context: MobileRuntimeContext, reason: MobileReconcileReason): Promise<void>;
  teardown(context: MobileRuntimeContext, reason: MobileTeardownReason): Promise<RuntimeTeardownResult>;
}

```

Requirements:

- Every context carries an immutable `generation` allocated by the lifecycle
  kernel. Runtime results and host events with a non-current generation are
  discarded before reducer access.
- Install/bootstrap/teardown are idempotent within one generation.
- Bootstrap follows topological dependency order; independent siblings may run
  concurrently. Suspend and teardown run in reverse dependency order.
- Missing `dependsOn` blocks bootstrap; unavailable `uses` capabilities are
  projected explicitly and do not block read-only owners.
- Session switch tears down old session runtimes before new bootstrap.
- A shell-blocking runtime timeout keeps the lifecycle in `runtime-critical`.
  A degradable runtime timeout produces a module-local unavailable projection
  and does not weaken session validity.
- Reconcile is deduplicated and bounded.
- Host events become typed wakeup intents; they do not mutate business stores.

`module-layout.md` is the single source for runtime IDs, scopes, dependencies,
entry policy, owned state, and timeout budgets.

`stationRuntime`, `authRuntime`, and `accessRuntime` run before admission.
`accessRuntime` requests credentials through typed `authRuntime` intents; it
never requires an active session. A login/OAuth response produced before later
gates finish remains an attempt-scoped session candidate in secure storage and
cannot authorize business calls. Only final access grant lets `sessionRuntime`
bind the PTID-bearing candidate. Shell entry then requires that session and a
ready navigation host. Degradable modules may show explicit unavailable states,
never prior-generation data.

## 6. Lifecycle, Navigation, And Teardown

`MobileLifecycleKernel` is the sole transition owner for the top-level state
model in `product-state-model.md`. React pages receive a projection and dispatch
intents; they do not set top-level launch state directly.

`MobileNavigationHost` owns:

- four primary tab descriptors;
- a stack of detail descriptors;
- one overlay host;
- tab-bar visibility derived from the active descriptor;
- focus and scroll restoration;
- route-to-visible evidence.

Primary tabs remain `on-visit + none` as established by the frontend component
tree contract. Promotion to LRU requires measured remount cost and a bounded
cache decision.

### 6.1 Generation-fenced transition

Station change, logout, revocation, and actor replacement use one externally
atomic transition:

1. Allocate a new generation and close command admission for the old one.
2. Hide old actor/session projections synchronously; no old data may remain
   readable by pages.
3. Abort inflight transport and stop runtime producers with a bounded deadline.
4. Clear actor/session caches; quarantine unresolved commands under their
   original Station/PTID scope.
5. Attempt remote revocation within its deadline, then delete local credentials.
6. Aggregate typed teardown failures and remain outside `shell`.
7. Bootstrap the new Station/access/session generation only after mandatory
   cleanup succeeds.

Timeout does not reopen the old generation. A timed-out runtime is force-detached
behind the generation fence and reported as a typed teardown failure. Failure to
delete secure credentials is shell-blocking: the lifecycle exposes retry/reset
and does not activate another actor. Remote revocation is bounded best-effort:
its failure is recorded as `remote-revocation-unconfirmed`, but local completion
is allowed only after credentials are unusable. No retry credential is retained.

## 7. OAuth Contract

OAuth is a Station-issued authentication flow coordinated by
`authRuntime`; the provider credential never becomes a Mobile business
credential.

Required semantics:

- Station owns attempt identity, provider/Station/redirect binding, PKCE
  challenge, nonce hash, expiry, opaque state, and atomic one-time consumption.
- Mobile keeps verifier and nonce in native secure storage and sends only
  challenge/hash material across the boundary.
- Native deep links carry an opaque callback. Rust/`authRuntime` validates
  scheme/host/path, current Station, local attempt/state/expiry, and generation
  before forwarding completion. Station atomically validates and consumes the
  attempt; Mobile cannot claim authoritative consumption.
- Callback replay, provider mismatch, Station mismatch, stale generation, and
  duplicate consumption are terminal typed failures.
- Cancellation deletes local verifier/nonce material and returns to the same
  Station access gate. Timeout expires both local and Station attempt state.
- Web pages can launch or cancel the flow and render projection state; they
  cannot inspect verifier, nonce, provider token, or raw callback secrets.

The state machine and Model gaps are normative in `data-model.md` §3.2. The
current bridge records are insufficient; this design does not authorize a
protocol version bump or field numbering.

## 8. Data And Command Flow

```text
User intent
  -> page dispatches typed command
  -> owning runtime admits work
  -> API gateway serializes generated proto
  -> Station validates and commits
  -> response/event updates projection reducer
  -> page re-renders exact store slice
  -> reconcile repairs missed events
```

Large media uses the existing encrypted media/data path and must not share an
unbounded queue with control commands.

### 8.1 Durable command and unknown-outcome protocol

Every retriable mutation uses one stable client-generated command ID. The
Rust-owned encrypted ledger is partitioned by `station_peer_id` and actor PTID;
its canonical typed envelope, bounds, ordering, migration, and admission rules
are defined in `data-model.md` §4.

- A timeout/disconnect after dispatch enters `unknown-outcome`.
- The runtime first queries command outcome by `command_id` or performs
  authoritative entity/event readback.
- Replay is allowed only when the Station contract guarantees idempotency for
  that same ID and readback proves no commit.
- If neither status lookup nor authoritative readback exists, the command stays
  unresolved and requires an explicit user decision; it is never silently
  replayed.
- Live callbacks must match the current generation. After process restart,
  unresolved records are eligible by exact `station_peer_id` + actor PTID, then
  rebound in memory to the new generation before reconciliation. Persisted
  origin generation is diagnostic only.

Existing conversation command IDs and idempotency keys are reused where their
Station result/readback semantics are complete. Other mutations must gain an
equivalent Model/Station contract before offline replay is enabled.
For Mobile Shell scope, this narrows the generic automatic replay language in `docs/client/mobile/sync-protocol.md`.

## 9. Operational Semantics

- Reads may use latest-wins cancellation.
- Writes follow the durable command protocol above.
- Ledger overload rejects new writes with a typed error; it never drops,
  overwrites, or silently evicts unresolved commands.
- Realtime reconnect uses bounded exponential backoff and cursor resume.
- Push marks projections stale and schedules targeted reconcile.
- Background pauses expensive streams; resume closes write admission, validates Station/session, reconciles required projections, then reopens writes.
- Logout/Station change cancels inflight work, tears down runtimes, clears
  actor/session scoped cache, then changes visible lifecycle state.
- Lists use cursor pagination and preserve scroll anchors.
- Errors are typed at runtime boundaries and translated to locale keys at UI.

## 10. Allowed And Forbidden Relationships

Allowed:

- Page -> navigation intent or owning runtime command.
- Runtime -> API gateway, generated contracts, projection store, platform port.
- Rust kernel -> native plugin capability.
- Host adapter -> typed runtime wakeup intent.

Forbidden:

- Page -> direct long-lived stream, polling timer, or authoritative fetch.
- Web UI -> Android/iOS SDK directly.
- Native plugin -> business projection mutation.
- Prototype `types.ts` -> production domain model.
- Local storage -> plaintext token or cross-device business truth.
- Mobile boundary/store/route -> numeric `actor_id` or invented actor aliases.
- Shell -> broad subscription to complete social/group stores.
- Group/Moments/notification/profile runtime -> second long-lived Station event stream beside the shared social ingress.
- Non-idempotent write -> silent retry after unknown outcome.
- Old runtime generation -> current projection reducer or command admission.
- OAuth Web UI/native plugin -> direct Station session mutation.

## 11. Architecture Quality Gates

`acceptance-matrix.md` defines normative MS-AG01..MS-AG11 runtime cells,
workloads, thresholds, attribution metrics, and evidence paths. Execution
planning must register the concrete Acceptance plan; missing native evidence
remains `UNPROVEN`.
