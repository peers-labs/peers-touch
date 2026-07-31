# Debt-Zero: Full-Stack DM/Group Chat Unification

> **Status**: ready-for-execution
> **Created**: 2026-07-31
> **Supersedes**: `20260731-compat-chat-elimination.md` (was surface-only; this covers ALL layers)
> **Architecture source**: `docs/architecture/federated-im/proposals/compat-chat-elimination.md`
> **Branch**: `feat/debt-zero-chat` (from current HEAD)

---

## Problem Statement

The Station was migrated to a unified `conversation` model. **Nothing above it followed.** The result is a systemic DM-vs-group bifurcation at every layer:

```
Layer              Debt                                               LOC
─────────────────────────────────────────────────────────────────────────
Proto model        friend_chat.proto + group_chat.proto (separate     1223
                   message types with near-identical fields)
Station            compat_chat/ shim (43 routes, 10 stubs)           ~1300
BFF commands       friend_chat.rs + group_chat.rs (69 duplicated      2793
                   Tauri commands)
BFF storage        chat_storage.rs (35 dual-path HTTP functions)      1504
BFF local store    local_chat_store.rs (two ingest paths,             2059
                   duplicate group_messages table)
Frontend service   desktop_api.ts (66 doubled wrappers)              ~800 (chat portion)
Frontend store     socialChat.ts (kind='friend'|'group' branching,    2785
                   separate send/load/decode paths)
Frontend types     UnifiedConversation carries both FriendChatSession  —
                   AND Group as optional fields (union hack)
─────────────────────────────────────────────────────────────────────────
Total duplicated/dead code: ~12,400 LOC
Target state: ONE code path per operation, top to bottom.
```

---

## Iron Law Compliance & Transport Protocols

The Iron Law says: "Inter-app communication: protobuf only. JSON forbidden unless interfacing external systems."

This applies to **structured data** APIs. Three transport protocols exist in the system, each with correct usage:

```
Protocol 1 — Structured data (MUST be proto):
  Station ──[application/protobuf]──→ BFF ──[JSON]──→ Browser
  Examples: list conversations, list messages, submit command, read cursor,
            member settings, thread counts, unread, search, stats

Protocol 2 — Binary data (multipart/form-data or raw bytes):
  Station ←──[multipart/form-data]──── BFF (upload)
  Station ──[application/octet-stream]──→ BFF (download)
  Examples: file upload, image upload, attachment download, avatar upload
  Proto does NOT wrap binary payloads — the file IS the body.

Protocol 3 — Streaming (text/event-stream or WebSocket):
  Station ──[SSE / chunked]──→ BFF ──[Tauri event emit]──→ Browser
  Examples: envelope delivery, typing indicators, presence, realtime events
  Event payloads within the stream ARE proto-encoded (base64 in SSE data field).
```

**Rule**: Proto-first applies to Protocol 1 (all structured request/response APIs). Protocols 2 and 3 use their native transport but carry proto-encoded payloads where structured data exists within the stream/form.

The `station_client.rs` already implements all three:
- `request_peers_proto` / `request_proto` — Protocol 1
- `upload_multipart` — Protocol 2
- `request_json_response` (envelope resume) — currently JSON, should migrate to proto for the structured envelope list response

**Debt identified**: `envelope_submit`, `envelope_ack`, `envelope_resume` in `conversation.rs` currently use `request_json_auth` (JSON transport) instead of proto. These must be migrated to proto encoding as part of this plan.

---

**Data flow summary**:
- ALL proto messages defined in `model/domain/chat/` first. Generated to Go + Rust (prost).
- BFF→Browser: JSON via Tauri command return values (browser = external system boundary).
- File uploads: multipart/form-data (no proto wrapping of binary).
- Realtime events: SSE stream with proto-encoded payloads.

---

## Dependency Chain

```
P0: Proto — Define unified API messages in conversation_api.proto
 ↓
P1: Station — Fill gaps + fix handlers_unified.go to use proto types
 ↓
P2: BFF Unification — Replace friend_chat.rs + group_chat.rs + chat_storage.rs
    with ONE conversation.rs module calling /conversation/* (proto-encoded)
 ↓
P3: Frontend Unification — Single Tauri command set, single store path,
    single message type, no kind='friend'|'group' branching
 ↓
P4: Kill Shot — Delete ALL legacy code across every layer
```

---

## Phase 0: Proto Contracts

### P0.1 — Expand `conversation_api.proto`

`model/domain/chat/conversation_api.proto` already exists (176 lines). Expand it to cover ALL read/write operations the unified BFF needs:

```protobuf
// Additions to conversation_api.proto:

message ListConversationMessagesRequest {
  string conversation_id = 1;
  int64 after_seq = 2;
  int32 limit = 3;
}

message ListConversationMessagesResponse {
  repeated CommittedConversationEvent events = 1;
  bool has_more = 2;
}

message ListThreadMessagesRequest {
  string conversation_id = 1;
  string root_id = 2;
  int64 after_seq = 3;
  int32 limit = 4;
}

message GetThreadCountsRequest {
  string conversation_id = 1;
  repeated string root_ids = 2;
}

message ThreadCountEntry {
  string root_message_id = 1;
  int64 reply_count = 2;
  string latest_reply_id = 3;
  int64 latest_reply_at_ms = 4;
  int64 unread_count = 5;
}

message GetThreadCountsResponse {
  repeated ThreadCountEntry counts = 1;
}

message SetReadCursorRequest {
  string conversation_id = 1;
  int64 last_read_seq = 2;
}

message SetReadCursorResponse {
  bool success = 1;
}

message GetUnreadRequest {
  string conversation_id = 1;
}

message GetUnreadResponse {
  int64 unread_count = 1;
}

message MemberSettings {
  string nickname = 1;
  bool muted = 2;
  bool alert_enabled = 3;
  bool pinned = 4;
  string background = 5;
  int64 cleared_at_ms = 6;
}

message GetMemberSettingsRequest {
  string conversation_id = 1;
}

message GetMemberSettingsResponse {
  MemberSettings settings = 1;
}

message UpdateMemberSettingsRequest {
  string conversation_id = 1;
  MemberSettings settings = 2;
}

message UpdateMemberSettingsResponse {
  bool success = 1;
}

message SearchMessagesRequest {
  string conversation_id = 1;
  string query = 2;
  int32 limit = 3;
}

message SearchMessagesResponse {
  repeated CommittedConversationEvent events = 1;
  bool has_more = 2;
}

message GetConversationStatsRequest {
  string conversation_id = 1;
}

message GetConversationStatsResponse {
  int64 message_count = 1;
  int32 member_count = 2;
  int64 created_at_ms = 3;
  int64 last_activity_at_ms = 4;
}
```

### P0.2 — Generate

```bash
./model/build.sh
```

Produces Go types in `station/frame/touch/model/chat/` and Rust prost types for BFF.

### P0.3 — Replace Go Structs in handlers_unified.go

Replace all plain Go structs with generated proto types. `TypedHandler` auto-selects `ProtoSerializer` for proto.Message implementors.

**Gate**: `cd apps/station && go build ./app/...` + `cd apps/desktop/src-tauri && cargo check`

---

## Phase 1: Station Gaps

The conversation subserver already provides: create_direct, create_group, submit_command, receipt, list, get, members, events, messages, thread/messages, thread/counts, read-cursor, unread, member/settings (get/put).

Remaining gaps:

### P1.1 — Member Settings (full field coverage)

Verify `handleGetMemberSettings`/`handleUpdateMemberSettings` persist ALL fields from the proto `MemberSettings` message. If not, extend the DB column set on `conversation_members` or create `conversation_member_settings` table.

### P1.2 — Message Search

- Add `pg_trgm` index on extracted text from `conversation_events.payload`
- Add `SearchMessages` to Repository + Service
- Add `GET /conversation/messages/search` handler
- Response: `SearchMessagesResponse` proto

### P1.3 — Conversation Stats

- Add `GET /conversation/stats` handler
- Aggregate query: count events, count members, min/max timestamps

### P1.4 — Group Dissolve

- Add `DissolveCommand` to `ConversationCommand` oneof (or `dissolve` field on `LeaveCommand` for owner)
- Handler: verify owner, mark conversation dissolved, broadcast event

### P1.5 — Federated Member Add

- Add `POST /conversation/members/add` with federation credential check
- Or extend the existing `InviteCommand` to accept federated references

### Decisions (no new endpoints needed):

- **Offline messages**: DROPPED. Event log IS the offline queue (clients catch up via `after_seq`).
- **Pending messages**: Maps to `GET /conversation/messages?after_seq={read_cursor}`.
- **Message sync**: Maps to `GET /conversation/messages?after_seq=0&limit=500` (paginated).
- **Message ack**: Maps to `POST /conversation/receipt` (delivery type).

**Gate**: `cd apps/station && go build ./app/... && go test ./app/subserver/conversation/...`

---

## Phase 2: BFF Unification

This is the structural pivot. Replace the bifurcated BFF with ONE unified module.

### P2.1 — Create unified Tauri commands

Expand `apps/desktop/src-tauri/src/interface/tauri_commands/conversation.rs` to cover ALL operations. The command names become type-agnostic:

**Old (69 commands, two files)**:
- `friend_chat_list_sessions` + `group_chat_list_groups`
- `friend_chat_list_messages` + `group_chat_list_messages`
- `friend_chat_send_message` + `group_chat_send_message`
- `friend_chat_recall_message` + `group_chat_recall_message`
- ... (×35 pairs)

**New (unified commands in conversation.rs)**:
- `conversation_list` — already exists ✓
- `conversation_list_messages` — params: `{conversation_id, after_seq, limit}`
- `conversation_list_thread_messages` — params: `{conversation_id, root_id, after_seq}`
- `conversation_thread_counts` — params: `{conversation_id, root_ids}`
- `conversation_submit_command` — already exists ✓ (send, recall, edit, delete, invite, leave, dissolve, admin are all commands)
- `conversation_submit_receipt` — already exists ✓
- `conversation_set_read_cursor` — params: `{conversation_id, last_read_seq}`
- `conversation_get_unread` — params: `{conversation_id}`
- `conversation_get_member_settings` — params: `{conversation_id}`
- `conversation_update_member_settings` — params: `{conversation_id, settings}`
- `conversation_search_messages` — params: `{conversation_id, query, limit}`
- `conversation_get_stats` — params: `{conversation_id}`
- `conversation_create_direct` — already exists ✓
- `conversation_create_group` — already exists ✓
- `conversation_get_members` — already exists ✓
- `conversation_sync_from_station` — params: `{conversation_id, limit}`
- `conversation_local_search` — params: `{query, limit}` (searches local SQLite FTS)

Total: ~20 unified commands vs. 69 bifurcated ones.

**Transport**: All structured commands use `request_peers_proto` (Protocol 1). The existing `envelope_submit`/`envelope_ack`/`envelope_resume` commands currently using `request_json_auth` must be migrated to proto as part of this phase.

**Non-proto commands** (correct as-is, no change needed):
- `oss_upload_attachment_chat` / `oss_upload_attachment_bytes_chat` — Protocol 2 (multipart/form-data)
- `oss_capture_screenshot_chat` — local file operation, no Station call
- Realtime event stream — Protocol 3 (SSE with proto payloads)

### P2.2 — Unify chat_storage.rs

Replace ALL 35 dual-path functions with unified functions that call `/conversation/*` endpoints. The response is decoded via prost from the proto types defined in P0.

Each function:
1. Builds the proto request
2. Calls Station with `Content-Type: application/protobuf`
3. Decodes proto response via prost
4. Projects to JSON for Tauri command return

Delete all `friend_chat_message_to_json`, `group_message_to_json`, `friend_chat_session_to_json` etc. — replaced by ONE `conversation_event_to_json` projector.

### P2.3 — Unify local_chat_store.rs

- Delete `ingest_group_payload` — merge into `upsert_plaintext_records` (already type-agnostic by `conversation_id`)
- Delete `group_messages` table — unified `chat_messages` table already stores both
- Single ingest path: `ingest_conversation_event(user_scope, conversation_id, event_json)`

### P2.4 — Register new commands in main.rs

Add new unified commands to Tauri's `invoke_handler!`. Keep old commands temporarily (frontend still calls them).

**Gate**: `cd apps/desktop/src-tauri && cargo check` — compiles with both old + new commands available.

---

## Phase 3: Frontend Unification

### P3.1 — Unified Service Layer

In `desktop_api.ts`, add new unified functions:

```typescript
// New unified API surface
api.conversationList(limit, offset)                    // replaces friendChatListSessions + groupChatListGroups
api.conversationListMessages(conversationId, afterSeq) // replaces friendChatListMessages + groupChatListMessages
api.conversationListThreadMessages(...)                // replaces both thread message functions
api.conversationThreadCounts(...)                      // replaces both
api.conversationSetReadCursor(...)                     // replaces groupChatMarkRead + friend ack
api.conversationGetUnread(...)                         // replaces groupChatUnreadCount
api.conversationGetMemberSettings(...)                 // replaces groupChatGetSettings + friendChatGetSettings
api.conversationUpdateMemberSettings(...)              // replaces both update settings
api.conversationSearchMessages(...)                    // replaces both search
api.conversationSyncFromStation(...)                   // replaces both sync
```

Each calls the new unified Tauri command from P2.

### P3.2 — Unified Store

In `socialChat.ts`:

- **Delete** `loadGroups()` — merged into `loadSessions()` which calls `conversation_list` (returns all conversations: DM + group)
- **Delete** `sendFriendMessage` + `sendGroupMessage` — replace with single `sendMessage(conversationId, content, ...)` that calls `conversation_submit_command`
- **Delete** `kind?: 'friend' | 'group'` parameter from `loadMessages`, `loadThreadMessages`, `refreshThreadCounts`, `markThreadRead`, `deleteMessage`
- **Delete** `activeTab: 'friend' | 'group'` state — replaced by conversation `type` field on each session
- **Delete** `decodeFriendMessages` / `decodeGroupMessages` bifurcation — single `decodeConversationEvents` path
- **Delete** `recallFriendMessage` / `recallGroupMessage` — single `recallMessage(conversationId, messageId)`
- **Replace** `UnifiedConversation` type — remove `friendSession?: FriendChatSession` and `group?: Group`, use `Conversation` proto type directly with `type: 'direct' | 'group'`

### P3.3 — Unified Types

Delete imports of:
- `FriendChatMessage`, `FriendChatSession`, `FriendMessageType`, `FriendMessageStatus` from `friend_chat_pb.ts`
- `GroupMessage`, `Group`, `GroupMember` from `group_chat_pb.ts`

Replace with:
- `Conversation`, `ConversationMember`, `CommittedConversationEvent` from `conversation_pb.ts`
- Single `ChatMessage` projection type derived from events

### P3.4 — Component Cleanup

Remove `kind` prop threading through:
- `ChatMessageArea` → `ChatMessageTimeline` → `ChatMessageRow`
- `ChatThreadPanel`
- `ChatDetailPanel`
- `ChatSessionList`

The conversation object carries its own `type` field — components read it from context, not props.

**Gate**: `cd apps/desktop && pnpm run check` — zero TypeScript errors.

**E2E Gate**: Two-worktree verification:
- DM: create, send, receive, thread, unread, search, settings
- Group: create, invite, send, receive, thread, unread, search, settings, admin, leave

---

## Phase 4: Kill Shot

### P4.1 — Delete Station compat_chat

```bash
rm -rf apps/station/app/subserver/compat_chat/
```

Remove registration from Station's subserver init.

### P4.2 — Delete BFF legacy files

```bash
rm apps/desktop/src-tauri/src/interface/tauri_commands/friend_chat.rs
rm apps/desktop/src-tauri/src/interface/tauri_commands/group_chat.rs
```

Remove from `mod.rs` and `main.rs` invoke_handler.

### P4.3 — Delete BFF dead code in chat_storage.rs

- Remove ALL old functions (`list_friend_sessions`, `list_friend_messages`, `send_friend_message`, `list_groups`, `list_group_messages`, etc.)
- Remove ALL old `*_to_json` converters for legacy types
- Remove `#![allow(dead_code)]`
- File should shrink from 1504 lines to ~400 (unified functions only)

### P4.4 — Delete local_chat_store.rs dead paths

- Remove `ingest_friend_payload`, `ingest_group_payload`
- Remove `group_messages` table creation + any functions that reference it
- Keep only `chat_messages` table + unified ingest

### P4.5 — Delete frontend legacy wrappers

In `desktop_api.ts`:
- Remove all `friendChat*` functions (23 functions)
- Remove all `groupChat*` functions (29 functions)
- Remove imports from `friend_chat_pb.ts` / `group_chat_pb.ts`

### P4.6 — Delete generated proto TS files (if fully unused)

If `friend_chat_pb.ts` and `group_chat_pb.ts` have zero remaining imports:
```bash
rm apps/desktop/src/gen/proto/domain/chat/friend_chat_pb.ts
rm apps/desktop/src/gen/proto/domain/chat/group_chat_pb.ts
```

Note: the `.proto` source files (`friend_chat.proto`, `group_chat.proto`) stay in `model/domain/chat/` — they still define wire formats for the E2EE envelope schema (`EncryptedMessage`, `ChatEncryptedMessagePayload`). But the RPC request/response types in them are dead.

### P4.7 — Proto field cleanup

In `group_chat.proto`:
- `GroupMessage.content` (field 5): `reserved 5;`
- `SendGroupMessageRequest.content` (field 3): `reserved 3;`
- `GroupMessageAttachment` fields 7–13: `reserved 7 to 13;`

Regenerate: `./model/build.sh`

### P4.8 — Move link_preview_handler

Move `compat_chat/link_preview_handler.go` → `conversation/handlers_link_preview.go` and register as `/conversation/link-preview`.

**Final Gate**:
- `cd apps/station && go build ./app/...` — no errors
- `cd apps/desktop/src-tauri && cargo check` — clean, no `#![allow(dead_code)]`
- `cd apps/desktop && pnpm run check` — clean
- `find . -path "*compat_chat*"` → empty
- `grep -rn "friend.chat\|group.chat" apps/station/ apps/desktop/src-tauri/src/ apps/desktop/src/services/ apps/desktop/src/store/` → zero hits except test fixtures
- `grep -rn "friend_chat_pb\|group_chat_pb" apps/desktop/src/` → zero hits
- Two-worktree full E2E pass

---

## Effort Estimate

- **Phase 0**: ~100 LOC proto + generation
- **Phase 1**: ~200 LOC Go (search, dissolve, federated add)
- **Phase 2**: ~600 LOC new Rust (unified commands + storage, built alongside old)
- **Phase 3**: ~500 LOC new TS (unified service + store rewrite)
- **Phase 4**: **−8000 LOC** deleted (compat_chat 1300 + friend_chat.rs 1308 + group_chat.rs 1485 + chat_storage.rs dead functions ~800 + local_chat_store dead paths ~300 + desktop_api.ts dead wrappers ~800 + socialChat.ts dead branches ~500 + generated pb.ts ~500)

**Net delta: approximately −6600 LOC.** The codebase loses half its chat code and gains a single unified path.

---

## Data Flow: Before vs After

**Before** (current — bifurcated):
```
                    ┌─ friend_chat.proto ─── compat_chat ─── friend_chat.rs ─── friendChat* API ─── store (friend branch)
Browser ← JSON ← BFF                                                                                       
                    └─ group_chat.proto ──── compat_chat ─── group_chat.rs ──── groupChat* API ──── store (group branch)
```

**After** (debt-zero — unified):
```
Browser ← JSON ← BFF ← proto ← conversation.rs ← /conversation/* ← conversation subserver
                         │
                    conversation_api.proto (single contract)
```

One proto schema. One Station subserver. One BFF module. One service layer. One store path. One component interface.

---

## Sequencing & Parallelism

- P0 + P1 can overlap (proto gen + Station gaps are independent Go work)
- P2 must follow P0 (needs prost types)
- P3 must follow P2 (needs unified Tauri commands available)
- P4 must follow P3's E2E gate (ensures zero remaining callers of old code)

Old and new commands coexist during P2→P3 transition (backwards compatible — frontend migrates one action at a time). P4 is the atomic deletion once all callers are migrated.

Estimated: 3–4 focused sessions.
