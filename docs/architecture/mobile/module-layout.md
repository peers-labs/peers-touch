# Mobile Shell — 目标模块布局

> **Status**: active; owner-contract closure amendment accepted
> **Version**: v1.2
> **Created**: 2026-08-27 | **Updated**: 2026-09-19
> **Owner**: Mobile Architecture Team

---

## Target Tree

```text
apps/mobile/src/
├── app/
│   ├── lifecycle/        # top-level reducer, kernel, readiness projection
│   ├── navigation/       # page descriptors, stack, overlay host
│   └── providers/
├── features/
│   ├── station/          # registry and handshake projection
│   ├── auth/             # access and OAuth projection
│   ├── chat/             # friend/group presentation boundaries
│   ├── contacts/         # relationship and group presentation
│   ├── moments/          # feed/detail/composer presentation
│   └── profile/          # Me and settings presentation
├── runtimes/
│   ├── registry.ts       # executable runtime descriptors
│   ├── stationRuntime.ts
│   ├── authRuntime.ts
│   ├── accessRuntime.ts
│   ├── sessionRuntime.ts
│   ├── commandRuntime.ts
│   ├── socialRuntime.ts
│   ├── messagingRuntime.ts
│   ├── momentsRuntime.ts
│   ├── notificationRuntime.ts
│   ├── profileRuntime.ts
│   └── deviceSettingsRuntime.ts
├── services/
│   ├── api/              # generated domain gateways; no credential ownership
│   ├── transport/        # typed operation clients over the Rust Station transport
│   └── platform/         # typed Web-to-Rust OS capability ports
└── storage/
    └── projections/      # Station/PTID-scoped cache adapters

apps/mobile/src-tauri/src/
├── commands/             # stable Tauri capability commands
├── domain/               # device-local domain semantics
├── platform/             # iOS/Android capability adapters
└── runtime/
    ├── lifecycle/        # foreground/background and generation bridge
    ├── oauth/            # secure attempt material and callback validation
    ├── station_transport/# credential-attaching generated operation transport
    ├── push/             # native token binding and Notification registration
    ├── scheduled_wakeup/ # WorkManager/BGTask wakeup and completion fencing
    ├── media_staging/    # opaque picker handles and encrypted draft staging
    ├── command_ledger/   # encrypted transactional command source of truth
    └── draft_store/      # encrypted device-local Chat/Moments drafts

apps/mobile/src-tauri/plugins/
├── push/                 # APNs/FCM/UnifiedPush registration, receipt, tap
├── background-wakeup/    # WorkManager/BGTaskScheduler callbacks only
├── media-picker/         # PhotosUI/Photo Picker and camera selection
├── platform-permissions/ # permission status/request
└── secure-storage/       # Keychain/Keystore
```

## Responsibilities

| Path | Must own | Must not own |
|---|---|---|
| `app/lifecycle/` | top-level transitions and teardown order | business projection fields |
| `app/navigation/` | route, stack, overlay, lifetime | Station truth |
| `features/*` | rendering and user intents | streams and periodic freshness |
| `runtimes/registry.ts` | descriptor registration, dependency validation, readiness and teardown orchestration | domain commands or projection merge rules |
| `runtimes/stationRuntime.ts` | Station registry and handshake projection | session credentials |
| `runtimes/authRuntime.ts` | pre-session email/OAuth projection and typed user intents | OAuth secrets, provider callback exchange, active session lifecycle, or access policy |
| `runtimes/accessRuntime.ts` | Station gate descriptor, schema-bound user submission, and access decision projection | gate policy, action execution, or finalization |
| `runtimes/sessionRuntime.ts` | active PTID session, refresh and revocation | credential collection or social projections |
| `runtimes/commandRuntime.ts` | bounded admission, scheduling, and outcome convergence | domain mutation semantics or persistent storage implementation |
| `runtimes/socialRuntime.ts` | relationship, outgoing block-list, contacts, and shared realtime cursor projection | Conversation membership, group E2EE, or Moments policy |
| `runtimes/messagingRuntime.ts` | Conversation projection, member-authority intents, and E2EE readiness | Social relationship truth or page-owned freshness |
| `runtimes/momentsRuntime.ts` | Social-owned feed/detail policy projection plus post/comment/reaction intents | privacy derivation, object encryption, or settings |
| `runtimes/notificationRuntime.ts` | Notification entities, preferences, push-registration projection, and badge state | OS push token acquisition or domain business truth |
| `runtimes/profileRuntime.ts` | current and remote Actor profiles plus current-actor Profile CAS | Notification, Social, device settings, or session |
| `runtimes/deviceSettingsRuntime.ts` | device preference projection | Station-owned Profile, Notification, or Social state |
| `services/api/` | generated request/response mapping and quarantined wire adapters | credentials, arbitrary URLs, or public manual domain DTOs |
| `services/transport/` | generated operation IDs and typed calls into Rust Station transport | bearer tokens, redirects, or domain projection merge |
| `services/platform/` | typed native capability intents and result projections | Android/iOS SDK calls or filesystem paths |
| `storage/projections/` | Station/PTID-scoped cache and invalidation | business authority |
| `src-tauri/platform/` | OS capabilities | shared business protocol |
| `src-tauri/runtime/oauth/` | secure PKCE/nonce/attempt/delivery-key material, callback validation, Station OAuth transport, restart recovery, and credential acknowledgement | provider UI, Web-visible secrets, or Station policy |
| `src-tauri/runtime/station_transport/` | verified-origin request execution, in-memory credential attachment, generated operation allowlist, timeout/cancel, typed public response | arbitrary HTTP proxying, domain policy, or Web-visible credentials |
| `src-tauri/runtime/push/` | provider-token/device/actor/Station binding, Notification registration, rotation and unregister recovery | notification business truth or Web-visible provider token |
| `src-tauri/runtime/scheduled_wakeup/` | versioned OS work registration, generation fence, bounded reconcile request, expiration and exactly-once completion | business command dispatch, cursor advancement, or freshness claims |
| `src-tauri/runtime/media_staging/` | picker request state, app-owned staged bytes, opaque handles, digest, draft binding, and cleanup | Social policy, arbitrary caller paths, or plaintext upload |
| `src-tauri/runtime/command_ledger/` | encrypted transactional command persistence | Station truth or domain readback rules |
| `src-tauri/runtime/draft_store/` | Station/PTID-scoped draft persistence | command replay or shared business truth |
| `plugins/push/` | APNs/FCM/UnifiedPush token and OS receipt/tap callbacks | Station transport or projection mutation |
| `plugins/background-wakeup/` | WorkManager/BGTaskScheduler registration and OS completion callback | reconciliation or business retry |
| `plugins/media-picker/` | PhotosUI/Photo Picker/camera UI and temporary grant callback | durable path ownership or upload |

## Runtime Graph

| Runtime | Scope / entry policy | Hard `dependsOn` | Optional `uses` | Budget |
|---|---|---|---|---|
| `deviceSettingsRuntime` | app / degradable | none | none | local |
| `stationRuntime` | station / pre-shell-gate | none | `deviceSettingsRuntime` | network |
| `authRuntime` | station / pre-shell-gate | `stationRuntime` | none | network |
| `accessRuntime` | station / pre-shell-gate | `stationRuntime`, `authRuntime` | none | network |
| `sessionRuntime` | session / shell-blocking | `stationRuntime`, `authRuntime`, `accessRuntime` | none | network |
| `commandRuntime` | session / degradable | `sessionRuntime` | none | local |
| `socialRuntime` | session / degradable | `sessionRuntime` | `commandRuntime` | network |
| `messagingRuntime` | session / degradable | `sessionRuntime`, `secure-storage`, `native-event-bridge` | `socialRuntime`, `commandRuntime` | network |
| `momentsRuntime` | session / degradable | `sessionRuntime` | `socialRuntime`, `commandRuntime` | network |
| `notificationRuntime` | session / degradable | `sessionRuntime` | `socialRuntime` | network |
| `profileRuntime` | session / degradable | `sessionRuntime` | `socialRuntime`, `commandRuntime` | network |

`native-event-bridge` remains app-installed and generation-fenced. Push,
scheduled-work, deep-link, network, permission, and media-picker callbacks enter
through this bridge, but their Rust owners retain token, handle, completion, and
cleanup state. The bridge emits typed intents only.

## Runtime Component Contract

Every `runtimes/*Runtime.ts` component follows the same boundary:

| Dimension | Contract |
|---|---|
| Inputs | generation-tagged lifecycle context, typed user commands, Station events, and host wakeup intents |
| Outputs | owned projection updates, typed command results, readiness, stale state, and typed failures |
| Dependencies | hard `dependsOn`, degradable `uses`, generated-Proto gateway, owned store, scoped storage, and declared platform ports |
| Lifecycle | registry-driven install, bootstrap, reconcile, suspend/resume, and teardown for its declared scope |
| Concurrency | one bootstrap and one reconcile per runtime/generation; duplicate triggers coalesce; cancellation is propagated |
| Resources | timers, streams, listeners, and abort handles are registered with the descriptor and released at teardown |
| Forbidden | page imports, another runtime's private store, direct native SDK access, unbounded queues, or cross-generation writes |

`MobileLifecycleKernel` consumes descriptor readiness and teardown results but
does not execute domain commands. `MobileNavigationHost` consumes route intents
and page descriptors but does not read business stores. API gateways serialize
and validate transport only; projection merge remains with the owning runtime.

```ts
interface MobilePageDescriptor {
  id: 'chat' | 'moments' | 'contacts' | 'me' | string;
  kind: 'primary' | 'detail' | 'overlay';
  lifetime: 'on-visit-none' | { lru: number };
  runtimes: readonly string[];
}
```

The registry rejects missing hard dependencies and cycles at install. Bootstrap and
resume follow topological order; independent siblings may run concurrently.
Suspend and teardown use reverse order. Budget classes are
bootstrap/suspend/teardown: local `2s/2s/2s`, network `5s/2s/5s`. OAuth user
interaction uses Station attempt expiry instead. A timeout returns typed
readiness/teardown failure and never advances lifecycle implicitly.
An unavailable `uses` capability disables only the dependent command surface;
it does not block that runtime's read projection.
For session domains, `uses: socialRuntime` means consuming the shared typed
event-ingress capability. It does not permit importing `socialRuntime` private
stores or opening another long-lived Station stream.

### Session credential contract

- OAuth-created credentials enter `sessionRuntime` only through the Rust secure
  session store. Mobile Web receives actor/session/expiry projection fields but
  never bearer or refresh credentials.
- One OAuth candidate identifies at most one Station session. Response loss
  resumes the same encrypted credential envelope until secure-store
  acknowledgement; status polling never mints a replacement credential.
- `sessionRuntime` performs single-flight refresh two minutes before expiry or
  after one authenticated `401`; queued writes remain closed during refresh.
- Station alone issues, rotates, and revokes credentials. Refreshed Station
  identity and `ActorRef.ptid` must match the active scope before replacement.
- Retryable transport failure preserves an unexpired credential and schedules
  bounded retry. Expired, invalid, revoked, or identity-mismatched credentials
  trigger generation-fenced teardown and return to the access chain.
- Refresh credentials remain in Rust secure storage. An access token may exist
  only in generation-scoped session memory and outbound auth headers; neither
  credential may enter persisted Web state, logs, command records, events, or
  projection storage.

### Event admission contract

- One shared ingress separates control events from business data. Control
  capacity is 64; data capacity is 1024 envelopes per active session.
- Event ID deduplicates delivery. Per-scope sequence/cursor must advance
  monotonically; a gap or data-queue overflow marks affected projections stale
  and starts authoritative reconcile.
- Control overflow or loss of a revocation/auth event closes write admission and
  forces session revalidation. It never silently degrades to stale business UI.
- Data scheduling is round-robin by owning runtime. Payloads above the
  Station-advertised event limit are rejected and reconciled by object ID.

## Dependency Direction

```text
features ---------> app/navigation
   |
   +--------------> runtimes -> services/api -> generated Model
app/lifecycle ---->    |
                      +-> storage adapters
                      +-> services/platform -> mobile-rust -> native plugin
                                             +-> encrypted command ledger
```

- Features dispatch runtime commands and consume narrow selectors; they do not
  import API gateways or storage.
- Runtimes may update only their owned projection stores and cannot import page
  components or another runtime's private store.
- Runtime-to-runtime coordination uses typed lifecycle intents registered with
  the kernel, not direct controller calls.
- `services/api` may contain a temporary JSON decoder during cutover but cannot
  export manual domain models.
- Native plugins emit typed capability events tagged with lifecycle generation;
  they never import or mutate business projections.
- Authenticated API clients pass generated operation IDs and typed payloads to
  Rust; they never read a bearer credential or construct an arbitrary URL.
- Social block commands terminate in Social; Conversation member/message
  commands terminate in Conversation through Device Messaging Engine.

## Owner-Contract Ports

| Port | Producer | Consumer | Completion truth |
|---|---|---|---|
| Access Gate action | Station gate descriptor | `accessRuntime` | next Station `AccessDecision`; session only after finalizer grant |
| Member authority | Conversation AO-D10 | `messagingRuntime` | command result plus member/owner authority projection |
| Relationship authority | Social | `socialRuntime` | command result plus relationship revision/event |
| Chat message actions | Device Messaging Engine + Conversation | Chat runtime | matching command ID/hash and ordered event/readback |
| Moments policy | Social + Secure Content | `momentsRuntime` | typed feed/detail outcome and committed object descriptor |
| Account/profile settings | Actor Profile / Notification / Social | profile and notification runtimes plus Social runtime | selected-owner revision/readback |
| Device settings | `deviceSettingsRuntime` | Shell/native adapters | committed local readback |
| Native push token | push plugin | Rust push registrar | Notification device registration readback |
| Scheduled wakeup | OS scheduler | Rust lifecycle bridge | exactly-once OS completion after bounded reconcile request |
| Media selection | picker plugin | Rust media staging | one terminal picker result with opaque staged handle |

## Legacy Boundary

The target tree contains no production client for any route or alias listed in
the CCU legacy inventory.

Generated compatibility comments, tests, fixtures, and historical documents may
retain those strings only with explicit classification. They are not imported,
registered, or reachable from a production runtime.

## Native Acceptance Harness

```text
Appium 2
  +-- XCUITest driver ------> iOS app / WKWebView context
  +-- UiAutomator2 driver --> Android app / WebView context
                                |
                                v
             window.__PEERS_MOBILE_ACCEPTANCE__
                                |
                                v
                 production runtime intents
```

| Component | Responsibility | Forbidden |
|---|---|---|
| Mobile native provisioner | Allocate devices, builds, app data, ports, profiles, credentials, and cleanup leases | Fabricate a passed Gate |
| Appium driver adapters | Install/launch/restart/background apps, deliver OS deep links, capture native/WebView evidence | Direct store mutation |
| Acceptance registry | Expose typed production intents and projection readback in acceptance builds only | Business truth or mock result injection |
| Access scenario runner | Execute Station trust, gate, provider, cancellation, mismatch, replay, and cleanup journeys | Browser-only substitution |

The registry is absent unless `VITE_ACCEPTANCE_HARNESS=1`. Under MS-D26,
source-bound iOS Simulator cells are the required Mobile proof surface.
Journeys that require independent sessions or actors use two isolated iOS
Simulator clients. Android and physical-device cells remain optional
diagnostics for live providers, secure hardware, assistive technology, OEM
behavior, and pinned-hardware performance.
