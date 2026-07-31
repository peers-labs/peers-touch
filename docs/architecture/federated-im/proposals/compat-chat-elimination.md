# Architecture Proposal: Eliminate compat_chat Adapter Layer

> **Status**: draft
> **Created**: 2026-07-30
> **Scope**: Station chat data path — reads & writes
> **Goal**: Single canonical API surface for all chat operations. No translation layer. Indexed queries for all read patterns.
> **Reference platforms**: Signal, Matrix (Synapse), Discord, Telegram, Slack

---

## 0. Industry Reference Analysis

### How modern IM platforms architect their server-side chat layer

| Decision | Signal | Matrix | Discord | Telegram | Slack | **Peers-Touch (current)** | **Peers-Touch (target)** |
|----------|--------|--------|---------|----------|-------|--------------------------|--------------------------|
| **Storage model** | Transient per-device queue (delete after delivery) | Event-sourced append-only DAG | Mutable wide-column (ScyllaDB) | Shared append-only log per chat | Mutable relational (Vitess/MySQL) | Event-sourced (conversation_events) | Keep — correct for federation |
| **API surface** | Per-device envelope delivery | Unified room-based (`/rooms/{id}/send`) | Unified channel (`/channels/{id}/messages`) | Unified chat_id | Unified channel (`chat.postMessage`) | Split: 43 legacy routes + 16 conversation routes | Unified `/conversation/*` |
| **Thread model** | None | Event relation field + `/relations` endpoint | Threads ARE channels (full partition isolation) | Field on message (`reply_to_msg_id`) | Field on message (`thread_ts`) + denormalized counters | Field on event (`thread_root_message_id`) + full scan | Field on event + indexed query + denormalized counters |
| **Read cursors** | None (client-side, E2EE) | Server-side per-user per-room | Server-side per-user per-channel | Server-side `read_inbox_max_id` | Server-side per-channel mark | STUB (returns 0) | Server-side per-user per-conversation |
| **Unread count** | None | `unread_notifications` computed from cursor | Delta from last ACK message ID | `messages.id > read_inbox_max_id` count | Delta from mark timestamp | STUB (returns 0) | Delta from read cursor seq |
| **Real-time** | WebSocket + Redis pub/sub | Long-poll `/sync` + federation push | WebSocket Gateway + channel servers | Persistent TCP + shared-log pull | WebSocket + Flannel edge cache | SSE event stream | Keep SSE — correct for our scale |
| **E2EE storage** | Same table (ciphertext in Envelope proto blob) | Same table (`event_json` with encrypted content) | N/A (no E2EE) | Separate (Secret Chat relay) | N/A | **Separate** (envelope subsystem) | Merge: ciphertext as event payload field |
| **Message ID** | Server timestamp + UUID | Event ID (opaque string) | Snowflake (time-ordered 64-bit) | Incremental per-chat | Floating-point timestamp | ULID (time-ordered) | Keep ULID — already correct |

### Key validations and corrections from industry

**Validated decisions:**
- Event-sourcing (append-only log) ✓ — Matrix uses the same pattern for federation
- ULID message IDs ✓ — time-ordered like Discord Snowflake
- Unified conversation abstraction ✓ — ALL platforms converge here
- Field-on-message threading ✓ — Slack/Telegram approach, appropriate for our scale

**Corrections needed:**
1. **Split API surface → Unified** (all 5 platforms use a single set of endpoints regardless of DM/group/channel type)
2. **No server-side read cursors → Add them** (Discord, Telegram, Slack, Matrix all maintain server-side read position)
3. **Full event scans for threads → Indexed query** (Slack uses WHERE clause on same table; Matrix has `event_relations` table)
4. **Separate envelope storage for E2EE → Merge into event payload** (Signal and Matrix both store ciphertext in the same message record, not a separate system)
5. **Denormalized thread counters → Add** (Slack stores `reply_count`, `reply_users[]`, `latest_reply` directly on root message for O(1) reads)

### Architecture pattern selection

We select the **Matrix + Slack hybrid**:
- From **Matrix**: event-sourced append-only storage, unified room model, federation-compatible
- From **Slack**: field-on-message threading with denormalized counters (simpler than Matrix's DAG relations)
- From **Discord**: read cursor as last-acknowledged message ID (not sequence number)
- From **Signal**: E2EE payload stored in same record as message metadata (not separate table)

---

## 1. Problem Statement (verified_fact)

The `compat_chat` subserver is a **translation layer** between legacy HTTP routes (`/friend-chat/*`, `/group-chat/*`) and the conversation subserver's domain model. It was introduced as a bridge during migration but is now the **only** data path for all chat reads.

**Verified costs:**
- **In-memory full scans**: Thread messages fetch 500 events then filter. Thread counts fetch 1000 events then aggregate. This is O(n) per request, not O(1).
- **Proto translation overhead**: Every read converts `CommittedConversationEvent` → legacy `FriendChatMessage`/`GroupMessage` protos. Every write converts legacy request → `ConversationCommand`.
- **Dual API surface**: 43 compat_chat routes + 16 conversation routes = 59 total routes. BFF must know which path to call for each operation.
- **10 stub routes**: Endpoints that return hardcoded values or no-ops, masking missing functionality.
- **No separation**: The adapter mixes pass-through writes, proto translation reads, envService calls, and standalone features (link preview) in one package.

---

## 2. Evidence Ledger

| # | Claim | Class | Evidence | Confidence |
|---|-------|-------|----------|------------|
| E1 | compat_chat calls convService for ALL reads/writes | verified_fact | Code audit: every handler delegates to Service.ListEvents, SubmitCommand, GetMembers, etc. | High |
| E2 | Thread queries do full event scans | verified_fact | `handleGroupThreadMessages` calls `ListEvents(ctx, id, 0, 500)` and filters in-memory | High |
| E3 | ListMessages also scans all events | verified_fact | `handleGroupListMessages` calls `ListEvents(ctx, id, 0, limit)` without thread filtering | High |
| E4 | Repository has indexed `ListEvents(conversationID, afterSeq, limit)` | verified_fact | PostgreSQL index `idx_event_conv_seq` on `(conversation_id, group_seq)` | High |
| E5 | No indexed query exists for `thread_root_message_id` | verified_fact | Column exists in events table but no WHERE clause or index for it | High |
| E6 | BFF already calls `/conversation/command` directly for sends | verified_fact | `imServiceV1.conversation.submitCommand` in frontend | High |
| E7 | 10 routes are stubs returning hardcoded values | verified_fact | Code audit: settings, stats, unread, search, offline all return empty/fixed | High |
| E8 | envService (envelope) is a separate concern from conversation | verified_fact | Ack, Pending, SKDM routes call envService, not convService | High |

---

## 3. Scope

### In scope
- All chat read/write operations currently routed through compat_chat
- Repository-level indexed queries for thread, search, and read-cursor patterns
- Unified API contract that both BFF and conversation subserver expose
- Deletion of the compat_chat package

### Out of scope
- E2EE/MLS infrastructure (already on conversation subserver directly)
- Envelope subsystem (separate concerns — retains its own routes)
- Link preview (standalone utility — will move to its own handler)
- Client-side store refactoring (client already uses proto-first contract)

### Target deletions
- `apps/station/app/subserver/compat_chat/` — entire package deleted
- All `/friend-chat/*` and `/group-chat/*` routes removed from Station
- BFF Rust code that calls these legacy paths — rewired to conversation API

### Retained
- Conversation subserver (`/conversation/*`) — becomes the single API surface
- Envelope subserver (`/envelope/*`) — retains delivery ack, offline queue drain, push routing (delivery concern, NOT message storage)
- Link preview handler — moves to a standalone utility route

### Future (phase 2, not this design)
- Merge envelope ciphertext into conversation event payload (per Signal/Matrix pattern). Currently the envelope stores per-device encrypted copies separately. This is a larger E2EE architecture change — record it as a follow-up, not a blocker.

---

## 4. Source of Truth & Ownership

| Domain | Source of truth | Owner |
|--------|----------------|-------|
| Conversation state | `conversations` + `conversation_members` tables | Conversation subserver |
| Message history | `conversation_events` table (append-only event log) | Conversation subserver |
| Thread structure | `thread_root_message_id` field on events + denormalized counters | Conversation subserver |
| Read cursors | New: `conversation_read_cursors` table | Conversation subserver |
| Delivery/offline routing | Envelope subsystem tables | Envelope subserver (delivery, not content) |
| Message encryption | Ciphertext in `encrypted_payload` field of event | Client-side (E2EE) |
| Thread counters | Denormalized on root event row (Slack pattern) | Conversation subserver |

---

## 5. Target API Surface

The conversation subserver becomes the **sole** Station API for chat. New routes extend it:

### New routes required (beyond existing 16)

| Method | Path | Purpose | Replaces |
|--------|------|---------|----------|
| GET | `/conversation/messages` | List messages (with afterSeq, limit, kind filter) | `/friend-chat/messages`, `/group-chat/messages` |
| GET | `/conversation/thread/messages` | List thread replies (indexed by root_id) | `/group-chat/thread/messages` |
| POST | `/conversation/thread/counts` | Batch thread reply counts | `/group-chat/thread/counts` |
| POST | `/conversation/read-cursor` | Update read position | `/group-chat/mark-read` |
| GET | `/conversation/unread` | Get unread counts per conversation | `/group-chat/unread-count` |
| PUT | `/conversation/member/settings` | Update member mute/nickname | `/group-chat/my-settings`, `/group-chat/member/nickname` |
| GET | `/conversation/member/settings` | Get member settings | `/group-chat/my-settings` |
| GET | `/conversation/search` | Full-text message search (future) | `/group-chat/messages/search` |

### Existing routes retained as-is

| Path | Purpose |
|------|---------|
| `/conversation/direct` | Create DM |
| `/conversation/group` | Create group |
| `/conversation/command` | Submit any command (send, recall, edit, leave, dissolve, admin, etc.) |
| `/conversation/receipt` | Delivery/read receipts |
| `/conversation/get` | Get conversation metadata |
| `/conversation/list` | List conversations for actor |
| `/conversation/members` | Get conversation members |
| `/conversation/events` | Raw event stream (low-level, used by realtime) |

---

## 6. Repository Additions (indexed queries)

```go
// Add to Repository interface:

// ListMessageEvents returns only MessageCommitted events, ordered by seq.
// Uses index: idx_event_conv_seq + WHERE payload_type = 'message_committed'
ListMessageEvents(ctx context.Context, conversationID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error)

// ListThreadEvents returns MessageCommitted events for a specific thread root.
// Uses new index: idx_event_thread_root ON conversation_events(conversation_id, thread_root_message_id, group_seq)
ListThreadEvents(ctx context.Context, conversationID, threadRootID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error)

// CountThreadReplies returns reply count per root ID in a single query.
// Uses: GROUP BY thread_root_message_id WHERE conversation_id = ? AND thread_root_message_id IN (?)
CountThreadReplies(ctx context.Context, conversationID string, rootIDs []string) (map[string]int64, error)

// GetReadCursor returns the last-read event seq for an actor in a conversation.
GetReadCursor(ctx context.Context, conversationID, ptid string) (int64, error)

// SetReadCursor upserts the read position.
SetReadCursor(ctx context.Context, conversationID, ptid string, seq int64) error

// CountUnread returns events after the read cursor for an actor.
CountUnread(ctx context.Context, conversationID, ptid string) (int64, error)

// UpdateThreadCounter increments reply_count on root event and updates latest_reply fields.
// Denormalized counter pattern (Slack): O(1) read for thread summary.
UpdateThreadCounter(ctx context.Context, conversationID, rootMessageID, latestReplyID string, latestReplyAt time.Time) error

// GetThreadSummaries returns denormalized thread info for multiple roots in one query.
GetThreadSummaries(ctx context.Context, conversationID string, rootIDs []string) (map[string]*ThreadSummary, error)
```

```go
// ThreadSummary — denormalized counters per thread root (Slack pattern)
type ThreadSummary struct {
    RootMessageID   string
    ReplyCount      int64
    LatestReplyID   string
    LatestReplyAtMs int64
}
```

### Database migrations

```sql
-- Index for thread queries (partial — only events that are thread replies)
CREATE INDEX idx_event_thread_root 
ON conversation_events(conversation_id, thread_root_message_id, group_seq)
WHERE thread_root_message_id != '';

-- Read cursor table (Discord/Telegram pattern)
CREATE TABLE conversation_read_cursors (
  conversation_id TEXT NOT NULL,
  ptid TEXT NOT NULL,
  last_read_seq BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, ptid)
);

-- Thread counters table (Slack denormalized pattern — O(1) read for thread summary)
CREATE TABLE conversation_thread_counters (
  conversation_id TEXT NOT NULL,
  root_message_id TEXT NOT NULL,
  reply_count BIGINT NOT NULL DEFAULT 0,
  latest_reply_id TEXT NOT NULL DEFAULT '',
  latest_reply_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, root_message_id)
);
```

---

## 7. BFF Rewire

The Rust BFF HTTP gateway currently calls legacy paths. Rewire:

| BFF command | Current target | New target |
|-------------|---------------|------------|
| `friend_chat_list_messages` | `GET /friend-chat/messages` | `GET /conversation/messages?id=X&limit=Y` |
| `group_chat_list_messages` | `GET /group-chat/messages` | `GET /conversation/messages?id=X&limit=Y` |
| `group_chat_thread_counts` | `POST /group-chat/thread/counts` | `POST /conversation/thread/counts` |
| `group_chat_list_thread_messages` | `GET /group-chat/thread/messages` | `GET /conversation/thread/messages` |
| `friend_chat_list_sessions` | `GET /friend-chat/sessions` | `GET /conversation/list` (client filters by kind) |
| `group_chat_list` | `GET /group-chat/list` | `GET /conversation/list` (client filters by kind) |
| `group_chat_info` | `GET /group-chat/info` | `GET /conversation/get` + `GET /conversation/members` |
| `group_chat_unread_count` | `GET /group-chat/unread-count` | `GET /conversation/unread` |
| `group_chat_mark_read` | `POST /group-chat/mark-read` | `POST /conversation/read-cursor` |

Write commands already use `/conversation/command` — no change needed.

---

## 8. Contracts

### `/conversation/messages` response

Returns `CommittedConversationEvent[]` directly (no proto translation). The client already has `decodeGroupMessage` / `decodeFriendMessage` that parse `MessageCommitted` payloads from events. The compat_chat translation to `FriendChatMessage`/`GroupMessage` protos becomes unnecessary — the client will consume events natively.

### Thread contract

```
GET /conversation/thread/messages?conversation_id=X&root_id=Y&after_seq=0&limit=50
Response: { events: CommittedConversationEvent[], has_more: bool }

POST /conversation/thread/counts
Body: { conversation_id: string, root_ids: string[] }
Response: { counts: [{ root_id: string, reply_count: int, latest_seq: int, latest_at_ms: int }] }
```

### Read cursor contract

```
POST /conversation/read-cursor
Body: { conversation_id: string, last_read_seq: int }

GET /conversation/unread?conversation_id=X
Response: { unread_count: int }
```

---

## 9. Decisions

### D1: Delete compat_chat entirely (not deprecate)

**Rationale**: A deprecated adapter still requires maintenance and testing. No client should call legacy paths after migration. Hard-delete prevents drift.

**Consequence**: Any external client calling `/friend-chat/*` or `/group-chat/*` will get 404. Acceptable because only our BFF calls Station APIs.

**Reversal trigger**: If federation peers call these endpoints directly (they don't today — federation uses conversation APIs).

### D2: Client consumes `CommittedConversationEvent` directly

**Rationale**: The compat_chat proto translation (Event → FriendChatMessage/GroupMessage) exists only to serve the legacy client interface. Since the client already has decode functions that parse encrypted payloads from event fields, it can consume events directly.

**Consequence**: Client code must parse `sender_ptid`, `encrypted_payload`, `content_type`, `thread_root_message_id` from the event's `MessageCommitted` payload instead of pre-translated top-level fields.

**Alternative rejected**: Keep the translation in a shared utility. Rejected because it adds an unnecessary data-mapping layer that masks the real data model.

### D3: Indexed thread queries at repository level

**Rationale**: Full event scans are O(n) per request. For a conversation with 10K messages, every thread panel open does a full scan. Adding a partial index on `thread_root_message_id` makes thread queries O(log n).

**Consequence**: One DB migration required. Index write cost is negligible (only applied to events with non-empty thread_root_message_id).

---

## 10. Quality Gates

| Gate | Evidence required |
|------|-------------------|
| All existing BFF commands return equivalent data after rewire | Diff test: call old path vs new path, compare JSON output for same inputs |
| Thread query is O(log n) not O(n) | `EXPLAIN ANALYZE` on thread query shows index scan |
| No compat_chat code remains | `find . -path "*compat_chat*"` returns empty |
| Two-worktree E2E passes | DM send/receive, group create/send/receive, thread reply/count, read cursor |

---

## 11. Migration Safety

The rewire is **not** a flag-flip. Execution order:

1. Add new Repository methods + DB migration (additive, no breakage)
2. Add new conversation subserver routes (additive, no breakage)
3. Rewire BFF commands one-by-one to new endpoints (each testable independently)
4. Verify all BFF commands produce correct responses
5. Delete compat_chat package + remove old routes

At no point are two paths active for the same operation. Each step is independently verifiable.

---

## Status: DESIGN_READY_FOR_REVIEW

Pending your acceptance to proceed with `pt-architecture-execution-methodology`.
