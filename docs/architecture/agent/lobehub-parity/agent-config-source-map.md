# Agent LobeHub Parity - Agent Config / Profile Source Map

> **Status**: implemented-for-design
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Station + Desktop
> **BOM**: BOM-006, BOM-009, BOM-015
> **Spec**: SPEC-005, SPEC-011, SPEC-013
> **Plan Step**: PLAN-P0 / PLAN-P4
> **Gates**: GATE-001, GATE-002, GATE-006, GATE-008
> **Evidence**: EVID-011-T-pre

---

## 1. Purpose

This document closes the BOM-006 design gap by mapping LobeHub Agent profile/config/settings semantics to Peers-Touch Station-owned Agent config and Desktop profile/settings projection.

It is source audit and migration design evidence only. It does not implement Peers product code and does not satisfy GATE-008.

## 2. LobeHub Source Map

| Domain | LobeHub source | Responsibility observed |
| --- | --- | --- |
| Agent store | `external/lobehub/src/store/agent/store.ts`, `index.ts`, `initialState.ts` | Composes agent and builtin slices. |
| Agent selectors | `external/lobehub/src/store/agent/selectors/selectors.ts`, `chatConfigSelectors.ts`, `chatConfigByIdSelectors.ts` | Meta, prompt, provider/model, plugins, knowledge/files, opening, agent mode, runtime env, working directory and heterogeneous runtime selectors. |
| Agent CRUD/config actions | `external/lobehub/src/store/agent/slices/agent/action.ts` | Create, transfer, fetch/hydrate config, retry config fetch, optimistic config/meta update, plugin toggle, runtime env update and document context fetch. |
| Agent setting local store | `external/lobehub/src/features/AgentSetting/store/action.ts`, `reducers/config.ts`, `reducers/meta.ts`, `selectors.ts`, `initialState.ts` | Staged settings editor, config/meta reducers, save status, loading state, auto-complete and trace payload for settings edits. |
| Prompt editor | `external/lobehub/src/features/AgentSetting/AgentPrompt/index.tsx` | Editable system role with token display and disabled-state guard. |
| Opening settings | `external/lobehub/src/features/AgentSetting/AgentOpening/**` | Opening message and recommended opening questions. |
| Meta editor | `external/lobehub/src/features/AgentSetting/AgentMeta/**` | Title, avatar, description, tags, background swatches and auto-generation controls. |
| Connectors/settings tabs | `external/lobehub/src/features/AgentSetting/AgentSettingsContent.tsx`, `AgentConnectors/**`, `AgentSelfIteration/**` | Opening, connector and self-iteration settings surfaces gated by server config. |
| Agent profile route | `external/lobehub/src/routes/(main)/agent/profile/**` | Profile/editor shell and runtime config surface used by live audit. |

## 3. LobeHub Agent Config Taxonomy

| Config family | Representative fields/actions/selectors | LobeHub behavior | Peers-Touch target semantics |
| --- | --- | --- | --- |
| Meta/profile | `title`, `avatar`, `description`, `backgroundColor`, `tags`, `marketIdentifier`, `currentAgentMeta`, `updateAgentMeta`, `optimisticUpdateAgentMeta` | Meta fields live on agent config/top-level agent object; updates are optimistic and then replaced by returned service data. | Station owns profile truth; Desktop renders/edit projection and may optimistically show pending changes with explicit rollback/retry state. |
| Prompt | `systemRole`, `currentAgentSystemRole`, `AgentPrompt`, `appendStreamingSystemRole`, `finishStreamingSystemRole` | System role is editable and can be streamed/generated before being saved to config. | Prompt is a typed Agent config section; generated prompt must be distinguishable from confirmed saved prompt. |
| Opening | `openingMessage`, `openingQuestions`, `AgentOpening`, `DEFAULT_OPENING_QUESTIONS` | Opening message/questions are separate config fields with default fallback. | Peers must model opening copy/questions as structured Station-owned config, not raw UI string arrays. |
| Model/runtime | `model`, `provider`, `chatConfig`, `runtimeEnv`, `currentAgentRuntimeEnvConfig`, `currentAgentMode`, `isCurrentAgentHeterogeneous` | Agent config includes provider/model, chat settings, runtime env, agent mode and heterogeneous/external runtime flags. | Agent config stores selected `AgentModelRef` and runtime config; CLI/heterogeneous boundaries stay explicit and must align with provider projection. |
| Tools/plugins | `plugins`, `displayableAgentPlugins`, `toggleAgentPlugin`, `configReducer.togglePlugin` | Plugin IDs are toggled in config and filtered by environment before display. | Agent owns tool/skill binding references; tool catalog, install and credentials remain tool/platform domains. |
| Knowledge/files | `knowledgeBases`, `files`, `currentEnabledKnowledge`, `currentKnowledgeIds`, `ensureAgentDocuments` | Agent config holds knowledge/file references and document context cache is fetched per agent. | Agent owns binding references; base-resource/Station own resource lifecycle, indexing and retrieval truth. |
| Runtime workspace | `agencyConfig`, `workingDirByDevice`, `localAgentWorkingDirectoryStorage`, `updateAgentRuntimeEnvConfigById` | Desktop working directory may be per-device and persisted locally, while other runtime env fields are saved in chat config. | Device-local workspace handles stay Desktop-owned; Station owns portable runtime config and must not persist local-only paths as cross-end truth. |
| Save/recovery state | `saveStatus`, `loadingState`, `agentConfigErrorMap`, `retryAgentConfigFetch`, `internal_createAbortController` | Updates abort older writes, surface saving/saved/idle states, and distinguish fetch failure from loading skeleton. | Peers Desktop must expose dirty/saving/error/retry states; Station APIs must support section-level failure semantics. |
| Auto-complete | `autocompleteAgentTitle`, `autocompleteAgentDescription`, `autocompleteAgentTags`, `autoPickEmoji`, `autocompleteAllMeta` | Settings can call system agent tasks to generate title/description/tags/avatar with trace metadata. | AI-assisted config editing is a runtime action with trace; generated suggestions must not silently become durable truth without save semantics. |

## 4. Required Peers-Touch Ownership Mapping

| Capability | Peers source of truth | Desktop responsibility | Station responsibility |
| --- | --- | --- | --- |
| Agent profile | Station Agent domain | Render/edit profile projection, show pending/error state. | Persist profile, authorize changes, emit config/profile update event. |
| Prompt/opening | Station Agent config | Provide editor and generated suggestion UI. | Persist typed prompt/opening config and validate section patches. |
| Agent model/runtime config | Station Agent config + Settings Provider projection | Display compound model ref and local runtime handles. | Validate provider/model refs and runtime policy for Station execution. |
| Tool/Knowledge bindings | Station Agent config references | Show binding summary and entry points. | Persist references and reject missing/unauthorized capability refs. |
| Desktop local workspace | Desktop runtime | Store device-local working directory/handles and project them to runtime. | Must not treat local paths as portable cross-end truth. |
| Settings edit trace | Station/domain event + Desktop UI state | Show save/retry/dirty state and submit patches. | Emit auditable `agent.config.updated` events with changed section metadata. |

## 5. Contract Implications

| Requirement | Contract implication |
| --- | --- |
| Agent config must be sectioned | Model/Station should expose profile, prompt, opening, runtime, capability and workspace sections rather than opaque `config_json` only. |
| Updates must be conflict-aware | Section patch API needs version/revision or equivalent conflict guard; aborting Desktop writes must not erase later Station truth. |
| Auto-generated metadata must be auditable | Generated title/description/tags/avatar suggestions need trace ID, source system agent and user confirmation state. |
| Runtime config must not drift from picker | Selected `AgentModelRef` in profile/settings must share helpers with M3 provider/model correctness. |
| Plugin/knowledge config must not own catalogs | Agent config stores refs; catalogs, install, resource indexing and credential ownership stay outside Agent profile. |
| Heterogeneous/external agents are first-class | External runtime flags alter UI and execution surface; they must be typed, not inferred from display text. |
| Fetch error differs from loading | Desktop projection needs `loading`, `error`, `retrying`, `saving`, `saved`, `dirty` or equivalent state, not endless skeletons. |

## 6. Mapping To Migration Batches

| Batch | This map contributes |
| --- | --- |
| M1 Contract Foundation | Agent config section contracts, profile/update event semantics and AgentModelRef linkage. |
| M3 Provider/model Correctness | Runtime/model fields share provider+model identity and duplicate-ID handling. |
| M5 Agent Config/Profile | Source-backed profile/settings UI and action semantics for typed config migration. |
| M6 Memory Projection | Agent memory settings and memory tool effort become typed config references, not ad hoc UI fields. |
| M7 Knowledge/Files | Knowledge/file bindings are references to resource truth. |
| M8 Tool/Plugin/Skill | Plugin/tool bindings are references to tool catalog/policy truth. |
| M9 Recovery/Diagnostics | Config save/fetch/generation failures become diagnosable states. |

## 7. Forbidden Relationships

1. Desktop profile page must not become Agent config source of truth.
2. Agent config must not own provider/model registry, tool catalog, resource indexing or credentials.
3. Local working-directory paths must not be persisted as portable Station truth.
4. Model selection must not be stored as model ID alone.
5. Generated prompt/meta suggestions must not silently overwrite durable config without save/audit semantics.
6. Product implementation must not copy LobeHub source code.

## 8. Current Claim

BOM-006 is implemented for design as a source-backed Agent config/profile/settings map.

M5 product implementation remains blocked until Owner confirmation and EVID-016.
