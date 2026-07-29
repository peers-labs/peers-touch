# Signal-Level Chat Modernization — Execution Plan

> **Status**: executing — P0 adapter implemented, awaiting deploy+test (2026-07-29)
> **Created**: 2026-07-29
> **Parent**: `docs/architecture/federated-im/design.md`
> **Branch**: `feat/group-detail-history-ux-pr` (peers-chat-high-chat)
> **Goal**: Build a complete, modern IM chat application + server infrastructure at Signal quality

---

## 1. Vision

Deliver Peers-Touch as a **fully functional, privacy-first IM platform** — not a tech demo with
exposed plumbing, but an application a real user would switch to from Signal/Telegram/WeChat.

Reference: **Signal** (E2EE by default, clean UX, essential social features, no bloat).

---

## 2. Corrected Baseline (deep code review 2026-07-29)

### Already Complete (full-stack, verified by code logic)

| Feature | Station | BFF | Frontend |
|---------|---------|-----|----------|
| E2EE — MLS groups + X3DH DM | ✓ conversation subserver | ✓ mls.rs + crypto.rs | ✓ MLS session bootstrap |
| Text messaging (DM + group) | ✓ friend-chat + group-chat + envelope | ✓ send/list commands | ✓ composer + message list |
| Media messages (image/file/voice) | ✓ OSS subserver + attachment proto | ✓ accepts attachments[] | ✓ file picker + paste + drag-drop + renderer |
| Message threads | ✓ thread support in friend/group chat | ✓ thread commands | ✓ thread UI |
| Message recall / edit | ✓ recall/edit handlers | ✓ commands | ✓ store actions + UI |
| Read receipts | ✓ conversation receipt → envelope broadcast | ✓ submit_receipt | ✓ monotonic status + check/double-check icons |
| Unread count badges | ✓ per-session counts | ✓ unread commands | ✓ Badge in sidebar + navigationBadges |
| Delivery status UI | ✓ (covered by read receipts) | ✓ | ✓ sent/delivered/read states |
| Online presence | ✓ DDD subserver (lease heartbeat, expiry) | ✓ Rust supervisor | ✓ green/grey dot |
| Typing indicators | ✓ events subserver | ✓ typing_send | ✓ realtime bridge |
| Real-time delivery (SSE) | ✓ events subserver | ✓ stream start/stop | ✓ eventStream bridge |
| Friend request lifecycle | ✓ social subserver | ✓ friend_chat.rs | ✓ FindPeopleModal + ContactsPage |
| Friend request notification | ✓ social → notification.Produce | ✓ | ✓ notification panel |
| Group create / leave | ✓ group-chat + conversation | ✓ group commands | ✓ CreateGroupModal |
| Local message search | ✓ search handlers | ✓ local_search commands | ✓ store actions |
| WebRTC signaling infra | ✓ events subserver (signal) | ✓ signal_send | ✓ realtime bridge |
| Notifications (list/read/delete) | ✓ notification subserver | ✓ notification.rs | ✓ notification store + panel |

### Genuinely Missing

| # | Feature | Impact | Effort |
|---|---------|--------|--------|
| F1 | **Chat message reactions** (emoji on messages) | High — every modern IM has this | Medium |
| F2 | **Voice/video calls** (1:1 call UI + session management) | High — Signal core feature | Large |
| F3 | **Group admin** (remove, mute, promote member) | Medium — needed for real group management | Medium |
| F4 | **Forward message** (to another chat) | Medium — common workflow | Small |
| F5 | **Pin messages** (in group) | Low — nice-to-have | Small |
| F6 | **Disappearing messages** (auto-delete timer) | Medium — privacy feature | Medium |
| F7 | **Link previews** (OG metadata in chat) | Low — polish | Medium |
| F8 | **Contact profile sheet** (tap avatar → info panel) | Low — UX completeness | Small |

---

## 3. Delivery Plan — Feature by Feature

### F1: Chat Message Reactions

**Proto changes** (`model/domain/chat/conversation.proto`):
```protobuf
// Add to ConversationCommand.payload oneof:
ReactCommand react_command = 9;

message ReactCommand {
  string message_id = 1;
  string emoji = 2;       // Unicode emoji or shortcode
  bool remove = 3;        // true = unreact
}

// Add to conversation event stream:
message ReactionEvent {
  string message_id = 1;
  string actor_id = 2;
  string emoji = 3;
  bool removed = 4;
  int64 timestamp_ms = 5;
}
```

**Station** (`apps/station/app/subserver/conversation/`):
- Add `ReactCommand` handler in `service_impl.go`
- On react: store reaction row, broadcast `ReactionEvent` via envelope to all conversation members
- On unreact: delete row, broadcast removal

**BFF** (`apps/desktop/src-tauri/`):
- Add `conversation_react` Tauri command
- Add `conversation_react` to HTTP gateway

**Frontend**:
- Store: `reactions: Record<messageId, {emoji, actorId}[]>` in socialChat
- Event stream: handle `ReactionEvent` → update store
- UI: long-press/hover message → emoji picker → react; show reaction pills below message

**Deliverable**: Two users can react with emoji on each other's messages; reactions sync real-time.

---

### F2: Voice/Video Calls (1:1)

**Proto changes** (`model/domain/realtime/`):
```protobuf
message CallSignal {
  string call_id = 1;
  string caller_id = 2;
  string callee_id = 3;
  CallAction action = 4;
  string sdp = 5;        // WebRTC SDP
  string candidate = 6;  // ICE candidate
}

enum CallAction {
  CALL_OFFER = 0;
  CALL_ANSWER = 1;
  CALL_REJECT = 2;
  CALL_HANGUP = 3;
  CALL_ICE_CANDIDATE = 4;
}
```

**Station**: Already has `/realtime/signal` endpoint. Add call-specific routing + ring timeout (30s).

**BFF**: Already has `realtime_signal_send`. Add call session state tracking in Rust.

**Frontend** (new module: `src/components/call/`):
- `CallManager.tsx` — singleton managing active call state
- `IncomingCallModal.tsx` — ringtone + accept/reject
- `CallScreen.tsx` — active call UI (timer, mute, speaker, video toggle, hangup)
- WebRTC `RTCPeerConnection` lifecycle: offer → answer → ICE → connected → hangup
- Audio/video stream from `navigator.mediaDevices`

**Deliverable**: User A calls User B; B sees incoming call UI; both connect with audio/video; either can hang up.

---

### F3: Group Admin

**Proto changes** (`model/domain/chat/group_chat.proto`):
```protobuf
message GroupAdminCommand {
  string group_ulid = 1;
  string target_actor_id = 2;
  AdminAction action = 3;
}

enum AdminAction {
  REMOVE_MEMBER = 0;
  MUTE_MEMBER = 1;
  UNMUTE_MEMBER = 2;
  PROMOTE_ADMIN = 3;
  DEMOTE_ADMIN = 4;
}
```

**Station** (`apps/station/app/subserver/group_chat/`):
- Add admin check: only creator/admin can execute
- Remove: delete membership row, broadcast `MemberRemovedEvent`
- Mute: set `muted_until` column, enforce in send-message gate
- Promote/demote: update `role` column

**BFF**: Add `group_chat_admin_command` Tauri command.

**Frontend**:
- Group member list: long-press member → admin actions dropdown
- Show role badges (owner/admin/member)
- Muted indicator for muted members

**Deliverable**: Group owner can remove, mute, or promote members.

---

### F4: Forward Message

**No proto changes needed** — forwarding = sending a copy to another conversation.

**Frontend only**:
- Long-press message → "Forward" action
- Conversation picker modal (select target DM or group)
- Call existing `sendFriendMessage` / `sendGroupMessage` with forwarded content + `forwarded_from` metadata

**Deliverable**: User can forward any message to another conversation.

---

### F5: Pin Messages

**Proto changes** (`model/domain/chat/group_chat.proto`):
```protobuf
// Add to ConversationCommand:
PinCommand pin_command = 10;

message PinCommand {
  string message_id = 1;
  bool unpin = 2;
}
```

**Station**: Store pinned_messages table. Return pinned list in group info query.

**Frontend**: Pin icon in message hover actions. Pinned messages section at top of chat.

**Deliverable**: Admin can pin/unpin messages; all members see pinned messages.

---

### F6: Disappearing Messages

**Proto changes**:
```protobuf
// In conversation settings:
message ConversationSettings {
  // ...existing fields...
  uint32 disappear_timer_seconds = 10;  // 0 = disabled
}
```

**Station**: Background worker that deletes messages older than `disappear_timer` per conversation.

**Frontend**: Settings toggle per conversation. Timer indicator on messages. Visual countdown.

**Deliverable**: Users can set auto-delete timer; messages disappear after timer expires.

---

### F7: Link Previews

**Station** (new service in frame):
- URL detection in message body (regex)
- Server-side OG metadata fetch (title, description, image)
- Cache results (avoid re-fetch)
- Return preview metadata alongside message

**Frontend**: Rich link card component below message with detected URL.

**Deliverable**: URLs in messages show title + thumbnail preview.

---

### F8: Contact Profile Sheet

**Frontend only** (data already available):
- Tap avatar anywhere in chat → slide-out panel
- Shows: avatar, display name, username, online status, shared groups, media gallery
- Actions: message, call, block

**Deliverable**: Tap any avatar → see profile + quick actions.

---

## 4. Dependency Graph & Execution Order

```
Independent (can parallelize):
  F1 Reactions ─────────┐
  F3 Group Admin ───────┤
  F4 Forward ───────────┤──→ can all start immediately
  F5 Pin ───────────────┤
  F8 Contact Sheet ─────┘

Sequential:
  F2 Calls ─── depends on: nothing, but large scope → dedicated sprint
  F6 Disappearing ─── depends on: nothing, but needs background worker design
  F7 Link Previews ─── depends on: nothing, but needs server-side HTTP fetch
```

**Recommended execution order:**
1. F1 (Reactions) — highest value, medium effort, unblocks engagement UX
2. F3 (Group Admin) — essential for real group management
3. F4 (Forward) — small, quick win
4. F5 (Pin) — small, quick win
5. F8 (Contact Sheet) — small, quick win
6. F6 (Disappearing) — medium, privacy feature
7. F7 (Link Previews) — medium, polish
8. F2 (Calls) — largest, dedicated sprint

---

## 5. Architecture Constraints

1. **Proto-first**: All new commands/events defined in `model/domain/` protos before implementation.
2. **Envelope-only delivery**: Reactions, pins, admin events — all delivered as encrypted envelope payloads. No side-channel.
3. **E2EE preserved**: Reaction content is encrypted. Server cannot see which emoji was used on which message.
4. **No new subservers**: All features build on existing conversation, envelope, events, presence, and OSS subservers.
5. **Federation-aware**: All features must work across federated stations.

---

## 6. Acceptance Test Design

### 6.1 Philosophy

**No browser snapshots.** All acceptance tests run as direct HTTP/proto calls.
Two test tiers cover the full chain:

```
┌─────────────────────────────────────────────────────────┐
│  Tier 2: BFF Gateway Tests (port 3030)                  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Tier 1: Station API Tests (port 18080)           │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │  Station subservers:                        │  │  │
│  │  │  social → conversation → envelope → events  │  │  │
│  │  │  notification → presence → OSS              │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

- **Tier 1** (Station direct): Proves server business logic chain.
- **Tier 2** (BFF gateway): Proves the full client→Station path.

Both tiers assert from the **receiver's perspective**.

### 6.2 Scenario Coverage

```
Legend:
  [S] = sender action
  [R] = receiver assertion (proves chain completed)
  [E] = envelope/delivery assertion
  [N] = notification assertion
  [P] = presence assertion
```

#### Scenario A: P2P DM (2 actors, full chain)

| ID | Test | Chain proven |
|----|------|-------------|
| A1 | Friend request → accept → DM auto-created | social → notification → conversation |
| A2 | Text message: A sends, B receives via envelope + list | friend-chat → envelope → storage |
| A3 | Image: A uploads + sends, B sees attachment | OSS → envelope → storage |
| A4 | File: same as A3 with PDF | OSS → envelope → storage |
| A5 | Emoji text: Unicode round-trip preserved | encoding correctness |
| A6 | Read receipt: B reads, A gets receipt envelope | conversation → envelope broadcast |
| A7 | Recall: A recalls, B sees recalled status | envelope → storage mutation |
| A8 | Presence: A heartbeat → B queries → online | presence subserver |
| A9 | Unread: 3 messages → count=3 → ack → count=0 | storage + ack |

#### Scenario B: Group Chat (3 actors, full chain)

| ID | Test | Chain proven |
|----|------|-------------|
| B1 | Group create: A creates, B+C see in list | conversation → membership |
| B2 | Group text: A sends, B+C both get envelope | envelope fan-out |
| B3 | Group media: attachment visible to all | OSS → fan-out |
| B4 | Member list: 3 members confirmed | membership query |
| B5 | Leave: C leaves → C no longer receives | membership → delivery severed |
| B6 | Unread: count + mark-read | storage chain |

#### Scenario C: Notifications

| ID | Test | Chain proven |
|----|------|-------------|
| C1 | Friend request notification appears | social → notification.Produce |
| C2 | Unread counts correct | notification counts |
| C3 | Mark-all-read zeros counts | notification mutation |

#### Scenario D: Error boundaries

| ID | Test | Chain proven |
|----|------|-------------|
| D1 | Send to non-friend | auth gate |
| D2 | Accept own request | ownership check |
| D3 | Request to self | self-guard |
| D4 | Post-leave group access | membership gate |

### 6.3 Test Credentials

```
POST /api/oauth/login {username: "a", password: "1"} → JWT_A
POST /api/oauth/login {username: "b", password: "1"} → JWT_B
POST /api/oauth/login {username: "c", password: "1"} → JWT_C
```

### 6.4 Exit Criteria

22 scenarios pass on both Tier 1 + Tier 2. Run time < 60s.

---

## 7. Per-Feature Deliverable Checklist

For EACH feature (F1–F8), delivery is complete when:

- [ ] Proto defined in `model/domain/`
- [ ] `./model/build.sh` regenerates without error
- [ ] Station handler + service implemented
- [ ] Station `go build ./...` passes
- [ ] BFF Tauri command added (+ HTTP gateway if applicable)
- [ ] BFF `cargo build` passes
- [ ] Frontend store action + event handler
- [ ] Frontend UI component
- [ ] `pnpm run check` passes (TypeScript)
- [ ] Acceptance test scenario added and passing
- [ ] Deployed to station-1, verified with two clients

---

## 8. Decision Log

| ID | Decision | Rationale |
|----|----------|-----------|
| D-MOD-01 | Reactions are E2EE (encrypted envelope) | Signal model — server cannot see reaction content |
| D-MOD-02 | Media uses OSS pre-signed URLs | Keeps envelope small; OSS handles storage |
| D-MOD-03 | Call signaling reuses existing `/realtime/signal` | No new infrastructure needed |
| D-MOD-04 | Group admin stored as `role` column | Simple, no new table needed |
| D-MOD-05 | Disappearing messages use server-side TTL worker | Client-only deletion is unreliable |
| D-MOD-06 | Link previews fetched server-side | Client-side fetch leaks user IP to link targets |

---

## 9. Dependencies

| Dependency | Status | Notes |
|-----------|--------|-------|
| OSS subserver | ✓ Exists | Used for media upload |
| Presence subserver | ✓ Exists | Heartbeat + query |
| WebRTC signaling | ✓ Exists | `/realtime/signal` endpoint |
| Conversation receipt | ✓ Exists | `POST /conversation/receipt` |
| Notification subserver | ✓ Exists | `Produce()` API |
| Envelope fan-out | ✓ Exists | Broadcasts to all members |
