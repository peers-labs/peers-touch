# Agent LobeHub Fullstack Parity — M5 Agent Config/Profile Parity Spec

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Station + Desktop
> **Module**: `apps/station/app/subserver/agent/`, `model/domain/agent/`, `apps/desktop/src/pages/AgentProfilePage.tsx`, `apps/desktop/src/components/AgentSettingsModal.tsx`, `apps/desktop/src/services/agent-runtime-config.ts`
> **Plan Step**: PLAN-P4 / M5 pre-execution
> **Evidence**: EVID-011-E-pre

---

## 1. Purpose

This document turns M5 in `migration-plan.md` into an Agent config/profile implementation-ready specification.

The target is LobeHub-level Agent profile/settings parity through Peers-Touch ownership:

- Station owns Agent profile and config truth.
- Model owns config contract semantics.
- Desktop Web renders and edits projections.
- Desktop Rust only participates for device-local runtime handles.

This is a pre-execution spec. It does not modify product code and does not claim GATE-008 complete.

## 2. Source Inputs

| Source | Role |
| --- | --- |
| `design.md` | Station/Desktop/Model source-of-truth and forbidden relationships |
| `contract-foundation.md` | M1 model/domain contract direction |
| `agent-config-source-map.md` | Maps LobeHub Agent meta/prompt/opening/runtime/bindings/save semantics to Peers Station/Desktop ownership |
| `provider-model-correctness.md` | Provider/model identity and AgentModelRef rules |
| `session-topic-runtime.md` | Runtime/session dependency and activity trace expectations |
| `external/lobehub/src/routes/(main)/agent/profile/features/ProfileEditor/index.tsx` | LobeHub profile editor/runtime config reference |
| `external/lobehub/src/features/AgentSetting/AgentSettingsContent.tsx` | LobeHub Agent settings tab reference |
| `external/lobehub/src/features/AgentSetting/AgentPrompt/index.tsx` | LobeHub prompt editing behavior reference |
| `apps/station/app/subserver/agent/service/agent_service.go` | Current Station Agent CRUD/profile/config_json owner |
| `apps/station/app/subserver/agent/service/agent_config_service.go` | Current Station binding service for knowledge/skill/MCP |
| `apps/station/app/subserver/agent/domain/agent.go` | Current domain Agent fields |
| `apps/station/app/subserver/agent/infrastructure/persistence/agent.go` | Current Agent persistence shape |
| `model/domain/agent/agent.proto` | Current proto Agent and config_json shape |
| `apps/desktop/src/services/desktop_api.ts` | Current TS Agent/AgentChatConfig shape and API calls |
| `apps/desktop/src/services/agent-runtime-config.ts` | Current runtime config builder |
| `apps/desktop/src/pages/AgentProfilePage.tsx` | Current profile/settings/activity UI |
| `apps/desktop/src/components/AgentSettingsModal.tsx` | Current lightweight settings modal |
| `apps/desktop/src/store/agent.ts` | Current Agent store and updateAgentConfig path |

## 3. Current State Inventory

| Area | Current Behavior | Risk |
| --- | --- | --- |
| Station Agent core | `AgentService` owns name, title, description, provider_id, model_name, effort, visibility, owner_actor_id, config_json. | `config_json` is untyped and does not expose a stable LobeHub-level config contract. |
| Station AgentConfigService | Handles knowledge, skill and MCP bindings. | Name suggests full Agent config, but service does not own prompt/opening/model/runtime config contract yet. |
| Model proto | `Agent` has top-level provider/model/effort and raw `config_json`. | Shared semantics remain hidden in JSON; Desktop/Station can drift. |
| Desktop Agent type | `Agent`/`AgentChatConfig` include many local fields and JSON parsing helpers. | Desktop owns parsing semantics that should become Model/Station contract. |
| Runtime config builder | `buildAgentRuntimeConfig()` maps `soulMd`, `agentsMd`, `chatConfig`, provider/model, runtimeBackend, roots and knowledge resources into turn input. | Runtime execution depends on scattered fields and JSON conventions. |
| AgentProfilePage | Mixes Agent roster, prompt editors, model/runtime settings, memory/activity panels and local auto-save timers. | Page becomes an orchestration surface instead of a renderer over Station-owned config projection. |
| AgentSettingsModal | Edits title, description, backgroundColor, tags, opening message/questions. | Lightweight modal overlaps with profile page and stores settings as loose strings/JSON arrays. |
| LobeHub reference | Profile editor separates header, runtime config, model select, tool config and prompt editor; settings content separates opening/connectors/self-iteration tabs. | Peers needs same capability coverage but through Peers Station/Desktop boundaries. |

## 4. Target Config Contract

M5 should promote scattered config into a typed Agent config family.

Architecture sketch:

```ts
interface AgentProfile {
  agentId: string;
  name: string;
  title: string;
  description: string;
  avatar?: string;
  backgroundColor?: string;
  tags: string[];
  visibility: 'private' | 'workspace';
  ownerActorId: string;
}

interface AgentPromptConfig {
  identityPrompt?: string;       // current soulMd
  instructionPrompt?: string;    // current agentsMd / system prompt
  systemRole?: string;
}

interface AgentOpeningConfig {
  openingMessage?: string;
  recommendedQuestions: string[];
}

interface AgentRuntimeConfigContract {
  modelRef?: AgentModelRef;
  effort?: string;
  contextWindowSize?: number;
  providerFallback?: {
    enabled: boolean;
    maxRetries?: number;
    strategy?: string;
  };
  runtimeBackend?: string;
  workspaceMode?: string;
  workspaceRoot?: string;
  allowedRoots: string[];
  rootfsPath?: string;
  cliCommand?: string;
}

interface AgentCapabilityConfig {
  skills: string[];
  tools: string[];
  mcpServers: string[];
  knowledgeResources: AgentResourceRef[];
}
```

Rules:

- These TypeScript shapes are implementation sketches. Canonical semantics belong in `model/domain/agent/` after M1.
- `config_json` may remain as compatibility storage during migration, but must have versioned schema.
- New Desktop UI must edit typed fields through Station APIs or typed compatibility adapters.
- Agent config must be auditable: who changed what, when, and whether runtime config changed active turn behavior.

## 5. Implementation Slices

### M5.1 Versioned Agent Config Schema

Target paths:

- `model/domain/agent/`
- `apps/station/app/subserver/agent/domain/agent.go`
- `apps/station/app/subserver/agent/service/agent_service.go`
- `apps/station/app/subserver/agent/infrastructure/persistence/agent.go`

Required changes:

1. Define a versioned Agent config contract:
   - `profile`
   - `prompt`
   - `opening`
   - `runtime`
   - `capabilities`
   - `workspace`
2. Preserve current top-level Agent fields during staged migration.
3. Add JSON compatibility parser/writer in Station, not only Desktop.
4. Reject invalid config with typed errors instead of storing arbitrary invalid JSON.

Acceptance:

- Station tests cover valid config, unknown future version, invalid JSON and partial update merge.
- Existing agents with current `config_json` continue loading.

### M5.2 Station Config Patch API

Target paths:

- `model/domain/agent/agent.proto`
- Station Agent handlers/services generated consumers
- Desktop `desktop_api.ts`

Required changes:

1. Add a typed patch/update operation for Agent config sections.
2. Ensure patch authorization requires owner or future explicit operator grant.
3. Emit `agent.config.updated` or equivalent domain event with changed section metadata.
4. Keep current `UpdateAgent` compatibility path while Desktop migrates.

Acceptance:

- Profile, prompt, opening, runtime and capability sections can be updated independently.
- Unknown section update is rejected.
- Audit/event metadata includes actor, agent, section and timestamp.

### M5.3 Desktop Profile Surface Restructure

Target paths:

- `apps/desktop/src/pages/AgentProfilePage.tsx`
- New or refactored components under `apps/desktop/src/components/agent/`
- `apps/desktop/src/store/agent.ts`

Required changes:

1. Split current `AgentProfilePage` into renderer components:
   - `AgentProfileHeader`
   - `AgentPromptPanel`
   - `AgentRuntimePanel`
   - `AgentOpeningPanel`
   - `AgentCapabilityPanel`
   - `AgentActivityPanel`
2. Keep page lifecycle view-bound only.
3. Move Agent config load/save into runtime/store actions.
4. Replace auto-save timers with explicit dirty state and deterministic save/revert, unless Owner confirms auto-save.
5. Do not mix Memory/Knowledge/Tool deep management into M5 beyond capability binding summary and entry points.

Acceptance:

- Profile page remains usable for current agents.
- Config saves are explicit, recoverable and show error state.
- Activity trace panel remains read-only projection.

### M5.4 Settings Modal Unification

Target paths:

- `apps/desktop/src/components/AgentSettingsModal.tsx`
- Profile components from M5.3

Required changes:

1. Remove duplicate semantics between modal and profile page by using shared config sections/components.
2. Modal may remain as compact entry, but must write through the same typed config adapter.
3. Tags and opening questions use structured arrays, not raw JSON strings in UI component state.
4. Background color/avatar/title/description remain profile fields.

Acceptance:

- Saving via modal and profile page produces the same Station config shape.
- No divergence between `openingQuestions` raw string and structured recommended questions.

### M5.5 Runtime Config Builder Migration

Target paths:

- `apps/desktop/src/services/agent-runtime-config.ts`
- `apps/desktop/src/store/chat.ts`
- M3 model ref helpers after EVID-014

Required changes:

1. Build turn runtime config from typed Agent config contract.
2. Continue compatibility with legacy fields:
   - `soulMd`
   - `agentsMd`
   - `chatConfig`
   - `allowedRoots`
   - `provider`
   - `model`
3. Runtime config output must preserve:
   - AgentModelRef/provider/model
   - identity/instruction prompt
   - context window
   - provider fallback
   - knowledge resources
   - workspace/rootfs/local roots
   - runtime backend/CLI command
4. If config has conflict between typed and legacy fields, typed config wins and conflict is logged/reported.

Acceptance:

- Unit tests cover legacy-only, typed-only and conflict cases.
- Send turn uses the same runtime config as profile display.

### M5.6 LobeHub Parity UI Coverage

Target paths:

- Desktop Agent profile/settings components

Required UI coverage:

| LobeHub Capability | Peers M5 Target |
| --- | --- |
| Agent header avatar/name/description | Profile header section |
| Runtime model select | M3 compound model picker embedded in runtime panel |
| Tool entry | Capability panel entry point, deeper M8 behavior |
| Prompt editor | Prompt panel with identity/instruction prompts and token/length feedback |
| Opening settings | Opening message and recommended questions panel |
| Connectors/settings tabs | Capability/settings tabs mapped to Peers skills/MCP/knowledge entry points |
| Heterogeneous/local runtime config | Runtime backend/CLI/workspace fields with honest availability states |

Acceptance:

- M5 UI exposes the config shape needed for LobeHub-level Agent profile parity.
- Deep Memory/Knowledge/Tool behavior is linked to M6/M7/M8 instead of falsely implemented in M5.

### M5.7 Compatibility And Migration

Target paths:

- Station migration/adapter code
- Desktop API parser helpers
- Agent store

Required changes:

1. Existing agents load without data migration.
2. First save through M5 writes versioned config while preserving old top-level fields.
3. Export/import package format maps typed config and legacy fields.
4. Duplicate/clone Agent preserves profile/config/capability bindings.

Acceptance:

- Existing default assistant, user-created agents and imported packages still render.
- Rollback can read legacy fields.

## 6. Required Test Matrix

| Test Class | Required Case |
| --- | --- |
| Station config parser | Legacy `config_json`, typed v1 config, invalid JSON, unknown version. |
| Section patch | Profile, prompt, opening, runtime and capability section updates merge correctly. |
| Authorization | Non-owner mutation is rejected unless future operator grant exists. |
| Desktop runtime builder | Legacy-only, typed-only and conflict precedence. |
| UI save/revert | Dirty state, save success, save failure and revert are visible. |
| Model config | Runtime panel uses M3 provider+model identity. |
| Opening config | Recommended questions roundtrip as structured array. |
| Export/import | Typed config survives package export/import without losing legacy compatibility. |

## 7. Forbidden Relationships

M5 implementation must not:

1. Treat Desktop profile page state as Agent config truth.
2. Add new unversioned keys to `config_json` without Station parser/validator.
3. Store recommended questions/tags as raw UI JSON strings in newly written code.
4. Resolve model selection by `model_id` alone.
5. Implement deep Memory/Knowledge/Tool management in M5 and claim M6/M7/M8 parity.
6. Replace explicit config save evidence with silent auto-save unless Owner confirms that interaction.
7. Copy LobeHub profile/settings source wholesale.

## 8. Evidence Target

After EVID-010 and EVID-012 to EVID-015, the implementation batch should append:

| Evidence ID | BOM ID | Spec ID | Plan Step | Gate ID | Artifact | Result | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EVID-016 | BOM-006/BOM-009/BOM-015 | SPEC-005/SPEC-011/SPEC-013/SPEC-014 | PLAN-P5 / M5 | GATE-006/GATE-008 | Station Agent config contract/API, Desktop profile/settings components, runtime-config tests, command/browser evidence | Agent profile/config parity implemented with Station-owned typed config and LobeHub-level UI coverage | Deep Memory/Knowledge/Tool behavior remains later batches |

## 9. Current M5 Readiness

| Requirement | Status | Evidence |
| --- | --- | --- |
| Current Station Agent config storage known | implemented | `agent_service.go`, `domain/agent.go`, `persistence/agent.go`, `model/domain/agent/agent.proto` inspected |
| Current binding service boundary known | implemented | `agent_config_service.go`, `domain/agent_config_service.go`, `persistence/agent_config.go` inspected |
| Current Desktop profile/settings risks identified | implemented | `AgentProfilePage.tsx`, `AgentSettingsModal.tsx`, `agent.ts`, `desktop_api.ts` inspected |
| LobeHub profile/settings references identified | implemented | LobeHub `ProfileEditor`, `AgentSettingsContent`, `AgentPrompt` inspected |
| Product implementation allowed | blocked | Pending revised prototype acceptance and EVID-012 to EVID-015 implementation sequence |
