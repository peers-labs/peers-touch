# Module 6: Session & Topic — Peers-Touch Architecture Design

> Step 2 (S2) of architecture design methodology.
> Source of truth for session/topic lifecycle in Peers-Touch Agent Desktop.
>
> Last updated: 2026-08-12

---

## 1. Architecture Overview

### 1.1 Ownership & Layer Boundaries

```
┌─────────────────────────────────────────────────────────────────────┐
│  Station (Go)                                                       │
│  ┌──────────────────────────────────────┐                           │
│  │ Conversation Aggregate               │                           │
│  │  - conversation_id (UUID)            │                           │
│  │  - agent_id                          │                           │
│  │  - title, pinned, favorite           │                           │
│  │  - status (active/archived)          │                           │
│  │  - created_at, updated_at            │                           │
│  │  - message_count                     │                           │
│  └──────────────────────────────────────┘                           │
│  ┌──────────────────────────────────────┐                           │
│  │ Smart Rename Domain Service          │                           │
│  │  - streaming LLM title generation    │                           │
│  │  - called after first exchange       │                           │
│  └──────────────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ Tauri IPC (protobuf)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Rust BFF (src-tauri)                                               │
│  - list_agent_sessions(agent_id) → Vec<Session>                     │
│  - create_session(agent_id) → Session                               │
│  - delete_session(key) → ok                                         │
│  - rename_session(key, title) → ok                                  │
│  - smart_rename_session(key) → {title}                              │
│  - duplicate_session(key) → {conversation_id}                       │
│  - pin_session(key, pinned) → ok           [NEW]                    │
│  - favorite_session(key, favorite) → ok    [NEW]                    │
│  - search_sessions(agent_id, query) → Vec<Session>  [NEW]           │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ Zustand store subscription
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Desktop TS (React + Zustand)                                       │
│  ┌─────────────────────────┐  ┌─────────────────────────────┐      │
│  │ useChatStore            │  │ useAgentTopicStore           │      │
│  │ (message streaming,     │  │ (topic list, title state,    │      │
│  │  session selection,     │  │  pin/favorite, search,       │      │
│  │  draft→real lifecycle)  │  │  optimistic create)          │      │
│  └─────────────────────────┘  └─────────────────────────────────┘   │
│                                       │                             │
│                                       ▼                             │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ AgentSidebar → TopicGroup → TopicItem                       │    │
│  │ (date groups, pinned section, search mode, context menu)    │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Session/Topic Lifecycle

In Peers-Touch, "session" and "topic" are synonymous — a topic IS a conversation session owned by a specific agent. The lifecycle:

```
                    User clicks "New Topic"
                            │
                            ▼
              ┌──────────────────────────┐
              │  DRAFT (local-only)      │
              │  key: draft:{timestamp}  │
              │  titleState: untitled    │
              └──────────┬───────────────┘
                         │ User sends first message
                         │ (optimistic: show immediately)
                         ▼
              ┌──────────────────────────┐
              │  CREATING                │
              │  Stream emits            │
              │  conversation_created    │
              │  → replace draft key     │
              │    with real conv ID     │
              └──────────┬───────────────┘
                         │ Stream completes
                         ▼
              ┌──────────────────────────┐
              │  ACTIVE (untitled)       │
              │  titleState: untitled    │
              │  Auto-rename fires       │
              └──────────┬───────────────┘
                         │ smartRenameTopic() returns
                         ▼
              ┌──────────────────────────┐
              │  ACTIVE (titled)         │
              │  titleState: generated   │
              │  User can: pin, fav,     │
              │  rename, delete, dup     │
              └──────────────────────────┘
```

### 1.3 Key Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Sessions are conversations owned by Station | Station is the persistence authority; Desktop is a projection |
| D2 | Flat topic list for P0 with date grouping | Multi-mode grouping (status, project) deferred to P2 |
| D3 | Optimistic draft-to-real transition | Already implemented via `conversation_created` stream event |
| D4 | Topic pinning and favorites are per-agent | Each agent has its own pinned/favorite set |
| D5 | Auto-naming fires after first exchange completes | Triggered by `reconcileTopicsAfterTurn` when `titleState === 'untitled'` |
| D6 | Search is client-side title filter + backend message search | Title filter is instant; message content search goes through Station |

---

## 2. Enhanced Topic Store Design

### 2.1 Extended State Shape

```typescript
interface AgentTopicState {
  // Existing
  topicsByAgentId: Record<string, AgentTopic[]>;
  activeAgentId: string;
  loadingAgentIds: Record<string, boolean>;
  generatingTitleKeys: Record<string, boolean>;
  titleHistoryByKey: Record<string, TopicTitleHistory>;
  lastError?: string;

  // NEW: Topic filtering & display
  searchQuery: string;                         // Current sidebar search text
  searchMode: 'title' | 'content';            // Filter by title only or full-text
  sortBy: 'updated_at' | 'created_at';        // Sort field for topic list

  // Existing actions (unchanged)
  getTopicsForAgent: (agentId: string) => AgentTopic[];
  loadTopicsForAgent: (agentId: string, reason?: string) => Promise<AgentTopic[]>;
  reconcileSelectedAgentTopics: (reason?: string) => Promise<void>;
  upsertTopics: (agentId: string, sessions: Session[]) => void;
  createDraftTopic: (agentId: string, agentName: string, title: string) => AgentTopic;
  deleteTopic: (key: string) => Promise<void>;
  renameTopic: (key: string, title: string) => Promise<void>;
  smartRenameTopic: (key: string) => Promise<{ title: string }>;
  revertGeneratedTitle: (key: string) => Promise<void>;
  duplicateTopic: (key: string) => Promise<void>;

  // NEW actions
  pinTopic: (key: string, pinned: boolean) => Promise<void>;
  favoriteTopic: (key: string, favorite: boolean) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setSearchMode: (mode: 'title' | 'content') => void;
  setSortBy: (sortBy: 'updated_at' | 'created_at') => void;
}
```

### 2.2 Extended AgentTopic Interface

```typescript
interface AgentTopic extends Session {
  // Existing
  titleState: TopicTitleState;
  previousTitle?: string;
  titleError?: string;
  titleUpdatedAt?: string;

  // NEW fields (sourced from Station via Session)
  pinned?: boolean;
  favorite?: boolean;
}
```

### 2.3 New Actions — Implementation Contract

#### `pinTopic(key, pinned)`

- Optimistic update: immediately set `pinned` on the topic in local state
- Call `api.pinSession(key, pinned)` (new Rust BFF command)
- On failure: rollback optimistic state
- Pinned topics appear in a dedicated "Pinned" section above date groups

#### `favoriteTopic(key, favorite)`

- Same optimistic pattern as pinTopic
- Call `api.favoriteSession(key, favorite)` (new Rust BFF command)
- Favorite topics get a star icon; favorited subset is displayed in the pinned section alongside pinned topics

#### `setSearchQuery(query)`

- Pure local state update (no server call for title-mode)
- Title filtering is computed in the selector/memo, not stored as filtered results
- When `searchMode === 'content'`, debounce 300ms then call `searchAgentMessages` from the existing search store

#### `setSortBy(sortBy)`

- Persisted in user preferences via `api.setPreferences`
- Affects the `groupTopicsByDate` sort key

---

## 3. Topic Sidebar Enhancements

### 3.1 Pinned Topics Section

When any topic has `pinned: true` or `favorite: true`, a dedicated section renders above the date-grouped list:

```
┌──────────────────────────────────┐
│  📌 Pinned & Favorites           │
│  ┌────────────────────────────┐  │
│  │ # Project Architecture     │  │  ← pinned
│  │ ★ Daily Standup Notes      │  │  ← favorite
│  └────────────────────────────┘  │
├──────────────────────────────────┤
│  Today                           │
│    # New conversation            │
│    # Debugging session           │
│  Yesterday                       │
│    # API design discussion       │
└──────────────────────────────────┘
```

Implementation: A new `PinnedTopicSection` component above the `topicGroups.map(...)` in `AgentSidebar`. It reads `agentTopics.filter(t => t.pinned || t.favorite)`.

### 3.2 Search Enhancements

Current state: The sidebar already has a search toggle and `SearchBar` component. The search filters topics by title locally and searches message content via `searchAgentMessages`.

Enhancement: No structural change needed. The existing implementation covers the P0 requirement:
- Title filter is already instant (client-side `.includes()`)
- Message content search already delegates to the backend via `useActiveAgentSearchSlice`
- Results display as `MessageSearchResults` component

### 3.3 Auto-Name Display States

The topic title already shows visual indicators for title generation state. Current states and their display:

| State | Display |
|-------|---------|
| `untitled` | Shows fallback text from i18n key `agent.sidebar.newTopic` |
| `generating` | Shows the i18n label `agent.sidebar.titleState.generating` |
| `generated` | Shows title + undo button (revert to previous) |
| `manual` | Shows title normally |
| `failed` | Shows last known title (no error badge in sidebar, error logged) |

No structural change needed for P0. The auto-rename flow is already wired:
1. `reconcileTopicsAfterTurn()` is called after every stream completes
2. It checks if topic `titleState === 'untitled'`
3. If so, calls `smartRenameTopic(sessionKey)`
4. The store transitions: `untitled → generating → generated`

### 3.4 Context Menu Enhancement

Add pin and favorite to the existing context menu:

```typescript
const menuItems: MenuProps['items'] = [
  { key: 'pin', icon: <Pin size={14} />, label: topic.pinned ? t('unpin') : t('pin') },
  { key: 'favorite', icon: <Star size={14} />, label: topic.favorite ? t('unfavorite') : t('favorite') },
  { type: 'divider' },
  { key: 'smart-rename', icon: <Sparkles size={14} />, label: t('smartRename') },
  { key: 'rename', icon: <Pencil size={14} />, label: t('rename') },
  { key: 'duplicate', icon: <Copy size={14} />, label: t('duplicate') },
  { type: 'divider' },
  { key: 'delete', icon: <Trash2 size={14} />, label: t('delete'), danger: true },
];
```

Note: The current `favorite` menu item is already present but disabled. This enhancement enables it and adds `pin`.

---

## 4. Integration with Existing Chat Flow

### 4.1 Draft-to-Real Session Lifecycle (Existing, No Change)

The current `sendMessage` in `useChatStore` already handles:
1. Creates `draft:{timestamp}` session on `newSession()`
2. On first `conversation_created` stream event, replaces draft key with real conversation ID
3. Updates sessions map, operations map, session buffers atomically
4. `reconcileTopicsAfterTurn` then auto-renames

### 4.2 Topic Selection Flow (Existing, No Change)

`selectSession(key)` in `useChatStore`:
1. Resolves model from session's `model_override`
2. Checks for live operation buffer
3. Loads messages from cache, then syncs from Station

### 4.3 New: Pin/Favorite Persistence Round-Trip

```
User clicks pin → TopicItem context menu
  → agentTopicStore.pinTopic(key, true)
    → Optimistic: update local topic.pinned = true
    → api.pinSession(key, true)  [Rust BFF → Station]
    → On success: no-op (already optimistic)
    → On failure: rollback topic.pinned = false
```

### 4.4 Store Coordination

```
┌──────────────┐         ┌──────────────────┐
│ useChatStore │         │ useAgentTopicStore│
└──────┬───────┘         └────────┬─────────┘
       │                          │
       │  sendMessage()           │
       │  → stream completes      │
       │  → reconcileTopicsAfterTurn()
       │         │                │
       │         └────────────────┤
       │                          │ reconcileSelectedAgentTopics()
       │                          │ → loadTopicsForAgent()
       │                          │ → if titleState untitled:
       │                          │      smartRenameTopic()
       │                          │
       │  loadSessions()          │
       │  ← sessions list        │
       └──────────────────────────┘
```

The two stores coordinate via:
- `reconcileTopicsAfterTurn()` in chat.ts calls into `useAgentTopicStore.getState()`
- `useChatStore.loadSessions()` reads from the agent chat cache
- The topic store reads from `chatService.listAgentSessions()` (same underlying API)

### 4.5 Deferred (P2)

The following are explicitly out of scope for P0:
- Epoch-guarded topic switches (race protection for rapid switching)
- Batch topic operations (bulk delete, bulk move between agents)
- Topic status lifecycle (active/running/completed) — not yet needed without long-running agent tasks
- Pagination (current loads are all-at-once; acceptable for <500 topics per agent)
- Multi-mode sidebar grouping (by status, by project)

---

## 5. API Surface Changes

### 5.1 New Rust BFF Commands (src-tauri)

```rust
#[tauri::command]
async fn pin_session(key: String, pinned: bool) -> Result<JsonValue, String>;

#[tauri::command]
async fn favorite_session(key: String, favorite: bool) -> Result<JsonValue, String>;
```

### 5.2 New Station Endpoints

```
PATCH /api/v1/conversations/{id}
Body: { "pinned": true }  // or { "favorite": true }
Response: 200 { "ok": true }
```

These use the existing conversation update endpoint pattern. Station persists `pinned` and `favorite` as boolean fields on the conversation aggregate.

### 5.3 Session Type Extension

```typescript
interface Session {
  id: string;
  key: string;
  agent_name: string;
  title: string;
  message_count: number;
  model_override?: string;
  created_at: string;
  updated_at: string;
  pinned?: boolean;      // NEW
  favorite?: boolean;    // NEW
}
```

---

## 6. Data Flow Summary

```
[Topic Created]
  Draft (local) → conversation_created (stream event) → Real session (Station)
  → reconcile topics → auto-rename if untitled

[Topic Pinned/Favorited]
  User action → optimistic local update → Station PATCH → confirm or rollback

[Topic Searched]
  Title mode: local filter on agentTopics array (instant)
  Content mode: debounced call to Station search → display MessageSearchResults

[Topic Renamed]
  Manual: optimistic local → Station rename → confirm
  Smart: set generating → Station LLM call → set generated with undo history

[Topic Deleted]
  Optimistic remove from local list → Station delete → confirm or rollback
  If active topic: switch to next available or create draft
```
