# Module 6: Session & Topic — Reference Implementation Analysis

> Step 1b of architecture design methodology.
> Source: LobeHub (`external/lobehub/src/`)
> Target: Peers-Touch Agent Desktop (`peers-ai-agent/apps/desktop/src/`)

---

## 1. Data Flow Diagram

```
Session/Topic Lifecycle: Create -> Switch -> Auto-Name -> Group -> Delete

                          User Action
                              |
                              v
    +-------------------+    +-----------------------+
    | SessionStore      |    | ChatStore (topic)     |
    | (agent list)      |    | (conversation mgmt)  |
    +-------------------+    +-----------------------+
    | createSession()   |    | saveToTopic()         |
    | switchSession()   |    | switchTopic()         |
    | pinSession()      |    | summaryTopicTitle()   |
    | removeSession()   |    | removeTopic()         |
    | duplicateSession()|    | duplicateTopic()      |
    | updateGroupId()   |    | updateTopicStatus()   |
    +--------+----------+    +----------+------------+
             |                          |
             v                          v
    +-------------------+    +-----------------------+
    | SessionService    |    | TopicService          |
    | (trpc/lambda)     |    | (trpc/lambda)         |
    +-------------------+    +-----------------------+
             |                          |
             v                          v
    +--------------------------------------------------+
    |              Server DB (PostgreSQL)               |
    +--------------------------------------------------+

Flow Detail:

  [CREATE]
  User sends first message in empty chat
    -> displayMessages exist, no activeTopicId
    -> openNewTopicOrSaveTopic() called
    -> saveToTopic():
       1. internal_createTopic(title="Default Topic", messages=[...])
       2. Optimistic tmp_topic_* row added to topicDataMap via reducer
       3. topicService.createTopic() -> server returns real topicId
       4. internal_replaceTopicId(tmp_topic_* -> real_id)
       5. summaryTopicTitle() fires (fire-and-forget)

  [AUTO-NAME]
  summaryTopicTitle(topicId, messages):
    -> chatService.fetchPresetTaskResult() with chainSummaryTitle prompt
    -> Streams title tokens via onMessageHandle
    -> internal_updateTopicTitleInSummary() updates UI progressively
    -> onFinish: internal_updateTopic(id, {title: finalText})
    -> topicService.updateTopic() persists

  [SWITCH]
  switchTopic(id):
    -> Increment epoch counter (stale-cancellation)
    -> Clear _new key data if switching to null
    -> Set activeTopicId
    -> markTopicRead()
    -> Yield microtask (epoch guard)
    -> revalidateMessages() for new topic context

  [GROUP]
  Topics grouped by: time | status | project | flat
    -> topicSelectors.groupedTopicsForSidebar(pageSize, sortBy, groupMode)
    -> Favorites pinned at top regardless of mode
    -> Status groups: running > pending > active > completed

  [DELETE]
  removeTopic(id):
    -> topicService.removeTopic(id)
    -> internal_dispatchTopic({type:'deleteTopic', id})
    -> evictMessageCache(ctx => ctx.topicId === id)
    -> If active topic deleted: switchTopic(null)
```

---

## 2. State Machine

```
Session States
==============

  [No Session] --createSession()--> [Active Session]
  [Active Session] --switchSession(other)--> [Inactive Session]
  [Inactive Session] --switchSession(this)--> [Active Session]
  [Active Session] --pinSession(true)--> [Pinned + Active]
  [Active Session] --removeSession()--> [No Session] (fallback to inbox)
  [Active Session] --updateGroupId(gid)--> [Grouped + Active]

Topic States (per topic)
========================

  [No Topic] --saveToTopic()--> [Creating (tmp_topic_*)]
  [Creating] --server returns id--> [Active (untitled)]
  [Active (untitled)] --summaryTopicTitle()--> [Generating Title]
  [Generating Title] --onFinish--> [Active (titled)]
  [Active] --updateTopicStatus('running')--> [Running]
  [Running] --updateTopicStatus('active'|'unread')--> [Active/Unread]
  [Active] --markTopicCompleted()--> [Completed]
  [Completed] --unmarkTopicCompleted()--> [Active]
  [Active] --removeTopic()--> [Deleted]
  [Active] --favoriteTopic(true)--> [Favorited + Active]

Topic Status Values: 'active' | 'running' | 'completed' | 'unread' | 'scheduled'

Sidebar Interaction States
==========================

  [Collapsed] --expand accordion--> [Expanded: TopicListContent]
  [Expanded] --click search icon--> [Search Mode]
  [Search Mode] --clear keywords--> [Expanded]
  [Expanded] --toggle group mode--> [ByTime | ByStatus | ByProject | Flat]
  [Expanded] --click "All Topics"--> [AllTopicsDrawer open]
  [Expanded] --click topic item--> switchTopic(id) -> [Topic Active in chat]
  [Topic Active] --click same topic--> no-op
  [Topic Active] --right-click--> [Context Menu: rename/delete/duplicate/pin/favorite]
```

---

## 3. Architecture Mapping Table

| Concern | LobeHub | Peers-Touch (current) | Gap / Notes |
|---------|---------|----------------------|-------------|
| **Session store** | `store/session/` — Zustand class-based slices with reducer pattern | `store/agent.ts` — flat Zustand store for agent list | Peers lacks session-level grouping, pinning, search; agents are the session equivalent |
| **Session state shape** | `SessionState`: sessions[], pinnedSessions[], defaultSessions[], customSessionGroups[], activeId, sessionGroups | `AgentState`: agents[], selectedAgent (name string) | Peers has no pinned/grouped agent concept |
| **Session service** | `services/session/` — tRPC lambda client, CRUD + group operations | `services/desktop_api.ts` — Rust IPC bridge, flat session list | Peers uses Tauri commands, not tRPC |
| **Topic store** | `store/chat/slices/topic/` — part of ChatStore, topicDataMap keyed by agent+group | `store/agentTopics.ts` — standalone store, topicsByAgentId map | Similar keying strategy, but Peers lacks pagination, status, grouping |
| **Topic state shape** | `ChatTopicState`: topicDataMap, activeTopicId, topicLoadingIds, searchTopics, agentTopicsViewMap | `AgentTopicState`: topicsByAgentId, generatingTitleKeys, titleHistoryByKey | Peers lacks: pagination, status tracking, loading ref-counts, search, group modes |
| **Topic service** | `services/topic/` — tRPC lambda: createTopic, getTopics (paginated), searchTopics, updateTopic, removeTopic, cloneTopic, batchMoveTopics | `services/chat-service.ts` — listAgentSessions, deleteSession, renameSession, smartRenameSession, duplicateSession | Peers service is simpler; no batch ops, no pagination, no status |
| **Auto-naming** | `summaryTopicTitle()` — streams LLM title via `chatService.fetchPresetTaskResult` with `chainSummaryTitle` prompt; progressive UI update | `smartRenameTopic()` — single async call to `chatService.smartRenameSession(key)`; stores previousTitle for revert | Peers has revert capability (good); lacks streaming progressive update |
| **Topic sidebar UI** | `features/AgentSidebar/Topic/` — AccordionItem, multi-mode list (ByTime/ByStatus/ByProject/Flat/Search), grouped accordion, item context menus | `components/AgentSidebar.tsx` — inline groupTopicsByDate, single mode (byTime), context menu with rename/delete/duplicate/smart-rename | Peers lacks: multiple group modes, status-based grouping, search bar, all-topics drawer, filter |
| **Topic reducer** | Immer-based: addTopic, updateTopic, deleteTopic, replaceTopicId — with optimistic updates and stale-row reconciliation | Pure-function helpers: replaceTopic, removeTopic — applied directly in set() | Peers lacks optimistic tmp-topic pattern, epoch-guarded switches |
| **Pagination** | topicDataMap with currentPage, pageSize, hasMore, loadMoreTopics() | None — loads all topics at once | Gap: needed for agents with many conversations |
| **Topic status** | Full status lifecycle: active/running/completed/unread/scheduled; `updateTopicStatus()` with pending-write reconciliation | `TopicTitleState`: untitled/manual/generating/generated/failed (title-only) | Peers tracks title generation state; lacks run-lifecycle status |
| **Stale-run cleanup** | `cleanupStaleRunningTopics()` — watchdog on sidebar expand, 2hr timeout | None | Gap: needed once agent runs are long-lived |
| **Topic search** | `useSearchTopics()` SWR hook + dedicated search mode in sidebar | None in sidebar | Gap |
| **Session groups** | `slices/sessionGroup/` — CRUD + sort with optimistic reducer | None | Gap: no agent/session grouping in Peers |
| **Batch operations** | batchRemoveTopics, batchMoveTopicsToAgent, removeSessionTopics, removeGroupTopics | None | Gap |
| **Topic metadata** | Rich: workingDirectory, model/provider pin, onboardingSession, scheduledRun, runningOperation, repos[], git config | Minimal: title state + history only | Gap: needed for working-directory-aware topics |

---

## 4. Key Function Signatures

### LobeHub Session Store (`store/session/slices/session/action.ts`)

```typescript
class SessionActionImpl {
  createSession(agent?: PartialDeep<LobeAgentSession>, isSwitchSession?: boolean): Promise<string>
  duplicateSession(id: string): Promise<void>
  switchSession(sessionId: string): void
  pinSession(id: string, pinned: boolean): Promise<void>
  removeSession(sessionId: string): Promise<void>
  updateSessionGroupId(sessionId: string, group: string): Promise<void>
  updateSearchKeywords(keywords: string): void
  triggerSessionUpdate(id: string): Promise<void>

  // SWR data hooks
  useFetchSessions(enabled: boolean, isLogin: boolean | undefined): SWRResponse<ChatSessionList>
  useSearchSessions(keyword?: string): SWRResponse<LobeSessions>

  // Internal
  internal_processSessions(sessions: LobeSessions, sessionGroups: LobeSessionGroups): void
  internal_updateSession(id: string, data: Partial<UpdateSessionParams>): Promise<void>
  internal_dispatchSessions(payload: SessionDispatch): void
  refreshSessions(): Promise<void>
}
```

### LobeHub Session Group Store (`store/session/slices/sessionGroup/action.ts`)

```typescript
class SessionGroupActionImpl {
  addSessionGroup(name: string): Promise<string>
  removeSessionGroup(id: string): Promise<void>
  updateSessionGroupName(id: string, name: string): Promise<void>
  updateSessionGroupSort(items: SessionGroupItem[]): Promise<void>
  internal_dispatchSessionGroups(payload: SessionGroupsDispatch): void
}
```

### LobeHub Topic Actions (`store/chat/slices/topic/action.ts`)

```typescript
class ChatTopicActionImpl {
  // Lifecycle
  createTopic(sessionId?: string): Promise<string | undefined>
  saveToTopic(sessionId?: string): Promise<string | undefined>
  switchTopic(id?: string | null, options?: SwitchTopicOptions): Promise<void>
  removeTopic(id: string, removeFiles?: boolean): Promise<void>
  duplicateTopic(id: string): Promise<void>
  importTopic(data: string): Promise<string | undefined>

  // Title
  summaryTopicTitle(topicId: string, messages: UIChatMessage[]): Promise<void>
  autoRenameTopicTitle(id: string): Promise<void>
  updateTopicTitle(id: string, title: string): Promise<void>

  // Status & metadata
  updateTopicStatus(params: { topicId: string; status: ChatTopicStatus; agentId?: string; groupId?: string; scope?: TopicMapScope }): Promise<void>
  updateTopicModel(id: string, { model, provider }): Promise<void>
  updateTopicMetadata(id: string, metadata: Partial<ChatTopicMetadata>): Promise<void>
  markTopicCompleted(id: string): Promise<void>
  unmarkTopicCompleted(id: string): Promise<void>
  favoriteTopic(id: string, favorite: boolean): Promise<void>

  // Batch operations
  removeSessionTopics(scope?: TopicBatchDeleteScope): Promise<void>
  removeGroupTopics(groupId: string, scope?: TopicBatchDeleteScope): Promise<void>
  removeAllTopics(): Promise<void>
  removeUnstarredTopic(options?: RemoveUnstarredTopicOptions): Promise<void>
  batchMoveTopicsToAgent(topicIds: string[], targetAgentId: string): Promise<void>

  // Pagination
  loadMoreTopics(): Promise<void>
  loadMoreAgentTopicsView(): Promise<void>

  // Data fetching (SWR)
  useFetchTopics(enable: boolean, opts: { agentId?; groupId?; pageSize?; sortBy?; ... }): SWRResponse
  useFetchAgentTopicsView(enable: boolean, opts): SWRResponse
  useSearchTopics(keywords: string | undefined, opts): SWRResponse<ChatTopic[]>

  // Drawer
  openAllTopicsDrawer(): void
  closeAllTopicsDrawer(): void
  openNewTopicOrSaveTopic(): Promise<void>

  // Stale cleanup
  cleanupStaleRunningTopics(): Promise<number>
  syncScheduledTopicRun(topicId: string): Promise<boolean>

  // Internal
  internal_createTopic(params: CreateTopicParams): Promise<string>
  internal_updateTopic(id: string, data: Partial<ChatTopic>): Promise<void>
  internal_dispatchTopic(payload: ChatTopicDispatch, action?: any): void
  internal_replaceTopicId(params: { previousId; nextId; agentId?; groupId?; value? }): void
  internal_updateTopicLoading(id: string, loading: boolean): void
  internal_updateTopicTitleInSummary(id: string, title: string): void
  refreshTopic(): Promise<void>
}

interface SwitchTopicOptions {
  clearNewKey?: boolean
  scope?: MessageMapScope
  skipRefreshMessage?: boolean
}
```

### LobeHub Topic Service (`services/topic/index.ts`)

```typescript
class TopicService {
  createTopic(params: CreateTopicParams): Promise<string>
  cloneTopic(id: string, newTitle?: string): Promise<string>
  getTopics(params: QueryTopicParams): Promise<{ items: ChatTopic[]; total: number }>
  getTopicDetail(id: string): Promise<ChatTopic | null>
  searchTopics(keywords: string, agentId?: string, groupId?: string): Promise<ChatTopic[]>
  updateTopic(id: string, data: Partial<ChatTopic>): Promise<void>
  updateTopicMetadata(id: string, metadata: Partial<ChatTopicMetadata>): Promise<void>
  removeTopic(id: string, removeFiles?: boolean): Promise<void>
  batchRemoveTopics(topics: string[]): Promise<void>
  batchMoveTopics(topicIds: string[], targetAgentId: string): Promise<void>
  removeTopicsByAgentId(agentId: string, scope: TopicBatchDeleteScope): Promise<void>
  removeTopicsByGroupId(groupId: string, scope: TopicBatchDeleteScope): Promise<void>
  importTopic(params: { agentId; data; groupId? }): Promise<{ messageCount; topicId }>
  countTopics(params?): Promise<number>
  rankTopics(limit?: number): Promise<TopicRankItem[]>
  hasTopicFiles(ids: string[]): Promise<boolean>
  // Sharing
  getShareInfo(topicId: string): Promise<...>
  enableSharing(topicId: string, visibility?): Promise<...>
  disableSharing(topicId: string): Promise<...>
}
```

### LobeHub Topic Selectors (`store/chat/slices/topic/selectors.ts`)

```typescript
const topicSelectors = {
  // Current context
  currentTopicData(s): TopicData | undefined
  currentTopics(s): ChatTopic[] | undefined
  currentActiveTopic(s): ChatTopic | undefined
  currentTopicLength(s): number
  currentTopicCount(s): number     // total from server (may exceed loaded items)
  currentUnFavTopics(s): ChatTopic[]
  displayTopics(s): ChatTopic[] | undefined  // excludes cron-triggered

  // Lookup
  getTopicById(id)(s): ChatTopic | undefined
  getTopicsByAgentId(agentId)(s): ChatTopic[] | undefined
  getTopicModelById(id)(s): { model; provider } | undefined
  activeTopicModel(s): { model; provider } | undefined

  // Working directory
  getTopicWorkingDirectory(id?)(s): string | undefined
  currentTopicWorkingDirectory(s): string | undefined

  // Sidebar display
  displayTopicsForSidebar(pageSize, sortBy, includeCompleted)(s): ChatTopic[] | undefined
  groupedTopicsForSidebar(pageSize, sortBy, groupMode, includeCompleted)(s): GroupedTopic[]

  // Pagination
  hasMoreTopics(s): boolean
  isLoadingMoreTopics(s): boolean
  isExpandingPageSize(s): boolean

  // Search
  searchTopics(s): ChatTopic[]
  isInSearchMode(s): boolean
  isSearchingTopic(s): boolean

  // Status
  isCreatingTopic(s): boolean
  isNewTopicSendInFlight(s): boolean
  isUndefinedTopics(s): boolean
}
```

### Peers-Touch Current Implementation (`store/agentTopics.ts`)

```typescript
interface AgentTopicState {
  topicsByAgentId: Record<string, AgentTopic[]>
  activeAgentId: string
  loadingAgentIds: Record<string, boolean>
  generatingTitleKeys: Record<string, boolean>
  titleHistoryByKey: Record<string, TopicTitleHistory>

  getTopicsForAgent(agentId: string): AgentTopic[]
  loadTopicsForAgent(agentId: string, reason?: string): Promise<AgentTopic[]>
  reconcileSelectedAgentTopics(reason?: string): Promise<void>
  upsertTopics(agentId: string, sessions: Session[]): void
  createDraftTopic(agentId: string, agentName: string, title: string): AgentTopic
  deleteTopic(key: string): Promise<void>
  renameTopic(key: string, title: string): Promise<void>
  smartRenameTopic(key: string): Promise<{ title: string }>
  revertGeneratedTitle(key: string): Promise<void>
  duplicateTopic(key: string): Promise<void>
}

type TopicTitleState = 'untitled' | 'manual' | 'generating' | 'generated' | 'failed'

interface AgentTopic extends Session {
  titleState: TopicTitleState
  previousTitle?: string
  titleError?: string
  titleUpdatedAt?: string
}
```

---

## 5. Key Design Patterns to Adopt

### 5.1 Optimistic Updates with Reconciliation
LobeHub creates `tmp_topic_*` optimistic rows, replaces them on server response, and reconciles fetched data against pending writes. This prevents UI flicker during topic creation.

### 5.2 Epoch-Guarded Async Operations
`switchTopic` uses a monotonic `#switchTopicEpoch` counter — any async continuation checks its captured epoch against current and aborts if stale. Prevents race conditions when user switches rapidly.

### 5.3 Scoped Topic Dispatch
Topics are bucketed by `topicMapKey({agentId, groupId, scope})`. Status writes from agent runs carry explicit scope so they land in the correct bucket even if the user has switched away.

### 5.4 Ref-Counted Loading
`internal_updateTopicLoading` uses a count per topic ID — multiple concurrent owners (agent run + title summary) can each acquire/release independently without tearing.

### 5.5 Pending-Write Pinning
`#pendingTopicStatusWrites` map prevents SWR refetches from reverting optimistic status changes. Entries have a TTL (15s) and self-clear once the server confirms.

### 5.6 Streaming Title Summary
Title generation streams tokens to the sidebar in real-time via `internal_updateTopicTitleInSummary`, giving immediate visual feedback.

---

## 6. Migration Priority (Peers-Touch)

| Priority | Gap | Effort |
|----------|-----|--------|
| P0 | Topic status lifecycle (active/running/completed/unread) | Medium |
| P0 | Paginated topic fetching with hasMore/loadMore | Medium |
| P1 | Optimistic tmp-topic creation with replaceTopicId | Medium |
| P1 | Multi-mode sidebar grouping (byTime/byStatus/byProject/flat) | High |
| P1 | Topic search in sidebar | Low |
| P2 | Epoch-guarded switchTopic | Low |
| P2 | Batch topic operations (move, bulk delete) | Medium |
| P2 | Topic metadata (workingDirectory, model pin) | Medium |
| P3 | Session groups (agent categorization) | Medium |
| P3 | Stale-running-topic watchdog | Low |
| P3 | All-topics drawer / management page | High |
