# Mobile Shell — 架构设计

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-27 | **Updated**: 2026-09-09
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
| Station selection/access gates and signed peer-ID handshake are implemented | verified_fact | `features/auth/`, `features/station/`, `station.rs`, W1 evidence | high | physical native OAuth evidence |
| Friend/group projection runtimes exist | verified_fact | `features/social/`, `features/group/` | high | lifecycle/performance evidence |
| Runtime registry is executable and lifecycle-owned | verified_fact | `app/lifecycle/MobileLifecycleKernel.ts`, `runtimes/runtimeRegistry.ts`, `mobile-simulator-runtime-lifecycle-e2e` | high | Station-bound and physical lifecycle proof |
| Navigation route identity is descriptor-owned | verified_fact | `app/navigation/navigationStore.ts`, `components/MobileShell.tsx`, focused navigation tests | high | remaining contact/moment/setting detail routes and native no-leak proof |
| Moments currently supports publish only | verified_fact | `MomentsPage.tsx` has no feed/reaction/comment projection | high | read-side runtime |
| Rust-owned OAuth coordinator and Station attempt/finalizer are implemented | verified_fact | `src-tauri/src/runtime/oauth/`, `apps/station/app/subserver/oauth/` | high | W2-E2 physical proof contracts and evidence |
| Mobile-facing auth/OAuth contracts use PTID-bearing `ActorRef`; legacy bridge numeric fields are reserved | verified_fact | `auth.proto`, `oauth.proto`, `mobile_oauth.proto`, W1 evidence | high | keep hard-cut scans green |
| Unknown writes do not survive uniformly | verified_fact | no common durable ledger or outcome lookup exists | high | durable command protocol |
| Prototype defines the confirmed target experience | verified_fact | confirmed core journey plus reviewed recovery/destructive-state screenshots and L3 audit | high | production acceptance is separate |

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
- An exact duplicate callback while completion outcome is unresolved resumes
  the same claimed attempt idempotently. A different callback after claim,
  post-terminal resubmission, provider mismatch, Station mismatch, stale
  generation, or duplicate Station consumption is a terminal typed failure.
- Cancellation deletes local verifier/nonce material and returns to the same
  Station access gate. Timeout expires both local and Station attempt state.
- Web pages can launch or cancel the flow and render projection state; they
  cannot inspect verifier, nonce, provider token, or raw callback secrets.

The state machine and current Model contract status are normative in
`data-model.md` §3.2. MS-P01..MS-P03 and MS-P07 are implemented; remaining
contract gaps stay explicit. This design does not authorize a protocol version
bump or new field numbering.

### 7.1 W2 Security Amendment

> **Status**: accepted on 2026-08-28.

The W2 implementation now uses the accepted credential-delivery and activation
boundary below. W2-E2 still requires physical proof of that implementation:

```text
mobile-web
  -> authRuntime projection and user intents only
  -> mobile-rust OAuth coordinator
       - PKCE verifier
       - nonce
       - attempt secret
       - credential-delivery private key
       - raw callback URL and authorization code
  -> Station OAuth service
       - provider exchange
       - Access Gate finalization
       - idempotent session creation
       - encrypted credential envelope
  -> mobile-rust secure session store
  -> public session projection to mobile-web
```

The following relationships are forbidden:

- Mobile Web must not receive the PKCE verifier, nonce, raw callback URL,
  authorization code, provider token, bearer token, refresh token, or
  credential-delivery private key.
- Native plugins must not exchange provider credentials or activate a Station
  session; they launch the browser and deliver OS callbacks to Mobile Rust.
- OAuth status must not mint or return a new bearer credential.
- A caller that knows attempt IDs but not the device-held attempt secret must
  not read, cancel, complete, or acknowledge an OAuth attempt.

### 7.2 Station Authorization Finalizer

Station owns one transactionally fenced authorization finalizer. It locks the
Access Attempt, OAuth Attempt, and session candidate in that order and then:

1. validates Station, device, lifecycle generation, attempt secret, candidate,
   and expiry bindings;
2. requires the Access Attempt to be in the final `granted` state;
3. rejects cancelled, denied, superseded, stale-generation, or expired rows;
4. creates at most one session identified by the OAuth candidate ID;
5. persists the Access Attempt, candidate, gate-decision revision, device, and
   Station bindings on that session;
6. creates one encrypted credential envelope for the device delivery key;
7. commits all rows before returning the envelope.

Retry after an uncertain response returns the same persisted envelope and
session identity. It never mints another session or credential. A separate
acknowledgement marks delivery complete and removes the recoverable envelope.
After acknowledgement, status returns state only.

Cancellation and finalization use the same lock order. Whichever transaction
commits first determines the terminal state. A cancellation that observes an
already-created session revokes it before reporting local completion.

### 7.3 Provider Authorization Boundary

The Station-owned `/oauth/authorize` surface is distinct from Mobile's external
provider redirect. It must derive actor PTID from an authenticated Station
subject and require explicit consent. Query parameters may identify the OAuth
client and requested scope, but must never assert actor identity.

Authorization-code redemption is a conditional one-row consume performed
before token creation. Zero affected rows means expired, revoked, mismatched, or
already consumed and fails closed.

### 7.4 Native Callback And Restart Recovery

Mobile Rust persists a single station-scoped attempt index in secure storage so
cold launch can recover the current attempt without Web module globals. The
record contains only binding metadata and device-held secrets; it is keyed by
`station_peer_id + device_id + lifecycle_generation`.

Warm and cold callbacks enter the same Rust coordinator. Before Station
completion, the coordinator revalidates the selected Station peer ID and
current lifecycle generation. Network failure after local callback validation
retains the encrypted attempt material and resumes the same Station attempt; it
does not re-consume the OS callback or create a second attempt.

Only one credential-producing action may be active for one Station/device/
generation. Email login, OAuth start, Station replacement, and logout are
serialized by the auth runtime. Station replacement or generation change
cancels the old attempt before another credential action starts.

### 7.5 Native Acceptance Control Boundary

Native Mobile Acceptance uses Appium 2 with XCUITest and UiAutomator2 drivers.
The driver switches into the application WebView context and calls the
acceptance-only `window.__PEERS_MOBILE_ACCEPTANCE__` registry. The registry is
compiled only when `VITE_ACCEPTANCE_HARNESS=1`; production builds expose no
control surface.

The Mobile Domain owns typed actions for Station add/replace, Access Gate
submission, OAuth start/status/cancel, lifecycle restart, OS deep-link
delivery, projection readback, and cleanup. Drivers may invoke production
actions through this registry but may not mutate stores, bypass Station, or
inject a successful business result.

Simulator/emulator cells prove build, launch, callback routing, and deterministic
failure cases. MS-AG03 remains `UNPROVEN` until physical iOS and Android devices
complete real GitHub and Google authorization with disposable approved accounts,
Station readback, source identity, screenshots/AX evidence, and cleanup audit.

### 7.6 W2-E2 Physical Proof Amendment

The accepted ownership, Fixture, Station proof, provider browser lease and
physical build provenance contracts are defined in
[`native-oauth-proof/`](./native-oauth-proof/README.md). W2-E2 execution still
follows the accepted focused plan at
[`execution-plans/20260829-mobile-native-oauth-proof.md`](./execution-plans/20260829-mobile-native-oauth-proof.md);
MS-AG03 remains unproven until physical evidence passes.

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
