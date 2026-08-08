# Message Search Architecture

> Full-text message search for Peers-Touch chat with user isolation and E2E encryption compatibility.
> Defines search model, indexing strategy, user isolation, encryption interaction, and implementation plan per layer.

---

## 1. Document Scope

This document defines:

- Search architecture and query model
- Client-side search (SQLCipher FTS5) — primary path for E2E messages
- Server-side search (PostgreSQL FTS) — for metadata and pre-E2E content
- User isolation model at each layer
- Interaction with E2E encryption
- Implementation plan per layer (Station Go, Desktop Rust, Desktop TS)
- Future: Searchable Symmetric Encryption (SSE)

This document does not define:

- E2E encryption protocol details (see `encryption/README.md`)
- Global/public search (actor discovery, group discovery) — separate concern
- AI agent message search (separate subserver, existing implementation)

---

## 2. Problem Statement

### 2.1 Current State

| Layer | Search Capability | Issues |
|-------|------------------|--------|
| Station group_chat | `LIKE '%query%'` on PostgreSQL | No index, O(n) scan, no relevance ranking |
| Station friend_chat | **None** | No search endpoint exists |
| Station frame | Stubbed `HandleSearchMessages` (returns empty) | Not implemented |
| Desktop Rust | SQLCipher FTS5 on `chat_messages_fts` | Exists but **not wired** to TS UI |
| Desktop TS | No search UI for messages | — |

### 2.2 Design Goals

1. **User-isolated**: A user can only search their own messages. No data leaks across users.
2. **E2E compatible**: When E2E encryption is enabled, search works on the client using locally decrypted content.
3. **Fast**: Sub-second results for typical message volumes (< 100K messages per conversation).
4. **Multi-scope**: Search within a conversation, across all conversations, or by conversation type.
5. **Rich results**: Return message with context (conversation name, sender, timestamp, surrounding messages).

---

## 3. Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│  Search Query Flow                                         │
│                                                            │
│  ┌─────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │ User    │───>│ Search UI    │───>│ Search Router    │  │
│  │ types   │    │ (TS)         │    │ (TS store)       │  │
│  │ query   │    └──────────────┘    └────────┬─────────┘  │
│  └─────────┘                                 │             │
│                                    ┌─────────┴──────────┐  │
│                                    │                     │  │
│                              ┌─────▼─────┐    ┌─────────▼┐ │
│                              │ Local      │    │ Remote   │ │
│                              │ Search     │    │ Search   │ │
│                              │ (FTS5)     │    │ (Station)│ │
│                              │            │    │          │ │
│                              │ Decrypted  │    │ Pre-E2E  │ │
│                              │ messages   │    │ or meta  │ │
│                              └────────────┘    └──────────┘ │
│                                    │                 │      │
│                                    └────────┬────────┘      │
│                                             │               │
│                                    ┌────────▼────────┐      │
│                                    │ Merge & Rank    │      │
│                                    │ Deduplicate     │      │
│                                    └────────┬────────┘      │
│                                             │               │
│                                    ┌────────▼────────┐      │
│                                    │ Search Results  │      │
│                                    │ UI              │      │
│                                    └─────────────────┘      │
└────────────────────────────────────────────────────────────┘
```

### 3.1 Dual Search Model

| Mode | Source | When Used | Content Access |
|------|--------|-----------|---------------|
| **Local-first** | Desktop SQLCipher + FTS5 | E2E conversations; offline; default | Full plaintext (decrypted locally) |
| **Remote fallback** | Station PostgreSQL FTS | Pre-E2E messages not yet synced locally; metadata search | Plaintext (pre-E2E) or metadata only (post-E2E) |

**Post-E2E world**: Remote search is metadata-only (sender, timestamp, conversation ID). Content search is exclusively local.

---

## 4. User Isolation

### 4.1 Isolation Model

User isolation is enforced at **every layer** through different mechanisms:

```
┌─────────────────────────────────────────────┐
│  Layer              Isolation Mechanism      │
├─────────────────────────────────────────────┤
│  Station API        JWT subject = actor_did  │
│                     Every query scoped by    │
│                     participant/member check │
├─────────────────────────────────────────────┤
│  Station DB         WHERE clauses include    │
│                     actor_did from JWT       │
│                     No cross-user joins      │
├─────────────────────────────────────────────┤
│  Desktop Local DB   Physical file isolation  │
│                     data/db/users/<scope>/   │
│                     SQLCipher per user        │
├─────────────────────────────────────────────┤
│  Desktop FTS5       Index scoped by          │
│                     user_scope column        │
│                     Query always includes    │
│                     WHERE scope = ?          │
└─────────────────────────────────────────────┘
```

### 4.2 Station-Side Isolation Rules

**friend_chat search:**
```sql
-- User can only search sessions they participate in
SELECT m.* FROM friend_messages m
JOIN friend_sessions s ON m.session_ulid = s.ulid
WHERE (s.participant_a_did = $actor_did OR s.participant_b_did = $actor_did)
  AND to_tsvector('simple', m.content) @@ plainto_tsquery('simple', $query)
ORDER BY ts_rank(to_tsvector('simple', m.content), plainto_tsquery('simple', $query)) DESC
LIMIT $limit;
```

**group_chat search:**
```sql
-- User can only search groups they are a member of
SELECT m.* FROM group_messages m
JOIN group_members mem ON m.group_ulid = mem.group_ulid
WHERE mem.actor_did = $actor_did
  AND to_tsvector('simple', m.content) @@ plainto_tsquery('simple', $query)
ORDER BY ts_rank(to_tsvector('simple', m.content), plainto_tsquery('simple', $query)) DESC
LIMIT $limit;
```

### 4.3 Desktop-Side Isolation Rules

- Each user's data lives in `data/db/users/<actor_id>/chat.main.db`
- The SQLCipher key is unique per user (stored in OS keyring with user-scoped key_ref)
- FTS5 queries always include `WHERE scope = ?` (scope = `friend:<session_ulid>` or `group:<group_ulid>`)
- No cross-user search is physically possible (separate encrypted databases)

---

## 5. Server-Side Search (Station Go)

### 5.1 PostgreSQL FTS Setup

**Migration for friend_chat messages:**

```sql
-- Add tsvector column with GIN index
ALTER TABLE friend_message_models
  ADD COLUMN content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED;

CREATE INDEX idx_friend_messages_fts ON friend_message_models USING GIN (content_tsv);
```

**Migration for group messages:**

```sql
ALTER TABLE group_message_models
  ADD COLUMN content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED;

CREATE INDEX idx_group_messages_fts ON group_message_models USING GIN (content_tsv);
```

**Language configuration**: Use `'simple'` config for language-agnostic tokenization (supports English, Chinese, etc. without stemming). For CJK-specific tokenization, add `pg_bigm` or `zhparser` extension later.

### 5.2 Friend Chat Search Endpoint

**New handler in `friend_chat/handler.go`:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/friend-chat/messages/search` | Search messages across all friend sessions |

**Proto:**

```protobuf
message SearchFriendMessagesRequest {
  string query = 1;
  string session_ulid = 2;  // optional: scope to one session
  int32 limit = 3;
  int32 offset = 4;
}

message SearchFriendMessagesResponse {
  repeated FriendChatMessage messages = 1;
  int32 total = 2;
}
```

**Repo implementation:**

```go
func (r *GormRepo) SearchMessages(actorDID, query, sessionUlid string, limit, offset int) ([]domain.Message, int, error) {
    base := r.db.Model(&MessageModel{}).
        Joins("JOIN session_models ON message_models.session_ulid = session_models.ulid").
        Where("(session_models.participant_a_did = ? OR session_models.participant_b_did = ?)", actorDID, actorDID).
        Where("message_models.content_tsv @@ plainto_tsquery('simple', ?)", query)

    if sessionUlid != "" {
        base = base.Where("message_models.session_ulid = ?", sessionUlid)
    }

    var total int64
    base.Count(&total)

    var items []MessageModel
    base.Order("sent_at DESC").Limit(limit).Offset(offset).Find(&items)

    // ... convert to domain
}
```

### 5.3 Upgrade Group Chat Search

Replace `LIKE` with `tsvector`:

```go
// Before (O(n) scan)
s.db.Where("group_ulid = ? AND content LIKE ?", groupID, "%"+query+"%")

// After (GIN index, ranked)
s.db.Where("group_ulid = ? AND content_tsv @@ plainto_tsquery('simple', ?)", groupID, query).
    Order("ts_rank(content_tsv, plainto_tsquery('simple', ?)) DESC", query)
```

---

## 6. Client-Side Search (Desktop)

### 6.1 Existing Infrastructure

The `local_chat_store.rs` already has:

- `chat_messages` table with `scope`, `conversation_id`, `message_id`, `sender_did`, `content`, `sent_at`
- `chat_messages_fts` FTS5 virtual table indexing `content`
- `search_local()` function using `MATCH`
- `ingest_friend_messages()` and `ingest_group_messages()` that populate the local cache

### 6.2 What Needs Wiring

**Tauri command** (new):

```rust
#[tauri::command]
pub fn chat_search_local(
    input: ChatSearchInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<ChatSearchResult> {
    let user_scope = user_scope_from_state(&state);
    let scope = input.scope.unwrap_or_default(); // empty = all scopes
    let results = chat_storage::search_local(
        &user_scope, &scope, &input.query, input.limit.unwrap_or(20)
    );
    // ... convert to AppResult
}
```

**TS API:**

```typescript
chatSearchLocal: (query: string, scope?: string, limit?: number) =>
  invoke('chat_search_local', { query, scope, limit }),
```

### 6.3 Message Sync for Local Index

Messages are ingested into the local store via `ingest_friend_messages` / `ingest_group_messages` (called after `friend_chat_list_messages` and `group_chat_send_message`). This already happens in the Tauri commands.

For comprehensive local search, we need a **background sync** that fetches all historical messages:

```
On login / periodic:
  1. For each friend session:
     - Get local sync cursor
     - Fetch messages from Station since cursor (paginated)
     - Ingest into local store
     - Update cursor
  2. Same for each group
```

This is already partially implemented via `friend_chat_background_sync` Tauri command.

### 6.4 E2E Integration

When E2E encryption is active:

```
Station returns encrypted_payload
    → Desktop Rust decrypts with session key
    → Plaintext inserted into local FTS5 index
    → FTS5 search works on decrypted content
    → Station never sees plaintext
```

The local store becomes the **only** source of searchable content for E2E messages.

---

## 7. Search UI (Desktop TS)

### 7.1 Search Entry Points

| Entry Point | Scope | Description |
|-------------|-------|-------------|
| Global search (⌘K) | All conversations | Search across all friend + group messages |
| In-conversation search | Single conversation | Search icon in ChatMessageArea header |
| Contacts page search | People/groups | Already exists for filtering contacts |

### 7.2 Search Results Component

```
┌─────────────────────────────────────────┐
│ 🔍 Search messages...              [×]  │
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ 📱 Alice                           │ │
│ │ "...meeting **tomorrow** at the..." │ │
│ │ 2 hours ago                        │ │
│ ├─────────────────────────────────────┤ │
│ │ 👥 Project Team                    │ │
│ │ Bob: "...the **tomorrow** deadline" │ │
│ │ Yesterday                          │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ 3 results found                         │
└─────────────────────────────────────────┘
```

**Behavior:**
- Debounced input (300ms)
- Local search first (instant results)
- Remote search as fallback (if local results < threshold)
- Click result → navigate to conversation → scroll to message
- Highlight matched text in results

### 7.3 Store Integration

```typescript
interface SearchState {
  searchQuery: string;
  searchResults: SearchResult[];
  searchLoading: boolean;

  searchMessages: (query: string, scope?: string) => Promise<void>;
  clearSearch: () => void;
}

interface SearchResult {
  messageId: string;
  conversationId: string;
  conversationType: 'friend' | 'group';
  conversationName: string;
  senderDid: string;
  content: string;
  sentAt: Date;
  matchHighlight: string;
}
```

---

## 8. Implementation Plan

### Phase 1: Wire Local Search to UI (Week 1)

- [ ] Add `chat_search_local` Tauri command
- [ ] Add `chatSearchLocal` to `desktop_api.ts`
- [ ] Add search state to `socialChat.ts` store
- [ ] Build `SearchMessagesModal` component
- [ ] Wire in-conversation search button
- [ ] Test with existing local message cache

### Phase 2: Station FTS Upgrade (Week 2)

- [ ] Add `content_tsv` generated column + GIN index to friend_chat messages
- [ ] Add `content_tsv` + GIN index to group_chat messages
- [ ] Add `SearchMessages` to friend_chat repo/service/handler
- [ ] Upgrade group_chat search from LIKE to tsvector
- [ ] Add Rust Tauri commands for remote search
- [ ] Wire remote search as fallback in TS store

### Phase 3: Background Sync (Week 3)

- [ ] Ensure `friend_chat_background_sync` covers all sessions
- [ ] Add equivalent for group chat
- [ ] Sync on login + periodic (every 5 minutes)
- [ ] Progress indicator for initial sync

### Phase 4: Global Search Integration (Week 4)

- [ ] Integrate message search into existing ⌘K search page
- [ ] Cross-conversation results with conversation context
- [ ] Result grouping by conversation
- [ ] Navigate-to-message on click

### Phase 5: E2E Compatibility (After E2E Phase 3)

- [ ] Decrypt → index flow for E2E messages
- [ ] Remove remote content search for E2E conversations (metadata only)
- [ ] Verify local-only search path works end-to-end

---

## 9. Constraints

1. **User isolation is non-negotiable**: Every search query at every layer must be scoped to the authenticated user. No exceptions.
2. **No plaintext content in logs**: Search queries and results must not be logged with message content.
3. **Graceful degradation**: If local search fails, fall back to remote. If remote fails, show error. Never crash.
4. **Performance budget**: Local search < 100ms for 100K messages. Remote search < 500ms.
5. **Relevance over recency**: FTS ranking should prioritize relevance, with recency as tiebreaker.
6. **Proto-first for remote APIs**: Search request/response types defined in `model/domain/` protos.
