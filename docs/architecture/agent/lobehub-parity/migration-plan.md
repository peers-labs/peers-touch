# Agent LobeHub Fullstack Parity — Migration Plan

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Peers-Touch Agent Team
> **Module**: `apps/desktop/`, `apps/desktop/src-tauri/`, `apps/station/app/subserver/agent/`, `model/domain/agent/`
> **Plan Step**: PLAN-P4
> **Evidence**: EVID-011

---

## 1. Purpose

This plan turns the LobeHub parity source audit, BOM-001 frontend source map, capability matrix, pending-review prototype, and fullstack architecture design into product migration batches.

It is an execution plan, not implementation permission. Product code migration remains blocked until:

1. A new source-backed high-fidelity Agent parity prototype is Owner-confirmed.
2. Each migration batch has BOM / Spec / Gate / Evidence binding.
3. The batch proves its own minimal deterministic checks before the next batch starts.

## 2. Inputs

| Source | Role |
| --- | --- |
| `tmp/agent-lobehub-fullstack-ledger.md` | Master BOM / Spec / Plan / Gate / Evidence / Traceability ledger |
| `source-audit.md` | LobeHub and Peers-Touch source inventory |
| `frontend-source-map.md` | BOM-001 LobeHub Home/Agent/Chat frontend source map and Peers ownership mapping |
| `component-map.md` | LobeHub UI/source-level component map |
| `session-topic-action-map.md` | LobeHub Session/Topic/Thread/Message/Generation action taxonomy and Peers ownership mapping |
| `chat-runtime-source-map.md` | LobeHub Chat runtime, streaming chunk, client/gateway, parked-state and recovery semantics mapping |
| `provider-model-source-map.md` | LobeHub Provider/model aiInfra runtime-state, model fetch and capability selector mapping |
| `agent-config-source-map.md` | LobeHub Agent config/profile/settings semantics and Peers Station/Desktop ownership mapping |
| `tool-knowledge-source-map.md` | LobeHub Tool/Plugin/Skill/Knowledge/File source map and Peers ownership mapping |
| `backend-matrix.md` | Station backend capability matrix |
| `desktop-matrix.md` | Desktop runtime/store/component matrix |
| `integration.md` | Full capability gap matrix |
| `design.md` | Station/Desktop/Model ownership and forbidden relationships |
| `decisions.md` | ADR-lite decisions for LobeHub reference, ownership, provider+model, Actor#agent and migration gate |
| `docs/architecture/agent/prototype-lobehub-parity/README.md` | Pending-review replacement prototype evidence |
| `license-attribution.md` | SPEC-014 LobeHub reference, direct reuse and attribution boundary |
| `plan-p5-entry-gate.md` | EVID-012 pre-edit hard gate after Owner confirmation and before product code changes |
| `docs/client/desktop/runtime-projections.md` | Desktop runtime projection contract |

## 3. Non-Goals

- Do not implement product code in this plan document.
- Do not claim LobeHub parity from a mock prototype.
- Do not bypass Settings Provider as the Provider/model source.
- Do not copy LobeHub source wholesale without license and attribution review.
- Do not implement Actor#agent social product behavior in this round.
- Do not use Desktop Web as business source-of-truth for Agent, Memory, Knowledge, Tool, Session or Topic state.

## 4. Domain Responsibility Split

| Domain | Responsibility | Source Of Truth | Primary Paths | Gate |
| --- | --- | --- | --- | --- |
| Contract foundation | Shared Agent refs, runtime events, resource refs, actor-agent reserved contracts | Model | `model/domain/agent/` and generated consumers | GATE-006/GATE-008 |
| Provider/model identity | Settings Provider projection, provider+model selection, fallback/error policy | Station policy + Desktop Settings projection | `apps/desktop/src/store/provider.ts`, `apps/desktop/src/store/agent.ts`, Station provider services | GATE-005/GATE-008 |
| Desktop runtime projection | Agent workbench page, runtimes, store ownership, page descriptor alignment | Desktop Web runtimes over Station truth | `apps/desktop/src/{pages,runtimes,store,components}/` | GATE-006/GATE-008 |
| Chat/session/topic runtime | Session/topic/message persistence, stream projection, retry/branch/reconcile | Station | Station Agent subserver, Desktop Rust bridge, Desktop Web chat runtime | GATE-006/GATE-008 |
| Agent profile/config | Prompt, opening, recommended questions, model policy, context and runtime settings | Station | Station AgentService/AgentConfigService, Desktop profile/settings UI | GATE-006/GATE-008 |
| Memory projection | Memory injected/used/updated trace, rollback/recovery UI | Station MemoryService | Station memory handlers, Desktop memory projection/UI | GATE-006/GATE-008 |
| Knowledge/files | Durable resources, local opaque handles, index status, retrieval diagnostics | Station + Desktop Rust local handles | Station knowledge services, Desktop Rust file bridge, Desktop resources UI | GATE-006/GATE-008 |
| Tool/plugin/skill | Manifest, trust, compatibility, approval, result, audit | Station policy + Desktop Rust executor | ToolRegistryService, SkillService, LocalToolBroker, Desktop UI | GATE-006/GATE-008 |
| Actor#agent reserved | Identity binding, visibility, capability exposure, event scopes | Station + Model | `design.md` reserved contracts, future model domain | GATE-007 |
| License/attribution | Source usage boundaries for LobeHub-derived reference | Architecture | `license-attribution.md`, `component-map.md`, future implementation PR notes | GATE-001/GATE-002/GATE-008 |

## 5. Migration Dependency Order

```text
M0 Revised prototype acceptance
  -> M1 Contract and identity foundation
  -> M2 Desktop runtime shell migration
  -> M3 Provider/model correctness
  -> M4 Session/topic/message runtime closure
  -> M5 Agent config/profile parity
  -> M6 Memory projection parity
  -> M7 Knowledge/files parity
  -> M8 Tool/plugin/skill parity
  -> M9 Error recovery, diagnostics and parity hardening
  -> M10 Actor#agent reserved contract alignment
```

The order is dependency-driven:

- Runtime shell must land before UI detail migration to avoid page-owned fetches.
- Provider/model correctness must land before real chat execution parity.
- Session/topic/message closure must land before advanced Memory/Knowledge/Tool trace surfaces can be reliable.
- Actor#agent remains reserved and should shape contracts, but not block visible LobeHub UI parity once reserved fields are stable.

## 6. Batch Plan

### M0 — Prototype Confirmation Gate

| Field | Value |
| --- | --- |
| BOM | BOM-012 |
| Spec | SPEC-010 |
| Gate | GATE-003, GATE-004 |
| Current evidence | EVID-008, EVID-009, EVID-010, EVID-010-R1, EVID-010-PROTOTYPE-RESET, EVID-010-PROTOTYPE-REBUILD-A..N |
| Status | pending-owner-review |

Scope:

- Do not review the deleted `Agent LobeHub` prototype.
- Treat EVID-010-R1 and later scaffold evidence as historical rejection evidence only.
- Review the replacement `agent-lobehub-parity` prototype as the current source-backed high-fidelity prototype.
- Product migration remains blocked until this pending-review prototype is Owner-confirmed.

Exit criteria:

- `agent-lobehub-parity` status becomes `confirmed` after Owner acceptance, or migration remains blocked with revision notes.

Evidence target:

- EVID-010: REVISION REQUIRED recorded.
- EVID-010-PROTOTYPE-RESET: rejected prototype deleted and removed from Portal; new prototype required.
- EVID-010-PROTOTYPE-REBUILD-N: replacement prototype reached `pending-review`; Owner confirmation remains required before EVID-012.

### M1 — Contract And Identity Foundation

| Field | Value |
| --- | --- |
| BOM | BOM-013, BOM-014 |
| Spec | SPEC-003, SPEC-004, SPEC-006, SPEC-007, SPEC-008, SPEC-009, SPEC-011, SPEC-012 |
| Gate | GATE-006, GATE-007, GATE-008 |
| Owner | Model + Station + Desktop |

Deliverables:

- Define canonical `AgentModelRef` with `provider_id + model_id`.
- Define typed `AgentRuntimeEvent` contract family for text/thinking/tool/error/done/abort/reconcile.
- Define resource refs for memory, knowledge, file/folder, tool and artifact references.
- Reserve Actor#agent contract fields: binding, visibility, exposed capabilities and event scopes.

Target paths:

- `model/domain/agent/`
- Station generated domain consumers.
- Desktop Rust/TS generated or proto-aligned consumers.

Acceptance:

- Proto/domain generation passes.
- Existing Station/Desktop manual DTOs have a mapped compatibility plan.
- No duplicate new manual cross-layer contract is introduced.

Evidence target:

- EVID-012: M1 contract generation and compatibility report after revised prototype acceptance.

Pre-execution spec:

- `contract-foundation.md` defines the contract inventory, required proto additions, compatibility mapping, test matrix and stop conditions for this batch.
- `m1-implementation-kickoff.md` defines the post-EVID-010 entry gate, target impact surface, work order, verification commands, review assertions and EVID-012 template.

### M2 — Desktop Runtime Shell Migration

| Field | Value |
| --- | --- |
| BOM | BOM-008, BOM-012, BOM-013 |
| Spec | SPEC-001, SPEC-002, SPEC-008, SPEC-009, SPEC-010, SPEC-011, SPEC-013 |
| Gate | GATE-004, GATE-006, GATE-008 |
| Owner | Desktop Web |

Deliverables:

- Replace current double-agent-sidebar complexity with the prototype's one Agent list + one Topic list + chat canvas + config/resource rail structure.
- Correct Agent page runtime descriptor IDs to match runtime descriptor IDs.
- Move long-lived data freshness into runtimes/stores; pages remain renderers.
- Preserve current conversations during migration with a compatibility adapter.

Target paths:

- `apps/desktop/src/pages/AgentChatPage.tsx`
- `apps/desktop/src/pages/AgentChatPage.descriptor.tsx`
- `apps/desktop/src/pages/ChatPage.tsx`
- `apps/desktop/src/components/agent*/`
- `apps/desktop/src/runtimes/agent*Runtime.ts`
- `apps/desktop/src/store/agent*.ts`

Acceptance:

- `pnpm --dir apps/desktop run check` passes.
- Page descriptor uses registered runtime IDs.
- No new mount-time API fetch is added as primary projection freshness.
- Agent switch and Topic switch preserve existing session state.

Evidence target:

- EVID-013: M2 Desktop runtime shell migration report after revised prototype acceptance and M1.

Pre-execution spec:

- `desktop-runtime-shell.md` defines descriptor alignment, Agent workbench shell split, projection ownership, mount-time fetch removal, right rail scope, compatibility adapter, verification matrix and stop conditions for this batch.

### M3 — Provider/Model Correctness

| Field | Value |
| --- | --- |
| BOM | BOM-003, BOM-010 |
| Spec | SPEC-003, SPEC-013 |
| Gate | GATE-005, GATE-008 |
| Owner | Provider Runtime + Desktop |

Deliverables:

- Ensure all Agent selection, validation, persistence and display paths use `provider_id + model_id`.
- Consume Settings Provider projection only; no hardcoded default model list.
- Surface provider health/error/fallback states in Agent UI.
- Keep CLI provider local execution boundary explicit.

Target paths:

- `apps/desktop/src/store/provider.ts`
- `apps/desktop/src/store/agent.ts`
- `apps/desktop/src/components/ChatInput.tsx`
- `apps/desktop/src/components/settings/ProviderDetail.tsx`
- `apps/desktop/src-tauri/src/application/models/`
- Station provider services where shared policy applies.

Acceptance:

- Duplicate model IDs across providers select and persist correctly.
- Settings Provider enable/disable/fetch changes refresh Agent projection.
- `pnpm --dir apps/desktop run check` passes.
- Rust model/provider tests pass when Rust paths are touched.

Evidence target:

- EVID-014: M3 provider/model correctness proof after revised prototype acceptance, M1 and M2.

Pre-execution spec:

- `provider-model-source-map.md` maps LobeHub aiInfra semantics that M3 must preserve at the contract/projection level.
- `provider-model-correctness.md` defines compound model identity, Settings Provider projection refresh, Agent store migration, picker migration, chat turn input, CLI/Desktop boundary, Station provider boundary, verification matrix and stop conditions for this batch.

### M4 — Session / Topic / Message Runtime Closure

| Field | Value |
| --- | --- |
| BOM | BOM-002, BOM-007, BOM-008, BOM-009 |
| Spec | SPEC-002, SPEC-008, SPEC-009, SPEC-011 |
| Gate | GATE-006, GATE-008 |
| Owner | Station + Desktop Rust + Desktop Web |

Deliverables:

- Station owns session/topic/message persistence and search.
- Desktop Rust bridges stream/cancel/reconcile without owning business truth.
- Desktop Web chat/topic runtimes consume typed events and reconcile missed events.
- Retry, continue, regenerate, branch and delete are mapped to Station-owned actions.

Target paths:

- `apps/station/app/subserver/agent/handler/turn_handler.go`
- `apps/station/app/subserver/agent/service/turn_service.go`
- `apps/desktop/src-tauri/src/interface/tauri_commands/agent_turn.rs`
- `apps/desktop/src-tauri/src/application/agent_turn/`
- `apps/desktop/src/store/chat.ts`
- `apps/desktop/src/store/agentTopics.ts`
- `apps/desktop/src/runtimes/agentTopicRuntime.ts`

Acceptance:

- Stream text/thinking/tool/error/done/abort/reconcile paths are typed.
- Cancel and reconnect reconcile to Station truth.
- Existing visible conversations are not lost.
- Desktop check, targeted Cargo tests and Station Go tests pass for touched areas.

Evidence target:

- EVID-015: M4 session/topic/message runtime closure report after revised prototype acceptance and M1-M3.

Pre-execution spec:

- `session-topic-action-map.md` maps LobeHub action semantics and source paths that M4 must preserve at the contract level.
- `chat-runtime-source-map.md` maps LobeHub runtime/streaming/recovery semantics that M4 must preserve at the typed event and action-lineage boundary.
- `session-topic-runtime.md` defines typed runtime event adapter, durable reconcile cursor, Station-owned action lineage, Desktop chat store split, topic projection closure, Desktop Rust bridge closure, gateway compatibility, verification matrix and stop conditions for this batch.

### M5 — Agent Profile And Config Parity

| Field | Value |
| --- | --- |
| BOM | BOM-006, BOM-009 |
| Spec | SPEC-005, SPEC-011, SPEC-013 |
| Gate | GATE-006, GATE-008 |
| Owner | Station + Desktop |

Deliverables:

- Station Agent config contract covers prompt/persona, opening message, recommended questions, model policy, context window, reasoning/effort and runtime backend.
- Desktop profile/settings UI exposes LobeHub-level config shape through Peers-Touch UI identity.
- Agent config writes go through Station; Desktop only projects.

Target paths:

- `apps/station/app/subserver/agent/service/agent_service.go`
- `apps/station/app/subserver/agent/service/agent_config_service.go`
- `apps/desktop/src/services/agent-runtime-config.ts`
- `apps/desktop/src/components/AgentSettingsModal.tsx`
- Agent profile/settings pages/components.

Acceptance:

- Save/load roundtrip proves Station ownership.
- Config maps into turn execution without ad hoc JSON drift.
- UI exposes incomplete backend states as unavailable/degraded, not fake controls.

Evidence target:

- EVID-016: M5 Agent config/profile parity proof after revised prototype acceptance and M1-M4.

Pre-execution spec:

- `agent-config-source-map.md` maps LobeHub Agent profile/config/settings semantics that M5 must preserve at the contract/projection level.
- `agent-config-profile.md` defines versioned Agent config schema, typed config patch API, Desktop profile/settings restructure, settings modal unification, runtime config builder migration, LobeHub parity UI coverage, compatibility plan, verification matrix and stop conditions for this batch.

### M6 — Memory Projection Parity

| Field | Value |
| --- | --- |
| BOM | BOM-004, BOM-010 |
| Spec | SPEC-004, SPEC-009, SPEC-011 |
| Gate | GATE-006, GATE-008 |
| Owner | Station + Desktop |

Deliverables:

- Reuse Station MemoryService as source-of-truth.
- Add Desktop projection and chat trace for memory injected/used/extracted/promoted/rollback states.
- Surface review/recovery states without moving truth into Desktop Web.

Acceptance:

- Memory trace appears in chat runtime events.
- Memory settings and chat trace agree after refresh/reconnect.
- Station memory tests remain passing for touched services.

Evidence target:

- EVID-017: M6 Memory projection parity proof after revised prototype acceptance and M1-M5.

Pre-execution spec:

- `memory-projection-parity.md` defines Station Memory source-of-truth, Desktop memory runtime projection ownership, chat trace integration, Memory settings/profile surfaces, rollback/recovery/feedback visibility, verification matrix and stop conditions for this batch.

### M7 — Knowledge / Files Parity

| Field | Value |
| --- | --- |
| BOM | BOM-005, BOM-010 |
| Spec | SPEC-006, SPEC-009, SPEC-011 |
| Gate | GATE-006, GATE-008 |
| Owner | Station + Desktop Rust + Desktop |

Deliverables:

- Durable knowledge asset/index status contract.
- File/folder/url/literal/workspace resource states.
- Desktop Rust local file handles stay opaque to Desktop Web and are authorized before use.
- Retrieval diagnostics and recovery states appear in the resources panel and turn trace.

Acceptance:

- Knowledge resource lifecycle includes authorized/indexing/indexed/error/retry states.
- Local file refs never become raw Web-owned paths as cross-end truth.
- Station tests and Desktop checks pass for touched surfaces.

Evidence target:

- EVID-018: M7 Knowledge/files parity proof after revised prototype acceptance and M1-M6.

Pre-execution spec:

- `tool-knowledge-source-map.md` maps LobeHub resource/knowledge/file semantics that M7 must preserve at the contract/projection level.
- `knowledge-files-parity.md` defines durable resource lifecycle, Station-owned index/retrieval diagnostics, Desktop Rust local handle boundary, Agent resource rail behavior, chat trace integration, recovery/reconcile states, verification matrix and stop conditions for this batch.

### M8 — Tool / Plugin / Skill Parity

| Field | Value |
| --- | --- |
| BOM | BOM-005, BOM-010 |
| Spec | SPEC-007, SPEC-009, SPEC-011 |
| Gate | GATE-006, GATE-008 |
| Owner | Station + Desktop Rust + Desktop |

Deliverables:

- Unified manifest/policy/compatibility/approval/result/audit contract.
- Tool enablement and per-Agent binding.
- Desktop Rust executes device-local tools/MCP only through audited requests.
- Desktop Web renders call progress, approval, result, error and retry states.

Acceptance:

- Approval request cannot be bypassed by direct Web execution.
- Tool result is linked to turn trace.
- MCP timeout/error recovery is visible and recoverable.

Evidence target:

- EVID-019: M8 Tool/plugin/skill parity proof after revised prototype acceptance and M1-M7.

Pre-execution spec:

- `tool-knowledge-source-map.md` maps LobeHub tool/plugin/skill/MCP semantics that M8 must preserve at the manifest/policy/runtime boundary.
- `tool-plugin-skill-parity.md` defines unified manifest/policy/compatibility contracts, Agent-level binding, approval/audit semantics, Desktop Rust local execution boundary, chat rendering/recovery states, verification matrix and stop conditions for this batch.

### M9 — Error Recovery, Diagnostics And Parity Hardening

| Field | Value |
| --- | --- |
| BOM | BOM-007, BOM-011, BOM-015 |
| Spec | SPEC-002, SPEC-009, SPEC-013 |
| Gate | GATE-008 |
| Owner | Desktop + Station |

Deliverables:

- Provider errors, tool errors, knowledge errors, memory errors and stream aborts have user-actionable recovery paths.
- Turn trace and Desktop diagnostics can explain what failed and which owner can recover it.
- Regression matrix covers normal, loading, empty, error, reconnect and duplicate provider/model cases.

Acceptance:

- `pnpm --dir apps/desktop run check` passes.
- Targeted Rust and Go tests pass for touched paths.
- Manual acceptance record proves LobeHub parity-critical flows.

Evidence target:

- EVID-020: M9 recovery and parity hardening proof after revised prototype acceptance and M1-M8.

Pre-execution spec:

- `chat-runtime-source-map.md` maps LobeHub parked/terminal, gateway/client and tool resume behavior that M9 must preserve as recovery semantics.
- `error-recovery-diagnostics.md` defines recoverable failure taxonomy, action lineage, trace/diagnostics export, redaction rules, UI recovery states, regression matrix and stop conditions for this batch.

### M10 — Actor#Agent Reserved Contract Alignment

| Field | Value |
| --- | --- |
| BOM | BOM-014 |
| Spec | SPEC-012 |
| Gate | GATE-007, GATE-008 |
| Owner | Station + Model |

Deliverables:

- Reserved fields do not implement social product behavior.
- Agent visibility/capability/event contracts are compatible with future Actor#agent.
- Station ownership/authorization rules prevent accidental social exposure.

Acceptance:

- Design contract remains explicit in Model/Station-compatible form.
- No UI exposes social Agent features in this round.
- Product migration does not create hidden coupling that blocks future Actor#agent work.

Evidence target:

- EVID-021: M10 Actor#agent reserved alignment proof after revised prototype acceptance and M1-M9.

Pre-execution spec:

- `actor-agent-reserved-contract.md` defines reserved Actor identity to Agent identity binding, visibility/authorization/capability exposure placeholders, event subscription boundary, no-social-product constraints and verification matrix for this batch.

## 7. Batch Gate Template

Every product migration batch must append this to `tmp/agent-lobehub-fullstack-ledger.md` before claiming completion:

| Field | Required Content |
| --- | --- |
| Evidence ID | Unique `EVID-011-*` or successor |
| BOM ID | Capability BOM covered |
| Spec ID | Requirement(s) covered |
| Plan Step | PLAN-P4 for planning, PLAN-P5 for implementation |
| Gate ID | GATE-005/GATE-006/GATE-007/GATE-008 as applicable |
| Source Path | LobeHub source and Peers current source used |
| Target Path | Product paths changed |
| LobeHub Use | `source-path reference only`, or explicit license review evidence for direct code/asset/text reuse |
| Commands | Exact deterministic checks run |
| Result | Pass/fail and observed behavior |
| Risk | Remaining unproven scope |

## 8. Required Verification Matrix

| Touched Area | Required Checks |
| --- | --- |
| Desktop Web only | `pnpm --dir apps/desktop run check` |
| Desktop Rust / Tauri | targeted `cargo test` or `cargo check` in `apps/desktop/src-tauri` |
| Station Go | targeted `go test` under `apps/station/...` |
| Model proto | repo proto/codegen command used by current project docs |
| Prototype | `make run-prototype` and browser Live Preview evidence |
| Cross-runtime stream | browser/manual acceptance plus Rust/Station targeted tests |

## 9. Stop Conditions

Stop and do not continue to the next batch if any of these occur:

1. Prototype is not confirmed but product code migration is requested.
2. A batch needs Desktop Web to own Station business truth.
3. Provider/model identity would fall back to `modelId` only.
4. A local tool, MCP, CLI, file or clipboard action would execute directly in Desktop Web.
5. A cross-layer contract is added manually instead of proto/domain-first where Model should own it.
6. Product code tests fail and the failure is within the touched scope.
7. Evidence cannot prove the Gate claimed by the batch.

## 10. Current Status

| Plan Step | Status | Reason |
| --- | --- | --- |
| PLAN-P0 Source Audit | implemented for design | BOM-001 frontend source map and the provider/session/config/runtime/tool/source maps are complete for design; product implementation evidence remains in PLAN-P5. |
| PLAN-P1 Capability BOM | implemented | Full capability matrix exists. |
| PLAN-P2 Prototype | verified for pending-review | `agent-lobehub-parity` reached `pending-review` in EVID-010-PROTOTYPE-REBUILD-N. Product migration still requires Owner confirmation to `confirmed`. |
| PLAN-P3 Fullstack Architecture | implemented | Source-of-truth and forbidden relationships are documented. |
| PLAN-P4 Migration Plan | implemented by this document, `pre-implementation-readiness.md` and `plan-p5-entry-gate.md` | Product migration batches, gates, evidence targets, readiness audit, Owner review controls and EVID-012 entry criteria are defined and refreshed through EVID-011-AB-pre. |
| PLAN-P5 Implementation | not-started | Blocked until `agent-lobehub-parity` Owner confirmation and batch-specific evidence; `plan-p5-implementation-control-board.md` defines execution state control for EVID-012..EVID-021. |
