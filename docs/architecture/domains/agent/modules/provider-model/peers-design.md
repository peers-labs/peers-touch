# Module 5: Provider & Model Infrastructure — Architecture Design

> Step 2 (S2) of the architecture design methodology.
> Scope: P0 enhancements to provider CRUD, model picker UI, and provider settings.
> Deferred (P2): benchmark comparison, per-model reasoning sliders, remote model list fetch (Ollama/external).

---

## 1. Architecture Overview

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    PEERS-TOUCH PROVIDER & MODEL FLOW                      │
└─────────────────────────────────────────────────────────────────────────┘

  ┌───────────────────────┐         ┌─────────────────────────────┐
  │ Provider Settings Page│         │ Model Switch Panel           │
  │ (CRUD + credentials) │         │ (Chat Input popover trigger) │
  └──────────┬────────────┘         └──────────────┬──────────────┘
             │                                     │
             ▼                                     ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    ZUSTAND: useProviderStore                          │
  │                                                                     │
  │  State:                                                             │
  │    providers: ProviderListItem[]       (admin list)                  │
  │    selectedId: string | null           (settings active)            │
  │    detail: ProviderDetail | null       (settings form)              │
  │    loading: boolean                                                  │
  │    providerLoadingIds: Set<string>     (per-provider operations)    │
  │                                                                     │
  │  Actions:                                                           │
  │    loadProviders, selectProvider, createProvider, deleteProvider,    │
  │    updateProvider, toggleProvider, checkProvider,                    │
  │    addModel, updateModel, deleteModel, toggleModel, toggleAllModels,│
  │    fetchRemoteModels                                                │
  └──────────────────────────────┬──────────────────────────────────────┘
                                 │
  ┌──────────────────────────────┼──────────────────────────────────────┐
  │                    ZUSTAND: useAgentStore                             │
  │                                                                     │
  │  State:                                                             │
  │    availableModels: AvailableModel[]   (runtime projection)         │
  │    defaultModel: string                                              │
  │    selectedModel: string                                            │
  │    selectedProviderId: string                                       │
  │                                                                     │
  │  Actions:                                                           │
  │    loadModels() → api.listAvailableModels()                         │
  │    setSelectedModel(model, provider)                                 │
  └──────────────────────────────┬──────────────────────────────────────┘
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │              desktop_api.ts  →  Tauri IPC Commands                    │
  │                                                                     │
  │  listProviders, getProvider, createProvider, updateProvider,          │
  │  deleteProvider, checkProvider, addModel, updateModel, deleteModel,  │
  │  toggleModel, toggleAllModels, fetchRemoteModels,                   │
  │  listAvailableModels                                                │
  └──────────────────────────────┬──────────────────────────────────────┘
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │              RUST BFF (src-tauri/src/commands/provider.rs)            │
  │                                                                     │
  │  Proxies to Station ProviderService gRPC                             │
  └──────────────────────────────┬──────────────────────────────────────┘
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │              STATION: ProviderService (Go + PostgreSQL)               │
  │                                                                     │
  │  Owns: provider registry, model registry, credential storage,       │
  │        model ability metadata, enabled state                         │
  └─────────────────────────────────────────────────────────────────────┘
```

### Ownership

| Layer | Owner | Responsibility |
|-------|-------|---------------|
| Station | `ProviderService` | Source of truth for providers, models, credentials |
| Rust BFF | `commands/provider.rs` | Tauri IPC bridge, no business logic |
| Desktop TS | `useProviderStore` | Provider admin (settings page) |
| Desktop TS | `useAgentStore.availableModels` | Runtime projection for chat model selection |
| Desktop TS | `ModelProviderSelect` | Model picker UI (popover in chat input) |
| Desktop TS | Provider Settings Page | Provider CRUD UI |

---

## 2. Enhanced Provider Store

### Current State (preserved)

The existing `useProviderStore` already has a well-structured CRUD interface. The P0 enhancement adds:

1. **Per-provider loading state** for optimistic UX during toggle/save.
2. **Provider detail cache** to avoid flicker on re-selection.
3. **Cross-store notification** refinement (already exists via `useAgentStore.getState().loadModels()`).

### Enhanced State Shape

```typescript
interface ProviderState {
  // --- Existing (unchanged) ---
  providers: ProviderListItem[];
  selectedId: string | null;
  detail: ProviderDetail | null;
  loading: boolean;

  // --- P0 Additions ---
  providerLoadingIds: Set<string>;       // per-provider toggle/save loading
  detailCache: Map<string, ProviderDetail>; // avoids full reload on re-select

  // --- Existing Actions (unchanged) ---
  loadProviders(): Promise<void>;
  selectProvider(id: string, skipLoading?: boolean): Promise<void>;
  updateProvider(id: string, apiKey: string, baseUrl: string, enabled: boolean): Promise<void>;
  toggleProvider(id: string, enabled: boolean): Promise<void>;
  checkProvider(id: string, apiKey?: string, baseUrl?: string, model?: string): Promise<CheckResult>;
  createProvider(data: CreateProviderParams): Promise<void>;
  deleteProvider(id: string): Promise<void>;
  addModel(providerId: string, data: AddModelParams): Promise<void>;
  updateModel(providerId: string, modelId: string, data: UpdateModelParams): Promise<void>;
  deleteModel(providerId: string, modelId: string): Promise<void>;
  fetchRemoteModels(providerId: string, apiKey?: string, baseUrl?: string): Promise<FetchResult>;
  toggleModel(providerId: string, modelId: string, enabled: boolean): Promise<void>;
  toggleAllModels(providerId: string, enabled: boolean): Promise<void>;

  // --- P0 New Actions ---
  refreshAfterMutation(providerId?: string): Promise<void>;  // consolidates post-mutation refresh
}
```

### Behavioral Contract

1. **Optimistic toggle**: `toggleProvider` immediately updates `providers[i].enabled` locally, then persists. On failure, reverts.
2. **Detail caching**: `selectProvider` checks `detailCache` first; serves cached value instantly then refreshes in background.
3. **Refresh cascade**: After any provider/model mutation, `refreshAfterMutation` reloads the provider list AND calls `useAgentStore.getState().loadModels()` to update the runtime projection.
4. **Loading granularity**: `providerLoadingIds` tracks which providers have in-flight operations, enabling per-row spinners in the settings page.

---

## 3. Model Switch Panel Design

### Existing Component (preserved and enhanced)

The current `ModelProviderSelect` is already well-built with:
- Search filtering
- Grouped by provider
- Capability badges (vision, tool_use, reasoning)
- Context window display
- Settings navigation link

### P0 Enhancements

| Feature | Current | Enhanced |
|---------|---------|----------|
| Search | Text match on name/id/provider | Unchanged (already good) |
| Grouping | By provider | Unchanged (already good) |
| Capability display | Vision, tool_use, reasoning icons | Add search + image_output badges |
| Context window | Shows formatted tokens | Unchanged |
| Selection | Click to select + close | Unchanged |
| Empty state | "No models" message | Add "Configure providers" CTA |
| Loading state | None visible | Show skeleton during initial load |

### UI Structure

```
┌──────────────────────────────────────────┐
│  [🔍 Search models...]            [✕]    │
├──────────────────────────────────────────┤
│  OpenAI                                  │
│    ● GPT-4o        👁 🔧 💭  128K  ✓   │
│    ● GPT-4o-mini   👁 🔧     128K       │
│    ● o1            👁    💭  200K       │
│                                          │
│  Anthropic                               │
│    ● Claude 3.5    👁 🔧 💭  200K       │
│    ● Claude 3 Haiku👁 🔧     200K       │
│                                          │
│  DeepSeek                                │
│    ● DeepSeek-V3   👁 🔧 💭  128K       │
├──────────────────────────────────────────┤
│  ⚙️  Manage Providers              >     │
└──────────────────────────────────────────┘
```

### Selection Flow

```
User clicks model trigger (chat input area)
  → Popover opens with ModelProviderSelect
  → useAgentStore.availableModels provides data (pre-loaded at boot)
  → User searches/scrolls, clicks model row
  → onSelect(modelId, providerId)
  → useAgentStore.setSelectedModel(modelId, providerId)
  → Popover closes
  → Chat uses new model on next message
```

### Component Contract

```typescript
// No changes to the public API — the existing interface is correct
interface ModelProviderSelectProps {
  models?: AvailableModel[];           // override for specific contexts (e.g. agent profile)
  selectedModelId?: string;            // current selection
  onSelect: (modelId: string, providerId: string) => void;
  onClose: () => void;
  onNavigateSettings?: () => void;     // navigate to provider settings
}
```

---

## 4. Provider Settings Page Design

### Page Structure

The Provider Settings Page is part of the Settings route. It provides full CRUD for providers and their models.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Settings > Model Providers                                          │
├───────────────────────┬─────────────────────────────────────────────┤
│  Provider List        │  Provider Detail                             │
│                       │                                              │
│  [+ Add Provider]     │  ┌─────────────────────────────────────┐    │
│                       │  │  Provider Info                       │    │
│  ┌─────────────────┐ │  │  Name: OpenAI                        │    │
│  │ ● OpenAI    [✓] │ │  │  Base URL: https://api.openai.com   │    │
│  │ ● Anthropic [✓] │ │  │  API Key: sk-***...***              │    │
│  │ ● DeepSeek  [✓] │ │  │  Status: ● Connected                │    │
│  │ ● Ollama    [ ] │ │  │  [Test Connection]  [Save]  [Delete]│    │
│  └─────────────────┘ │  └─────────────────────────────────────┘    │
│                       │                                              │
│                       │  ┌─────────────────────────────────────┐    │
│                       │  │  Models                              │    │
│                       │  │  [Enable All] [Disable All] [+ Add] │    │
│                       │  │                                      │    │
│                       │  │  ☑ gpt-4o        128K 👁🔧💭       │    │
│                       │  │  ☑ gpt-4o-mini   128K 👁🔧         │    │
│                       │  │  ☐ gpt-4-turbo   128K 👁🔧         │    │
│                       │  │  ☑ o1            200K 👁  💭       │    │
│                       │  └─────────────────────────────────────┘    │
└───────────────────────┴─────────────────────────────────────────────┘
```

### Provider CRUD Operations

| Operation | UI Trigger | Store Action | Station API |
|-----------|-----------|--------------|-------------|
| List | Page mount | `loadProviders()` | `ListProviders` |
| View | Click provider row | `selectProvider(id)` | `GetProvider` |
| Create | "Add Provider" button → modal | `createProvider(data)` | `CreateProvider` |
| Update | Edit form → Save | `updateProvider(id, ...)` | `UpdateProvider` |
| Delete | Delete button → confirm | `deleteProvider(id)` | `DeleteProvider` |
| Toggle | Switch in list row | `toggleProvider(id, enabled)` | `UpdateProvider` |
| Test | "Test Connection" button | `checkProvider(id, ...)` | `CheckProvider` |

### Model Management (within provider detail)

| Operation | UI Trigger | Store Action | Station API |
|-----------|-----------|--------------|-------------|
| Toggle single | Checkbox per model | `toggleModel(pid, mid, enabled)` | `ToggleModel` |
| Toggle all | "Enable/Disable All" | `toggleAllModels(pid, enabled)` | `ToggleAllModels` |
| Add custom | "+ Add" → modal | `addModel(pid, data)` | `AddModel` |
| Edit | Click model row → inline edit | `updateModel(pid, mid, data)` | `UpdateModel` |
| Delete | Delete icon on custom model | `deleteModel(pid, mid)` | `DeleteModel` |

### Create Provider Modal

Fields:
- `id` — slug identifier (auto-generated from name, editable)
- `name` — display name (required)
- `base_url` — API endpoint (required)
- `api_key` — credential (optional, masked input)
- `description` — optional
- `logo` — optional (URL or upload)

Validation:
- `id` must be unique across existing providers
- `base_url` must be a valid URL
- On submit, optionally run `checkProvider` to verify connectivity

---

## 5. Capability Model

### AvailableModel (runtime projection)

This type already exists in `desktop_api.ts` and is the runtime contract:

```typescript
interface AvailableModel {
  id: string;                  // model identifier (e.g., "gpt-4o")
  provider_id: string;         // owning provider slug
  provider_name?: string;      // display name of provider
  display_name?: string;       // human-friendly model name
  type?: string;               // "chat" | "image" | "embedding" | "video"
  context_window: number;      // max tokens
  enabled: boolean;            // whether available for selection
  function_call?: boolean;     // supports tool use
  vision?: boolean;            // supports image input
  reasoning?: boolean;         // supports extended thinking
  search?: boolean;            // supports web search
  image_output?: boolean;      // can generate images
  video?: boolean;             // can process/generate video
}
```

### Capability Resolution at Chat Time

When a model is selected for chat, capabilities drive UI and runtime behavior:

```
selectedModel + selectedProviderId
  → resolve from availableModels[]
  → capabilities determine:
      function_call=true → tool picker enabled in chat input
      vision=true       → image upload enabled
      reasoning=true    → "thinking" indicator shown during generation
      search=true       → web search toggle available
```

---

## 6. Cross-Store Coordination

### Boot Sequence

```
App Init
  → useAgentStore.loadModels()
  → availableModels populated (runtime projection ready)
  → defaultModel resolved from agent config
  → Chat UI renders with model trigger showing current selection
```

### Mutation Cascade

```
Provider Settings mutation (any CRUD)
  → useProviderStore action completes
  → refreshAfterMutation():
      1. await loadProviders()           // refresh admin list
      2. await selectProvider(id, true)  // refresh detail if active
      3. useAgentStore.getState().loadModels()  // refresh runtime projection
```

This ensures the model picker always reflects the latest provider/model state without requiring page navigation.

---

## 7. Deferred (P2) — Not in Scope

The following are explicitly excluded from this design:

| Feature | Rationale |
|---------|-----------|
| Benchmark comparison modal | Requires model rating data source (none exists) |
| Per-model reasoning sliders / extendParams | Requires model-specific parameter schema (complex UX) |
| Remote model list fetch (Ollama auto-discover) | Requires external service integration protocol |
| Model redirects / deprecation map | No model lifecycle management needed yet |
| Category-typed model lists (image, embedding, video) | Only chat models used currently |
| Hidden builtin models policy | No multi-user model visibility needed |
| Drag-and-drop provider/model reorder | UX refinement, not core |

---

## 8. File Ownership

| File | Module Owner | Changes in P0 |
|------|-------------|---------------|
| `store/provider.ts` | Provider & Model Infra | Add `providerLoadingIds`, `detailCache`, `refreshAfterMutation` |
| `store/agent.ts` | Agent Core | No changes (existing `loadModels`, `setSelectedModel` sufficient) |
| `components/ModelProviderSelect.tsx` | Provider & Model Infra | Add loading skeleton, empty CTA, additional capability badges |
| `components/ModelSelect.tsx` | Provider & Model Infra | No changes (used in agent profile, not chat input) |
| `pages/SettingsPage.tsx` | Settings | Provider settings section (existing, may enhance layout) |
| `services/desktop_api.ts` | Shared | No API changes needed (all commands exist) |
| `src-tauri/src/commands/provider.rs` | Rust BFF | No changes (all commands exist) |
| Station `ProviderService` | Station | No changes (all RPCs exist) |

---

## 9. Design Decisions Summary

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Keep `useProviderStore` as single flat store (no slice split) | Peers provider state is simpler than LobeHub's; slice decomposition adds overhead without benefit at current scale |
| D2 | `availableModels` stays in `useAgentStore` (not provider store) | It is a runtime projection for chat, not an admin concern. Separation of concerns. |
| D3 | No SWR/stale-while-revalidate pattern | Tauri IPC is fast (~1ms); SWR complexity not justified for local-first architecture |
| D4 | Optimistic updates only for toggle operations | Toggle is the most frequent operation; other CRUD operations show loading state |
| D5 | `ModelProviderSelect` remains a component (not a "feature" directory) | Peers codebase uses flat component organization; no need for feature directory pattern at current scale |
| D6 | Provider credentials stored server-side only | Station owns secrets; Desktop never persists API keys locally (Tauri state is ephemeral) |
