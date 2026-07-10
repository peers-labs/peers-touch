# Agent LobeHub Fullstack Parity — M3 Provider/Model Correctness Spec

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Provider Runtime + Desktop
> **Module**: `apps/desktop/src/store/`, `apps/desktop/src/components/`, `apps/desktop/src/pages/`, `apps/desktop/src-tauri/src/application/{provider,models}/`, `apps/station/app/subserver/agent/service/provider_service.go`
> **Plan Step**: PLAN-P4 / M3 pre-execution
> **Evidence**: EVID-011-C-pre

---

## 1. Purpose

This document turns M3 in `migration-plan.md` into a Provider/model implementation-ready specification.

The target is GATE-005: Agent model selection must come from Settings Provider projection, must be uniquely identified by `provider_id + model_id`, and must not rely on hardcoded default model lists.

This is a pre-execution spec. It does not modify product code and does not claim GATE-005 complete.

## 2. Source Inputs

| Source | Role |
| --- | --- |
| `provider-model-source-map.md` | Maps LobeHub aiInfra provider/model runtime state, remote model fetch and capability selectors to Peers Settings Provider projection |
| `contract-foundation.md` | Defines future `AgentModelRef` contract and compatibility mapping |
| `desktop-runtime-shell.md` | Requires runtime/store-owned projection, not page/component mount fetch |
| `apps/desktop/src/store/provider.ts` | Settings Provider projection and provider/model mutations |
| `apps/desktop/src/store/agent.ts` | Current Agent model selection store |
| `apps/desktop/src/components/ChatInput.tsx` | Current primary Agent composer model picker |
| `apps/desktop/src/components/ModelProviderSelect.tsx` | Shared model/provider picker |
| `apps/desktop/src/components/ModelSelect.tsx` | Shared model select used by settings/profile surfaces |
| `apps/desktop/src/pages/ChatPage.tsx` | Current chat header model display |
| `apps/desktop/src/pages/AgentProfilePage.tsx` | Current Agent profile provider/model config |
| `apps/desktop/src/store/chat.ts` | Runtime turn input construction using selected model/provider |
| `apps/desktop/src/services/desktop_api.ts` | `AvailableModel` projection and `listAvailableModels()` flattening |
| `apps/desktop/src-tauri/src/application/models/mod.rs` | Desktop Rust provider model lifecycle and CLI model fetch |
| `apps/desktop/src-tauri/src/application/provider/mod.rs` | Desktop Rust provider available model projection |
| `apps/station/app/subserver/agent/service/provider_service.go` | Station provider call owner and CLI execution restriction |
| `apps/station/app/subserver/agent/handler/turn_handler.go` | Current request -> TurnConfig provider/model mapping |

## 3. Current State Inventory

| Area | Current Behavior | Risk |
| --- | --- | --- |
| Settings Provider projection | `provider.ts` mutates provider/model records and reloads provider detail/list. | Agent capability projection refresh is not a formal store/runtime contract in this file. |
| Agent model store | `agent.ts` stores `selectedModel` and `selectedProviderId`; `loadModels()` validates selection using `Set(models.map(m => m.id))`. | Duplicate model IDs across providers can validate/select incorrectly. |
| Chat composer | `ChatInput.tsx` uses encoded provider/model menu keys, but still calls `loadModels()` on mount and falls back to `availableModels.find(m => m.id === currentModelId)`. | UI partially supports compound identity while still relying on component mount freshness and model-only fallback. |
| Shared picker | `ModelProviderSelect.tsx` groups by provider but uses `m.id` as React key/selected current ID. | Duplicate IDs show incorrect selected state. |
| Shared select | `ModelSelect.tsx` emits/selects `m.id` only. | Any consumer using it cannot distinguish providers. |
| Chat runtime | `chat.ts` sends `selectedProviderId` plus `modelOverride` string to turn execution. | Turn input depends on separate loose fields and model override logic. |
| Agent profile | `AgentProfilePage.tsx` stores `agent.provider` and `agent.model`, but lookup often starts with `models.find(model => model.id === agent.model)`. | Duplicate IDs can map to wrong provider before provider filter is applied. |
| Desktop API projection | `desktop_api.ts` flattens enabled provider models into `AvailableModel` with `provider_id`. | Projection has enough data; consumers need compound identity helpers. |
| Desktop Rust model store | `models/mod.rs` add/update/delete/toggle require `provider_id` and `model_id`; duplicate IDs are allowed across providers. | Rust store is mostly correct; UI/store must stop collapsing identity. |
| CLI provider | Rust fetch supports CLI model enumeration/preset fallback; Station rejects CLI provider execution. | Boundary is correct; UI must surface Desktop-owned execution instead of routing CLI to Station. |
| Station provider call | `ProviderService.Call` uses `ProviderID` + `Model`; TurnConfig uses loose strings. | Station needs M1 `AgentModelRef` compatibility to reject ambiguous/conflicting input. |

## 4. Target Identity Model

### 4.1 UI Model Key

Before generated `AgentModelRef` is available everywhere, Desktop Web should use a stable local key:

```ts
type AgentModelKey = `${encodeURIComponent(providerId)}/${encodeURIComponent(modelId)}`;
```

Rules:

- UI select values and React keys use `AgentModelKey`, not `model.id`.
- Store state may keep compatibility fields, but must derive from a single selected ref.
- The key is not a persisted API contract; it is a Desktop Web transport for compound identity.
- Persisted/server-bound representation is `provider_id + model_id`, later `AgentModelRef`.

### 4.2 Store State

Target state shape:

```ts
interface SelectedAgentModelRef {
  providerId: string;
  modelId: string;
}
```

Migration compatibility:

- Keep `selectedModel` and `selectedProviderId` as compatibility selectors during M3.
- Add helper selectors:
  - `selectedModelRef()`
  - `selectedModelKey()`
  - `findModelByRef(ref)`
  - `isSameModelRef(left, right)`
- `setSelectedModel(model, providerId)` must reject missing `providerId` once available models contain any duplicate `model.id`.

### 4.3 Validation

Validation must use:

```ts
models.some((m) => m.id === modelId && m.provider_id === providerId)
```

Forbidden validation:

```ts
new Set(models.map((m) => m.id)).has(modelId)
models.find((m) => m.id === modelId)
```

Only allowed exception:

- Legacy compatibility fallback may resolve `modelId` alone when exactly one enabled model has that ID. If multiple providers expose the ID, the fallback must choose no model and surface a recovery state.

## 5. Implementation Slices

### M3.1 Shared Model Ref Helpers

Target path:

- `apps/desktop/src/services/agent-model-ref.ts` or `apps/desktop/src/store/agentModelRef.ts`

Required helpers:

- `toAgentModelKey(ref)`
- `fromAgentModelKey(key)`
- `toAgentModelRef(model: AvailableModel)`
- `findAvailableModelByRef(models, ref)`
- `findAvailableModelByLegacyId(models, modelId)`
- `isDuplicateModelId(models, modelId)`
- `resolveCompatibleModelRef(models, legacyModelId, legacyProviderId?)`

Acceptance:

- Unit tests cover duplicate IDs, encoded characters, missing provider, unique legacy fallback, ambiguous legacy fallback.

### M3.2 Agent Store Ref Migration

Target path:

- `apps/desktop/src/store/agent.ts`

Required changes:

1. Add selected model ref helpers or state.
2. Update `loadModels()` selection logic to validate by compound ref.
3. Stop deriving `nextProvider` from first `models.find((m) => m.id === nextSelected)`.
4. When persisted selected provider is missing and model ID is duplicated, select no model and expose recovery/error state.
5. Keep backwards compatibility for callers still passing `(modelId, providerId)`.

Acceptance:

- Duplicate model IDs across providers select the intended provider.
- Disabling/deleting selected provider/model clears or recovers the selection deterministically.
- `availableModels` remains sourced from `api.listAvailableModels()` only.

### M3.3 Runtime/Projection Refresh Contract

Target paths:

- `apps/desktop/src/store/provider.ts`
- `apps/desktop/src/runtimes/agentCapabilityRuntime.ts`
- `apps/desktop/src/store/agent.ts`

Required changes:

1. Provider mutations must cause the Agent capability projection to refresh through a runtime/store contract.
2. Avoid adding component mount `loadModels()` as the main freshness mechanism.
3. After provider/model add/update/delete/toggle/fetch, Agent available models should refresh once per mutation batch.
4. Batch remote model fetch should avoid N model-list refreshes for N models.

Acceptance:

- Settings Provider enable/disable/model fetch changes appear in Agent picker without reopening the page.
- Refresh does not depend on `ChatInput` remount.

### M3.4 ChatInput And Shared Picker Migration

Target paths:

- `apps/desktop/src/components/ChatInput.tsx`
- `apps/desktop/src/components/ModelProviderSelect.tsx`
- `apps/desktop/src/components/ModelSelect.tsx`
- Consumers of `ModelProviderSelect` / `ModelSelect`

Required changes:

1. All selectable values use `AgentModelKey`.
2. Selected state compares provider+model.
3. Labels continue to show provider name and model display name.
4. Search must match provider name, provider ID, model ID and display name.
5. Remove `loadModels()` mount call from picker components unless replaced by runtime-owned prefetch.

Acceptance:

- Two providers with `gpt-4.1` show as two selectable rows and selecting one highlights only that provider row.
- Chat composer model button shows the selected provider/model pair.

### M3.5 Chat Runtime Turn Input

Target paths:

- `apps/desktop/src/store/chat.ts`
- `apps/desktop/src/services/agent-runtime-config.ts`
- Desktop Rust / Station turn input after M1

Required changes:

1. Build turn input from selected model ref.
2. Continue sending legacy `provider` and `model` fields until M1 `AgentModelRef` implementation is available.
3. Once M1 lands, populate `model_ref` and keep legacy fields only for compatibility.
4. Message metadata should preserve provider identity, not only model name.

Acceptance:

- Send, regenerate, branch and continue all use the same selected provider/model ref.
- Assistant message metadata can display provider/model used.

### M3.6 Agent Profile And Settings Surfaces

Target paths:

- `apps/desktop/src/pages/AgentProfilePage.tsx`
- `apps/desktop/src/pages/SettingsPage.tsx`
- `apps/desktop/src/components/settings/ProviderDetail.tsx`
- `apps/desktop/src/components/ModelServiceTab.tsx`
- `apps/desktop/src/components/CronJobDrawer.tsx`

Required changes:

1. Agent profile model selection must use provider+model value.
2. Existing saved Agent config fields may remain `provider` and `model`, but UI selection must never resolve by `model` alone when duplicated.
3. Settings Provider remains the source of provider/model availability.
4. Non-Agent surfaces using shared model components must either adopt compound identity or explicitly document why they are out of Agent M3 scope.

Acceptance:

- Agent config save/load roundtrip preserves selected provider and model.
- Shared model components do not regress other settings surfaces.

### M3.7 Desktop Rust And CLI Provider Boundary

Target paths:

- `apps/desktop/src-tauri/src/application/models/mod.rs`
- `apps/desktop/src-tauri/src/application/provider/mod.rs`
- `apps/desktop/src-tauri/src/interface/contracts/mod.rs`

Required changes:

1. Keep model lifecycle commands requiring both `provider_id` and `model_id`.
2. Keep CLI remote-model fetch owned by Desktop Rust.
3. Expose provider runtime kind in `AvailableModel` projection so UI can display CLI/Desktop-owned execution state.
4. Add/keep tests for duplicate model IDs across providers.

Acceptance:

- Rust tests prove duplicate model IDs in different providers do not conflict.
- CLI providers can enumerate/fallback models without requiring base URL.

### M3.8 Station Provider Boundary

Target paths:

- `apps/station/app/subserver/agent/service/provider_service.go`
- `apps/station/app/subserver/agent/handler/turn_handler.go`
- M1 generated model/domain consumers

Required changes:

1. Station direct provider calls must continue rejecting CLI runtime providers.
2. Turn request mapping must use `AgentModelRef` when available.
3. If both legacy and new model fields are provided and conflict, reject with typed invalid request.
4. Fallback/rotation fields must be mapped explicitly before claiming provider fallback parity.

Acceptance:

- Station tests cover CLI provider rejection.
- Station tests cover model ref vs legacy field compatibility/conflict.
- Provider fallback mapping is either implemented and tested or explicitly marked partial.

## 6. Required Test Matrix

| Test Class | Required Case |
| --- | --- |
| Duplicate model IDs | Provider A and Provider B both expose `gpt-4.1`; UI select/store/send keeps the intended provider. |
| Ambiguous legacy fallback | Legacy `selectedModel='gpt-4.1'` and no provider does not silently choose the first provider. |
| Settings sync | Provider model fetch/toggle/update refreshes Agent available models through runtime/store projection. |
| CLI provider | TRAE/Cursor model fetch works through Desktop Rust and is displayed as Desktop-owned execution. |
| Direct provider | OpenAI-compatible/Ollama/Anthropic direct providers still route through Station where appropriate. |
| Chat runtime | Send/regenerate/branch/continue pass provider+model consistently. |
| Agent profile | Save/load Agent model selection preserves provider+model. |
| No hardcoded defaults | Search proves Agent model lists come from Settings Provider projection. |

## 7. Forbidden Relationships

M3 implementation must not:

1. Use `model.id` alone as any selectable value for Agent model choice.
2. Validate selected model with `Set(model.id)`.
3. Pick the first matching model by ID when provider is missing and duplicates exist.
4. Add hardcoded default models to Agent UI or Agent store.
5. Route CLI provider execution through Station provider calls.
6. Fix sync by adding more model-loading mount effects to ChatInput or picker components.
7. Combine provider/model migration with unrelated Agent profile or Tool/Knowledge changes unless the Evidence row expands scope.

## 8. Evidence Target

After EVID-010, EVID-012 and EVID-013, the implementation batch should append:

| Evidence ID | BOM ID | Spec ID | Plan Step | Gate ID | Artifact | Result | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EVID-014 | BOM-003/BOM-010/BOM-015 | SPEC-003/SPEC-013 | PLAN-P5 / M3 | GATE-005/GATE-008 | Desktop model ref helpers, Agent store, ChatInput/shared pickers, Provider store refresh, Rust/Station tests as touched | Provider/model correctness implemented with Settings Provider projection and provider+model identity | Deeper provider fallback/rotation may remain for M4/M9 if not touched |

## 9. Current M3 Readiness

| Requirement | Status | Evidence |
| --- | --- | --- |
| Current duplicate-ID risks identified | implemented | `agent.ts`, `ModelProviderSelect.tsx`, `ModelSelect.tsx`, `AgentProfilePage.tsx` inspected |
| Settings Provider projection source identified | implemented | `provider.ts`, `desktop_api.ts`, Rust provider/model modules inspected |
| CLI provider boundary identified | implemented | Rust CLI model fetch and Station CLI rejection inspected |
| Runtime projection dependency identified | implemented | `agentCapabilityRuntime.ts`, `ChatInput.tsx`, `desktop-runtime-shell.md` |
| Product implementation allowed | blocked | Pending revised prototype acceptance, EVID-012 M1, and EVID-013 M2 |
