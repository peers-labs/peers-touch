# Module 5: Provider & Model Infrastructure — Reference Analysis

> Step 1b of the architecture design methodology.
> Source: LobeHub `src/store/aiInfra/`, `src/features/ModelSwitchPanel/`, `src/services/aiModel`, `src/services/aiProvider`
> Comparison: Peers-Touch `peers-ai-agent/apps/desktop/src/store/provider.ts`, `store/agent.ts`, `components/ModelSelect.tsx`

---

## 1. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         LOBEHUB PROVIDER & MODEL FLOW                            │
└─────────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────────┐         ┌────────────────────────┐
  │ Settings UI      │         │ Model Switch Panel     │
  │ (Provider CRUD)  │         │ (Chat Input trigger)   │
  └────────┬─────────┘         └──────────┬─────────────┘
           │                               │
           ▼                               ▼
  ┌────────────────────────────────────────────────────────────────┐
  │               ZUSTAND STORE: useAiInfraStore                   │
  │                                                                │
  │  ┌─────────────────────┐    ┌──────────────────────────────┐  │
  │  │ aiProvider slice     │    │ aiModel slice                 │  │
  │  │                     │    │                              │  │
  │  │ • aiProviderList    │    │ • aiProviderModelList        │  │
  │  │ • aiProviderDetail  │    │ • builtinAiModelList         │  │
  │  │ • enabledAiProviders│    │ • enabledAiModels            │  │
  │  │ • runtimeConfig     │    │ • enabledChatModelList       │  │
  │  │ • modelRedirects    │    │ • enabledImageModelList      │  │
  │  └─────────┬───────────┘    └──────────────┬───────────────┘  │
  │            │                                │                  │
  └────────────┼────────────────────────────────┼──────────────────┘
               │                                │
               ▼                                ▼
  ┌────────────────────────┐    ┌──────────────────────────────┐
  │ AiProviderService      │    │ AiModelService               │
  │ (tRPC lambdaClient)    │    │ (tRPC lambdaClient)          │
  │                        │    │                              │
  │ • getAiProviderList    │    │ • getAiProviderModelList     │
  │ • getAiProviderById    │    │ • toggleModelEnabled         │
  │ • toggleProviderEnabled│    │ • batchUpdateAiModels        │
  │ • updateAiProviderConf │    │ • createAiModel             │
  │ • getRuntimeState      │    │ • fetchRemoteModels (proxy)  │
  └────────────┬───────────┘    └──────────────┬───────────────┘
               │                                │
               ▼                                ▼
  ┌─────────────────────────────────────────────────────────────┐
  │                    SERVER (tRPC routers)                      │
  │    aiProvider.router  ←───→  DB (providers, configs)         │
  │    aiModel.router     ←───→  DB (models, enabled states)     │
  │    models.router      ←───→  Remote APIs (list models)       │
  └─────────────────────────────────────────────────────────────┘


  RUNTIME STATE FETCH (on login/init):
  ═══════════════════════════════════════════════════════════════
  Server → getAiProviderRuntimeState() →
    {
      enabledAiProviders,
      enabledChatAiProviders,
      enabledImageAiProviders,
      enabledVideoAiProviders,
      enabledAiModels[],          // all enabled models (flat)
      runtimeConfig{},            // per-provider keyVaults + settings
      modelRedirects{},           // retired → successor map
      hiddenBuiltinModels[],
    }
                    │
                    ▼
  Client resolves → builds typed model lists per category:
    enabledChatModelList: EnabledProviderWithModels[]
    enabledImageModelList: EnabledProviderWithModels[]
    enabledEmbeddingModelList: EnabledProviderWithModels[]
    enabledVideoModelList: EnabledProviderWithModels[]

  MODEL SELECTION FLOW:
  ═══════════════════════════════════════════════════════════════
  ModelSwitchPanel → useEnabledChatModels() → enabledChatModelList
                   → useBuildListItems(list, groupMode, search)
                   → user clicks model row
                   → usePanelHandlers.handleModelChange(modelId, providerId)
                   → agentStore.updateAgentConfig({ model, provider })
                   → persisted to agent config
```

---

## 2. State Machine

### Provider States

```
                        ┌────────────────┐
                        │   REGISTERED   │
                        │ (in provider   │
                        │   list, DB)    │
                        └───────┬────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                                   ▼
    ┌──────────────────┐              ┌──────────────────┐
    │     ENABLED      │              │    DISABLED      │
    │ (enabled=true)   │◄────────────►│ (enabled=false)  │
    │                  │  toggle       │                  │
    └────────┬─────────┘              └──────────────────┘
             │
    ┌────────┼────────────────────────┐
    │        │                        │
    ▼        ▼                        ▼
┌────────┐ ┌──────────┐  ┌───────────────────┐
│BUILTIN │ │ CUSTOM   │  │ LOADING           │
│(source:│ │(source:  │  │(aiProviderLoading- │
│builtin)│ │ custom)  │  │  Ids includes id) │
└────────┘ └──────────┘  └───────────────────┘

Additional runtime dimensions:
  • fetchOnClient: boolean — direct browser→API vs. server proxy
  • configUpdating: boolean — transient state during config save
  • keyVaults: { apiKey, baseURL, endpoint } — credential presence
```

### Model States

```
                    ┌──────────────────┐
                    │    REGISTERED    │
                    │ (in DB model     │
                    │  list for a      │
                    │  provider)       │
                    └───────┬──────────┘
                            │
           ┌────────────────┼────────────────┐
           ▼                                 ▼
  ┌─────────────────┐              ┌─────────────────┐
  │    ENABLED      │◄────────────►│   DISABLED      │
  │(enabled=true,   │   toggle     │(enabled=false)  │
  │ visible in      │              │                 │
  │ selection UI)   │              └─────────────────┘
  └────────┬────────┘
           │
  ┌────────┼────────────────────────────────────┐
  │        │                │                   │
  ▼        ▼                ▼                   ▼
┌────────┐ ┌────────┐ ┌──────────┐  ┌──────────────────┐
│BUILTIN │ │CUSTOM  │ │ REMOTE   │  │ HIDDEN(builtin   │
│(from   │ │(user-  │ │(fetched  │  │  model in hidden │
│model-  │ │created)│ │ from API)│  │  list = invisible│
│bank)   │ │        │ │          │  │  at panel level) │
└────────┘ └────────┘ └──────────┘  └──────────────────┘

Model abilities flags (per-model metadata):
  • functionCall, vision, reasoning, search, imageOutput, video, files, audio
  • contextWindowTokens: number
  • extendParams: string[] (reasoning sliders, image controls)
  • type: 'chat' | 'image' | 'embedding' | 'video'
```

### Agent ↔ Model Binding

```
  Agent Config:
    { model: string, provider: string }
           │
           ▼
  Resolved at chat time via:
    aiModelSelectors.getEnabledModelById(model, provider)
           │
           ▼
  Capabilities check:
    isModelSupportToolUse → functionCall ability
    isModelSupportVision  → vision ability
    isModelSupportReasoning → reasoning ability
           │
           ▼
  Runtime config resolution:
    aiProviderSelectors.isProviderFetchOnClient(provider)
    aiProviderSelectors.providerKeyVaults(provider)
    modelExtendParams → ControlsForm rendering
```

---

## 3. Architecture Mapping Table

| Concern | LobeHub | Peers-Touch (Current) | Gap / Notes |
|---------|---------|----------------------|-------------|
| **Store architecture** | `useAiInfraStore` (zustand) with 2 slices: `aiProvider` + `aiModel` | `useProviderStore` (zustand) — flat, single store | Peers lacks slice decomposition, no separate model slice |
| **Provider list state** | `aiProviderList: AiProviderListItem[]` with enabled/disabled/custom filtering | `providers: ProviderListItem[]` | Functionally equivalent, Peers is simpler |
| **Provider detail** | `aiProviderDetailMap: Record<id, Detail>` — cached per provider | `detail: ProviderDetail | null` — single active detail | Peers loses cache on switch; LobeHub retains all visited |
| **Runtime state** | `AiProviderRuntimeState` — server-aggregated: all enabled providers, models, key vaults, redirects | None — Peers loads individually | Major gap: no single runtime projection |
| **Model list (per-provider admin)** | `aiProviderModelList` via `useFetchAiProviderModels(id)` | Nested in `detail.models[]` | Peers couples models inside provider detail |
| **Enabled models (global runtime)** | `enabledAiModels: EnabledAiModel[]` + typed category lists (`enabledChatModelList`, etc.) | `availableModels: AvailableModel[]` in agent store | Peers has flat list; lacks category partitioning |
| **Model type categories** | 4 categories: chat, image, embedding, video — each has its own `EnabledProviderWithModels[]` | Single flat list (type field exists but no typed selectors) | Peers needs category-aware selectors for future multi-modal |
| **Model abilities** | `ModelAbilities` type: functionCall, vision, reasoning, search, imageOutput, video, files, audio | `AvailableModel` has: function_call, vision, reasoning, search, image_output, video | Near parity on fields; Peers lacks audio/files |
| **Builtin model bank** | `model-bank` package — default models loaded async, merged with DB state | Seeded at Station startup (hardcoded in Rust) | Peers has Station-side model bank; no client-side lazy resolution |
| **Hidden builtin models** | `hiddenBuiltinModels` — user-scoped server policy | None | Gap: no per-user model visibility policy |
| **Model redirects** | `modelRedirects: Record<retired, successor>` | None | Gap: no deprecation/redirect mechanism |
| **Provider config (keys)** | `AiProviderRuntimeConfig` per provider: `{ keyVaults, fetchOnClient, settings }` | Stored in `detail.api_key`, `detail.base_url` | Peers has equivalent data but no unified runtime projection |
| **Fetch routing** | `isProviderFetchOnClient` — dynamic client/server routing logic | Always server-side (Tauri backend proxies) | By design — Peers uses local Rust backend |
| **Remote model fetch** | `fetchRemoteModelList` → `modelsService.getModels(providerId)` → deduplicate → batch update DB | `fetchRemoteModels(providerId)` → returns list for user to confirm | Similar intent; Peers needs auto-merge capability |
| **Service layer** | `AiProviderService` + `AiModelService` — tRPC lambdaClient | `api.*` Tauri commands via `desktop_api.ts` | Different transport (tRPC vs Tauri IPC); same semantics |
| **Model Switch Panel** | Full feature: dropdown popup, search, group by model/provider, benchmark radar, pricing, controls form | `ModelSelect` — antd Select with grouped options | Major UX gap: Peers has basic dropdown only |
| **Reasoning controls** | `ControlsForm` — per-model `extendParams` drives which sliders show (30+ model-specific variants) | None in model selection; basic chat config in agent settings | Gap: no inline model parameter tuning at chat input |
| **Benchmark/Rating** | `BenchmarkModal` — radar chart comparison with ModelRating data | None | Gap: no model comparison UI |
| **SWR caching** | `useClientDataSWR` + `mutate` pattern for all fetches | Direct imperative `await api.x()` → `set()` | Peers lacks stale-while-revalidate; always shows loading |
| **Optimistic updates** | Immediate local state update → then server refresh (e.g., toggleProviderEnabled) | Reload entire provider list after mutation | Gap: no optimistic UI |
| **Provider sorting** | `updateAiProviderSort(items: AiProviderSortMap[])` — drag-and-drop reorder | Sort field exists but no UI for reorder | Minor gap |
| **Model sorting** | `updateAiModelsSort(id, items: AiModelSortMap[])` | None | Minor gap |
| **Search/filter** | `providerSearchKeyword` + `modelSearchKeyword` in store; `filteredAiProviderModelList` selector | Search in `ModelSelect` via antd's `filterOption` | LobeHub is more structured; Peers uses built-in antd filter |
| **Provider source types** | `AiProviderSourceEnum: Builtin | Custom` | Implicit (all are user-configured) | Peers has no builtin provider concept on client |
| **Multi-store coordination** | `refreshAiProviderRuntimeState` after model/provider changes propagates to all consumers | `useAgentStore.getState().loadModels()` called manually | Same intent; Peers is more coupled |

---

## 4. Key Function Signatures

### LobeHub Store Actions — Provider Slice

```typescript
// Store creation
export const createAiProviderSlice: (set, get, _api?) => AiProviderActionImpl;

// Provider CRUD
createNewAiProvider(params: CreateAiProviderParams): Promise<void>;
deleteAiProvider(id: string): Promise<void>;
updateAiProvider(id: string, value: UpdateAiProviderParams): Promise<void>;
updateAiProviderConfig(id: string, value: UpdateAiProviderConfigParams): Promise<void>;
updateAiProviderSort(items: AiProviderSortMap[]): Promise<void>;

// Provider toggle
toggleProviderEnabled(id: string, enabled: boolean): Promise<void>;

// Data fetching (SWR hooks)
useFetchAiProviderList(opts?: { enabled?: boolean }): SWRResponse<AiProviderListItem[]>;
useFetchAiProviderItem(id: string): SWRResponse<AiProviderDetailItem | undefined>;
useFetchAiProviderRuntimeState(
  isLoginOnInit: boolean | undefined,
  isSyncActive?: boolean
): SWRResponse<AiProviderRuntimeStateWithBuiltinModels | undefined>;

// Internal refresh
refreshAiProviderList(): Promise<void>;
refreshAiProviderDetail(): Promise<void>;
refreshAiProviderRuntimeState(): Promise<void>;
ensureAiProviderRuntimeStateReady(timeoutMs?: number): Promise<void>;

// Internal UI state
internal_toggleAiProviderLoading(id: string, loading: boolean): void;
internal_toggleAiProviderConfigUpdating(id: string, loading: boolean): void;
```

### LobeHub Store Actions — Model Slice

```typescript
export const createAiModelSlice: (set, get, _api?) => AiModelActionImpl;

// Model CRUD
createNewAiModel(data: CreateAiModelParams): Promise<void>;
removeAiModel(id: string, providerId: string): Promise<void>;
updateAiModelsConfig(id: string, providerId: string, data: Partial<AiProviderModelListItem>): Promise<void>;

// Model toggle
toggleModelEnabled(params: Omit<ToggleAiModelEnableParams, 'providerId'>): Promise<void>;
toggleProviderModelEnabled(params: ToggleAiModelEnableParams): Promise<void>;
batchToggleAiModels(ids: string[], enabled: boolean): Promise<void>;

// Batch operations
batchUpdateAiModels(models: AiProviderModelListItem[]): Promise<void>;
updateAiModelsSort(id: string, items: AiModelSortMap[]): Promise<void>;

// Remote model discovery
fetchRemoteModelList(providerId: string): Promise<void>;

// Admin list fetching
useFetchAiProviderModels(id: string): SWRResponse<AiProviderModelListItem[]>;

// Cleanup
clearModelsByProvider(provider: string): Promise<void>;
clearRemoteModels(provider: string): Promise<void>;
```

### LobeHub Service Methods

```typescript
// AiProviderService
class AiProviderService {
  createAiProvider(params: CreateAiProviderParams): Promise<...>;
  getAiProviderList(): Promise<AiProviderListItem[]>;
  getAiProviderById(id: string): Promise<AiProviderDetailItem | undefined>;
  toggleProviderEnabled(id: string, enabled: boolean): Promise<...>;
  updateAiProvider(id: string, value: any): Promise<...>;
  updateAiProviderConfig(id: string, value: UpdateAiProviderConfigParams): Promise<...>;
  updateAiProviderOrder(items: AiProviderSortMap[]): Promise<...>;
  deleteAiProvider(id: string): Promise<...>;
  getAiProviderRuntimeState(isLogin?: boolean): Promise<AiProviderRuntimeState>;
}

// AiModelService
class AiModelService {
  createAiModel(params: CreateAiModelParams): Promise<...>;
  getAiProviderModelList(id: string, params?: GetAiProviderModelListParams): Promise<AiProviderModelListItem[]>;
  getAiModelById(id: string): Promise<...>;
  toggleModelEnabled(params: ToggleAiModelEnableParams): Promise<...>;
  updateAiModel(id: string, providerId: string, value: UpdateAiModelParams): Promise<...>;
  batchUpdateAiModels(id: string, models: AiProviderModelListItem[]): Promise<...>;
  batchToggleAiModels(id: string, models: string[], enabled: boolean): Promise<...>;
  clearModelsByProvider(providerId: string): Promise<...>;
  clearRemoteModels(providerId: string): Promise<...>;
  updateAiModelOrder(providerId: string, items: AiModelSortMap[]): Promise<...>;
  deleteAiModel(params: { id: string; providerId: string }): Promise<...>;
}
```

### LobeHub Key Selectors

```typescript
// Provider selectors
aiProviderSelectors.enabledAiProviderList(s): AiProviderListItem[];
aiProviderSelectors.isProviderEnabled(id)(s): boolean;
aiProviderSelectors.isProviderFetchOnClient(provider)(s): boolean;
aiProviderSelectors.providerConfigById(id)(s): AiProviderRuntimeConfig | undefined;
aiProviderSelectors.providerKeyVaults(provider)(s): KeyVaults | undefined;
aiProviderSelectors.activeProviderConfig(s): AiProviderDetailItem | undefined;

// Model selectors
aiModelSelectors.enabledAiProviderModelList(s): AiProviderModelListItem[];
aiModelSelectors.getEnabledModelById(id, provider)(s): EnabledAiModel | undefined;
aiModelSelectors.getModelCard(model, provider)(s): EnabledAiModel | LobeDefaultAiModelListItem;
aiModelSelectors.isModelSupportToolUse(id, provider)(s): boolean;
aiModelSelectors.isModelSupportVision(id, provider)(s): boolean;
aiModelSelectors.isModelSupportReasoning(id, provider)(s): boolean;
aiModelSelectors.modelExtendParams(id, provider)(s): string[] | undefined;
aiModelSelectors.modelContextWindowTokens(id, provider)(s): number | undefined;
```

### LobeHub ModelSwitchPanel Hooks

```typescript
// Resolve current model/provider from props or agent store
useModelAndProvider(modelProp?: string, providerProp?: string): { model, provider };

// Build virtualized list items from enabled providers+models
useBuildListItems(
  enabledList: EnabledProviderWithModels[],
  groupMode: GroupMode,            // 'byModel' | 'byProvider'
  searchKeyword?: string,
  sortModelLast?: (modelId, providerId) => boolean
): ListItem[];

// Handle model selection change
usePanelHandlers({ onModelChange?, onOpenChange? }): {
  handleModelChange: (modelId: string, providerId: string) => void;
  handleClose: () => void;
};
```

### Peers-Touch Current Signatures (for comparison)

```typescript
// Provider store
interface ProviderState {
  providers: ProviderListItem[];
  selectedId: string | null;
  detail: ProviderDetail | null;
  loading: boolean;

  loadProviders(): Promise<void>;
  selectProvider(id: string, skipLoading?: boolean): Promise<void>;
  updateProvider(id: string, apiKey: string, baseUrl: string, enabled: boolean): Promise<void>;
  toggleProvider(id: string, enabled: boolean): Promise<void>;
  checkProvider(id: string, apiKey?: string, baseUrl?: string, model?: string): Promise<{ ok: boolean; error?: string }>;
  createProvider(data: {...}): Promise<void>;
  deleteProvider(id: string): Promise<void>;
  addModel(providerId: string, data: {...}): Promise<void>;
  updateModel(providerId: string, modelId: string, data: {...}): Promise<void>;
  deleteModel(providerId: string, modelId: string): Promise<void>;
  fetchRemoteModels(providerId: string, apiKey?: string, baseUrl?: string): Promise<{...}>;
  toggleModel(providerId: string, modelId: string, enabled: boolean): Promise<void>;
  toggleAllModels(providerId: string, enabled: boolean): Promise<void>;
}

// Agent store (model selection)
interface AgentState {
  selectedModel: string;
  selectedProviderId: string;
  availableModels: AvailableModel[];
  setSelectedModel(model: string, providerId?: string): void;
  loadModels(): Promise<void>;
}
```

---

## 5. Key Architectural Insights

### LobeHub Design Principles

1. **Runtime State Projection**: A single `getAiProviderRuntimeState()` call returns the complete view of all enabled providers/models/configs. This is the "materialized view" pattern — the server pre-computes what the client needs.

2. **Slice Decomposition**: Provider management (admin) and model management (admin) are separate slices, but share a single store namespace. The runtime projection (what models are available for chat) is a computed derivation.

3. **Category-Typed Model Lists**: Models are partitioned by type (`chat`, `image`, `embedding`, `video`) at the store level, not at the component level. Each category has its own `EnabledProviderWithModels[]`.

4. **Model Bank + Runtime Merge**: Builtin models from `model-bank` are merged with DB-persisted state, with visibility governed by `hiddenBuiltinModels` policy.

5. **Optimistic + SWR**: All mutations do immediate local state update, then trigger SWR revalidation for eventual consistency.

6. **ModelSwitchPanel as Feature**: The model picker is a full "feature" (not just a component) with its own hooks, state management, grouping logic, search, pricing, benchmarks, and per-model runtime controls.

### Gaps to Close in Peers-Touch

| Priority | Gap | Recommended Approach |
|----------|-----|---------------------|
| P0 | No unified runtime state projection | Add `getProviderRuntimeState` Tauri command; populate typed category lists |
| P0 | No model abilities selectors | Add selector layer wrapping `availableModels` with capability queries |
| P1 | Basic model picker | Build `ModelSwitchPanel` feature with search + group modes |
| P1 | No per-model runtime controls | Add `extendParams` to model schema; render ControlsForm in chat input |
| P2 | No model category partitioning | Add type-aware filtering (chat/image/embedding/video) |
| P2 | No optimistic updates | Adopt SWR-like pattern or manual optimistic set + revalidate |
| P3 | No model benchmarks | Future feature: rating data integration |
| P3 | No model redirect/deprecation | Add redirect map to runtime state |
