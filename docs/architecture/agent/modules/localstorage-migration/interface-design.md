# M11: localStorage → Station Migration — Interface Design

> **Status**: Design complete, pending Station Go implementation
> **Proto**: `model/domain/agent/ecosystem.proto`

---

## Station API Routes (agent subserver)

All routes under `/agent/` prefix, JSON request/response (proto-backed).

### Agent Groups

| Method | Route | Request | Response |
|--------|-------|---------|----------|
| POST | `/agent/groups` | `CreateAgentGroupRequest` | `CreateAgentGroupResponse` |
| PUT | `/agent/groups/:id` | `UpdateAgentGroupRequest` | `UpdateAgentGroupResponse` |
| DELETE | `/agent/groups/:id` | `DeleteAgentGroupRequest` | `DeleteAgentGroupResponse` |
| GET | `/agent/groups` | — | `ListAgentGroupsResponse` |

### Topic Comments

| Method | Route | Request | Response |
|--------|-------|---------|----------|
| POST | `/agent/topic-comments` | `CreateTopicCommentRequest` | `CreateTopicCommentResponse` |
| DELETE | `/agent/topic-comments/:topicKey/:commentId` | — | `DeleteTopicCommentResponse` |
| GET | `/agent/topic-comments/:topicKey` | — | `ListTopicCommentsResponse` |

### Evaluation Datasets (Superseded)

The M11 dataset-only API is retired. Evaluation is now the Station-owned
MCA-D18 aggregate defined by
`docs/architecture/agent/modern-chat-agent/{design,data-model,decisions}.md`
and `model/domain/agent/evaluation.proto`. The canonical route family is
`/agent/evaluation/*`; benchmark, dataset, case, run, attempt, result, metrics,
cancellation, retry, and retention share that one authority.

### Custom Plugins

| Method | Route | Request | Response |
|--------|-------|---------|----------|
| POST | `/agent/plugins` | `CreateCustomPluginRequest` | `CreateCustomPluginResponse` |
| PUT | `/agent/plugins/:id` | `UpdateCustomPluginRequest` | `UpdateCustomPluginResponse` |
| DELETE | `/agent/plugins/:id` | — | `DeleteCustomPluginResponse` |
| GET | `/agent/plugins` | — | `ListCustomPluginsResponse` |

---

## Rust BFF Commands (Tauri)

Each command uses `station_client::request_json_auth` for authenticated JSON passthrough.

```rust
// ─── Agent Groups ────────────────────────────────────────
#[tauri::command]
async fn agent_group_create(input: CreateAgentGroupInput, ...) -> AppResult<Value>
// POST /agent/groups

#[tauri::command]
async fn agent_group_update(input: UpdateAgentGroupInput, ...) -> AppResult<Value>
// PUT /agent/groups/:id

#[tauri::command]
async fn agent_group_delete(input: DeleteAgentGroupInput, ...) -> AppResult<Value>
// DELETE /agent/groups/:id

#[tauri::command]
async fn agent_group_list(...) -> AppResult<Value>
// GET /agent/groups

// ─── Topic Comments ─────────────────────────────────────
#[tauri::command]
async fn agent_topic_comment_create(input: CreateTopicCommentInput, ...) -> AppResult<Value>

#[tauri::command]
async fn agent_topic_comment_delete(input: DeleteTopicCommentInput, ...) -> AppResult<Value>

#[tauri::command]
async fn agent_topic_comment_list(input: ListTopicCommentsInput, ...) -> AppResult<Value>

// Evaluation commands moved to the typed MCA-D18 bridge in
// apps/desktop/src-tauri/src/application/evaluation.rs.

// ─── Custom Plugins ─────────────────────────────────────
#[tauri::command]
async fn agent_plugin_create(input: CreateCustomPluginInput, ...) -> AppResult<Value>

#[tauri::command]
async fn agent_plugin_update(input: UpdateCustomPluginInput, ...) -> AppResult<Value>

#[tauri::command]
async fn agent_plugin_delete(input: DeleteCustomPluginInput, ...) -> AppResult<Value>

#[tauri::command]
async fn agent_plugin_list(...) -> AppResult<Value>
```

---

## Frontend Store Migration Pattern

Each store follows the same migration pattern:

```typescript
// Before (localStorage only):
const data = JSON.parse(localStorage.getItem(KEY) || '[]');

// After (API-first with localStorage fallback):
const loadFromServer = async () => {
  try {
    const response = await api.agentGroupList();
    set({ groups: response.groups });
    localStorage.setItem(KEY, JSON.stringify(response.groups)); // cache
  } catch {
    // offline fallback: load from localStorage cache
    const cached = JSON.parse(localStorage.getItem(KEY) || '[]');
    set({ groups: cached });
  }
};

const createGroup = async (name: string) => {
  // optimistic update
  const optimistic = { id: crypto.randomUUID(), name, ... };
  set((s) => ({ groups: [...s.groups, optimistic] }));
  localStorage.setItem(KEY, JSON.stringify(get().groups));

  try {
    const response = await api.agentGroupCreate({ name });
    // replace optimistic with server response
    set((s) => ({ groups: s.groups.map(g => g.id === optimistic.id ? response.group : g) }));
  } catch {
    // rollback on failure
    set((s) => ({ groups: s.groups.filter(g => g.id !== optimistic.id) }));
  }
};
```

---

## Migration Steps (when Station is ready)

1. Run `./model/build.sh` to generate `ecosystem.pb.go`
2. Implement Station handlers in `apps/station/app/subserver/agent/handler/`
3. Implement Station services in `apps/station/app/subserver/agent/service/`
4. Register routes in `apps/station/app/subserver/agent/agent.go`
5. Add Rust BFF commands in `apps/desktop/src-tauri/src/interface/tauri_commands/agent_growth.rs`
6. Register commands in `apps/desktop/src-tauri/src/main.rs`
7. Add to `desktop_api.ts` API object
8. Migrate each frontend store (agentGroups → topicComments → evaluation → customPlugins)
9. One-time localStorage→server migration on first load (upload existing local data)
