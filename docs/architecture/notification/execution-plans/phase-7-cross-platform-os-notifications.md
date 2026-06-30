# Phase 7 — Cross-Platform OS Notification Delivery

> Execution plan for bringing OS-level notification delivery to Desktop (Tauri) and Mobile (Tauri Mobile),
> integrating with the existing notification proto, SSE event stream, and notification store.
>
> Owner: Client platform team
> Status: Proposed
> Related docs:
>   - `../notification-architecture.md` (architecture source of truth)
>   - `phase-3-delivery-realtime.md`
>   - `phase-4-client-presentation.md`
>   - `phase-6-push-gateway.md`

---

## 1. Problem Statement

### 1.1 Current State

The notification system has the server-side domain model, persistence, and SSE event delivery in place.
The client side has:

- **Desktop**: `useNotificationStore` with poll-based refresh (15s), NotificationCenter UI,
  and Tauri commands for list/count/mark-read/delete/preferences.
  See [notification.ts](../../../../apps/desktop/src/store/notification.ts).
- **Mobile**: `socialStore` with notification list + unread count APIs, SSE realtime stream for chat.
  See [socialStore.ts](../../../../apps/mobile/src/features/social/socialStore.ts)
  and [socialRuntime.ts](../../../../apps/mobile/src/features/social/socialRuntime.ts).

### 1.2 Gaps

| Gap | Desktop | Mobile |
|-----|---------|--------|
| OS-level notification popup | ❌ No `tauri-plugin-notification` | ❌ No local/push notification bridge |
| Real-time notification delivery | ⚠️ Polling (15s), not SSE-pushed | ⚠️ Social SSE exists but not wired to notification events |
| Click-to-navigate | ❌ No deep link on notification tap | ❌ No deep link handling |
| Dock / tray / home screen badge | ❌ Not wired to unread count | ❌ Not wired to unread count |
| Push (app-killed / background) | n/a (desktop acceptable) | ❌ No APNs/FCM registration |
| Mute / DND integration | ❌ Per-conversation mute not reflected in OS notification | ❌ Same |

### 1.3 Goals

1. **Real-time**: Notifications arrive via SSE instantly (not 15s poll).
2. **OS-level**: New chat messages, friend requests, mentions, and system alerts produce OS notifications
   when the app is backgrounded / not focused.
3. **Actionable**: Tapping an OS notification opens the app and navigates to the right context
   (chat session, post detail, notification center).
4. **Respectful**: Muted conversations, active (focused) conversations, and DND preferences
   suppress OS notifications.
5. **Cross-platform symmetric**: Desktop and Mobile share the same notification decision logic,
   event types, and navigation contracts — only the OS delivery layer differs.

### 1.4 Non-Goals

- Building the Station-side Push Gateway (covered in `phase-6-push-gateway.md`).
- Server-side notification production (already in `phase-2-storage-subserver.md`).
- Notification preference UI redesign (in scope of `phase-5-preference-advanced.md`).
- Android / iOS native app rewrite — we stay within Tauri Mobile.

---

## 2. Architecture

### 2.1 Layering

```
┌──────────────────────────────────────────────────────────────────┐
│                        Platform Shell                            │
│  (Tauri desktop / Tauri Mobile iOS / Tauri Mobile Android)       │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  OS Notification Layer (native)                           │    │
│  │  · Request permission                                     │    │
│  │  · Show / cancel / replace notification                   │    │
│  │  · Badge count (Dock / home screen)                       │    │
│  │  · Tap / action callback → deep link                      │    │
│  └──────────────────────────┬───────────────────────────────┘    │
│                             │ Tauri command / event bridge        │
│  ┌──────────────────────────▼───────────────────────────────┐    │
│  │  Notification Runtime (TS)                               │    │
│  │  · Subscribe to SSE notification events                  │    │
│  │  · Decide: show OS notif? (focus state + mute + pref)    │    │
│  │  · Render locale-aware title/body                        │    │
│  │  · Update notification store + badge                     │    │
│  │  · Handle deep link navigation                           │    │
│  └──────────────────────────┬───────────────────────────────┘    │
│                             │                                    │
│  ┌──────────────────────────▼───────────────────────────────┐    │
│  │  SSE Event Stream (shared with chat / social)            │    │
│  │  · notification.created                                  │    │
│  │  · notification.read                                     │    │
│  │  · notification.count.updated                            │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 Event Types (Server → Client)

Reused from the event system. Wire format defined in `phase-3-delivery-realtime.md` §7.2.

| Event | Payload | Client Action |
|-------|---------|---------------|
| `notification.created` | `{ notificationId, type, category, actorId, targetType, targetId, title, body, groupKey, soundEnabled }` | Append to store, maybe show OS notif, update badge |
| `notification.read` | `{ notificationIds }` | Mark read in store, cancel OS notif, decrement badge |
| `notification.count.updated` | `{ totalUnread, byCategory }` | Update badge + store counters |
| `notification.deleted` | `{ notificationIds }` | Remove from store, cancel OS notif |

### 2.3 Notification Decision Logic (shared)

```
shouldShowOSNotification(event):
  1. App in foreground AND focused on the target context? → NO
  2. Category disabled in preferences? → NO
  3. Target conversation / post muted? → NO
  4. User DND / system focus mode active? → NO (defer to OS)
  5. Otherwise → YES
```

This decision logic lives in a shared TS module (`notificationDecision.ts`) so Desktop and Mobile
use identical rules.

### 2.4 OS Notification Presentation

| Platform | Mechanism | Library |
|----------|-----------|---------|
| Desktop (macOS) | `tauri-plugin-notification` v2 | `@tauri-apps/plugin-notification` |
| Desktop (Linux/Win) | Same plugin, falls back to system notification | Same |
| iOS | Tauri notification plugin + APNs for background | `@tauri-apps/plugin-notification` + `@tauri-apps/plugin-push-notifications` |
| Android | Same plugin + FCM for background | Same |

**Tag / replacement strategy** — use `tag` to collapse multiple notifications from the same conversation:

- Tag for chat: `chat:{sessionUlid}`
- Tag for social: `social:{targetType}:{targetId}`
- Tag for system: `system:{notificationId}`

New notifications with the same tag replace the old one (e.g., "2 new messages in X").

### 2.5 Deep Link Contract

Tapping a notification launches the app with a deep link. Uniform scheme across platforms:

```
peerstouch://n/{notificationId}?type={type}&target={targetType}:{targetId}
```

The client router resolves:

| `type` | Target | Route |
|--------|--------|-------|
| `friend_message` | `chat_session:{ulid}` | `/chat/friend/{ulid}` |
| `group_message` / `chat_mentioned` | `chat_group:{ulid}` | `/chat/group/{ulid}` |
| `friend_request` | `actor:{did}` | `/social/user/{did}` |
| `post_liked` / `post_commented` | `post:{id}` | `/moments/post/{id}` |
| `system.*` | — | `/notifications` |

### 2.6 Badge Strategy

- Total unread notification count → app badge.
- Chat-only unread → optional (configurable).
- Updated on every `notification.created` / `notification.read` / `notification.count.updated` event.

---

## 3. Desktop Implementation Plan

### 3.1 Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| OS Notification bridge | `src-tauri/src/interface/tauri_commands/notification.rs` (extend) + `Cargo.toml` | Expose `is_permission_granted`, `request_permission`, `show`, `cancel`, `set_badge` commands; register `notification` event listener for tap |
| SSE wiring | `src/services/eventStream.ts` (extend) | Decode `notification.*` SSE events and emit typed bus events |
| Notification runtime | `src/services/notificationRuntime.ts` (new) | Central coordinator: subscribe to events, apply decision logic, call OS notification, update store, manage badge |
| Decision logic | `src/utils/notificationDecision.ts` (new) | Pure function: shouldShowOSNotification(event, appState) |
| i18n rendering | `src/utils/notificationText.ts` (new) | Map notification type → localized title/body using `type + actor + target` |
| Deep link handler | `src/services/deepLink.ts` (new) | Handle `peerstouch://` scheme → router navigation |
| Store extension | `src/store/notification.ts` (extend) | Add `prependNotification`, `applyRead`, `setUnreadCounts` (replace poll with SSE push) |
| UI: notification center | `src/components/NotificationCenter.tsx` (keep) | Already exists — just consumes the store |

### 3.2 Data Flow

```
SSE event (notification.created)
  → eventStream.ts decode & emit on bus
  → notificationRuntime.ts receives
  → check decision logic (focused? muted? pref enabled?)
  → if show:
      · build localized title/body from type + metadata
      · invoke rust notification_show(tag, title, body, { notificationId, target })
      · update dock badge
  → always:
      · update notificationStore (prepend + increment count)
```

### 3.3 Tauri Commands (extend existing notification.rs)

New commands to add:

| Command | Input | Output | Purpose |
|---------|-------|--------|---------|
| `notification_is_permission_granted` | — | `{ granted: bool }` | Check OS notification permission |
| `notification_request_permission` | — | `{ granted: bool }` | Request permission |
| `notification_show` | `{ tag?, title, body, subtitle?, sound?, metadata }` | `{ id: string }` | Show OS notification |
| `notification_cancel` | `{ tag? }` | — | Remove notification by tag |
| `notification_set_badge` | `{ count: number }` | — | Set dock / tray badge count |
| `notification_clear_badge` | — | — | Clear badge |

New Tauri events emitted to frontend:

| Event | Payload | When |
|-------|---------|------|
| `notification:tap` | `{ notificationId?, tag?, metadata }` | User taps an OS notification |

### 3.4 Focus Detection

Use Tauri's `window.onFocusChanged` to track app focus state.
Also track current active route / conversation to suppress notifications for
the currently-open chat.

---

## 4. Mobile Implementation Plan

### 4.1 Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| Push notification bridge | `src-tauri/Cargo.toml` + `src-tauri/src/interface/notification.rs` (new) | Register APNs/FCM token, show local notification, handle tap |
| SSE wiring | `src/features/social/socialRealtime.ts` (extend) | Decode `notification.*` events alongside chat events |
| Notification runtime | `src/features/notification/notificationRuntime.ts` (new) | Same decision logic as Desktop, adapted for mobile |
| Notification store | `src/features/notification/notificationStore.ts` (new) | Zustand store for notification list + unread counts |
| Deep link | `src/utils/deepLink.ts` (new) | Handle `peerstouch://` scheme → app navigation |
| Push device registration | `src/features/notification/pushRegistration.ts` (new) | Get push token → POST `/notification/push/register` |
| i18n rendering | — | Reuse the same templates as Desktop (shared locale keys) |

### 4.2 Two Delivery Modes

| Mode | Trigger | Mechanism |
|------|---------|-----------|
| **Foreground** | SSE event arrives while app is active | Local notification (if not on target screen) + in-app badge |
| **Background / killed** | Station sends push via APNs/FCM | Push notification → user taps → deep link → app opens |

### 4.3 Push Token Registration Flow

```
1. App launches / user logs in
2. Request notification permission
3. Get push token from OS (APNs device token / FCM registration token)
4. POST /notification/push/register with:
     { channel: "apns" | "fcm", deviceToken/fcmToken, platform, deviceName }
5. Token is persisted on Station in push_devices table
6. Token refreshed on app launch + when OS rotates it
```

### 4.4 Deep Link on Mobile

Tauri Mobile supports custom URL schemes via `tauri.conf.json`. Configure `peerstouch://`
and handle the `app://open-url` event to route to the right screen.

---

## 5. Shared Cross-Platform Concerns

### 5.1 Notification i18n Keys

Add a new locale namespace `notification` (or extend existing `chat` / `social`):

```json
{
  "notification.friend_message.title": "{{name}}",
  "notification.friend_message.body": "{{preview}}",
  "notification.friend_request.title": "New friend request",
  "notification.friend_request.body": "{{name}} wants to connect",
  "notification.group_mentioned.title": "Mentioned in {{groupName}}",
  "notification.group_mentioned.body": "{{name}}: {{preview}}",
  "notification.post_liked.title": "{{name}} liked your post",
  "notification.post_commented.title": "{{name}} commented on your post",
  "notification.system.security_alert.title": "Security alert",
  "notification.system.version_update.title": "Update available"
}
```

Both Desktop and Mobile use the same keys from `packages/locales/`.

### 5.2 Mute / Suppression Rules

Shared rules that both platforms implement:

1. **Active conversation mute**: If user is currently viewing chat `X`, don't show OS notification
   for new messages in `X`.
2. **Muted conversation**: If conversation has `muted=true`, no OS notification.
3. **Self-echo**: Notifications where `actorId == currentUserId` are ignored (already handled server-side).
4. **Rate limit**: Max 1 OS notification per conversation per 3 seconds (collapse rapid messages).

### 5.3 Error Handling

- **OS permission denied**: Fall back to in-app only (notification center + badge).
- **SSE disconnect**: Badge count and notification list are still accurate from last sync;
  reconnect catch-up via Broker replays missed events.
- **Push registration fails**: Silent log + retry on next launch. Push is best-effort —
  SSE is the primary delivery channel.

---

## 6. Task Breakdown

### P0 — Core (must have)

| # | Task | Platform | Est. | Depends on |
|---|------|----------|------|------------|
| 1 | Add `tauri-plugin-notification` to Desktop Cargo + frontend package | Desktop | 0.5d | — |
| 2 | Extend Desktop notification.rs with OS notif commands + badge | Desktop | 1d | 1 |
| 3 | Wire `notification.*` SSE events into Desktop eventStream | Desktop | 0.5d | — |
| 4 | Implement `notificationRuntime.ts` (Desktop): decision + store + OS notif | Desktop | 1.5d | 2, 3 |
| 5 | Add i18n locale keys for all notification types | Both | 0.5d | — |
| 6 | Implement deep link handler (Desktop) | Desktop | 0.5d | 4 |
| 7 | Convert Desktop notification store from poll to push (SSE-driven) | Desktop | 0.5d | 3 |
| 8 | Wire `notification.*` SSE events into Mobile socialRealtime | Mobile | 0.5d | — |
| 9 | Mobile local notification (foreground) via notification plugin | Mobile | 1d | 8 |
| 10 | Mobile notification store + runtime (shared logic port) | Mobile | 1d | 8, 9 |
| 11 | Mobile deep link handling | Mobile | 0.5d | 10 |

### P1 — Push & Polish

| # | Task | Platform | Est. | Depends on |
|---|------|----------|------|------------|
| 12 | Mobile push token registration (APNs + FCM) | Mobile | 2d | — |
| 13 | Station Push Gateway: APNs channel | Station | 2d | — |
| 14 | Station Push Gateway: FCM channel | Station | 1.5d | — |
| 15 | Conversation-level mute → OS notification suppression | Both | 1d | P0 |
| 16 | Notification grouping / collapsing (per conversation tag) | Both | 0.5d | P0 |
| 17 | Notification preference UI wiring (enable/disable per category) | Both | 1d | P0 |
| 18 | App icon / home screen badge count | Both | 0.5d | P0 |

### P2 — Advanced

| # | Task | Platform | Est. |
|---|------|----------|------|
| 19 | Notification action buttons (mark as read, reply) | Both | 2d |
| 20 | DND schedule / focus mode integration | Both | 1d |
| 21 | Web Push for Desktop (app-closed fallback) | Desktop | 1d |

---

## 7. Verification & Acceptance Criteria

### 7.1 Desktop Acceptance

- [ ] App in background → new chat message → OS notification pops up
- [ ] App focused on chat X → new message in X → no OS notification
- [ ] App focused on chat X → new message in chat Y → OS notification
- [ ] Click notification → app opens + navigates to correct chat
- [ ] Unread count → dock badge updates in real-time
- [ ] Mark as read in app → OS notification disappears + badge decrements
- [ ] Muted conversation → no OS notification
- [ ] Notification list in center updates in real-time (no poll delay)

### 7.2 Mobile Acceptance

- [ ] App foreground → new message not on current screen → in-app / local notification
- [ ] App in background → push notification arrives (APNs/FCM)
- [ ] Tap push notification → app opens + navigates to correct screen
- [ ] Home screen badge reflects unread count
- [ ] Push token registered after login
- [ ] Notification center list updates in real-time via SSE

### 7.3 Cross-Platform

- [ ] Same notification type → same title/body text on both platforms
- [ ] Same decision logic (mute / active context suppression) on both platforms
- [ ] Read on one device → OS notification dismissed on other devices (via `notification.read` event)

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Tauri Mobile notification plugin doesn't fully support iOS/Android | Verify plugin capabilities early; if gaps, add native plugin code in `src-tauri/` |
| APNs/FCM credentials require Station admin config | Make push channels optional; gracefully degrade to SSE-only |
| Deep link handling conflicts with existing router | Add a dedicated deep link resolver that runs before router init |
| Notification spam from high-volume chats | Collapsing by tag + rate limiting built in from day one |
| Focus state race conditions (user clicks while switching) | Debounce + check current route at render time, not just event time |

---

## 9. Success Metrics

- **Notification delivery latency**: P95 < 2s from Station produce → OS popup (foreground SSE path)
- **Click-through accuracy**: 100% of taps land on correct target screen
- **Badge accuracy**: Badge count matches server unread count within 1s of any change
- **Mute correctness**: 0 notifications shown for muted conversations
- **Cross-platform consistency**: Same test suite passes on both Desktop and Mobile
