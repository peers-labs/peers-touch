# Mobile Shell — 目标模块布局

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-27 | **Updated**: 2026-08-27
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
│   ├── groupRuntime.ts
│   ├── momentsRuntime.ts
│   ├── notificationRuntime.ts
│   ├── profileRuntime.ts
│   ├── settingsRuntime.ts
│   └── deviceSettingsRuntime.ts
├── services/
│   ├── api/              # generated-Proto gateways; temporary JSON ingress is quarantined here
│   └── platform/         # typed Web-to-Rust capability ports
└── storage/
    └── projections/      # Station/PTID-scoped cache adapters

apps/mobile/src-tauri/src/
├── commands/             # stable Tauri capability commands
├── domain/               # device-local domain semantics
├── platform/             # iOS/Android capability adapters
└── runtime/
    ├── lifecycle/        # foreground/background and generation bridge
    ├── oauth/            # secure attempt material and callback validation
    ├── command_ledger/   # encrypted transactional command source of truth
    └── draft_store/      # encrypted device-local Chat/Moments drafts
```

## Responsibilities

| Path | Must own | Must not own |
|---|---|---|
| `app/lifecycle/` | top-level transitions and teardown order | business projection fields |
| `app/navigation/` | route, stack, overlay, lifetime | Station truth |
| `features/*` | rendering and user intents | streams and periodic freshness |
| `runtimes/registry.ts` | descriptor registration, dependency validation, readiness and teardown orchestration | domain commands or projection merge rules |
| `runtimes/stationRuntime.ts` | Station registry and handshake projection | session credentials |
| `runtimes/authRuntime.ts` | pre-session email/OAuth attempts and typed credential results | active session lifecycle or access policy |
| `runtimes/accessRuntime.ts` | Station gate attempt and access decision projection | gate policy or order |
| `runtimes/sessionRuntime.ts` | active PTID session, refresh and revocation | credential collection or social projections |
| `runtimes/commandRuntime.ts` | bounded admission, scheduling, and outcome convergence | domain mutation semantics or persistent storage implementation |
| `runtimes/socialRuntime.ts` | friend conversations, contacts, realtime cursor | group E2EE or Moments |
| `runtimes/groupRuntime.ts` | group projection, membership, E2EE readiness | friend/session truth |
| `runtimes/momentsRuntime.ts` | feed, post, comment, reaction projection | profile/account preferences |
| `runtimes/notificationRuntime.ts` | notifications and badge projection | OS push delivery |
| `runtimes/profileRuntime.ts` | current and remote Actor profiles | settings or session |
| `runtimes/settingsRuntime.ts` | Station account preference projection | device preferences or secure session token |
| `runtimes/deviceSettingsRuntime.ts` | device preference projection | Station account preferences |
| `services/api/` | generated-Proto transport and quarantined migration adapters | public manual domain DTOs |
| `services/platform/` | typed native capability ports | Android/iOS SDK calls |
| `storage/projections/` | Station/PTID-scoped cache and invalidation | business authority |
| `src-tauri/platform/` | OS capabilities | shared business protocol |
| `src-tauri/runtime/oauth/` | secure PKCE/nonce material and callback validation | provider UI or Station policy |
| `src-tauri/runtime/command_ledger/` | encrypted transactional command persistence | Station truth or domain readback rules |
| `src-tauri/runtime/draft_store/` | Station/PTID-scoped draft persistence | command replay or shared business truth |

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
| `groupRuntime` | session / degradable | `sessionRuntime` | `socialRuntime`, `commandRuntime` | network |
| `momentsRuntime` | session / degradable | `sessionRuntime` | `socialRuntime`, `commandRuntime` | network |
| `notificationRuntime` | session / degradable | `sessionRuntime` | `socialRuntime` | network |
| `profileRuntime` | session / degradable | `sessionRuntime` | `socialRuntime`, `commandRuntime` | network |
| `settingsRuntime` | session / degradable | `sessionRuntime` | `commandRuntime` | network |

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
