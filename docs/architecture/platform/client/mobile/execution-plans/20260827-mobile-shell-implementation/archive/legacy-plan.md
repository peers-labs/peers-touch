# Mobile Shell — Execution Plan

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-08-27 | **Updated**: 2026-09-16
> **Owner**: Mobile Architecture Team
> **Branch**: merge-desktop-prototype
> **Workspace ID**: b0a926025d2b25b9
> **Initial HEAD**: 3d4e858ce0c8e28969e01a736e2b238269aedb3b
> **Expected HEAD**: 771605c8d768ea3ef73a1b9b1a63befae354292f
> **Worktree-set Digest**: dd236dffde8c55a0f8782bf017ea33196a65bfecd8f70cd8652cc5e183d444eb
> **Expected HEAD**: 771605c8d768ea3ef73a1b9b1a63befae354292f
> **Worktree-set digest**: dd236dffde8c55a0f8782bf017ea33196a65bfecd8f70cd8652cc5e183d444eb

---

## 1. Objective

Deliver the accepted Mobile Shell product contract through the Tauri v2 Mobile
mainline without introducing a second identity, runtime, sync, command, or
business-state authority.

The completed system must:

- enter a challenge-verified Station through the Station-owned Access Gate;
- activate only a PTID-bearing session after final access grant;
- render Chat, Moments, Contacts, and Me from runtime-owned projections;
- preserve drafts and uncertain commands across interruption and restart;
- switch Station, actor, background state, and revoked sessions without leaking
  prior-generation data;
- pass every `MS-PA01..MS-PA27` assertion through `MS-AG01..MS-AG11`.

Owner acceptance of PRODUCT, Prototype, architecture, `MS-D01..MS-D11`,
Frontend Runtime `D-17`, and Social Runtime `D-08` was recorded on 2026-08-27.

## 2. Accepted Sources

Product:

- `docs/architecture/platform/client/mobile/product-definition.md`
- `docs/architecture/platform/client/mobile/experience-contract.md`
- `docs/architecture/platform/client/mobile/product-state-model.md`
- `docs/architecture/platform/client/mobile/product-feasibility.md`
- `docs/architecture/platform/client/mobile/acceptance-matrix.md`
- `docs/architecture/platform/client/mobile/prototype/README.md`

Architecture:

- `docs/architecture/platform/client/mobile/design.md`
- `docs/architecture/platform/client/mobile/decisions.md`
- `docs/architecture/platform/client/mobile/data-model.md`
- `docs/architecture/platform/client/mobile/integration.md`
- `docs/architecture/platform/client/mobile/module-layout.md`
- `docs/architecture/domains/identity/unified-actor-system.md`
- `docs/architecture/platform/client/frontend-runtime/`
- `docs/architecture/domains/social/runtime/`
- `docs/architecture/platform/station/access/station-access-gate-architecture.md`
- `docs/architecture/platform/runtime/service-coordination.md`
- `docs/architecture/engineering/api-governance/`
- `docs/architecture/engineering/api-governance/execution-plans/20260906-conversation-authority-hard-cut.md`
- `docs/client/mobile/`
- `docs/client/common/ui-identity/frontend-component-tree-registry.md`

## 3. Scope And Non-Scope

### In Scope

- `MS-C01..MS-C10` required capability closure.
- `MS-C14` explicit device-local message flag.
- `MS-P01..MS-P08` contract closure without an unauthorized version bump.
- Repository-wide `ActorRef` PTID hard cut across Model, Station, Desktop
  Rust/TypeScript, Mobile Web/Rust, and all generated consumers.
- Mobile lifecycle, navigation, runtime registry, projection, native-port, and
  persistence cutovers.
- Required Station and Model changes for identity, handshake, OAuth, settings,
  command outcomes, and product readback.
- iOS and Android native runtime evidence.
- Atomic removal of replaced lifecycle, route, DTO, stream, outbox, and
  component-local persistence paths.
- Acceptance automation and evidence for `MS-PA01..MS-PA27`.
- Accepted Conversation DDD, resource-owned API, single Chat entry point, and shared
  Federation hard cut required to make W9-D truthful.

### Non-Scope

- Enabling WeChat OAuth, voice/video calls, or Chat Docs (`MS-C11..MS-C13`).
- Making local message flags cross-device.
- Station Dashboard administration.
- Replacing accepted Frontend Runtime, Social Runtime, Access Gate, or
  federation architecture.
- Bumping a protocol, schema, dependency, package, framework, or document
  version without separate Owner approval.
- Treating browser Prototype evidence as native production acceptance.

## 4. Architecture Traceability

| Plan requirement | Product IDs | Architecture source | Decision / invariant | Required evidence |
|---|---|---|---|---|
| Verified Station scope | MS-C01, MS-J01, MS-J06, MS-PA01, MS-PA16, MS-PA25 | `data-model.md` MS-P07 | MS-D10 | MS-AG01, MS-AG02 |
| Repository-wide PTID-only ActorRef hard cut | MS-C02, MS-J01, MS-J02, MS-PA02, MS-PA04, MS-PA05 | `identity/unified-actor-system.md` plus `data-model.md` MS-P01 | MS-D06; Proto-first; Station-internal numeric identity only | Model generation; Station tests; Desktop check/tests; Mobile check; identity zero-reference Gate; MS-AG01, MS-AG02, MS-AG05 |
| OAuth through Access Gate | MS-C03, MS-J01, MS-PA03, MS-PA25 | `data-model.md` MS-P02, MS-P03 | MS-D05 | MS-AG03 |
| Lifecycle/runtime graph | MS-C04, MS-C10, MS-J02, MS-J06, MS-J07 | `design.md` §§5–6 | MS-D01, MS-D02, MS-D09 | MS-AG02, MS-AG05 |
| Descriptor navigation | MS-C04, MS-J03..MS-J06 | `module-layout.md` | MS-D03, MS-D04 | MS-AG07, MS-AG08, MS-AG11 |
| Generated domain gateways | MS-C05..MS-C09 | `data-model.md` §§2–3, §6 | MS-D07 | MS-AG01, MS-AG06 |
| Durable command convergence | Initial v2: MS-C07, MS-J04, MS-PA09, MS-PA19; shared recovery: MS-C10, MS-PA26 | `data-model.md` MS-P04, MS-P06 | MS-D08; accepted MS-D15; Frontend D-17; Social D-08 | MS-AG04, MS-AG09, MS-AG10; one `mobile-native-recovery-e2e` run must join the same Friend Request ID/hash to authoritative Station relationship readback |
| Durable local drafts | MS-C05, MS-C08, MS-PA23 | `data-model.md` MS-P08 | single Rust persistence owner | MS-AG05, MS-AG10 |
| Complete settings | MS-C09, MS-PA12, MS-PA21 | `data-model.md` MS-P05 | Station/account vs device ownership | MS-AG06, MS-AG10 |
| Honest deferred/degraded UX | MS-C11..MS-C14, MS-PA22, MS-PA27 | Product contract + confirmed Prototype | UI Identity | MS-AG08, MS-AG11 |

## 5. Current-State Inventory

| Concern | Current asset | Current state | Target disposition |
|---|---|---|---|
| Top-level lifecycle | `apps/mobile/src/App.tsx` | Component effects coordinate Station, session, gates, and Shell | Replace with `MobileLifecycleKernel`; App renders projection |
| Shell navigation | `apps/mobile/src/components/MobileShell.tsx` | Tab switch plus store-owned detail identity | Introduce descriptor host; remove route ownership from stores |
| Runtime registry | `apps/mobile/src/runtimes/runtimeRegistry.ts` | Descriptive status records only | Replace with executable descriptors and validated DAG |
| Friend/social runtime | `apps/mobile/src/features/social/` | Real projection, SSE, presence, typing, reconcile | Adapt under shared Social supervisor and generated gateways |
| Group runtime | `apps/mobile/src/features/group/` | Separate projection/E2EE runtime | Keep domain owner; consume shared event ingress |
| Chat surface | `apps/mobile/src/pages/ChatPage.tsx` | Large coupled list/thread/composer/settings component | Split by accepted page/detail/overlay boundaries |
| Moments | `apps/mobile/src/pages/MomentsPage.tsx` | Publish/upload path without complete feed runtime | Add Station-backed feed/detail/comment/reaction projection |
| Settings | `apps/mobile/src/pages/SettingsPage.tsx` | Minimal session/Station/block surface | Add Me shell and selected-only account/device details |
| Identity | `authSession.ts`, auth/OAuth Proto | Legacy numeric/alias fields still accepted | PTID-only target; fail closed when PTID is absent |
| Global ActorRef consumers | `model/domain/actor/actor.proto` plus 27 non-generated consumers across Desktop, Station, and Model | `ActorRef.actor_id` remains live; Desktop session/identity paths still consume numeric identity | One repository-wide PTID cutover closure; no Mobile-only hard cut |
| Station registry | `features/station/`, `commands/station.rs` | URL reachability and label | Pin signed `station_peer_id`; URL remains hint |
| OAuth | native deep-link event + bridge Proto | No bound attempt/PKCE/consume lifecycle | Add Station attempt and `authRuntime` closure |
| Native secure storage | `src-tauri/platform/secure_storage/` | iOS implementation; other targets unsupported | Complete Android and deterministic failure behavior |
| Durable commands | Messaging Core owns Chat/Group command/outbox semantics; Mobile reliability v2 owns only generated non-Chat members | Friend Request uses one signed command ID/hash through exact-scope admission, dispatch, authoritative readback, projection checkpoint, and row disposition; v1 files are quarantined without attribution | Keep Chat/Group in Device Messaging Engine; add another non-Chat member only after its owner provides a generated idempotent command/result contract |
| Drafts | Generated Station/PTID-scoped Chat/Moment v2 envelopes in the Rust draft store | Native install KEK and wrapped scope DEKs protect typed drafts; scope exit requires an immutable retain/discard decision and crash-resumable cleanup | Preserve explicit recovery semantics and obtain physical restart/UI proof without claiming secure erase |
| Acceptance | `tooling/acceptance/domains/mobile.yaml` plus Mobile Capability/Feature/Registry/Gate contracts | Domain injection is active; structural/static coverage exists; native recovery and receiver proof remain partial or unproven | Keep contracts source-bound; complete only the runtime cells and product assertions their evidence actually exercises |

## 6. Dependency DAG

```text
W-1 Latest-master and worktree isolation preflight
  |
  v
W0 Mobile Acceptance Domain onboarding and baseline
  |
  v
W1 Unified ActorRef identity and Station trust
  |
  +--> W2 Access Gate and OAuth
  +--> W3 Lifecycle, runtime graph, and navigation
  +--> W4 InteractionAdmission, command ledger, and draft store

AO-D01..AO-D06 + MP-D30 + Social D-07 --> CA-HC Conversation Authority hard cut
MP-W09 Phase 2 core ownership ----------> CA-HC
W3 + W4 + CA-HC -----------------------> W5 Generated gateway and Social projection convergence

W2 + W5 + CA-HC --> W6A Chat, Contacts, and Group product closure
W2 + W5 --> W6B Moments product closure
W2 + W5 --> W6C Profile and Settings product closure
W3 + W4 + W5 --> W6D Recovery and degraded-state closure

W2 + W3 + W4 + W5 --> W7 Native lifecycle and platform closure

CA-HC + W6A + W6B + W6C + W6D + W7 --> W8 Atomic old-path deletion
W0..W8 --> W9 Native Acceptance and readiness audit

DWF-B Development Workflow D13 self-hosting
  -> package/parser/session/Skill proof
  -> atomic migration of this plan
  -> resume W6A from its unchanged product frontier
```

Parallelization:

- No implementation work starts before W-1 and W0 pass.
- DWF-B is the current plan-maintenance closure. It serializes plan-state
  ownership only; it does not satisfy or weaken any Mobile product dependency.
- W2, W3, and W4 may proceed in parallel after W1 contracts are generated.
- MP-W09 Phase 2 must move OpenMLS protocol/state-machine ownership into
  `packages/messaging-core/` before the Mobile adapter can close.
- MP-W09 Phase 4 may proceed in parallel with non-Chat W5 gateway work after
  the shared core contract is complete.
- Station domain implementations inside W2/W4 may proceed in parallel with
  Mobile kernel work in W3 after their Proto contracts stabilize.
- W6B and W6C may run in parallel after W5 establishes one
  gateway/event/admission pattern. W6A remains blocked until CA-HC also completes.
- W6D may build its UI projections in parallel but cannot close before W3, W4,
  and W5 expose lifecycle, durable-state, and reconcile inputs.
- iOS and Android adapters in W7 may run in parallel against the same Rust port
  and Fixture contract; W7 cannot close before W5 proves shared event ingress.

### 6.1 iOS-First Functional Delivery Track

The execution order now prioritizes a usable iOS product before broad
cross-platform evidence aggregation. This is an execution decomposition of the
already accepted `MS-C01..MS-C10` and `MS-C14` product scope; it does not defer
or remove any required Mobile capability.

Completion states are separate:

- `IOS_SOURCE_COMPLETE`: every required iOS production path exists, every
  visible control is backed by its declared owner or is truthfully unavailable,
  and the iOS app builds, installs, launches, enters a Station, and exercises
  the implemented journeys without mock business APIs.
- `IOS_RUNTIME_PROVEN`: `IOS_SOURCE_COMPLETE` plus the required iOS simulator
  and physical-device evidence.
- `MOBILE_PRODUCTION_READY`: the existing §13 Gate, including Android. An iOS
  milestone must never be reported as full Mobile readiness.

Current iOS implementation ledger:

| ID | Product slice | Current state | Source completion required |
|---|---|---|---|
| IOS-I0 | Tauri iOS host, build, install, launch | source complete; integrated post-merge package installed and launched on both retained iOS simulators | Section 6.2 records matching executable hashes and retained database presence; physical signing/device proof remains separate |
| IOS-I1 | Station selection, Access Gate, Email/OAuth entry | Mobile-owned source frontier complete; generic-gate design boundary open | Station removal is confirmed, login controls follow exact Station advertisement, unsupported gate kinds fail closed, and the `peers-touch` callback scheme is present; `IOS_SOURCE_COMPLETE` still requires generic terms/device/custom submission and finalization semantics from the Access Gate owner |
| IOS-I2 | Shell lifecycle, runtime graph, navigation | source complete; Station-bound simulator proven | Preserve descriptor ownership and active-tab lifetime while feature surfaces are completed |
| IOS-I3 | Chat and advanced message work | partial / summary and attachment source verified; integrated package installed | Section 6.2 records 56 indexed-search cases, request/member/search prototype evidence, and the opaque/private MIME fix with 165 Rust tests. Both current-package clients select the deterministic Station/PTID profile, open the same retained Direct, and return equivalent empty-history summaries. Their receiver path is not proven: Alice is fenced by Actor Identity continuity, Bob by the Inbox head, and missing-key recovery remains downstream. Original request resolution, safe key recovery, active-history memory bounds, and native delivery remain open. |
| IOS-I4 | Contacts and Group work | partial / request pagination and traversable list source verified; owner contracts parked | Complete declared request pages and bounded contact/group/member selections pass source/component checks. Native receiver proof and six current Group/Social owner contracts remain open. |
| IOS-I5 | Moments participation | current-schema Mobile-owned source frontier complete; schema/producer boundaries open | Selected-post authoritative detail, inline comments, image-only publication, partial upload recovery, and truthful unavailable/deleted/hidden states are implemented; restored encrypted-media preview requires a descriptor-bearing draft schema and policy-hidden explanation requires its Station producer |
| IOS-I6 | Profile and Settings | owner-backed Mobile source frontier complete; Station preference contracts open | Authoritative profile edit/readback, real Group/Moments counts, native app version, local cache clearing, permissions, language, Station change, logout, and truthful unavailable states are implemented; account notification/privacy and blocked-user surfaces wait on canonical Station contracts |
| IOS-I7 | iOS device integration and recovery | dependency-ready source complete; native design boundaries open | iOS network observation, permission fidelity, limited-photo handling, lifecycle fencing, and acceptance-only synthetic injection are implemented; APNs/token/tap ownership, BGTaskScheduler policy, and native media-picker result lifecycle remain undefined |
| IOS-I8 | Atomic cutover and iOS runtime proof | blocked | Delete the six current retired callers after owner contracts land; then run the iOS simulator and physical-device journeys |

Current delivery forecast:

- The dependency-ready iOS implementation batch is complete as of 2026-09-11.
  That batch closed its inventoried actions, not every Mobile-owned source
  action. The native communication run in section 6.2 subsequently reopened
  Chat, Contacts, Auth, and lifecycle recovery defects. It supersedes the
  earlier exhausted-frontier wording without changing the formal proof ratio.
- `IOS_SOURCE_COMPLETE` is forecast at **D+3 to D+5 focused working days after**
  the Access Gate, Conversation/Group/Social, encrypted-media draft, APNs/tap,
  BGTaskScheduler, and native media-picker contracts are accepted and available
  to this worktree.
- iOS simulator product closure is forecast at **D+1 to D+2 working days after
  `IOS_SOURCE_COMPLETE`**.
- Physical `IOS_RUNTIME_PROVEN` is forecast at **D+1 to D+2 working days after**
  the required signed devices, Appium endpoint, and approved provider accounts
  are available.
- Until those inputs have dates, a fixed calendar completion date would be
  fabricated. Progress reports must show the iOS source frontier separately
  from the formal workstream ratio; the formal ratio must not be used as an
  implementation percentage.

Implementation-first order:

```text
Batch A: IOS-I1 + IOS-I3 + IOS-I5 + IOS-I6 Mobile-owned product gaps
  |
  +--> Batch B: IOS-I7 source-authorized native gaps
  |
  +--> Owner lane: IOS-I4 Group/Social contracts + CA-W6/CA-W7
  |
  v
IOS-I8 hard cut -> iOS simulator closure -> physical iOS closure
```

Execution policy:

- Implement all dependency-ready production behavior in coherent batches.
- Run focused unit/type/build checks after each batch.
- Do not rerun the full Acceptance aggregate until a functional batch closes or
  an external owner/resource boundary changes.
- Track implementation, simulator evidence, physical iOS evidence, and full
  Mobile readiness as four distinct measures.

Current Batch A concurrency decision:

- **Chat lane** owns `ChatPage.tsx`, Chat command/projection adapters, Social
  and Group message-action store methods, focused tests, and Chat-specific CSS.
- **Moments lane** owns the Moments page/components, Moments draft hook/store,
  and focused tests; it must not edit shared CSS or locale catalogs.
- **Entry lane** owns `StationSelector`, `AccessGateHost`, their contract types,
  and focused tests.
- **Settings lane** owns `SettingsPage`, settings sections/controller, and
  focused tests; it must not invent missing profile or blocked-user authority.
- **iOS native lane** owns the Apple project inputs, iOS plugin, Rust native
  bridge registration, TypeScript native-event bridge, and focused native
  tests.
- The integrator owns this plan, shared locale catalogs, generated artifacts,
  final reconciliation, iOS build/run, and any cross-lane type repair.
- All lanes must preserve the current dirty worktree, re-read each owned file
  before patching, and stop rather than overwrite an unexpected concurrent
  change.

### 6.2 Two-iOS Communication Development Check

The Owner requested two installed Mobile simulator clients visibly communicating
on 2026-09-12. W6A / MS-PA06 already define the Direct-message journey.
Development diagnosis of that implemented path is ready; it does not close W5,
replace W9-D's iOS/Android two-Station cell, or waive its hard-cut prerequisite.

- **Current action**: Git-server integration, 43-skill refresh, D-20 adaptation,
  focused provisioning maintenance, the Mobile attachment MIME correction,
  request/member/search-state prototype source/render synchronization, and the
  bounded post-sync admission diagnosis are complete for this batch. Runtime
  evidence now classifies Alice's enrollment failure as an Actor Identity
  continuity conflict and Bob's Inbox failure as an item-not-head cursor
  conflict. Neither has a source-authorized Mobile recovery. The next native
  communication action requires changed owner evidence for identity-preserving
  admission, generation-aware Inbox recovery, original command result, and
  retained-key recovery. Recompute the queue when those inputs change; do not
  silently retry, reset a cursor, replace a key, or infer recovery.
- **Last native checkpoint**: the post-sync instrumentation-only
  `aarch64-sim` package built successfully and is installed on both retained
  simulators. Both executable hashes match
  `33169bb5922658f54c30d82144ff684243ae437365604e38e983cfcc9f147047`;
  strict signing verification passes. iOS migrated both data-container paths,
  while each exact retained profile-database filename set and reliability
  directory remained present. Both apps launched with those retained artifacts
  and initially rendered sign-in recovery.
  The previous package `index-rt2ztENX.js` supplied the earlier empty-history
  native summary observation; it is not fresh query proof for this new package.
  The last attempted enrollment/Inbox calls returned 409 on Station
  `68417f9f19bf`, with empty protobuf error bodies. The subsequently observed
  Station `09a6897e3d4b` contains no relevant owner-source delta; no new login,
  request, or message was attempted. Authoritative admission, original command
  result, and identity-preserving retained-key recovery remain parked.
  Source-backed worker-health/credential-fence diagnosis resumes only with new
  distinguishing evidence. General history paging/retention and fresh-request
  Fixture semantics still require their recorded decisions. Preserve the
  original unresolved Friend Request; no fresh ledger read occurred because
  Reliability did not activate. No text delivery or receiver restart-history
  proof exists.
- **Runtime scope**: two native Tauri WKWebViews with separate simulator app
  containers, Keychains, device identities, and Appium/WDA ports. Begin with one
  approved remote development Station to isolate client delivery; cross-Station
  and Android proof remain separate, unproven obligations.
- **Authority**: use the existing profile via process-local
  `PT_DEV_PROFILE_FILE`; do not create an aggregate environment profile, reset
  Station data, deploy a service, or claim fresh destructive authorization from
  a cached profile variable. Use only existing development accounts.
- **Concurrency decision**: hybrid, with serial runtime integration because
  both clients share the Station and Xcode/Appium resource pool. The integrator
  exclusively owns runtime allocation, all source/test writes, and this plan.
  Both read-only runtime explorers and the disjoint prototype writer are
  complete. The writer returned only `packages/prototypes/mobile/chat/src/**`
  changes for the already-recorded Federation/Direct/recovery samples.
  Prototype reconciliation and runtime checks are serial. One read-only
  explorer completed the Federation Fixture/Contact-to-Message inventory.
  The next continuation confirms both listed lanes are finished at the backend
  despite stale running labels. The new read-only lifecycle/recovery port
  inventory is also complete and reconciled. No active subagent remains.
  Source regression, prototype layout correction, and final integration ran
  serially under the integrator after that inventory. The integrator owns all
  production source, tests, builds, native/browser resources, shared files,
  documentation, and final reconciliation. Protected CA, Core, Station
  Conversation, and generated Chat sources remain read-only.
- **Observations required**: exact app/source identities, different actor and
  device identities, sender submission, matching receiver-visible message text,
  reply in the opposite direction, and persisted receiver history after restart.
  Launch screenshots alone do not prove communication.
- **Cleanup/handoff**: close the owned automation sessions and server; retain
  installed apps and their development conversations for the Owner to inspect.
  Never erase either simulator or another account's data.
- **Status**: in progress; no bidirectional communication result yet.
- **Build correction**: a fresh package timestamp previously hid a stale
  simulator Rust archive and embedded Web UI. The build script now compiles the
  exact simulator target before copying its archive. Nine iOS Python regressions
  pass, and both installed apps were observed loading the current Web asset.
  The earlier launch-only observation does not prove current-source features.
- **Completed remediation**: Chat uses a stable typing selector and explicit
  render-error recovery. Debug native Messaging permits only the profile-derived
  `PT_MOBILE_DEV_STATION_ORIGIN`, injected at simulator launch through
  `SIMCTL_CHILD_PT_MOBILE_DEV_STATION_ORIGIN`; release still requires HTTPS.
  Cold bootstrap now reconciles launch state through the lifecycle kernel,
  removing a competing React transition. Twenty focused lifecycle/selector tests
  pass; the earlier full Mobile run passed 223 tests before the latest additions.
- **Completed search remediation**: generated Actor and resolver contracts
  preserve `ref.ptid` and explicit Proto JSON names, and reject invalid identity
  responses. Federation routing is a separate Station-owned projection; handles
  are not Federation IDs. Account/latest-request fencing prevents stale search
  publication. The focused tests and both installed native apps verify this.
- **Evidence**: `debug-mobile-chat-startup.md` records React error 185 and native
  origin rejection on both clients. The iOS source frontier is therefore open;
  earlier exhausted-frontier statements are superseded for these defects.
- **Runtime prerequisite diagnosis**: `chat-native-disposable` has no joined
  Federation; `four` has one active local Federation but rejects the new Mobile
  device enrollment with HTTP 409. Preserve its existing identity state.
  Continue on the original disposable Station with a non-destructive local
  development Federation created through the existing authenticated governance
  API. Reuse it if present; do not join remote Stations, reset data, replace
  identity keys, or deploy services. This is development resource setup, not
  W9-D Fixture proof.
- **Search correction evidence**: 240 Mobile tests, TypeScript, the exact-target
  iOS build, and strict code-sign validation pass. Both installed apps now show
  Bob and the Station-projected local Federation. Existing accepted requests are
  incorrectly labeled Sent; this Mobile presentation defect is ready for repair.
- **Prototype debt**: the added Federation choice and no-membership state are
  `UNSYNCED` in `packages/prototypes/mobile/chat`; sync follows the functional
  communication run. This does not count as prototype parity or final readiness.
- **Current native evidence**: both original-Station devices are enrolled.
  Find People reads back `Mobile Development`, Federation
  `fed_01M292PSHJY2XESH3NAHYJ5XVY`. Alice's single Send Request created command
  `01M293WKX2PA3B40PKJFBD298Z` and request `01M293WKX26HVQSJPQET59D3NA`.
  Its native ledger is `UNRESOLVED/TRANSPORT` after one attempt; Bob has no
  visible request. Read-only exact-command diagnosis is ready. Preserve the ID
  and use authoritative recovery before any resubmission.
- **Recovered diagnosis**: the production Check Status action receives HTTP 404
  from `/api/v1/social/friend-request/result`. Station restarted externally
  during diagnosis and revoked existing sessions; this worktree did not deploy
  or reset it. Exact-command recovery is parked until the deployed owner
  supports the existing result contract. Never bypass the durable owner.
- **Implemented contact repair**: MS-J04 accepted relationships now populate
  Contacts independently of conversation history. Pending states retain their
  direction, and Open Chat calls native `messaging_create_direct` with an
  accepted Federation. One unambiguous scope is automatic; multiple accepted
  scopes require explicit choice. Account replacement and missing conversation
  projection prevent navigation. Accept/Reject do not invent terminal state;
  Send inspects the native ledger and fences concurrent duplicate intent.
  Native accepted-contact and Direct-opening proof remains outstanding.
- **Interaction regression**: an accepted relationship remains a visible
  contact without message history; it is not labeled Sent. Open Chat shows
  pending/failure feedback, consumes the Station-returned conversation ID, and
  cannot navigate into a replaced account. An uncertain Friend Request retains
  its native command and exposes recovery instead of admitting a duplicate.
- **Latest source/package evidence**: 254 tests across 46 files and the Web
  type check pass. The exact-target iOS build and strict code-sign verification
  pass; the bundle is installed on both existing simulators without clearing
  their data. The last correction contains a missing Profile gateway inside
  Find People's action-local error boundary. Native post-fix proof is pending.
- **Live service observation**: `/app-meta/version` now reports
  `040912bcabad`, replacing the earlier `8d798aa8e494` deployment. Both clients
  present the sign-in gate. This worktree performed neither deployment nor reset.
- **Admitted recovery remediation**: fresh login reaches granted Shell on both
  clients, but the Auth-owned `session-expired` recovery flag remains visible.
  Clear only that flag after an authoritative final grant with an active session;
  retain pending/denied and unrelated recovery states. W3/W6D already require
  this recovery transition. Add focused regressions and native before/after
  evidence. Investigate failed/dependency-skipped descriptor recovery through
  the existing lifecycle owner; do not weaken dependencies to hide failure.
- **Exact Messaging failure**: Station logs identify
  `POST /device/inbox/claim` returning 500 with
  `delivery.claim: device: is not active for the authenticated actor`.
  Native enrollment-cache truth and Station device truth disagree following
  external service changes. Preserve identity and keys; no Station reset,
  deployment, or device replacement is admitted.
- **Lifecycle recovery admission**: W3/W6D resume currently ignores failed
  descriptors and their never-started dependents. After generation fencing,
  resume must use the existing reverse teardown and topological rebuild path
  when the graph contains failed entries. Incomplete teardown remains blocking;
  a continuing service failure remains visibly unavailable. Expose the existing
  lifecycle restart as Retry for failed capabilities rather than an endless
  startup spinner. Preserve all healthy-path suspend/resume behavior and
  retained command/draft state. Optional-dependency redesign is not included.
- **Recovery batch source evidence**: 269 tests across 48 files, Web type/wire
  checks, and diff hygiene pass. The nine Auth regressions cover final grant,
  pending/denied access, missing session, candidate admission, independent
  recovery, and atomic publication. Three lifecycle regressions cover ordered
  rebootstrap, persistent failure, and incomplete cleanup; three UI regressions
  cover failure versus startup and disabled retry. The failed-feature recovery
  refinement is `UNSYNCED` in the prototype; native verification and the existing
  W3/W6D Gate regression injection remain outstanding.
- **Native recovery observations**: both installed apps load
  `index-IAUkrFuF.js`. Granted restore no longer retains the expired-session
  notice. Alice's production Retry rebuilt the graph at generation 1, and a
  real iOS background/foreground cycle rebuilt it again at generation 2.
  Persistent Station claim failure remains unavailable rather than successful.
  Bob's missing-gateway search stays within its sheet without App Recovery.
- **Admitted route-state correction**: the Shell currently ignores each route's
  declared `ownerRuntimeId` and renders empty Chat/Contacts even when Social
  never started. Use existing descriptor readiness at the Shell render boundary,
  preserving tab/back navigation and lifecycle-owned Retry. Unavailable search
  must report runtime unavailability, not incorrectly demand login. These are
  MS-J03/MS-J04 unavailable states, not new product behavior.
- **Route-state source result**: `MobileRouteBoundary` consumes the existing
  descriptor owner, hides never-started domain content, preserves navigation,
  and leaves retry with the lifecycle owner. Auth-owned Settings stays available
  when Social fails. Search gateway absence now reports runtime unavailability.
  Six additional route-boundary tests pass; this refinement remains `UNSYNCED`
  in the prototype until its unavailable-state sample is updated.
- **Final route bundle observation**: both native WebViews load
  `index-PCcCe1s-.js`; the exact-target build, strict signing, install, and
  launch passed. The latest suite has 275 tests across 49 files. Cold restore
  shows unavailable Chat and lifecycle-owned Retry on both clients. Station
  now reports `07351dcf4f28`; fresh login still receives the device-claim 500.
  This worktree did not deploy, reset, or replace either device identity.
- **Fresh-login readiness admission**: the installed bundle confirms that an
  asynchronous session-transition failure reports an error but leaves the
  descriptor ready. Consequently the route boundary cannot distinguish
  ready service from failed activation after login. W3/W6D and `design.md` section
  5 already require generation-bound runtime readiness. Diagnose and connect
  that output to the lifecycle owner, retaining topological dependencies,
  teardown ownership, pending access isolation, and stale-generation rejection.
  Do not introduce a page-owned retry or automatic reload workaround.
- **Async readiness result**: the kernel now keeps readiness separate from
  live resource status, derives dependency availability, fences context/task
  revisions, and bounds readiness waiters. The existing hard dependency order
  also applies to queued session activation, preventing Group from reconciling
  before Social binds. All 293 Mobile tests and Web checks pass. Both installed
  `index-DiZWFoj4.js` clients verify readiness publication; Bob's normal
  logout/login renders unavailable Chat instead of empty data. The final
  dependency-ordered package built and installed as `index-B9F4jCzH.js` (Bob
  asset readback verified; Alice readback was pending). An external Station
  restart interrupted login verification. These observations do not prove
  message delivery or close W3/W6A/W6D formal runtime obligations.
- **2026-09-12 continuation**: immutable binding reverified. All 294 Mobile
  tests across 51 files and Web type/wire/runtime-boundary checks pass,
  including explicit graph-incarnation fencing when factories reuse descriptor
  objects. Runtime tasks compare the admitted Station/PTID/credential scope
  using the same semantic key as their subscriptions. This source is newer
  than `index-B9F4jCzH.js` and requires packaging/readback. Station
  `/app-meta/version` is reachable again on `43f94f5ef083`; this is service
  presence, not proof that retained devices or the original request recover.
- **Current native package evidence**: `index-C1EaFrGr.js` is built, strictly
  signature-verified, installed, and read back from both WKWebViews. Both normal
  Email Login journeys clear expired-session recovery, then show unavailable
  Chat and lifecycle Retry after Messaging HTTP 500. Alice's Retry rebuilds the
  graph; Bob can open Me and About. Trace `1789170916832..1789170917257` shows
  dependent failures following Messaging, not Group racing Social activation.
  Native status confirms both original profile/device IDs remain unchanged,
  with lane sequence and conversation count still zero. No message was sent.
- **Owner handoff: Device Inbox error mapping**: read-only source diagnosis
  identifies `application/delivery/errors.go`'s `DEVICE_INBOX_UNAUTHORIZED`
  and `production_http.go:mapProductionConversationError`, which only extracts
  `conversation/domain.Error` and therefore falls through to HTTP 500.
  Live Station logs again show `delivery.claim: device: is not active for the
  authenticated actor`. `peers-group-chat` owns the error-boundary correction,
  typed non-success regression, and retained-device recovery proof. Mobile's
  existing shared enrollment owner recognizes inactive-endpoint/403, not a
  generic 500. Do not reinterpret all 500s, regenerate keys, or replace devices.
- **Owner handoff: Friend Request result**: the deployed result route must
  resolve command `01M293WKX2PA3B40PKJFBD298Z` before any resubmission.
  The earlier `UNRESOLVED/TRANSPORT/attempt=1` ledger observation remains the
  last decoded result. The current Reliability runtime is inactive behind
  Messaging failure; its zero counters are not proof that the retained row
  disappeared. No replacement request or cleanup was performed.
- **Native journey wiring inventory**: the existing `_create_direct` omits
  receiver Home Station/Federation and assumes acceptance automatically creates
  Direct; `create_direct_explicitly` also omits Federation. Group creation omits
  Federation. The recovery journey derives a synthetic Federation ID without
  an authoritative membership binding. Next source work must bind an actual
  Fixture-owned Federation, use production Contact-to-Message, and add strict
  action-input regressions. Do not make the fake session tolerate missing
  production inputs or execute these cells against the current development data.
- **Fixture design boundary**: the read-only explorer confirmed that current
  Mobile actor fixtures export no Federation. The shared Chat friendship helper
  both creates membership and pre-accepts relationships, and skips same-Station
  pairs; it cannot prove a fresh request. Federation-only setup, actor/Station
  binding output, and reverse cleanup need an explicit Fixture contract before
  that dependent journey rewrite. Park this action as
  `DESIGN_AMENDMENT_REQUIRED`; retain W5 and physical-device prerequisites.
- **Independent Harness adapter**: W6A may expose
  `social.contact.open` as a typed adapter to the existing
  `dispatchOpenContactChat(peerPtid, federationId)` production command. Require
  final session admission, validate both inputs, return only the projected
  conversation ID, and propagate preparation/failure. The adapter is now
  registered in the Mobile Harness and Social simulator inventory, with a
  closed native-parent response validator. The frozen OAuth inventory remains
  unchanged; native product-scenario admission stays behind W5. This is an
  operation adapter, not a new UI workflow, automatic navigation, Fixture
  binding, or proof of the full Contact-to-Message journey. The integrator owns
  these coupled Mobile Harness/contract/validator/tests serially.
- **Acceptance mapping correction**: mode `COMPLETE`, Domain `mobile`,
  W3/W6D/W6A. Registry rules, Mobile Feature/Capability instances, and the
  Domain-local static regression are business injection, not Infra. Planner run
  `20260912T001439316624Z-0c234ec0f76eb76f13cad0c5d48ef0a4` selects zero Features
  or Gates for `MobileRouteBoundary.tsx`, `runtimeSessionTransition.ts`, and
  `messagingRuntime.ts`. The existing lifecycle/social mappings and synthetic
  paths now include these owners. Seven real-planner subcases failed before
  the fix and pass afterward. Post-fix plan run
  `20260912T002318840199Z-c8516a1e0069bec1b879e1bfd8f992dc` selects five Mobile
  Features and eleven existing Gates. Required native receiver Gates remain
  mandatory and unrun.
- **Verification checkpoint**: 298 Mobile tests across 51 files, Web checks,
  135 native/simulator preflight tests, and three Mobile contract tests pass.
  The Acceptance-enabled Web build compiles the new adapter into an isolated
  ignored output; it is not installed native proof. The installed development
  package remains `index-C1EaFrGr.js`. Domain validation explicitly rejects the
  old aggregate's stale source digest; no report was relabeled or evidence
  check bypassed. Gap Detector keeps the communication claim `UNPROVEN`.
- **Static-check exception is not a pass**: the final normal
  `check:mobile-shell-contracts` run fails on retained Auth debug collector
  instrumentation (`Web OAuth fetch`). The broad fetch assertion and the
  `[OPEN]` instrumentation are both preserved. No new OAuth authority was
  added; debugger cleanup still requires explicit authorization.
- **Resumed owner-contract check**: Station now reports `4ca50a1b0088`,
  built at `2026-09-12T00:48:51Z`. Exact-source inspection confirms the
  Device Inbox error-mapping defect remains. The unauthenticated result-route
  presence probe still returns 404; it does not resolve the retained command.
  Live communication stays parked without another native rebuild or request.
  Independent lifecycle/recovery regression injection and prototype image
  verification remain ready.
- **Regression scope**: join the real lifecycle kernel, serialized
  session-transition helper, and Recovery projection in source tests. Assert
  pending/failure propagation, Auth availability, reverse teardown and ordered
  rebuild, persistent failure, incomplete teardown, and stale completion
  rejection. No native/Station data-plane substitute or new fault API is added.
  Existing native fault controls affect Friend Request dispatch/readback, not
  Messaging activation. Deterministic native activation-failure proof therefore
  remains behind an owner-approved repeatable trigger; the existing healthy
  lifecycle Gate assertions remain unchanged.
- **Earlier prototype checkpoint**: the disjoint writer is reconciled. The prototype
  build and documented L3 Federation/request/accepted-contact/Direct/retry
  interactions pass. L2 image capture remains unavailable, so the additions
  are not claimed visually synced, confirmed, or landed. See
  `docs/architecture/platform/client/mobile/prototype/README.md`.
- **Prototype visual remediation admitted**: local Playwright now captures
  the real Portal. Inspected images expose a 188px device at 554px Portal
  width and clipped Contact Info rows after Direct failure. Under the accepted
  UI layout contract, the integrator owns a bounded Portal responsive-layout
  correction (`packages/prototypes/portal/src/App.tsx` plus scoped CSS) and
  Mobile detail flex-sizing correction (`mobile/chat/src/mobilePrototype.css`).
  Existing page/overlay lifetimes, content, product semantics, and native
  implementation are unchanged. Rendered bounds, scroll reachability, focus,
  and screenshots must be rechecked before any visual-sync claim.
- **Regression result**: six real-kernel/session/recovery integration cases
  cover restart and resume success, persistent failure, incomplete teardown,
  dependency projection, and stale context rejection. Two Harness regressions
  prove restart acknowledgement is separate from observed readiness and keeps
  sanitized immutable failure snapshots. Full Mobile Vitest passes 306 tests
  in 51 files; the named lifecycle script passes 129 tests in 16 files.
  No production runtime or native fault contract changed in this batch.
- **Visual result**: `mobile/chat/scripts/check-layout.mjs` runs the actual
  Portal and emits prototype-only screenshots plus geometry. It reproduced
  clipped Info rows, a compressed preview, and scenario-label overlap before
  their owning CSS corrections. The final 48 captures at 1440x1100,
  554x954, and 390x844 pass width, page overflow, section clipping, label
  non-overlap, focus containment, same-intent recovery, and Direct outcome
  checks. Captures were visually inspected; evidence is under
  `apps/mobile/src-tauri/target/prototype-layout-final/`.
  Portal type-check/build and Mobile prototype build pass with existing chunk
  warnings. The sample is light-only. This is not native proof, full prototype
  parity, Owner confirmation, or W6A closure.
- **Completion audit**: native communication remains `UNPROVEN`; Gap Detector
  still reports stale/unrun/dependency-blocked runtime evidence. The ordinary
  static contract command still fails on retained debug instrumentation.
  Current development data is not a disposable fresh-request Fixture.
  No healthy Gate assertion, frozen OAuth inventory, protected owner source,
  Station deployment/reset, key, or request ID was changed.
- **Earlier resource checkpoint**: both Appium sessions, owned Xcode/WDA processes,
  Appium server, and prototype server are closed. Ports 4743, 8143, 8144, 9243,
  9244, and 3262 have no listener; the prototype Make lock is absent. Both
  installed Peers processes and original data remain. The expired debug
  collector was restarted without clearing logs; all `[OPEN]` instrumentation
  is retained. No commit, push, PR, Station deployment/reset, or identity
  replacement occurred.
- **Current resource handoff**: both original simulators are still booted.
  The old app PIDs had exited; the retained installed apps were relaunched
  with the verified remote-profile origin, without reinstalling or clearing
  their data. Trace `1789177402015..1789177402120` reaches the access gate
  with no active session, not recovered Messaging. No Appium session was
  recreated. Prototype preview on port 3262 and the existing debug collector
  are intentionally retained for inspection; they are not Acceptance leases.
- **Final service recheck**: Station advanced externally to `24c7e3e04330`,
  built at `2026-09-12T01:24:15Z`. The deployed commit delta contains no
  changes to Conversation's HTTP mapper, Delivery errors, or Social handler.
  The result-route presence probe remains 404, so neither communication
  prerequisite is reopened by this deployment.
- **Next continuation frontier**: the bound Station reports `98631c455267`
  with no relevant Conversation/Social/Core delta; result-route presence is
  still 404. The owning `peers-group-chat` commit `e6c7b9b18` now contains
  Device Inbox typed HTTP mapping and stale Key Exchange endpoint errors,
  including an inactive-device 403 regression. That source is not deployed
  to the bound Station. No import, deployment, reset, or identity replacement
  is authorized here.
- **Concurrency for the remaining implementation audit**: one read-only lane
  checks W6A bounded/virtualized conversation, message, contact, and search
  behavior against accepted requirements. The integrator checks W4/W6D
  lifecycle and recovery ownership. Neither audit changes native/Station
  resources. Any concrete source-authorized gap is admitted before edits;
  missing semantics remain parked. All writes and reconciliation stay with
  the integrator, and prior prototype work is already verified.
- **W6A implementation amendment**: the read-only audit is complete. Existing
  accepted experience/scroll contracts require traversable bounded content;
  the current 50-request page and permanent 100/200-row slices do not satisfy
  them. This mechanically reopens IOS-I3/IOS-I4 rather than changing product
  scope. Ready units:
  - request pagination at the Social projection owner, with request-ID
    deduplication, atomic publication, stale-scope/revision fencing, and
    explicit failure when pagination cannot make progress;
  - reachable bounded conversation/contact/group/member/selection windows;
  - logical-history search and thread counts, plus target materialization
    before scrolling;
  - restoration against the real page/message scroller with identity anchors.
  Native full-history reads and eager per-conversation hydration remain a
  separate projection-memory obligation; DOM bounds alone cannot close AS-14.
- **W6A implementation concurrency**: hybrid. One writer exclusively owns
  `features/social/socialStore.ts` request refresh and a new focused pagination
  test. The integrator owns Chat/Contacts rendering, shared window/scroll
  helpers, search dispatch, locale catalogs, docs, all browser/native resources,
  and final checks. Shared gateway/message contracts are read-only. No
  dependency, schema, generated, Station, or protected Core change is admitted.
  The Social lane integrates before whole-Mobile verification; its existing
  Store interface is frozen, so UI work is independent. Prior audit lanes are
  complete, with no active audit writer.
- **W6A reproduction**: `debug-mobile-list-history.md` owns the three
  pagination/window/scroll hypotheses and interaction assertions. Product
  corrections restore the accepted experience, not a new prototype design.
  Render and source proof will be recorded separately from native communication.
- **W6A source checkpoint (2026-09-12)**: the pagination writer returned only
  `socialStore.ts` and `socialRequestPagination.test.ts`; integration is
  complete and no writer remains active. Pre-fix retained 50 of 120 requests;
  post-fix atomically publishes 120 after three pages. Thirty-five cases cover
  duplicates, malformed/non-progressing pagination, short pages, failures,
  overlapping refreshes, and replacement session/gateway fencing.
  `BoundedList` replaces permanent slices with overlapping traversable windows
  (200 messages / 100 other rows), materializes targets before focus/scroll,
  and distinguishes older-window bottom from the live tail. Logical selectors
  own search and thread counts; submitted search uses native timestamp/ID
  cursor paging with scope checks and explicit failure. Navigation owns
  bounded query/window/identity-anchor metadata and resolves the actual
  scroller. The redundant Shell suspend-time cache clearing was removed;
  runtime scope fencing still clears every cache.
- **W6A verification checkpoint**: `pnpm mobile:check` passes Web contracts,
  TypeScript, Web build, offline Rust check, and Xcode project listing.
  All 357 Mobile tests in 58 files pass. The repeatable component-browser
  script visits 1,250 distinct variable-height rows at 390x844 and 1024x900
  with at most 100 mounted; exact retained-row offset, prepend, detail return,
  old-target focus, tail follow, and history-reader stability pass.
  Browser/server resources close in `finally`. Output is ignored local
  component evidence under `apps/mobile/src-tauri/target/list-history-browser/`,
  not a native Acceptance result.
- **W6A coverage checkpoint**: COMPLETE mode, existing
  `mobile-chat-contacts-groups` and `mobile-native-accessibility-performance`;
  changed contracts/mapping are Mobile business injection, not Infra.
  Separate helper-path probes initially selected no Gate. Registry now maps
  both helpers and their browser runner/fixture to the existing receiver and
  native-quality Gates; four mapping regressions pass. Plan run
  `20260912T051212638379Z-67203fa80aaeff19b80bee489528d51e` selects both
  Features and seven existing Gates. No Gate was weakened or replaced by the
  component script. The full Domain validator returns
  `latest Acceptance run source does not match current source`; the normal
  Mobile static checker still fails on retained Auth debug `fetch`. The Gap
  Detector continues to reject native communication as `UNPROVEN`.
- **W6A remaining proof/source queue**: native package rebuild/install and
  indexed-search interaction proof remain ready; long-list prototype controls
  are explicitly `UNSYNCED` in the prototype README. Eager full-history
  projection hydration and AS-14 device timing remain open. Source/component
  tests do not close those requirements or the formal W6A workstream.
- **Station recheck**: bound Station reports `64511e23628c`, built
  `2026-09-12T04:32:00Z`; the inspected delta from `98631c455267` contains
  no Conversation/Social/Key Exchange/Core change. The result-route presence
  probe remains 404. Original command/request IDs and both app identities are
  untouched; this batch did not rebuild/install native apps, log in, send a
  request, reset data, or deploy Station.
- **Next continuation concurrency**: hybrid. The integrator exclusively owns
  production search interaction fixtures/corrections, native build/install,
  simulator/Appium resources, shared locale/catalog files, and final evidence.
  One independent writer owns only
  `packages/prototypes/mobile/chat/src/**` and its long-list browser script,
  restoring the already-accepted traversal/search/anchor semantics to the
  prototype. No production import, backend call, dependency, or platform
  contract change is allowed in that lane. Prototype builds do not touch
  Mobile Web output. Native packaging starts only after production edits and
  Web verification settle. Both retained simulators are booted; the remote
  profile verifies without using cached reset/deploy authorization.
- **Continuation reconciliation**: the long-list prototype writer has returned;
  its source and rendered evidence await integrator reconciliation. The agent
  registry still lists completed historical lanes as running and exposes no
  addressable follow-up tool (`SUBAGENT_REGISTRY_STALE`); they are not live
  ownership reservations. A new isolated writer may add only
  `apps/mobile/scripts/fixtures/chat-history-search.tsx` and
  `apps/mobile/scripts/check-chat-history-search.mjs`, using the existing
  hook/dispatcher in an explicit component-test fixture. It owns temporary
  port 3265 and closes its browser/server. It must report production defects
  without editing production code. The integrator retains prototype review,
  shared files, native resources, fixes, and final verification. Native
  packaging waits for that test result and any resulting source correction.
- **Deployed owner change (2026-09-12)**: `4a844a64e07c` adds Device Inbox
  Delivery-error HTTP mapping, including Unauthorized to 403. The latest
  version now reports `a89bcbb9342c`, built `2026-09-12T07:45:17Z`.
  The result-route presence probe still returns 404. Recheck native Inbox
  recovery against current source; do not assume it passed or replace the
  unresolved request. This worktree performed no service deployment or reset.
- **Long-list prototype reconciliation**: the returned source is integrated
  without production imports, backend calls, or dependency changes. The
  integrator reran its build and repeatable browser script: all 240
  conversations, 240 contacts, 480 messages, and 480 search results are
  reachable at 1440x1100, 554x954, and 390x844. Anchor retention, old-target
  focus, live-tail separation, and inherited Social/recovery samples pass.
  Four generated screenshots were opened and inspected; the prototype README
  records exact images and remaining request/member/search-state parity gaps.
  These additions are not Owner-confirmed, native evidence, or AS-14 closure.
- **Indexed-search interaction checkpoint**: the isolated writer returned only
  its two reserved fixture/runner files. Integrator code reconciliation and
  rerun pass all 56 Direct/Group cases: loading/results, exact next/previous
  cursor, failure/retry, non-advancing cursor, empty versus failure, latest
  query, account/session/conversation/kind replacement, clear/close, and
  unmount/remount. No production defect was confirmed. External/API traffic
  is forbidden by the runner, production modules are not replaced, and source
  hashes plus cleanup are recorded in ignored component evidence. This is not
  proof of native index ordering or ChatPage interaction. All 357 Mobile tests
  and Web checks pass. No source writer remains; native packaging is now the
  serial integrator action.
- **Current native package (2026-09-12)**: Xcode compiled successfully, but
  Tauri initially failed to replace a non-empty generated bundle directory.
  The old ignored `arm64-sim` output was moved into ignored target output;
  no simulator container was erased. The exact `aarch64-sim` rebuild exits
  zero, passes strict signing, and contains only the expected Mobile bundle,
  arm64 simulator platform, and `peers-touch` callback. Both installed
  WKWebViews read back `tauri://localhost/assets/index-B1qW5BNk.js`, matching
  the current Web build. Existing saved Alice/Bob accounts survive installation.
  Native build/result logs are `target/ios-w6a-{build,rebuild}*` under
  `apps/mobile/src-tauri/`.
- **Native communication recheck**: normal Email Login grants Alice and Bob.
  Alice's initial reconciliation reports HTTP 409 and truthful dependent
  unavailability; lifecycle Retry subsequently returns to expired-session
  recovery. Bob's native status retains the original profile and device ID,
  zero lane sequence, and zero conversations. It is not proof of Station
  device authorization. Station logs show Inbox claim 403 followed by
  `/device/enroll` 409, including request
  `9b798dea-a83e-4ead-a866-c1638bd208d4`. The exact Actor Identity conflict
  subtype remains uncollected; do not reset or replace keys to bypass it.
- **Native accepted-contact observation**: Bob's Contacts projects an existing
  accepted Alice relationship. This is not resolution of the original request.
  One production Message action reaches `/conversation/direct` and fails with
  HTTP 500; Station request `c8ae859c-3a33-4e57-83e1-85fb9fbbfc58` records
  `actor_identity.build_local_endpoint_manifest: actor: has no established
  identity`. No text message was submitted and no Direct ID was accepted by
  Mobile. The contact failure and Alice auth screenshots
  `target/ios-w6a-bob-direct-failure.png` and `target/ios-w6a-alice-auth.png`
  were opened. These are native development observations, not source-bound
  Acceptance.
- **Owner handoff and remaining Mobile frontier**: latest Station version is
  `f1963a7f2567` (built `2026-09-12T08:14:54Z`); its relevant
  Conversation/Social/Actor Identity/Key Exchange/Core delta from
  `a89bcbb9342c` is empty. The result-route probe remains 404.
  Actor Identity/Conversation owners must resolve retained-device enrollment
  and authoritative endpoint manifests before native communication retries.
  The original command/request remains untouched, with no fresh ledger decode.
  Separately, native `worker_loop` retains background errors in `last_result`
  and logs them, while its event sink publishes only projection changes.
  `messagingRuntime` currently publishes readiness through explicit session
  reconciliation. Diagnose later background failure propagation against the
  existing lifecycle readiness contract before changing it; do not infer
  health from a running worker or an enrolled local flag. This Mobile-only
  diagnostic and the existing projection-memory obligation keep the Goal
  active, not complete or globally blocked.
- **Evidence honesty**: 357 Mobile tests, Web checks, prototype build/traversal,
  and 56 isolated search cases pass. No broad product Gate was rerun.
  Gap Detector with `--range HEAD` returns exit 1 and `UNPROVEN` for the
  full two-client/restart-history claim. The initial unsupported
  `--range working-tree` attempt failed closed and supplies no proof.
  Existing static Auth-debug-fetch and stale Acceptance-source gaps remain.
- **Automation cleanup**: both owned Appium sessions were deleted; the server
  reported an empty session list. Its exact process and the two owned WDA
  runners were stopped. Both installed Peers processes remain running.
  Prototype Portal and `[OPEN]` diagnostic collectors/records are retained.
  No commit, push, PR, stash replay, branch/worktree operation, Station
  deployment/reset, replacement request, or identity-key change occurred.
- **Health/identity continuation concurrency**: hybrid. The integrator owns
  Messaging worker/readiness diagnosis, any source-authorized correction,
  instrumentation, tests, shared contracts, native resources, and this plan.
  Two independent read-only lanes inspect (1) retained actor identity admission
  and recovery against canonical contracts, and (2) bounded native message
  queries/projection hydration. Neither lane writes files, invokes runtime
  resources, reads credentials, or changes protected Station/Core/generated
  code. Their output determines the next admissible fixes; missing semantics
  remain design/owner decisions. The previous writer lanes are complete.
- **Read-only lane reconciliation**: both identity and projection-memory
  inventories returned without writes or runtime operations. Mobile lacks
  canonical identity archive restoration and restored profile-version
  propagation; this does not classify the retained device's 409. Safe native
  summary reads and targeted enrichment are implementation-ready, while full
  history cursor/order, pending promotion, live-page consistency, target
  windows, and retained-memory budgets remain explicit design decisions.
  Station `f94b2fb4d360` has no relevant owner/Core delta from `f1963a7f2567`.
  The integrator now serially instruments native response metadata and worker
  completion/reuse before selecting a health correction. No source writer
  remains active. This does not change any existing proof or reset boundary.
- **Diagnostic-build checkpoint and concurrency**: the instrumentation-only
  iOS build exits zero (`target/ios-worker-health-build-result.json`).
  The integrator owns installation, retained native sessions, transport and
  worker/readiness diagnosis, shared contracts, and final verification.
  One independent writer may now change only
  `apps/mobile/src-tauri/src/messaging/adapter.rs`: replace conversation-wide
  pin hydration during message enrichment with target-message queries and
  colocated equivalence/bounded-query regressions. Existing pin-list APIs,
  schemas, ordering, projection fields, and business semantics remain frozen.
  Its Cargo check runs only after this completed package build; no further
  native build starts until the lane is reconciled. Broader summary/hydration
  changes remain queued for integration after the diagnostic.
- **Native diagnostic progress (2026-09-12)**: both installed WebViews load
  `index-qzJwUwf3.js`. Against externally deployed `0a8c04977ad1`, both original
  devices successfully enroll/reconcile and open canonical Direct
  `direct-f3d45410863a64f915e5c84d8af2c0ec` through the production Message action.
  Both retain their original profile/device IDs and consume lane sequence 1.
  Bob's single text attempt fails before message admission: Key Exchange
  bundle fetch returns 404, request `044d8537-9d29-4279-9391-d20dbbc4da83`,
  with owner log `actor_ptid: has no active Direct key bundle`. Native
  instrumentation confirms an empty protobuf error body. No local or Station
  key/reset mutation is authorized. Alice's original durable command is
  freshly decoded as `UNRESOLVED`, attempt 1; its result route remains 404.
  No text is receiver-visible. Earlier enrollment/Direct failures are not
  current blockers; continuity and missing prekeys still require owner
  recovery evidence. O/P remain unproven rather than inferred from liveness.
- **W6A summary-read amendment**: accepted Device Engine projection ownership
  and bounded-list requirements permit equivalent SQL summary/count reads
  without changing schema or message ordering. Add one local native
  `messaging_conversation_summary` query with account/conversation input and
  `{ lastMessage: MessagingMessageProjection | null, unreadCount: number }`.
  It must equal the existing full-history last row and unread predicate,
  including pending deduplication, incomplete attachments, retraction, and
  actor read cursors. List refresh publishes summaries, not every history.
  Active or already-materialized histories refresh through existing owners;
  inactive events update summaries without opening history or marking read.
  Scope/revision races preserve prior valid data. No general history paging
  or cache-eviction policy is introduced.
- **Summary implementation concurrency**: hybrid. Integrator owns the native
  query/command/registration and `services/mobileCommands.ts`, runtime event
  routing, all docs, source reconciliation, and native verification.
  After freezing the query shape above, one Web writer owns Social/Group
  Stores, their projection helpers, `features/chat/chatSelectors.ts`, and
  focused Web tests for summary publication and lazy hydration. The pin
  writer's `adapter.rs` reservation remains exclusive until it returns; only
  then may the integrator add the summary SQL. Tests use independent Web and
  Rust outputs; whole-Mobile checks and packaging wait for both lanes.
- **Summary integration checkpoint**: both writers returned and released their
  exclusive paths. The integrator reconciled the shared committed/pending
  summary rows, account-scoped command registration, runtime event routing,
  and obsolete Shell/Contacts history subscriptions. Recorded verification:
  414 Mobile tests in 60 files, 165 default Rust tests, 33 focused adapter
  tests, 62 Messaging tests, seven runtime-routing tests, and TypeScript pass.
  The freshly repeated `pnpm mobile:check` exits zero. This proves source
  checks, not installed-query behavior or receiver delivery. Loaded histories
  remain complete; general paging and retention budgets are not claimed.
- **Native verification concurrency**: hybrid. All prior writers are complete.
  The integrator owns the frozen source, readback helper, plan, generated
  package, retained simulator/Appium resources, and sequential Station calls.
  One new read-only lane may inspect Direct prekey publication and recovery
  contracts in Mobile/Core/Station sources, with no file, database, credential,
  runtime, or remote mutation. It returns the exact safe recovery path or
  missing owner decision. Native packaging starts only after Mobile check
  completion; no concurrent Web build or source writer is allowed.
- **Installed summary checkpoint (2026-09-12)**: the final build exits zero
  at `11:34:51.721Z` (`apps/mobile/src-tauri/target/ios-summary-build-result.json`).
  Strict signing, arm64, bundle ID, and the single `peers-touch` callback
  scheme pass. Both original containers load `index-rt2ztENX.js`. Their
  timestamped `target/ios-summary-{alice,bob}-readback.json` files return the
  original profiles/devices, one canonical Direct, empty messages, and
  `{ lastMessage: null, unreadCount: 0 }` through the real new native query.
  This proves the installed empty-history contract only. The first launch
  omitted the existing HTTP debug-origin permission and failed closed; exact
  process-local `PT_MOBILE_DEV_STATION_ORIGIN` injection corrected it without
  code changes or relaxed validation.
- **Current runtime admission boundary**: externally deployed Station
  `68417f9f19bf` (built `11:25:45Z`) has no relevant owner/Core source delta
  from `0a8c04977ad1`. Alice's authenticated enrollment request
  `cbe3730b-44ae-4792-bb8f-7e7a2352de7b` returns 409 at `11:48:00.996Z`.
  Bob's explicit reconciliation observes Inbox claim 409 at native trace
  `1789213958024` and `1789213958128`. Both failures have zero-byte protobuf
  bodies. Their exact owner subtype remains unobserved; local enrolled flags,
  running workers, and retained Direct rows do not establish admission.
  Both opened `target/ios-summary-{alice,bob}-unavailable.png` screenshots
  show Chat unavailable with recovery navigation. Reliability remains
  inactive, so command readback is `null`, not evidence of an empty ledger.
  No further text intent, replacement Friend Request, or key/cursor reset ran.
- **Prekey lane reconciliation**: the read-only lane returned without writes.
  Mobile already calls `publish_prekeys` every worker cycle; Core
  `PreKeyPublisher::publish` returns early when local material is published.
  Key Exchange's earlier missing-bundle error means no identity row matched
  the selected active endpoint, not OPK exhaustion. Existing re-upload
  preserves consumed OPKs only if their remote rows survive; reinserting lost
  rows marks them unconsumed. No local publication-flag reset, fresh identity,
  or old-OPK replay is permitted. The `peers-group-chat` Actor Identity/Key
  Exchange/Core owners must classify exact target/routing versus state loss
  and define identity-preserving, crash-safe recovery with OPK non-reuse and
  SPK retention. Bundle fetch consumes OPKs and is not a read-only probe.
  Sources: `packages/messaging-core/src/crypto/prekeys.rs`,
  `apps/station/app/subserver/key_exchange/infrastructure/canonical_store.go`,
  and `docs/architecture/domains/chat/messaging/experience-contract.md`.
- **Proof checkpoint**: the fresh read-only Gap Detector with `--range HEAD`
  returns `UNPROVEN` for the full two-native-client delivery/restart claim.
  Existing W5/hard-cut dependencies and stale runtime evidence remain;
  no broad product Gate was rerun or weakened. O/P remain inconclusive for
  later-failure/credential-race behavior; current explicit reconciliation
  does correctly publish failure. Formal workstream closure stays 3/15.
- **Pre-sync queue checkpoint**: the source-authorized summary/pin/hydration batch is
  verified at source and installed empty-query level. Read-only prekey
  analysis is complete. The current owner admission/result/key-recovery
  branches are parked, not silently retried. Residual request/member/search
  prototype parity remains ready under its accepted product contracts.
  General native history paging/retention, canonical identity restoration,
  fresh-request Fixture semantics, and the previously listed W5/W7/physical
  boundaries remain parked. No fixed-point exhaustion or Goal completion
  claim is made.
- **Automation release**: both newly allocated Appium sessions were deleted
  and the server returned an empty session list. The exact owned Appium,
  Xcode/WDA, and runner processes were stopped; ports 4743, 8143, 8144, 9243,
  and 9244 have no listeners. The retained app processes were also absent at
  the subsequent check, with no established exit cause; both installed
  packages were relaunched without automation attached using the exact
  approved debug origin and remained running at the two-minute process check.
  No app data, keys, original command, or Station
  state was erased. Prototype Portal and all `[OPEN]` diagnostic artifacts
  remain retained. No external `env` write, commit, push, PR, stash replay,
  or worktree/branch operation occurred.

#### 2026-09-12 Git-Server Workflow Sync

- **Authorization and binding**: the Owner requested synchronization from
  `Administrator@198.51.100.60:D:/workspace/peers-touch.git`, skill refresh, and continued
  Mobile work without overwriting additions or resurrecting deletions.
  The server's default branch is `fix/windows-native-chat-closure` at
  `5a8217ad6f507b667effbeb626ecc6764cf5e9ff`. Merge
  `771605c8d768ea3ef73a1b9b1a63befae354292f` preserves both committed histories;
  only this integration was committed. The original Mobile dirty work remains
  unstaged/untracked. Branch, workspace ID, initial HEAD, and worktree-set digest
  are unchanged, and the exact expected-HEAD verifier passes.
- **Preservation**: before merging, 318 dirty paths were fingerprinted and
  archived under `apps/mobile/src-tauri/target/git-sync-20260912/`.
  Archive SHA-256 is
  `3f256754e730c26e1d67c417d121a61a387920dc5d9b9dca003f6f2a68c35661`.
  Safety stash `bbf666506244ec36fb4d01c70f1973834aa58191` was applied once by
  exact OID and retained. Never apply it again automatically. Historical
  recovery stash `783451f708eca506f6a606cdae77a69b6a32fc2e` remains untouched.
  Before this plan amendment, verification reports 302 byte-identical paths,
  16 expected integration/migration differences, and no resurrected original
  deletion.
- **Conflict decisions**: preserve local defect-closure plus the incoming
  formal-plan requirement; use Node check entrypoints without dropping Mobile
  regressions; retain both `argv` rendering and plan-bound quality evidence.
  The six local Social boundary rules now belong to `tooling/devctl/checks.mjs`;
  the retired shell checker stays deleted. Its two migrated regressions pass.
- **Concurrency decision**: hybrid. Read-only integration analysis may check
  overlap preservation and the imported macOS process lifecycle independently.
  No lane may alter tracked source, shared plans, generated artifacts, profiles,
  simulator state, or Station. The integrator owns all source/test changes,
  the plan, skill projection, Python environment, evidence, and reconciliation.
  Test subprocesses may use isolated temporary directories and must close only
  resources they create. Native build and runtime work waits for integration.
- **Workflow adaptation**: use the imported D-20 contract in this same plan,
  retaining every formal W-workstream status and physical/owner proof boundary.
  Do not create another active plan, change the initial HEAD, widen Mobile
  ownership, or run `--completion`/`--full` merely to satisfy tooling.
- **Integration verification**: the preservation audit found no semantic loss
  in the 16 integrated paths. All 112 original untracked files remain, with
  only the scanner regression intentionally migrated. All eight original and
  incoming deletions remain absent. `make skills` refreshed the canonical
  projection (43 readable skills, including linked skills). The D-20 resolver
  selects this plan and W6A alone; all 1376 initial-HEAD impact paths remain in
  its projection. `pnpm mobile:check`, 414 Mobile tests, 116 focused
  Evidence Store/provisioning/plan tests, and 16 quality tests pass.
- **Local Gate checkpoint**: aggregate
  `20260912T134138479244Z-4c31163c75b9950921a4092049c8399e` selected exactly the
  seven W6A local Gates with a 1770-second catalog budget. Plan-self, Infra
  validation, and workflow-contract passed. Mobile static still rejects the
  retained Auth debug fetch. Provisioning self-tests exposed two test defects:
  a manifest serialization test omitted its newly invoked friendship Fixture
  collaborator; a clock-translation test used absolute monotonic deadline
  `10 + 500`, which is already expired on a long-running host.
- **Admitted test maintenance**: the integrator may update only those two
  existing synthetic tests under `test_provisioning_owners.py` and
  `test_launch_context.py`: isolate and assert the existing friendship
  collaborator like the adjacent test, and derive the foreign-clock deadline
  from a current future parent deadline. Preserve every serialization,
  deadline-translation, expiry, and real-Fixture assertion. No production
  contract, reset target, timeout, or proof requirement changes.
- **Developer-toolchain handoff**: the read-only process lane confirmed that
  synchronous `Atomics.wait` prevents same-parent child reaping: the stopped
  child is `STAT=Z` until the next event-loop turn. Raw evidence is in
  `apps/mobile/src-tauri/target/git-sync-20260912/process-diagnostic/`.
  Every probe PID was released. The devctl owner must implement bounded
  asynchronous stop and awaited rollback/callers without weakening foreign
  identity refusal or process-tree extinction; Mobile does not migrate its
  lifecycle into devctl or claim that upstream defect fixed.
- **Profile continuation**: direct `profile.env.example` selection is rejected
  by the imported filename-identity parser. Selecting the existing
  `.local/dev/profiles/chat-native-disposable.env` reference resolves back to
  the canonical environment repository (`canonical: true`) without any file
  write. Remote mode, approved deploy environment, and non-loopback endpoint
  verify. Cached reset/restart variables remain unauthorized.
- **Maintenance result**: all 78 provisioning-owner and launch-context tests
  pass after the two test-only corrections. Review skill freshness passes;
  covered-rule differences were the preserved coverage inventory, not a
  weakening of product proof.
- **Resumed W6A concurrency**: hybrid. The two read-only sync lanes are complete.
  One writer exclusively owns `packages/prototypes/mobile/chat/src/**` and
  its prototype-only residual-parity browser script. It closes the already
  accepted request/member traversal and search loading/error/retry sample
  gaps, reusing the existing list window and state controls. Shared locale
  catalogs, manifests, Portal, production source, native resources, docs,
  and final verification remain integrator-owned. No backend, native, or
  protected-owner mutation is allowed. Browser evidence uses the retained
  Make Portal and closes only its own headless browser.
- **Service recheck**: the approved remote Station now reports `09a6897e3d4b`,
  built at `2026-09-12T13:46:14Z`. Its Conversation, Actor Identity, Key
  Exchange, Social, and Core delta from the previous `68417f9f19bf` is empty.
  This is not evidence that admission or retained keys recovered. No new
  native login, message intent, request, deployment, or reset was attempted.
- **Rust merge regression admission**: post-merge Rust tests report 155 pass
  and ten failures sharing `attachment_descriptor()` in the Mobile adapter
  test module. Imported Core validation requires the encrypted object to use
  `application/octet-stream` while private plaintext metadata retains its
  actual MIME type. Update only that synthetic descriptor; keep `text/plain`
  in private metadata and preserve all summary, pin, upload, and download
  assertions. Core and runtime validation remain unchanged.
- **Attachment owner correction**: correcting the synthetic descriptor leaves
  one reproducible production-adapter failure. Test-only instrumentation in
  `debug-mobile-attachment-metadata.md` confirms valid Core metadata and exact
  commitment, followed by Mobile's obsolete public/private MIME equality.
  The accepted opaque-object contract and imported Desktop implementation
  determine the fix: check exact draft existence without reading or inferring
  private MIME from the public descriptor. Preserve every transaction/state/
  commitment fence. The existing attachment upload test must retain the
  plaintext MIME and reject invalid public descriptors. Existing Mobile
  Direct/Group receiver journeys already stage `text/plain` and remain the
  mandatory runtime proof; they are not replaced by these source tests.
- **Attachment source result**: post-fix collector observation
  `1789221914970` keeps descriptor/commitment checks true and private MIME
  `text/plain`, with no completion error. All 165 Rust tests pass, including
  invalid-public-descriptor rejection before state mutation. Twelve Mobile
  journey/simulator wrapper regressions pass; receiver filename/MIME
  preservation is now an explicit existing-Gate assertion. Growth decision:
  `acceptance_gate`, strengthening `mobile-native-chat-contacts-e2e` and its
  simulator journey without running either product cell.
- **Packaging continuation**: production Web/Rust source is frozen after the
  attachment correction. The integrator may rebuild `aarch64-sim`, verify
  signing/platform/bundle, and update both original installed apps without
  erasing containers or Keychains. The independent prototype lane uses its
  own output. Build/install proves no Station admission or receiver delivery;
  new login, key recovery, or request intents remain parked.
- **Prototype reconciliation**: the isolated writer returned 11 files confined
  to its reserved prototype source and runner. Its residual check passes 40
  assertions across 390x844 and 1440x1100, reaching all 240 request and 240
  member rows with at most 100 mounted. The inherited layout runner fails
  because it clicks an already-selected Portal site after the sheet focused
  itself: readback is `aria-pressed=true`, focus inside before that click,
  then focus outside after it. Repair only the runner's site-selection action;
  retain both Tab containment assertions. No product focus change is implied.
- **Focused Gate result**: after the two synthetic-test corrections,
  `acceptance-runtime-provisioning-self` run
  `20260912T135313047960Z-edf1cbbe41fde4da3ab1aa00726cfd3f` passes in 20.221
  seconds. Its parent is
  `20260912T135312810403Z-ae34581b4b46a133f5a3df88953eaee5`.
  The earlier five-Gate aggregate remains failed; it is not rewritten as
  passing, and the preserved Auth debug-fetch static failure remains open.
- **Prototype final result**: the post-fix layout artifact at
  `2026-09-12T14:27:33Z` contains 48 captures with zero defects. The residual
  artifact at `2026-09-12T14:27:37Z` records 40 passing assertions and 26
  captures across 390x844 and 1440x1100. Both Tab containment assertions remain.
  A further long-list rerun passes at 390x844, 554x954, and 1440x1100, traversing
  all 240 conversations, 240 contacts, 480 messages, and 480 search results.
  The Mobile prototype build passes with its existing large-chunk warning.
  `docs/architecture/platform/client/mobile/prototype/README.md` identifies the inspected
  narrow/wide light-theme images and removes only the now-closed sample drift.
  Owner confirmation, full native parity, timing, and AS-14 remain unproven.
- **Native package result**: build began `2026-09-12T14:11:58Z` and exited zero
  at `2026-09-12T14:13:18Z`; evidence is
  `apps/mobile/src-tauri/target/git-sync-20260912/ios-build-result.json`.
  The arm64 Simulator bundle retains `com.peers.touch.mobile` and only the
  `peers-touch` callback scheme. Final installed readback at
  `2026-09-12T14:27:28Z` records the matching executable SHA-256 above, Alice
  PID 86062, and Bob PID 87700 in `ios-installed-readback.json` in that directory.
  Both screenshots were opened and show sign-in/session-expiry recovery, not
  communication. The source includes dirty Mobile changes atop the merge;
  the Git commit alone is not a complete runtime source attestation.
- **Installation preservation**: iOS moved the app data-container paths during
  updates. The install helper's path-equality assertion was too strong and
  stopped after installation; it did not establish data loss. Alice's second
  helper attempt skipped reinstalling the already-matching binary. Bob's
  installed binary was verified before launching it without another install.
  The partial `ios-install-result.json` is not two-client evidence; use the
  later installed readback. Retained profile DB and reliability-directory
  presence were checked, but private keys were not read and ledger contents
  were not freshly decoded. No old container was restored, no Keychain or app
  data was erased, and no identity-continuity claim follows from file presence.
- **Post-sync admission diagnosis**: `debug-mobile-admission-409.md` and the
  31-line
  `.dbg/trae-debug-log-mobile-admission-409.ndjson` trace preserve the
  instrumentation-only evidence; lines 1-27 are the bounded admission
  classification subtrace and lines 28-31 cover the later local-readback
  relaunch. Fresh Alice authentication reaches native
  Messaging with a complete format-v1 certificate, profile version 1, matching
  request/header device, 32-byte device key, and 64-byte actor signature.
  Station then returns `/device/enroll` HTTP 409. The one-shot read-only
  `/device/list` comparison succeeds with two Station devices but reports no
  matching local device and no device carrying Alice's retained actor
  fingerprint. Because Actor Identity validates established actor continuity
  before inserting a device, this classifies the failure as
  `ACTOR_IDENTITY_CONTINUITY_CONFLICT`; stale profile, revoked device,
  device-material conflict, malformed request, and Auth failure are excluded.
- **Inbox and error-boundary diagnosis**: the earlier bounded Bob trace records
  Inbox 403, Core-owned stale-enrollment recovery, successful re-enrollment,
  then a claim with `expectedConsumerEpoch=0` and `afterLaneSequence=1`
  returning 409. Station's current decision tree makes that exact request
  `DEVICE_INBOX_ITEM_NOT_HEAD`: the retained local cursor is ahead of
  Station's acknowledged lane head. Both 409 responses use
  `application/protobuf` with zero bytes because Station's shared handler tries
  to serialize a non-protobuf error map through `ProtoSerializer`; Mobile
  cannot recover the typed owner code from that response. Deployed Station
  `7c10521a51d5` contains no Actor Identity, Conversation, Key Exchange, Core
  server, or Social delta from `09a6897e3d4b`, and the live behavior confirms
  no owner closure.
- **Current-package local summary proof**: read-only Tauri bridge evidence at
  `apps/mobile/src-tauri/target/git-sync-20260912/current-summary-readback.json`
  covers executable
  `33169bb5922658f54c30d82144ff684243ae437365604e38e983cfcc9f147047`.
  Alice selects profile
  `6ba4824fc06ce7810a47ef6bca866a99949dfb5149bd640ec6f2f703a7fe6c18`
  and Bob selects
  `fa476abfd426aa4e705f4b2672b4b0b3a74d61d6dafec129ca3d423adccd17e7`;
  both equal the deterministic SHA-256 of the exact Station peer ID, separator,
  and actor PTID. Both select retained Direct
  `direct-f3d45410863a64f915e5c84d8af2c0ec`, lane sequence 1, one conversation,
  zero messages, and a summary with `lastMessage=null`, `unreadCount=0`, and
  exact history-tail equivalence. This closes installed current-package
  empty-summary and profile-selection proof only. It does not prove nonempty
  summary hydration, receiver delivery, restart persistence, or AS-14 memory
  bounds.
- **Owner-correct conclusion**: no Mobile business correction is admitted.
  Replacing Alice's key/device violates continuity and the explicit
  preservation requirement; resetting Bob's cursor guesses at replay and
  deduplication after Station state loss; treating all 409s as recoverable
  merges distinct owner failures. Actor Identity must provide
  identity-preserving continuity recovery, Conversation Inbox must provide a
  Station-generation-aware cursor recovery contract, and Station HTTP must
  emit typed protobuf-compatible error details. The original identities,
  keys, two profile databases per client, reliability directories, Direct,
  drafts, and unresolved Friend Request remain untouched. No text was sent.
- **Diagnostic runtime handoff**: both bounded Appium sessions closed and the
  Appium/WDA listeners on 4743, 8143, 8144, 9243, and 9244 were released.
  Both retained apps are installed but stopped. The session-scoped collector
  remains live on 7783 because `debug-mobile-admission-409.md` is `[OPEN]`;
  its instrumentation must not be removed before owner-backed post-fix proof
  or an explicit abort.
- **Resumed blocker audit 2**: the bound Station briefly restarted and returned
  on the same deployed `7c10521a51d5` source. The `peers-group-chat` owner
  branch contains committed stale-device error mapping, remote Direct prekey
  routing, and friendship/Federation projection repairs, but none defines
  Actor Identity continuity restoration, Station-generation-aware Inbox cursor
  recovery, or protobuf-compatible typed error serialization. Those commits
  are neither integrated here nor deployed to the bound Station. The
  current-package summary/profile readback above closes the last independent
  W6A runtime proof item found by this audit. The dependency-ready Mobile queue
  is now empty at a second consecutive fixed point; the Goal remains active
  until the lifecycle's third repeated confirmation or an owner/external-state
  change reopens execution.
- **Resumed blocker audit 3 and Goal boundary (2026-09-13)**: the immutable
  Mobile binding still passes, the deployed Station still reports
  `7c10521a51d5`, and no newer relevant Actor Identity, Conversation Inbox,
  Key Exchange, Station serializer, Social, or portable Core commit exists.
  The `peers-group-chat` owner branch remains at `95ca267c4a685257f21af448f451c1c3e7993d9d`;
  its committed stale-device mapping, remote Direct prekey routing, and
  friendship/Federation repairs do not define the missing continuity or Inbox
  generation semantics and are not deployed to the bound Station. A complete
  workstream audit leaves every remainder behind a recorded hard boundary:
  W2 owner semantics/physical credentials, W3/W4 physical proof, W5 protected
  Group/Social contracts, W6A admission/result/key recovery and accepted
  history-retention semantics, W6B/W6C schema/Station producers, W6D W5 and
  physical triggers, W7 native design and physical resources, W8 owner cutover,
  and W9 prerequisite/runtime proof. No diagnostic, root-cause fix, mechanical
  plan amendment, local Gate, or non-destructive runtime action can make the
  requested product outcome more true without crossing those boundaries. This
  is the third consecutive confirmation of the same fixed point; the
  persistent Goal is blocked until an Owner contract, deployment, explicit
  destructive authorization, or required physical resource changes.
- **Owner-reported Auth visual parity defect (2026-09-13)**: the supplied
  iPhone 17 Pro screenshot reopens one Mobile-owned W2/W6D action without
  changing the blocked Messaging branch. Desktop Auth and shared UI Identity
  require one dominant card, the canonical square Peers app icon, compact
  hierarchy, and one primary recovery task. Production Mobile and the current
  Mobile prototype instead use a separate horizontal wordmark, a
  `PEERS TOUCH MOBILE` kicker, a bottom-anchored card, and an independently
  mounted expired-session recovery notice. Pre-fix native geometry in
  `debug-mobile-desktop-auth-parity.md` records a 112×38 wordmark and 209px
  unexplained brand-to-card gap on a 402×874 viewport; the supplied expired
  state additionally shows recovery occluding the form. Classification:
  `Implementation bug` plus `Prototype bug`; Desktop/shared Auth remains the
  higher design authority. Ready work is serialized under the integrator:
  synchronize the auth asset from Desktop's canonical icon, copy Desktop's
  card/header/tab/provider anatomy into a phone-width composition, integrate
  expired-session context into that card, suppress only its duplicate recovery
  notice during `access-gate-chain`, update the Mobile prototype, add focused
  regression coverage, and capture post-fix native geometry/screenshots.
  Station admission, identity, cursor, request, and key-recovery semantics are
  unchanged.
- **Auth visual parity source/native closure (2026-09-13)**: Desktop/shared
  Auth is now the sole visual source. Production and prototype use the exact
  canonical 512x512 Desktop icon, one 400px/24px-radius Auth card, compact
  header and provider hierarchy, friendly Station context, and an inline
  expired-session state. The unused second `StationAuthGate` implementation is
  deleted. Access-gate composition suppresses only the duplicate
  `device-local-flag/session-expired` overlay; every unrelated recovery state
  retains its existing owner and visibility. The exact-current-source arm64
  Simulator bundle has executable SHA-256
  `0376be051d73223ed64d492284b9e2d812508769294a3eaa93eb755e789cc717`,
  passes strict signing, and was installed in place on iPhone 17 Pro
  `2F07D83C-E300-4102-B88C-B39A192B9899` with its complete 44-file data set
  preserved path-for-path. Native geometry at 402x874 proves one card, brand
  inside the card, a 72x72 logo, zero brand-to-card gap, zero recovery overlap,
  no Mobile kicker, no raw Station address, and no viewport overflow. The direct
  expired-session prototype state passes the same invariants at 1440x1100,
  554x954, and 390x844; all 51 current-source captures report zero defects.
  Focused Auth/Recovery tests, Mobile Web checks/build, 16 checker regressions,
  four contract-static regressions, prototype build, and Mobile Domain
  structural validation pass. The ordinary shell-contract command remains
  blocked only by the separate retained `[OPEN]` OAuth debug `fetch`; this
  defect's debug session remains `[OPEN]` until Owner visual confirmation.
- **Final reconciliation ownership**: all three sync/prototype lanes have
  returned. The integrator serially owns final documentation, read-only
  proof-gap/preservation checks, and active-work synchronization. Independent
  read-only checks may run concurrently; no further source writer or native
  automation session is active. Prior test handles expired across compaction;
  saved post-fix artifacts were read directly, and the prototype build plus
  long-list runner were repeated with observed exit zero. New development
  changes after the merge-preservation audit are intentional, not lost
  snapshot content and not grounds for reapplying either stash.
- **Final preservation audit**: all 112 originally untracked files still
  exist. None of the eight original/incoming deleted paths was resurrected.
  The only originally present path now absent is the intentionally retired
  shell scanner whose six rules and two regressions moved to the Node owner.
  The archive hash still matches, both stash OIDs remain retained, and the
  index has no staged or unmerged entries. `git diff --check` passes.
  Native PIDs 86062/87700 remain running; no owned browser/build runner,
  Appium/WDA listener, or debug collector listener remains. The collectors
  were idle-bounded; all `[OPEN]` files and instrumentation are retained.
  The Make Portal remains on port 3262, and the external
  `env/peers-touch/mobile-shell-acceptance` directory remains absent.
- **Proof-gap audit**: the D-20 projection
  `20260912T144715807235Z-c34298f5106ea571aa144748a3f5d348` covers 1381 paths
  from the unchanged initial HEAD through the worktree and selects the same
  seven W6A local Gates. The read-only detector API uses
  `changed_paths_for_plan`, not its legacy `HEAD` default. It returns
  `UNPROVEN` for bidirectional native messaging and receiver restart history:
  the latest focused run has no Mobile receiver Gate, and imported Desktop
  history carries separate receiver obligations outside Mobile ownership.
  Missing Gates in that focused run do not erase the earlier three local
  passes or turn the earlier aggregate into a pass. No product Gate was rerun.
  The CLI currently opens an `ArtifactSession` despite its read-only skill
  contract, so this audit called the existing detector API without writing or
  editing evidence. Range/scope and read-only CLI alignment belong to the
  Acceptance tooling owner, not a Mobile proof waiver.
- **Queue after this batch**: no further action in the currently admitted
  source/render/package batch remains. The dependencies below still fence
  their actions. This is a batch checkpoint, not `IOS_SOURCE_COMPLETE`,
  full-plan completion, or a Goal-level blocked claim. `active_work` remains
  `EXECUTE`, with no new formal workstream closed and no repeated-blocker
  threshold inferred from historical failures.
- **Implementation-first frontier reopened (2026-09-13)**: a fresh full-source
  audit supersedes the narrow batch checkpoint above. The following
  architecture-defined defects are dependency-ready and must be implemented
  before broad Acceptance execution:
  1. W2 Station Access Gate fail-closed behavior for configured but unregistered
     gate types and exact current `attempt_id + gate_id + type` submission
     binding;
  2. W5 production mutation admission from the existing shared-ingress
     read-only state;
  3. W3/W6D propagation of native Messaging worker failure and network
     disconnect/recovery into lifecycle readiness and `RecoveryProjection`;
  4. W5/W6A adaptation of canonical Conversation update and dissolve commands,
     while group-wide mute remains owner-blocked;
  5. W6C separation of Profile availability from missing account-preference
     contracts and consumption of already-generated Notification preferences;
  6. W4/W6D owner-backed draft restoration with visible failure instead of
     discarded or fabricated-empty outcomes;
  7. W6B traversable bounded Moments pagination with bounded explanation
     metadata;
  8. W6C mandatory save/discard/stay navigation and remaining W6A component
     ownership cleanup.
- **Current implementation batch and concurrency**: hybrid. One isolated
  Station lane owns only Access Gate registry/policy/submission hardening,
  Dashboard option alignment, and focused tests. One Mobile runtime lane owns
  only Messaging readiness/error and native network recovery projection plus
  focused tests. One Mobile recovery lane owns only draft-recovery dispatch and
  focused tests. The integrator owns this plan, shared/generated contracts,
  locale catalogs, Acceptance mapping, runtime resources, reconciliation, and
  all later Gates. Subsequent write-admission, Group adapter,
  Profile/Notification, Moments pagination, and UI-ownership batches start only
  after conflicting shared runtime/store paths from this batch are reconciled.
  Each lane runs focused tests; the seven W6A local quality Gates run once after
  implementation convergence, in line with the Owner's implementation-first
  directive.
- **Post-batch source-frontier audit (2026-09-13)**: the eight reopened items
  above are implemented and pass the combined focused checks, but source freeze
  remains open on three dependency-ready Mobile defects:
  1. move Moment detail/comment freshness out of the page-mounted hook into the
     session-scoped Moments runtime projection, and keep rendered comments
     bounded or virtualized with stable identity;
  2. generation-fence overlapping feed refresh/page requests so a late page
     cannot publish into a replacement refresh projection;
  3. generation-fence current-user and peer-profile cache/readback publication
     so results from a replaced Station/PTID session are discarded.
  Execution remains hybrid: one Moments lane serializes the first two changes
  because they share projection ownership and store state, one independent
  Profile lane owns only Social profile publication fencing, and the
  integrator owns this plan, shared contracts, reconciliation, final
  `pnpm mobile:check`, and all later Gates. Broad Acceptance remains deferred
  until these source items converge.
- **Post-fix source-freeze audit (2026-09-13)**: the feed latest-wins fence,
  runtime-held detail/comment projection, bounded comment retention/rendering,
  and in-memory Profile publication fences pass focused tests, but four
  dependency-ready closure defects remain before source freeze:
  1. Social runtime reconciliation must refresh the retained selected Moment
     detail/comments together with the feed;
  2. inline comment success must perform authoritative runtime readback before
     clearing the accepted input;
  3. Moments retry must restore availability only after successful runtime
     reconciliation;
  4. lifecycle teardown must drain tracked Profile cache operations before
     replacing or clearing their Station/PTID scope, so a late write cannot
     repopulate a cleaned scope.
  These fixes remain serialized under the integrator because they touch shared
  runtime/store lifecycle contracts. The seven local W6A Gates remain deferred
  until this final source correction passes focused and integrated checks.
- **Final retry-ownership audit (2026-09-13)**: authoritative readback now
  controls inline and detail comment success, full Moments reconciliation
  fails on feed, retained-detail, or retained-comment failure, and Profile
  writes drain before lifecycle scope replacement. Source freeze remains open
  only until the detail/comment retry controls dispatch the runtime-owned retry
  intent and both feed and detail rendering subscribe to the runtime
  availability projection. No new product or architecture decision is needed.
- **Implementation-first source freeze (2026-09-13)**: the final retry
  ownership correction is complete. The session-scoped Moments runtime now
  owns feed, selected-detail, and bounded per-post comment freshness; normal,
  realtime, resume, and user-retry reconciliation share that owner. Feed,
  detail, comment, teardown, and session-replacement late results are fenced.
  Inline and detail comment drafts clear only after authoritative readback.
  Profile cache writes are tracked and drained before lifecycle scope
  replacement, and late Profile publications remain fenced to their exact
  session, gateway, and storage owners. Comment rendering uses a stable
  100-row window over at most 200 retained comments per thread and 20 retained
  threads. Production mutation admission, canonical Group update/dissolve,
  Profile/Notification separation, the app-scoped device-settings runtime,
  Settings save/discard/stay, and Chat component boundaries are reconciled.
  Full Mobile Vitest passes `508/508`; `pnpm mobile:check`, Social wire/runtime
  boundary checks, TypeScript, production Web build, Rust check, Xcode project
  validation, contract-checker tests, Acceptance planning, binding
  verification, and diff hygiene pass. Broad product/native proof remains
  `UNPROVEN`; execute the seven current W6A local Gates next.
- **W6A local Gate closure (2026-09-13)**: aggregate run
  `20260912T190822974646Z-429e8df07a830bad7485ce8b610f346a`
  is `PASS/DONE/PROVEN` with all seven planned local Gates passing and zero
  failed, blocked, partial, unproven, or missing-traceability results. The
  run used an isolated Python 3.12 environment with the repository-pinned
  Acceptance requirements. `mobile-contract-static` now excludes only
  explicitly bounded retained debug regions from production OAuth-authority
  scanning; unclosed regions and production code remain scanned. The generic
  launch-context clock-translation fixture now derives a positive child-clock
  deadline independently of host uptime without changing production timeout
  semantics. Post-Gate verification passes 82 focused Python regressions,
  `pnpm mobile:check`, Mobile Domain structural validation for all six
  capabilities, binding verification, and diff hygiene. This closes the local
  W6A implementation/Gate batch only; two-actor/two-Station receiver behavior,
  restart history, physical cells, and owner-blocked contracts remain
  `UNPROVEN`.
- **W5/W8 caller reconciliation (2026-09-13)**: the current hard-cut scanner
  reports six protected-owner callers, not the historical eight. Canonical
  Conversation update and dissolve commands removed two callers. The remaining
  set is Group member update and ownership transfer plus Social block, unblock,
  blocked-user listing, and directional friendship status. This is a
  mechanical plan correction only; removing those callers before their owners
  provide replacement contracts would still drop accepted behavior.
- **Post-Gate fixed-point audit (2026-09-13)**: two independent read-only
  audits found no remaining dependency-ready Mobile-owned source action.
  Actor Identity still has no identity-preserving continuity recovery;
  Conversation Inbox still has no Station-generation-aware cursor recovery;
  Station's typed handler can still emit an empty protobuf error body when
  given a non-protobuf error projection; and Key Exchange has no safe
  retained-client prekey recovery contract. The authenticated Social Friend
  Request result lookup is source-complete in this worktree, but it is not
  deployed and cannot independently recover the retained two-client journey.
  A read-only gap-detector invocation keeps bidirectional simulator delivery
  and restart history `UNPROVEN` because
  `mobile-simulator-social-convergence-e2e` and
  `mobile-simulator-chat-contacts-e2e` have not run against a runtime that
  satisfies those owner prerequisites. No identity, key, cursor, database,
  draft, Direct state, or original Friend Request was reset or replaced.
- **Native delivery continuation (2026-09-13)**: the preceding fixed-point
  audit covered source and local Gates, not installation of the newest
  implementation batch. Reopen IOS-I0/W6A development delivery: compare the
  installed package and embedded assets with the frozen source, build once
  after any focused source corrections, update the two retained simulator
  apps in place, and verify launch and data preservation. This does not admit
  another login, request, key/cursor recovery, Station deployment, or reset.
  Concurrency is hybrid: one read-only lane may inspect the latest
  runtime-owned projection/lifecycle changes for concrete defects; the
  integrator exclusively owns source corrections, shared files, native build
  output, both simulator resources, evidence, and plan reconciliation.
  Reuse the existing approved remote profile through process-local selection;
  do not create an aggregate profile or persist runtime topology in `env`.
- **Delivery-blocking W6B correction (2026-09-13)**: the focused runtime audit
  identified three dependency-ready defects in the latest batch: superseded
  detail reconciliation can disable a healthy domain, inline comment success
  refreshes the first feed page instead of the affected post, and auxiliary
  comment/reaction metadata survives bounded projection eviction. The
  integrator owns the store, runtime consumer, page command adapter, and their
  existing tests serially. Preserve the accepted latest-wins cancellation,
  target-specific authoritative readback, pagination/selection, and retention
  contracts. `debug-moments-readback-fencing.md` records reproduction.
  Source freeze and native build wait for these corrections; the existing
  seven-Gate W6A closure runs once after the combined implementation settles.
- **W6B delivery correction source checkpoint**: five new pre-fix assertions
  failed; all 48 focused store/runtime/page/detail regressions now pass.
  Superseded reads cannot alter domain availability or cursor freshness,
  inline comments read back the exact post and comments without replacing
  pagination/selection, evicted comment requests cannot repopulate the cache
  or reuse an old request ID, and settled reaction metadata is bounded by
  retained posts while pending ownership survives until settlement. Web
  boundary/type checks pass. The current source can proceed to full Mobile
  unit verification and one native build; prior installed binaries are stale.
- **Current iOS delivery checkpoint (2026-09-13)**: full Mobile Vitest passes
  `522/522` across 72 files and `pnpm mobile:check` exits zero. One current
  arm64/iPhoneSimulator bundle passes strict signing, application ID and
  callback checks. Both retained apps now have executable SHA-256
  `9fa509926dad6bf9feaed4bc2603ed2baaabcaab2071e87424ba36a5328b5356`.
  In-place installation preserved every captured regular data file byte for
  byte: Alice 61, Bob 43; only CoreSimulator container metadata was excluded.
  Keychain content was not inspected or directly modified. Appium setup initially left
  Alice without a running app; launching through `simctl` after session
  creation exposed the correct native WebView on both devices. Both load
  `/assets/index-BVLBpDQ6.js`, render the actual Station-entry surface, and
  have no horizontal overflow. These are development delivery observations,
  not source-attested product Gates, Auth parity proof, message delivery, or
  restart-history evidence. No login, replacement request, key/cursor reset,
  Station deployment, or data reset occurred. Automation cleanup and one fresh
  seven-Gate local W6A aggregate remain ready; the earlier aggregate is
  historical for this changed source.
- **Detail reaction follow-up (2026-09-13)**: the fresh seven-Gate W6A run
  passed, and native development diagnostics are preserved in External
  Evidence Store run
  `20260912T235708650128Z-4d8afc1ebcde358f7c5b8cbe87d7fbff`
  (`mobile-ios-delivery-diagnostic`, `PARTIAL/UNPROVEN`). Automation processes
  and all five allocated ports are released; both retained apps stay running.
  A final W6B code audit found reaction admission/publication limited to feed
  rows although selected authoritative details can outlive those rows. Admit
  diagnosis and a source-backed correction under MS-J05, tracked by
  `debug-moments-detail-reactions.md`. The integrator exclusively owns
  `momentsFeedStore.ts` and its existing regression file, serially because
  both paths share reaction ownership. Do not create a page-owned projection,
  expand the feed, change layout/lifetime, or weaken admission. After focused
  verification, rebuild and deliver the changed source before the final local
  Gate run; previous build/Gate evidence remains tied to its earlier source.
- **Detail reaction source checkpoint**: eight added regressions reproduced
  the detail-only no-op, split feed/detail reaction state, and stale-feed
  admission. The existing store now resolves the selected authoritative post,
  publishes reaction transitions to both retained representations, rejects
  non-available detail, and retains pending ownership only until settlement.
  It does not insert detail posts into the feed or change a newer selection.
  All 56 focused tests, 530 full Mobile tests, `pnpm mobile:check`, and diff
  hygiene pass. No layout, copy, prototype, or alive-policy change was needed.
  Final current-source native delivery and the seven local Gates are ready.
- **Final delivery and local verification (2026-09-13)**: both retained iOS
  apps now run executable SHA-256
  `66141d1b0abb342ffdda3424db0aa79c349c907f749222a788bfe40a9157a072`
  and live embedded asset `/assets/index-Deu16qP5.js`. The final in-place
  installation again preserves all 61 Alice and 43 Bob captured files.
  Screenshots and WebView observations show Alice's retained expired-session
  Auth surface and Bob's Station-entry surface, both at 402x874 without
  overflow. The final diagnostic run is
  `20260913T000826587131Z-adbc641e874d3deba5585ec0d1593d20`
  under `mobile-ios-delivery-diagnostic`; it deliberately remains
  `PARTIAL/UNPROVEN` for product proof. Sessions, Appium, both WDA/Xcode
  processes, and all five automation listeners are released; installed apps,
  retained data, and open debugger instrumentation remain.
  Aggregate `20260913T000635219880Z-7ecb16303283993de65a90ef028badfa`
  passes all seven local W6A Gates with `DONE/PROVEN`, zero failures or
  missing traceability, source commit `771605c8d768ea3ef73a1b9b1a63befae354292f`,
  and workspace digest
  `sha256:1a8aa0611225c3251cdfb13a05f8f062aa187c8dfb3b71336465256226489792`.
  Full Mobile tests pass `530/530`; `pnpm mobile:check` and six-capability
  Domain structural validation pass. The exact-range read-only Gap Detector
  keeps communication/restart-history `UNPROVEN` with 17 unrun required
  Gates; this is not permission to execute completion/full scopes.
- **Current frontier**: the source corrections, native delivery, local Gates,
  and automation cleanup admitted in this continuation are complete. The
  Ready Queue is empty after reconciling section 6.1 and the Parked Queue
  below. No identity-preserving recovery contract, Inbox generation recovery,
  typed Station error contract, or retained-key recovery input changed.
  Original Social request lookup remains undeployed; six W5/W8 caller
  replacements, generic Access Gate semantics, media/preferences/native
  lifecycle decisions, physical resources, and final receiver proof remain
  parked with their named owners. This is an exhaustion checkpoint, not
  `IOS_SOURCE_COMPLETE`, full W6A completion, or Mobile readiness. No commit,
  push, PR, branch/worktree operation, Station deployment, destructive reset,
  replacement request, or debugger cleanup occurred.
- **Owner-dependency revalidation (2026-09-13)**: the first automatic
  continuation after final native delivery reverified the immutable binding
  and audited the remaining owner edges without repeating product Gates.
  Two read-only lanes inspected recovery contracts and the remaining
  Access Gate/Group/Social/preferences/native contracts; all integration,
  source writes, deployments, runtime resources, and final decisions remain
  integrator-owned. Canonical owner commit
  `12cd7b678fcbf74361c32dc62a540520875cbf2c` adds portable prekey inventory
  reconciliation, a durable fresh-OPK batch, and Station missing-bundle
  detection. It exists under owner HEAD
  `98943699e45a42f6e1fd7a9bd203c69f0442f501`, but is absent from the bound
  Mobile source and from live Station build `7e148f83bd7b`. The latter
  reports build time `2026-09-12T23:41:57Z`; its Actor Identity, Conversation,
  Key Exchange, typed server, Core, and Chat/Key Exchange proto sources are
  unchanged from the Mobile bound HEAD.
  The prekey candidate is not yet a retained-client recovery guarantee:
  Core retries a persisted pending batch, while Station creates absent OPK
  rows as unconsumed. The owner must confirm and prove the supported
  state-loss/retry boundary, including no consumed OPK reactivation after
  lost publication acknowledgment and Station material loss. This is an
  unproven safety boundary, not a demonstrated exploit or permission to reset.
  Only after that contract, coordinated source integration, and deployment
  are available may Mobile implement the canonical
  `PreKeyInventoryRepository`/`PreKeyInventoryTransport` adapters and call
  Core reconciliation. Do not copy that state machine into Mobile or
  automatically cherry-pick the owner commit.
- **Remaining-contract audit**: no independent source action became ready.
  Generic gate schemas still lack typed submission and non-OAuth final
  credential delivery; password login currently revokes a non-granted
  candidate while invite completion returns a decision only. Canonical
  `CHANGE_ROLE` exists in proto but the Core preparation path rejects it;
  atomic ownership transfer and administrator-targeted mute still lack
  executable owner contracts. Social blocking has only internal symmetric
  checks, not the required directional mutation/list/readback APIs.
  Notification preferences already have a generated API and Mobile consumer;
  they are not unfinished work. Remaining account/privacy, APNs/token/tap,
  BGTaskScheduler, and native media-picker result lifecycles still need
  their accepted owner semantics. Actor continuity, Inbox generation recovery,
  and protobuf conflict serialization remain unchanged. The Ready Queue
  stays empty; the prekey candidate refines the Parked Queue rather than
  making the full plan complete.
- **Goal-level blocked checkpoint (2026-09-13)**: the second automatic
  continuation confirms the same owner-contract boundary for the third
  consecutive Goal turn, counting the implementation/delivery turn.
  Immutable Mobile binding and canonical owner HEAD
  `98943699e45a42f6e1fd7a9bd203c69f0442f501` are unchanged; live Station still
  reports `7e148f83bd7b`. Agent branch HEAD advanced to
  `bf1af73241b76e4e7b3b857aa29091dbf63fcda9`, but its relevant
  Actor/Conversation/Key Exchange/typed-server/Core/proto and governing
  Mobile/Access Gate/Messaging architecture sources have no delta from that
  live build. No parked action became dependency-ready.
  Source remediation, native delivery, local verification, owner-contract
  inspection, cleanup, and tracking reconciliation have been exhausted.
  Remaining actions require accepted owner semantics, coordinated protected
  source integration/deployment, or unavailable declared physical/Fixture
  resources. Repeating Gates, copying Core into Mobile, resetting retained
  state, or dropping accepted features cannot satisfy those prerequisites.
  Mark Goal `6aa5de53f7a051f248ec23d4` and `active_work.blocked` as blocked;
  retain plan status `active`, stage `EXECUTE`, current closure `W6A`, and
  formal completion `3/15`. Resume only after a recorded prerequisite changes,
  then recompute the full Ready/Parked frontier and verify the same binding.
| Parked action | Blocking owner or input | Resume condition |
|---|---|---|
| Original two-iOS communication and request recovery | Actor Identity continuity, Conversation Inbox generation/cursor recovery, Station typed protobuf errors, Social command result, Key Exchange/Core | Land identity-preserving continuity recovery, generation-aware Inbox recovery, typed conflict responses, authoritative result evidence, and safe retained-key recovery; reuse original identities and request, then verify both directions and receiver restart |
| Canonical prekey inventory reconciliation in Mobile | Core/Key Exchange owner candidate `12cd7b678fcbf74361c32dc62a540520875cbf2c`; source integration and deployment | Owner confirms loss/retry and OPK non-reactivation guarantees; integrate the coordinated owner change, then implement Mobile persistence/transport adapters against its canonical traits |
| General history paging and retention | Messaging architecture/Core and Mobile | Accepted ordering, pending promotion, and retention budget |
| Generic Access Gate render/submit/finalize; forward/delete; remaining W5 administration and relationships | Access Gate/Auth and Conversation/Group/Social owners | Accepted payload/finalizer and command/readback contracts land; adapt Mobile without creating another authority |
| Restored media, account preferences, APNs/tap, background scheduling, native media picker | Respective schema/Station/native architecture owners | Accepted producer and lifecycle semantics |
| Fresh-request Federation-only Fixture and formal W9-D | Acceptance business owner, W5/CA proof, dynamic bindings and authorization | Approved Fixture semantics and unchanged environment/provisioning prerequisites |
| Physical and final Mobile proof | Signed devices, Appium, provider credentials, preceding workstreams | Resources and prerequisite proof become available; no simulator substitution |
| devctl stop and Acceptance consumer alignment | Developer-toolchain and Acceptance Infra owners | Bounded async stop and plan/range/read-only consumer fixes; do not move Mobile lifecycle or expand its scope |

| Current assertion | Evidence state | Missing closure / owner |
|---|---|---|
| New lifecycle/readiness paths select lifecycle and receiver regressions | `STRUCTURAL_ONLY`, mapping regression passed | Runtime Gates remain unrun; EXECUTE |
| Harness delegates Contact-to-Message to its production owner | Source tests and Web build passed | Fixture-scoped simulator/native execution remains unproven |
| Fresh-login failure does not render empty Chat | Native development observation only | Source-bound W3/W6D product Gate; Mobile |
| Async failure remains truthful through retry and Harness readback | Eight new source regressions passed | Repeatable native activation-failure trigger; owner contract |
| Prototype recovery/contact layouts are usable | Post-fix 48 rendered checks have zero defects; images inspected | Full parity and Owner confirmation remain open |
| W6A large lists/history remain reachable | Source/component checks pass; 1,250-row traversal and 56 search cases verified; prototype request/member/search subset also has 40 passing assertions | Native search/product proof, projection-memory and AS-14 remain open |
| Mobile preserves private MIME when completing an opaque attachment | 165 Rust tests and 12 journey regressions pass; pre/post collector evidence | Authenticated native attachment receiver proof remains unproven |
| Both retained iOS apps run the integrated post-merge package | Matching executable SHA-256, strict signing, installation, and launch readback | Not formal source attestation, identity admission, or communication proof |
| Native summary read equals retained empty history | Current package `33169bb5...` selects both exact deterministic profiles and returns null last message, zero unread, and history-tail equality from the same retained Direct | Nonempty history, receiver proof, and active-history memory bounds remain unproven |
| Native Contact-to-Message opens Direct | Earlier development observation: both original profiles opened the same canonical Direct | Alice is fenced by `ACTOR_IDENTITY_CONTINUITY_CONFLICT`; Bob is fenced by `DEVICE_INBOX_ITEM_NOT_HEAD`; missing command-result and key recovery remain downstream |
| Fresh request uses a real Federation without pre-acceptance | `BLOCKED/UNPROVEN` | Federation-only Fixture binding and cleanup contract; DESIGN |
| Two installed apps exchange messages and retain receiver history | `BLOCKED/UNPROVEN` | Actor Identity continuity recovery, Conversation Inbox generation/cursor recovery, typed Station errors, original result, safe key recovery, then native communication; protected owners and Mobile |

## 7. Workstreams

### W-1: Latest-Master And Worktree Isolation Preflight

Responsibility:

- Establish a clean, reviewable implementation base before any W0-W9 change.

Deliverables:

- Create or select a dedicated Mobile Shell implementation worktree and branch
  whose merge-base is current `origin/master`.
- Port only reviewed Mobile and cross-architecture
  PRODUCT/DESIGN/Prototype/plan changes.
- Inventory and preserve unrelated dirty changes outside the implementation
  worktree.
- Record source commit, branch, changed-path allowlist, and clean baseline.

Gate:

```bash
git fetch origin master
test "$(git merge-base HEAD origin/master)" = "$(git rev-parse origin/master)"
git status --short
git diff --name-only origin/master...HEAD
```

Definition of done:

- The merge-base equals current `origin/master`.
- Every dirty or committed path belongs to the reviewed Mobile Shell scope.
- No implementation command has run in the mixed `merge-desktop-prototype`
  worktree.

Evidence:

- `tmp/evidence/mobile-shell/<run-id>/W-1/source-baseline.md`

Non-claim:

- A clean branch proves source identity only, not product behavior.

### DWF-B: Development Workflow D13 Self-Hosting Migration

Responsibility:

- Use this current active Mobile plan as the only authority to implement and
  prove DWF-D13, then atomically migrate this same plan into the first real Plan
  Package.

Architecture sources:

- `docs/architecture/engineering/development-workflow/README.md`
- `docs/architecture/engineering/development-workflow/design.md`
- `docs/architecture/engineering/development-workflow/data-model.md`
- `docs/architecture/engineering/development-workflow/decisions.md`
- `docs/architecture/engineering/development-workflow/integration.md`
- Decision `DWF-D13`.

Scope:

- Plan Package/Task parser, bounds, DAG, lifecycle and migration transaction.
- Development resource declaration port plus Session journal/transition CLI.
- Package-aware execution-plan/Acceptance selection.
- Workflow Skill, `active_work` and Context Anchor hard cut.
- Byte-preserving migration of this plan and all live references.
- Two independent reviews and adversarial local simulation.

Non-scope:

- Mobile product behavior or product contracts.
- Broad/native Mobile Acceptance.
- Commit, push, PR, deployment, reset or history rewrite.

Execution closures:

| Step | Deliverable | Exit evidence |
|---|---|---|
| DWF-B0 | DWF-D13 architecture and plan amendment | Review 1 has no unresolved blocker/high finding |
| DWF-B1 | `planctl`, Session journal, declaration CLI and package-aware parser | deterministic Node/Python tests |
| DWF-B2 | Package-aware Skill/Context Anchor implementation while legacy pointer remains authoritative | focused Skill tests; no live schema cutover |
| DWF-B3 | Prepared Mobile package, complete crosswalk and byte-identical archive | hash/cmp, package validation, zero live old-path refs |
| DWF-B4 | Adversarial simulation and Review 2 | dedicated Gate and independent review pass |
| DWF-B5 | Final locked hard cut and tracked handoff | legacy archived; package active with DWF-B current; register tracking; atomically advance to W5 |

Concurrency:

- B0 and every shared schema/cutover are serial.
- B1 may use parallel plan-tooling and Session-tooling lanes after schema freeze;
  their write sets are disjoint.
- B2, B3, B4 and B5 remain integrator-serialized.
- Mobile product files remain untouched.

Current B1 concurrency decision:

- Lane A owns `tooling/scripts/plan/**` and implements the frozen Plan Package,
  Task Slice, DAG, bounds, scope-containment and `planctl` contracts.
- Lane B owns `tooling/scripts/local-dev/dev-work*`,
  `tooling/scripts/local-dev/dev-session*` and the shared machine Dev path
  helper. It ports the declaration baseline, fixes injected-clock and symlink
  invocation regressions, and implements the replayable Session journal.
- The integrator exclusively owns `tooling/acceptance/**`,
  `tooling/make/local-dev.mk`, shared parser interfaces, plan/status updates,
  generated artifacts and final Gates. These stay serial because they consume
  both lane interfaces and include currently dirty shared Acceptance files.
- The barrier is Lane A/B deterministic test passage. Reconciliation checks
  schema identity, path containment, error vocabulary and direct/symlinked CLI
  behavior before any Acceptance or Make integration.

Failure behavior:

- Any state-owner ambiguity returns `DESIGN_AMENDMENT_REQUIRED`.
- Schema, scope, binding, transition, journal or migration mismatch fails before
  partial mutation.
- Migration discovery fails closed only while a live lock exists or journal phase
  is `LOCKED/APPLYING/VERIFYING/ROLLING_BACK`; `PREPARED` remains readable.
- A failed review or simulation reopens the owning B-step; it never weakens a Gate.

Acceptance scenarios:

#### DWF-AS01: Current Plan Self-Hosts

- Start with this plan as the sole active plan and DWF-B current.
- Build/validate the generic tooling without activating a second plan.
- Preserve W6A status, dependencies, product assertions and evidence.

#### DWF-AS02: Bounded Resume

- Resolve the manifest current Task, read that Task and replay its Session.
- Do not load archive or unrelated Task bodies into agent context.
- Reject stale active-work pointers and repair only from manifest/Session owners.

#### DWF-AS03: Failure And Recovery

- Reject invalid DAG, bounds, write-set escape, identity drift and illegal transitions.
- Replay missing/stale Session snapshots, compact bounded journals and preserve digests.
- Under every migration failpoint, finish or roll back to exactly one active plan.

#### DWF-AS04: Final Handoff

- Verify archive bytes/hash and every workstream/status/DAG/Gate/evidence crosswalk.
- Publish the Mobile package as `active` with `DWF-B` current in one locked
  migration transaction, then register `active_work` against that recoverable
  manifest state.
- Use `planctl advance` to close DWF-B and select `W5`; preserve every proof
  blocker and continue source work without treating physical proof as a source
  prerequisite.

Gate:

```bash
node --test tooling/scripts/plan/planctl.test.mjs
node --test tooling/scripts/local-dev/dev-work.test.mjs \
  tooling/scripts/local-dev/dev-session.test.mjs
python3 -m unittest tooling.acceptance.tests.test_execution_plan
python3 tooling/scripts/acceptance-run.py \
  --gate development-workflow-control-plane
tooling/scripts/review/skill-check.sh
```

Definition of done:

- DWF-AS01..DWF-AS04 pass.
- Both independent reviews have no unresolved high/medium finding.
- The migrated Mobile package is the sole live plan; `active_work` first
  mirrors current DWF-B, then manifest and projection advance to `W5` while
  preserving the W6A partial frontier plus exact proof blocker ownership.
- No Mobile product readiness claim changes.

### W0: Mobile Acceptance Domain Onboarding And Baseline

Responsibility:

- Connect the accepted Mobile assertions to the existing `mobile` Acceptance
  Domain before any product claim.

Acceptance classification:

| Field | Value |
|---|---|
| Mode | ADD |
| Domain | existing `mobile` entry, currently `planned/not_onboarded` |
| Truth owners | Station business domains, Mobile Rust/runtime owners, native platform adapters |
| Receivers | iOS and Android Mobile users |
| Runtime cells | local static, iOS simulator/device, Android emulator/device, two-Station/two-actor environment |
| Existing proof | Prototype L1/L2/L3 design evidence only; production proof UNPROVEN |

Stable Acceptance IDs:

| Capability ID | Feature ID | Product assertions | Required Gate IDs |
|---|---|---|---|
| `mobile-station-access` | `mobile-station-trust` | MS-PA01, MS-PA16, MS-PA25 | `mobile-contract-static`, `mobile-identity-contract`, `mobile-native-access-e2e` |
| `mobile-station-access` | `mobile-access-gate-oauth` | MS-PA02, MS-PA03, MS-PA17, MS-PA25 | `mobile-contract-static`, `mobile-native-access-e2e` |
| `mobile-runtime-lifecycle` | `mobile-session-lifecycle` | MS-PA04, MS-PA05, MS-PA13, MS-PA14 | `mobile-contract-static`, `mobile-simulator-runtime-lifecycle-e2e`, `mobile-simulator-station-lifecycle-e2e`, `mobile-native-lifecycle-e2e` |
| `mobile-command-recovery` | `mobile-command-draft-recovery` | MS-PA07, MS-PA08, MS-PA23, MS-PA26; proposed Friend Request join: MS-PA09, MS-PA19 | `mobile-contract-static`, `mobile-hard-cut-static`, `mobile-native-recovery-e2e` |
| `mobile-command-recovery` | `mobile-recovery-degraded-states` | MS-PA14, MS-PA22, MS-PA23, MS-PA25, MS-PA26, MS-PA27 | `mobile-native-recovery-e2e`, `mobile-native-recovery-ui-e2e` |
| `mobile-social-product` | `mobile-chat-contacts-groups` | MS-PA06, MS-PA09, MS-PA10, MS-PA18, MS-PA19 | `mobile-native-social-convergence-e2e`, `mobile-native-chat-contacts-e2e` |
| `mobile-social-product` | `mobile-moments-participation` | MS-PA11, MS-PA20, MS-PA23 | `mobile-native-social-convergence-e2e`, `mobile-native-moments-e2e` |
| `mobile-social-product` | `mobile-profile-settings` | MS-PA12, MS-PA13, MS-PA21, MS-PA24 | `mobile-native-social-convergence-e2e`, `mobile-native-settings-e2e` |
| `mobile-native-quality` | `mobile-native-accessibility-performance` | MS-PA15, MS-PA24, MS-PA25, MS-PA27 | `mobile-native-platform-e2e`, `mobile-hard-cut-static` |

No implementation step may rename or merge these IDs. Any ID change is a plan
amendment because Registry, Capability, Feature, Gate, and evidence references
must remain stable.

Runtime Resource Manifest:

```yaml
environment_id: mobile-native
tier: env-evidence
profile:
  name: mobile-native
  slot: 0
  required: false
  identity_match: false
  semantics: manifest environment label only; no active dev profile
services:
  station-primary:
    kind: station
    mode: remote
    endpoint_ref: env:PT_MOBILE_STATION_PRIMARY_URL
    deploy_environment_ref: env:PT_MOBILE_STATION_PRIMARY_DEPLOY_ENV
    health_action: station-check
    status_action: station-status
    attestation_producer: station-deployment
  station-secondary:
    kind: station
    mode: remote
    endpoint_ref: env:PT_MOBILE_STATION_SECONDARY_URL
    deploy_environment_ref: env:PT_MOBILE_STATION_SECONDARY_DEPLOY_ENV
    health_action: station-check
    status_action: station-status
    attestation_producer: station-deployment
  relay:
    kind: relay
    required: true
    endpoint_ref: env:PT_RELAY_URL
    deploy_environment_ref: env:PT_RELAY_DEPLOY_ENV
    health_endpoint_ref: env:PT_RELAY_HEALTH_URL
    health_action: relay-check
    status_action: relay-status
clients:
  - id: alice-ios
    actor: alice
    runtime: tauri-ios
    destination_ref: env:PT_MOBILE_IOS_DESTINATION
    profile: mobile-shell-alice-ios
    ports: dynamically allocated and recorded before launch
    storage_root: <runtime-home>/acceptance/mobile-shell/<run-id>/alice-ios
  - id: bob-ios
    actor: bob
    runtime: tauri-ios
    destination_ref: env:PT_MOBILE_IOS_DESTINATION
    profile: mobile-shell-bob-ios
    ports: dynamically allocated and recorded before launch
    storage_root: <runtime-home>/acceptance/mobile-shell/<run-id>/bob-ios
  - id: alice-android
    actor: alice
    runtime: tauri-android
    destination_ref: env:PT_MOBILE_ANDROID_PHYSICAL_DESTINATION
    profile: mobile-shell-alice-android
    ports: dynamically allocated and recorded before launch
    storage_root: <runtime-home>/acceptance/mobile-shell/<run-id>/alice-android
  - id: bob-android
    actor: bob
    runtime: tauri-android
    destination_ref: env:PT_MOBILE_ANDROID_PHYSICAL_DESTINATION
    profile: mobile-shell-bob-android
    ports: dynamically allocated and recorded before launch
    storage_root: <runtime-home>/acceptance/mobile-shell/<run-id>/bob-android
credentials:
  - source: committed disposable actor fixture
    path: apps/station/app/conf/actor.yml
    redact: true
  - variable: MOBILE_ACCEPTANCE_GITHUB_ACCOUNT
    source: approved secret
    redact: true
  - variable: MOBILE_ACCEPTANCE_GOOGLE_ACCOUNT
    source: approved secret
    redact: true
fixture:
  id: mobile-native-actors
  setup: python3 -m tooling.acceptance.fixtures.mobile_native_reset --prepare
  reset_authorization: env:MOBILE_ACCEPTANCE_RESET
  target_assertion: station-two and station-three are approved disposable targets
  initial_assertion: alice and bob have isolated PTID/device identities on both Stations
  teardown: python3 -m tooling.acceptance.fixtures.mobile_native_reset --cleanup
harness:
  namespace: __PEERS_MOBILE_ACCEPTANCE__
  policy: production actions only; direct Store mutation forbidden
evidence:
  - source commit and workspace digest
  - Station/Relay deployment attestations and peer IDs
  - per-client runtime, actor PTID, device ID, profile, ports, and storage identity
  - screenshots, AX trees, DOM/state projections, typed readbacks, redacted logs
cleanup:
  - close clients and native driver sessions in reverse acquisition order
  - release dynamic ports
  - remove per-run storage
  - revoke fixture sessions and restore/reset fixture data
  - release profile and deployment leases
```

Resource rules:

- The block above is the Environment Provisioning requirement. The immutable
  runtime output is the canonical `RuntimeManifest.services` map defined by
  Acceptance Framework D-13; each required role carries source-bound live
  attestation fields.
- `PT_MOBILE_IOS_DESTINATION` and
  `PT_MOBILE_ANDROID_PHYSICAL_DESTINATION` are required; actual devices are
  resolved from four fenced physical-device leases, and no simulator/emulator
  fallback may be chosen silently.
- Dynamic ports are allocated by binding port zero, then persisted in the run
  manifest before process launch.
- OAuth account variables are presence-checked and never printed or persisted.
- A missing Android generated project, destination, credential, Station
  attestation, or cleanup handler is `BLOCKED`, not permission to downgrade to
  browser or iOS-only evidence.

Deliverables:

- Add `check:mobile-shell-contracts`.
- Add `tooling/acceptance/domains/mobile.yaml`.
- Add `tooling/acceptance/capabilities/mobile.yaml`.
- Add the nine named Mobile Feature contracts from the stable-ID table.
- Add precise Mobile owned-path rules to `tooling/acceptance/registry.yaml`.
- Register stable local and environment Gate IDs in
  `tooling/acceptance/gates.yaml`.
- Add `tooling/acceptance/environments/mobile-native.yaml`,
  `tooling/acceptance/provisioners/mobile_native.py`,
  `tooling/acceptance/fixtures/mobile_native_reset.py`, the namespaced
  production Harness, and the exact cleanup policy above. These are business
  injection, not Acceptance Infra.
- Register `tooling/acceptance/plans/mobile-shell.json` covering
  `MS-PA01..MS-PA27`.
- Add deterministic fixtures for two actors, two devices, two Stations,
  disconnect points, revocation, overflow, and long content.
- Register the baseline interaction/resource evidence schema in W0. Capture
  pinned iOS/Android measurements in W9 after W7 provides both native runtime
  cells; W0 must not fabricate an early native baseline.

Gate:

```bash
pnpm mobile:check
pnpm --dir apps/mobile run check:mobile-shell-contracts
./tooling/scripts/proto-gen-mobile.sh
make acceptance-validate DOMAIN=mobile
make acceptance-coverage-report
make acceptance-plan ACCEPTANCE_RANGE=origin/master...HEAD
python3 tooling/scripts/acceptance-run.py --gate mobile-contract-static
```

Definition of done:

- The contract checker fails on identity aliases, manual domain DTO leakage,
  invalid runtime graphs, URL-keyed security state, duplicate command
  persistence, and retired adapters.
- Every owned Mobile path resolves through Registry -> Feature -> Capability ->
  Domain -> Gate without unrelated Gate selection.
- The runtime resource manifest names profiles, services, actor/device
  isolation, credential variable names, reset authorization, evidence identity,
  and reverse-order cleanup.
- Every acceptance row has a planned runtime cell and evidence path.

Evidence:

- Acceptance plan/run/validation roles in the external Evidence Store.
- `tmp/evidence/mobile-shell/<run-id>/W0/coverage-gap-matrix.md`.

Acceptance checkpoints:

- `ACCEPTANCE_REQUEST_CLASSIFIED`
- `ACCEPTANCE_SCOPE_INVENTORIED`
- `ACCEPTANCE_GAP_MATRIX_READY`
- `ACCEPTANCE_STAGE_DISPATCHED`
- `ACCEPTANCE_CONTRACTS_CONNECTED`
- `ACCEPTANCE_PLAN_SELECTED`

Non-claim:

- Structural onboarding and baseline collection do not prove native journeys.

### W1: Unified ActorRef Identity And Station Trust

Responsibility:

- Establish the only legal actor and Station scopes before credentials or
  durable local state can bind.

Deliverables:

- Implement the accepted repository-wide `ActorRef` PTID-only hard cut before
  relying on MS-P01 in Mobile.
- Implement MS-P07 challenge-signed Station handshake.
- Pin `station_peer_id` in the local registry after explicit first add.
- Partition session/cache/cursor/command/draft keys by Station peer ID and PTID.
- Reject missing PTID, signature failure, capability incompatibility, redirect
  identity change, and pinned-ID mismatch with typed errors.

Target areas:

- `model/domain/actor/`, `model/domain/auth/`, and every generated target.
- All non-generated `ActorRef` and numeric session consumers in Desktop Rust,
  Desktop TypeScript, Station Go, Mobile Web, and Mobile Rust.
- Station core/federation identity, JWT subject production/validation, Access
  Gate attempts, OAuth responses, and session persistence.
- `apps/mobile/src/features/station/`, `features/auth/`, storage projections.
- `apps/mobile/src-tauri/src/commands/station.rs`.

Deletion obligation:

- Reserve former `ActorRef.actor_id` field 1 and remove numeric identity from
  every API, event, JWT, Tauri command, generated adapter, client store, and
  session filename.
- Remove URL-only identity scope and `__default__` identity fallback.
- Complete the consumer inventory and tree-wide zero-reference scan before the
  cutover is marked done.

Gate:

```bash
./model/build.sh
./tooling/scripts/proto-gen-mobile.sh
(cd apps/station && go test ./...)
(cd apps/desktop && pnpm run check && pnpm run test)
pnpm mobile:check
python3 tooling/scripts/acceptance-run.py --gate mobile-identity-contract
```

- MS-AG01 and MS-AG02, including ten Station/actor switches and peer mismatch.

Evidence:

- `tmp/evidence/mobile-shell/<run-id>/W1/`.

Definition of done:

- All generated and handwritten consumers compile against PTID-only `ActorRef`.
- Numeric identity appears only in explicitly listed Station repository
  persistence adapters.
- Desktop, Mobile, and Station identity tests pass in the same source revision.

### W2: Access Gate And OAuth

Responsibility:

- Complete credentials as one gate action without creating a pre-authorized
  business session.

Deliverables:

- Implement MS-P02 OAuth attempt and MS-P03 complete/status/cancel contracts.
- Bind provider, Station peer ID, access attempt, gate, redirect, PKCE
  challenge, nonce hash, state, expiry, and one-time consumption.
- Add station-scoped `authRuntime`.
- Keep session candidates secure and inactive until final `access_granted`.
- Add GitHub/Google native browser and deep-link handling on iOS and Android.

Target areas:

- `model/domain/oauth/`, `model/domain/access_gate/`, `model/domain/auth/`.
- `apps/station/app/subserver/oauth/` and access-gate integration.
- `apps/mobile/src/features/auth/`, `apps/mobile/src/runtimes/`.
- `apps/mobile/src-tauri/src/runtime/oauth/` and native adapters.

Failure closure:

- Cancel, expiry, replay, duplicate consume, provider mismatch, Station
  mismatch, stale generation, and later-gate denial all fail closed.

Accepted amendment execution order:

1. **W2-A Security stop-the-line**
   - remove Authorization header values from logs;
   - derive legacy authorization actor identity from authenticated consent;
   - atomically consume legacy authorization codes.
2. **W2-B Model and Station finalizer**
   - add first-class `auth.oauth` gate semantics;
   - bind device ID, lifecycle generation, attempt-secret hash, and credential
     delivery public key;
   - atomically finalize granted Access Attempt, candidate, candidate-keyed
     session, and encrypted credential envelope;
   - make status idempotently return the same envelope until acknowledgement.
3. **W2-C Rust-owned OAuth**
   - **W2-C1** generate Rust OAuth/Auth/AccessGate bindings and implement
     Station-compatible credential-envelope decryption with cross-language test
     vectors;
   - **W2-C2** move callback parsing and Station
     start/complete/status/cancel/ack transport into Mobile Rust;
   - **W2-C2** persist the active attempt index, attempt secret, and delivery
     private key in secure storage for cold-start recovery;
   - **W2-C2** expose only public projection state to Mobile Web and delete the
     old Web transport/secret-return path.
4. **W2-D Native adapters**
   - integrate approved `tauri-plugin-deep-link = 2.4.9` and
     `tauri-plugin-opener = 2.5.4`;
   - register iOS and Android callback schemes and cover warm/cold launch;
   - delete ad hoc iOS browser FFI and Android unsupported fallbacks.
5. **W2-E Native Acceptance**
   - **W2-E1 Simulator evidence** declares a separate `mobile-simulator`
     environment that owns iOS Simulator and Android emulator discovery, boot,
     Acceptance build deployment, Appium sessions, deterministic callback
     routing, source-bound evidence, and cleanup;
   - W2-E1 pins and verifies Appium `2.19.0`, XCUITest `9.10.5`, and
     UiAutomator2 `4.2.9` before session creation; Android WebView automation
     additionally requires an exact browser-major Chromedriver artifact with
     declared source, host/ABI compatibility, SHA-256, and external cache;
   - W2-E1 is supplemental evidence only and MUST NOT satisfy the
     physical-device MS-AG03 cell;
   - **W2-E2 Physical proof** keeps the existing `mobile-native` environment
     restricted to physical devices and approved provider credentials;
   - implement the acceptance-only typed registry and Appium XCUITest /
     UiAutomator2 drivers;
   - prove deterministic simulator/emulator failure paths;
   - prove real GitHub/Google completion on physical iOS and Android devices;
   - emit source-bound Station, DOM/AX, screenshot, lifecycle, and cleanup
     evidence.

Dependency order:

```text
W2-A -> W2-B -> W2-C --+
                 \      +-> W2-E
                  -> W2-D --+
```

W2-B contract generation may run in parallel with W2-A implementation after
field numbers are allocated. W2-C and W2-D may proceed in parallel after W2-B.
Native environment provisioning may run in parallel with W2-B/W2-C/W2-D, but
no native proof starts before both W2-C and W2-D and the credential/account
preflight pass.

Execution status:

- W2-A, the Station/Rust OAuth path, and the iOS/Android deep-link adapters are
  implemented. W2 source closure remains partial because Mobile currently
  renders only login and invite-code gates; terms, device, and custom
  Station-provided gates still lack a production submission surface.
- W2-E1 Simulator evidence: done. The canonical external Evidence Store
  `latest` run passed both iPhone 15 Pro / iOS 17.4 and
  `peers_touch_applet_l3_e2e` runtime cells, including warm/cold invalid
  callback routing, WebView restart, fail-closed projections,
  DOM/AX/screenshots, runtime identity, and cleanup.
- W2-E2 source closure: `D-19_INFRA_LANDED / E2-5_SOURCE_COMPLETE`. The accepted
  architecture at `docs/architecture/platform/client/mobile/native-oauth-proof/` defines the trusted
  negative-Fixture authority, authoritative Station proof, four-client
  provider-browser lease lifecycle, and physical-app build provenance.
  The Owner accepted MOP-D01..MOP-D04 on 2026-08-29. The focused execution plan
  is `docs/architecture/platform/client/mobile/execution-plans/20260829-mobile-native-oauth-proof.md`;
  the base plan and accepted pre-D-19 amendments independently returned
  `0 P0 / 0 P1`. D-19 Infra landed via PR #105. E2-0 through E2-5 source-side
  closure are complete (finalizer module, registry, baseline, capability YAML,
  gate catalog update, and 11 adversarial tests all committed to master).
- W2-E2 Physical proof: `UNPROVEN / NOT STARTED`; approved provider accounts,
  two physical iOS devices, two physical Android devices are prerequisites.
  D-19 Infra and E2-5 source closure are no longer blockers.
  All 16 scenarios are source-executable, but no physical run is claimed.
  MS-AG03 remains `UNPROVEN`.

Gate:

- MS-AG03 plus MS-PA03, MS-PA17, and MS-PA25.

### W3: Lifecycle, Runtime Graph, And Navigation

Responsibility:

- Make lifecycle and surface lifetime executable, observable, and generation
  fenced.

Deliverables:

- Add `MobileLifecycleKernel` and top-level reducer.
- Replace static registry entries with `MobileRuntimeDescriptor` implementations.
- Validate `dependsOn` cycles and apply topological bootstrap/reverse teardown.
- Add descriptor-owned primary/detail/overlay navigation.
- Externalize scroll and focus restoration from page lifetime and define the
  draft restoration projection port consumed from W4.
- Implement bounded suspend/resume/reconcile and aggregate teardown results.

Target areas:

- `apps/mobile/src/app/lifecycle/`, `app/navigation/`, `runtimes/`.
- `App.tsx`, `components/MobileShell.tsx`.
- UI component-tree registry evidence.

Deletion obligation:

- Remove component-owned launch transitions.
- Remove `activeSessionUlid`/`activeGroupUlid` as route owners.
- Remove page-owned streams, polling, and mount-time truth fetches.

Gate:

- MS-AG02, MS-AG05, MS-AG07, MS-AG08, and MS-AG11.

### W4: InteractionAdmission, Command Ledger, And Draft Store

Responsibility:

- Provide one restart-safe Mobile reliability path for all admitted writes and
  one independent encrypted draft persistence path.

Deliverables:

- Implement MS-P04 command result/readback and MS-P06 typed command envelope.
- Add `commandRuntime` as the Mobile `InteractionAdmission` adapter.
- Add encrypted transactional Rust ledger with per-key ordering, four-key
  fairness, capacity limits, crash recovery, and schema migration.
- Keep Chat commands out of this generic ledger. Chat uses the Device Messaging
  Engine command/outbox transaction defined by MP-D01 and MP-D16.
- Add MS-P08 encrypted Chat/Moments draft store.
- Connect W3's draft restoration port to the Rust draft store and prove
  unmount/background/restart restoration.
- Project ledger state into domain-visible pending/failed/unknown state.

Target areas:

- Model/Station command result contracts.
- `apps/mobile/src/runtimes/commandRuntime.ts`.
- `apps/mobile/src-tauri/src/runtime/command_ledger/`.
- `apps/mobile/src-tauri/src/runtime/draft_store/`.

Deletion obligation:

- Remove any Mobile durable Social outbox, native Room/SwiftData queue, and
  component-local persistence claim.
- Keep `ChatOutboxItem` projection-only.

Gate:

- MS-D15 is accepted. The authenticated Friend Request command-result lookup
  contract must land before schema-v2 command admission begins.
- MS-AG04, MS-AG09, and MS-AG10.

### CA-HC: Conversation Authority DDD And Messaging Facade Hard Cut

Responsibility:

- Execute the accepted cross-layer prerequisite before W5/W6A/W8/W9-D can close.

Plan:

- `docs/architecture/engineering/api-governance/execution-plans/20260906-conversation-authority-hard-cut.md`

Required result:

- Conversation is one Station DDD bounded context with aggregate/application/
  infrastructure/interface boundaries and one authority UOW/store family.
- Conversation is the sole public Chat entry point; the retired Station Chat facade
  is absent.
- Device, Inbox, Recovery, Key Exchange, Attachment, and Federation APIs are owned by
  their accepted resource domains.
- Internal `packages/messaging-core` remains the Desktop/Mobile protocol engine.
- Shared Federation transport supports both Conversation and Social typed adapters.
- Cross-Station Friend Request passes before Chat/Contacts runs.

Gate:

- `CA-W0..CA-W7` and `CA-AS01..CA-AS08` from the linked plan.

Non-claim:

- Pre-consolidation runtime evidence proves behavior of the retained implementation,
  not compliance with the accepted target architecture.

### W5: Generated Gateway And Social Projection Convergence

Responsibility:

- Converge business domains on generated Proto, one shared event ingress, and
  runtime-owned projection freshness.
- Complete the accepted MP-W09 Mobile adapter dependency before cutting Chat
  and Group consumers over to Device Messaging Engine projections.

Deliverables:

- Quarantine temporary JSON compatibility inside domain API gateways.
- Finish portable OpenMLS ownership in `packages/messaging-core/`, then
  implement the Mobile SQLCipher, key material, transport, lifecycle, and
  projection adapters defined by MP-D16.
- Register typed Mobile Tauri Messaging Engine commands whose Station transports use
  the canonical Conversation/Device/Recovery/Key Exchange/Federation resource routes.
- Route Social/group/Moments/notification/profile events through one shared
  typed ingress with control/data capacity and cursor repair.
- Keep `groupRuntime` as a subordinate projection descriptor.
- Add per-domain command outcome/readback adapters.
- Complete MS-P05 account preference contracts.

Target areas:

- `apps/mobile/src/features/social/`, `features/group/`, new runtime-owned
  Moments/profile/settings projections.
- `apps/mobile/src/services/api/`.
- Station social/conversation/notification/actor domains.

Failure closure:

- Data overflow marks affected projections stale and reconciles.
- Control-event loss closes write admission and revalidates the session.
- Module failure renders unavailable state, never fabricated empty data.

Deletion obligation:

- Remove retired JSON/manual DTO paths after each domain reaches parity.
- Remove duplicate long-lived Station event streams.
- Remove retired Mobile Chat transport semantics and any Chat use of the generic
  `commandRuntime` ledger.

Gate:

- MS-AG01, MS-AG06, MS-AG09, and MS-AG10.

Execution slices:

- **W5-A Shared ingress and projection ownership** depends on W3 lifecycle
  ownership and the integrated CA-HC source contracts, but not on the W4
  command-ledger schema migration. It owns the single session-scoped Social
  event ingress, generated realtime cursor propagation, suspend/resume,
  teardown, targeted reconciliation, write-admission/recovery projection
  wiring, subordinate Group projection routing, and runtime-owned
  Moments/notification/profile freshness. Page-created ingress or stub
  controllers are forbidden.
- **W5-B Durable command outcome/readback convergence** depends on W4
  InteractionAdmission and the domain owner's authoritative outcome/readback
  contracts. It remains parked while the W4 payload/readback/retry semantics
  and the missing Group/Social owner contracts are unresolved.
- **W5-C Native convergence evidence** depends on W5-A source closure, the
  relevant W5-B owner contracts, exact-source two-Station service attestations,
  reset authorization, and the plan-defined simulator/physical resources.

### W6A: Chat, Contacts, And Group Product Closure

Responsibility:

- Complete Chat, Contacts, and Group receiver journeys on the shared Social
  projection and InteractionAdmission contracts.

Deliverables:

- Chat: list, detail, attachment, typing, search, message actions, conversation
  settings, group administration, visible uncertain outcomes.
- Contacts/groups: requests, federated resolve, profile, duplicate/no-result/
  unavailable/role-denied states.

Rules:

- Pages render narrow selectors and dispatch typed commands only.
- All visible text uses `packages/locales/`.
- Conversation/message/contact/member lists are virtualized or bounded and
  preserve anchors.

Gate:

- MS-PA06..MS-PA10, MS-PA18, and MS-PA19 through AS-05..AS-07.

Target areas:

- `apps/mobile/src/pages/ChatPage.tsx`,
  `apps/mobile/src/pages/ContactsPage.tsx`.
- `apps/mobile/src/features/social/`, `apps/mobile/src/features/group/`.
- Station Conversation DDD, Conversation Delivery, Social relationship, and
  group handlers.

### W6B: Moments Product Closure

Responsibility:

- Complete Station-backed Moments participation without page-owned freshness.

Deliverables:

- Feed/detail pagination, audience, publish, reaction, comment, reply, draft
  recovery, rollback, and policy/empty/unavailable states.
- Runtime-owned projection with generated Social Proto gateways.
- Virtualized or bounded feed with stable anchors.

Target areas:

- `apps/mobile/src/pages/MomentsPage.tsx`.
- Mobile Moments runtime/projection/gateway modules.
- Station Social post/comment/reaction handlers and tests.

Gate:

- MS-PA11, MS-PA20, and MS-PA23 through AS-08.

### W6C: Profile And Settings Product Closure

Responsibility:

- Complete account and device settings with explicit persistence ownership.

Deliverables:

- Profile, account preferences, device preferences, notifications, privacy,
  storage, blocked users, language, permissions, Station change, and logout.
- Dirty/save/discard/conflict behavior and selected-only settings detail mount.
- Station readback for shared preferences and typed local readback for device
  preferences.

Target areas:

- `apps/mobile/src/pages/SettingsPage.tsx`.
- Mobile profile/settings runtime, projection, and gateway modules.
- Station actor/preferences and notification preference handlers.

Gate:

- MS-PA12, MS-PA13, MS-PA21, and MS-PA24 through AS-09 and AS-10.

### W6D: Recovery And Degraded-State Closure

Responsibility:

- Project lifecycle, trust, ledger, draft, and capability failures into the
  confirmed recovery surfaces.

Deliverables:

- Draft restore, unknown outcome, capacity/read-only, revocation, Station
  identity mismatch, event-overflow reconcile, deferred capability, and
  device-local flag states.
- No recovery surface creates a second retry, persistence, or lifecycle owner.

Target areas:

- Mobile recovery projection and overlay descriptors.
- Confirmed Prototype-to-production replica mapping.
- `packages/locales/` Mobile recovery keys.

Gate:

- MS-PA14..MS-PA17 and MS-PA22..MS-PA27 through AS-04, AS-06, and AS-10..AS-15.

### W7: Native Lifecycle And Platform Closure

Responsibility:

- Make the accepted Web/Rust/native ports real on both supported platforms.

Deliverables:

- Complete Android secure storage parity with iOS.
- Complete deep-link, push/wakeup, network, permission, background/resume, and
  media ports.
- Propagate lifecycle generation through native events and reject stale events.
- Ensure WorkManager/BGTaskScheduler emits wakeups only; Rust/runtime owners
  perform reconciliation and command convergence.
- Add platform-specific accessibility and permission evidence.

Dependency-ready execution slices:

- **W7-A Native permission adapters**: replace placeholder permission results
  with one Tauri mobile plugin whose Android and iOS implementations check and
  request camera, microphone, photo-library/media, and notification
  permissions. Keep the Rust capability kernel as the Web-facing API owner and
  add the required Android manifest and iOS usage-description declarations.
- **W7-B Native lifecycle callbacks**: deliver real foreground and background
  callbacks through the native plugin boundary into the generation-fenced Rust
  lifecycle bridge. Native code emits typed wakeup/suspend signals only;
  lifecycle and reconciliation ownership remains in Rust and the Mobile
  runtime.
- **W7-C Scenario-owned native provisioning**: compose `mobile-native`
  resources from each Gate scenario. Lifecycle and platform scenarios must not
  require OAuth credentials, provider/browser leases, Relay, destructive actor
  reset, or four access clients unless their own runtime manifest declares
  those resources.
- **W7-D Native lifecycle/platform Gate branches**: implement the existing
  `mobile-native-lifecycle-e2e` and `mobile-native-platform-e2e` catalog
  scenarios with scenario-specific Phase/BOM/Spec traceability, fail-closed
  physical-resource preflight, source-bound evidence, and reverse cleanup.

Parked design boundary:

- WorkManager/BGTaskScheduler task identifiers, cadence, constraints,
  cancellation, expiration, and completion policy remain
  `DESIGN_AMENDMENT_REQUIRED`. W7-B may wire ordinary OS foreground/background
  callbacks without inventing scheduled-work semantics.

Dependencies:

- W2, W3, W4, and W5 must expose stable auth, lifecycle, reliability, and
  shared-event ports before W7 may close.
- W7-A, W7-B, W7-C, and W7-D source work may proceed against the already
  accepted native-port, lifecycle, Provisioner, and Gate contracts. Their
  completion does not close W7 or prove physical runtime cells while W4/W5 and
  physical evidence remain open.

Gate:

- Physical-device MS-AG03, MS-AG05, MS-AG08, MS-AG10, and MS-AG11.

### W8: Atomic Old-Path Deletion

Responsibility:

- Complete every cutover with one live source of truth.

Required deletion checks:

| Replaced concern | New owner | Old path removed when | Zero-reference proof |
|---|---|---|---|
| App lifecycle effects | `MobileLifecycleKernel` | every entry transition uses kernel | scan for direct launch-state mutation |
| Static runtime catalog | executable registry | all runtime owners register lifecycle | scan old descriptor shape |
| Store-owned routes | navigation descriptors | deep link/back/focus pass | scan route use of active store IDs |
| Numeric actor identity | PTID | Station/gateway/session parity passes | scan aliases outside migration ingress |
| URL security scope | `station_peer_id` | handshake migration passes | scan URL-keyed credential/ledger/cache keys |
| Manual/JSON domain path | generated Proto gateway | per-domain parity passes | import/type scan |
| Duplicate outbox/queue | Messaging Engine outbox for Chat; Rust `commandRuntime` ledger for non-messaging domains | all Chat commands use the Engine and all other durable commands use exactly one generic ledger | persistence-owner and command-kind scan |
| Component-only drafts | Rust draft store | restart recovery passes | storage/write-path scan |
| Duplicate event streams | shared social ingress | domain reconcile passes | stream/listener inventory |

Rollback uses source-control/deployment rollback. No permanent dual-write,
compatibility shim, or hidden feature flag remains after a cutover gate passes.

### W9: Native Acceptance And Readiness Audit

Responsibility:

- Prove the accepted product and architecture on claimed runtime cells.

Deliverables:

- Execute every Acceptance Scenario in §10.
- Produce evidence indexed by every `MS-PAxx` and `MS-AGxx`.
- Record lifecycle generation, Station/PTID scope, command ID, queue depth,
  resource counts, timing percentiles, and typed errors without secrets or PII.
- Run `pt-acceptance-gap-detector`, `pt-quality-check`, and
  `pt-completion-auditor`.

Final gate:

- All required rows are `PASS`.
- Missing, stale, mock-only, single-actor, browser-only, or unindexed evidence
  remains `UNPROVEN` and blocks readiness.

## 8. Workstream Execution Contracts

Commands named below are stable target entrypoints. A workstream that introduces
an entrypoint must add its script/Gate definition before using that command as
evidence.

| Workstream | Required commands | Evidence | Done / non-claim |
|---|---|---|---|
| W-1 | `git fetch origin master`; merge-base/status/path-allowlist checks from W-1 | `tmp/evidence/mobile-shell/<run-id>/W-1/` | Clean latest-master implementation worktree; no product claim |
| W0 | `make acceptance-validate DOMAIN=mobile`; `make acceptance-coverage-report`; `make acceptance-plan ACCEPTANCE_RANGE=origin/master...HEAD`; `python3 tooling/scripts/acceptance-run.py --gate mobile-contract-static` | Acceptance plan/validation roles plus `W0/coverage-gap-matrix.md` | Full Domain trace resolves; native rows remain UNPROVEN |
| W1 | `./model/build.sh`; `./tooling/scripts/proto-gen-mobile.sh`; `(cd apps/station && go test ./...)`; `(cd apps/desktop && pnpm run check && pnpm run test)`; `pnpm mobile:check`; `python3 tooling/scripts/acceptance-run.py --gate mobile-identity-contract` | `W1/` generated-contract, scan, and switch evidence | All consumers compile PTID-only; no session/Station behavior claim beyond tested cells |
| W2 | `(cd apps/station && go test ./app/subserver/oauth/... ./frame/touch/accessgate/...)`; `pnpm mobile:check`; `python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-access-e2e`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-access-e2e` | Simulator evidence plus physical Acceptance Gate run and `W2/` attempt/readback evidence | W2-E1 simulator cells pass without claiming provider success; AS-02/AS-03 pass on both physical platforms before MS-AG03 is proven; other business domains not claimed |
| W3 | `pnpm --dir apps/mobile run check:lifecycle-runtime`; `python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-runtime-lifecycle-e2e`; `python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-station-lifecycle-e2e`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-lifecycle-e2e` | `W3/` transition, generation, resource, focus, navigation, Station/session, and old-scope evidence plus External Evidence Store simulator/native runs | Local lifecycle/navigation and Station-bound simulator cells pass; physical background/foreground and secure-delete failure remain separate proof obligations; draft durability remains W4 |
| W4 | `(cd apps/mobile/src-tauri && cargo test --offline)`; `pnpm --dir apps/mobile run check:command-runtime`; `python3 tooling/scripts/acceptance-run.py --gate mobile-hard-cut-static`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-recovery-e2e` | `W4/` ledger/draft/fault-matrix evidence; recovery Gate emits one Friend Request ID/hash through exact-byte dispatch, command-result lookup, local projection checkpoint, and authoritative relationship readback | Ordering, fairness, restart, capacity, readback, quarantine/reset recovery, and draft scope pass; only the Friend Request recovery subset of AS-07 is claimed here, while broader Contacts/Group UI remains W6A |
| CA-HC | Commands and Gates in `docs/architecture/engineering/api-governance/execution-plans/20260906-conversation-authority-hard-cut.md` §12 | `tmp/evidence/api-ownership/<run-id>/CA-W0..CA-W7/` | CA-W0..CA-W7 and CA-AS01..CA-AS08 pass; Conversation DDD and sole Chat ownership are proven without compatibility paths |
| W5 | `pnpm --dir apps/mobile run check:social-wire`; `pnpm --dir apps/mobile run check:social-runtime-boundaries`; `pnpm mobile:check`; `python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-social-convergence-e2e`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-social-convergence-e2e` | `W5/` ingress/cursor/readback and zero-duplicate-stream evidence | Supplemental simulator evidence may prove only the declared partial MS-AG06 cell; full projection freshness remains owned by the physical Gate |
| W6A | `pnpm mobile:check`; `python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-chat-contacts-e2e`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-chat-contacts-e2e` | `W6A/` two-actor/two-Station receiver evidence | Supplemental simulator evidence may prove only implemented Direct/Group Messaging journeys; full AS-05..AS-07 remains owned by the physical Gate |
| W6B | `pnpm mobile:check`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-moments-e2e` | `W6B/` feed/publish/rollback/readback evidence | AS-08 passes; other surfaces not claimed |
| W6C | `pnpm mobile:check`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-settings-e2e` | `W6C/` account/local/readback/conflict evidence | AS-09/AS-10 settings assertions pass; recovery overlay remains W6D |
| W6D | `pnpm mobile:check`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-recovery-ui-e2e` | `W6D/` recovery/degraded screenshots, AX, and state evidence | AS-04/AS-06/AS-10..AS-15 visible recovery assertions pass |
| W7 | `pnpm --dir apps/mobile run check:native-platforms`; `python3 tooling/scripts/acceptance-run.py --gate mobile-native-platform-e2e` | `W7/ios/`, `W7/android/`, permission/lifecycle/cleanup reports | Both declared native cells pass; browser/prototype evidence is not substituted |
| W8 | `pnpm --dir apps/mobile run check:mobile-shell-contracts -- --hard-cut`; `python3 tooling/scripts/acceptance-run.py --gate mobile-hard-cut-static` | `W8/` zero-reference report | Every deletion row is zero; no compatibility or runtime claim beyond scans |
| W9 | `make acceptance PLAN=tooling/acceptance/plans/mobile-shell.json`; `python3 tooling/scripts/acceptance-validate.py --domain mobile --require-proven`; `make acceptance-report`; `make acceptance-coverage-report` | Immutable Acceptance runs, validation report, cleanup audit | Only mapped passing runtime cells become PROVEN |

### W9 Gate Execution Order

Gates must execute in dependency order. A phase failure blocks all subsequent
phases.

| Phase | Gates | Environment | Prerequisite |
|---|---|---|---|
| W9-A Static | MS-AG01 | CI/local | Proto gen clean |
| W9-B Layout/A11y | `mobile-ios-simulator-layout-accessibility-e2e`; MS-AG08 and simulator portion of MS-AG11 | `mobile-ios-layout-simulator`: iOS 17.4 iPhone SE (3rd generation) + iPhone 15 Pro Max | Usable embedded app on both pinned simulators |
| W9-C Lifecycle | `mobile-simulator-runtime-lifecycle-e2e` for the local runtime graph; `mobile-simulator-station-lifecycle-e2e` for Station/session transitions; `mobile-native-lifecycle-e2e` for remaining physical proof; MS-AG02 and MS-AG05 | iOS Simulator + Android Emulator for local lifecycle; both simulator clients plus two disposable Stations for Station/session lifecycle; physical devices for OS lifecycle | Usable embedded app; source-attested Station identity/session resources; physical proof remains separate |
| W9-D Social | `mobile-simulator-social-convergence-e2e` and `mobile-simulator-chat-contacts-e2e`; MS-AG06 partial and MS-AG04 partial only | 2 simulators + 2 dedicated Stations + Relay + 2 disposable accounts; source-bound receiver projections and deterministic cleanup | W9-C, CA-HC, MP-W09 Phase 4, and W5 cutover pass |
| W9-E Stress | MS-AG09, MS-AG10 | simulator + Station | W9-D passes |
| W9-F Physical | MS-AG03, MS-AG04 full, MS-AG06 full, MS-AG07 | `mobile-native-access-e2e` + `mobile-native-recovery-e2e` + `mobile-native-social-convergence-e2e` + physical platform Gates; physical iOS + Android devices | W9-E passes |

**Current blocker (`PLAN_AMENDMENT_REQUIRED`, resolved in this plan)**: W9-D
cannot be implemented as an Acceptance-only change. MP-D01 and MP-D16 already
assign Direct/OpenMLS/queue/recovery to `packages/messaging-core` plus thin
platform adapters, but MP-W09 stopped after Desktop partial extraction and the
Mobile Shell plan omitted that dependency. W5 now depends on completing
portable OpenMLS ownership and the MP-W09 Mobile adapter, then atomically
cutting Mobile Chat/Group off `/friend-chat/*`, `/group-chat/*`, and the generic
command ledger. Only after that cutover may supplemental simulator Gates be
registered. The supplemental Gates use their own simulator resource contract
and emit `PASS / PARTIAL / UNPROVEN`; they do not reuse the OAuth-only physical
proof schema or finalizer. Existing `mobile-native-social-convergence-e2e` and
`mobile-native-chat-contacts-e2e` remain the physical full-proof owners. Their
Provisioner must make Appium, build/device identity, actor Fixture, and service
bindings common while keeping provider credentials, browser leases, OAuth
Fixture operations, proof roles, and finalizer access-only. No shared
development Station may be redeployed or reset.

Every workstream must also update affected architecture/platform docs and the
nearest directory README when public paths, contracts, or conventions change.

## 9. End-To-End Lifecycle Coverage

| Lifecycle | Workstreams |
|---|---|
| First Station add → signed pin → Access Gate → Shell | W1, W2, W3 |
| Returning session → validation → bootstrap | W1, W2, W3, W5 |
| Read/write → commit/event → projection | W4, W5, W6A, W6B, W6C |
| Disconnect → unknown outcome → readback → converge | W4, W5 |
| Background → wakeup → validate → reconcile → reopen writes | W3, W5, W7 |
| Station/actor switch → hide → teardown → clear/quarantine → bootstrap | W1, W3, W4, W7 |
| Overload → typed reject/read-only → recovery | W4, W6D |
| Native permission/deep-link/push failure | W2, W3, W7 |
| Old-path removal → single-source verification | W8 |
| Production readiness decision | W9 |

## 10. Acceptance Scenarios

Every scenario starts `pending`. Evidence must come from the stated native
runtime cell; Prototype screenshots establish design intent only.

Closure-level negative coverage:

| Closure | Scenarios | Success | Network error | Timeout | Invalid input | Cancellation |
|---|---|---|---|---|---|---|
| W1 | AS-01, AS-10 | verified add/switch | unreachable Station | handshake expiry | malformed URL/signature/capabilities | keep/remove/replace cancel |
| W2 | AS-02, AS-03 | final grant | provider/Station unavailable | attempt/callback expiry | state/provider/redirect mismatch | provider and gate cancel |
| W3 | AS-04, AS-10, AS-13 | bootstrap/resume/navigation | reconcile unavailable | bounded bootstrap/teardown | unknown route/stale generation | back, logout, Station-switch cancel |
| W4 | AS-07, AS-10, AS-11, AS-12 | Friend Request Station ownership/readback plus exact-scope draft restore | disconnect at pre-fence, post-fence, and post-Station-acceptance points | 30-second submit/readback deadline and eight-attempt/domain-expiry ceiling | malformed command/draft schema, wrong key/install epoch, partial quarantine/reset journal | pre-fence command cancel; explicit draft retain/discard; post-fence discard-tracking |
| W5 | AS-05..AS-09, AS-12 | shared ingress convergence | stream/domain unavailable | cursor repair deadline | malformed/unknown event | domain action cancellation |
| W6A | AS-05..AS-07 | Chat/contact/group journeys | send/resolve unavailable | upload/resolve timeout | invalid content/actor/role | composer/request/admin cancel |
| W6B | AS-08 | Moments journey | feed/publish unavailable | upload/page timeout | invalid media/audience/comment | composer/reply cancel |
| W6C | AS-09, AS-10 | settings/save/logout | preference/revoke unavailable | save/revoke timeout | invalid preference/profile | discard/stay/logout cancel |
| W6D | AS-04, AS-06, AS-10..AS-15 | visible recovery | degraded/offline | recovery deadline | corrupt state/unsupported schema | keep draft/read-only/back |
| W7 | AS-03, AS-04, AS-10, AS-13 | native lifecycle | OS/network unavailable | native callback/background deadline | invalid deep link/permission payload | OS browser/permission cancel |
| W8 | AS-01..AS-15 rerun | single-path product | inherited scenario failures | inherited scenario timeouts | forbidden-reference injection | inherited scenario cancellation |
| W9 | AS-01..AS-15 | complete planned run | Gate environment failure | Gate timeout | malformed/missing evidence | run cancellation with cleanup |

| Scenario | Product acceptance | Architecture gates |
|---|---|---|
| AS-01 | MS-PA01, MS-PA16, MS-PA25 | MS-AG01, MS-AG02 |
| AS-02 | MS-PA02, MS-PA17 | MS-AG02, MS-AG03 |
| AS-03 | MS-PA03, MS-PA25 | MS-AG03 |
| AS-04 | MS-PA04, MS-PA05, MS-PA14, MS-PA25 | MS-AG02, MS-AG05, MS-AG06 |
| AS-05 | MS-PA06, MS-PA18 | MS-AG04, MS-AG06, MS-AG10 |
| AS-06 | MS-PA07, MS-PA08 | MS-AG04, MS-AG06, MS-AG09 |
| AS-07 | MS-PA09, MS-PA10, MS-PA19 | MS-AG06, MS-AG09 |
| AS-08 | MS-PA11, MS-PA20, MS-PA23 | MS-AG04, MS-AG06, MS-AG10 |
| AS-09 | MS-PA12, MS-PA21, MS-PA24 | MS-AG06, MS-AG08, MS-AG10, MS-AG11 |
| AS-10 | MS-PA13, MS-PA14, MS-PA16, MS-PA25 | MS-AG02, MS-AG05 |
| AS-11 | MS-PA22, MS-PA23 | MS-AG05, MS-AG10 |
| AS-12 | MS-PA26 | MS-AG09 |
| AS-13 | MS-PA24 | MS-AG08, MS-AG11 |
| AS-14 | MS-PA15 | MS-AG07, MS-AG08 |
| AS-15 | MS-PA27 | MS-AG08, MS-AG11 |

### AS-01: First Station Entry And Trust
- **Precondition**: Fresh install with no Station.
- **Action**: User adds a reachable Station and continues.
- **Expected**: Signed identity is shown/pinned, current Access Gate appears,
  and Shell stays hidden before grant.
- **Failure variant**: Invalid address, unreachable target, capability mismatch,
  or changed peer ID yields a typed recoverable/blocking state.
- **Evidence**: iOS/Android UI capture, signed handshake trace, registry readback.
- **Status**: pending

### AS-02: Email And Arbitrary Gate Chain
- **Precondition**: Station requires auth followed by invite/device/terms/custom gates.
- **Action**: User completes or cancels each requested gate.
- **Expected**: Station order is preserved and Shell appears only after final grant.
- **Failure variant**: Denial/expiry remains outside Shell with a valid next action.
- **Evidence**: two-platform DOM/AX capture plus Station decision/audit readback.
- **Status**: pending

### AS-03: OAuth Binding And Replay Defense
- **Precondition**: GitHub/Google gate on a verified Station.
- **Action**: User authorizes and returns through the native deep link.
- **Expected**: The same attempt resumes and later gates continue; session
  activates only after final grant.
- **Failure variant**: Cancel, expiry, replay, provider/Station mismatch, and
  stale generation fail closed without exposing secrets.
- **Evidence**: physical iOS/Android trace plus one-time Station attempt readback.
- **Status**: pending

### AS-04: Session Restore And Revocation
- **Precondition**: Valid session, then separately a revoked session.
- **Action**: User cold-starts and later resumes the app.
- **Expected**: Valid scope restores; revoked scope hides old data and returns to auth.
- **Failure variant**: Validation timeout keeps writes closed and marks stale.
- **Evidence**: cold-start/resume UI, secure-store metadata, Station session readback.
- **Status**: pending

### AS-05: Friend And Group Conversation
- **Precondition**: Two actors on two devices with friend and group conversations.
- **Action**: Send text/media, receive, type, search, edit, recall, delete, and
  change conversation settings.
- **Expected**: Visible states progress monotonically and committed state survives reload.
- **Failure variant**: Permission/upload/network errors preserve readable
  content and actionable recovery.
- **Evidence**: both devices plus Station message/event/settings readback.
- **Status**: pending

### AS-06: Advanced Message Actions And Unknown Outcome
- **Precondition**: Conversation supports reactions, pins, forward, and threads.
- **Action**: Execute each action and disconnect at pre-dispatch,
  post-dispatch, and post-commit.
- **Expected**: Exactly one effect commits; unknown status is visible and
  readback precedes retry.
- **Failure variant**: No outcome API leaves the item visibly unresolved.
- **Evidence**: ten trials per disconnect point, command IDs, Station event/history.
- **Status**: pending

### AS-07: Contacts And Group Administration
- **Precondition**: Local/remote actors and owner/admin/member roles.
- **Action**: Resolve, request, accept/reject, create group, and manage members.
- **Expected**: Relationship and role mutations match Station readback.
- **Failure variant**: No result, duplicate, remote unavailable, and role denial
  remain distinct and recoverable.
- **Evidence**: two actors/two Stations plus relationship/group readback.
- **Status**: pending

### AS-08: Moments Participation
- **Precondition**: Feed with empty, filtered, remote, and policy-hidden fixtures.
- **Action**: Paginate, publish text/images, react, comment, and reply.
- **Expected**: Audience is visible; committed state converges on both actors.
- **Failure variant**: Rejection rolls back optimistic state and preserves draft.
- **Evidence**: two actors/two Stations plus post/comment/reaction readback.
- **Status**: pending

### AS-09: Profile And Settings
- **Precondition**: Account and device preferences with a second-device conflict.
- **Action**: Edit profile, language, notification, privacy, storage, and block settings.
- **Expected**: Account settings converge through Station; device settings remain local.
- **Failure variant**: Dirty exit, permission denial, save failure, and external
  conflict expose save/discard/stay/retry paths.
- **Evidence**: restart/second-device UI plus Station and local readback.
- **Status**: pending

### AS-10: Station Change And Logout
- **Precondition**: Active Shell with streams, timers, drafts, and pending commands.
- **Action**: Change Station or log out during inflight work.
- **Expected**: Old content hides immediately; reverse teardown completes before
  next bootstrap; unresolved local work stays exact-scope quarantined.
- **Failure variant**: Secure-delete failure blocks; remote revoke failure yields
  `remote-revocation-unconfirmed` after local credentials become unusable.
- **Evidence**: ten switches, resource counts, secure-store and projection absence.
- **Status**: pending

### AS-11: Draft And Device-Local Flag
- **Precondition**: Chat/Moments drafts and a locally flagged message.
- **Action**: Unmount detail, background, kill, restart, choose retain/discard
  during logout or Station replacement, simulate reinstall-epoch mismatch, and
  inspect a second device.
- **Expected**: Draft restores only in the exact Station/PTID scope; flag remains
  explicitly device-only and absent elsewhere; lifecycle does not enter the
  next Shell before the draft decision and requested deletion commit.
- **Failure variant**: Corrupt/unsupported draft schema fails closed without
  leaking plaintext or another scope; key/epoch mismatch and crash at each
  quarantine/reset journal step recover without row mutation or implicit reset.
- **Evidence**: encrypted-store metadata, retain/discard UI captures,
  quarantine/reset journal, reinstall-epoch result, second-device absence.
- **Status**: pending

### AS-12: Admission And Event Overload
- **Precondition**: Slow Station, full ledger boundary, and event flood fixture.
- **Action**: Submit 50 intents across eight keys and inject 2,000 data events
  plus revocation.
- **Expected**: Per-key order and cross-key fairness hold; reads remain
  available; writes reject with typed overload; revocation closes admission.
- **Failure variant**: Data overflow marks stale and reconciles; control loss
  revalidates session.
- **Evidence**: queue/worker counters, command IDs, reconcile and Station readback.
- **Status**: pending

### AS-13: Accessibility, Localization, And Layout
- **Precondition**: Smallest/largest viewport, longest locale, maximum text,
  reduced motion, keyboard open/closed.
- **Action**: Complete all primary journeys with VoiceOver and TalkBack.
- **Expected**: Semantic order, labels, focus restore, safe-area clearance, and
  content wrapping remain correct.
- **Failure variant**: Permission/error/recovery surfaces remain operable without
  relying on motion or color alone.
- **Evidence**: AX trees, focus traces, screenshots, and layout assertions.
- **Status**: pending

### AS-14: Long-List Performance
- **Precondition**: Accepted data volumes on pinned lower/current-tier devices.
- **Action**: Switch tabs, return to details, scroll, receive events, and reconcile.
- **Expected**: P95 <= 100 ms, P99 <= 150 ms, no unwaived main-thread task over
  50 ms, stable scroll/focus, and bounded render/memory.
- **Failure variant**: Slow dependency or hidden update does not freeze visible interaction.
- **Evidence**: 5 warmups + 30 runs per route with interaction-linked traces.
- **Status**: pending

### AS-15: Deferred Capability Honesty
- **Precondition**: Shell surfaces where WeChat, call, Docs, and local flag could appear.
- **Action**: Inspect and activate available affordances.
- **Expected**: Deferred capabilities are absent or disabled with a useful
  reason; no fake flow begins; local flag states its device scope.
- **Failure variant**: Any enabled unsupported action fails the scenario.
- **Evidence**: iOS/Android surface inventory and interaction capture.
- **Status**: pending

## 10.1 Acceptance Execution

This is the D-20 scheduling projection of the existing W-workstreams, not a
second task ledger. Section 11 remains the status owner. `completed` replaces
the former `done` spelling; `partial` retains incomplete work that is not the
single current closure. DWF-B is current; W6A remains the unchanged Mobile
product frontier and resumes only after the plan-package cutover. No
source-complete or simulator-only row becomes product-complete.

The current DWF-B Gate is a local control-plane self-validation only. W6A
immediate and receiver Gates remain
mandatory in `completion` and `full`, behind the unchanged W5/W9-D, Fixture,
Station admission, and physical-device prerequisites. No Mobile Gate is
authorized by DWF-B. When another existing closure becomes ready, update
section 11 first.

The immutable initial-HEAD impact includes integrated Chat, Federation, and
Agent history. Their explicit `full` entries below acknowledge that inherited
impact; they do not transfer implementation ownership to Mobile or authorize
their execution. Their owners must supply source-bound proof at full/release
review. Unknown future impact must still fail with `ACCEPTANCE_PLAN_DRIFT`.
Neither `--completion` nor `--full` is authorized by the sync request.

```json
{
  "schemaVersion": 1,
  "closures": {
    "DWF-B": ["development-workflow-control-plane"],
    "W-1": [],
    "W0": ["mobile-contract-static"],
    "W1": ["mobile-identity-contract"],
    "W2": ["mobile-contract-static"],
    "W3": ["mobile-contract-static"],
    "W4": ["mobile-contract-static"],
    "CA-HC": [],
    "W5": ["mobile-contract-static"],
    "W6A": [
      "mobile-contract-static",
      "station-dashboard-unit",
      "station-dashboard-web-check",
      "acceptance-plan-self",
      "acceptance-infra-validation",
      "acceptance-workflow-contract",
      "acceptance-runtime-provisioning-self"
    ],
    "W6B": ["mobile-contract-static"],
    "W6C": ["mobile-contract-static"],
    "W6D": ["mobile-contract-static"],
    "W7": ["mobile-contract-static"],
    "W8": ["mobile-hard-cut-static"],
    "W9": ["mobile-domain-validation"]
  },
  "completion": [
    "mobile-contract-static",
    "mobile-identity-contract",
    "mobile-hard-cut-static",
    "mobile-simulator-access-e2e",
    "mobile-simulator-runtime-lifecycle-e2e",
    "mobile-simulator-station-lifecycle-e2e",
    "mobile-ios-simulator-layout-accessibility-e2e",
    "mobile-simulator-social-convergence-e2e",
    "mobile-simulator-chat-contacts-e2e",
    "mobile-native-access-e2e",
    "mobile-native-lifecycle-e2e",
    "mobile-native-recovery-e2e",
    "mobile-native-recovery-ui-e2e",
    "mobile-native-social-convergence-e2e",
    "mobile-native-chat-contacts-e2e",
    "mobile-native-moments-e2e",
    "mobile-native-settings-e2e",
    "mobile-native-platform-e2e",
    "mobile-domain-validation",
    "acceptance-plan-self",
    "acceptance-infra-validation",
    "acceptance-workflow-contract",
    "acceptance-runtime-provisioning-self",
    "development-workflow-control-plane"
  ],
  "full": [
    "mobile-contract-static",
    "mobile-identity-contract",
    "mobile-hard-cut-static",
    "mobile-simulator-access-e2e",
    "mobile-simulator-runtime-lifecycle-e2e",
    "mobile-simulator-station-lifecycle-e2e",
    "mobile-ios-simulator-layout-accessibility-e2e",
    "mobile-simulator-social-convergence-e2e",
    "mobile-simulator-chat-contacts-e2e",
    "mobile-native-access-e2e",
    "mobile-native-lifecycle-e2e",
    "mobile-native-recovery-e2e",
    "mobile-native-recovery-ui-e2e",
    "mobile-native-social-convergence-e2e",
    "mobile-native-chat-contacts-e2e",
    "mobile-native-moments-e2e",
    "mobile-native-settings-e2e",
    "mobile-native-platform-e2e",
    "mobile-domain-validation",
    "acceptance-plan-self",
    "acceptance-infra-validation",
    "acceptance-workflow-contract",
    "acceptance-runtime-provisioning-self",
    "proto-build",
    "station-messaging-unit",
    "messaging-platform-contract",
    "desktop-check",
    "chat-native-visible-static",
    "chat-native-two-client-e2e",
    "chat-native-interactions-e2e",
    "chat-native-typing-e2e",
    "chat-contact-message-resilience-e2e",
    "chat-native-multi-device-e2e",
    "chat-native-recovery-e2e",
    "chat-native-group-mls-e2e",
    "chat-desktop-gateway-e2e",
    "station-federation-unit",
    "federation-three-node-e2e",
    "federation-surface-smoke",
    "federation-desktop-gateway-smoke",
    "agent-v2-kernel-foundation-e2e",
    "station-agent-unit",
    "agent-stream-resilience-e2e",
    "desktop-dev-runtime-isolation-static",
    "agent-core-lifecycle-native-e2e",
    "agent-native-mention-e2e",
    "agent-native-knowledge-binding-e2e",
    "agent-native-connector-lifecycle-e2e",
    "agent-native-message-forward-e2e",
    "agent-native-portal-navigation-e2e",
    "agent-v2-capability-binding-e2e",
    "agent-v2-governed-tool-loop-e2e",
    "agent-conversation-e2e",
    "agent-provider-credential-e2e",
    "agent-memory-e2e",
    "agent-growth-e2e",
    "agent-orchestration-e2e",
    "agent-task-e2e",
    "agent-quick-completion-e2e",
    "agent-atelier-e2e",
    "agent-message-actions-static",
    "agent-revision-e2e",
    "agent-attachment-e2e",
    "agent-capability-transparency-e2e",
    "agent-translation-e2e",
    "agent-follow-up-e2e",
    "development-workflow-control-plane"
  ]
}
```

| Gate group | Execution timing | Environment | Catalog timeout per Gate |
|---|---|---|---|
| DWF-B control-plane Gate | After each functional DWF-B batch and at final handoff | `local`; temporary machine Dev root | 180 seconds |
| W6A immediate seven Gates | Once after workflow/source reconciliation | `local`; isolated Python 3.12 environment and canonical temporary root | 120 + 600 + 600 + 30 + 120 + 120 + 180 seconds; 1770-second sequential ceiling |
| Mobile identity / hard cut / Domain validation | Completion review or their current closure, after prerequisites | `local` | 120 / 120 / 600 seconds |
| Mobile simulator access and runtime lifecycle | Completion, after source/runtime freeze | `mobile-simulator` | 2400 seconds each |
| Station lifecycle | Completion, after two dynamic Station bindings and fresh reset authorization | `mobile-station-lifecycle-simulator` | 2400 seconds |
| Mobile layout | Completion on its pinned devices | `mobile-ios-layout-simulator` | 2400 seconds |
| Mobile Social and Chat simulator | Completion after W5 and W9-D admission | `mobile-social-simulator` | 2400 seconds each |
| Mobile physical Gates | Completion after real devices, contracts, and credentials | `mobile-native` | 1800 seconds for access/lifecycle/recovery UI/settings; 2400 for recovery/Social/Chat/Moments/platform |
| Inherited local Chat/Federation/Agent gates | Explicit full/release only; owning-domain review | `local` | 60 seconds for dev isolation, 120 for contract/visible/actions, 600 for build/check/unit |
| Inherited Chat native Gates | Explicit full/release only; Chat owner | `native-tauri-embedded-webdriver` | 600 contact, 1800 Direct/typing/multi-device, 2400 recovery/MLS, 3600 interactions |
| Inherited gateway Gates | Explicit full/release only; owning domain | `local-desktop-gateway` | 600 seconds each |
| Inherited Federation Gates | Explicit full/release only; Federation owner | `fedp5` | 1200 topology, 300 surface |
| Inherited Agent Gates | Explicit full/release only; Agent owner | `home-station` | 3600 foundation, 1800 stream, 600 capability/tool loop, 300 remaining |

Timeouts are catalog upper bounds, not completion estimates. Actual runtime ETA
remains unknown until the required resources and owner contracts are available.
Review scope includes DWF-D13/DWF-B, the unchanged §6/§8/§13 product
dependencies and proof requirements, the parked W6A frontier, and the absence
of automatic Mobile completion/full execution.

## 11. Implementation Status

DWF-B is the current plan-maintenance closure. Section 6.2 remains the unchanged
Mobile product frontier; its native run reopened W3/W6A/W6D defects after the
historical 2026-09-11 checkpoints below. DWF-B does not close any Mobile
workstream. Bidirectional messaging remains unproven.

The 2026-09-16 DWF-B4 correction supersedes the DWF-B row's earlier
"W5 and later work remain transitively parked" statement. Source successors
depend on predecessor source Tasks, so B5 selects dependency-ready `W5`;
physical and owner proof remains parked in the corresponding proof Tasks.
The exact-source formal Gate slot is
`acceptance://development-workflow-control-plane/20260916T130523369357Z-236b04fb2e493d336b373ea904c95f97`;
it supersedes the earlier reserved URI in the historical row below.

| Workstream | Status | Completion evidence |
|---|---|---|
| DWF-B Development Workflow D13/D14 self-hosting migration | in progress / DWF-B1 through DWF-B3 passed; DWF-B4 independent re-review pending | The prepared package validates with 26 bounded Tasks, exact DWF-D14 source/runtime-proof decomposition, the original Mobile dependency graph, and four explicit blocker roots; W5 and later work remain transitively parked, and W9 stays an acceptance aggregate with readiness `BLOCKED/UNPROVEN`. The legacy/archive SHA-256 values remain byte-identical. Current-source regressions pass: Plan/Dev Work/Session 132/132, Acceptance runner 78/78, and package-aware Python/Evidence Store 50/50; planner self-check, Acceptance Infra validation, Skill contracts, package validation, and diff hygiene also pass. The isolated simulation passes 34 paths, covering commit/rollback, source and binding drift, writer-workspace/path alias rejection, existing/absent-target and legacy CAS races, reader full-window fencing, journaled replacement/legacy/rollback operation recovery before and after atomic syscalls, post-syscall carrier drift preservation, stale claim/lock takeover including PID reuse, recoverable cleanup capture, backup/terminal-target cleanup races, atomic-primitive preflight, post-write drift, COMMITTED archive drift rejection, and duplicate-live-package rejection. The formal control-plane evidence slot is reserved at `acceptance://development-workflow-control-plane/20260916T015315261738Z-87af56fcd47f4a07fdbba2903aad2dc2`; it counts only if its immutable manifest records `PASS/DONE/PROVEN` for this exact frozen source. Project memory has no `active_work` row, so the reviewed migration records registry-backed `NONE -> NONE` without creating a transient locator. B4 review and B5 cutover remain open. No Mobile product claim. |
| W-1 Latest-master and worktree isolation preflight | completed / latest-master fast-forward verified | The original baseline remains in `tmp/evidence/mobile-shell/20260827/W-1/source-baseline.md`. On 2026-09-10, the owner explicitly authorized the audited five-commit fast-forward from `79ae008706ca29f4bb5f1da29d9b6651a59b2f7c` to `87b94e4e20ef025ffaacac6a0b6a766b0b9c1679`. On 2026-09-11, a second read-only audit proved that the four incoming commits through `5bf508ace5ad7c0138fe5fb209c7ed77744073ea` touched only governance and skill files outside the Mobile dirty set; the conflict-free `git merge --ff-only origin/master` then refreshed the binding to that HEAD with the same branch, workspace ID, and worktree-set digest. The existing 39-path Mobile/Acceptance diff remains intact and recovery stash `783451f708eca506f6a606cdae77a69b6a32fc2e` remains untouched. This restores the latest-master source prerequisite without making a product claim. |
| W0 Mobile Acceptance Domain onboarding and baseline | completed | `tmp/evidence/mobile-shell/20260827/W0/coverage-gap-matrix.md`; D-13 hard cut; structural validation and static Gate PASS; native proof remains UNPROVEN |
| W1 Unified ActorRef identity and Station trust | completed | `tmp/evidence/mobile-shell/20260827/W1/progress.md`; PTID-only Proto/API cutover, signed Station verification, atomic schema migrations, scoped Station tests, Desktop/Mobile checks, and identity Gate PASS; MS-AG02 native runtime proof remains explicitly UNPROVEN until the integrated native runtime cell |
| W2 Access Gate and OAuth | partial / OAuth core and shared Auth visual identity source complete; generic gate UI and physical proof open | `tmp/evidence/mobile-shell/20260827/W2/progress.md`; the Station/Rust OAuth path, native deep-link adapters, and W2-E1 Simulator evidence are implemented. The 2026-09-13 parity correction makes Desktop/shared Auth the sole visual source, uses the byte-identical square icon and one-card hierarchy in production/prototype, hides raw Station addresses, and has exact-current-source iOS Simulator screenshot/geometry evidence. Mobile still lacks production render/submit surfaces for terms, device, and custom Station-provided gates. E2-0 through E2-5 source-side proof infrastructure is complete; E2-6 physical proof remains `UNPROVEN` and requires physical devices plus approved provider accounts. |
| W3 Lifecycle, runtime graph, and navigation | partial / source and Station-bound simulator closure complete | The kernel owns the runtime graph, launch-state transitions, generation-fenced Station/logout transitions, and descriptor-backed primary, Chat/Group/Contact/Moment/Settings detail, and Find People/Create Group overlay routes. Component-local Contact/Moment/detail visibility and Contacts overlay booleans are removed; primary replacement, route de-duplication, back, overlay close, and reset are covered by focused production-store and Acceptance Harness tests. The simulator Gate drives the production navigation and Station owners and records the public projections without claiming physical layout/focus proof. The Provisioner stages the fresh Mobile Web build into the generated Apple resource folder and restores the generated path during cleanup. The first complete Station-bound run `20260911T035616890352Z-60057e97ce9dd6c0cd61fe00a972859c` and the authoritative External Evidence Store latest after the final evidence amendment are `PASS/DONE/PROVEN` for AS-04 and AS-10: two source-attested disposable Stations, valid-session restore, same-account takeover, revoked-session cleanup, ten authenticated switches with confirmed remote revocation, monotonic generation fencing, old-scope absence, final logout, typed product cleanup, and parent-owned reverse cleanup. Physical layout, focus/no-leak, lifecycle, and secure-store failure evidence remain separate proof obligations. |
| W4 InteractionAdmission, command ledger, and draft store | source complete / physical recovery proof blocked by Appium and devices | The accepted MS-D15 cut is implemented under one generation-bound `runtime::reliability` owner: exact Station/PTID command and typed Chat/Moment draft persistence, native install KEK plus wrapped scope DEKs, canonical v1 quarantine, crash-resumable logical reset, lifecycle admission/drain, one-ID Friend Request preparation/dispatch/readback/checkpoint, and release-excluded Acceptance faults all use their owning Rust/runtime ports. The production Harness exposes sanitized command, draft, reset, and recovery projections without direct Store or SQLite mutation. Default Rust tests pass `151/151`, acceptance-feature Rust tests pass `159/159`, Mobile Vitest passes `154/154`, Android secure-storage Kotlin plus instrumentation compilation passes, the iOS Simulator Rust target check passes, and `mobile-contract-static` run `20260911T121322623066Z-8f3aef1d19e67fc6ccbf1fe409d7042f` is `PASS/DONE/PROVEN` for contract structure. Native recovery Gate source is complete but run `20260911T121858889011Z-e7dc01479775a5b3adee374fcda1b45a` is correctly `BLOCKED/UNPROVEN` before resource acquisition on missing `PT_MOBILE_APPIUM_SERVER_URL`; cleanup passes. Block and Moment requests still lack generated result/readback contracts and remain excluded; Chat/Group durable commands remain exclusively owned by Device Messaging Engine. |
| CA-HC Conversation Authority DDD hard cut | source integrated / CA-W6 and CA-W7 remain open | Merged master `79ae008706ca29f4bb5f1da29d9b6651a59b2f7c` contains the canonical Conversation production composition, resource-owner routes, shared Federation transport, generated contracts, and retired Messaging/Envelope/duplicate-engine deletions. The linked CA plan records CA-W0 through CA-W4 done and CA-W5 as a source checkpoint, while exact-source Product Closure, PostgreSQL contention, CA-W6 runtime Acceptance, and CA-W7 completion remain `UNPROVEN`. Mobile may now resume source convergence against the integrated contracts, but it must not claim CA-HC runtime completion or weaken those remaining proof obligations. |
| W5 Generated gateway and Social projection convergence | partial / W5-A plus Mobile write-admission source complete; remaining owner gaps and W5-C evidence parked | One session-scoped Social supervisor owns one bounded shared ingress. Generated realtime cursors flow through Social, Group, Moments, notification, and profile projections; suspend/resume, teardown, cursor repair, overflow staleness, session revalidation, and Recovery projection wiring are runtime-owned. Every production Social, Group, Moments, Profile, and Notification mutation now reads exact-scope admission from that live ingress; missing, suspended, globally closed, wrong-scope, or stale-domain ownership fails closed while reads remain available. Group creation, membership, self-leave, update, and dissolve use Device Messaging Engine/Conversation commands without a duplicate ledger or retired route; group-wide mute and the remaining role/ownership/relationship operations stay explicitly parked behind their canonical owners. W5-C remains `UNPROVEN` until those contracts and two-Station/native evidence close. |
| W6A Chat, Contacts, and Group product closure | partial / dependency-ready Mobile source, native delivery, and seven-Gate local closure complete; receiver proof open; paused behind DWF-B | Chat consumes Device Messaging Engine projections and implements failed/retrying/sending/read/delivered status, resend, reply, thread, reaction, pin, edit, recall, device-local flags, command outcomes, attachment recovery, typed draft persistence, and explicit page-content/message-section/presentation/overlay boundaries. Section 6.2 records complete Friend Request pagination, traversable render windows, logical history/search counts, real-scroller anchors, earlier equivalent empty native summaries, targeted pin reads, and removal of unopened-history hydration. Final aggregate `20260913T000635219880Z-7ecb16303283993de65a90ef028badfa` passes all seven local W6A Gates with `DONE/PROVEN`. Both retained simulators have the final source build and matching live assets without data reset. Nonempty receiver summary proof and active-history memory bounds remain open. Forward/delete and the remaining owner-blocked Group/Social contracts stay parked; two-actor/two-Station receiver and CA-W6 proof remain unproven. |
| W6B Moments product closure | source partial / current-schema Mobile-owned corrections verified and delivered | `MomentsPage` consumes one session-scoped Moments runtime that owns feed, selected-detail, and bounded per-post comment freshness across page unmounts. Superseded reconciliation cannot change availability or acknowledge a cursor; inline comment readback targets its post without replacing pagination or selection. Comment request metadata is released on settlement/eviction with monotonic IDs. Reaction transitions update both retained feed/detail representations, reject non-available detail, and retain pending ownership until settlement. The 56 focused regressions and final local Gate pass. Feed and comment projections remain bounded with a 100-row rendered comment window. Restored encrypted-media preview still requires a descriptor-bearing draft schema, and policy-hidden explanation requires a Station producer. Native multi-actor receiver evidence remains `UNPROVEN`. |
| W6C Profile and Settings product closure | source partial / owner-backed Mobile product frontier frozen | `SettingsPage` consumes independent session-scoped Profile and Notification projections plus one app-scoped device-settings runtime. Authoritative profile editing/readback, generated notification categories, real Group/Moments counts, native app version, local cache clearing, permissions, language, Station change, logout, explicit unavailable states, and save/discard/stay exit handling are implemented. Profile cache operations drain before lifecycle scope replacement and every late result is fenced to its exact session/gateway/storage owner. Canonical privacy and blocked-user contracts remain absent; native account/device conflict evidence remains `UNPROVEN`. |
| W6D Recovery and degraded-state closure | source partial / Auth expired-session composition closed; W5-trigger and physical UI proof remain | The app-level `RecoveryOverlayHost` mounts once, while each visible recovery surface remains `on-visit + none`; Station mismatch and device-local actions delegate to lifecycle/auth owners, deferred runtime state is shell-scoped, and raw Station peer IDs stay hidden. During `access-gate-chain`, Auth owns the visible expired-session task inside its single card and filters only the duplicate `device-local-flag/session-expired` overlay; all other recovery states remain unchanged. W4 command/draft/reconcile/reset actions route through production runtime owners, and every recovery surface has a stable non-visual Acceptance selector. W5-A supplies write-admission closure, per-domain staleness, overflow reconciliation, and session-revalidation inputs to `RecoveryProjection`. The normal Auth state has exact-current-source native screenshot/geometry proof; expired-session geometry has production tests and direct prototype evidence but no fabricated native state injection. Identity-mismatch, revocation, overflow, and deferred-state production triggers still depend on W5, so `mobile-native-recovery-ui-e2e` run `20260911T121856462246Z-4ca3c0e41645f54919932f2f0d240a58` remains correctly `BLOCKED/UNPROVEN`; physical focus and recovery evidence remain open. |
| W7 Native lifecycle and platform closure | source partial / dependency-ready iOS integration complete | W7-A provides real Android/iOS camera, microphone, media/photo-library, and notification permission APIs. W7-B provides foreground/background callbacks and Rust generation fencing. iOS now produces network state through `NWPathMonitor`; limited photo-library access is usable but non-requestable; browser reconnect fallback remains until native-network readiness; synthetic native-event emission is acceptance-feature-only. APNs registration/token/tap ownership, BGTaskScheduler identifiers/cadence/cancellation/expiration/completion, and the native media-picker result lifecycle remain design gaps. W7-C/D provide scenario-owned provisioning and native Gate branches. Physical W7 runs remain `BLOCKED/UNPROVEN` at unavailable Appium/device resources. |
| W8 Atomic old-path deletion | caller inventory exhausted / hard cut blocked by six owner contracts | The hard-cut scanner rejects production Mobile `/friend-chat/*`, `/group-chat/*`, and generic Group ledger callers across every production feature file. Group create/invite/remove/self-leave/update/dissolve and all Group generic-ledger admission are deleted. The historical run `20260911T121857501436Z-0839ef186e6e585823b17b98f91a8a61` failed on eight callers; current source has since removed canonical Group update/dissolve, and the scanner now fails on exactly six protected-owner callers: Group member update and ownership transfer plus Social block, unblock, blocked-user listing, and directional friendship status. Removing them now would drop accepted behavior, while adapting them locally would create a second owner. Final W8 closure also depends on W6A-W6D, W7, and CA-W6/CA-W7 evidence. |
| W9 Native Acceptance and readiness audit | partial / final current-source native delivery and local W6A Gate closure complete; broader proof open | The final implementation-first source passes `530/530` Mobile Vitest tests, Mobile Web type-check, Social wire/runtime-boundary checks, production Web build, Rust check, Xcode project validation, contract-checker tests, binding verification, and diff hygiene. Aggregate `20260913T000635219880Z-7ecb16303283993de65a90ef028badfa` passes all seven local W6A Gates with `PASS/DONE/PROVEN`; Mobile Domain validation is structurally valid for six capabilities. Final diagnostic `20260913T000826587131Z-adbc641e874d3deba5585ec0d1593d20` records identical signed arm64/iPhoneSimulator binaries and live embedded assets on both retained apps, unchanged 61/43-file installation datasets, visible Auth/Station-entry surfaces, and complete automation cleanup. That diagnostic remains `PARTIAL/UNPROVEN` for product proof. Earlier native results apply only to their recorded source scopes. Physical Social, lifecycle, accessibility, recovery, and receiver evidence remains incomplete, so W9-D through W9-F and overall readiness stay open. |

### 2026-09-11 iOS Functional Batch Closure

- **Implemented**: Station removal confirmation and advertised-credential
  filtering; Chat status, resend, reply, thread, reaction, pin, edit, recall,
  device-local flags, visible command outcomes, reliable draft and attachment
  recovery; Moments authoritative detail, comments, image-only publication and
  truthful recovery states; authoritative profile editing, real available
  counts, app version, cache clearing, permissions, and explicit unavailable
  settings; native iOS network observation and permission fidelity.
- **Native build contract**: XcodeGen output is deterministic, stale Rust
  references are removed, signing configuration is externalized, and built
  apps are rejected when callback schemes are missing, duplicated, wrong, or
  unexpected.
- **Final simulator execution**: the 2026-09-11 arm64 bundle at
  `apps/mobile/src-tauri/gen/apple/build/arm64-sim/Peers.app` passed strict
  code-sign verification, installed on iPhone 17 Simulator
  `BE69F890-2530-4888-9E3C-670308C99EB5`, launched as
  `com.peers.touch.mobile`, rendered the Station entry surface, and retained
  the exact `peers-touch` callback scheme in the installed artifact.
- **Not implemented by this batch**: generic Access Gate submission/finalizer
  semantics; Conversation forward/delete; the eight Group/Social owner
  contracts; encrypted restored-media descriptors; Station account preference
  and blocked-user contracts; APNs/tap ownership; BGTaskScheduler policy;
  native media-picker result lifecycle; physical-device proof.
- **Historical claim, superseded by section 6.2**: this batch drained only its
  inventory. Native use subsequently exposed additional Mobile-owned defects.
  Full `IOS_SOURCE_COMPLETE`, `IOS_RUNTIME_PROVEN`, and
  `MOBILE_PRODUCTION_READY` are not claimed.

### 2026-09-10 Post-Merge Ready Queue

- **Done**: the owner explicitly authorized the audited latest-master update.
  `git merge --ff-only origin/master` advanced `merge-desktop-prototype` from
  `79ae008706ca29f4bb5f1da29d9b6651a59b2f7c` to
  `87b94e4e20ef025ffaacac6a0b6a766b0b9c1679` without conflicts. The binding
  verifier passes at the new HEAD, all 29 Mobile dirty paths remain present,
  and safety stash `783451f708eca506f6a606cdae77a69b6a32fc2e` remains recovery-only
  and must not be replayed automatically.
- **Audited**: PR #109 adds Station profile/deploy guards, dev federation
  bootstrap, Desktop Friend Request behavior, and a Friend Request gateway
  Gate. It does not add the five missing Group authority operations, the
  actor-device leave-intent binding, role/ownership transition support, or the
  four Social block/friendship contracts. Those W5 branches remain parked
  after synchronization.
- **Done**: canonical CA-W5 source integration is present. Conversation owns
  production Chat authority, the retired Messaging/Envelope and duplicate
  Conversation engine paths are absent, and canonical generated bindings are
  the master copies. This supersedes the earlier "external unpushed branch"
  status but does not prove CA-W6 or CA-W7.
- **Done**: repaired the Mobile simulator iOS static-bundle input at its
  provisioning/build owner so Xcode consumes the fresh `apps/mobile/dist`
  output without committing generated web assets or creating source drift.
  Focused Provisioner tests pass. The latest source-bound
  `mobile-simulator-access-e2e`,
  `mobile-ios-simulator-layout-accessibility-e2e`, and
  `mobile-simulator-runtime-lifecycle-e2e` Evidence Store runs are
  `PASS/DONE/PROVEN`; all cleanup paths pass.
- **Done**: corrected the Mobile simulator Acceptance Registry rule so a change
  to the shared simulator Provisioner selects the already-required W9-C
  `mobile-simulator-runtime-lifecycle-e2e` Gate. The focused planner regression
  test and exact `HEAD` plan both prove the Gate is no longer omitted.
- **Done**: removed the invalid aggregate Mobile Acceptance dev profile.
  Mobile Native, Station lifecycle simulator, and Social simulator
  Provisioners now resolve service endpoint, deployment environment, and Relay
  health references from the Gate process environment, acquire leases for the
  resolved deployments, and persist only verified service attestations in the
  Runtime Manifest. The obsolete active pointer and cached profile are removed;
  the local primary deployment cache remains a runtime input, not topology
  authority.
- **Partial / parked by owner contracts**: audited and cut the Mobile
  Chat/Social administration
  callers away from retired `/friend-chat/*` and `/group-chat/*` routes.
  Group creation now uses the Device Messaging Engine create-conversation
  transaction without a duplicate generic-ledger wrapper, invite/remove use
  the Core-owned MLS membership transition, and self-leave uses the signed
  leave-intent path. Four Group and four Social retired routes remain behind
  the exact shared Core, role/ownership, or Social Proto/API boundaries
  recorded in W5.
- **Done**: extended the Mobile hard-cut caller inventory so the surviving
  retired route families and generic Group ledger usage across all production
  feature files fail deterministically.
  The latest source-bound `mobile-hard-cut-static` Evidence Store run reports
  the exact eight remaining retired route callers.
- **Done**: the source-current aggregate run exposed a
  generic Evidence Store finalization defect after
  `mobile-simulator-social-convergence-e2e` correctly blocked on missing reset
  authorization. The manifest had already been structurally redacted, but a
  second free-text redaction pass interpreted the
  `fixture-authorization:<variable>` resource identifier as a header and
  produced invalid JSON. The Evidence Store now performs one structural
  redaction pass before serialization, with an exact regression test. The same
  retry exposed a provisioning self-test that hardcoded WebDriver port `4445`;
  it now selects a free test slot and then deliberately occupies only that
  slot's WebDriver port. Evidence Store, runner, Infra boundary, validator,
  quality, and runtime-provisioning self-tests pass. Product assertions and
  reset authorization remain unchanged.
- **Done / dynamically admitted root-cause repair**: the final
  source-current aggregate exposed two evidence-reporting defects without
  changing the Mobile product result. The Acceptance report and Quality
  Evidence projections assume every selected Gate uses the legacy `command`
  field and cannot render D-18 `argv`-based Gates. Separately, the expected failing
  `mobile-hard-cut-static` report does not emit its plan-owned W8
  Phase/BOM/Spec metadata, so the aggregate correctly reports one missing
  result-traceability row in addition to the nine known retired callers.
  The generic report projections now render either `command` or D-18 `argv`
  with fail-closed validation, and the Mobile hard-cut Gate emits
  `W8 / W8 Atomic old-path deletion / MS-AG01` on failure. Five focused
  regressions pass. The full aggregate confirms zero missing result-traceability
  rows while retaining the exact nine hard-cut callers. The repairs do not
  weaken the hard-cut scan or alter caller ownership boundaries.
- **Parked**: the non-destructive W9-D preflight cannot start because Ready 2
  is partial and the hard-cut Gate is intentionally failing. When W5 converges,
  run it with service bindings injected into the Gate process. Product
  execution remains conditional on exact-source service attestations and the
  existing reset authorization contract.
- **Ready in the current W4 slice**: MS-D15 is accepted and W4 owns the
  Model/Station command-result contract. Implement the authenticated Friend
  Request command-ID/hash lookup before replacing the current v1 persistence
  layout; the current global 2000-record limit does not satisfy the accepted
  per-Station/PTID limits.
- **Parked**: `mobile-identity-contract` is blocked by the Station Social
  test-only DID alias in
  `apps/station/app/subserver/social/infrastructure/relationship_schema_test.go`,
  which is outside this Mobile-owned worktree.
- **Parked**: CA-W6 exact-source Product Closure, PostgreSQL contention,
  CA-W7 completion, physical iOS/Android/Appium/provider proof, scheduled
  WorkManager/BGTaskScheduler semantics, and destructive W3 Fixture execution
  retain their existing owner, resource, design, or authorization boundaries.
- **Concurrency decision**: serial integration. Ready 1 changes the source
  identity consumed by all later evidence, Ready 2 and Ready 3 share the Mobile
  caller/cutover contract, and final Gate runs share simulator, Appium, and
  Evidence Store resources. No subagent write lane is active.

### 2026-09-11 W3 Navigation Closure And Progress Projection

- **Progress accounting**: formal full-proof closure remains `3/15`; this is
  not the implementation percentage. Mobile-owned implementation/source
  progress was `6/13` before this W3 navigation slice and is `7/13` after its
  source closure. The last pre-fast-forward aggregate Gate result was `7/17`
  and is stale for the current source. Source, current Gate evidence, and
  formal closure remain separate claims.
- **Source done**: MS-D04 descriptor ownership now covers Contact profile,
  Moment detail, selected Settings detail, Find People, and Create Group. The
  corresponding component-local route/overlay booleans and identities are
  removed while runtime/store ownership of business freshness remains intact.
- **Acceptance**: route state changes before data work; primary tabs remain
  `on-visit + none`; details and overlays remain selected-only and unmount on
  back/close; switching primary tabs clears detail and overlay state; tests
  prove route identity, de-duplication, back behavior, and reset behavior.
- **Prototype classification**: `Implementation bug`. The confirmed Mobile
  prototype already exposes Contact and Settings detail navigation and the
  Mobile architecture already requires Moment detail plus Contacts overlays.
  Product-visible intent does not change, so the prototype is not amended.
- **Concurrency decision**: serial. Navigation descriptors/store, Shell
  rendering, and the three pages share one discriminated route contract and
  must move atomically. The integrator owns the plan, shared route types,
  product files, focused tests, and final Gates; no subagent write lane is
  active.
- **Verification state before source freeze**: 49 focused
  lifecycle/navigation/runtime tests pass; 21 Harness tests and 59 focused
  Mobile Acceptance tests pass; Mobile Web type-check, Social wire/runtime
  boundaries, production build, Rust check, iOS project discovery, locale
  parsing, diff hygiene, and `mobile-contract-static` pass. Aggregate run
  `20260910T181126031171Z-4a5d72b7f65fa41b4db9a01536ea3279` finalized
  against workspace digest
  `sha256:dcc601aab019ace1c25484466920b1d1f9874ca32da917836ff4b2b6c37dc113`
  with seven passed, twelve blocked, one expected W8 hard-cut failure, and zero
  result-traceability gaps. The authoritative W3 simulator run
  `20260910T181317433388Z-1443bb3eff09e2d0b1b5a912bab2e759` is
  `PASS/DONE/PROVEN` on iOS Simulator and Android Emulator with cleanup passed.
- **Parked**: destructive Station reset, W5 shared Core/Social contracts,
  CA-W6/CA-W7 proof,
  physical devices/Appium, provider accounts, WorkManager/BGTaskScheduler
  semantics, and Station Social identity aliases retain their existing
  authorization, owner, or resource boundaries.

### 2026-09-11 W5-A Shared Ingress Execution

- **Plan amendment**: the prior dependency edge treated all of W5 as blocked by
  W4. The accepted Social Runtime architecture already assigns event-stream
  lifecycle, projection freshness, cursor repair, and teardown to the Mobile
  runtime supervisor independently of W4 durable command persistence. W5 is
  therefore split mechanically into W5-A/W5-B/W5-C above; no product,
  ownership, schema, or proof contract changes.
- **Source complete**: one session-scoped runtime owns the Station Social
  stream, bounded data/control queues, opaque cursor resume, domain fan-out,
  deduplication, staleness, write admission, targeted reconciliation, session
  revalidation, suspend/resume, drain, and teardown. Group remains subordinate;
  Moments feed and Profile/account preference projections are runtime-owned.
  Page-created and fake ingress/projection/gateway owners are deleted.
- **Acceptance connected**: the public Social projection exposes ingress
  lifecycle, write admission, stale domains, cursor, and queue depth. Social
  journey readiness requires an active ingress with open admission and no stale
  domains. Registry rules map shared, Moments, and Profile runtime-owner paths
  to their simulator and native Social product Gates, with planner regressions.
- **Local verification**: 121 Mobile Vitest tests, 89 Mobile Rust tests,
  `pnpm mobile:check`, 26 Acceptance planner tests, focused Mobile journey
  tests, and diff hygiene pass. Environment-backed convergence remains a
  separate W5-C proof obligation.
- **Parked**: five Group administration routes, four Social
  block/friendship routes, W4 durable command outcome/readback convergence,
  destructive Fixture execution, and physical/native convergence retain their
  recorded owner, authorization, or resource boundaries.
- **Concurrency decision**: serial integration for source freeze and evidence.
  Shared runtime contracts, Acceptance mapping, documentation, and Gate
  resources have one integrator owner.

### 2026-09-11 Group Self-Leave And Native Scenario Contract Closure

- **Group self-leave source complete**: Mobile now derives the exact local and
  authoritative Conversation heads, signs the Core-owned MLS leave intent, and
  submits it through `/conversation/mls/leave-intent`. The gateway calls only
  the typed Mobile Messaging Engine command; it has no retired-route fallback.
  Focused Group gateway tests pass `5/5`, both self-leave Rust tests pass, and
  the hard-cut caller inventory drops from nine to eight.
- **Native scenario source contract complete**: `mobile-native.yaml`, the
  Provisioner, Gate catalog, and `native_e2e.py` now share one exact nine-scenario
  matrix. Recovery, recovery UI, Social convergence, Chat/Contacts, Moments,
  and Settings use D-18 `argv` plus the Appium capability, exclude OAuth
  credentials/provider/browser/finalizer resources, and retain the four-client,
  two-Station, Relay, actor-Fixture, build-identity, lease, and cleanup
  contracts required by their physical journeys.
- **Failure honesty**: the six product scenarios stop before resource
  acquisition with source-bound `BLOCKED/UNPROVEN` results while their exact W4
  or W5 product dependency is incomplete. They do not publish synthetic PASS
  evidence or substitute simulator/source tests for physical receiver proof.
  The focused native runner and preflight suites pass `124/124`; all six
  current-source Gate invocations emit the expected structured blocker.
- **W3 retry evidence**: the actor Fixture binding fix passes all `41`
  Provisioner tests. Authorized run
  `20260911T012011717775Z-69530b06afc87a79a2da0ef984400286`
  stopped before Fixture mutation because the secondary disposable Station
  lease was actively owned by `agent-v2-kernel-foundation-e2e`; reverse cleanup
  passed. This is a live shared-resource dependency, not an implementation
  failure, and W3 remains queued for retry after lease release.
- **W3 Station registry root-cause action**: authorized run
  `20260911T015456789109Z-4a6c8c7151dcf3a214dc004a3bd20026`
  reached `FIXTURE_READY` and proved both typed Station bindings, then exposed
  an unsynchronized registry write: `station.select` returned the primary
  Station while an unawaited `App.tsx` auto-probe write from the stale
  secondary-active component snapshot restored the secondary Station before
  `lifecycle.scope.read`. The accepted `stationRuntime` owner is missing from
  the runtime graph. This action adds that single serialized and observable
  owner, routes UI/Auth/Acceptance access through it, retains the Provisioner's
  fail-fast assertion, and adds focused race regression coverage.
- **W3 concurrency decision**: serial. The Station registry owner, lifecycle
  descriptor, UI projection, Auth consumers, and Acceptance actions form one
  atomic ownership cutover. The integrator exclusively owns those files,
  post-fix runtime evidence, cleanup audit, and plan synchronization.
- **Current source checks**: Mobile Vitest `123/123`, Mobile Rust `91/91`,
  focused Mobile Acceptance `190/190`, planner `26/26`, `pnpm mobile:check`,
  Mobile Domain structural validation, `mobile-contract-static`, Acceptance
  Runtime Provisioning self-validation, and diff hygiene pass.
- **W3 final runtime proof**: after the singleton Station registry owner,
  fenced auth revocation target, OAuth-owned purge scope, and exact typed
  cleanup projection landed, authorized run
  `20260911T035616890352Z-60057e97ce9dd6c0cd61fe00a972859c`
  completed as `PASS/DONE/PROVEN`. It proves valid-session restore,
  same-account takeover, revoked-session cleanup, ten authenticated Station
  switches with confirmed remote revocation, lifecycle generations 7 through
  16, old-scope absence, final logout at generation 17, both product Harness
  cleanup calls, and complete parent-owned reverse cleanup. The run is bound to
  commit `5bf508ace5ad7c0138fe5fb209c7ed77744073ea`, workspace
  `b0a926025d2b25b9`, and the exact dirty-workspace digest recorded by its
  immutable manifest. Physical-device lifecycle and secure-store failure
  behavior remain outside this simulator claim.
- **Post-fix verification**: Mobile Vitest `127/127`, Mobile Rust `91/91`,
  focused Mobile Acceptance `201/201`, planner `27/27`,
  report/quality/runner regressions, `pnpm mobile:check`, Mobile and Acceptance
  Infra structural validation, `mobile-contract-static`, and diff hygiene
  pass. `mobile-hard-cut-static` remains the expected
  `FAIL/PARTIAL/UNPROVEN` result on exactly eight contract-owned callers.
- **Aggregate evidence integrity repair**: `mobile-identity-contract` now uses
  the canonical `AcceptanceGate` envelope and module launch form, while Domain
  validation reports derive Phase/BOM/Spec/Gate traceability from their
  existing Domain, Capability, Feature, and validation-Gate contracts. The two
  W9-D simulator Gates now enforce their W5 prerequisite before any service
  attestation, lease, Fixture, or Appium acquisition. These repairs preserve
  the identity and hard-cut failures and do not promote blocked product scope.
  The authoritative aggregate result is the External Evidence Store latest
  produced after this amendment.
- **Current-source evidence closure**: aggregate run
  `20260911T045141378355Z-b2a112ee79ea92ba43b48e3c55e50567`
  is bound to workspace digest
  `sha256:3d987717abdb985c6edb7106bcad931ea80cd752af05384cc795ac64808265f0`
  and records zero missing result-traceability rows. Its W3 cell encountered
  only a live `chat-native-disposable-station` lease held by another Goal.
  After that lease released, source-identical retry
  `20260911T050114842827Z-7af66e5acc774508148c61d5a26d3d71`
  completed as `PASS/DONE/PROVEN` with both Station attestations, two bound
  simulator clients, product-Harness cleanup, runtime-binding cleanup, lease
  release, and zeroized launch context. W9-D runs
  `20260911T045740628619Z-46617d4293ff02383f4deb0fba10c7fe`
  and `20260911T045741102839Z-7e7dc8942f87d9144a3bb048130795b0`
  now stop at `mobile-product-dependency:w5` with empty service/client
  acquisition and no registered resource cleanup, before Relay source
  attestation, Fixture reset, simulator, or Appium work.
- **Concurrency decision**: both disjoint writer lanes are reconciled and
  closed. The integrator exclusively owns the shared Gate catalog, runtime
  execution, plan/evidence synchronization, and final cleanup audit.

### 2026-09-11 W4 Schema Decision Inventory

| Concern | Current source | Accepted target | Decision boundary |
|---|---|---|---|
| Scope key | generated v2 partitions use exact `station_peer_id + actor_ptid` scope; random scope DEK is wrapped by a native install KEK | accepted `station_peer_id + actor_ptid`; random scope DEK wrapped by a native install KEK; drafts add `surface_kind + target_id` | source complete; physical platform recovery proof open |
| Payload | generated oneof contains only `FriendRequestCommand`; the signed command ID, deterministic bytes, and SHA-256 remain identical across ledger, transport, result, and checkpoint | accepted generated oneof with only `FriendRequestCommand`, one ID, deterministic bytes, and payload hash | source complete; all other current callers remain excluded |
| Capacity | per-partition 512 unresolved records, 16 MiB total, and 256 KiB per payload are enforced | accepted per-partition 512 unresolved records, 16 MiB total, 256 KiB per payload | source complete and covered by Rust boundaries |
| Scheduling | one inflight command per ordering key with four keys active concurrently | accepted one inflight command per ordering key and four ordering keys active concurrently | source complete with full-jitter 1s-to-60s retry and eight-attempt/domain-expiry ceiling |
| Lifecycle | Station/session generation-bound activation, atomic draft-write fence, teardown, quarantine, reset, and recovery projection | Station/session generation-bound initialization, teardown, quarantine, and recovery projection | source complete; physical lifecycle/recovery evidence open |
| Chat boundary | Group generic-ledger admission removed in this slice | all Chat/Group durable commands owned only by Device Messaging Engine | remaining retired Group routes require W5 owner contracts |

The Owner approved the exact v1-to-v2 schema migration and planned destructive
Fixture reset on 2026-09-11, then explicitly accepted MS-D15 on 2026-09-11.
MS-D15 and the corresponding `data-model.md`, `design.md`, and `integration.md`
amendments are now implementation authority. The required authenticated
Station Social command-ID/hash result lookup and schema-v2 source implementation
are complete; physical recovery proof remains open.

### 2026-09-11 W4 Architecture Amendment

- **Design source**: accepted MS-D15 in `decisions.md`; accepted v2 command,
  resolver, retry, retention, key, quarantine, and draft contracts in
  `data-model.md` §4-§5; runtime ownership and cutover constraints in
  `design.md` §8.2 and `integration.md` §7.
- **Verified current-state correction**: Friend Request is the sole v2
  candidate. Station Social command-ID/hash lookup and the generated Mobile
  envelope now use the completed atomic same-ID
  persistence/resolver/lifecycle cutover. Social block and Moment
  reaction/comment/reply requests have no complete generated
  idempotency/readback contract and remain excluded.
- **Accepted exact boundary**: one generated Friend Request payload member,
  compile-time Rust resolver registry, Device Messaging Engine identity/signing
  port without key ownership transfer, exact signed-byte persistence, a
  persisted cancel/dispatch compare-and-swap fence, 30-second
  dispatch/readback deadlines, readback-before-replay, full-jitter 1s-to-60s
  retry capped at eight transport attempts and domain expiry, purge only after
  Station-owned result plus local projection checkpoint, and no Chat/Group
  membership.
- **Accepted key/migration boundary**: versioned device-only native install KEK,
  random wrapped Station/PTID scope DEK, HKDF-separated command/draft keys,
  unconditional exact-scope command quarantine plus an independent
  product-state draft retain/discard decision on logout or Station replacement,
  crash-recovery journals for reset and v1 database/WAL/SHM quarantine, and no
  physical secure-delete claim.
- **Independent accepted-D08 cleanup complete**: production Friend Request,
  Social block/unblock, Moment reaction, and Moment comment/reply paths no
  longer create unrelated, opaque, or never-resolved generic ledger rows.
  These writes remain explicitly online-only until an accepted generated
  command/result resolver exists. The hard-cut scanner now rejects
  `InteractionAdmission`/`CommandEnvelope` use from production Mobile features
  and pages.
- **Acceptance injection**: the existing
  `mobile-command-draft-recovery` Feature and Capability now require
  `mobile-hard-cut-static`; Chat command, Contact command, Moments page, nested
  Moments page, and checker paths map through Registry to the recovery and
  product Gates. The synthetic five-path plan selects both static Gates plus
  the exact blocked native recovery/social product Gates.
- **Focused evidence**: Mobile Vitest passes `154/154`, default Rust passes
  `151/151`, acceptance-feature Rust passes `159/159`, focused native/preflight
  Acceptance passes `129/129`, `pnpm mobile:check` passes, Android
  secure-storage Kotlin plus instrumentation compilation passes, the iOS
  Simulator Rust target check passes, and Mobile Domain validation is
  structurally valid. Native recovery and Social receiver proof remain
  `UNPROVEN`.
- **Gate state**: `SOURCE_COMPLETE / PHYSICAL_PROOF_BLOCKED`. The authenticated
  command-ID/hash lookup, generated v2 contract, Rust migration, caller
  cutover, resolver/lifecycle wiring, Harness, and native recovery runner are
  source-complete. Physical recovery proof remains blocked by unavailable
  Appium/device resources.

### 2026-09-11 W4 Accepted-Design Execution Queue

- **Done 1 — serialized contract cut**: add the generated authenticated
  Friend Request result-lookup request/response, Station Social application
  query, resource-owned HTTP route, actor authorization, command-ID/hash
  verification, and focused Model/Station tests.
- **Done 2 — hybrid implementation after contract freeze**: generate Mobile
  contracts once, then execute disjoint Rust command-ledger and draft/key/
  quarantine work while the integrator owns shared generated artifacts,
  lifecycle wiring, plan state, and final reconciliation. The command-ledger
  lane passed `20/20` focused tests; the draft/key/quarantine/reset lane passed
  `22/22` focused tests. Both outputs are reconciled under one shared runtime.
- **Done 3 — serialized cutover**: remove lane-only compile harnesses,
  establish one canonical `runtime::reliability` owner, integrate the platform
  KeyVault and runtime activation, then connect one Friend Request identity from
  signing-owner preparation through persistence, exact-byte dispatch,
  authoritative lookup, projection checkpoint, and row disposition; delete
  the v1 opaque TypeScript/Rust admission surface and browser-only draft
  recovery actions.
- **Done 4 — source/static evidence and frontier recomputation**: run focused Model,
  Station, Rust, Mobile, and Acceptance checks, then recompute W5/W6/W8 and
  runtime Gate readiness without substituting simulator proof for physical
  evidence. The native recovery runner reaches the real Appium boundary and
  remains `BLOCKED/UNPROVEN`; source and local/static checks pass.
- **Parked**: protected CA-HC/Conversation/Key Exchange/Core/Chat generated
  sources, physical devices/Appium/provider resources, and undefined
  WorkManager/BGTaskScheduler scheduling semantics retain their existing
  ownership, resource, or design boundaries.
- **Concurrency decision**: hybrid. Proto generation, shared contracts,
  lifecycle integration, database migration reconciliation, runtime resources,
  and final Gates are serialized under the integrator. After the Social lookup
  contract freezes, command-ledger persistence and draft/key/quarantine work
  may use disjoint write lanes with independent focused tests.

### 2026-09-11 W4 Recovery Gate And W5 Owner Frontier

- **W4 source closure**: the Rust reliability owner, KeyVault adapters,
  exact-scope ledger/draft stores, v1 quarantine, reset journal, lifecycle
  fencing, Friend Request resolver, sanitized Harness actions, deterministic
  Acceptance fault controller, and four-client native recovery runner are
  integrated. The fault command is compiled and registered only under
  `acceptance-harness`; release handlers expose no fault surface.
- **Current-source verification**: Mobile Vitest `154/154`; default Rust
  `151/151`; acceptance-feature Rust `159/159`; focused native/preflight
  Acceptance `129/129`; `pnpm mobile:check`; Android secure-storage debug and
  instrumentation Kotlin compilation; iOS Simulator Rust target check; Mobile
  Domain structural validation; and `mobile-contract-static` run
  `20260911T121322623066Z-8f3aef1d19e67fc6ccbf1fe409d7042f`
  all pass.
- **Physical boundary**: `mobile-native-recovery-e2e` run
  `20260911T121858889011Z-e7dc01479775a5b3adee374fcda1b45a`
  reaches parent-owned native provisioning and stops before resource
  acquisition at missing `PT_MOBILE_APPIUM_SERVER_URL`; its source-bound
  manifest and reverse cleanup are valid. This is `BLOCKED/UNPROVEN`, not a
  substitute proof.
- **W5/W8 owner audit**: no remaining legacy caller has a complete
  source-authorized Mobile cutover. Conversation already owns update,
  dissolve, and role transitions, but Mobile lacks the durable
  update/dissolve adapter, portable Core intentionally rejects non-leaf role
  changes, group-wide/member mute has no canonical owner contract, and the
  current aggregate forbids ownership transfer. Social lacks canonical
  actor block/unblock, directional block-status, and paginated blocked-list
  contracts; relationship reads intentionally suppress blocked edges instead
  of exposing block state.
- **W8 evidence**: `mobile-hard-cut-static` run
  `20260911T121857501436Z-0839ef186e6e585823b17b98f91a8a61`
  fails closed on exactly those eight callers. Removing them now would drop
  accepted Group administration or blocked-user behavior, while adapting them
  locally would create a second owner. They remain parked at the protected
  Conversation/Core/Social contract boundary.
- **Execution frontier**: W4 source and non-physical verification are drained.
  Recovery physical proof waits on Appium and physical devices. Recovery UI,
  W5-C, W6A/W6D product closure, W8, and W9-D through W9-F remain downstream
  of the recorded owner contracts, CA-W6/CA-W7 proof, or physical resources.
- **Aggregate proof judgment**: full dirty-slice run
  `20260911T121322468527Z-57c4a45db4b7db8dcc5f31c9ad741cf6`
  selects all `21` required Gates and records `7` passed, `12` blocked, `2`
  failed/partial, and zero missing result-traceability rows. Simulator access,
  runtime lifecycle, and iOS layout are `PASS/DONE/PROVEN`; the remaining
  blockers and failures match the owner/resource boundaries above.

### 2026-09-08 Mobile-Only Execution Focus

`peers-social` is restricted to the Mobile Shell plan. It must not modify
CA-HC Proto, Station Conversation/Key Exchange, Desktop Messaging, portable
Messaging Core, or generated Chat bindings while `peers-group-chat` owns the
hard cut.

The dependency-ready independent closure queue is:

1. **Completed 2026-09-08** — Refresh Mobile-owned static and local regression evidence: Mobile
   TypeScript, Vitest, Rust, production build, lifecycle/runtime, command
   runtime, and Mobile contract scans. A CA-owned Proto or hard-cut failure is
   recorded as an external blocker and does not authorize a local repair.
2. **Completed 2026-09-09** — Close the stale partial W9-B iOS Simulator layout/accessibility audit across
   every independently reachable surface. Recheck safe area, keyboard
   avoidance, localization, accessible names, text clipping, cold start, and
   deterministic cleanup against the current source.
3. **Dependency-ready subset completed 2026-09-09** — Implement the currently registered-but-unimplemented native Acceptance
   scenarios for W3 lifecycle and W4 non-Chat command/draft recovery:
   - close the owner-layer lifecycle, session-fencing, ledger, draft, and
     recovery-projection gaps identified by the 2026-09-09 audit;
   - add Station-bound iOS Simulator and Android Emulator supplemental Gates
     for the independently provable W3/W4 cells;
   - retain `mobile-native-lifecycle-e2e`,
     `mobile-native-recovery-e2e`, and
     `mobile-native-recovery-ui-e2e` as physical full-proof owners without
     fallback or proof-strength downgrade.
   The Station-bound W3 source and non-destructive preflight, W6D app-level
   recovery host/action ownership, and W7 local lifecycle bridge reliability
   are now implemented. The remaining W6D/W7 native runner cells must exercise lifecycle,
   trust, local reliability, permissions, network, background/resume,
   accessibility, localization, performance, and cleanup without consuming W5
   projections. They cannot be implemented as passing Gates while the native
   permission adapters remain placeholders and no production-triggered
   recovery fault path exists; direct projection injection is forbidden.
   Event-ingress overflow/reconcile cells remain frozen with W5, and partial
   evidence must not close W6D or W7.
4. Verify the physical iOS and Android devices, approved OAuth provider
   accounts, Mobile profiles, and exact source identity required by W2-E2-6.
   When available, execute `mobile-native-access-e2e` and preserve source-bound
   evidence plus cleanup. Missing devices or accounts keep W2-E2-6
   `BLOCKED/UNPROVEN`.
5. Index all independently produced evidence and update only the covered
   Mobile assertions. Do not promote partial cells into W9 readiness.

The suspended queue is CA-HC, W5, W6A, W6B/W6C product closure, the
event-ingress portions and final closure of W6D/W7, W8, W9-D, W9-E, W9-F as a
whole, and final Mobile readiness. After canonical CA-HC integration, verify
source identity and resume those items in dependency order.

### 2026-09-08 Independent Local/Static Baseline

- `pnpm mobile:check`: `PASS`, including Social wire/runtime boundary checks,
  TypeScript, production build, Rust check, and iOS project discovery.
- `pnpm exec vitest run` under `apps/mobile`: `PASS`, 61 tests.
- `cargo test --offline` under `apps/mobile/src-tauri`: `PASS`, 67 tests.
- `pnpm run check:mobile-shell-contracts`: `PASS`.
- `python3 -m pytest scripts/check_mobile_shell_contracts_test.py -q`: `PASS`,
  6 tests.
- Rust emitted existing unused/dead-code warnings, but no compile or test
  failure. This evidence does not cover native runtime behavior.
- The protected CA-generated working-tree changes and `agent.pb.go` remained
  untouched.

### 2026-09-09 W9-B Stable Simulator Closure

- Added the stable
  `mobile-ios-simulator-layout-accessibility-e2e` Gate and its complete
  Feature → Capability → Domain → Registry → Gate Catalog → Mobile plan trace.
- Added the `mobile-ios-layout-simulator` environment with iOS 17.4
  iPhone SE (3rd generation) and iPhone 15 Pro Max cells. The Provisioner
  builds one embedded app, allocates isolated Appium ports/storage, installs it
  on both simulators, and owns reverse cleanup.
- Corrected the launch-surface helper copy to wrap instead of ellipsize and
  bound `document.documentElement.lang` to the active Mobile locale.
- Three source-bound Gate runs passed during implementation:
  `20260909T031013168485Z-2e1b8c60ba0ba02e2c386f835c3c689a` and
  `20260909T031503314122Z-41a107502aac45451aa64f5dc96b927b`, then
  `20260909T032846644671Z-757060997229be583caa73cc91a44418`.
- The authoritative current-source proof is the external Evidence Store latest
  for this Gate. Any later tracked-file edit changes the workspace digest and
  requires a fresh run before another source-current claim.
- The runs proved compact/large English portrait, keyboard-open portrait,
  Chinese portrait, Chinese landscape, native accessible names/bounds,
  WebView clipping/viewport checks, and deterministic Appium/Provisioner
  cleanup. `make acceptance-validate DOMAIN=mobile` and the standalone
  `make acceptance-infra-validate` then passed structural validation.
- The exact dirty-worktree Gap Detector remains `UNPROVEN`: its 56-path input
  includes protected CA-generated files plus pending W3/W4 and physical-native
  surfaces, so it correctly requires Gates outside W9-B. The four-Gate W9-B
  execution bundle was also `PARTIAL` because
  `acceptance-runtime-provisioning-self` retains unrelated Agent V2/Home
  Station and launch-context failures. Neither result broadens or invalidates
  the source-bound W9-B Gate claim.
- This closes W9-B only for the unauthenticated iOS Simulator launch surface.
  Authenticated Shell surfaces, Android, physical displays,
  VoiceOver/TalkBack, and physical-device performance remain `UNPROVEN`.

### 2026-09-09 W3/W4 Evidence Audit And Plan Amendment

- The existing `mobile-native-lifecycle-e2e`,
  `mobile-native-recovery-e2e`, and `mobile-native-recovery-ui-e2e` catalog
  entries all dispatch into `native_e2e.py`, which currently rejects every
  scenario except `access`.
- The physical `mobile-native` environment also requires OAuth provider
  credentials, four physical-device leases, two Stations, and Relay before any
  non-access scenario can start. Those OAuth-specific resources are not valid
  prerequisites for the independent simulator portions of W3/W4.
- W3 source closure is reopened because session revalidation,
  generation-fenced Station/logout transitions, and descriptor-owned
  launch/navigation state remain incomplete.
- W4 source closure is reopened because the ledger/draft implementations do not
  yet satisfy the accepted Station/PTID partition, 512 unresolved-record and
  16 MiB partition limits, 256 KiB payload limit, or four active
  `ordering_key` fairness contract. Recovery projection wiring and user action
  ownership are also incomplete.
- Add dedicated Station-bound simulator injection and supplemental lifecycle
  plus local command/draft recovery Gates. These Gates may prove only their
  declared simulator/local cells. Station exactly-once readback, W5 event
  overflow/reconcile, Chat/Group behavior, physical background/resume,
  Keychain/Keystore deletion failures, VoiceOver/TalkBack, and physical
  performance remain `UNPROVEN`.
- The first dependency-free W3 slice uses
  `mobile-simulator-runtime-lifecycle-e2e` on the existing iOS Simulator and
  Android Emulator environment. It proves only runtime-graph ordering,
  suspend/resume/restart, monotonic generation, visible-app survival, and
  cleanup. A later Station-bound simulator cell remains required for session
  restore/revocation, Station/actor switching, and old-scope absence.
- The W3 owner-layer implementation now places runtime registration and
  transitions in `MobileLifecycleKernel`, restores and revalidates auth through
  the auth runtime descriptor, fences projections before Station/logout
  mutation, and moves primary plus Chat/Group detail visibility into the
  descriptor-backed Mobile navigation store. The Social/Group selection fields
  remain projection/readback context only.
- The first environment execution exposed a Gate composition defect before
  client acquisition: `simulator_lifecycle_e2e.py` called shared manifest
  validators as instance methods. Run
  `20260909T065403749839Z-02432b19b04d8a72c3ca62c7b7cbc1d0` therefore remained
  `FAIL/PARTIAL/UNPROVEN`, while Provisioner cleanup was
  `PASS/DONE/PROVEN`. The shared-validator fix and full-entry regression then
  produced implementation run
  `20260909T065949060369Z-9cd66c70fb98c5c9d0c4954507291137` as
  `PASS/DONE/PROVEN` on both simulator cells. Because subsequent W3
  owner/document edits changed the workspace digest, authoritative
  current-source proof remains the External Evidence Store latest produced by
  the final rerun after those edits.

### 2026-09-09 Station-Bound W3 And Independent W6D/W7 Closure

- The Station-bound W3 implementation now uses the typed
  `mobile-station-lifecycle-simulator` environment with two independently
  attested disposable Stations. The parent Provisioner owns Fixture
  credentials, Appium sessions, service selection, runtime binding proof, and
  cleanup; the Gate child receives only bounded operations and sanitized
  projections.
- Every simulator launch uses topology-free `create_bound_session(client_id,
  launch_options)` and returns exact proof closure for each required
  `(clientId, launchGeneration, bindingRole)` tuple. Product Station switches
  use `select_binding` and preserve the launch generation while advancing the
  Mobile lifecycle generation.
- The W3 Gate covers valid-session restore, same-device-type takeover and
  revocation, ten Station switches, logout, monotonic generation, and old-scope
  absence. Non-destructive preflight verifies both source-bound Station
  attestations and then stops at the explicit `MOBILE_ACCEPTANCE_RESET=1`
  authorization boundary. The authoritative current-source result is the
  External Evidence Store latest produced after this amendment.
- The dependency-ready W6D slice mounts one app-level recovery OverlayHost.
  Blocking Station mismatch and device-local actions delegate to the existing
  lifecycle/auth owners, action failures remain visible, raw peer IDs are not
  rendered, deferred capability notices are limited to Shell/resume state, and
  the component-tree registry records `on-visit + none` child lifetimes.
- W6D does not claim physical W4 or W5 closure. Draft/ledger actions now invoke
  the production W4 owners; identity-mismatch, revocation, overflow, and
  deferred-state product triggers still require W5 closure.
  `mobile-native-recovery-ui-e2e` remains a physical full-proof Gate and must
  not be replaced by direct RecoveryProjection injection.
- The dependency-ready W7 slice hardens local Rust/TypeScript lifecycle
  bridging: generation is exact and monotonic, future/stale/non-consecutive
  duplicate events are rejected, event and reconciliation payloads are
  validated, listener/invoke/emit failures are typed or surfaced, and network
  readback uses one coherent snapshot without interpreting an unobserved state
  as confirmed offline.
- `check:native-platforms` and `check:recovery-ui` are stable local source
  checks. They do not prove native permission behavior, scheduled wakeups,
  physical background/resume, VoiceOver/TalkBack, performance, or cleanup.
  The iOS/Android permission adapters and non-access branches in
  `native_e2e.py` remain explicit implementation/design gaps, so W7 and W6D
  remain partial.
- Acceptance Registry rules now map recovery surfaces and the native lifecycle
  bridge to their Mobile Features and existing full-proof Gates. No weaker
  simulator Gate was added because the current Harness cannot trigger those
  states through production owners without direct projection injection.
- `mobile-simulator-access-e2e` now emits its primary result through the
  canonical `acceptance-gate-evidence-report` contract with Gate, Phase, BOM,
  Spec, observed scope, unproven scope, and sample-emission fields. This lets
  the outer runner retain the existing W2-E1 simulator proof instead of
  downgrading a passed child journey to `PARTIAL/UNPROVEN`; it does not broaden
  the simulator proof into provider or physical-device scope.

### 2026-09-09 W7 Adaptive Queue Admission

- A source audit found four omitted but architecture-defined W7 closures:
  W7-A native permission adapters, W7-B native foreground/background callback
  delivery, W7-C scenario-owned physical provisioning, and W7-D lifecycle plus
  platform Gate branches.
- These are mechanical plan additions under the accepted Web -> Rust -> native
  plugin boundary and D-07/D-08/D-17/D-18 Acceptance contracts. They do not
  introduce a new product journey, persistence owner, topology, schema version,
  or proof tier.
- Non-access physical Gates must provision only their declared resources.
  OAuth credentials, provider/browser leases, Relay, destructive actor reset,
  and four-client allocation remain access-specific unless another scenario's
  accepted runtime manifest explicitly requires them.
- WorkManager/BGTaskScheduler scheduling semantics remain parked behind
  `DESIGN_AMENDMENT_REQUIRED`; ordinary foreground/background callback delivery
  is independently dependency-ready.
- Physical iOS/Android Gate execution remains `UNPROVEN` until the declared
  devices and platform resources are available. Local/static source checks may
  prove implementation structure only.
- W7-A through W7-D source closure is now implemented. The native plugin owns
  Android/iOS permission calls and foreground/background callbacks; Rust owns
  lifecycle generation and replay fencing; TypeScript serializes canonical
  transitions; the physical Provisioner selects resources before credential
  resolution and retains broker-backed device leases, heartbeat, D-18 Appium
  authority, and reverse cleanup. XCUITest uses alert acceptance while
  UiAutomator2 uses its documented permission-grant capability.
- The source closure passes focused Mobile TypeScript, Rust, plugin, and
  Acceptance Python suites, `pnpm mobile:check`, Acceptance plan self-check,
  Mobile structural validation, and the current-source iOS W9-B simulator
  Gate. After exporting the installed Homebrew Android SDK and NDK roots, the
  authoritative latest cross-platform runtime lifecycle Gate produced after
  this amendment also passes; cleanup leaves both simulator platforms stopped.
  Physical
  lifecycle/platform runs correctly exclude OAuth credentials and destructive
  Fixture setup, then stop at the declared Appium/device resource boundary;
  they remain `BLOCKED/UNPROVEN` with cleanup evidence.
- Final source-audit checks pass on the same workspace digest:
  `pnpm mobile:check`, 100 Mobile Vitest tests, 84 Mobile Rust tests including
  doctests, two permission-plugin Rust tests, 135 focused Mobile Acceptance
  tests, Rust formatting, scoped diff checks, Acceptance plan self-check,
  Acceptance Infra validation, Mobile structural validation,
  `mobile-contract-static`, and `mobile-hard-cut-static`. The authoritative
  full-range Acceptance plan is the latest External Evidence Store artifact
  produced after this amendment.
- The authoritative latest Acceptance Gap Detector result produced after this
  amendment remains `UNPROVEN` as required: it accepts current-source simulator
  evidence and retains every unrun physical, destructive,
  CA-HC/W5-dependent, and unrelated-owner Gate as an explicit gap. This is not
  a W7 source defect and does not authorize weaker substitute evidence.

### W9-D Authorized Runtime Preflight Evidence

- `mobile-simulator-social-convergence-e2e`
  `20260904T170306310235Z-258df2e3d976fabd92bfe6e9e864b69d`:
  source commit `ad546dac2f26dccf48902321339aa91cd711f26c`,
  `BLOCKED/UNPROVEN` at `profile:mobile-social-simulator-services`, zero
  clients and services acquired, cleanup `passed`, and canonical
  `secretScan.status=passed`.
- `mobile-simulator-chat-contacts-e2e`
  `20260904T170323837932Z-bdf06853c0f2a6f24fcfbd61f04ef4eb`:
  source commit `ad546dac2f26dccf48902321339aa91cd711f26c`,
  `BLOCKED/UNPROVEN` at `profile:mobile-social-simulator-services`, zero
  clients and services acquired, cleanup `passed`, and canonical
  `secretScan.status=passed`.
- Both manifests are durable in the external Evidence Store. They are
  superseded by the 2026-09-05 environment acquisition below. Shared Station
  profiles on protected port `18080` remain forbidden reset targets.
- The 2026-09-05 runtime acquisition injected two verified disposable Station
  deployments and Relay into the Mobile Acceptance Provisioner. The new
  primary runtime at
  `192.0.2.20:18132` uses isolated Compose project
  `pt-mobile-shell-primary`, separate PostgreSQL and identity volumes, libp2p
  port `4012`, and clean Station commit
  `770e4ec8ae6d0e6fe2ed3d66a76ea89ffff27f55`. The existing secondary runtime
  at `192.0.2.30:18132` runs clean Station commit
  `82073af5dc367ed1fb5184d40c29e50cdd5c4956`. Both expose distinct PeerIDs,
  report federation ready with one connected seed, and pass
  `verify_reset_target`.
- The first authorized runtime attempt,
  `mobile-simulator-social-convergence-e2e`
  `20260905T000126222877Z-6430817fed8cd96883ba20aa830bec56`,
  reached profile-lease acquisition and then failed before Fixture reset with
  `TypeError: __init__() got an unexpected keyword argument 'port'`.
  Provisioner cleanup passed and the canonical secret scan passed. The root
  cause is a partial Acceptance Infra integration:
  `EnvironmentProvisioner.acquire_remote_git_source_lease` passes SSH
  transport arguments that the current `RemoteGitSourceLease` constructor does
  not accept. W9-D remains `UNPROVEN` until that generic constructor/caller
  contract is reconciled and both product Gates execute.

### W9-D Final Simulator Gate Results

- The earlier profile-missing and lease-constructor blockers above are
  superseded. The caller now uses the branch-local
  `RemoteGitSourceLease` constructor contract; the profile-lease and Mobile
  simulator Provisioner suites pass 28/28, and the Infra-boundary, runner,
  validator, and quality-evidence checks pass.
- The primary Station attestation records clean commit
  `770e4ec8ae6d0e6fe2ed3d66a76ea89ffff27f55`; the secondary Station
  attestation records clean commit
  `82073af5dc367ed1fb5184d40c29e50cdd5c4956`. Both Stations expose distinct
  PeerIDs, report federation ready, and passed reset-target verification.
- Final `mobile-simulator-social-convergence-e2e` run
  `20260905T025214693858Z-8fbe271c1ebe7c0858b448d5be2063dc`
  and final `mobile-simulator-chat-contacts-e2e` run
  `20260905T025300285859Z-fff5fd9df9651c8552a6547ab67f9d0c`
  are durable and source-bound to
  `ad546dac2f26dccf48902321339aa91cd711f26c` with workspace digest
  `sha256:5e80b39d46a15d8772fa2d26efa69a8c05dfe2073ac3c9c62a2795977130b41b`.
  Each records both Station deployment attestations before failing closed on
  `station-identity:http://192.0.2.20:18081/app-meta/version`; the shared
  Relay returns HTTP 404 for the required source-attestation endpoint.
- Both final runs are `BLOCKED/UNPROVEN` for product proof, while cleanup is
  independently `passed` and `secretScan.status=passed`. No Fixture reset,
  simulator, emulator, Appium session, client storage, or product journey was
  acquired before the Relay preflight block. The cleanup stack released the
  profile lease and all three remote source leases in reverse registration
  order.
- Mobile structural validation still reports all six capabilities
  `STRUCTURALLY_VALID` when run against an isolated empty Evidence Store. The
  regenerated coverage report remains Mobile 9/9 wired and 0 proven, so the
  structural result is not promoted into W9-D product proof.
- The Acceptance Gap Detector independently classifies both simulator claims
  as `GATE_BLOCKED_BY_ENVIRONMENT` and `UNPROVEN`, with the same Relay
  source-attestation endpoint as the required closure.
- This is an external-runtime hard stop for the current authorized slice.
  Bypassing Relay attestation would weaken source binding, and deploying or
  restarting the shared Relay is not authorized. W9-D remains `UNPROVEN`;
  W9-E, W9-F, and overall Mobile Shell readiness are not claimed.

### W9-D Relay Source-Attestation Diagnosis

- The Relay 404 is a stale deployment, not a missing current-source route.
  `apps/station/app/main.go` unconditionally registers the `app_meta`
  subserver, `apps/station/app/subserver/app_meta/handler.go` owns
  `/app-meta/version`, and the Docker Relay uses the same image and binary as
  Station. The route entered source at
  `0f41bb0965d3fef755c6b051e56ac34b19e9ded5`, which is an ancestor of both the
  bound source and the clean remote checkout.
- The shared Relay remains healthy and exposes
  `/sub-bootstrap/info`, including runtime PeerID
  `12D3KooWRQ2Tc85YxU3gAnP4vbTaWLDtAz6JU6PURsHcspAun6ag`, but
  `/app-meta/version` returns HTTP 404. Its clean remote checkout is
  `92f7b5090ffc22e4218a18f7a0de5cde09ae3c4d` on
  `feat/p0-streaming-runtime-message-actions`; the running
  `pt-relay-relay-1` image was created on 2026-05-15, before the app-meta route,
  and its binary SHA-256 is
  `cde05a041fee6bd9d997e62b84b41b2538939b7109b01b4fcb112178b27a27ec`.
  The runtime therefore cannot be bound to the current clean checkout.
- The remote checkout and this worktree have diverged by 12 remote-only and
  10 local-only commits. Selecting the Relay deployment source is an Owner
  decision; the Acceptance Agent must not choose either history implicitly.
- The configured `relay-1` deployment has no custom build or restart command,
  while the generic Relay fallback invokes a nonexistent `make build-relay`
  target and the actual runtime is Docker Compose project `pt-relay`.
  `make relay` is therefore not a safe executable deployment action for this
  environment without a separately authorized deployment-contract correction.
- Source verification is decisive at the package boundary:
  `go test -race -count=1 ./app/subserver/app_meta/...`
  `./frame/core/plugin/native/subserver/relay/...` passes. A full
  `go build ./app` remains blocked by unrelated pre-existing Agent CLI missing
  symbols (`NormalizeCommand`, `BuildCliPrompt`, `PromptViaArgument`,
  `PromptViaStdin`, and `splitCommandLine`), so no local full-binary smoke is
  claimed.
- Generic Station attestation owner tests remain 3/7 passing because of
  pre-existing tracked-only digest, SSH known-host, invalid-contract, and
  generated-coverage exclusion gaps. They do not explain the Relay 404 and
  were not changed in this source-correct deployment slice.
- At the source-audit checkpoint, status was
  `RELAY_DEPLOYMENT_AUTHORIZATION_REQUIRED`. Closure required the Owner to
  choose the exact source commit, authorize a usable Relay build/recreate
  contract, deploy it, and verify that `/app-meta/version` reported a stable
  `build_commit` matching the clean deployment checkout.

### W9-D Relay Repair And Android Preflight

- The Owner authorized Relay source
  `92f7b5090ffc22e4218a18f7a0de5cde09ae3c4d` and the shared `pt-relay`
  Docker Compose rebuild. The rebuild used a clean Git archive, the existing
  remote Docker context, and the declared `infra` plus `relay` profiles.
- The recreated Relay runs image
  `sha256:5dd89ed47bedb9bc7cbc331dbe3f94b40b3dc7bdb184a5ad69c4443a4ad00ab0`.
  `/app-meta/version` reports the selected clean commit, build label
  `feat/p0-streaming-runtime-message-actions`, build time
  `2026-09-05T03:45:00Z`, and Go `1.24.6`.
- Relay data volumes were preserved, and runtime PeerID
  `12D3KooWRQ2Tc85YxU3gAnP4vbTaWLDtAz6JU6PURsHcspAun6ag` remained unchanged.
  Relay health, `/sub-bootstrap/info`, `/app-meta/version`, both Station
  federation-readiness checks, and profile/source lease cleanup passed.
- The next serial Social run,
  `20260905T033210148918Z-6774c37424af8b51a692a0b761f46ca9`,
  passed service attestation and then failed closed at
  `mobile-simulator:build:android` because the Provisioner did not derive
  `NDK_HOME` from the configured Android SDK. The run is
  `BLOCKED/UNPROVEN`; cleanup and the canonical secret scan passed, and no
  Fixture reset or client session was acquired.
- The dependency-ready correction is a Mobile simulator Provisioner preflight:
  accept an explicit valid `NDK_HOME`, otherwise require exactly one valid NDK
  installation under the configured Android SDK, inject its absolute path into
  the command environment, and fail closed before resource acquisition when
  discovery is absent or ambiguous. Social must pass and clean up before the
  Chat/Contacts Gate runs.
- The Provisioner now implements that preflight before profile lease, runtime
  storage, simulator, emulator, or Fixture acquisition. Explicit, discovered,
  invalid, absent, ambiguous, and command-environment propagation cases are
  covered. The focused profile-lease, provisioning-owner, and Mobile simulator
  suites pass 50/50; Python compilation, scoped diff checks, and real SDK-root
  discovery also pass.
- Social run
  `20260905T040738143171Z-13eef604e43b0b159f131ded9a5b1ed5`
  passed NDK discovery, booted the Android emulator, and entered the Android
  Rust build. It then failed at `mobile-simulator:build:android` because
  Mobile selected rusqlite `bundled-sqlcipher` without cross-compiled OpenSSL;
  `libsqlite3-sys` could not resolve `openssl/crypto.h`. The immutable result is
  `FAILED/PARTIAL/UNPROVEN`, cleanup is `passed`, and
  `secretScan.status=passed`.
- The same run detected source drift because Tauri's deep-link build hook
  rewrote the tracked Android manifest with whitespace-only generated lines.
  The dependency-ready root correction is to use rusqlite's same-version
  `bundled-sqlcipher-vendored-openssl` feature and make the Provisioner restore
  only the verified formatting-only manifest rewrite while rejecting semantic
  build-time mutation.
- The SQLCipher feature, NDK `llvm-ranlib` resolution, and guarded manifest
  restoration are now implemented. The focused suites pass 54/54, the Cargo
  lock is consistent, and Social run
  `20260905T042010710135Z-c034ac2dd68e6205c2d3d1ff5331555f`
  completed both native builds without source drift. It then blocked before
  Fixture reset at
  `fixture-reset:mobile-shell-primary-disposable-station`: importing
  `tooling.acceptance.transports.ssh` first enters
  `core.__init__ -> provisioner -> attestation -> transports.ssh` and raises a
  partially initialized module error. The immutable result is
  `BLOCKED/UNPROVEN`; cleanup and the canonical secret scan passed.
- This import-order failure is a generic Acceptance Infra boundary defect. The
  dependency-ready correction is to remove eager Core-to-transport imports,
  preserve strict SSH behavior through runtime-local transport resolution, and
  add a fresh-process transport-first import regression before rerunning Social.
- The Core-to-transport cycle is now removed through runtime-local SSH transport
  imports in the attestation and remote source lease call sites. The dedicated
  transport-first and strict-host-key regressions pass 2/2, the full
  profile-lease suite passes 11/11, the provisioning-owner suite passes 16/16,
  Python compilation passes, and the scoped diff check is clean.
- The next Social run,
  `20260905T042929248372Z-f5e00e1bdca72d0a0ef36ae1382fb86a`,
  reached `FIXTURE_READY` with clean source attestations for Relay
  `92f7b5090ffc22e4218a18f7a0de5cde09ae3c4d`, primary Station
  `770e4ec8ae6d0e6fe2ed3d66a76ea89ffff27f55`, and secondary Station
  `229af39233369388dd729a30e1917416e59f7092`. Both simulator applications
  built, the reset targets were verified, and the actor Fixture completed.
  The Gate then failed closed before client sessions at
  `mobile-simulator:harness-actions` because the
  `mobile-social-simulator` overlay omits the inherited base action
  `projection.read`, even though the production Mobile Harness already
  implements it. The immutable result is `BLOCKED/UNPROVEN`; Provisioner
  cleanup and the canonical secret scan passed, no Appium/emulator process
  remains, and the generated Android manifest has no tracked drift.
- This blocker is a Mobile business-injection contract mismatch rather than an
  Acceptance Infra defect. The dependency-ready root correction is to make the
  social overlay's required action set include every inherited
  `mobile-simulator` base requirement, add a contract regression for that
  subset relationship, and rerun Social before Chat/Contacts. The Owner
  approved that correction on 2026-09-05. The overlay now includes the
  production `projection.read` action, and its contract test requires the
  social action set to contain every base simulator Harness action. The
  Provisioner suite passes 29/29, the Social and Messaging journey suites pass
  7/7, the production Harness registry test passes 12/12, Acceptance plan
  self-check passes, and Mobile is structurally valid against an isolated empty
  Evidence Store. Validation against the durable Evidence Store correctly
  rejects the prior run as stale after this source change.
- Social run
  `20260905T105425416765Z-4ae0a8c1325ce592492f2639b2eeed17`
  proves that correction at runtime: both simulator clients reached
  `messaging-harness-ready`, and the iOS preflight verified all 29 available
  Harness actions. The run retained clean source attestations for Relay
  `92f7b5090ffc22e4218a18f7a0de5cde09ae3c4d`, primary Station
  `770e4ec8ae6d0e6fe2ed3d66a76ea89ffff27f55`, and secondary Station
  `229af39233369388dd729a30e1917416e59f7092`.
- A later `DriverError` occurred during the first product action, but
  `SimulatorSocialGate.execute` then replaced its primary `reason` with
  `simulator social cleanup was incomplete` when both product-Harness cleanup
  attempts also failed. The immutable result is `FAILED/PARTIAL/UNPROVEN` and
  therefore cannot identify the first failed product action. Appium session
  teardown, environment cleanup, reverse lease release, the canonical secret
  scan, and generated-source restoration all passed.
- This is a Mobile business-Gate evidence-precedence defect. The base simulator
  Gate already preserves a primary journey error, records a separate
  `cleanupReason`, and replaces `reason` only when the journey itself
  succeeded. The dependency-ready correction is to apply the same rule to
  `SimulatorSocialGate`, add a regression proving cleanup cannot hide the
  primary failure, and rerun Social once to expose the actionable product
  failure. The Owner approved that correction on 2026-09-05. The Social Gate
  now preserves an existing primary `reason`, records cleanup failure
  separately, and replaces `reason` only when the journey had succeeded. The
  Social and Messaging journey suites pass 8/8, the existing base-Gate
  precedence regression passes, Python compilation passes, and scoped diff
  checks are clean.
- Diagnostic Social run
  `20260905T110823920350Z-748263569d7a0b60f2e48a6625c5a504`
  preserved the primary failure:
  `access session invalid: session not found`. Both clients again reached
  `messaging-harness-ready`; iOS verified all 29 Harness actions. Cleanup
  failure remained separate in `cleanupReason`, Appium session teardown and
  Provisioner cleanup passed, the canonical secret scan passed, and no
  simulator or generated-source residue remains.
- The source chain identifies a Mobile auth-runtime ownership defect. Simulator
  reinstall preserves native secure storage, while the authorized Station
  Fixture reset deletes server sessions. `authRuntime` restores the old Mobile
  session and `startAccessAttemptForActiveStation` forwards its stale
  `sessionId`; Station `accessgate.actorRefFromSession` correctly fails closed.
  `App.tsx` contains page-local stale-session clear-and-retry logic, but the
  production Acceptance Harness invokes the runtime owner directly and bypasses
  that page branch. The dependency-ready root correction is to move the
  one-time invalid/revoked/expired-session clear-and-retry behavior into the
  Mobile auth runtime, route the page through that owner, delete the duplicate
  page-local recovery branch, add runtime and source-contract regressions, and
  rerun Social before Chat/Contacts. The Owner approved that correction on
  2026-09-05. `authRuntime` now clears an invalid persisted session and retries
  exactly once without it, while unrelated failures and retry failures still
  propagate. `App.tsx` delegates to that runtime owner and no longer carries a
  duplicate session-error classifier or retry branch. Focused auth-runtime and
  Harness tests pass 20/20, Mobile Web type and boundary checks pass, the
  production Web build passes, and the Social/Messaging Gate suites pass 8/8.
- Social run
  `20260905T111919908059Z-258477d8c6437554d1d49d13f3766142`
  proves the auth-runtime recovery: the primary failure advanced from stale
  session rejection to the login action and now reports `invalid email`. Both
  clients reached `messaging-harness-ready`; iOS verified all 29 Harness
  actions. Provisioner cleanup, reverse lease release, canonical secret scan,
  and generated-source restoration passed.
- The remaining failure is a Mobile Social Gate/Fixture contract mismatch.
  The actor Fixture intentionally emits the durable reference
  `station-account:<email>` in `accountRef`, but `MobileMessagingJourney`
  submits that reference verbatim through the email login field. Existing
  native Gate consumers validate the `station-account:` authority prefix and
  resolve the account value at the consumption boundary. The dependency-ready
  correction is to apply the same fail-closed reference resolution in
  `MobileMessagingJourney`, update its fixtures to use canonical account
  references, add a malformed-reference regression, and rerun Social before
  Chat/Contacts. The Owner approved this exact business-Gate correction on
  2026-09-05. `MobileMessagingJourney` now resolves the typed reference before
  any Station action, sends only the extracted email to `access.submit`, and
  rejects a non-Station reference without side effects. The focused Social and
  Messaging suites pass 10/10, simulator Provisioner tests pass 29/29, Python
  compilation and scoped diff checks pass, Acceptance planning selects the
  expected simulator and native Social/Chat Gates, and isolated Mobile
  structural validation passes.
- Social run
  `20260905T121136502638Z-a41890683cb4f4f38cdbaec5ef3d6c42`
  proves the account-reference correction: both clients authenticated instead
  of failing with `invalid email`, then the first Social action failed with
  `mobile.social.runtimeUnavailable`. Both clients reached
  `messaging-harness-ready`; iOS verified all 29 Harness actions. Relay and
  both Station attestations were source-bound. Provisioner cleanup, reverse
  lease release, canonical secret scan, and generated-source restoration
  passed; Chat/Contacts was not run.
- The new failure is a separate Mobile business-Gate launch-state mismatch.
  Harness `access.submit(login)` persists the production session and updates
  `authStore`, but it does not invoke the page-local `MobileAppRoot.login`
  callback that changes `launchState` to `shell`. `MobileShell` therefore does
  not mount `useSocialRuntime`, so `activeRuntime` remains absent and
  `social.request.send` fails closed. The existing production restart path
  restores the persisted session, revalidates the active Station, enters
  `shell`, and starts the Social runtime. The dependency-ready correction is
  for `MobileMessagingJourney` to request the existing `lifecycle.restart`
  action after login, refresh and re-enter the WebView, wait until
  `social.projection.read.active` is true, and add regression coverage before
  rerunning Social. The Owner approved this exact Gate-source correction on
  2026-09-05. `MobileMessagingJourney` now requests the production WebView
  restart after authentication, re-enters the application WebView, and waits
  for the Social runtime projection to become active before issuing Social
  commands. The focused Social and Messaging journey suites pass 10/10, and
  the simulator Provisioner suite passes 29/29.
- Social run
  `20260905T130047819340Z-5798739c1598c3301eb9efea8259e5ba`
  live-proves the launch-state correction: both clients authenticated, both
  reached `messaging-harness-ready`, the iOS preflight verified all 29 Harness
  actions, and the journey advanced into the real friend-request transport.
  The immutable result then failed with
  `POST /friend-chat/friend-request/send HTTP 404`; it remains
  `FAILED/PARTIAL/UNPROVEN`. Relay
  `92f7b5090ffc22e4218a18f7a0de5cde09ae3c4d`, primary Station
  `770e4ec8ae6d0e6fe2ed3d66a76ea89ffff27f55`, and secondary Station
  `d983768315b338e71a5cea48f4eccc95f6a93daa` attestations are source-bound
  and clean. Provisioner cleanup, reverse lease release, the canonical secret
  scan, and generated-source restoration passed. Product-Harness cleanup
  failures remain separately recorded while both Appium sessions were torn
  down.
- The new first failure is a Mobile Social gateway route mismatch.
  `socialGateway.ts` still sends the four Friend Request operations to the
  removed `/friend-chat/*` routes, while the accepted Social Runtime ownership
  plan and the Station Social subserver own send, accept, reject, and list under
  `/api/v1/social/*`. The dependency-ready correction is limited to those four
  Friend Request routes plus a focused route-contract regression; session,
  settings, block, and other legacy routes are outside this correction. On
  2026-09-05 the Owner authorized autonomous execution of all source-backed
  technical corrections inside this W9-D slice without per-fix approval. The
  four Friend Request operations now target their canonical
  `/api/v1/social/*` routes, and the focused gateway regression freezes method,
  path, query, and body mappings. Mobile Vitest passes 57/57, `check:web`
  passes TypeScript plus Social wire/runtime boundary checks, the production
  Web build passes, scoped diff checks pass, and
  `mobile-hard-cut-static` passes through the external Evidence Store at run
  `20260905T132729545320Z-be5a5c97ee2c937187845689cf1e6878`.
- The first route-corrected Social run,
  `20260905T132816833113Z-a1551009a8f05e7d4bfcd7c0049dbdd9`,
  reached both production Harnesses and then failed at the primary Station with
  `POST /api/v1/social/friend-request/send HTTP 500`. The source-bound Station
  log identifies `SQLSTATE 42703: column "actor_ptid" does not exist`.
  The fresh-database migration order created `friend_chat_friendships` through
  a legacy `actor_did` / `peer_did` GORM model after the PTID rename pass had
  already completed. The root correction moves fresh friendship-table creation
  into `MigrateIdentitySchema`, uses only `actor_ptid` / `peer_ptid` model
  columns, and removes the obsolete second migration entrypoint. Fresh-schema
  and legacy-schema regressions plus the complete Social subserver test suite
  pass.
- A leased restart of the dedicated primary disposable Station exercised its
  deployed migration path without changing the attested source commit. Social
  run `20260905T133925954264Z-9b1c57e219f075fd84bc563912d97f4f`
  then passed Friend Request submission and advanced to
  `sim-android friend request did not converge before timeout`. Its immutable
  result is `FAILED/PARTIAL/UNPROVEN`; Provisioner cleanup, reverse lease
  release, source attestations, and the canonical secret scan passed.
- Source and architecture audits agree that this timeout exposes an undefined
  cross-Station Friend Request contract. The current Social service checks and
  writes only the sender Station database, emits only a local notification,
  and has no durable outbox, authenticated remote command, receiver-Station
  materialization, retry/idempotency contract, or cross-Station accept/reject
  routing. The accepted product matrix requires the two-Station receiver
  journey, but existing architecture does not define those semantics.
  Continuing the Social product path therefore requires
  `DESIGN_AMENDMENT_REQUIRED`; changing the Gate to a same-Station fixture or
  duplicating records in the Fixture would weaken the accepted assertion and
  is forbidden.
- Independently, the supplemental Social Gate now emits the canonical
  `acceptance-gate-evidence-report` shape with Gate/Phase/BOM/Spec fields so the
  runner can retain the primary failure trace. Mobile simulator cleanup
  failures also retain their redacted reason. The generic redactor now treats
  exact `errorKey` locale identifiers as non-secret while preserving all other
  key/token detection. Focused Mobile Gate tests pass 28/28, the redaction
  regression passes, and Acceptance runner tests pass 66/66. One unrelated
  pre-existing `local-desktop-gateway` fixture assertion still fails in the
  complete provisioning-model module.
- The Acceptance ownership mapping now includes
  `apps/mobile/src/services/gateways/socialGateway.ts`. Its focused planner
  regression passes and maps the gateway to both simulator Gates plus their
  native full-proof owners. A temporary Git index containing only the 17 files
  changed by this autonomous W9-D closure produced the same canonical mapping,
  while keeping unrelated shared-worktree changes out of the audit.
- Acceptance Gap Detector run
  `20260905T140405687992Z-cad6ff518bdb65f90c1e075bc7c558ec`
  is source-bound to commit
  `ad546dac2f26dccf48902321339aa91cd711f26c` and workspace digest
  `sha256:f830a83ada4c2ddbdb28420393d31bd6a75d0e787cd0aec3822a0db1f965fb49`.
  It correctly returns `UNPROVEN`: the Social simulator Gate is
  `FAILED/PARTIAL/UNPROVEN`, Chat/Contacts was not run because Social did not
  pass, and the selected native/full-proof and Acceptance Infra Gates are not
  silently substituted.
- The scoped Completion Audit confirms that the authorized Fixture reset and
  both target checks passed, all three service attestations were clean and
  source-bound, the Provisioner released actor Fixtures, simulator resources,
  source leases, and the profile lease in reverse order, both Appium sessions
  closed, the allocated ports have no listeners, the owned Android emulator and
  iOS simulator are stopped, and the run-scoped client storage is absent. The
  canonical secret scan passed. The generated Android manifest has no drift;
  unrelated generated Proto and Apple project changes already present in the
  shared worktree remain outside this slice.
- The latest live Social artifact predates the canonical evidence-shape and
  cleanup-reason source corrections. Its wrapper therefore still records
  missing Phase/BOM/Spec/Gate traceability, and its product-Harness cleanup
  entries contain only `DriverError`. Focused tests prove the new source
  behavior, but no later live run proves those two evidence improvements.
  They remain local source closure rather than runtime proof.
- Current deterministic checks pass: Mobile Vitest 57/57, focused gateway
  route regression 1/1, Mobile `check:web`, production Web build, complete
  Station Social tests, simulator Gate tests 22/22, focused redaction and
  planner-mapping regressions, Gap Detector self-tests 22/22, scoped
  `git diff --check`, and current-source `mobile-hard-cut-static` run
  `20260905T140617223630Z-3fadebc71f030eb30e8a11aaecfb47d7`.
  `acceptance-validate --infra` still fails closed because the latest durable
  Acceptance run source digest predates the current uncommitted corrections;
  it is not reported as passing evidence.
- W9-D remains `UNPROVEN`. W9-E, W9-F, and overall Mobile Shell readiness
  remain out of scope for this execution slice. The next product execution
  action is blocked at `DESIGN_AMENDMENT_REQUIRED`: an accepted architecture
  must define Friend Request authority, receiver Home Station resolution,
  authenticated durable cross-Station delivery, retry/idempotency and
  deduplication, receiver materialization, accept/reject routing, and
  event-after-commit projection semantics. Chat/Contacts remains unrun behind
  the W9-D Social prerequisite.
- A second resume audit on 2026-09-05 reverified the immutable worktree binding
  and found no accepted source or implementation that closes this semantic
  gap. `MS-PA19` still requires two actors on two Stations;
  `SendFriendRequestRequest` still carries only receiver PTID and message;
  `StationEnvelope` has no Friend Request payload; and
  `FriendRequestService` still writes only its local repository and local
  notification producer. No additional implementation or Gate run is
  dependency-ready before architecture review.
- A third consecutive Goal audit on 2026-09-05 found the same sole blocker.
  No current Social, Federation, Model, or Mobile source defines the missing
  cross-Station Friend Request authority and delivery contract, and the
  existing immutable Gap Detector result remains `UNPROVEN`. The Goal is
  therefore blocked pending an explicit Owner-reviewed architecture amendment;
  no additional product code or dependent Chat/Contacts Gate may run before
  that decision is accepted.
- After the Owner resumed the blocked Goal, fresh blocked-audit attempt 1 on
  2026-09-05 found no changed architecture, Proto, Station implementation, or
  external state that makes a new Goal Slice dependency-ready. The Goal remains
  active for the resumed audit window, while W9-D itself remains blocked at the
  same DESIGN gate.
- Resumed blocked-audit attempt 2 on 2026-09-05 again found no accepted
  cross-Station Friend Request contract and no relevant source delta. The
  dependency-ready frontier remains empty; Social stays `UNPROVEN` and the
  Chat/Contacts Gate remains forbidden by the W9-D execution order.
- Resumed blocked-audit attempt 3 on 2026-09-05 confirmed the same condition.
  The resumed Goal is blocked again until an Owner-reviewed architecture
  amendment changes the dependency frontier.
- The 2026-09-06 source/history audit expanded the blocker from a missing
  Friend Request transport contract to a verified cross-domain ownership defect.
  Conversation was established as the unified Chat API before the later Device
  Messaging Engine, but the latter introduced duplicate business routes, proto request
  families, and authority stores. MP-D09/MP-D10 required one Conversation framework
  and a hard cut, while W11 measured only exact route prefixes instead of semantic
  capability ownership. This is not a Mobile-specific defect and cannot be repaired by
  adding a Social or Mobile transport silo.
- The formal DESIGN package lives at `docs/architecture/engineering/api-governance/`. Its route,
  caller, and Proto audit found no independent non-Chat public capability for the
  duplicate facade. The package also established receiver-Home-Station Friend
  Request authority, exact retry/dedup, durable result return, relationship convergence,
  event-after-commit, and one domain-neutral durable Federation transport.
- The Owner accepted revised AO-D01..AO-D06, MP-D30, and Federated Social D-07 on
  2026-09-06. The accepted target makes Conversation the sole Chat entry point, retains
  the internal Device Messaging Engine, routes support APIs by resource owner, and
  rebuilds Conversation as a DDD bounded context.
- The dependency-ordered hard-cut plan is
  `docs/architecture/engineering/api-governance/execution-plans/20260906-conversation-authority-hard-cut.md`.
  It is `PLAN_APPROVED`; CA-W0 inventory, the fail-closed ownership Gate, and
  CA-W1 canonical proto consolidation are complete. CA-W2 is complete in
  test-only composition; CA-W3 and CA-W4 have source checkpoints only. W5,
  W6A, W8, and W9-D remain blocked behind the atomic hard cut. No route
  alias, redirect, dual write, fallback read, or partial production migration is
  permitted.

## 12. Risks And Escalation

- W-1 is a hard execution prerequisite, not a waivable risk. Failure to obtain
  latest-master ancestry or path isolation keeps all later workstreams blocked.
- Any required version bump stops for explicit Owner approval.
- Any need for permanent dual paths, a second event stream, a second command
  persistence owner, or URL-keyed security state returns to DESIGN.
- Any undefined product outcome discovered during implementation returns to
  PRODUCT.
- Native evidence infrastructure failure remains `UNPROVEN`; it is not waived
  as flaky without root-cause evidence.

## 13. Final Readiness Gate

`USER_TRIAL_READY` requires:

1. `MS-C01..MS-C10` and degraded `MS-C14` pass all mapped acceptance rows.
2. `MS-C11..MS-C13` remain absent/disabled and are not advertised as ready.
3. `MS-AG01..MS-AG11` have current, indexed evidence.
4. Every atomic deletion scan returns zero live legacy references.
5. iOS and Android native cells pass without mock business APIs.
6. `pt-acceptance-gap-detector`, `pt-quality-check`, and
   `pt-completion-auditor` pass.

Until then, Mobile Shell production readiness is `UNPROVEN`.
