# Module 4: Agent Config & Profile — Reference Implementation Analysis

> Step 1b of architecture design methodology.
> Source: LobeHub `src/features/AgentSetting/`, `src/store/agent/`, `src/services/agent.ts`
> Comparand: Peers-Touch `peers-ai-agent/apps/desktop/src/store/agent.ts`, `AgentSettingsModal.tsx`

---

## 1. Data Flow Diagram

```
                          LobeHub Agent Config CRUD Flow
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │                                                                              │
 │  ┌──────────────────────┐        ┌─────────────────────┐                    │
 │  │ AgentSettingsProvider │───────▶│  Feature Store      │                    │
 │  │ (Context + StoreUp-  │        │  (zustand context)  │                    │
 │  │  dater injects props)│        │                     │                    │
 │  └──────────────────────┘        │  State:             │                    │
 │           │                      │   - config          │                    │
 │           │ props: config,       │   - meta            │                    │
 │           │ meta, onConfigChange │   - saveStatus      │                    │
 │           │ onMetaChange         │   - loadingState    │                    │
 │           ▼                      └─────────┬───────────┘                    │
 │  ┌──────────────────────┐                  │                                │
 │  │  UI Components       │                  │ dispatchConfig / dispatchMeta   │
 │  │  - AgentMeta         │◀─────────────────┘                                │
 │  │  - AgentOpening      │         │                                         │
 │  │  - AgentConnectors   │         ▼  onConfigChange / onMetaChange          │
 │  │  - AgentGraphRuntime │  ┌──────────────────────────────────────┐         │
 │  │  - AgentSelfIteration│  │  Global Agent Store                  │         │
 │  └──────────────────────┘  │  (src/store/agent/)                  │         │
 │                            │                                      │         │
 │                            │  updateAgentConfigById()              │         │
 │                            │    1. optimistic dispatch to agentMap │         │
 │                            │    2. call agentService               │         │
 │                            │    3. reconcile server response       │         │
 │                            │    4. SWR mutate for cache coherence  │         │
 │                            └──────────────┬───────────────────────┘         │
 │                                           │                                 │
 │                                           ▼                                 │
 │                            ┌──────────────────────────────┐                 │
 │                            │  AgentService (tRPC client)  │                 │
 │                            │  - updateAgentConfig()       │                 │
 │                            │  - updateAgentMeta()         │                 │
 │                            │  - getAgentConfigById()      │                 │
 │                            │  - createAgent()             │                 │
 │                            │  - removeAgent()             │                 │
 │                            └──────────────┬───────────────┘                 │
 │                                           │                                 │
 │                                           ▼                                 │
 │                            ┌──────────────────────────────┐                 │
 │                            │  Server (tRPC router)        │                 │
 │                            │  agents table (PostgreSQL)   │                 │
 │                            └──────────────────────────────┘                 │
 └──────────────────────────────────────────────────────────────────────────────┘
```

### Runtime Reach

The agent config stored in `agentMap[agentId]` is consumed by:
- **Chat runtime** — reads `systemRole`, `model`, `provider`, `plugins`, `chatConfig` (history, search, memory, agent mode)
- **Knowledge engine** — reads `knowledgeBases[]`, `files[]`, `agencyConfig.workingDirByDevice`
- **Opening UX** — reads `openingMessage`, `openingQuestions`
- **Agent mode** — reads `chatConfig.enableAgentMode`, `chatConfig.selfIteration`
- **Graph runtime** — reads `chatConfig.enableGraphMode`, `chatConfig.graph`

---

## 2. State Machine

```
                  Agent Config Settings Panel States
 ┌──────────────────────────────────────────────────────────────┐
 │                                                              │
 │         ┌─────────┐                                         │
 │         │ LOADING │  (isAgentConfigLoading = true)           │
 │         └────┬────┘                                         │
 │              │  useFetchAgentConfig resolves                 │
 │              ▼                                               │
 │         ┌─────────┐                                         │
 │    ┌───▶│  IDLE   │  saveStatus='idle'                      │
 │    │    └────┬────┘                                         │
 │    │         │  user edits field                             │
 │    │         ▼                                               │
 │    │    ┌─────────┐                                         │
 │    │    │ SAVING  │  saveStatus='saving'                    │
 │    │    └────┬────┘                                         │
 │    │         │                                              │
 │    │    ┌────┴─────────────────┐                            │
 │    │    │                      │                            │
 │    │    ▼                      ▼                            │
 │    │ ┌───────┐           ┌─────────┐                       │
 │    │ │ SAVED │           │  ERROR  │  (toast shown)         │
 │    │ └───┬───┘           └────┬────┘                       │
 │    │     │ (auto-reset)       │ (user retries / dismisses) │
 │    └─────┴────────────────────┘                            │
 │                                                              │
 │  Special sub-states:                                        │
 │    - NOT_FOUND: agentNotFoundMap[id]=true (404 card)        │
 │    - CONFIG_ERROR: agentConfigErrorMap[id] (retry UI)       │
 │    - STREAMING_SYSTEM_ROLE: streamingSystemRoleInProgress   │
 └──────────────────────────────────────────────────────────────┘
```

### Feature Store (scoped to settings panel) — reducer-driven:

| Dispatch Type | Effect |
|---------------|--------|
| `config.update` | Deep-merge partial config via immer |
| `config.togglePlugin` | Upsert plugin mode (pinned/auto/disabled) |
| `config.reset` | Reset to DEFAULT_AGENT_CONFIG |
| `meta.update` | Deep-merge partial meta |
| `meta.reset` | Reset to DEFAULT_AGENT_META |

### Autocomplete sub-states (per meta field):

```
loadingState[field] = false
       │ trigger autocomplete
       ▼
loadingState[field] = true  ←── streaming chunks via chatService.fetchPresetTaskResult
       │ finish / error
       ▼
loadingState[field] = false
```

---

## 3. Architecture Mapping Table

| Concern | LobeHub | Peers-Touch (Current) | Gap / Notes |
|---------|---------|----------------------|-------------|
| **Global agent store** | `src/store/agent/` — zustand, class-based slices, SWR data fetching | `store/agent.ts` — zustand, flat functions, manual fetch | PT lacks slice decomposition, SWR caching, and optimistic updates |
| **Agent state shape** | `agentMap: Record<id, PartialDeep<AgentItem>>` — multi-agent, lazy-loaded | `agents: Agent[]` — array, fully loaded upfront | PT cannot efficiently handle many agents; no per-agent lazy config |
| **Config persistence** | tRPC `lambdaClient.agent.updateAgentConfig.mutate` — server-owned, partial deep merge | `api.updateAgent(id, payload)` — Tauri IPC → Station gRPC | PT uses full-field overwrite, no partial deep merge |
| **Feature-scoped store** | `AgentSettingsProvider` wraps a dedicated zustand context with `StoreUpdater` | None — `AgentSettingsModal` holds all state in local `useState` | PT has no reusable settings provider; no reducer pattern |
| **Settings tabs** | `AgentCategory` menu: Prompt, Opening, SelfIteration, Connector, Graph | 2 tabs: Info, Opening | PT missing: system prompt editing, plugins/connectors, graph mode, self-iteration |
| **Meta autocomplete** | AI-driven: `autoPickEmoji`, `autocompleteAgentTitle/Description/Tags` via LLM streaming | None | PT has no AI-assisted meta generation |
| **Optimistic update** | Full pattern: dispatch → UI → API → reconcile → rollback on error | Partial: optimistic array update → API → revert on error | Similar shape but PT lacks abort controllers and per-field granularity |
| **Save status** | `SaveStatus: 'idle' | 'saving' | 'saved'` with `lastUpdatedTime` | Implicit via `pendingMutations` map | PT lacks explicit save indicator UX |
| **Knowledge binding** | `KnowledgeSlice`: addFiles, addKnowledgeBase, toggle, remove | Proto-defined `AgentKnowledgeBinding` with CRUD; runtime in `agent-runtime-config.ts` | PT has proto schema but limited UI integration |
| **Plugin/Skill binding** | `PluginSlice`: togglePlugin, setPluginMode (pinned/auto/disabled) | `toggleApplet(id)` — binary on/off | PT lacks tri-state plugin modes |
| **Opening message** | Dedicated `AgentOpening` component: message textarea + sortable questions list | In `AgentSettingsModal` "opening" tab: message + question list | Comparable but PT lacks LobeUI form integration |
| **System role streaming** | `startStreamingSystemRole`, `appendStreamingSystemRole`, `finishStreamingSystemRole` | None | PT has no streaming system role generation |
| **Background color** | `BackgroundSwatches` with full color picker | Inline color swatch buttons | PT more basic; no custom color picker |
| **Agent mode** | `chatConfig.enableAgentMode`, `selfIteration.enabled`, `enableGraphMode` | No equivalent runtime modes | PT is purely chat-based; no agent mode / graph mode |
| **Working directory** | Per-device `agencyConfig.workingDirByDevice`, local override via localStorage | Single `workspaceRoot` in `AgentRuntimeConfig` | PT simpler; no multi-device directory management |
| **Service layer** | `AgentService` class with 20+ methods, tRPC-backed | `desktop_api.ts` with `updateAgent`, `listAgentsWithMeta` | PT has far fewer service methods |
| **Selectors** | 40+ selectors covering every config facet, composable | None — direct `get().agents.find(...)` | PT lacks selector layer entirely |
| **Error states** | `agentConfigErrorMap`, `agentNotFoundMap`, retry mechanism | Single `error: string | null` | PT lacks per-agent error isolation |
| **Connectors** | `AgentConnectors` toggles external service connections via plugin system | None | PT has no connector concept yet |
| **Transfer/Visibility** | `transferAgent`, `setAgentVisibility`, workspace scoping | None | PT is single-user; no workspace visibility |

---

## 4. Key Function Signatures

### 4.1 Global Agent Store Actions (`src/store/agent/slices/agent/action.ts`)

```typescript
// Core CRUD
createAgent(params: CreateAgentParams): Promise<CreateAgentResult>
updateAgentConfig(config: PartialDeep<LobeAgentConfig>, options?: AgentConfigUpdateOptions): Promise<void>
updateAgentConfigById(agentId: string, config: PartialDeep<LobeAgentConfig>, options?: AgentConfigUpdateOptions): Promise<void>
updateAgentMeta(meta: AgentMetaUpdate): Promise<void>
updateAgentMetaById(agentId: string, meta: AgentMetaUpdate): Promise<void>
updateAgentChatConfig(config: Partial<LobeAgentChatConfig>, options?: AgentConfigUpdateOptions): Promise<void>
updateAgentRuntimeEnvConfigById(agentId: string, config: Partial<RuntimeEnvConfig>): Promise<void>

// Streaming system role
startStreamingSystemRole(agentId: string): number  // returns generation token
appendStreamingSystemRole(agentId: string, generation: number, chunk: string): void
finishStreamingSystemRole(agentId: string, generation: number): Promise<void>

// Optimistic persistence
optimisticUpdateAgentConfig(id: string, data: PartialDeep<LobeAgentConfig>, signal?: AbortSignal, options?: AgentConfigUpdateOptions): Promise<void>
optimisticUpdateAgentMeta(id: string, meta: AgentMetaUpdate, signal?: AbortSignal): Promise<void>

// SWR fetch hooks
useFetchAgentConfig(isLogin: boolean | undefined, agentId: string): SWRResponse<LobeAgentConfig>
useFetchAvailableAgents(enabled: boolean): SWRResponse<AvailableAgentItem[]>

// Internals
internal_dispatchAgentMap(id: string, config: PartialDeep<LobeAgentConfig>): void
internal_refreshAgentConfig(id: string): Promise<void>

// UI state
setActiveAgentId(agentId?: string): void
toggleAgentPinned(): void
updateSaveStatus(status: SaveStatus): void
updateLoadingState(key: keyof LoadingState, value: boolean): void
```

### 4.2 Knowledge Slice (`src/store/agent/slices/knowledge/action.ts`)

```typescript
addFilesToAgent(fileIds: string[], enabled?: boolean): Promise<void>
addKnowledgeBaseToAgent(knowledgeBaseId: string): Promise<void>
removeFileFromAgent(fileId: string): Promise<void>
removeKnowledgeBaseFromAgent(knowledgeBaseId: string): Promise<void>
toggleFile(id: string, open?: boolean): Promise<void>
toggleKnowledgeBase(id: string, open?: boolean): Promise<void>
useFetchFilesAndKnowledgeBases(agentId?: string, visibility?: 'private' | 'public'): SWRResponse<KnowledgeItem[]>
```

### 4.3 Plugin Slice (`src/store/agent/slices/plugin/action.ts`)

```typescript
togglePlugin(id: string, open?: boolean): Promise<void>
setPluginMode(id: string, mode: AgentPluginMode): Promise<void>  // 'pinned' | 'auto' | 'disabled'
removePlugin(id: string): Promise<void>
```

### 4.4 Feature Store (Settings Panel) (`src/features/AgentSetting/store/action.ts`)

```typescript
// Dispatch (reducer-driven)
dispatchConfig(payload: ConfigDispatch): Promise<void>
dispatchMeta(payload: MetaDataDispatch): Promise<void>

// High-level setters (call dispatch internally)
setAgentConfig(config: PartialDeep<LobeAgentConfig>): Promise<void>
setAgentMeta(meta: Partial<MetaData>): Promise<void>
setChatConfig(config: Partial<LobeAgentChatConfig>): Promise<void>
toggleAgentPlugin(pluginId: string, state?: boolean): void
resetAgentConfig(): Promise<void>
resetAgentMeta(): Promise<void>

// AI autocomplete
autocompleteAgentTitle(): Promise<void>
autocompleteAgentDescription(): Promise<void>
autocompleteAgentTags(): Promise<void>
autoPickEmoji(): Promise<void>
autocompleteAllMeta(replace?: boolean): void
autocompleteMeta(key: keyof MetaData): void
```

### 4.5 Agent Service (`src/services/agent.ts`)

```typescript
class AgentService {
  createAgent(params: CreateAgentParams): Promise<CreateAgentResult>
  getAgentConfigById(agentId: string): Promise<LobeAgentConfig | null>
  updateAgentConfig(agentId: string, config: PartialDeep<LobeAgentConfig>, signal?: AbortSignal): Promise<{ success: boolean; agent?: AgentItem }>
  updateAgentMeta(agentId: string, meta: AgentMetaUpdate, signal?: AbortSignal): Promise<{ success: boolean; agent?: AgentItem }>
  removeAgent(agentId: string): Promise<void>
  duplicateAgent(agentId: string, newTitle?: string): Promise<{ agentId: string } | null>
  queryAgents(params?: { keyword?: string; limit?: number; offset?: number }): Promise<AvailableAgentItem[]>
  transferAgent(agentId: string, targetWorkspaceId: string | null, targetVisibility?: 'private' | 'public'): Promise<{ agentId: string; slug: string | null }>

  // Knowledge
  createAgentKnowledgeBase(agentId: string, knowledgeBaseId: string, enabled?: boolean): Promise<...>
  deleteAgentKnowledgeBase(agentId: string, knowledgeBaseId: string): Promise<...>
  toggleKnowledgeBase(agentId: string, knowledgeBaseId: string, enabled?: boolean): Promise<...>
  createAgentFiles(agentId: string, fileIds: string[], enabled?: boolean): Promise<...>
  deleteAgentFile(agentId: string, fileId: string): Promise<...>
  toggleFile(agentId: string, fileId: string, enabled?: boolean): Promise<...>
  getFilesAndKnowledgeBases(agentId: string, visibility?: 'private' | 'public'): Promise<...>
}
```

### 4.6 Component Props

```typescript
// Settings Provider (top-level wrapper)
interface AgentSettingsProps {
  children: ReactNode;
  config?: LobeAgentConfig;
  meta?: MetaData;
  id?: string;
  disabled?: boolean;
  loading?: boolean;
  onConfigChange?: (config: LobeAgentConfig) => void;
  onMetaChange?: (meta: MetaData) => void;
  instanceRef?: ForwardedRef<AgentSettingsInstance>;
}

// Public hook API exposed via ref
interface AgentSettingsInstance {
  autoPickEmoji(): Promise<void>;
  autocompleteAgentTitle(): Promise<void>;
  autocompleteAgentDescription(): Promise<void>;
  autocompleteAgentTags(): Promise<void>;
  autocompleteAllMeta(replace?: boolean): void;
  autocompleteMeta(key: keyof MetaData): void;
}

// Content renderer
interface AgentSettingsContentProps {
  loadingSkeleton: ReactNode;
  tab: ChatSettingsTabs;  // 'prompt' | 'opening' | 'selfIteration' | 'connector' | 'graph'
}

// Category navigation
interface CategoryContentProps {
  setTab: (tab: ChatSettingsTabs) => void;
  tab: string;
}
```

### 4.7 Peers-Touch Current Equivalents

```typescript
// store/agent.ts
interface AgentState {
  agents: Agent[];
  selectedAgent: string;
  availableModels: AvailableModel[];
  selectedModel: string;
  // ...
  updateAgentProfile(agentId: string, updates: Partial<AgentCreate>): Promise<Agent>;
  updateAgentConfig(agentName: string, updates: { chatConfig?: Partial<AgentChatConfig> }): Promise<void>;
  getCurrentAgentChatConfig(): AgentChatConfig;
}

// AgentSettingsModal.tsx
interface AgentSettingsModalProps {
  open: boolean;
  agent: Agent;
  onClose: () => void;
  onSaved: (agent: Agent) => void;
}

// services/agent-runtime-config.ts
interface AgentRuntimeConfig {
  workspaceRoot?: string;
  contextWindowSize?: number;
  maxRetries?: number;
  knowledgeResources?: AgentExecuteTurnKnowledgeResource[];
  identity?: string;
  agentConfigPrompt?: string;
  effort?: string;
  provider?: string;
  model?: string;
  cliCommand?: string;
  workspaceMode?: string;
  runtimeBackend?: string;
  rootfsPath?: string;
  allowedRoots?: string[];
}
```

---

## 5. Key Design Patterns Identified

### 5.1 Two-Store Architecture (LobeHub)

LobeHub uses a **global agent store** (singleton, app-wide) alongside a **feature-scoped store** (per settings panel instance). The feature store receives config/meta as props via `StoreUpdater` and fires `onConfigChange`/`onMetaChange` callbacks upward. This allows:
- Multiple settings panels open simultaneously without state collision
- Reducer-based local mutations with async persistence callbacks
- Imperative handle via `instanceRef` for programmatic autocomplete triggers

### 5.2 Optimistic Update with Abort Control

Every config/meta write follows:
1. Create scoped `AbortController` (cancels previous in-flight for same agent)
2. Optimistic dispatch to `agentMap`
3. API call with signal
4. On success: reconcile with server response, refresh SWR
5. On error: show toast, rollback agency config patches, rethrow if requested

### 5.3 AI-Driven Meta Generation

The feature store integrates LLM streaming for meta fields (title, description, tags, emoji) using `chatService.fetchPresetTaskResult` with chain prompts. Each field tracks independent loading state and supports error recovery to previous value.

### 5.4 Selector Composition

40+ atomic selectors compose config access (e.g., `currentAgentModel`, `currentAgentPlugins`, `hasKnowledge`). This enables fine-grained re-render control and consistent default-value logic across the app.

---

## 6. Recommendations for Peers-Touch Adaptation

1. **Adopt two-store pattern**: Global agent store for lifecycle + settings provider for editing.
2. **Implement selector layer**: Replace direct `agents.find(...)` with composable selectors.
3. **Add slice decomposition**: Split knowledge/skill/MCP bindings into separate action classes.
4. **Use SWR or equivalent cache**: Replace manual `loadAgents()` with cache-key-based fetching.
5. **Proto-first config model**: Existing `AgentKnowledgeBinding`, `AgentSkillBinding`, `AgentMcpBinding` protos align well with LobeHub's knowledge/plugin slices.
6. **Streaming system role**: Plan for LLM-generated system prompts (already architecturally possible via Station chat service).
7. **Optimistic persistence**: Add abort controllers and per-agent save status tracking.
8. **Settings tabs**: Expand from 2 tabs (Info, Opening) to full set (Prompt, Opening, Knowledge, Skills/MCP, Runtime).
