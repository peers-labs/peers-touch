# Mobile Shell — 架构设计

> **Status**: active; iOS simulator-canonical Acceptance amendment accepted
> **Version**: v1.3
> **Created**: 2026-08-27 | **Updated**: 2026-09-21
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
| Station selection/access gates and signed peer-ID handshake are implemented | verified_fact | `features/auth/`, `features/station/`, `station.rs`, W1 evidence | high | canonical simulator runtime proof |
| Friend/group projection runtimes exist | verified_fact | `features/social/`, `features/group/` | high | lifecycle/performance evidence |
| Runtime registry is executable and lifecycle-owned | verified_fact | `app/lifecycle/MobileLifecycleKernel.ts`, `runtimes/runtimeRegistry.ts`, `mobile-simulator-runtime-lifecycle-e2e` | high | Station-bound simulator lifecycle proof |
| Navigation route identity is descriptor-owned | verified_fact | `app/navigation/navigationStore.ts`, `components/MobileShell.tsx`, focused navigation and Harness tests | high | visible native focus/no-leak proof |
| Moments feed, publish, reaction, comment, and reply sources exist | verified_fact | `MomentsPage.tsx`, `features/social/momentsFeedStore.ts`, `pages/moments/` | high | two-actor simulator convergence and receiver proof |
| Social projection freshness has one session-scoped ingress owner | verified_fact | `runtimes/socialProjectionRuntime.ts`, `runtimes/socialEventIngress.ts`, `features/social/socialRuntime.ts`, focused runtime tests | high | authorized two-Station simulator convergence proof |
| Rust-owned OAuth coordinator and Station attempt/finalizer are implemented | verified_fact | `src-tauri/src/runtime/oauth/`, `apps/station/app/subserver/oauth/` | high | deterministic simulator callback/finalizer evidence |
| Mobile-facing auth/OAuth contracts use PTID-bearing `ActorRef`; legacy bridge numeric fields are reserved | verified_fact | `auth.proto`, `oauth.proto`, `mobile_oauth.proto`, W1 evidence | high | keep hard-cut scans green |
| Reliability v2 owns exact Station/PTID-scoped command and typed draft persistence, native install/scope keys, migration quarantine, reset recovery, and lifecycle fencing | verified_fact | `runtimes/commandRuntime.ts`, `src-tauri/src/runtime/reliability/`, `src-tauri/src/runtime/command_ledger/`, `src-tauri/src/runtime/draft_store/` | high | simulator recovery proof |
| Friend Request and Social relationship changes are generated non-Chat command families with stable identity and deterministic result types | verified_fact | `model/domain/social/relationship.proto`, Station Social command stores, Mobile reliability resolvers | high | simulator command/readback/checkpoint proof |
| Current Moment command requests have no complete durable result/readback contract | verified_fact | `model/domain/social/post.proto`, `comment.proto` | high | owning Model/Station contracts |
| Legacy session-secret-derived v1 persistence cannot be attributed safely after credential deletion or rotation | verified_fact | MS-D15 migration boundary and canonical v1 quarantine | high | retain fail-closed quarantine; never infer ownership |
| Generated scope-keyed v2 reliability persistence replaces the retired skeleton | accepted_decision | MS-D15, `data-model.md` §4-§5; Owner approval on 2026-09-11 | accepted | source complete; simulator recovery evidence pending |
| Prototype defines the confirmed target experience | verified_fact | confirmed core journey plus reviewed recovery/destructive-state screenshots and L3 audit | high | production acceptance is separate |
| Mobile hard-cut has zero executable legacy Group/Social callers | verified_fact | production scan over Mobile TypeScript and Rust; current hard-cut gate | high | keep zero-reference checks green |
| Conversation member update and owner transfer have one accepted authority contract | accepted_decision | AO-D10, `conversation_api.proto`, `command.proto` | accepted | Mobile consumer cutover and runtime proof |
| Social directional block has canonical generated mutation/list/status/result/event contracts and Mobile durable-command cutover | verified_fact | Social relationship authority, shared Federation delivery, `relationship.proto`, Mobile relationship resolver | high | same-Station simulator proof required now; cross-Station/Relay proof deferred |
| Generic Access Gate descriptors exist but generic schema-bound submission does not | verified_fact | `access_gate.proto`: `input_schema_json` versus fixed login/invite/session submit fields | high | Access Gate owner contract |
| Mobile Web business gateways currently receive and attach bearer credentials | verified_fact | `services/gateways/gatewayTypes.ts`, `momentsGateway.ts`, `momentMediaGateway.ts` | high | Rust-owned authenticated transport cutover |
| Native lifecycle, APNs/FCM/UnifiedPush registration ingress, scheduled-work completion, and media-picker staging are source-complete | verified_fact | native platform plugin, Rust push/media bridges, Notification registration service, W7 source checks | high | simulator platform proof; optional physical diagnostics |

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
| Conversation member role/mute/owner | Conversation authority | canonical Conversation member commands | group runtime through Device Messaging Engine |
| Directional actor block and relationship status | Social authority at actor Home Stations | Social relationship commands and federation | social runtime |
| Moments/posts/comments/reactions | Station | Station APIs | moments runtime |
| Profile and privacy fields | Actor Profile | Actor Profile API | profile runtime |
| Notification preferences and push registration | Notification | Notification APIs | notification runtime plus Rust push registrar |
| Device preferences | device local | `deviceSettingsRuntime` | client storage/native port |
| Push/deep-link payload | Notification/OS wakeup only | Notification + native plugin | host adapter; never business store |
| Native media selection | OS picker grant plus Rust-owned staging record | native picker plugin and Rust media staging | typed platform port |

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

The session-scoped `social` descriptor owns one Station realtime supervisor and
one bounded ingress for Social, Group, Moments, notification, and profile
projections. It preserves opaque Station cursors, resumes with
`Last-Event-ID`, routes Group as a subordinate projection, and owns targeted
reconciliation after overflow, reconnect, host wakeup, or resume. Data loss
marks only affected projections stale; control loss closes write admission and
requires session revalidation. Moments feed, Profile, and Notification
freshness remain alive with the runtime when their pages unmount.

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
boundary below. MS-D26 requires deterministic simulator proof of that
implementation; physical provider proof is optional diagnostics:

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
failure cases. Under MS-D26 they are the required MS-AG03 proof surface.
Physical iOS and Android devices may additionally exercise real GitHub and
Google authorization with disposable approved accounts, but that evidence is
optional diagnostics.

### 7.6 Optional W2-E2 Physical Diagnostics

The retained ownership, Fixture, Station proof, provider browser lease and
physical build provenance contracts for optional diagnostics are defined in
[`native-oauth-proof/`](./native-oauth-proof/README.md). W2-E2 execution still
follows its historical focused plan at
[`execution-plans/20260829-mobile-native-oauth-proof.md`](./execution-plans/20260829-mobile-native-oauth-proof.md);
it is excluded from required MS-AG03 completion by MS-D26.

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

### 8.2 W4 Reliability V2 Boundary

> **Status**: accepted and source-complete under MS-D15 on 2026-09-11. Station
> Social exposes the authenticated Friend Request command-result lookup, and
> Mobile implements the schema, resolver, lifecycle, migration, and recovery
> Harness. Required simulator proof remains `UNPROVEN`; physical native proof
> is optional diagnostics.

The target owner chain is:

```text
page intent
  -> owning domain runtime
  -> typed Rust signing port owned by Device Messaging Engine identity
  -> atomic exact-byte InteractionAdmission
  -> domain resolver
       -> exact-byte dispatch
       -> authoritative command-ID + payload-hash readback
       -> projection checkpoint
  -> row purge or visible terminal/unresolved recovery
```

The generated v2 command oneof has one member: `FriendRequestCommand`. Mobile
persists and dispatches the same signed bytes, command ID, and hash, then uses
Station's typed result lookup and the local projection checkpoint before row
disposition. No other production non-Chat write is a member. Chat and Group
remain exclusively owned by the Device Messaging Engine; Moment and other
Social relationship writes remain online-only or draft-only until their owners
provide complete generated command/result contracts.

Each oneof member requires an exhaustive Rust resolver. A string registry,
opaque payload, optional best-effort ledger call, or fallback to direct gateway
dispatch is forbidden. Admission failure is a real write-admission failure and
cannot be swallowed. `InteractionAdmission` must not load or copy actor-device
signing keys; for Friend Request it receives immutable signed bytes, ID, and
hash from the existing identity/signing owner.

Cancellation and dispatch race through one persisted compare-and-swap fence.
Cancellation may win only before `dispatch_fenced`; a crash or cancellation
after that point is an unknown outcome and requires authoritative readback.

Rust owns one install key-encryption key in native secure storage and one random
wrapped data-encryption key per exact Station/PTID scope. Separate command and
draft keys derive from the scope key. Session credentials authorize scope
activation but never derive persistence keys or cross into Web for that
purpose. Logout and Station replacement always quarantine unresolved commands;
they never silently discard them. Drafts independently require the accepted
retain/discard decision, and lifecycle stays outside the next Shell until that
decision and any requested deletion complete. The scope key is removable only
when no unresolved command or retained draft remains, or during explicitly
authorized whole-app reset.

Unscoped v1 databases are opaque legacy quarantine, not migration input. They
cannot be assigned to the current account, replayed, restored, or counted as
v2 capacity. A crash-recoverable manifest journals main/WAL/SHM relocation and
keeps admission closed across any partial state. Retaining the complete archive
keeps admission read-only; explicit legacy discard or whole-app local reset is
required to open a fresh v2 store. Cleanup can prove logical path/record/key
absence, not physical secure deletion on flash or snapshotting filesystems.

MS-D15 and `data-model.md` §4-§5 define the accepted states, retry ceiling,
retention checkpoint, draft membership, and quarantine actions.

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
- Web/page -> persistence key material, string command kind, or opaque durable payload.
- Best-effort ledger failure -> direct dispatch of a write represented as durable.
- V1 unscoped row -> inferred Station/PTID ownership or v2 replay.
- Old runtime generation -> current projection reducer or command admission.
- OAuth Web UI/native plugin -> direct Station session mutation.

## 11. Architecture Quality Gates

`acceptance-matrix.md` defines normative MS-AG01..MS-AG11 runtime cells,
workloads, thresholds, attribution metrics, and evidence paths. Execution
planning must register the concrete Acceptance plan; missing native evidence
remains `UNPROVEN`.

If MS-D15 is accepted, MS-AG04/MS-AG09/MS-AG10 must additionally prove:

- generated oneof exhaustiveness and zero production string/JSON durable
  payloads;
- one command ID and exact payload hash across signing-owner preparation,
  persistence, dispatch, result lookup, and projection checkpoint;
- terminal validation failures, an atomic cancel-versus-dispatch race,
  30-second dispatch and readback deadlines, post-fence unknown outcome,
  eight-attempt/domain-expiry limits, restart, and explicit unresolved/discard
  behavior;
- exact Station/PTID isolation through logout/re-authentication and a wrong-key
  failure before any row mutation;
- crash injection between every v1 main/WAL/SHM quarantine-journal step and
  every reset key/file step, with no replay, restore, or cross-scope visibility;
- committed-row purge only after authoritative result plus local projection
  checkpoint, with no Mobile audit-log duplication.

## 12. Accepted Owner-Contract Closure Amendment

> **Status**: accepted on 2026-09-18. This section authorizes execution
> planning, not implementation.

### 12.1 Scope Boundary

This amendment preserves required `MS-C01..MS-C10` and degraded `MS-C14`.
WeChat OAuth (`MS-C11`), voice/video calls (`MS-C12`), and Chat Docs
(`MS-C13`) remain excluded. A broader Chat architecture cannot activate those
Mobile capabilities without a separate PRODUCT amendment.

The target state has one owner for each business fact and one authenticated
native transport boundary. Mobile may cache, render, schedule, and recover, but
must not create compatibility authorities for missing Station contracts.

### 12.2 Generic Access Gate Submission

`AccessGate` remains a Station-authored descriptor. `gate_id`, `action_id`,
`type`, `submit_action`, and a canonical schema revision/digest identify the
exact action the client may render and submit. `input_schema_json` defines
presentation fields and validation hints; it is not executable code and cannot
name an arbitrary endpoint.

Submission uses one generated envelope:

- fixed high-risk actions remain typed oneof members: login, session restore,
  OAuth, invite code, and device trust;
- terms acceptance and custom forms use a schema-bound scalar field set whose
  names and primitive types must match the advertised schema exactly;
- every request binds attempt, gate, action, Station peer ID, device ID,
  lifecycle generation, schema revision/digest, and a stable submission ID;
- unknown fields, stale descriptors, action/type mismatches, and unsupported
  field kinds fail before mutation;
- secrets use typed native handles or dedicated actions and never enter a
  generic field bag.

The Station validates, executes, audits, and advances the gate. Mobile renders
the descriptor and submits user intent only. A successful action may produce
an attempt-scoped candidate, but only the Station authorization finalizer may
commit final access and activate a session. Unknown gate types remain
fail-closed and visibly unsupported.

### 12.3 Social Relationship And Block Authority

Social owns follow state, directional actor blocks, blocked-list projection,
and relationship status. Conversation, Notification, Secure Content, and
clients consume Social decisions; they do not persist a second block graph.

A block is a directional edge `actor_ptid -> target_ptid`, authoritative at the
actor's Home Station. Effective interaction denial is pair-wide when either
direction is blocked. The public contract exposes:

- idempotent block and unblock commands with stable command identity, payload
  hash, authenticated actor, target PTID, deadline, and revision;
- cursor-based listing of the authenticated actor's outgoing blocks;
- relationship projection containing follow directions, `blocked_by_viewer`,
  allowed actions, and a revision;
- command-result lookup and an ordered relationship event suitable for
  projection checkpointing and restart recovery.

Blocking atomically removes both follow directions visible to the pair,
invalidates pending relationship eligibility, emits revocation/invalidation
facts for dependent Social/Secure-Content projections, and prevents new
relationship, private-content, and conversation-entry actions. Unblock removes
only the caller's directional block and never restores follow edges, friendship,
content grants, or conversation eligibility implicitly.

For cross-Station actors, each Home Station enforces its local actor's
directional edge and consumes a signed, idempotent Federation relationship
event for the remote deny projection. Unavailable or stale remote policy fails
closed for new protected interactions. Read APIs do not disclose that the peer
blocked the viewer; they return a generic interaction-denied capability while
the viewer's own `blocked_by_viewer` state remains explicit.

### 12.4 Conversation Member Administration

AO-D10 is the accepted owner contract. Mobile must use only:

```text
POST /conversation/member/update
POST /conversation/ownership/transfer
```

Role, mute, optional `muted_until`, and owner transfer use the exact
`ConversationMemberAuthorityCommand`. Device Messaging Engine prepares and
submits deterministic command bytes. Group UI derives enabled actions from the
current Conversation authority projection and treats stale head/epoch errors
as reconcile-before-retry.

Owner transfer is one aggregate commit: the prior owner becomes admin, the new
owner becomes unmuted owner, the membership epoch advances once, and one event,
receipt, delivery set, Federation outbox, and follower snapshot commit
atomically. Mobile success requires matching command readback plus the resulting
member/owner projection. No `/group-chat/*` fallback, two-call transfer, or
client-side owner patch is permitted.

### 12.5 Chat Forward, Retract, Hide, And Moderation

The user-visible word "delete" must map to one explicit semantic:

- **Retract for everyone** uses the existing Conversation retract command. Only
  the original author may retract within policy; every entitled member receives
  the same tombstone event.
- **Delete for me** is an actor-scoped Conversation visibility command. It hides
  one message from that actor's devices, survives restart, and does not alter
  another member's projection or the ordered message fact.
- **Moderation remove** is a separate Conversation authority command for
  authorized group roles. It commits a shared moderation tombstone and audit
  fact without exposing E2EE plaintext.

Legacy friend/group delete routes cannot define any of these target semantics.
Until actor-hide and moderation contracts exist, the corresponding Mobile
actions remain unavailable rather than mapping to physical row deletion.

Forwarding is a new send into the destination Conversation, never a mutation of
the source. Device Messaging Engine snapshots the locally entitled content,
re-encrypts it for the destination endpoint set, re-authorizes referenced
encrypted objects, and may include bounded provenance only inside the
endpoint-encrypted destination payload. The destination command ID, hash,
event, and projection are the only completion truth. The source message ID is
not authority-visible routing data or a cross-conversation authorization token,
and Federation transport forwarding is unrelated to the user action.

All four actions use Conversation command-result resolution and ordered event
readback. No Mobile-only flag, optimistic row removal, or legacy Chat route may
claim shared completion.

### 12.6 Moments Policy And Media Production

Social owns feed membership and viewer-scoped policy explanation. Secure
Content owns private-content grants, ciphertext, and object authorization.
Mobile consumes typed projections and never re-derives visibility from follow,
block, Circle, or Group fields.

Feed and detail contracts must distinguish:

- genuinely empty;
- non-empty source with viewer-filtered results;
- policy-hidden object;
- deleted object;
- unavailable or stale projection.

Filtered summaries disclose only bounded counts/reason classes needed for the
state; they do not reveal hidden object identity, author, content, or block
direction. Missing or ambiguous explanation is unavailable, not guessed
deleted or empty.

Native media selection yields an opaque Rust staging handle, sanitized
metadata, content hash, and permission state. Rust copies or secures the
selected resource into app-owned storage before acknowledging completion.
Web never receives arbitrary filesystem paths or durable OS grants. Secure
Content encrypts before upload; Social accepts only committed object
descriptors. Cancel, permission downgrade, limited-photo revocation, process
death, submission failure, publish success, draft discard, and scope teardown
have explicit staging retention or cleanup outcomes.

### 12.7 Settings Ownership

Settings composes independent owners:

- Station policy, capability, and server configuration are Station-owned and
  read-only to Mobile; the saved Station registry and current selection remain
  device-local connection state;
- Actor Profile owns profile fields and the existing four privacy fields:
  default visibility, manual follower approval, message permission, and
  automatic expiry;
- Notification owns per-category enabled, push, and sound preferences plus
  registered push devices;
- this release has no additional account-preference fields, owner, runtime, or
  placeholder section; `ActorPreferences` is not a public API;
- `deviceSettingsRuntime` owns theme, font size, compact density, device-local
  language, cache controls, permission state, and app metadata;
- Social owns blocked users.

Actor Profile uses one dedicated monotonic `profile_revision` over editable
profile/privacy values in `touch_actor` and `touch_actor_meta`; counter-only
updates do not advance it. Notification uses one aggregate monotonic revision
and one atomic batch mutation for the complete category-preference snapshot.
Both owners require an exact non-zero observed revision and return typed
`APPLIED`, `UNCHANGED`, or `CONFLICT` outcomes with their canonical latest
snapshot. `CONFLICT` performs no write. Empty or invalid mutations fail before
write.

Each Settings detail saves only its selected owner and keeps independent dirty,
saving, saved, conflict, unavailable, and failed state. A lost mutation
response triggers owner readback before retry: exact draft equality confirms
commit, a newer divergent snapshot is conflict, and an unchanged base revision
permits explicit retry. Unavailable owner state disables that section without
substituting retained defaults. Device settings never imply cross-device sync,
and Station-owned settings never fall back to local persistence.

### 12.8 Native Authenticated Transport

Bearer and refresh credentials remain in Rust secure storage. Every
authenticated business request crosses a typed Web-to-Rust command; Rust:

1. resolves the active Station/PTID/generation scope;
2. verifies the pinned Station origin;
3. attaches the current access credential in memory;
4. enforces a generated operation allowlist, body and response bounds,
   redirect rejection, timeout, and cancellation;
5. retries authentication only through `sessionRuntime`;
6. returns generated public response data and typed errors without headers,
   cookies, or credentials.

This is not an arbitrary HTTP proxy. Domain gateways keep generated
serialization, while direct Web `fetch` with `Authorization`,
`MobileAuthSession.accessToken`, cookie credentials, or caller-selected
credential-bearing URLs are removed from the production target. Public,
unauthenticated same-origin resources may use a separate explicitly allowlisted
transport.

### 12.9 Push, Scheduled Wakeup, And Media Picker

Notification owns push-device registration and push policy. Native plugins own
APNs/FCM/UnifiedPush registration, token rotation, receipt, and tap callbacks;
Rust binds provider tokens to the active device and submits registration through
the authenticated transport. Tokens never enter Web state, logs, routes, or
business projections. Logout, actor switch, Station replacement, token
rotation, and permission revocation unregister or invalidate the old binding
without blocking unrelated business teardown indefinitely.

The registration API derives actor identity from the authenticated PTID and
requires the request device to equal the authenticated device assertion. APNs,
FCM, and UnifiedPush use typed mutually exclusive bindings, an explicit
development/production environment, stable request ID, app-install epoch
digest, and current Rust lifecycle generation. One active row exists per
actor/device/channel/environment. Exact replay is idempotent, request-ID/body
mismatch and cross-device provider reuse fail closed, and same-tuple rotation
atomically supersedes the old credential.

Provider bindings are write-only and encrypted at rest with AES-256-GCM under
a versioned Notification key derived from the Station deployment root secret.
Responses and readback contain only redacted registration metadata and a
Station-scoped HMAC fingerprint. Tokens, endpoints, provider encryption keys,
auth secrets, ciphertext, nonce, and plaintext credentials never enter Web
state, logs, errors, or public projections. A Station root-key change
invalidates existing registrations and requires native re-registration.

Native token, receipt, and tap callbacks carry a Rust-supplied lifecycle
generation and monotonic native sequence. Rust discards stale, duplicate,
expired, inactive-scope, Station/PTID/device-mismatched, or unsupported
callbacks before any Station or Web effect.

Push data is a bounded notification/wakeup envelope. It may identify a
notification, category, typed navigation hint, and timing, but cannot carry
title, body, credentials, private message/Moments content, decryption material,
authoritative read state, or authorization truth. Receipt marks the affected
projection stale. Tap activates the app, validates the current scope,
reconciles from Station, and only then navigates.

WorkManager and BGTaskScheduler own OS scheduling only. Registration uses one
versioned identifier per application/environment and replaces prior work
idempotently. A callback carries a native sequence and current Rust generation,
runs a bounded reconcile request, honors OS expiration/cancellation, and calls
the platform completion handler exactly once. The scheduler never dispatches a
business command, advances a cursor, or claims freshness.

The exact identifiers are
`com.peers.touch.mobile.reconcile.v1.development` and
`com.peers.touch.mobile.reconcile.v1.production`. Both platforms use a minimum
15-minute cadence and require network availability. Native completion IDs have
a 25-second deadline; success, failure, cancellation, expiration, and duplicate
acknowledgement race through one terminal guard.

Media-picker requests bind request ID, surface, capability, generation, and
deadline. Exactly one terminal result is emitted: selected staging handle,
cancelled, permission-required, expired, or failed. Late/duplicate results are
discarded. Picker dismissal does not synthesize a file, and backgrounding does
not transfer ownership away from Rust staging.

Native selection copies provider-owned content into app-private temporary files
and returns those paths only to Rust. Rust verifies regular-file status, MIME
and media kind, item count, aggregate size, byte length, SHA-256, generation,
deadline, and Station/PTID draft scope before moving bytes into
`native-media-staging/v1`. Web receives only opaque handles and metadata.
Native temporary files and partial Rust staging files are deleted on every
terminal failure.

### 12.10 Compatibility And Hard-Cut Rules

Allowed temporary compatibility:

- JSON field-name/enum normalization inside a declared gateway;
- generated wire-version decoding that immediately produces one canonical
  projection;
- read-only historical fixtures and documents explicitly classified as such.

Forbidden target paths:

- executable `/friend-chat/*` or `/group-chat/*` business calls;
- alias endpoints, fallback retries, or dual writes to retired owners;
- direct Web credential attachment;
- manual public DTOs duplicating generated domain contracts;
- client-derived block, gate, message-delete, or Moments visibility truth;
- a second stream, scheduler, command ledger, media store, or settings owner.

The hard cut is atomic per owner contract: canonical producer, consumer,
projection, readback, focused checks, and rollback boundary are ready before
the retired caller is deleted in the same change. The current production
inventory is exactly two Group callers and four Social callers; closure requires
zero executable production references.

A repository-wide semantic audit classifies every remaining textual reference
as generated compatibility commentary, test/fixture input, historical
documentation, or active executable use. Only the first three may remain, and
each must name its owner or historical status. A string-only zero result is not
proof when aliases or semantic duplicates still exist.

## 13. iOS Simulator-Canonical Acceptance

MS-D26 makes source-bound iOS Simulator the required Mobile runtime. The
simulator applications are production Mobile code built with the Acceptance
Harness enabled; the Harness exposes bounded production actions and sanitized
projections, never direct Store mutation or fabricated successful results.
Single-client assertions use one pinned iOS Simulator. Cross-session and
cross-actor assertions use two isolated iOS Simulators so the receiver boundary
remains real without requiring Android.

The required environment classes are:

- base dual-iOS simulator for launch, callback, runtime graph, platform,
  isolation, and cleanup;
- Station-lifecycle simulator for restore, revocation, Station switching,
  logout, scope isolation, and sequential same-account Settings readback;
- Direct simulator for two actors on one source-attested Station, with
  authoritative domain readback, recovery, Chat, Contacts, and Moments
  journeys.

The two-Station Social simulator and Relay remain a separate topology for
future cross-Station proof. MS-D27 excludes that topology from
`mobile-shell-20260827`; it must not block the current plan and same-Station
evidence must not be relabeled as cross-Station proof.

Required Gates remain scenario-specific. A broad simulator environment does not
allow one passing journey to prove unrelated product assertions. Every Gate
records source identity, runtime identity, client roles, receiver-side
readback, visible evidence where applicable, and deterministic cleanup.

Android Emulator, `mobile-native-*`, and `mobile-native.yaml` remain optional
diagnostics surfaces. They may report Android-specific or physical hardware
behavior but are excluded from Feature `required_gates`, Capability
`required_gates`, Registry `require` lists, the Mobile Acceptance Plan selected
Gates, Task closure contracts, and W8/W9 dependencies. Their result cannot
change required completion state.

This section supersedes earlier statements in this document that made physical
device or live provider evidence a required proof boundary. Those statements
continue to describe the optional diagnostic scope only.
