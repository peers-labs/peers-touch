# Presence Supervisor

> **Status:** Implemented (global actor presence).
> **Updated:** 2026-09-20
> **Owner module (Rust):** `apps/desktop/src-tauri/src/{domain,application,interface/tauri_commands}/presence`
> **Owner module (Frontend):** `apps/desktop/src/{services/presence.ts, hooks/usePresence.ts}`
> **Owner module (Station):** `apps/station/app/subserver/presence`
> **Companion design:** [`unified-actor-system.md`](./unified-actor-system.md)

## 1. Problem

The desktop client has many independent lifecycle signals — `visibilitychange`,
`focus`, `online`/`offline`, identity-restore, identity-switch, logout, process
startup, process shutdown — and each of them historically triggered
ad-hoc network calls scattered across components. The result was visible to
users as:

- **No realtime delivery on cold open**: A→B sends a message; B opens the app
  but B's pending queue at station is never drained until B happens to send
  another message and the round-trip pulls A's message back as a side effect.
- **Network thrash**: every window fired its own presence update and re-pull on
  every focus event, so a brief Cmd-Tab pulse caused 5–20 redundant requests.
- **No single observable for "I am Online as actor X"**: each module
  reasoned about online-ness from its own subset of signals.

These were not three bugs to patch — they were one missing layer.

## 2. Design

### 2.1 Layered model

```
                  Triggers (runtime + identity lifecycle)
                                 │
                                 ▼
      ┌──────────────────────────────────────────────┐
      │ PresenceSupervisor  (per-actor state machine) │   application
      │   • cooldown / in-flight de-dup                │   layer
      │   • lease renewal before TTL                   │
      │   • explicit offline boundaries                │
      └─────────────────────┬────────────────────────┘
                            │
                            ▼
      ┌──────────────────────────────────────────────┐
      │  Home Station: /presence/heartbeat ·           │   infrastructure
      │  /presence/offline · /presence/query           │
      │  Federation peer presence query                │
      └──────────────────────────────────────────────┘
```

The supervisor is the **only** place that interprets triggers. Everything
else either *produces* triggers or *consumes* the resulting transitions.

### 2.2 Vocabulary

```
PresenceState  ::= Unknown | Offline | Online             // query projection
PresenceTrigger ::= AppLaunch
                  | AppForeground | AppShutdown
                  | IdentityRestored | IdentitySwitched | IdentityLoggedOut
                  | NetworkOnline | NetworkOffline
                  | Heartbeat | Manual
PresenceTransition { actor_id, from, to, trigger,
                     reconciled_count, affected_sessions }
```

`Reconciling` is intentionally not a fourth state. It is a transient
`in_flight` flag inside the supervisor. `Unknown` is a query result, not a
self-presence transition: it means the authoritative Home Station could not be
resolved or reached and MUST NOT be displayed as offline.

### 2.3 Reconcile pipeline

`Offline → Online` triggers run in this order, on a detached thread so the
caller never blocks the UI:

1. `POST /presence/heartbeat` — renews the actor/session presence lease;
   failure
   short-circuits the rest (kept Offline).
2. `GET /friend-chat/pending` — drains the in-memory queue station kept
   for us while we were offline.
3. For each unique `session_ulid` in the pending payload, run
   `friend_chat_sync_from_station` (page-limit 50, 1 page) to bring those
   sessions' local cursor up to date.
4. `POST /friend-chat/message/ack` with the union of pulled ulids.
   Failure is logged but does not roll back state — the next `/pending`
   re-serves the same messages, which is fine because step 3 is
   idempotent (cursor-aware).
5. Emit `presence.transition` Tauri event with `reconciled_count` and
   `affected_sessions`.

While authenticated, Desktop renews the lease every 30 seconds against the
Station's 90-second TTL. Renewal continues while the app is unfocused or
minimized because reachability is process/runtime state, not attention state.
`Online → Offline` is reserved for logout, process shutdown, confirmed network
loss, revocation, or lease expiry. The Station lease TTL remains the
authoritative safety net when clients crash or lose the network before the
best-effort offline request arrives.

`POST /presence/query` is the only client snapshot API. The receiving Station
resolves every requested PTID through Actor Identity:

- local actor: read the local Presence lease;
- remote actor: call the actor's verified Home Station through the authenticated
  Federation peer-query route;
- unresolved route, failed peer authentication, timeout, or omitted result:
  return `PRESENCE_STATE_UNSPECIFIED`.

Clients never contact a foreign Station directly.

### 2.4 Invariants

- **Per-actor, not per-window.** The supervisor keys by `actor_id`. Two
  windows hosting the same actor share one presence; two windows hosting
  different actors are independent. Pending queues at station are
  actor-scoped — anything else would double-pull.
- **Focus is not reachability.** Blur, minimization, hidden pages, and switching
  to another application do not transition presence offline.
- **Renew before expiry.** The renewal interval must remain no greater than one
  third of the authoritative lease TTL.
- **At most one reconcile in-flight per actor.** Concurrent triggers
  while a reconcile is running collapse silently.
- **Cooldown 3 s** for non-bypassing triggers when the target state
  already matches the current state. Identity-driven and
  shutdown/manual triggers bypass — we must never silently drop a
  user-initiated logout's `/presence/offline`.
- **Failures don't poison state.** A failed `Online` reconcile leaves
  the actor at `Offline` (next trigger retries) and does *not* update
  `last_reconcile_at` (no cooldown punishment).
- **Unknown is not offline.** Only an authoritative Home Station may report
  offline. Missing routing or failed remote reads project as unknown.
- **Events cannot be rolled back by snapshots.** The client records a per-PTID
  revision before each snapshot and ignores that actor's result if a newer
  realtime event arrived while the request was in flight.

### 2.5 Trigger sources

| Trigger              | Producer                                       |
|----------------------|------------------------------------------------|
| `app_launch`         | `usePresence` after first `authenticated=true` |
| `app_foreground`     | `visibilitychange(visible)` + `focus`          |
| `app_shutdown`       | Tauri `RunEvent::ExitRequested`                 |
| `identity_restored`  | `services/identity_event` on `unlock`          |
| `identity_switched`  | `services/identity_event` on `login` / `switch` / `oauth_bridge` |
| `identity_logged_out`| `services/identity_event` on `logout`          |
| `network_online`     | `window.online`                                |
| `network_offline`    | `window.offline`                               |
| `heartbeat`          | 30-second authenticated runtime renewal         |
| `manual`             | tests / debug                                  |

Identity-flow producers fire **after** `runIdentityPipeline` so the
reconcile sees the new actor's bound session, not the previous one.

Window hidden/blur emits no presence transition. A foreground edge may renew
early, but the periodic runtime heartbeat remains the liveness owner.

### 2.6 Frontend reaction

The bridge in `services/presence.ts` listens for `presence.transition`
and applies a **minimal fan-out** to the social-chat store:

- `loadSessions()` (sidebar + unread badges)
- `loadConversationPreviews()` (last-message snippets)
- `loadMessages(ulid, 'friend')` only if the user is currently viewing
  one of the affected sessions

The social runtime also refreshes known peer snapshots after realtime
reconnect, cold resync, inbound conversation activity, and relationship
changes. Its existing 30-second reconcile is the bounded recovery path for
missed same-Station events and cross-Station snapshots.

We deliberately do *not* eagerly pull every affected session's full
message list — most are not on screen, and the existing on-demand
loading path handles them when the user clicks in.

## 3. Why this displaces / shrinks adjacent mechanisms

| Old mechanism                                        | After PR-presence-1                            |
|------------------------------------------------------|------------------------------------------------|
| Page-owned presence polling                         | Deleted; runtime reconciliation owns freshness. |
| Per-component `friend_chat_sync` calls on focus      | Funnels into a single supervisor entry point. |
| Hand-rolled `/pending` calls in two unrelated places | One reconcile pipeline; sole owner of `/online`/`/pending`/`/ack`. |
| "Did the user just unlock?" inferred from N stores   | Single `identity_restored` trigger.            |
| Window blur interpreted as offline                   | Deleted; focus is not reachability.            |
| Local-only remote actor query                        | Routed to the verified Actor Home Station.     |

## 4. Non-goals

- **Replacing WebRTC for hot-path delivery.** WebRTC remains the primary
  realtime channel. The supervisor's reconcile is the *catch-up* path
  for messages that arrived while WebRTC was down or before it was
  established.
- **Attention state.** Away, idle, active-window, and last-active labels are
  not inferred from reachability and require their own accepted product model.
- **Persisting presence to disk.** Presence is a runtime concept; on
  process restart we always begin at `Offline` and the launch trigger
  drives the first reconcile.

## 5. Where to extend

- **TURN handshake observation.** The transport-detection added in
  PR-webrtc-2 (`friendChatP2p.startTransportProbe`) could publish a
  presence-adjacent signal — but presence and transport remain
  orthogonal: a user can be `Online` over relay or direct.
- **Per-conversation read receipts.** When the user opens a session
  whose unread count just dropped via `presence.transition`, the existing
  read-marker flow takes over. No supervisor changes needed.

## 6. Tests

- `domain::presence::tests` — wire-form round-trip, reachability transition
  partition, cooldown bypass policy, and no background-to-offline transition.
- `application::presence::tests` — pending payload extraction (dedup &
  field tolerance), per-actor isolation in the state map.
- Station Presence tests — local/remote routing, authenticated peer query,
  unknown preservation, active lease, expiry, and explicit offline.
- Native two-client Acceptance — both peers remain online across focus changes
  and beyond one Station lease interval.
