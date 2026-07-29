# Friend Request Restoration — Execution Plan

> **Status**: approved
> **Created**: 2026-07-28
> **Owner**: Social Runtime
> **Branch**: `feat/group-detail-history-ux-pr` (peers-chat-high-chat worktree)
> **Scope**: `apps/station/app/subserver/social/`, `apps/desktop/src-tauri/src/interface/`, `apps/desktop/src/`

---

## 1. Problem

Commit `82cdb299` (Jul 12) removed `friend_chat` + `group_chat` subservers claiming "all messaging now routes through the envelope subserver." But:

- Envelope has no `FRIEND_REQUEST` payload type — it's a message transport layer, not a social-graph manager.
- No replacement handler for friend requests was built anywhere.
- The conversation subserver's `create_direct` gate requires mutual followers — so strangers have **no first-contact path**.
- The Desktop client's Rust BFF still calls `/friend-chat/friend-request/send` → 404.
- Proto definitions (`SendFriendRequestRequest`, `FriendRequest`, `FriendRequestStatus`) are intact.
- DB table `friend_chat_friend_requests` still exists and is still referenced by dashboard stats.

---

## 2. Architecture Decision

**Friend requests belong in the `social` subserver** (user decision, 2026-07-28).

The incomplete design (`20260604-social-chat-product-closure.md`) prescribed a separate `friend_chat` subserver, but that was deleted in `82cdb299` and we consolidate into `social` rather than restoring a standalone subserver. Rationale: social already owns follow/unfollow/block — friend request is the same relationship domain. Avoids re-introducing a subserver that was intentionally removed.

Flow after implementation:

```
User A "Send Request" → POST /api/v1/social/friend-request/send
  → social subserver creates pending request in friend_chat_friend_requests
  → emits notification (type=200)

User B "Accept" → POST /api/v1/social/friend-request/accept
  → social subserver marks accepted + creates mutual follow edges
  → now create_direct gate passes (mutual followers)
  → either party can start a direct conversation

User B "Reject" → POST /api/v1/social/friend-request/reject
  → social subserver marks rejected, no follow edges created
```

---

## 3. Implementation Steps

### Step 1: Station — Add friend request service to social subserver

Files to create/modify:
- `apps/station/app/subserver/social/application/friend_request_service.go`
- `apps/station/app/subserver/social/infrastructure/friend_request_repo.go`

Logic (port from old `friend_chat/application/service.go` at commit `82cdb299^`):
- `SendFriendRequest(senderID, receiverID, message)` — check self-send, check block, create pending request, emit notification
- `AcceptFriendRequest(actorID, requestID)` — validate receiver, mark accepted, **create mutual follow edges**, emit notification
- `RejectFriendRequest(actorID, requestID)` — validate receiver, mark rejected
- `ListFriendRequests(actorID, status, limit, offset)` — paginated query

Accept creates mutual follow: call existing `RelationshipService.Follow()` in both directions.

### Step 2: Station — Register HTTP handlers

File: `apps/station/app/subserver/social/handler.go`

Add routes:
```go
server.NewTypedHandler("social-friend-request-send", "/api/v1/social/friend-request/send", server.POST, s.handleSendFriendRequest, logID, s.jwtWrapper)
server.NewTypedHandler("social-friend-request-accept", "/api/v1/social/friend-request/accept", server.POST, s.handleAcceptFriendRequest, logID, s.jwtWrapper)
server.NewTypedHandler("social-friend-request-reject", "/api/v1/social/friend-request/reject", server.POST, s.handleRejectFriendRequest, logID, s.jwtWrapper)
server.NewTypedHandler("social-friend-request-list", "/api/v1/social/friend-requests", server.GET, s.handleListFriendRequests, logID, s.jwtWrapper)
```

Request/response types: use existing proto (`SendFriendRequestRequest`, etc.) from `model/domain/chat/friend_chat.proto`.

### Step 3: Desktop Rust BFF — Rewire endpoint

File: `apps/desktop/src-tauri/src/interface/tauri_commands/friend_chat.rs`

Change the station URL in `friend_chat_send_friend_request`:
- Old: `POST /friend-chat/friend-request/send`
- New: `POST /api/v1/social/friend-request/send`

Same for accept, reject, list:
- `/friend-chat/friend-request/accept` → `/api/v1/social/friend-request/accept`
- `/friend-chat/friend-request/reject` → `/api/v1/social/friend-request/reject`
- `/friend-chat/friend-requests` → `/api/v1/social/friend-requests`

Also update the HTTP gateway dispatch in `mod.rs` to match.

### Step 4: Desktop Rust BFF — Fix receiver_did vs actor_id

The search returns `actorId` (snowflake numeric ID like `"347818929214717955"`). The station's social subserver uses the same ID format for relationships. Verify the `SendFriendRequestRequest.receiver_did` field accepts this format (it does — the field is named `did` historically but contains the ptid/actor_id).

### Step 5: Deploy & verify

- Build station with new endpoints
- Deploy to station-three (`make station`)
- Test: Search user → Send Request → verify button changes to "Awaiting approval"
- Test: Login as receiver → List pending requests → Accept → verify mutual follow created
- Test: verify create_direct now works between the two users

---

## 4. What's Already Done (this session)

- Desktop UI: "Awaiting approval" button state + 5-minute cooldown (committed)
- Store: `loadFriendRequests` wired to actual API (committed)
- Build fixes: stale `models.rs` removed, `ServerManager.tsx` type fix

---

## 5. Open Questions

1. **ID format**: The proto field is named `receiver_did` but the system uses numeric ptid (e.g. `"347818929214717955"`). Should we rename the proto field to `receiver_ptid` for clarity, or keep backward compat?
2. **Accept = mutual follow**: Is this the correct semantic? Or should accept only create a one-way follow (requestee follows requester), requiring explicit follow-back?
3. **Notification delivery**: The old code used notification type 200. Is the notification subserver still wired to deliver these?

---

## 6. Exit Criteria

- `POST /api/v1/social/friend-request/send` returns 200 with `FriendRequest` payload
- Desktop "Send Request" shows "Awaiting approval" after success
- Accept creates relationship that satisfies `create_direct` gate
- Station tests cover send/accept/reject/list/block-guard paths
