# Desktop Runtime Projections

## 1. Purpose

Desktop UI state is a set of runtime projections over Station truth, local Rust state, and local UI interaction state. A projection is not allowed to stay correct only because a page mounted, a tab was clicked, or a component called a one-off refresh.

This document is the Desktop platform source for how runtime components consume events, refresh derived business state, and reconcile missed updates. It also defines the **kernel contracts** (`Runtime`, `Page`, `Boot`) that all new pages and projection owners must follow.

Cross-end architecture source:

- `docs/architecture/social-runtime/README.md` defines the Desktop/Mobile shared social runtime abstraction. This Desktop document refines that abstraction inside `desktop-web` kernel/runtime contracts.

Read this before changing:

- `apps/desktop/src/kernel/runtime.ts`, `kernel/page.ts`, `kernel/boot.ts`, `kernel/PageHost.tsx`, `kernel/usePrefetch.ts`
- `apps/desktop/src/runtimes/socialRuntime.ts`, `searchRuntime.ts`, `settingsRuntime.ts`
- `apps/desktop/src/services/socialRealtime.ts`
- `apps/desktop/src/services/appRuntime.ts`
- `apps/desktop/src/store/socialChat.ts`
- `apps/desktop/src/store/notification.ts`
- `apps/desktop/src/store/navigationBadges.ts`
- chat/contact pages and components that display social state

## 2. Runtime Ownership

Station owns cross-device business truth. `desktop-rust` is the local command and gateway runtime. `desktop-web` owns view rendering and local projections.

Inside `desktop-web`, long-lived runtimes own projection freshness:

| Runtime | Owns |
|---|---|
| `socialRealtime` | Chat/contact/social projections, realtime event consumption, cold sync, periodic reconciliation |
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

`socialRealtime` is responsible for keeping social projections current after login:

- own the `/events/stream` supervisor lifecycle after authentication, independent of page or presence-hook mounts;
- bootstrap current user profile, encryption state, sessions, groups, friend requests, notification counts, and notification list;
- consume realtime message, receipt, typing, mutation, group membership, presence, and resync events;
- project message facts into `socialChat` immediately; sync/list API calls are reconciliation paths, not the first visible source of a received message;
- consume notification-derived social signals such as friend request and friend accepted notifications;
- periodically reconcile sessions, groups, friend requests, unread counts, and conversation previews;
- keep UI components as pure readers of `socialChat` store whenever possible.

Friend request handling specifically belongs here. A notification saying "User B sent a friend request" must cause the social projection to refresh friend requests and related counters without waiting for Contacts to remount.

Peer public profile is also part of this projection. The chat layer needs the rich public profile (display name, bio, avatar/header, region, tags, links, counts) of any peer it can converse with. The cache lives in `socialChat.peerProfiles` and is filled by `loadPeerProfile(did)`; UI panels (Contacts detail, Chat detail) call it lazily on view, while authoritative invalidation must come from the runtime — when an `actor.profile.updated` realtime signal lands (or, until then, on supervisor resync) `socialRealtime` must call `loadPeerProfile(did, true)` for every peer currently visible in `sessions`/`groupMembers` so the next render sees the new profile.

## 5. Implementation Pattern

When adding or fixing a runtime-backed feature:

1. Identify the domain owner and source of truth.
2. Identify the `desktop-web` runtime/store that owns the projection.
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
}
```

- A runtime is the SINGLE owner of one domain's projection store(s). No two runtimes own overlapping fields.
- `install` runs once at boot. `bootstrap` runs once per `(actorId, runtime)` pair; the registry guards against duplicate concurrent bootstraps via per-runtime sequence numbers.
- `app`-scope runtimes (search, settings, social) do not depend on the active actor; their data either is identity-independent (search sources) or is itself the source of truth for the active actor (settings, social).
- `session`-scope runtimes are created by registering a descriptor with `scope: 'session'`; the BootPipeline calls their `bootstrap`/`teardown` on the authenticated-actor edge.
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
| `runtime:critical` | install + bootstrap critical runtimes | `App.tsx` (`installAppRuntime`) |
| `firstPaint` | `<ReadyView />` first effect | `ReadyView` |
| `runtime:idle` | install non-critical session-scope runtimes | `App.tsx` (`scheduleIdle → installIdleRuntimes`) |
| `pages:prewarm` | mount `preload: 'idle'` pages off-frame | `PageHost` |
| `steady` | runtimes own their own reconcile timers | each runtime |

Each phase is observable via `kernel/boot.ts → markPhaseStart/End` (logged through the unified `log.info('boot', ...)` channel) so cold-start cost is measurable in dev console.

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
| `chat` | `pages/SocialChatPage.descriptor.tsx` | `social` | migrated |
| `settings` | `pages/SettingsPage.descriptor.tsx` | `settings` | migrated |
| `agent`, `notes`, `agent-profile`, `applet:*` | — | — | legacy `PageRouter` fallback |

New pages that fit the contract should ship as descriptors from day one. Adding a page to the legacy `PageRouter` requires an explicit reason in the PR description.
