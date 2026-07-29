# Agent LobeHub Parity - Provider / Model Source Map

> **Status**: implemented-for-design
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Provider Runtime + Desktop
> **BOM**: BOM-003, BOM-010, BOM-015
> **Spec**: SPEC-003, SPEC-009, SPEC-011, SPEC-013
> **Plan Step**: PLAN-P0 / PLAN-P4
> **Gates**: GATE-001, GATE-002, GATE-005, GATE-006, GATE-008
> **Evidence**: EVID-011-S-pre

---

## 1. Purpose

This document closes the BOM-003 design gap by mapping LobeHub's provider/model configuration system to Peers-Touch Settings Provider projection and Agent runtime consumption.

It is source audit and migration design evidence only. It does not implement GATE-005 in product code and does not satisfy GATE-008.

## 2. LobeHub Source Map

| Domain | LobeHub source | Responsibility observed |
| --- | --- | --- |
| AI infra store | `external/lobehub/src/store/aiInfra/store.ts`, `index.ts`, `initialState.ts`, `selectors.ts` | Composes provider and model slices into one AI infra store consumed by settings, runtime and chat capability logic. |
| Provider actions | `external/lobehub/src/store/aiInfra/slices/aiProvider/action.ts` | Create/delete/update/toggle providers, refresh provider list/detail/runtime state, optimistic config sync, runtime-state readiness gating. |
| Provider selectors | `external/lobehub/src/store/aiInfra/slices/aiProvider/selectors.ts` | Enabled/disabled providers, provider runtime config, key vaults, fetch-on-client policy, built-in search/response API capability. |
| Model actions | `external/lobehub/src/store/aiInfra/slices/aiModel/action.ts` | Create/update/delete/sort/toggle/clear/fetch remote models, then refresh model list and provider runtime state. |
| Model selectors | `external/lobehub/src/store/aiInfra/slices/aiModel/selectors.ts` | Enabled/disabled/filter model list and capability selectors keyed by `model id + provider`. |
| Model service | `external/lobehub/src/services/models.ts` | Fetch/pull/abort model operations through client runtime or server endpoint depending on provider config. |
| Settings Provider UI | `external/lobehub/src/routes/(main)/settings/provider/**`, `external/lobehub/src/routes/(main)/[workspaceSlug]/settings/provider/**` | Provider list/detail navigation, provider config, provider model management and workspace-aware settings route. |
| Chat runtime usage | `external/lobehub/src/services/chat/mecha/modelParamsResolver.ts`, `external/lobehub/src/store/chat/agents/createAgentExecutors.ts` | Provider/model capability and runtime config feed chat execution and model parameter resolution. |

## 3. LobeHub Provider/Model Action Taxonomy

| Action family | Representative actions/selectors | LobeHub behavior | Peers-Touch target semantics |
| --- | --- | --- | --- |
| Provider lifecycle | `createNewAiProvider`, `removeAiProvider`, `deleteAiProvider`, `updateAiProvider`, `toggleProviderEnabled`, `updateAiProviderSort` | Provider list is service-backed; mutations refresh provider list and runtime state. Toggle performs immediate local sync before SWR refresh. | Settings Provider remains the single configuration UI/source. Agent must consume a runtime/store projection, not duplicate provider CRUD. |
| Provider config | `updateAiProviderConfig`, `providerConfigById`, `providerKeyVaults`, `isProviderEnableResponseApi` | Runtime config and detail map are updated optimistically for fetchOnClient / response API fields, then refreshed. | Provider config source of truth remains Settings Provider/Desktop Rust/Station policy; Agent surfaces read-only capability and health states. |
| Runtime state readiness | `refreshAiProviderRuntimeState`, `ensureAiProviderRuntimeStateReady` | Runtime state fetch produces enabled provider/model lists and is bounded by timeout before callers continue. | Peers Agent runtime must expose provider projection readiness/error states; chat execution cannot silently guess capabilities while projection is stale. |
| Provider fetch boundary | `isProviderFetchOnClient`, `modelsService.getModels` | Fetch may run through browser/client runtime or server endpoint based on provider config, whitelist and missing key/baseURL. | Peers must keep CLI/local providers Desktop-owned and server providers Station-owned; Agent UI must expose boundary instead of routing all turns to Station. |
| Model lifecycle | `createNewAiModel`, `removeAiModel`, `updateAiModelsConfig`, `updateAiModelsSort`, `toggleModelEnabled`, `batchToggleAiModels`, `batchUpdateAiModels` | Active provider scopes model mutations; mutation refreshes provider model list and runtime state. | Peers Settings Provider owns model CRUD; Agent selection reacts to projection changes and must recover if selected provider/model is disabled or deleted. |
| Remote model fetch | `fetchRemoteModelList`, `modelsService.getModels` | Remote list is normalized, preserves existing enabled flags, marks source `remote`, records abilities, refreshes model list and runtime state. | Peers must preserve capability metadata from provider model fetch and refresh Agent projection once per batch. |
| Model list build | `buildChatProviderModelLists`, `buildImageProviderModelLists`, `buildVideoProviderModelLists` | Enabled models are grouped under provider children by type; each child keeps `id`, display name, context window, pricing, parameters and abilities. | Agent chat picker consumes only chat-capable provider children; Image/Video surfaces consume matching model-type projections. |
| Capability selectors | `getEnabledModelById(id, provider)`, `isModelSupportToolUse`, `isModelSupportFiles`, `isModelSupportVision`, `isModelSupportReasoning`, `modelContextWindowTokens` | Capability lookup uses model ID plus provider where provider is supplied. | Tool/Knowledge/runtime gating must use provider+model identity; model-only capability lookup is forbidden when duplicate IDs exist. |
| Provider capability selectors | `isProviderHasBuiltinSearch`, `isProviderHasBuiltinSearchConfig`, `isProviderEnableResponseApi` | Provider runtime config controls search and response API behavior. | Peers Agent turn config must include provider policy/capability projection or a contract-visible provider capability ref. |

## 4. Required Peers-Touch Ownership Mapping

| Capability | Peers source of truth | Desktop/Mobile responsibility | Station responsibility |
| --- | --- | --- | --- |
| Provider CRUD/config | Station (per-actor) | Cache for UI speed; settings UI routes mutations to Station API. | Store, validate, and serve provider config per actor. |
| Credential storage | Station (`agent_credential_pool`, per-actor) | Never stored locally. Settings UI submits credentials to Station. | Store and rotate credentials; enforce per-actor isolation. |
| Model CRUD/config | Station (per-actor) | Cache model list for picker display; mutations call Station. | Manage model list per provider per actor; enumerate remote models. |
| Provider execution | Station | Never execute provider calls directly. Consume via SSE. | Execute all provider types (HTTP, CLI, embedded). |
| Agent model selection | Agent config on Station + client cache | Select/display `provider_id + model_id`; handle disabled/deleted recovery. | Persist and validate selected model ref per actor. |
| Capability gating | Station provider/model metadata | Gate tools/files/vision/reasoning/search UI affordances from cached metadata. | Reject unsupported tool/file/runtime usage at turn execution boundary. |

## 5. Contract Implications

| Requirement | Contract implication |
| --- | --- |
| Provider + model identity is mandatory | `AgentModelRef` must include `provider_id` and `model_id`; UI keys may encode both but persisted/runtime contracts must keep separate fields. |
| Duplicate model IDs are valid | Product code must not validate selection with `Set(model.id)` or `models.find(m.id)`. |
| Runtime state can be stale | Projection must expose `loading`, `ready`, `error`, `stale` or equivalent states; chat execution must not silently fall back to a hardcoded model. |
| Model capability drives tools/files/runtime | Tool, Knowledge, File, Vision, Reasoning and Search affordances must be derived from provider+model capability projection. |
| Remote fetch mutates capability projection | Provider/model fetch/toggle/update/delete must refresh Agent projection once per mutation batch. |
| Client/server provider boundary is first-class | All provider execution is Station-owned. Desktop/Mobile never execute provider calls directly; they consume AI capability via SSE. |
| Builtin/default list is a fallback source only | LobeHub uses builtin lists for non-login/runtime state; Peers Agent must not hardcode default model lists outside Settings Provider projection. |

## 6. Mapping To Migration Batches

| Batch | This map contributes |
| --- | --- |
| M1 Contract Foundation | `AgentModelRef`, provider capability metadata and conflict rejection semantics. |
| M3 Provider/model Correctness | Source-backed model ref helpers, projection refresh, duplicate ID tests and CLI/Desktop boundary. |
| M5 Agent Config/Profile | Agent profile selected provider/model must store/read a compound ref. |
| M8 Tool/Plugin/Skill | Tool availability must use provider+model capability selectors. |
| M9 Recovery/Diagnostics | Provider/model error surfaces must identify provider, model, route and retryability. |

## 7. Forbidden Relationships

1. Agent UI must not own provider/model CRUD.
2. Agent runtime must not use model ID alone when provider is known or duplicates exist.
3. Agent picker must not ship hardcoded default model lists.
4. Desktop/Mobile must not execute any provider calls directly; all execution is Station-owned.
5. Component mount effects must not be the primary provider/model projection refresh mechanism.
6. Tool/function-call availability must not be inferred from provider name alone.

## 8. Current Claim

BOM-003 is implemented for design as a source-backed provider/model config map.

GATE-005 remains `PARTIAL` until product code proves provider+model identity, Settings Provider projection refresh and duplicate-ID behavior through EVID-014.
