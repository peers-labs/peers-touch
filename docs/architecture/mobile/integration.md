# Mobile Shell — 集成与 Gap 分析

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-27 | **Updated**: 2026-08-27
> **Owner**: Mobile Architecture Team
> **Module**: `apps/mobile/`

---

## 1. Current-State Gap Matrix

| Area | Current implementation | Prototype target | Disposition |
|---|---|---|---|
| Station selection | Real registry, add/remove/select, Rust probe, auto-check | Same flow | retain; move lifecycle ownership out of `App.tsx` |
| Station handshake | Current probe proves URL reachability/label only | Stable identity and capability binding | add MS-P07 signed `station_peer_id` handshake; URL remains a connection hint |
| Access gates | Real Station-driven login/invite/blocked flow and secure session port | Email plus OAuth tabs | retain gates; add OAuth session runtime |
| Identity | `authSession.ts` accepts `id`, `actorId`, and `actor_id`, including numeric values | PTID-only across every Mobile boundary | remove numeric/alias identity after `ActorRef.ptid` compatibility ingress |
| OAuth | Native deep-link event exists; `oauth.proto` has bridge records but no attempt/state/PKCE contract | GitHub/Google redirect/callback | new Model/Station/session/native closure |
| Shell tabs | Chat/Moments/Contacts/Settings active-only switch | Chats/Moments/Contacts/Me plus details | refactor to navigation descriptors; rename product surface to Me |
| Friend chat | Real list/thread, E2EE, receipts, typing, attachments, search, edit/recall/delete/settings | Rich thread | retain and split oversized page into boundaries |
| Group chat | Real group projection, E2EE, membership/admin/settings | Rich group thread | retain; integrate descriptor navigation |
| Reactions/pins/forward/thread | Proto partly exists; production UI/API coverage is incomplete | Fully interactive | complete authoritative command/readback; no local-only imitation |
| Contacts | Real requests, search, federated resolve, profiles, groups, block | Grouped contacts/details | retain; improve information architecture |
| Moments | Real encrypted image upload and publish only | Feed, reactions, comments, replies | new moments runtime, store, read and interaction surfaces |
| Me/Profile | Minimal session/station/blocked-user settings | Profile stats and grouped settings | substantial new profile/settings projection work |
| Notifications | Real runtime/store and notification center | Badge behavior | retain; make descriptor/runtime ownership explicit |
| Runtime registry | Static status catalog | Lifecycle-aware shell | replace with executable descriptors |
| Auth/session runtime | Credential acquisition and active session lifecycle are mixed into component/auth helpers | Pre-session auth plus post-grant session ownership | add station-scoped `authRuntime`; keep `sessionRuntime` session-scoped |
| Unknown writes | Per-domain idempotency exists unevenly; no uniform persistent result convergence | Restart-safe exact-scope resolution | add durable command ledger and Station result/readback adapters |
| Teardown | Social/group controllers stop local producers, but no generation fence or aggregate cleanup result | Externally atomic Station/actor transition | kernel-owned fenced teardown with secure-storage failure blocking |
| Native capabilities | Secure storage and event bridge foundations | OAuth/push/deep-link/resume | complete iOS and Android plugin evidence |
| i18n/UI identity | Production mostly uses locale keys; prototype is reference | Full localized UI | retain contracts; never copy prototype literals |

## 2. Architectural Refactors

- `App.tsx`: from transition owner to lifecycle projection renderer.
- `MobileShell.tsx`: from switch statement and broad store aggregation to
  descriptor-driven navigation with badge selectors.
- `runtimeRegistry.ts`: from documentation array to executable lifecycle registry.
- Auth/session helpers: split credential acquisition into `authRuntime`; activate
  `sessionRuntime` only after the access chain returns a PTID-bearing session.
- Add `commandRuntime` over one Rust-owned encrypted command ledger; domain
  runtimes retain mutation semantics and authoritative readback.
- `authSession.ts`: from permissive numeric/alias actor normalization to a
  PTID-bearing generated session projection.
- `socialApi.ts`: quarantine JSON decoding inside gateways during per-domain
  generated-Proto cutover; remove the adapter after parity evidence.
- `ChatPage.tsx`: split list, thread, composer, conversation sheet, message action,
  and group administration boundaries without moving freshness into components.
- `MomentsPage.tsx`: separate composer from Station-backed feed/detail projection.
- `SettingsPage.tsx`: become Me shell with lazy detail surfaces and split account
  versus device preference ownership.

## 3. Cross-Layer Work

Station cooperation required:

- Signed Station identity/capability handshake with stable `station_peer_id`.
- Identity/Model amendment that removes numeric actor IDs from Mobile-facing
  auth/session wire contracts and guarantees non-empty PTID.
- OAuth attempt start/status/callback exchange with Station binding, PKCE,
  nonce, expiry, and replay protection.
- Moments list/detail/reaction/comment/reply endpoints and events.
- Any missing reaction/pin/forward/thread readback.
- Profile and account preference mutations.
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
- Provider browser launch and deep-link callback.
- Push, resume, network, media and permission event ports.
- Typed capability errors and native acceptance hooks.
- Generation propagation and stale native-event rejection.
- Encrypted transactional command-ledger persistence and crash recovery.
- Encrypted Station/PTID-scoped draft persistence and atomic recovery.

## 4. Retain And Delete

Retain:

- Existing generated proto path, social/group stores and runtimes.
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

Deletion is part of the same domain cutover that proves parity. A second
permanent source of truth or indefinite compatibility shim is not an accepted
target state.

## 5. Cross-Architecture Alignment

| Mobile concept | Governing source | Mobile-only refinement |
|---|---|---|
| PTID actor boundary | `architecture/identity/unified-actor-system.md` + identity invariant | Mobile session/cache/route enforcement |
| Signed Station identity | `architecture/service-coordination.md` | First-add pin and replacement UX |
| Access/OAuth chain | `architecture/access-gates/station-access-gate-architecture.md` | Native browser/deep-link adapter and secure attempt material |
| Runtime graph | `architecture/frontend-runtime/` | hard `dependsOn`, degradable `uses`, suspend/resume |
| Work admission | Frontend Runtime `InteractionAdmission` | `commandRuntime` and Rust encrypted ledger |
| Social/group projection | `architecture/social-runtime/` | `groupRuntime` as subordinate descriptor under shared event ingress |
| Offline/reconcile semantics | `client/mobile/sync-protocol.md` | Mobile lifecycle and native wakeup |
| Surface lifetime | UI Identity component-tree registry | active-only tabs and descriptor detail routes |

No row above may gain a second semantic or persistence owner in Mobile.

## 6. Risks

- Current social API still contains JSON compatibility envelopes alongside proto.
- `ChatPage.tsx` is a high-coupling surface and must be decomposed by responsibility.
- Background/resume and secure-storage behavior is not yet proven on both platforms.
- Prototype includes capabilities beyond current authoritative Station wiring.
- Existing dirty prototype changes must remain isolated from architecture edits.
- Current `auth.proto` and `oauth.proto` still expose legacy numeric actor fields;
  Mobile must fail closed when canonical PTID is absent.
- The current Mobile package has static/build checks but no registered native
  Mobile Shell Acceptance plan; runtime claims remain `UNPROVEN` until PLAN
  creates and runs that artifact.
