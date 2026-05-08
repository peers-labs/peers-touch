# Desktop Runtime Projections

## 1. Purpose

Desktop UI state is a set of runtime projections over Station truth, local Rust state, and local UI interaction state. A projection is not allowed to stay correct only because a page mounted, a tab was clicked, or a component called a one-off refresh.

This document is the Desktop platform source for how runtime components consume events, refresh derived business state, and reconcile missed updates.

Read this before changing:

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

## 5. Implementation Pattern

When adding or fixing a runtime-backed feature:

1. Identify the domain owner and source of truth.
2. Identify the `desktop-web` runtime/store that owns the projection.
3. Add immediate event/notification consumption in that runtime.
4. Add low-frequency reconciliation for missed events.
5. Keep page/component changes limited to rendering and user actions.
6. Verify by testing both live event delivery and reload/reconnect recovery.

Do not fix stale runtime state by only adding `useEffect(...load...)` to a component. That is acceptable only as a defensive fallback after the owning runtime has a proper consumer and reconciliation path.
