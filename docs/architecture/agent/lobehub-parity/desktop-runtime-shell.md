# Agent LobeHub Fullstack Parity — M2 Desktop Runtime Shell Spec

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Desktop Web
> **Module**: `apps/desktop/src/pages/`, `apps/desktop/src/runtimes/`, `apps/desktop/src/store/`, `apps/desktop/src/components/`
> **Plan Step**: PLAN-P4 / M2 pre-execution
> **Evidence**: EVID-011-B-pre

---

## 1. Purpose

This document turns M2 in `migration-plan.md` into a Desktop implementation-ready shell specification.

It does not authorize product code migration. It defines the exact runtime/page/store/component changes that must happen after prototype confirmation and M1 contract foundation, while preserving existing conversations and avoiding page-owned projection refresh.

## 2. Source Inputs

| Source | Role |
| --- | --- |
| `prototype-rebuild-blueprint.md` | Reset blueprint for the next source-backed high-fidelity prototype |
| `component-map.md` | LobeHub UI/source-level references |
| `desktop-matrix.md` | Current Desktop gaps and risks |
| `contract-foundation.md` | M1 contract assumptions and event/model ref direction |
| `docs/client/desktop/runtime-projections.md` | Desktop runtime/page/boot contract |
| `apps/desktop/src/pages/AgentChatPage.tsx` | Current Agent workbench shell |
| `apps/desktop/src/pages/AgentChatPage.descriptor.tsx` | Current declarative page descriptor |
| `apps/desktop/src/runtimes/agentCapabilityRuntime.ts` | Current Agent capability projection runtime |
| `apps/desktop/src/runtimes/agentTopicRuntime.ts` | Current Agent topic projection runtime |
| `apps/desktop/src/components/AgentSidebar.tsx` | Current Agent/topic sidebar and mount-time fetch risk |
| `apps/desktop/src/store/agent.ts` | Current Agent/model/applet projection store |
| `apps/desktop/src/store/agentTopics.ts` | Current topic projection store |
| `apps/desktop/src/pages/ChatPage.tsx` | Current chat canvas and session selection behavior |

## 3. Current State Inventory

| Area | Current Source | Current Behavior | Risk |
| --- | --- | --- | --- |
| Agent page shell | `AgentChatPage.tsx` | Renders Agent roster aside + `AgentSidebar` aside + `ChatPage` | Double-sidebar interaction model differs from LobeHub source/live evidence and increases cognitive load. |
| Page descriptor | `AgentChatPage.descriptor.tsx` | Declares `runtimes: ['agentCapability', 'agentTopic', 'social']` | Runtime descriptors use `agent-capability` and `agent-topic`; page lease IDs are inconsistent. |
| Capability runtime | `agentCapabilityRuntime.ts` | Loads models, agents, applets, MCP servers, skills and tools on bootstrap/reconcile | Useful foundation, but no typed event consumption path yet; M1/M3 will tighten provider/model contract. |
| Topic runtime | `agentTopicRuntime.ts` | Periodic 60s reconcile for selected Agent topics | Reconcile exists; immediate Station event consumption is not proven. |
| Agent sidebar | `AgentSidebar.tsx` | Calls `loadAgents()` and `loadTopicsForAgent()` from component effects | Violates runtime-first projection ownership if used as primary freshness. |
| Agent store | `agent.ts` | Owns selected Agent, models, applets, roster open state, agents list | Store mixes capability projection and UI shell state; selected model identity remains partial. |
| Topic store | `agentTopics.ts` | Owns topics per Agent, draft topics, rename/delete/duplicate, periodic reconcile consumer | Good base, but active Agent selection is derived through `useAgentStore`; event/reconnect semantics are incomplete. |
| Chat page | `ChatPage.tsx` | Calls `selectSession(currentSessionKey)` in mount effect and renders current message list | Page renderer still participates in session synchronization; must become view-bound only. |

## 4. Target Shell

The product shell must not follow the deleted prototype. It should follow the new source-backed prototype once Owner-confirmed; until then, the working target shape remains:

```text
Agent Workbench Page
├─ Agent Rail
│  ├─ Agent search
│  ├─ pinned agents
│  └─ all agents
├─ Topic Rail
│  ├─ active Agent summary
│  ├─ topic search
│  └─ grouped topic list
├─ Chat Canvas
│  ├─ header with Agent + provider/model state
│  ├─ message stream
│  ├─ runtime state cards
│  └─ composer
└─ Config / Resource Rail
   ├─ settings
   ├─ memory
   ├─ knowledge
   └─ tools
```

The shell is a renderer over runtime stores:

- Agent rail reads Agent capability projection.
- Topic rail reads Agent topic projection.
- Chat canvas reads chat/session/runtime projection.
- Config/resource rail reads Station-owned capability projections and local UI panel state.

## 5. Runtime Ownership Rules

| Projection | Owner | Allowed Writers | Forbidden Writers |
| --- | --- | --- | --- |
| Available providers/models | `agent-capability` runtime + provider/settings runtime projection | Store actions triggered by runtime/reconcile/settings mutation | Page/component mount effects |
| Agent roster | `agent-capability` runtime | Runtime bootstrap/reconcile, explicit user mutation actions | Sidebar mount effects |
| Applets/MCP/skills/tools capability index | `agent-capability` runtime | Runtime bootstrap/reconcile, capability-specific stores | Page shell |
| Agent topics | `agent-topic` runtime + `agentTopics` store | Runtime reconcile/event consumption, explicit topic actions | Sidebar mount effects as primary freshness |
| Current selected Agent/topic | Agent/topic stores | Explicit user actions and Station reconciliation | Derived hidden component state |
| Chat messages/runtime stream | Chat runtime/store | Station stream events, Desktop Rust bridge, explicit user actions | Agent page shell |
| Right rail tab/width/open state | Desktop local UI state | Page shell/store | Station |

## 6. Implementation Slices

### M2.1 Runtime Descriptor Alignment

Target paths:

- `apps/desktop/src/pages/AgentChatPage.descriptor.tsx`
- `apps/desktop/src/runtimes/agentCapabilityRuntime.ts`
- `apps/desktop/src/runtimes/agentTopicRuntime.ts`
- `apps/desktop/src/services/appRuntime.ts`

Required changes:

1. Page descriptor must declare runtime IDs that exactly match registered descriptors:
   - `agent-capability`
   - `agent-topic`
   - `social`
2. Add or update tests/search checks that prevent `agentCapability` / `agentTopic` from reappearing as page runtime IDs.
3. Keep `preload: 'idle'` and `keepAlive: 'forever'` unless performance evidence proves otherwise.

Acceptance:

- Descriptor runtime IDs match registered runtime IDs.
- `pnpm --dir apps/desktop run check` passes.
- No additional page mount fetch is introduced.

### M2.2 Agent Workbench Shell Split

Target paths:

- `apps/desktop/src/pages/AgentChatPage.tsx`
- New or refactored components under `apps/desktop/src/components/agent/`

Required changes:

1. Replace the current Agent roster + `AgentSidebar` double-aside layout with explicit shell regions:
   - Agent rail
   - Topic rail
   - Chat canvas
   - Config/resource rail
2. Extract pure renderer components:
   - `AgentWorkbenchShell`
   - `AgentRail`
   - `AgentTopicRail`
   - `AgentResourceRail`
3. Keep creation/edit/navigation callbacks as explicit user actions.
4. Do not use shell extraction to move business truth into React local state.

Acceptance:

- Agent switch, topic switch and chat canvas remain usable.
- Existing selected Agent/session is preserved through migration.
- No large hidden remount on normal Agent page navigation.

### M2.3 Remove Primary Mount-Time Projection Fetches

Target paths:

- `apps/desktop/src/components/AgentSidebar.tsx`
- `apps/desktop/src/runtimes/agentCapabilityRuntime.ts`
- `apps/desktop/src/runtimes/agentTopicRuntime.ts`
- `apps/desktop/src/store/agent.ts`
- `apps/desktop/src/store/agentTopics.ts`

Required changes:

1. Remove `loadAgents()` as primary `AgentSidebar` mount freshness.
2. Remove `loadTopicsForAgent()` as primary `AgentSidebar` mount freshness.
3. Move Agent switch topic loading into runtime/store action:
   - user action selects Agent;
   - store records selected Agent;
   - runtime/store reconciles topics for selected Agent;
   - component renders projection state.
4. Keep defensive explicit refresh only as user action or runtime-owned reconciliation.

Acceptance:

- Agent/topic list loads from runtime bootstrap/reconcile.
- Agent switch updates topics without relying on sidebar remount.
- Runtime periodic reconcile continues to work.

### M2.4 Chat Canvas Session Projection Cleanup

Target paths:

- `apps/desktop/src/pages/ChatPage.tsx`
- `apps/desktop/src/store/chat.ts`
- `apps/desktop/src/store/agentTopics.ts`

Required changes:

1. Remove or justify `selectSession(currentSessionKey)` mount effect.
2. Move any session synchronization into explicit store/runtime action.
3. Keep scroll-to-bottom effect because it is view-bound, not projection freshness.
4. Ensure empty, streaming, error, artifact and retry states still render.

Acceptance:

- ChatPage is a renderer over current chat/session state.
- Selecting a topic changes the chat canvas through store action, not page mount.
- No regression in send/retry/stop/continue interactions.

### M2.5 Right Rail Prototype Parity

Target paths:

- `apps/desktop/src/pages/AgentChatPage.tsx`
- `apps/desktop/src/components/agent/`
- Later M5/M6/M7/M8-specific components.

Required changes:

1. Add the right rail container with tabs:
   - settings
   - memory
   - knowledge
   - tools
2. In M2, use existing product data where available and explicit degraded/empty states where not available.
3. Do not fake Station-owned functionality that is not implemented yet.
4. Defer deep Memory/Knowledge/Tool behaviors to M6/M7/M8.

Acceptance:

- Rail exists and does not block chat interaction.
- Missing backend states are represented honestly.
- No product code claims parity for Memory/Knowledge/Tool beyond current evidence.

### M2.6 Compatibility Adapter

Target paths:

- `apps/desktop/src/utils/openAgentChatSession.ts`
- `apps/desktop/src/store/chat.ts`
- `apps/desktop/src/store/agentTopics.ts`
- Agent shell components.

Required changes:

1. Existing sessions/topics remain visible after shell migration.
2. Draft topic creation remains compatible.
3. Import/export/duplicate/delete/rename/smart rename topic actions keep their current user-visible semantics.
4. Any old prop shape removed from `AgentSidebar` must be mapped through new components before deletion.

Acceptance:

- Existing session keys are not rewritten.
- Current Agent/topic actions still work.
- Rollback does not require data migration.

## 7. Forbidden Relationships

M2 implementation must not:

1. Add new page/component `useEffect(...load...)` as primary Agent/topic/model freshness.
2. Create a second Agent capability runtime with overlapping store ownership.
3. Put Station-owned Agent/topic/session business truth into page-local state.
4. Reintroduce `agentCapability` or `agentTopic` page runtime IDs if runtime descriptors remain `agent-capability` and `agent-topic`.
5. Treat right-rail Memory/Knowledge/Tool mock UI as implemented backend parity.
6. Combine M2 shell migration with M3 provider/model identity changes unless the Evidence row explicitly expands scope.
7. Format unrelated product files.

## 8. Verification Matrix

| Check | Required Evidence |
| --- | --- |
| Descriptor alignment | Search proves page descriptor runtime IDs match registered runtimes. |
| Desktop check | `pnpm --dir apps/desktop run check` passes. |
| Agent switch | Manual/browser or component-level acceptance proves switching Agent updates Agent rail/topic rail/chat header. |
| Topic switch | Manual/browser or component-level acceptance proves topic selection updates chat session without remount-only load. |
| Runtime ownership | Search/review proves no new primary mount-time projection fetch was added. |
| Existing data preservation | Existing topic/session keys remain visible and actions still call current store/service functions. |
| Right rail honesty | Memory/Knowledge/Tool tabs show real/degraded states, not false parity. |

## 9. Stop Conditions

Stop M2 implementation if:

1. EVID-010-PROTOTYPE-REBUILD-N remains only `pending-review`; no current prototype is Owner-confirmed.
2. M1 contract implementation is required but not landed.
3. Runtime descriptor alignment changes require a kernel behavior change that is not documented.
4. Agent/topic/session state can only be made correct by adding component mount loads.
5. Migration would delete or rewrite existing sessions/topics.
6. The shell cannot preserve current chat send/retry/stop behavior.

## 10. Evidence Target

After revised prototype acceptance and M1, the implementation batch should append:

| Evidence ID | BOM ID | Spec ID | Plan Step | Gate ID | Artifact | Result | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EVID-013 | BOM-008/BOM-012/BOM-013/BOM-015 | SPEC-001/SPEC-002/SPEC-008/SPEC-009/SPEC-010/SPEC-011/SPEC-013 | PLAN-P5 / M2 | GATE-006/GATE-008 | Agent page shell files, runtime descriptor files, command/browser evidence | Desktop Agent shell migrated to prototype-aligned runtime-owned structure | Provider/model correctness and deep Memory/Knowledge/Tool parity remain later batches |

## 11. Current M2 Readiness

| Requirement | Status | Evidence |
| --- | --- | --- |
| Current Desktop risk inventory known | implemented | `desktop-matrix.md`, current source inspection |
| Runtime descriptor mismatch identified | implemented | `AgentChatPage.descriptor.tsx` vs runtime descriptor IDs |
| Mount-time projection fetch risks identified | implemented | `AgentSidebar.tsx`, `ChatPage.tsx` inspected |
| Prototype target shell known | implemented for planning | `docs/architecture/agent/prototype-lobehub-parity/README.md`, `packages/prototypes/desktop/features/agent-lobehub-parity/`, EVID-010-PROTOTYPE-REBUILD-N |
| Product implementation allowed | blocked | Pending Owner confirmation of the `pending-review` prototype and M1 implementation |
