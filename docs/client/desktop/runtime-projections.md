# Desktop Runtime Projections

## 1. Purpose

Desktop UI state is a set of runtime projections over Station truth, local Rust state, and local UI interaction state. A projection is not allowed to stay correct only because a page mounted, a tab was clicked, or a component called a one-off refresh.

This document is the Desktop platform source for how runtime components consume events, refresh derived business state, and reconcile missed updates. It also defines the **kernel contracts** (`Runtime`, `Page`, `Boot`) that all new pages and projection owners must follow.

Cross-end architecture source:

- `docs/architecture/platform/client/frontend-runtime/README.md` defines the cross-client frontend runtime model: scheduling lanes, page/section/applet lifecycle, hidden-tree budget, and performance evidence.
- `docs/architecture/domains/social/runtime/README.md` defines the Desktop/Mobile shared social runtime abstraction. This Desktop document refines that abstraction inside the embedded WebView renderer kernel/runtime contracts.

Read this before changing:

- `apps/desktop/src/kernel/runtime.ts`, `kernel/page.ts`, `kernel/boot.ts`, `kernel/PageHost.tsx`, `kernel/usePrefetch.ts`
- `apps/desktop/src/runtimes/socialRuntime.ts`, `momentsRuntime.ts`, `searchRuntime.ts`, `settingsRuntime.ts`
- `apps/desktop/src/runtimes/messagingRuntime.ts`
- `apps/desktop/src/services/socialRealtime.ts`
- `apps/desktop/src/services/messagingRealtime.ts`
- `apps/desktop/src/services/appRuntime.ts`
- `apps/desktop/src/store/socialChat.ts`
- `apps/desktop/src/store/notification.ts`
- `apps/desktop/src/store/navigationBadges.ts`
- chat/contact pages and components that display social state

## 2. Runtime Ownership

Station owns cross-device business truth. `desktop-rust` is the local command and capability runtime. The embedded WebView renderer owns view rendering and local projections.

Inside the embedded WebView renderer, long-lived runtimes own projection freshness:

| Runtime | Owns |
|---|---|
| `messaging` | Chat command lifecycle, native projection events, scoped reset, cold sync, and periodic reconciliation |
| `socialRealtime` | Friendship, contact, profile, presence, and Social notification projections |
| `momentsRuntime` | Moments HOME / Explore / Circles projection bootstrap, periodic reconciliation, and actor-scoped reset |
| `agent-capability` | Provider, model, Agent, applet, MCP, Skill, and Tool projection bootstrap |
| `agent-topic` | Selected Agent topic/message bootstrap, Agent-switch refresh, and periodic reconciliation |
| `agent-tool` | Station-authored ToolCall proposal, approval-decision, and result projections; user decision-intent submission through Desktop Rust |
| `home` | Station-authored Home projection bootstrap, actor-scoped reset, exact recent-conversation handoff, and periodic reconciliation |
| `evaluation` | Station-authored benchmark, dataset, case, run, result, metrics, and recovery projection; actor-scoped reset, event consumption, and periodic reconciliation |
| `settings` | Canonical editable Account profile, authorized devices, category preference snapshot, and redacted push-device list; session reset and periodic reconciliation |
| `notification` store | Notification list, unread counts, notification presentation state |
| `navigationBadges` | Cross-surface unread and badge projection |
| Page components | Rendering, selection, local interaction state only |

Pages may trigger a first-screen fallback load, but they must not be the primary mechanism that keeps business projections fresh.

## 3. Projection Rules

Every business state change visible in Desktop must have two update paths:

1. **Event consumption path**: the runtime consumes a typed event or notification and updates the owning store immediately.
2. **Periodic reconciliation path**: the runtime periodically reloads or syncs the authoritative projection to cover dropped SSE events, reconnects, hidden windows, and process pauses.

If a feature only refreshes on component mount, tab switch, or button click, the implementation is incomplete.

## 4. Social Runtime Contract

`messaging` is the only embedded Desktop renderer owner of Chat projection freshness after
login:

- own the authenticated Device Messaging Engine scope and command facade;
- consume native Messaging projection invalidations;
- reconcile conversations, messages, receipts, typing, membership, settings,
  and attachments after dropped events, reconnects, and foreground resume;
- reset Chat projection state atomically on actor or Station scope change;
- keep pages and `socialRealtime` from installing Chat consumers.

`socialRealtime` is responsible for keeping Social projections current after login:

- own the `/events/stream` supervisor lifecycle after authentication, independent of page or presence-hook mounts;
- bootstrap current user profile, friend requests, relationship state,
  notification counts, and notification list;
- consume presence, relationship, profile, and Social notification events;
- consume notification-derived social signals such as friend request and friend accepted notifications;
- periodically reconcile friendship, profiles, presence, and notifications;
- keep UI components as pure readers of the owning stores whenever possible.

Chat/Messaging event consumption (messages, receipts, typing, mutations, group membership, group federation, conversation settings, cold resync) has been extracted to the `messaging` runtime (see §4.x Messaging Runtime Contract below).

Friend request handling specifically belongs here. A notification saying "User B sent a friend request" must cause the social projection to refresh friend requests and related counters without waiting for Contacts to remount.

Peer public profile is also part of this projection. The chat layer needs the rich public profile (display name, bio, avatar/header, region, tags, links, counts) of any peer it can converse with. The cache lives in `socialChat.peerProfiles` and is filled by `loadPeerProfile(did)`; UI panels (Contacts detail, Chat detail) call it lazily on view, while authoritative invalidation must come from the runtime — when an `actor.profile.updated` realtime signal lands (or, until then, on supervisor resync) `socialRealtime` must call `loadPeerProfile(did, true)` for every peer currently visible in `sessions`/`groupMembers` so the next render sees the new profile.

The notification preview and complete viewer are transient pure readers.
`socialRealtime` owns notification polling, resets, reconnect reconciliation,
and refreshes after existing Social/Moment signals. There is currently no
Native Desktop notification-created event contract; the list/count refresh
must not claim to consume one. Counts are always read from Station, including
after category-wide marking. Refresh preserves the amount of loaded history;
search explicitly covers loaded rows and pagination renders at most six.
Session epoch and request generation fence list/count reads and mutations.

Contact safety reads `relationships.relationshipPolicies`, populated through
the canonical Social relationship status command. Contact detail starts a lazy
observation; `socialRealtime` refreshes observed policies on relationship
events and periodic reconciliation. Unknown status never implies unblocked.
The initial revision-zero projection may lack a directional block edge:
the selected contact's authoritative Home Station identity supplies the command
target, and conflicting Station identities disable the action.

Contact detail and Privacy Settings dispatch the same revision-fenced
`setActorBlocked` command. A matching committed Station projection updates the
policy; block-list readback and relationship invalidation converge other
surfaces. Session epoch, read generation, mutation generation and monotonic
policy revision reject stale completions. Confirmations retain their opening
session epoch and cannot submit for a replacement session.

### Account And Notification Settings

`settingsRuntime` refreshes `profile`, authorized devices, category preferences,
and `pushDevices` at bootstrap, session edges and periodic reconciliation.
`AccountTab` renders the canonical revisioned profile and owns only an explicit
Save/Discard draft. Conflicts keep the draft until the user loads the latest
snapshot. Uploads use Native picker/OSS commands; browser prototypes expose
that availability boundary rather than simulating an upload.

Profile revision changes enter `identityRuntime.refreshCurrentProfile()` so
shell and account-registry projections converge through identity reducer
events. Actor/session epoch and read generation reject stale completion.
The push-device list is read-only: native provider registration and unregister
remain Mobile-owned. Provider credentials and binding fingerprints do not
enter the Desktop renderer.

The `desktop-profile-notifications-e2e` Gate consumes one parent-owned Native
Suite through an ephemeral `run-suite` capability. Its Profile and notification
scenarios reuse the development Journey functions and the same two logged-in
clients. The Suite attests the existing remote Station, binds both live Native
clients to the current source, preserves fixture installation identity, restores
namespaced business state, and verifies final process/port/session cleanup before
publishing the complete result generation. Neither scenario nor Gate provisions,
launches, logs in, or releases Suite resources.

Native Acceptance owns `runtime.sourceIdentity`: it reads the compiled source
commit, live process ID and executable digest from the Native Acceptance command,
then hashes the embedded renderer scripts. The Suite compares that identity with
its source and driver-owned binary/process. This capability is independent of
authenticated business runtime leases. Private Moments retains its own secure
content lease and Station trust checks and shares only artifact hashing.

## 4.1 Moments Runtime Contract

`momentsRuntime` is responsible for the first runtime-owned Moments projection slice:

- observe authenticated actor edges and reset actor-scoped Moments / Discovery state on identity switch;
- bootstrap the viewer identity, HOME feed, PUBLIC Explore feed, circles, and circle member previews;
- refresh detail projection when the user opens a Moment (`post + comments`);
- refresh author projection when the user opens an actor page (`author feed + followers/following`);
- periodically reconcile the same projection until Station projection events and cursor sync land;
- consume Desktop eventBus Moment events (`moment.created`, `moment.deleted`, `moment.commented`, `moment.reacted`, `moment.resync_requested`) and refresh affected projections while keeping periodic reconcile as the missed-event safety net;
- keep HOME / Explore / Circle / Detail / User pages as pure readers for first-screen data;
- allow explicit user actions (`Load more`, sort switch, comment submit) to call store actions, because those are interaction-driven pagination/write flows rather than mount-time projection freshness.

## 4.2 Applet Catalog Projection

`appletsRuntime` owns reconciliation of `useAppletsStore`. Launcher, command
search and the lazy Settings applet section read that same installed/catalog
projection. Settings declares the `applets` runtime and does not call the
legacy `applets_list` registry or import applet product components.

The store merges canonical package IDs from the local validated index and
Station catalog. Station revoked/disabled state takes precedence over local
installation, including bundled applets; a failed Station refresh preserves
known denials. Installation checks the AppletManager schema/Desktop/platform
version boundary before either changing local installation preferences or
issuing a Store command. Loading rechecks policy after installation and after
session creation, destroying a session if a denial arrives during load.

Local import uses the Native directory selection command. Browser prototypes
expose that availability boundary and share one injected catalog across
Launcher, command search and Settings. Explicit browser scenarios use package
manifest metadata; their installation results are not production Store proof.

## 5. Implementation Pattern

When adding or fixing a runtime-backed feature:

1. Identify the domain owner and source of truth.
2. Identify the embedded renderer runtime/store that owns the projection.
3. Add immediate event/notification consumption in that runtime.
4. Add low-frequency reconciliation for missed events.
5. Keep page/component changes limited to rendering and user actions.
6. Verify by testing both live event delivery and reload/reconnect recovery.

Do not fix stale runtime state by only adding `useEffect(...load...)` to a component. That is acceptable only as a defensive fallback after the owning runtime has a proper consumer and reconciliation path.

## 6. Kernel Contracts

The kernel formalizes **how** projections, pages, and the boot sequence relate. These contracts are not optional; new pages and new projection owners must conform.

### 6.1 Runtime Contract

`apps/desktop/src/kernel/runtime.ts`

```ts
interface RuntimeDescriptor {
  id: string;                       // 'social' | 'search' | 'settings' | ...
  scope: 'app' | 'session';         // app: lives for process; session: per-actor
  install(): void;                  // register subscribers / timers (idempotent)
  teardown(): void;                 // reverse install (idempotent)
  bootstrap(actorId: string | null): Promise<void>;
  reconcile?(reason: string): Promise<void>;
  acquirePage?(pageId: string, reason: 'activate' | 'prewarm'): void | Promise<void>;
  releasePage?(pageId: string, reason: 'explicit-close' | 'evict' | 'unmount'): void | Promise<void>;
}
```

- A runtime is the SINGLE owner of one domain's projection store(s). No two runtimes own overlapping fields.
- `install` runs once at boot. `bootstrap` runs once per `(actorId, runtime)` pair; the registry guards against duplicate concurrent bootstraps via per-runtime sequence numbers.
- `app`-scope runtimes (search, settings, social, moments) do not depend on the active actor at install time; their data either is identity-independent, is itself the source of truth for the active actor, or observes authenticated actor edges through its own bridge logic.
- `session`-scope runtimes are created by registering a descriptor with `scope: 'session'`; the BootPipeline calls their `bootstrap`/`teardown` on the authenticated-actor edge.
- `agent-chat` is an authenticated-critical session runtime. Its stream consumer and actor-bound recovery projection MUST finish install/bootstrap before Agent turn commands are exposed; otherwise early sequenced events can be observed by the transport but dropped by the recovery owner.
- `acquirePage` / `releasePage` are optional page-resource lease hooks for dynamic runtime instances. They do not replace `install/bootstrap/reconcile`; they only let the owning runtime acquire or release page-scoped resources when PageHost proves a page needs them.
- Ordinary page switches do not trigger `releasePage`. `keepAlive:{lru}` means the page is hidden but cached; resources are released only for explicit close, LRU eviction, or true unmount.
- Runtime entries live in `apps/desktop/src/runtimes/*Runtime.ts` and are registered through `services/appRuntime.ts → registerKernelRuntimes`.

### 6.2 Page Contract

`apps/desktop/src/kernel/page.ts`

```ts
interface PageDescriptor {
  id: string;
  factory: () => ReactElement;       // pure renderer
  preload: 'eager' | 'idle' | 'on-visit';
  keepAlive: 'forever' | { lru: number } | 'none';
  runtimes: ReadonlyArray<string>;   // ids of RuntimeDescriptors this page reads
}
```

- A page is a **pure renderer** over its runtimes' stores. Pages MUST NOT trigger first-load API calls in mount-time effects. Mount-time `useEffect` is reserved for view-bound side-effects (focus restore, transient subscriptions, P2P transport status).
- `preload: 'eager'` mounts on first render (use for the landing page only).
- `preload: 'idle'` mounts during `requestIdleCallback` after first paint; this is the right default for any heavy keep-alive page.
- `keepAlive: 'forever'` keeps the DOM alive across tab switches (visibility flipped via `display: contents | none`); destroying complex trees on every navigation is the primary cause of perceived lag and is forbidden for high-frequency surfaces.
- Pages declare `runtimes: ['social', ...]` so the kernel can guarantee install + bootstrap before the page becomes visible (current implementation defers to `appRuntime` install order; declarative gating is the future contract).
- Page descriptors live next to their page modules: `apps/desktop/src/pages/<Name>.descriptor.tsx`. They are registered via `pages/registry.ts → registerKernelPages` (idempotent, called once from `<ReadyView />`).

### 6.3 Boot Pipeline

`apps/desktop/src/kernel/boot.ts`

| Phase | Trigger | Owner |
|---|---|---|
| `shell` | `main.tsx → bootstrap()` start | `main.tsx` |
| `identity` | account picker / OAuth / restore | `useAppLifecycle` |
| `runtime:critical` | authenticated actor accepted | `useAppRuntime` (`installAuthenticatedCriticalRuntimes`) |
| `firstPaint` | critical runtime bootstrap completes | `App.tsx` / `ReadyView` |
| `runtime:idle` | install non-critical session-scope runtimes | `App.tsx` (`scheduleIdle → installIdleRuntimes`) |
| `pages:prewarm` | mount `preload: 'idle'` pages off-frame | `PageHost` |
| `steady` | runtimes own their own reconcile timers | each runtime |

Each phase is observable via `kernel/boot.ts → markPhaseStart/End` (logged through the unified `log.info('boot', ...)` channel) so cold-start cost is measurable in dev console.

PageHost also owns page-resource lease dispatch:

- `activate`: active registered page needs runtime resources.
- `prewarm`: idle-prewarmed page needs runtime resources.
- `explicit-close`: page requested resource release without waiting for LRU eviction.
- `evict`: `keepAlive:{lru}` dropped a cached dynamic page.
- `unmount`: `keepAlive:'none'` page left active state and unmounted.

### 6.4 Page-local Prefetch

`apps/desktop/src/kernel/usePrefetch.ts`

`usePrefetch(key, loader)` is for one-shot, page-local data that is too heavy to bootstrap eagerly but still benefits from being warm by first click (Statistics, Tools, Search Providers, Help). Use cases:

- The data is read by a single section, never by a runtime consumer.
- The loader is idempotent and the cache value is small.
- The data does not require runtime-driven invalidation (otherwise: own it in a Runtime).

Prefetch is **not** a substitute for a runtime — runtimes own *long-lived* projections; prefetch caches *one-shot* fetches.

## 7. Migration Status

| Page | PageDescriptor | Runtimes | Status |
|---|---|---|---|
| `search` | `pages/SearchPage.descriptor.tsx` | `search` | migrated |
| `chat` | `pages/SocialChatPage.descriptor.tsx` | `messaging`, `social` | migrated |
| `settings` | `pages/SettingsPage.descriptor.tsx` | `settings` | migrated |
| `applets` | `pages/AppletsPage.descriptor.tsx` | `applets` | migrated |
| `applet:*` | `pages/AppletRuntimePage.descriptor.tsx` | `applets` | migrated dynamic route; `appletsRuntime` owns `acquirePage/releasePage` session lease |
| `moments` | `pages/moments/MomentsApp.descriptor.tsx` | `moments`, `social`, `messaging` | migrated |
| `agent` | `pages/AgentChatPage.descriptor.tsx` | `agent-capability`, `agent-topic`, `agent-tool`, `social` | migrated (`preload: idle`, `keepAlive: forever`); page is a pure `AgentWorkbench` renderer |
| `home` | `pages/HomePage.descriptor.tsx` | `home` | migrated (`preload: eager`, `keepAlive: forever`); page renders the Station Home projection |
| `evaluation` | `pages/EvaluationPage.descriptor.tsx` | `evaluation`, `agent-capability` | migrated (`preload: on-visit`, `keepAlive: lru(1)`); page renders Station-owned Evaluation truth and runtime recovery |
| `marketplace` | `pages/MarketplacePage.descriptor.tsx` | none | migrated (`preload: on-visit`, `keepAlive: lru(1)`); page uses one-shot prefetch for the verified Desktop Rust catalog cache and explicit user sync for invalidation |
| `agent-profile`, `agent-orchestration` | — | — | legacy `PageRouter` fallback |

New pages that fit the contract should ship as descriptors from day one. Adding a page to the legacy `PageRouter` requires an explicit reason in the PR description.
