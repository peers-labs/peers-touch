# Mobile Shell — 集成与 Gap 分析

> **Status**: active; owner-contract closure amendment accepted
> **Version**: v1.3
> **Created**: 2026-08-27 | **Updated**: 2026-10-07
> **Owner**: Mobile Architecture Team
> **Module**: `apps/mobile/`

---

## 1. Current-State Gap Matrix

| Area | Current implementation | Prototype target | Disposition |
|---|---|---|---|
| Station selection | Real registry, add/remove/select, Rust probe, auto-check | Same flow | retain; move lifecycle ownership out of `App.tsx` |
| Station handshake | MS-P07 signed host-key handshake and Mobile Rust verification are implemented | Stable identity and capability binding | retain; required simulator mismatch evidence remains pending |
| Access gates | Real Station-driven login/invite/blocked flow plus Rust-owned OAuth/session transport; generic schema submission is absent | Email plus OAuth tabs | retain existing flows; add schema-bound generic submission before enabling terms/device/custom gates |
| Identity | Mobile-facing auth/OAuth contracts use PTID-bearing `ActorRef`; legacy bridge fields are reserved | PTID-only across every Mobile boundary | retain hard cut and reject missing PTID |
| OAuth | MS-P02/MS-P03, MS-D12 and MS-D13 are implemented; deterministic simulator proof is pending and physical provider proof is optional | GitHub/Google redirect/callback | run the simulator Gate; retain `native-oauth-proof/` only for optional diagnostics |
| Shell tabs | Descriptor-owned Chat/Moments/Contacts/Me active-only switch, all planned detail routes, and selected-only Contacts overlays | Chats/Moments/Contacts/Me plus details | retain; collect visible native focus/no-leak evidence |
| Friend chat | Real list/thread, E2EE, receipts, typing, attachments, search, edit/recall/delete/settings | Rich thread | retain and split oversized page into boundaries |
| Group chat | Canonical Conversation projection, E2EE, membership/admin/settings, AO-D10 member authority, and Messaging-owned pending/failure convergence | Rich group thread | retain; complete simulator runtime proof |
| Reactions/pins/forward/thread | Retract/reaction/pin/thread foundations exist; user forward and actor-hide/moderation semantics are incomplete | Fully interactive | keep unsupported actions unavailable until distinct Conversation contracts and readback exist |
| Contacts | Real requests, search, federated resolve, profiles, and canonical Social block/list/status callers | Grouped contacts/details | retain Social authority; complete same/cross-Station runtime proof |
| Moments | Runtime-backed feed, publish, reactions, comments, replies, typed feed/detail outcomes, Rust-owned native media staging, and descriptor detail route | Feed, reactions, comments, replies | retain Social/Secure Content authority; complete simulator picker and multi-actor proof |
| Me/Profile | Actor-profile privacy, Notification preferences, device settings, Station, language, and canonical Social blocked-user surfaces | Profile stats and grouped settings | preserve split ownership; remove the placeholder account-preference section and hard-cut shared Profile/Notification CAS |
| Notifications | Real runtime/store and notification center | Badge behavior | retain; make descriptor/runtime ownership explicit |
| Shared Social ingress | One session-scoped supervisor routes Social, Moments, notification, and profile invalidation; Chat frames become Messaging wake intents | One runtime-owned freshness path per domain | retain; execute authorized two-Station simulator convergence Gates |
| Runtime registry | Executable descriptors with topological bootstrap and reverse suspend/teardown | Lifecycle-aware shell | retain; complete remaining environment evidence |
| Auth/session runtime | Station-scoped credential acquisition and admitted session lifecycle have separate owners | Pre-session auth plus post-grant session ownership | retain; complete required simulator access proof |
| Unknown writes | Per-domain idempotency exists unevenly; no uniform persistent result convergence | Restart-safe exact-scope resolution | add durable command ledger and Station result/readback adapters |
| Teardown | Kernel generation fencing and Messaging/Social reverse teardown are implemented; reset-authorized simulator proof remains incomplete | Externally atomic Station/actor transition | retain owners; complete required simulator evidence |
| Native capabilities | Secure storage, permission, lifecycle, network, PTID/device-bound push registration, scheduled completion, and Rust-owned picker staging are source-complete | OAuth/push/deep-link/resume/media | retain generation-fenced native contracts; independent iOS/Android runtime proof remains |
| Authenticated business transport | Messaging Rust transport exists; ordinary Web gateways attach bearer tokens | No user-visible difference | move all authenticated operations behind a typed Rust allowlist and remove Web credential access |
| i18n/UI identity | Production mostly uses locale keys; prototype is reference | Full localized UI | retain contracts; never copy prototype literals |

## 2. Architectural Refactors

- `App.tsx`: from transition owner to lifecycle projection renderer.
- `MobileShell.tsx`: descriptor-driven primary/detail/overlay navigation with
  badge selectors; broad badge aggregation remains a follow-up selector audit.
- `runtimeRegistry.ts`: executable lifecycle registry; the Social descriptor
  owns the shared ingress, Messaging owns Direct/Group freshness, and Chat
  Storage is subordinate to Messaging.
- Auth/session helpers: split credential acquisition into `authRuntime`; activate
  `sessionRuntime` only after the access chain returns a PTID-bearing session.
- Add `commandRuntime` over one Rust-owned encrypted command ledger; domain
  runtimes retain mutation semantics and authoritative readback.
- `authSession.ts`: PTID-bearing generated session projection is landed; retain
  the hard cut and zero-reference checks.
- `socialApi.ts`: quarantine JSON decoding inside gateways during per-domain
  generated-Proto cutover; remove the adapter after parity evidence.
- `ChatPage.tsx`: split list, thread, composer, conversation sheet, message action,
  and group administration boundaries without moving freshness into components.
- `MomentsPage.tsx`: composer and Station-backed feed/detail projection are
  separated; native receiver proof remains.
- `SettingsPage.tsx`: Me shell uses selected-only detail surfaces and saves
  only the selected Profile, Notification, Social, or device owner.
- `socialProjectionRuntime.ts`: session-scoped composition owner for Social,
  Moments, notification, and profile freshness. It maps Chat events to
  Messaging wake intents and never refreshes Conversation state itself.

## 3. Cross-Layer Work

Station cooperation already landed:

- signed Station identity/capability handshake with stable `station_peer_id`;
- PTID-only Mobile-facing auth/session contracts;
- OAuth start/status/complete/cancel/acknowledge, binding, PKCE, nonce, expiry,
  replay protection and transactional session finalization.

Station cooperation still required:

- W2-E2 Station-internal negative Fixture adapter and authoritative proof
  snapshot from `native-oauth-proof/`;
- Generic schema-bound Access Gate action submission and final decision
  readback.
- Social block/unblock/list/status source is implemented; same-Station
  simulator runtime convergence remains in `W5-PROOF`, while cross-Station
  convergence is deferred beyond the current Mobile Plan.
- Conversation actor-hide, moderation-remove, user-forward contracts, and
  authoritative readback. Existing retract/member-authority contracts are
  reused.
- Moments filtered-empty/detail policy outcomes. Existing publish,
  reaction/comment/reply contracts remain owner inputs.
- Generated Profile CAS and atomic Notification preference batch mutations,
  including canonical conflict snapshots and Desktop/Mobile cutover.
- Command result/readback, idempotency, and typed errors for retryable writes.
- Generated durable-command envelope for the Web/Rust persistence boundary.

Pure client work:

- Lifecycle and navigation kernels.
- Page descriptors, overlay host, safe-area/keyboard model.
- Projection selectors, virtualization, route/focus/scroll restoration.
- Device-local settings and local-only message flags.
- `commandRuntime` admission, ordering, fairness, and exact Station/PTID scoping.
- Chat/Moments draft editing state and typed persistence intents.

Native/Rust work:

- Secure session and OAuth state/PKCE material.
- Provider browser launch and deep-link callback. Mobile Rust validates and
  completes the callback; raw callback data and secrets never cross into Web.
- Device/generation-bound attempt recovery and encrypted credential-envelope
  delivery/acknowledgement.
- Authenticated Station transport for every generated Mobile business
  operation; Web never receives bearer or refresh credentials.
- Push-token registration, receipt/tap, scheduled wakeup, resume, network,
  media-picker staging and permission event ports.
- Typed capability errors and native acceptance hooks.
- Generation propagation and stale native-event rejection.
- Encrypted transactional command-ledger persistence and crash recovery.
- Encrypted Station/PTID-scoped draft persistence and atomic recovery.

## 4. Retain And Delete

Retain:

- Canonical Conversation Proto, the Messaging runtime, the Social projection
  facade, and Messaging-owned group command outcome state.
- Station registry semantics, access gate renderer, encrypted media/E2EE paths.
- Active-only primary tab policy until evidence changes it.

Delete after cutover:

- Component-owned top-level lifecycle transitions.
- Static-only runtime descriptor status catalog.
- Mixed pre-session authentication and post-session lifecycle ownership.
- Route identity encoded solely by `activeSessionUlid`/`activeGroupUlid`.
- Any production domain type that duplicates a generated proto-owned concept.
- Numeric or aliased actor identity in Mobile service/store/route contracts.
- Per-domain JSON compatibility adapters after Proto parity is proven.
- Direct authenticated Web `fetch`, `MobileAuthSession.accessToken`, and
  caller-selected credential-bearing URLs.
- Any retired feature-specific Chat business caller.
- Any alias, fallback, or dual-write path that preserves those retired owners.

Deletion is part of the same domain cutover that proves parity. A second
permanent source of truth or indefinite compatibility shim is not an accepted
target state.

## 5. Cross-Architecture Alignment

| Mobile concept | Governing source | Mobile-only refinement |
|---|---|---|
| PTID actor boundary | `architecture/domains/identity/unified-actor-system.md` + identity invariant | Mobile session/cache/route enforcement |
| Signed Station identity | `architecture/platform/runtime/service-coordination.md` | First-add pin and replacement UX |
| Access/OAuth chain | `architecture/platform/station/access/station-access-gate-architecture.md` | Native browser/deep-link adapter and secure attempt material |
| Runtime graph | `architecture/platform/client/frontend-runtime/` | hard `dependsOn`, degradable `uses`, suspend/resume |
| Work admission | Frontend Runtime `InteractionAdmission` | `commandRuntime` and Rust encrypted ledger |
| Social and Chat projection | `architecture/domains/social/runtime/` + Conversation lifecycle | Social owns relationship/presence/profile/notification invalidation; Messaging owns Direct/Group conversation, messages, settings, E2EE, and command outcomes |
| Offline/reconcile semantics | `client/mobile/sync-protocol.md` | Mobile lifecycle and native wakeup |
| Surface lifetime | UI Identity component-tree registry | active-only tabs and descriptor detail routes |
| Member authority | AO-D10 Conversation member authority | Mobile Group action availability and readback |
| Relationship/block | Social relationship authority | blocked-list and contact action projection |
| Message actions | Conversation + Device Messaging Engine | Mobile labels, confirmation, and local presentation |
| Moments policy/media | Social + Secure Content | filtered-state rendering and native staging handles |
| Push delivery | Notification architecture | native token bridge, stale mark, and post-tap reconcile |

No row above may gain a second semantic or persistence owner in Mobile.

## 6. W2 Cutover

> **Status**: accepted on 2026-08-28.

Retain:

- Station-owned provider exchange and Access Gate policy.
- Mobile Rust secure storage.
- Web `authRuntime` as a projection and intent surface.

Replace:

- Web-driven OAuth completion with one Rust-owned coordinator.
- repeated activated-session token minting with one candidate-keyed encrypted
  credential envelope and acknowledgement.
- split Access Gate/session writes with one Station authorization finalizer.
- caller-supplied actor identity on the Station authorization surface with
  authenticated-subject plus explicit-consent derivation.
- ad hoc iOS browser glue and Android unsupported fallback with official Tauri
  opener/deep-link adapters.

Delete in the same cutover:

- Web-visible PKCE verifier, nonce, authorization code, raw callback, bearer
  token, and refresh token fields;
- status paths that mint a fresh credential;
- any OAuth fallback to `auth.login` when `auth.oauth` is absent;
- module-global-only attempt recovery;
- Android unsupported browser and secure-storage branches.

The simulator Acceptance environment adds Appium, XCUITest, UiAutomator2,
acceptance-build injection, isolated iOS/Android client roles, and deterministic
cleanup. It is the required MS-AG03 proof surface under MS-D26.

Optional W2-E2 physical-diagnostic ownership and evidence are retained in
[`native-oauth-proof/`](./native-oauth-proof/README.md). MOP-D01..MOP-D04 were
accepted on 2026-08-29; the historical focused execution plan no longer owns
required completion.

## 7. W4 Reliability V2 Cutover

> **Status**: accepted and source-complete under MS-D15 on 2026-09-11. The
> Station Social command-result lookup and Mobile schema, resolver, lifecycle,
> migration, and recovery Harness are implemented. Required simulator proof
> remains `UNPROVEN`; physical native proof is optional diagnostics.

| Current boundary | Accepted target | Owner / hard dependency |
|---|---|---|
| Web supplies `command_type + payload_json` | generated v2 oneof; Rust persists exact deterministic bytes | Model + Mobile Rust |
| Generic ledger allocates an ID before the signing owner allocates another | Device Messaging Engine identity returns immutable Friend Request bytes/ID/hash; domain command ID is the only ledger, transport, result, and projection identity | Mobile Rust admission + existing signing owner |
| Friend Request result lookup is generated and Station-owned | Mobile resolver consumes matching command ID, payload hash, Station-owned state, and terminal result | Mobile Rust admission |
| Block and Moment requests have no stable command/result contract | online-only or draft-only until an accepted resolver contract exists | owning Model/Station domain |
| Moment UI swallows best-effort ledger failure and still dispatches | no best-effort durability claim; admitted writes fail closed | Mobile domain runtime |
| Store keys derive from caller/session material crossing Web/Rust | versioned device-only install KEK wraps random Station/PTID scope DEKs; HKDF separates command/draft keys | Mobile Rust secure storage |
| V1 rows have no Station/PTID provenance | crash-recoverable manifest quarantines main/WAL/SHM files; no inference, replay, restore, or v2 capacity accounting | Mobile Rust migration owner |
| Committed rows remain until a generic purge call | authoritative outcome plus local projection checkpoint atomically removes the row | domain resolver + projection owner |

Retain:

- MS-D08's single Rust-owned ledger, Station truth, and readback-before-replay
  rule.
- The accepted per-scope capacity, payload, ordering-key, and four-key fairness
  bounds.
- The independent Chat/Moments draft store and explicit recovery UI.
- Device Messaging Engine as the only durable owner for Chat and Group.

Replace:

- TypeScript `CommandEnvelope`, `payloadJson`, caller-supplied encryption
  secret, and manual mark-committed/failed APIs with generated typed intents
  and resolver-owned state transitions.
- The session-secret key derivation with native install/scope key ownership.
- Global v1 files with exact Station/PTID v2 partitions.
- Local-status "readback" with domain-authoritative result/readback.
- Automatic draft cleanup with the accepted explicit retain/discard decision;
  unresolved commands always stay exact-scope quarantined, and lifecycle
  remains outside the next Shell until the independent draft choice commits.

Delete from the production target:

- every best-effort `InteractionAdmission` call that can be ignored while the
  write continues;
- every ledger command whose persisted ID or bytes differ from the dispatched
  generated command;
- Chat/Group categories or payloads in the generic ledger;
- any attempt to expose quarantined v1 content under the current session;
- browser events that claim retain/discard without invoking the Rust owner.

The Friend Request oneof member is active only through the unified Mobile
preparation, persistence, dispatch, readback, and projection-checkpoint path
using the same signed command. Adding another generated Mobile member without
its owner-provided result contract and exhaustive resolver remains forbidden.

The W4 owner may consume a typed signing port from the Device Messaging Engine
identity owner. It must not import, copy, rotate, or persist actor-device
private keys or enrollment state.

## 8. Risks

- Current social API still contains JSON compatibility envelopes alongside proto.
- `ChatPage.tsx` is a high-coupling surface and must be decomposed by responsibility.
- Background/resume and secure-storage behavior is not yet proven on both platforms.
- Prototype includes capabilities beyond current authoritative Station wiring.
- Existing dirty prototype changes must remain isolated from architecture edits.
- Legacy OAuth bridge message names remain, but numeric actor fields are
  reserved and Mobile hard-cut scans must prevent their reintroduction.
- The Mobile Shell Acceptance plan and simulator Gates are registered. W2-E2
  physical OAuth claims remain optional diagnostics under MS-D26.
- MS-D15 source is complete and the Station Social authenticated command-ID/hash
  result lookup is integrated with Mobile v2 schema, keys, migration, resolver,
  lifecycle, and recovery Harness. Required simulator restart proof remains
  `UNPROVEN`; Moment, block, and settings writes remain outside the admitted v2
  membership.
- Retained legacy v1 data cannot be safely attributed to an actor. Any attempt
  to preserve availability by guessing scope would violate the identity and
  single-owner contracts.

## 9. Accepted Owner-Contract Cutover Matrix

> **Status**: accepted on 2026-09-18. This is an architecture dependency
> matrix, not an execution order.

| Boundary | Retain | Required replacement | Delete at the same cutover | Completion evidence |
|---|---|---|---|---|
| Access Gate | Station decision chain, typed built-ins, Rust OAuth coordinator | schema-bound generic action envelope and Station validation/finalization | client-selected submit routes and unknown-gate fallback | descriptor/submission hash match, stale-schema rejection, final decision readback |
| Group member authority | AO-D10 commands, Conversation event/snapshot | Mobile Group consumer and generated error mapping | retired member-update and ownership-transfer callers | exact command replay, stale epoch recovery, owner uniqueness, Mobile projection |
| Social block | Canonical generated block/unblock/list/status, result lookup, durable Mobile resolver, ordered event, and Federation deny projection | retain the same owner contract | retired Chat-owned Social callers and any compatibility alias are absent | source complete; same-Station runtime proof remains in the current Plan, while cross-Station/Relay proof is deferred and unproven |
| Chat actions | Conversation command resolver, Engine encryption/object plane | actor-hide, moderation remove, and user-forward intents | legacy delete/forward semantics and optimistic shared completion | exact command/event readback, restart, recipient visibility, role denial |
| Moments | Social audience/block policy, Secure Content encryption/grants | page/detail policy outcomes and Rust media staging | client-derived visibility and Web/native path transfer | filtered-empty versus empty, hidden/deleted, cancel/restart/limited-photo |
| Settings | Station policy as read-only, device-local Station registry, Actor Profile privacy, Notification preferences, Social blocked users, device settings | dedicated Profile revision; aggregate atomic Notification revision; selected-owner save | generic account owner/placeholder, unrevisioned Profile mutation, single-category Notification mutation, false empty blocked-list projection | typed applied/unchanged/conflict snapshots, lost-response reconcile, restart, second-device behavior |
| Business transport | Rust secure session store and generated gateways | typed Rust operation allowlist with origin/generation fencing | Web bearer/cookie attachment and arbitrary proxy paths | token non-observability, redirect/mismatch rejection, refresh fencing |
| Push/background | Notification PTID/device registration truth and Rust lifecycle generation | typed APNs/FCM/UnifiedPush binding, authenticated device equality, encrypted credential storage, idempotent register/unregister/readback, generation/sequence-fenced receipt/tap reconcile, one OS work identifier, exactly-once completion | `actor_id`, Web-visible provider credentials, preview/private payload content, native direct Station calls, or business mutation/navigation before reconcile | Model/Station/Rust/native source checks plus independent physical receipt/tap/expiration proof |

## 10. Semantic Reference Audit

The final hard-cut audit uses semantic classification rather than a blind
literal search:

1. Enumerate every production call, route constant, generated binding, test,
   fixture, comment, and document that refers to Friend Chat, Group Chat, or
   equivalent legacy semantics.
2. Classify each reference as executable production, generated compatibility
   commentary, test/fixture input, or historical documentation.
3. Require zero executable production references for the six protected
   operations and zero alias/fallback/dual-write equivalents.
4. Keep non-executable references only when they state the canonical owner or
   historical purpose.
5. Re-run the inventory after generation/build steps so generated output cannot
   reintroduce a retired path.

The hard-cut result is invalid if user-visible behavior was deleted before its
owner contract, if a compatibility adapter still routes to a retired owner, or
if a local projection is presented as authoritative replacement truth.

## 11. Architecture Review Boundary

This v1.1 amendment is review-complete as one package covering
`MS-D16..MS-D24`; its approval authorizes subsequent execution-plan recovery,
not source implementation. `MS-D25` was accepted separately to record the
completed W6B owner-composed source closure without promoting optional physical
diagnostics into required proof.
The Plan Package must then migrate to schema v2,
preserve `mobile-shell-20260827` identity and migration lineage, establish one
immutable workspace binding, and register matching active work and Development
Session before any EXECUTE action.
