# Mobile Social Runtime Closure

> Status: active implementation plan
> Date: 2026-06-03
> Scope: `apps/mobile/src/features/social`, `apps/mobile/src/components`, `apps/mobile/src/pages`, Station social/chat/notification APIs

---

## 1. Real Upgrade Goal

This is not a UI parity patch. The upgrade is a runtime-projection closure for Mobile social capability.

Cross-end architecture source:

- `docs/architecture/social-runtime/README.md` defines the Desktop/Mobile shared social runtime abstraction. This Mobile plan is a platform-layer refinement under that architecture source, not a competing boundary definition.

Current problem:

- Social behavior was added feature-by-feature from pages and component state.
- Long-lived projections such as friend requests, sessions, messages, notifications, unread counts, presence, typing, and realtime events were not governed by an explicit runtime owner.
- Desktop parity cannot be reached by adding one more page refresh or button because the correctness requirement is runtime freshness, not visual completeness.

Target:

- Mobile social becomes a Station-backed runtime projection, symmetric with Desktop's `socialRealtime` ownership model while respecting Mobile lifecycle constraints.
- Pages render projections and issue user actions only.
- Runtime owns bootstrapping, event consumption, periodic reconciliation, stream teardown, and projection repair after missed events.

Non-goals:

- Mobile does not become a business source of truth.
- Mobile does not implement Desktop-only window, tray, or multi-window behaviors.
- This plan requires proto-first generation for Mobile Web runtime contracts; generated TS proto bindings are the only accepted protobuf decode source.

---

## 2. Domain Responsibilities

| Domain | Owner | Responsibility | Must Not Own |
| --- | --- | --- | --- |
| Station social truth | Station subservers | Friend requests, sessions, messages, notification records, unread counts | Mobile-local truth |
| Social API gateway | `socialApi.ts` | Typed access to Station chat/social/notification endpoints and error envelopes | UI state |
| Social wire contract | `socialWire.ts` | SSE frame extraction plus generated Mobile Web TS proto adaptation for `StreamEvent`, `FriendChatMessage`, and message mutations | Runtime lifecycle, projection state, or hand-written protobuf decoding |
| Social normalizers | `socialNormalizers.ts` | Adapt Station response shapes, enum encodings, timestamps, metadata, and uint64 identifiers | Stateful projections |
| Social projection reducers | `socialProjection.ts` | Pure derived views and reducers for conversations, request buckets, notifications, message merge, receipt state, typing pruning | API calls or rendering |
| Social projection store | `socialStore.ts` | Projection state, user commands, optimistic local projection updates, and command orchestration | Stream lifecycle or response-shape adaptation |
| Social runtime supervisor | `socialRuntime.ts` | Reconcile timer, realtime stream, presence stream, typing sweep, teardown | Rendering |
| Runtime hook boundary | `useSocialRuntime.ts` | Bind authenticated session to runtime lifecycle | Business projection logic |
| Shell/navigation surface | `MobileShell`, notification center | Show badges, open drawers, route to Chat/Contacts | Projection freshness |
| Pages | Chat/Contacts/Settings pages | Render projections and dispatch commands | Long-lived refresh ownership or profile caching |

Collaboration rule:

- `socialRuntime` may call `socialStore` commands.
- Pages may read selectors and dispatch commands.
- Pages must not create independent timers, SSE consumers, or projection refresh loops.

---

## 3. Execution Closure

Standard foreground lifecycle:

```text
auth session restored / login granted
  -> MobileShell mounts
  -> useSocialRuntime binds session
  -> socialStore creates Station API client and current actor DID
  -> socialRuntime starts:
       - cold reconcile: friend requests + sessions + notifications
       - /events/stream consumer
       - /friend-chat/presence/stream consumer
       - periodic reconcile fallback
       - typing stale-state sweep
  -> pages render projections
  -> user actions dispatch store commands
  -> runtime consumes events and repairs missed events through reconcile
```

Recovery lifecycle:

```text
SSE dropped / WebView suspended / missed event
  -> realtime stream exits silently
  -> reconcile timer remains active in foreground
  -> projection reloads from Station truth
  -> badges, requests, sessions, unread counts, notifications converge
```

Station-change/logout lifecycle:

```text
station change or logout
  -> auth/session store clears session
  -> useSocialRuntime receives null
  -> socialRuntime teardown aborts streams and timers
  -> socialStore clears social projections
  -> access gate restarts before shell
```

---

## 4. Dependency Order

Implementation order is dependency-driven:

1. Protocol/API gateway
   - Station endpoint coverage for friend requests, sessions, messages, notifications, search, mutation.
   - Uniform error details with method/path/status/code/message.
2. Wire contract
   - Decode `/events/stream` SSE data and protobuf wire frames into Mobile social wire events.
   - Use Mobile-generated TS proto bindings from `apps/mobile/src/gen/proto`; hand-written protobuf field-number decoding is not allowed.
3. Response adaptation
   - Normalize snake_case/camelCase, enum strings/numbers, timestamps, metadata, uint64 identifiers.
   - Keep Station response compatibility outside the store.
4. Projection reducers/selectors
   - Own derived views for badges, inbound/outgoing requests, conversations, unread notifications.
   - Own pure merge/prune/receipt projection functions.
5. Projection store
   - Own state and command orchestration.
   - Call API gateway, normalizers, and projection reducers without duplicating their responsibilities.
6. Runtime supervisor
   - Own stream lifecycle, reconcile loop, typing sweep, teardown.
   - Keep hook as lifecycle adapter only.
7. Shell surface
   - Show global notification and tab badges from store selectors.
   - Route notification actions to Chat/Contacts without page-local refresh ownership.
8. Pages
   - Render lists, details, message thread, search results, and user actions.
   - No independent long-lived data freshness.
9. Verification
   - Type/build/native checks.
   - Functional checks for cold start, request receive, notification receive, chat send/read/reconcile, logout/station change cleanup.

---

## 5. Deliverables

Protocol/API gateway:

- `socialApi.ts` covers:
  - friend request send/accept/reject/list
  - sessions/messages/list/send/read/ack
  - notification list/unread/mark-read/mark-all/delete
  - people search/federation resolve
  - peer profile fetch
  - message search/edit/recall/delete

Wire contract:

- `socialWire.ts` owns:
  - SSE `data:` extraction and base64 decoding
  - `StreamEvent` oneof dispatch through generated `StreamEventSchema`
  - `FriendChatMessage` decoding through generated `FriendChatMessageSchema`
  - `MessageReceipt`, `TypingState`, `PresenceFlip`, `Resync`, and `MessageMutation` adaptation from generated proto messages
  - no manual `ProtoReader` or duplicated protobuf wire model

Response adaptation:

- `socialNormalizers.ts` owns:
  - Station snake_case/camelCase compatibility
  - enum string/number compatibility
  - timestamp conversion helpers
  - metadata coercion
  - peer profile coercion
  - uint64-safe actor/message identifiers

Projection reducers:

- `socialProjection.ts` owns:
  - conversation derivation
  - inbound/outgoing request buckets
  - unread notification projection
  - message and notification merge
  - receipt status projection
  - message mutation projection for edit/recall/delete
  - presence seed projection
  - typing stale-state pruning

Projection store:

- `socialStore.ts` owns:
  - current session key and actor DID
  - friend requests
  - sessions
  - messages
  - notifications and unread counts
  - presence
  - typing state
  - people search
  - peer profile cache
  - message search
  - message mutation commands
  - user commands and optimistic projection updates

Runtime supervisor:

- `socialRuntime.ts` owns:
  - cold reconcile
  - periodic reconcile
  - realtime stream lifecycle
  - realtime message mutation stream projection
  - presence stream
  - typing sweep
  - teardown

Rendering:

- `MobileShell` owns shell-level navigation and badges.
- `MobileNotificationCenter` renders notification projection and dispatches notification commands.
- `ChatPage` renders conversations, message thread, search, send, edit, recall, delete.
- `ContactsPage` renders friend requests, contacts, people search, peer profile card, open-chat action.

Documentation:

- This execution plan is the source for Mobile social runtime closure.
- Future work must update this file when changing social runtime boundaries.

---

## 6. Evaluation System

Positive indicators:

- Incoming friend request appears in Contacts without remounting Contacts.
- Notification badge and Contacts badge converge after missed events.
- Chat message appears through realtime path and remains correct after reload/reconcile.
- Station change/logout clears social projection and tears down streams.
- Runtime code owns timers/streams; pages do not.

Regression indicators:

- A page adds `setInterval`, SSE `fetch`, or mount-only projection refresh for social truth.
- Notification badge and request list are computed from different inputs.
- Search or message mutation creates a page-local cache that can diverge from store projection.
- A Station response shape change breaks UI because normalization was bypassed.

Verification commands:

```bash
pnpm --dir apps/mobile run check
pnpm --dir apps/mobile run build
pnpm --dir apps/mobile run tauri:ios:dev
```

Functional acceptance:

- Login as actor C on node-c, receive request from Desktop actor B, see Contacts badge and New Friends list agree.
- Accept request, Chat session appears and notification becomes readable.
- Send message both directions, verify unread count, read status, realtime update, and reconcile after refresh.
- Open notification center, mark read, mark all read, delete, load more.
- Search people, search conversations, search messages.
- Edit/recall/delete own message and verify realtime mutation convergence plus Station-backed convergence after reconnect.
- Open a contact profile, verify profile loads from `/actor/actors/:id/profile`, and Station switch/logout clears cached profile projection.

---

## 7. Remaining Architecture Work

Proto contract closure:

- `tooling/scripts/proto-gen-mobile.sh web` generates Mobile Web TS proto bindings into `apps/mobile/src/gen/proto`.
- `socialWire.ts` uses generated `StreamEventSchema` and `FriendChatMessageSchema`; no hand-coded protobuf reader remains.
- Remaining hardening: expand generated proto usage from realtime wire frames into broader Mobile social API request/response DTOs where Station endpoints expose protobuf payloads.

Background/push closure:

- `mobileNativeEventBridge.ts` installs one app-level listener for native push, deep-link, resume, notification-tap, WebView visibility, focus, and network-online wakeups.
- Native events route into `socialRuntime.dispatchSocialRuntimeExternalEvent`; pages never own wakeup refresh logic.
- `socialRuntime` debounces external wakeups, refreshes targeted sessions/notifications when hinted, and falls back to Station-backed reconcile.
- Rust capability kernel emits `mobile:resume` from Tauri `RunEvent::Resumed` and reports native emit failures through `mobile:native-event-error`.
- Remaining native work: wire platform push/deep-link plugins to emit the documented `mobile:push`, `mobile:deep-link`, and `mobile:notification-tap` events.

Group-chat closure:

- Introduce separate group projection domain instead of extending friend chat fields ad hoc.

Profile follow-up:

- Add realtime profile-update invalidation once Station exposes `actor.profile.updated` on Mobile's event stream.
