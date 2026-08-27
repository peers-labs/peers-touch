# Modern Chat Agent V2 — Formal Execution Plan

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-17 | **Updated**: 2026-08-25
> **Owner**: Peers-Touch Agent Team
> **Plan gate**: `OWNER_APPROVED_EXECUTION`
> **Entry gate**: Owner accepted MCA-D19A/D19B/D19C into the main Goal G1 task on 2026-08-22

---

## 1. Accepted Inputs

Product:

- `docs/architecture/agent/modern-chat-agent/product-definition.md`
- `docs/architecture/agent/modern-chat-agent/benchmark-disposition.md`
- `docs/architecture/agent/modern-chat-agent/experience-contract.md`
- `docs/architecture/agent/modern-chat-agent/product-state-model.md`
- `docs/architecture/agent/modern-chat-agent/acceptance-matrix.md`
- confirmed prototype under `packages/prototypes/desktop/features/modern-chat-agent/`

All listed Product contracts are `accepted`. Owner prototype confirmation and
the independent PRODUCT review passed on 2026-08-17.

Architecture:

- `docs/architecture/agent/modern-chat-agent/design.md`
- `docs/architecture/agent/modern-chat-agent/decisions.md` D01-D19D
- `docs/architecture/agent/modern-chat-agent/data-model.md`
- `docs/architecture/agent/modern-chat-agent/module-layout.md`
- `docs/architecture/agent/modern-chat-agent/integration.md` C01-C15 / A01-A20

Reference evidence:

- `docs/architecture/agent/modern-chat-agent/lobehub-v2-reference-analysis.md`

Reviewed runtime matrix:

- `docs/architecture/agent/execution-plans/20260817-modern-chat-agent-v2-runtime-matrix.yaml`
- ID `modern-chat-agent-v2-runtime-matrix`
- version `2026-08-25.1`
- SHA-256 `ec5d0cafc4a88b47e9026d35d44c8f17a2a12ec7e4c204eb9b8f6ec099e3ae89`

## 2. Scope And Non-Scope

Required:

- MCA-V2-H01 Home Command Center.
- MCA-V2-T01-T04 unified manifest/binding/readiness and governed Tool loop.
- MCA-V2-M01 MCP lifecycle.
- MCA-V2-C01 Connector resource-to-tool invocation.
- MCA-V2-O01 failure/recovery/diagnostics.
- MCA-V2-E01 Evaluation Lab.
- Retirement of the rejected independent Custom HTTP Plugin product, including
  its local credential/direct-fetch path and Station CRUD/persistence surface.
- Desktop full delivery, Browser Station-backed outcome compatibility, Mobile
  contract compatibility without Mobile UI.
- Native receiver DOM, Station readback, actor/device isolation, replay,
  cleanup, and source-bound external Evidence Store output.

Non-scope:

- Image generation.
- Video and server-side audio generation.
- Mobile UI.
- Commercial Community/marketplace/subscription behavior.
- Any successor independent Custom HTTP Plugin product; retirement of the
  current rejected path is required scope.
- Multi-Agent Canvas/Collaboration changes.
- Version bumps.

P12 external Agent runtime follows the accepted D12
`MODERN_CHAT_AGENT_V1` optional-advertised profile. The frozen V2 scope does
not advertise or implement it. G-F proves absence from Station provider/model/
readiness projections and Desktop/Browser selectors. Advertising P12 requires
an explicit PRODUCT, DESIGN, and PLAN amendment; this plan defines no candidate
certification, promotion authority, or hidden runtime ingress.

The registered stateless CLI adapter under `DIRECT_MODEL` is also
optional-advertised under D12/D05. The frozen V2 scope leaves the
catalog-disabled `trae-cli` unadvertised. Code registration alone is
insufficient; G-F proves provider/model/readiness and Desktop/Browser selector
absence. Advertising it requires an explicit PRODUCT, DESIGN, and PLAN
amendment; this plan defines no certification-owned promotion path.

## 3. Current-State Impact Inventory

| Responsibility | Current assets | Target closure |
|---|---|---|
| Agent binding | Station knowledge/skill/MCP binding tables; Agent `config_json`; Desktop source-specific stores | One versioned manifest/binding/readiness authority |
| Tool loop | Station ToolRegistry/TurnService; Desktop approval registry/local execution | Fenced unique decision/claim/receipt/result |
| MCP | Desktop Rust MCP store, CRUD/test/execute and local process ownership | Station operation lifecycle + client executor/cleanup |
| Connector | OAuth subsystem; Desktop mount/sync `enabledTools` | Scoped Connector resource manifests and governed ToolCall |
| Home | `HomePage` derives Agents/topics; Tasks are Station-backed | Revisioned Home projection + `homeRuntime` + canonical Chat/Task commands |
| Evaluation | Station dataset CRUD; Desktop localStorage run/result + `quickCompletion` | Station benchmark/case/run/attempt/result/metrics aggregate |
| Rejected Custom HTTP Plugin | Desktop page/store/localStorage credential/direct `fetch`; Station ecosystem proto/CRUD/table | No independent product or runtime path; securely purge credentials/data and delete all page/proto/route/persistence symbols |
| Acceptance | Historical Agent gates and prototype evidence | Six V2 Native/Station Gates with external Evidence Store |

Implementation must re-run repository inventory before each cutover; counts in
this plan are not completion evidence.

### 3.1 Repository-Backed Consumer And Authority Inventory

This is the minimum cutover inventory. W0 re-runs the searches and records the
complete source-bound inventory before implementation. F1-F4 own C01-C10
cutovers; W8 owns the C11-C15 activation/deletion cutover.

| Concern | Current authority/consumer paths | Required disposition |
|---|---|---|
| Core Agent/config/conversation | `apps/station/app/subserver/agent/{domain,service,handler,infrastructure/persistence}/agent_config*`; `service/conversation_service.go`; `service/turn_service.go`; `apps/desktop/src/runtimes/agentTopicRuntime.ts`; `apps/desktop/src/services/chat-service.ts`; `apps/desktop/src/store/{agentTopics,agentSearch,chat}.ts`; `apps/desktop/src-tauri/src/application/chat/mod.rs` in-memory `ChatStore` | F1 moves config/conversation/message truth to Station and deletes `ChatStore`/local durable ownership |
| Runtime/stream/recovery | `apps/station/app/subserver/agent/service/turn_service.go`; Desktop `agentCapabilityRuntime.ts`; `apps/desktop/src-tauri/src/application/agent_turn/mod.rs`; `apps/desktop/src/services/desktop_api.ts#streamAgentTurn` browser `executeAgentTurnOnce` fallback | F2 makes App/Browser consume sequenced Station streaming/replay and deletes one-shot/local execution authority |
| Context/resources | Station context/memory/skill/knowledge services and message persistence; `apps/desktop/src/store/chat.ts`; attachment/composer surfaces; `apps/desktop/src-tauri/src/contracts.rs` portable payloads | F3 adds typed ContextLedger and opaque authorized resource refs; deletes untyped/local-path authority |
| Usage/feedback/diagnostics | Station TurnTrace/user-feedback/diagnostic persistence and services; `apps/desktop/src/diagnostics/agentTurnDiagnostics.ts`; Agent details/feedback surfaces | F4 makes exact-turn usage/feedback/redacted replay durable; screenshot-only evidence is retired |
| Agent config/bindings | `apps/station/app/subserver/agent/domain/agent_config_service.go`; `apps/desktop/src/services/desktop_api.ts`; `apps/desktop/src/pages/AgentProfilePage.tsx`; `apps/desktop/src/store/agent.ts#updateAgentConfig/getCurrentAgentChatConfig`; `apps/desktop/src/store/agentConnectors.ts`; `AgentSidebar.tsx` and diagnostics readers of embedded `chatConfig` | Backfill manifests/bindings while disabled; W8 switches all reads/writes and retires embedded `chatConfig` Skill/Knowledge/MCP/Tool/Connector binding arrays and parallel readers |
| Home | `apps/desktop/src/pages/HomePage.tsx`; `apps/desktop/src/pages/HomePageContainer.tsx`; `apps/desktop/src/pages/HomePage.descriptor.tsx` | W8 replaces page-derived work state with `homeRuntime` projection |
| Tool approval/execution | `ToolCallCard.tsx` -> `store/chat.ts#decideToolApproval` -> Desktop API/Tauri command -> Rust `tool_approval_registry`; `ToolDetailView.tsx` is a read-only inspector, not a decision submitter; event flow uses handwritten `streaming/types.ts`/`index.ts`, mixed reducer `streaming/handler.ts` with intervention side effects, `chat.ts`, AgentProfile activity projection, and Rust approval input; `turn_stream.proto` lacks typed proposal/decision payloads; live inventory uses read-only `store/tool.ts`, while unimported `store/tool/index.ts#pendingCalls` is dead code | G1-A adds the MCA-D19 typed decision/envelope/receipt contract; G1-B/C establish Station authority and fenced Rust execution; G1-D makes `toolRuntime` the sole Web projection and decision-intent owner; G1-E deletes every legacy Web/Rust/Station execution authority and unfenced continuation before G-F |
| MCP | `apps/desktop/src/store/mcp.ts`; `apps/desktop/src/services/mcp-service.ts`; `apps/desktop/src/modules/mcp.ts`; `apps/desktop/src-tauri/src/application/mcp/`; `apps/desktop/src-tauri/src/interface/tauri_commands/mcp.rs` | Retain local process/config/secret executor only; replace client terminal lifecycle truth |
| Connector | `apps/desktop/src/store/agentConnectors.ts`; `apps/desktop/src/components/agent/AgentConnectorsPanel.tsx`; OAuth services under Station | Retain OAuth owner; replace `enabledTools`/labels as portable readiness or binding identity |
| Evaluation | `apps/desktop/src/store/evaluation.ts`; `apps/desktop/src/pages/EvaluationPage.tsx`; `apps/desktop/src/services/desktop_api.ts`; Station ecosystem dataset persistence/service | Backfill dataset truth; W8 removes localStorage run/result and `quickCompletion` execution |
| Rejected Custom HTTP Plugin | Desktop `CustomPluginsPage*`, `pages/registry.ts`, `hooks/useCommandMenuItems.ts`, `types/navigation.ts`, `store/customPlugins.ts`, locale keys and `peers-ai-custom-plugins`; `model/domain/agent/ecosystem.proto#CustomPlugin*` and generated clients; Station `agent.go` plugin routes, ecosystem handlers/service/model registration/persistence/table `ecosystem_custom_plugins` | W8 freezes and deletes the independent page, direct arbitrary HTTP execution, local credential storage, proto/CRUD/generated contracts, and persistence/table; no automatic import into Tool/MCP/Connector because no accepted successor mapping exists |
| Acceptance | `tooling/acceptance/domains/agent.yaml`; `tooling/acceptance/capabilities/agent.yaml`; `tooling/acceptance/features/agent-*.yaml`; `tooling/acceptance/gates.yaml`; `tooling/acceptance/registry.yaml` | W0 registers one foundation plus six V2 Gates; all remain `UNPROVEN` until executed |

### 3.2 C01-C10 Foundation Closures

Current HEAD contains foundations, not completed closures. Historical reports
or ancestor commits are diagnostic only. The formal DAG implements and deletes
the remaining paths before V2 workstreams may depend on them.

| Closure | Owning workstream | Required implementation | Deletion obligation | Final evidence |
|---|---|---|---|---|
| C01 Agent/config truth | F1 | versioned Station Agent/model config and readiness readback | local durable Agent/config truth | A01/A04/A13 |
| C02 Conversation/message truth | F1 | Station CRUD, queue, immutable lineage/branches, idempotent first turn | Desktop Rust `ChatStore` and local durable topic/message truth | A02-A04/A09-A10 |
| C03 Runtime execution | F2 | Station Direct Model runtime resolution plus frozen-profile P12/CLI non-advertisement | Desktop AI CLI/provider execution authority | A02/A11/A13 |
| C04 Context intelligence | F3 | typed deterministic ContextLedger with attribution/token budget | untyped prompt-only attribution | A03/A05-A06 |
| C05 Stream/recovery | F2 | sequenced persisted events, SSE cursor/replay/snapshot, bounded queue | Browser `executeAgentTurnOnce` chat fallback and ephemeral-only projection | A02/A09 |
| C06 Model capability | F2 | fresh capability snapshot, pre-admission degradation/reject, budgets | client/provider-name inference | A08/A11 |
| C07 Tool/MCP policy | F4 | portable client capability session, approval/policy/loop budget, durable audit | Desktop-specific tool contract and duplicate approval authority | A07/A09/A13-A14 |
| C08 Attachments/resources | F3 | opaque refs, upload/extraction/auth/model gate/provenance | metadata-only/local-path payload authority | A08/A13-A14 |
| C09 Usage/feedback/diagnostics | F4 | immutable usage, feedback, redacted diagnostic replay | screenshot-only or client-only outcome claims | A12 |
| C10 Client portability | F2 | shared client capability session and App/Browser/Mobile semantic adapters | `desktop-rust` in shared contract semantics | A11/A13-A14 |

## 4. Architecture Trace

| Closure | Product | Architecture | Decision | Gate |
|---|---|---|---|---|
| Agent/conversation authority | MCA-P01/P02/P07/P08 / J01-J03/J07-J08 | C01/C02 / A01-A04/A09-A10/A13 | D01/D06/D08/D12 | `agent-v2-kernel-foundation-e2e` cells C01/C02 |
| Runtime/stream/capability/portability | MCA-P03/P09/P11 / J01/J03/J07 | C03/C05/C06/C10 / A02/A09/A11/A13-A14 | D02/D03/D05-D07/D09/D13 | foundation cells C03/C05/C06/C10 |
| Context/resources | MCA-P04/P06 / J04/J06 | C04/C08 / A03/A05-A06/A08/A13-A14 | D04/D05/D13 | foundation cells C04/C08 |
| Tool policy/observability baseline | MCA-P05/P10 / J05/J09 | C07/C09 / A07/A09/A12-A14 | D09/D10/D13/D19 | foundation cells C07/C09 |
| Downstream orchestration boundary | MCA-P15 deferred | C01-C15 single-Agent readiness | D11 | F1 guards current Canvas Web/Station run paths; guards remain after W9 until a separate accepted canonical-kernel migration |
| Home | MCA-V2-H01 / V2-J01 | C11 / A15 | D14 | `agent-v2-home-command-center-e2e` |
| Capability authority | MCA-V2-T01-T03 / V2-J02 | C12 / A16 | D15 | `agent-v2-capability-binding-e2e` |
| Governed Tool loop | MCA-V2-T04/O01 / V2-J03 | C12/C13 / A19 | D15/D16 | `agent-v2-governed-tool-loop-e2e` |
| MCP | MCA-V2-M01/O01 / V2-J04 | C13 / A17 | D16 | `agent-v2-mcp-lifecycle-e2e` |
| Connector | MCA-V2-C01/O01 / V2-J05 | C14 / A18 | D17 | `agent-v2-connector-invocation-e2e` |
| Evaluation | MCA-V2-E01 / V2-J06 | C15 / A20 | D18 | `agent-v2-evaluation-lab-e2e` |

## 5. Dependency DAG

```text
W0 Contract, Evidence, And Gate Foundation
  -> F1 Agent And Conversation Authority
       -> F2 Runtime, Stream, Capability, And Portability
            -> F3 Context And Resource Intelligence
            -> F4 Tool Policy And Observability Baseline

F2 + F3 + F4
  -> G-F Foundation Native Gate (C01-C10)
       -> W1 Capability Authority
       -> W2 Home Projection
       -> W3 Capability Operation Substrate
            -> W4a MCP Operation Lifecycle
            -> W5a Connector Resource Manifest
            -> W6 Governed ToolCall Fencing
                 -> W7 Evaluation Aggregate

W4a + W6 -> W4b MCP Invocation Closure
W5a + W6 -> W5b Connector Invocation Closure

W2 + W4b + W5b + W6 + W7
  -> W8 Desktop/Browser Consumer Cutover
       -> W9 Native Acceptance, Deletion, Cleanup, Final Audit
```

Parallel policy:

- F3 and F4 may proceed in parallel after F2; both consume the F1 Station
  conversation/turn identity.
- Inside F4/G1, production authority changes are serial:
  `G1-A contract -> G1-B Station -> G1-C Rust -> G1-D Web -> G1-E cutover
  deletion -> G1-F observability`. Acceptance contract/fixture work may proceed
  in parallel after G1-A, but it cannot modify production owners or publish
  `PROVEN`.
- W2 and W3 may proceed in parallel after W1 contracts are stable.
- W4a lifecycle implementation, W5a resource-manifest implementation, and W6
  ToolCall fencing may proceed in parallel after W3 and W1 pass.
- W4 and W5 cannot close their invocation deliverables or Gates until W6 passes;
  W4b and W5b are explicit join milestones, not independent workstreams.
- W7 starts only after W6 canonical Turn/ToolCall fencing is available.
- W8 performs one source-of-truth activation after all predecessor closures
  pass. Earlier work may compile behind unreferenced adapters but cannot
  dual-write, serve production reads, or claim cutover.

### 5.1 End-To-End Lifecycle Mapping

| Lifecycle | Ordered workstream ownership | Closure condition |
|---|---|---|
| Startup/bootstrap | W0 contracts/evidence -> F1/F2 canonical kernel -> F3/F4 capabilities -> W1 authority -> W2/W3 -> W8 activation | generated contracts load; C01-C10 close before V2 consumers; no dual authority |
| Authentication/account/Station switch | F1 actor/config authority -> F2 client session -> W1 binding -> W2 projection clearing -> W8 consumers -> W9 isolation | prior actor/device projection is absent before ready; cross-scope mutation/read rejects |
| Conversation/first turn | F1 Station topic/message identity -> F2 runtime/SSE -> F3/F4 context/tool facts -> W8 consumer activation -> W9 | accepted topic/messages/turn survive restart; Desktop `ChatStore` and Browser one-shot path are deleted |
| Home Chat/Task write | F1/F2 kernel -> W2 canonical commands -> W6 ToolCall when required -> W8 UI -> W9 Gate | one accepted topic/Turn or Task/run under duplicate delivery; draft survives reject |
| Capability bind/readiness | W1 manifest/binding/snapshot -> W8 Agent Profile/Home consumers -> W9 Gate | one versioned binding/readiness source; incompatible/stale input rejects before execution |
| MCP lifecycle/invoke | W3 operation -> W4a lifecycle -> W6 ToolCall -> W4b invocation -> W8 UI -> W9 Gate | authoritative operation and one ToolCall result; cleanup terminal and leak-free |
| Connector lifecycle/invoke | W1 binding + W3 operation -> W5a resource manifest -> W6 ToolCall -> W5b invocation -> W8 UI -> W9 Gate | pinned OAuth/resource revision, one result/trace, bounded revoke recovery |
| Streaming/server push/replay | F1 C02 identity -> F2 C05 event/cursor/replay -> W3 outbox -> W6 continuation -> W8 projection -> W9 replay | ordered idempotent projection and one terminal state after reconnect/restart |
| Cancellation/timeout | W3 fences/cleanup -> W4/W6 operation/tool cases -> W7 Evaluation CAS -> W9 races | first durable fence wins; cleanup is terminal; no indefinite cancelling/reconnecting |
| Disconnect/restart/recovery | W2 Home revision -> W3/W4 executor reconciliation -> W5 OAuth revision -> W7 Evaluation restore -> W9 | Station readback reconstructs accepted work; client never infers terminal success |
| Overload/user spam/duplicate delivery | F1/F2 queue/admission -> W1 readiness -> W2 idempotency -> W3/W6 claims/fences -> W7 scheduler uniqueness | bounded queue/admission and original IDs; no duplicate provider/tool side effect |
| Deletion/revocation/retention | W1 retirement -> W5/W6 dispatch fence -> W7 retention -> W8 atomic cutover -> W9 races/search | no new admission; in-flight work settles; historical snapshots/tombstones obey `data-model.md §6` |
| Shutdown/cleanup | W3 cleanup lease -> W4 process/port/secret cleanup -> W6 receipts -> W8 drain -> W9 leak audit | all resources terminal or typed `cleanup_failed`; no process/port/secret/debug residue |

### 5.2 Workstream Status

| Workstream | Status | Entry condition |
|---|---|---|
| W0 Contract/Evidence/Gates | complete | Owner EXECUTE approval received; W0 verification and completion audit PASS |
| F1 Agent/Conversation Authority | complete | W0 complete |
| F2 Runtime/Stream/Capability/Portability | complete | F1 |
| F3 Context/Resource Intelligence | core complete / C08 unproven | F2 |
| F4 Tool Policy/Observability | G1-A through G1-F complete; G1-XR producer/provisioning closure active; Native proof unproven | F2 + accepted D19A/D19B/D19C |
| W1 Capability Authority | pending | G-F foundation Gate `PROVEN` |
| W2 Home Projection | pending | W1 |
| W3 Capability Operation Substrate | pending | W1 |
| W4 MCP Lifecycle | pending | W3 + W6 invocation join |
| W5 Connector Resource Tools | pending | W1 + W3 + W6 invocation join |
| W6 Governed ToolCall Fencing | pending | W1 + W3 |
| W7 Evaluation Aggregate | pending | W1 + W6 |
| W8 Consumer Cutover | pending | W2 + W4b + W5b + W6 + W7 |
| W9 Native Acceptance/Final Audit | pending | W8 |

## 6. Responsibility Workstreams

Every Gate command below requires a writable, source-tree-external
`PT_ACCEPTANCE_ARTIFACT_ROOT`. The canonical runner command is:

```bash
test -n "${PT_ACCEPTANCE_ARTIFACT_ROOT:-}"
python3 tooling/scripts/acceptance-run.py --gate <gate-id>
```

The expected artifact is
`<acceptance-artifact-root>/<workspace-id>/<gate-id>/<run-id>/manifest.json`,
with child artifacts for receiver DOM, Station readback,
runtime/side-effect facts, cleanup, replay, and source identity. Missing or
unwritable output aborts the Gate; it never falls back to
`tooling/acceptance/reports/`.

`source-identity` must equal the current runner's
`source_identity(<repo-root>)` tuple field-for-field:
`commit`, `workspaceDigest`, and `canonicalWorktreeHash`. The run also binds
Gate/run IDs and the exact `ConversationRuntimeBinding` tuple:
`runtime_kind`, `provider_id`, `model_id`, `runtime_profile_id`,
`external_session_id`, `external_session_epoch`, SHA-256 of the private
`runtime_home_ref`, `capability_snapshot_hash`, `config_snapshot_hash`, and
`bound_at`. It also binds the exact `RuntimeSnapshot` message:
`runtime_kind`, `provider_id`, `model_id`, `runtime_profile_id`,
the complete nested `capabilities` snapshot (input/output/runtime/agentic/
limits/resolution/provenance fields in canonical serialization),
`provider_config_version`, `agent_config_version`, `external_session_id`,
and `external_session_epoch`. Separate attestation fields bind the
`TurnAttempt.capability_readiness_snapshot_id`, ToolCall capability/version/
binding/revision/readiness IDs, selected client session/device/lease, Station
profile/identity, Desktop mode, network path, machine, and cold/warm state. Raw
runtime-home identity is never emitted.
Any stale commit, dirty-workspace digest mismatch, foreign worktree hash, or
runtime/config/binding identity mismatch is `failed/UNPROVEN`.

Runtime identity is per evidence cell, not global. Every sample emits one
immutable runtime attestation keyed by
`(gate_id, row_id, scenario_id, cell_id, locale, ordering, sample_id, platform,
runtime_kind)` and
containing the exact binding/snapshot fields above. Each Gate's
`runtime-attestation-set` enumerates the declared platform/runtime/sample matrix
and rejects missing, duplicate, or unexpected cells. The seven-Gate proof set
requires one globally identical source-identity tuple but permits different
runtime identities exactly where the declared matrices differ.

The reviewed matrix above is an immutable PLAN input, not a W0 output. W0 may
materialize it under `tooling/acceptance/matrices/` byte-for-byte only. Every
candidate manifest, proof envelope, and final seven-Gate proof set pins its
ID/version/SHA-256. Any scope or hash change returns to PLAN review.

| Gate | Candidate-manifest mandatory roles before validation |
|---|---|
| `agent-v2-kernel-foundation-e2e` | `cell-results`, `receiver-dom`, `station-readback`, `runtime-events`, `runtime-attestation-set`, `measurement-report`, `side-effect-count`, `replay`, `cleanup`, `source-identity`, `role-schema-report`, `runner-attestation` |
| `agent-v2-home-command-center-e2e` | `receiver-dom`, `station-readback`, `command-ids`, `projection-revisions`, `runtime-attestation-set`, `measurement-report`, `side-effect-count`, `replay`, `cleanup`, `source-identity`, `role-schema-report`, `runner-attestation` |
| `agent-v2-capability-binding-e2e` | `receiver-dom`, `station-readback`, `readiness-snapshots`, `zero-execution`, `runtime-attestation-set`, `measurement-report`, `side-effect-count`, `replay`, `cleanup`, `source-identity`, `role-schema-report`, `runner-attestation` |
| `agent-v2-governed-tool-loop-e2e` | `receiver-dom`, `station-readback`, `executor-receipts`, `runtime-attestation-set`, `measurement-report`, `side-effect-count`, `cleanup`, `replay`, `source-identity`, `role-schema-report`, `runner-attestation` |
| `agent-v2-mcp-lifecycle-e2e` | `receiver-dom`, `station-readback`, `executor-receipts`, `process-port-secret-canary`, `runtime-attestation-set`, `measurement-report`, `side-effect-count`, `cleanup`, `replay`, `source-identity`, `role-schema-report`, `runner-attestation` |
| `agent-v2-connector-invocation-e2e` | `receiver-dom`, `station-readback`, `oauth-resource-manifest`, `provider-revoke`, `runtime-attestation-set`, `measurement-report`, `side-effect-count`, `cleanup`, `replay`, `source-identity`, `role-schema-report`, `runner-attestation` |
| `agent-v2-evaluation-lab-e2e` | `receiver-dom`, `station-readback`, `turn-trace`, `metrics-lineage`, `runtime-attestation-set`, `measurement-report`, `side-effect-count`, `cleanup`, `replay`, `source-identity`, `role-schema-report`, `runner-attestation` |

Immutable runtime-matrix summary:

- Exact expanded tuple count: `742`.
- Per Gate: foundation `419`, Home `33`, binding `69`, ToolCall `86`, MCP `41`,
  Connector `37`, Evaluation `57`.

| Gate | Required platform/runtime rows | Required scenario/cell scope |
|---|---|---|
| Foundation | Desktop App + Direct; Browser + Direct; Mobile P01-P11 contract cells; CLI/P12 non-advertisement; Station/Web/Rust D11 | AS-F01-F13, AS-D11, A01-A14, TAX-01-06, required foundation errors, §8.3 workloads |
| Home | Desktop App + Direct; Browser + Direct; Mobile semantic contract | AS-01/02/13, R-11 both orders, ERR-H01-H03, AS-15-V2-H01, English/Chinese DOM |
| Capability binding | Desktop App + Direct/local session; Browser + Direct/remote session; Mobile semantic contract; Desktop/Station rejected-plugin retirement | AS-03/10, AS-15-V2-T01-T03, AS-16-CUSTOM-PLUGIN-RETIREMENT, TAX-01-06, ERR-CAT01-CAT03, ERR-B01-B03 |
| Governed ToolCall | Desktop App + Direct/local executor; Browser + Direct/Station executor; Mobile semantic contract | AS-05A/05, CR-00/01/02/03/04N/04I/05/06, R-03/R-05/R-07 both orders, ERR-O01-O08, REPLAY-O07I, AS-15-V2-T04/O01 |
| MCP | Desktop App + local MCP; Browser unavailable/degraded; Mobile unavailable semantic contract | AS-04, AS-04-UNAVAILABLE, AS-15-V2-M01, R-01-R-04 both orders, ERR-O01-O08, process/port/secret cleanup |
| Connector | Desktop App + Direct; Browser + Direct; Mobile semantic contract | AS-06, R-06/R-07 both orders, ERR-CON01-CON04, AS-15-V2-C01, provider revoke outcomes |
| Evaluation | Desktop App + Direct; Browser + Direct; Mobile semantic contract | AS-07/08/14, R-08-R-10 both orders, ERR-E01-E05, AS-15-V2-E01, restart/metrics/lineage |

For every non-quantitative row, the matrix requires one fresh fixture per
platform/runtime/cell and both locales where receiver copy exists. Every race
requires both orderings. Stream cells require 15 cold + 15 warm samples per
App/Browser/runtime row; cancellation requires 20 samples at each text/tool/
approval boundary for the required Direct runtime; replay requires 20
disconnect sequences per App/Browser/runtime row. CLI and P12 each require one
non-advertisement API+selector cell on Desktop and Browser. Validator
comparison is against this source-bound matrix hash, never a matrix emitted by
Gate code.

Each artifact role has a versioned schema that validates non-empty semantic
content, media type, Gate/run/source identity, scenario/cell ID, timestamps,
oracle fields, and minimum sample count. Presence alone never passes. W0
negative tests cover missing, empty, malformed, wrong-role, wrong-schema,
wrong-hash, stale-source, and duplicate-role artifacts.

Proof production is two-stage. `acceptance-run.py` writes immutable artifacts,
candidate manifest, and `runner-attestation`, then publishes only `CANDIDATE`;
it cannot write validator output or `PROVEN`. It emits the candidate's full
`ArtifactRef` and manifest SHA-256 to an explicit handoff file. A separate
`acceptance-validate.py` process must receive both
`--candidate-ref-file` and `--candidate-manifest-sha256`; it never resolves
`latest`. It reopens that immutable candidate, validates every role/schema/
oracle/source/runtime identity, and creates a separate validation run.

The validator writes immutable `validator-attestation` and a final
`proof-envelope` containing the full candidate ArtifactRef/hash, runner
attestation ArtifactRef/hash, validator run/attestation ArtifactRef/hash,
source-identity tuple, Gate ID, reviewed runtime-matrix ID/version/hash, and
every role schema ID/version/hash. A CAS
publishes the proof-envelope pointer for that exact candidate. Producer
identity/process/run IDs must differ. Dedicated Agent V2 proof-set validation
trusts only proof envelopes and never a candidate/latest pointer. Generic
Domain `--require-proven` behavior remains unchanged for existing capabilities.

W0 registers Gate contracts. F1-F4 run deterministic component/integration
checks, then G-F executes the foundation product Gate before W1. W1-W7 run
pre-cutover checks only; their six V2 product Gates execute after W8 under W9.
W9 reruns the foundation Gate against the final source snapshot. A pre-cutover
V2 probe cannot mark a capability `PROVEN` or satisfy a dependency.

### W0 — Contract, Evidence, And Gate Foundation

**Owns**: proto-first C01-C15 contracts, repository inventory, cross-platform
generation coverage, fail-closed Gate proof semantics, and Acceptance
contracts.

**Target roots**: `model/domain/agent/`, `apps/desktop/src-tauri/build.rs`,
generated Go/Desktop TS/Desktop Rust/Mobile TS model outputs,
`apps/mobile/package.json`, Mobile Agent contract tests,
`tooling/scripts/acceptance-run.py`,
`tooling/scripts/acceptance-validate.py`,
`tooling/scripts/acceptance-prove.py`,
`tooling/scripts/acceptance-proof-set.py`,
`tooling/acceptance/core/evidence_store.py`,
`tooling/acceptance/schemas/agent-v2/`,
`tooling/acceptance/matrices/agent-v2-runtime-matrix.yaml`,
`tooling/scripts/expand-agent-v2-runtime-matrix.py`,
`tooling/acceptance/fixtures/agent_d11_entrypoints.yaml`,
`tooling/scripts/review/agent-d11-entrypoints.py`,
`tooling/scripts/check-agent-v2-locales.mjs`,
`packages/locales/en/agent.json`,
`packages/locales/zh-CN/agent.json`,
`tooling/acceptance/tests/`,
`tooling/acceptance/domains/agent.yaml`,
`tooling/acceptance/capabilities/agent.yaml`,
`tooling/acceptance/features/agent-v2-*.yaml`,
`tooling/acceptance/gates/agent/`, `tooling/acceptance/gates.yaml`, and
`tooling/acceptance/registry.yaml`.

Deliverables:

- Source-bound C01-C15 authority/consumer/deletion inventory.
- Home projection, capability manifest/binding/readiness/operation, Connector
  resource manifest, Evaluation aggregate commands/events/errors in proto.
- `ToolApprovalRequiredPayload` adds `tool_call_id`, `decision_id`,
  `decision_revision`, and `expires_at`. A typed Station
  `SubmitToolApprovalDecisionRequest` carries `approval_id`, `tool_call_id`,
  `decision_id`, `expected_revision`, `approved`, and `idempotency_key`.
  Station derives actor identity exclusively from JWT/session context; no
  client actor field is accepted.
- `turn_stream.proto` adds typed `ToolApprovalDecisionPayload` with
  `approval_id`, `tool_call_id`, `decision_id`, `decision_revision`, `approved`,
  `actor_ref`, `decided_at`, and `idempotency_key`; generated adapters and
  exhaustive command/event decoding are required.
- Generated Go/Desktop TS/Desktop Rust/Mobile TS adapters through canonical
  generation only.
- A Rust proto-coverage checker that fails unless every C01-C15 proto consumed
  by Desktop Rust is enumerated in `build.rs` and compiled, including
  `agent.proto`, `agent_config.proto`, `turn_stream.proto`, `home.proto`,
  `capability.proto`, and `evaluation.proto`.
- Mobile adds a real `test:agent-contract` script/test runner and
  `src/contracts/agentV2Contract.test.ts`; it executes encode/decode,
  Station-backed command/event, and unsupported local-capability degradation
  assertions against generated contracts.
- All 28 BASE error keys, 26 ERR keys, and
  `agent.errors.canvasSingleAgentNotReady` (55 error/D11 keys total) are
  non-empty in English and Simplified Chinese. Every non-`none` receiver action
  has a matching `agent.recovery.<actionId>` key in both locales.
  Required action IDs are:
  `editQueue`, `openOriginal`, `reloadLatest`, `switchAccount`,
  `removeResource`, `selectRuntime`, `chooseCompatibleModel`, `confirmReset`,
  `reconnectExecutor`, `reconcile`, `openPermissionSettings`, `reconnect`,
  `chooseResourceAgain`, `configureCredential`, `retryLater`, `chooseModel`,
  `retry`, `reduceContext`, `removeReference`, `removeAttachment`,
  `chooseTool`, `continueWithoutTool`, `requestAgain`, `inspectBudget`,
  `recover`, `openResult`, `retryUnavailableSlice`, `resolveReadiness`,
  `chooseManifest`, `editSchema`, `reloadAndReapply`,
  `selectCompatibleTarget`, `correctPolicy`, `reconcileOrTakeOver`,
  `retryAsNewOperation`, `openManualRecovery`, `openSideEffectReview`,
  `reconnectOAuth`, `reauthorizeScopes`, `chooseResource`,
  `resyncAndRebind`, `reloadDataset`, `reselectTarget`,
  `openTerminalResults`, `openExistingChildOrUseNewKey`, and
  `retryWhenEvaluatorReady`.
  `check-agent-v2-locales.mjs` proves exact key parity, no duplicate/missing
  keys, repairs/blocks pre-existing Agent locale drift, and proves no receiver
  surface hardcodes stable codes as user copy.
- Foundation plus six V2 Gate registry/domain/feature/capability contracts,
  all marked `UNPROVEN`.
- Gate definitions declare mandatory artifact roles and proof status. The
  runner emits immutable `CANDIDATE` evidence only; a separate validator
  process reopens and attests it. Only the validator can publish
  source-matching `proofStatus=PROVEN`; `dry-run` is never proof.
- `acceptance-prove.py --gate <id>` launches runner and validator as separate
  subprocesses, passes an explicit temporary candidate ArtifactRef file and
  manifest SHA-256, rejects any mismatch, and removes the handoff file on every
  exit path.
- `acceptance-proof-set.py` accepts exactly seven explicit proof-envelope
  ArtifactRef files, rejects missing/duplicate Gate IDs or mixed source
  identities, validates each Gate's distinct runtime-attestation matrix, writes
  an immutable proof-set manifest, and emits its ArtifactRef plus SHA-256.
  Dedicated Agent V2 proof-set validation accepts only that pinned ref/hash
  pair.
- Versioned JSON schemas under `tooling/acceptance/schemas/agent-v2/` define
  every role's non-empty semantic payload, identity, oracle, and sample-count
  contract; the manifest pins each schema ID/version/hash.
- The reviewed runtime-matrix file is the sole declared cell matrix. Gate code
  cannot self-declare or narrow it. W0 copies/verifies the exact reviewed bytes;
  the validator requires the pinned ID/version/hash and rejects missing,
  duplicate, or unexpected cells.
- `expand-agent-v2-runtime-matrix.py` implements the reviewed Cartesian rules,
  emits 742 sorted unique tuple keys and the exact per-Gate counts above, and
  rejects unknown sample sets or unresolved/non-boolean `required_if`.
- Race barriers/oracles from `design.md §23.1`.
- A scoped `tooling/scripts/review/agent-v2-old-paths.sh` inventory checker
  that requires an explicit disposition for every legacy-symbol match.
- `tooling/scripts/review/agent-d11-entrypoints.py` compares all Canvas/
  collaboration start,
  recovery, resume, continuation, claim, and Atelier entrypoints against
  `agent_d11_entrypoints.yaml`. W0 runs `--inventory-only`, which validates the
  complete source-backed inventory, routing, dispositions, and current guard
  state without requiring F1-owned guards to exist. Default enforcement, used
  by F1 and W9, proves the guard precedes first mutation or provider call. The
  fixture includes every action alias in Desktop Rust
  `application/applets/mod.rs#handle_atelier`, its exact Station/local target,
  and its guarded/read/non-execution-mutation/cleanup disposition.
- The fixture classifies `official_applets/atelier_gate_server/main.go` as
  tooling/test-only, not production ingress, and fails if it becomes reachable
  from the production subserver.

Failure behavior:

- Unknown enum/version/schema fails typed validation.
- Gate missing receiver DOM, Station readback, runtime evidence, or cleanup
  remains `UNPROVEN`.
- Exit zero without all declared artifact roles is `failed/UNPROVEN`.
- Artifact source identity mismatch, source-tree output, or `dry-run` input
  cannot satisfy Agent V2 proof-set validation.
- Negative tests mutate each source-identity tuple field and each bound runtime
  binding/snapshot field independently, including every nested capability
  category, epoch, config version, readiness snapshot, ToolCall binding,
  client lease, and runtime-home hash; every mutation must fail closed.
- Negative tests prove runner/validator producer and run identities differ,
  runner cannot self-attest, validator cannot rewrite runner artifacts, and a
  candidate without validator attestation remains `UNPROVEN`.
- Negative tests race two candidates and mutate the handoff ref/hash; validator
  must attest only the explicit candidate or fail, never follow `latest`.
- Proof-set negative tests substitute one envelope, mix source identities, omit
  a Gate, duplicate a Gate, and mutate the set ref/hash; all fail closed.
- D11 checker negative fixtures add an unregistered entrypoint and move a guard
  after the first mutation/provider call; both must fail.
- Final-proof shell tests inject failure at Gate, proof-envelope, proof-set,
  Agent V2 proof-set validation, D11, locale, and hard-rules steps; each returns nonzero
  while the EXIT trap removes temporary handoff files.

Checks:

```bash
test -x apps/desktop/node_modules/.bin/protoc-gen-es
./model/build.sh
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
(cd apps/station && go test ./app/subserver/agent/...)
python3 tooling/scripts/check-agent-v2-proto-coverage.py
python3 tooling/scripts/expand-agent-v2-runtime-matrix.py \
  --check \
  docs/architecture/agent/execution-plans/20260817-modern-chat-agent-v2-runtime-matrix.yaml
printf '%s  %s\n' \
  'ec5d0cafc4a88b47e9026d35d44c8f17a2a12ec7e4c204eb9b8f6ec099e3ae89' \
  'docs/architecture/agent/execution-plans/20260817-modern-chat-agent-v2-runtime-matrix.yaml' \
  | shasum -a 256 -c -
test -x apps/mobile/node_modules/.bin/protoc-gen-es
tooling/scripts/proto-gen-mobile.sh web
pnpm --dir apps/desktop exec tsc --noEmit --skipLibCheck \
  --moduleResolution bundler --module ESNext --target ES2022 \
  src/gen/proto/domain/agent/{agent,agent_config,turn_stream,home,capability,evaluation}_pb.ts
pnpm --dir apps/mobile exec tsc --noEmit --skipLibCheck \
  --moduleResolution bundler --module ESNext --target ES2022 \
  src/gen/proto/domain/agent/{agent,agent_config,turn_stream,home,capability,evaluation}_pb.ts \
  src/contracts/agentV2Contract.test.ts
(cd apps/mobile && pnpm run test:agent-contract)
python3 -m unittest \
  tooling.acceptance.tests.test_evidence_store \
  tooling.acceptance.tests.test_gate_proof_contract \
  tooling.acceptance.tests.test_agent_v2_runtime_matrix \
  tooling.acceptance.tests.test_agent_d11_entrypoints \
  tooling.acceptance.tests.test_agent_v2_old_paths \
  tooling.acceptance.tests.test_agent_v2_final_proof_shell \
  tooling.acceptance.gates.agent.agent_v2_gate_test
python3 tooling/scripts/review/agent-d11-entrypoints.py --inventory-only
tooling/scripts/review/agent-v2-old-paths.sh --inventory-only
node tooling/scripts/check-agent-v2-locales.mjs
node --test tooling/scripts/check-agent-v2-locales.test.mjs
python3 tooling/scripts/acceptance-validate.py --domain agent
tooling/scripts/review/skill-check.sh
tooling/scripts/review/hard-rules.sh
```

Done:

- Contracts compile across Station/Desktop Web/Desktop Rust/Mobile TS.
- Runner/validator negative tests prove exit-zero, missing-role, dry-run,
  source-mismatch, and source-tree-output artifacts remain `UNPROVEN`.
- No generated file is manually edited.
- Every F1-F4/W1-W9 task cites a stable contract, deletion obligation, and
  final Gate cell.

### F1 — Agent And Conversation Authority

**Depends on**: W0.
**Owns**: C01/C02, D01/D06/D08/D11/D12, A01-A04/A09-A10/A13,
and the downstream orchestration guard.

**Target roots**: Station Agent config/conversation/message/turn
domain-service-persistence-handlers; Desktop Agent/topic/chat runtimes; Desktop
Rust chat application; `apps/desktop/src/pages/AgentCanvasPage.tsx`; Station
collaboration task create/run admission, `orchestration_service.go`,
`atelier_projection.go`, `scheduler_service.go`,
`official_applets/atelier.go`, and Desktop Rust
`desktop_executor_worker/mod.rs`, Agent `atelier_projection_handler.go`, and
Desktop Rust `main.rs`, `interface/tauri_commands/agent_orchestration.rs`, and
`interface/http_gateway/mod.rs` collaboration dispatch, plus
`application/applets/mod.rs#handle_atelier` applet action aliases.

Deliverables:

- Versioned Station Agent/model config and readiness readback.
- Station conversation CRUD, ordered messages, bounded queue, immutable
  retry/regenerate/edit lineage, active branches, and idempotent first turn.
- Accepted `MCA-D08A` commands `RetryTurn`, `RegenerateTurn`,
  `EditAndResend`, `SelectActiveBranch`, and `TombstoneMessage` are actor-scoped,
  idempotent, conversation-version fenced, transactionally persisted, and
  replace every destructive Desktop message mutation before old-path deletion.
- Desktop App/Browser projections consume Station IDs and revisions.
- Web disables Canvas Run with a typed single-Agent-readiness blocker; Station
  rejects Canvas task create/run fail-closed even if Web is bypassed.
- Both surfaces use `AGENT_CANVAS_SINGLE_AGENT_NOT_READY` /
  `agent.errors.canvasSingleAgentNotReady`, retryable=false, terminal=true,
  with safe argument `required_gate=agent-v2-kernel-foundation-e2e`.
- The guard remains closed through this plan because current orchestration calls
  providers outside canonical TurnService. Removal is owned only by a future
  accepted Agent Canvas plan after W9 and requires canonical TurnService,
  context, budget, trace, and capability integration.
- Guard placement is exhaustive and occurs before task/provider mutation:
  `AgentCanvasPage.runCanvas` and desktop-executor claim loop; Station generic
  `AtelierProjectionHandlers.HandleCreateProjectFromGoal`,
  `HandleResolveDecision`, and `HandleConfirmRerun`;
  `OrchestrationService.CreateCollaborationTask` before task-record/transaction
  mutation (there is no separate generic start handler);
  official `AtelierSubServer.handleCreateProject`,
  `handleResolveDecision`, and `handleConfirmRerun`; generic
  `AtelierProjectionService.CreateProjectFromGoal`, `ResolveDecision`, and
  `ConfirmRerun`; Atelier project creation before task creation;
  `ResolveCollaborationInterrupt` before
  transaction/resume mutation; boot `StartTaskRecovery/recoverRunningTasks`;
  `ResumeCollaborationTask`; desktop-node-result submission before node/lease/
  event/meta mutation; `ClaimDesktopExecutorTask` before lease mutation;
  Desktop Rust `desktop_executor_worker.start`, `run_loop`, and
  `claim_and_execute` claim/report loop; scheduler/supervisor
  `SchedulerService.executeCollaborationSupervisorSweep`,
  `RunCollaborationSupervisorTick`, `RunCollaborationSupervisorSweep`, and
  `runCollaborationSupervisorTickTx` before scan/update/event mutation;
  interrupt-resolution continuation;
  Atelier feedback rerun before clone/publish/start; and shared
  `startTaskExecution`, `startDirectRunExecution`, and
  `executePendingDirectRun` as defense in depth.
- Browser/Tauri forwarding is part of the guard inventory:
  `agent_collaboration_resume_task` must parse the typed resume input and call
  `agent_collaboration_resume_task`, never the cancel command. The checker
  validates command name, input type, target function, and downstream guard for
  every collaboration gateway/Tauri route.
- Guards apply only to create/start/resume/continue/rerun/claim paths.
  Cancellation, lease release, and cleanup remain reachable so pre-existing
  work can terminate safely; tests prove they are not misrouted or blocked.
- W0 adds a source-backed D11 entrypoint fixture/checker that enumerates every
  Web/API/service/recovery/resume/continuation/claim/Atelier start path and
  fails when a path lacks the guard before its first mutation/provider call.

D11 route/disposition contract:

| Route/command | Exact handler/target | Disposition before future Canvas migration |
|---|---|---|
| `/agent/collaboration/create` | `HandleCreateCollaborationTask` -> `CreateCollaborationTask` | guarded before task/provider-plan transaction |
| `/agent/collaboration/resume` and Browser `agent_collaboration_resume_task` | `HandleResumeCollaborationTask` -> `ResumeCollaborationTask`; gateway typed resume target | guarded; gateway never maps to cancel |
| `/agent/collaboration/node/submit-result` | `HandleSubmitCollaborationNodeResult` -> node-result service | guarded before node/lease/event/meta mutation |
| `/agent/collaboration/executor/claim`, `/heartbeat` | claim/heartbeat handlers and Desktop worker | guarded before lease mutation/extension |
| `/agent/collaboration/cancel`, `/executor/release` | cancel/release handlers | allowed-cleanup |
| `/agent/collaboration/get`, `/list`, `/events/list` | read handlers | allowed-read |
| Tauri `agent_collaboration_subscribe` | `tauri_commands::agent_orchestration::agent_collaboration_subscribe` | allowed-read stream; no task mutation |
| Tauri `agent_collaboration_cancel_stream` | `tauri_commands::agent_orchestration::agent_collaboration_cancel_stream` | allowed-cleanup; stops subscription only |
| `/agent/atelier/project/create-from-goal`, `/applets/atelier/v1/projects` | generic/official create handlers -> `CreateProjectFromGoal` | guarded before task creation |
| `/agent/atelier/message/send`, `/applets/atelier/v1/messages` | `HandleSendMessage`/`handleSendMessage` -> `SendMessage` | allowed-nonexecution-mutation; checker proves event append has no task/provider start edge |
| `/agent/atelier/escalation/resolve`, `/applets/atelier/v1/escalations:resolve` | generic/official resolve handlers -> `ResolveDecision`/interrupt resume | guarded before decision/resume mutation |
| `/agent/atelier/feedback/confirm-rerun`, `/applets/atelier/v1/feedback/confirm-rerun` | generic/official confirm handlers -> `ConfirmRerun` | guarded before clone/publish/start |
| `/agent/atelier/task/set-status`, `/applets/atelier/v1/tasks/:taskID/status` | `HandleSetTaskStatus`/`handleSetTaskStatus` -> `SetTaskStatus` | allowed-nonexecution-mutation; checker proves status/meta update has no start edge |
| `/agent/atelier/task/purge`, `/applets/atelier/v1/tasks/:taskID` | `HandlePurgeTask`/`handlePurgeTask` -> `PurgeTask` | allowed-cleanup |
| `/agent/atelier/workspace/load`, `/applets/atelier/v1/workspace` | workspace handlers | allowed-read |
| `/agent/atelier/artifact/body/fetch`, `/applets/atelier/v1/artifact/body/fetch` | artifact handlers | allowed-read |
| `/agent/atelier/provider/capabilities`, `/applets/atelier/v1/provider/capabilities` | provider-capability handlers | allowed-nonexecution-mutation; may emit bounded evidence but has no task/provider execution edge |
| `/agent/atelier/feedback/submit`, `/applets/atelier/v1/feedback/submit` | feedback handlers | allowed-nonexecution-mutation; no start edge |
| `/agent/atelier/memory/confirm-candidate`, `/applets/atelier/v1/memory/confirm-candidate` | memory-confirm handlers | allowed-nonexecution-mutation; no start edge |
| scheduler Tick/Sweep and boot recovery | exact scheduler/orchestration symbols listed above | guarded before scan transaction/update/event/start |

Desktop applet capability gateway aliases are a separate live ingress surface,
not implicit coverage from the Station routes:

| `handle_atelier` action aliases | Exact downstream target | D11 disposition and assertion |
|---|---|---|
| `workspace.load`, `workspaceLoad`, `loadWorkspace` | `/sub-agent/agent/atelier/workspace/load` | allowed-read; target must remain the workspace read handler |
| `project.createFromGoal`, `project.create_from_goal`, `createProjectFromGoal` | `/sub-agent/agent/atelier/project/create-from-goal` | guarded-forwarder; checker follows the target to the pre-mutation Station guard |
| `message.send`, `messageSend` | `/sub-agent/agent/atelier/message/send` | allowed-nonexecution-mutation; checker proves no task/provider start edge |
| `escalation.resolve`, `escalationResolve` | `/sub-agent/agent/atelier/escalation/resolve` | guarded-forwarder; checker follows the target to the pre-resume Station guard |
| `task.setStatus`, `task.set_status`, `setTaskStatus` | `/sub-agent/agent/atelier/task/set-status` | allowed-nonexecution-mutation; checker proves no start edge |
| `task.purge`, `purgeTask` | `/sub-agent/agent/atelier/task/purge` | allowed-cleanup |
| `provider.capabilities`, `providerCapabilities` | `/sub-agent/agent/atelier/provider/capabilities` | allowed-nonexecution-mutation; may emit bounded evidence but has no task/provider execution edge |
| `feedback.submit`, `feedbackSubmit` | `/sub-agent/agent/atelier/feedback/submit` | allowed-nonexecution-mutation; checker proves no start edge |
| `memory.confirmCandidate`, `memoryConfirmCandidate` | `/sub-agent/agent/atelier/memory/confirm-candidate` | allowed-nonexecution-mutation; checker proves no start edge |
| `feedback.confirmRerun`, `feedbackConfirmRerun` | `/sub-agent/agent/atelier/feedback/confirm-rerun` | guarded-forwarder; checker follows the target to the pre-clone/start guard |
| `workspace.open`, `workspaceOpen` | local `handle_atelier_workspace_open` | allowed-nonexecution-mutation; URI validation and controlled E2E launcher process are permitted, but no orchestration task/provider start |
| `artifact.body.fetch`, `artifactBodyFetch` | `/sub-agent/agent/atelier/artifact/body/fetch` | allowed-read |
| `artifact.preview.open`, `artifactPreviewOpen` | local `handle_atelier_artifact_preview_open` | allowed-read/host intent; no task/provider start |
| `events.subscribe`, `eventsSubscribe` | local `start_atelier_projection_event_stream` | allowed-read stream; no task mutation |

The fixture stores every route/command, input type, handler, service target,
first mutation/provider symbol, disposition, and guard symbol. Unknown routes
or action aliases, changed targets, changed call edges, or a new
`handle_atelier` match arm fail W0/F1/W9 checks.

Atomic cutover/deletion:

- Switch Agent/topic/message reads and writes to Station in one closure.
- Delete Desktop Rust `ChatStore`, actor buckets, and local durable
  topic/message/config authority.
- Existing Station rows migrate with actor/version/lineage reconciliation;
  invalid rows fail the cutover.

Checks:

```bash
(cd apps/station && go test ./app/subserver/agent/... -run 'AgentConfig|Conversation|Message|Queue|Branch|CanvasReadinessGuard')
(cd apps/desktop && pnpm run check && pnpm run test -- AgentCanvasReadinessGuard)
python3 tooling/scripts/review/agent-d11-entrypoints.py
tooling/scripts/review/agent-v2-old-paths.sh --closure C01,C02
```

Evidence before product Gate: Station API/row fixtures, migration report,
restart readback, Web blocked DOM, direct create/start/recovery/resume/
Atelier-project/decision/interrupt/node-result/executor-claim/Atelier-rerun
bypass rejections, official-Applet/background-worker/scheduler/supervisor
Tick/Sweep/transaction-helper rejections, zero task/node/lease/event/meta/
provider mutations, and zero
unresolved C01/C02 legacy matches.

### F2 — Runtime, Stream, Capability, And Portability

**Depends on**: F1.
**Owns**: C03/C05/C06/C10, D02/D03/D05-D07/D09/D13,
A02/A09/A11/A13-A14.

**Target roots**: Station runtime resolver/TurnService/event replay; Desktop
Rust SSE/client-capability bridge; Desktop Browser gateway; Desktop/Mobile
capability registries and shared contract tests; `chatRuntime`, handwritten
streaming reducer/types/index, and intervention runtime/store;
`cli_adapter_registry.go`, provider catalog/handler, provider/runtime API,
Desktop provider store, and Agent Profile runtime selector.

Deliverables:

- Station Direct Model execution; frozen-profile P12/CLI non-advertisement.
- Persisted monotonic TurnEvents, cursor replay/snapshot, cancellation, and one
  terminal projection.
- `chatRuntime` routes typed events to owning runtimes; generic
  `streaming/handler.ts` becomes side-effect-free, and intervention side effects
  move to the intervention/chat runtime owner.
- Fresh capability/budget snapshot rejects/degrades before provider execution.
- Platform-neutral client capability session with Desktop/Browser/Mobile
  adapters and explicit unavailable local capability.
- The frozen V2 profile omits `EXTERNAL_AGENT`. F2 does not implement,
  certify, expose, or promote P12. Station profile/readiness APIs and
  Desktop/Browser selectors must prove it is not advertised.
- The frozen V2 profile also omits the registered stateless CLI adapter.
  F2 does not implement a promotion path; the catalog-disabled `trae-cli`
  remains absent from effective provider/model/readiness projections and
  Desktop/Browser selectors.
- Existing Station provider/model APIs project the D12 profile and D05
  `RuntimeCapabilitySnapshot`. Code registration, runtime kind, or provider-list
  presence alone cannot make an optional runtime selectable.
- Desktop selectors consume those existing Station projections; neither
  `runtime_kind`, registry membership, nor provider-list presence alone may
  infer advertisement.
- Any future advertisement of P12 or a stateless CLI adapter is outside this
  execution plan and must return through PRODUCT, DESIGN, and PLAN with its own
  complete runtime matrix. No acceptance-only runtime-resolver ingress is
  permitted.

Atomic cutover/deletion:

- App and Browser switch to the same Station SSE/event contract.
- Delete Browser `executeAgentTurnOnce` chat fallback, Desktop AI CLI/provider
  execution authority, ephemeral-only event assumptions, and Desktop names
  from shared contracts.

Checks:

```bash
(cd apps/station && go test ./app/subserver/agent/... -run 'Runtime|TurnEvent|Replay|Capability|Budget|OptionalRuntimeProfile')
(cd apps/desktop && pnpm run check && pnpm run test)
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml agent_turn
(cd apps/mobile && pnpm run test:agent-contract)
tooling/scripts/review/agent-v2-old-paths.sh --closure C03,C05,C06,C10
```

Evidence before product Gate: raw event timestamps/sequences, replay equality,
provider cancel, zero-execution rejection, two-device isolation, and zero
unresolved legacy matches. Capability/profile/API/selector readback proves
P12 and stateless CLI non-advertisement on Desktop and Browser.

### F3 — Context And Resource Intelligence

**Depends on**: F2.
**Owns**: C04/C08, D04/D05/D13, A03/A05-A06/A08/A13-A14.

**Target roots**: Station context/memory/skill/knowledge/storage services,
ContextLedger persistence/API, Desktop source/resource projections, attachment
upload/composer.

Deliverables:

- Deterministic typed ContextLedger with ordered segments, source IDs, token
  estimates, truncation/omission reasons, and redacted persistence.
- Opaque authorized attachment/resource refs with upload/extraction,
  type/size/model gate, provenance, restart readback, and client projection.

Cutover/deletion:

- Delete untyped prompt-only attribution, metadata-only attachment completion,
  and local-path payload identity from portable contracts.

Checks:

```bash
(cd apps/station && go test ./app/subserver/agent/... -run 'ContextLedger|Memory|Skill|Knowledge|Attachment')
(cd apps/desktop && pnpm run check && pnpm run test)
tooling/scripts/review/agent-v2-old-paths.sh --closure C04,C08
```

Evidence before product Gate: fixed source-quality cases, exact source IDs,
opaque ref authorization, unsupported/oversized early reject, restart readback,
and zero local-path leakage.

### F4 — Tool Policy And Observability Baseline

**Depends on**: F2.
**Owns**: C07/C09, D09/D10/D13/D19, A07/A09/A12-A14.

**Execution status**: Owner-approved. Execute G1 in dependency order. Existing
decision/result/claim endpoints and the untracked `toolRuntime.ts` remain
incomplete until their named workstreams pass; they are not an authorized
runtime path by themselves.

**Authority invariant**:

- Station alone converts an approved ToolCall into an executable request.
- Desktop Rust executes only a Station-issued, targeted, fenced envelope and
  persists `PREPARED` before a side effect.
- Desktop Web submits decision intent and renders projections only. It cannot
  claim, execute, submit execution results, or continue a turn.

#### G1-A — Proto Contract Closure

**Depends on**: accepted MCA-D19, MCA-D19A, and MCA-D19B.

**Owner**: Model contract owner. No other production owner writes until
generation and contract tests pass.

**Deliverables**:

- Extend the shared decision command/ack with approval ID, ToolCall ID,
  decision ID, expected/committed revision, approved value, idempotency key,
  payload hash, actor-independent auth context, and typed conflicts.
- Extend `ClientCapabilityRequest` with attempt/target device, decision,
  claim/lease revision/fence, dispatch sequence, payload hash,
  execution/reconciliation deadlines, Station-issued ToolBatch identity,
  Station-pinned replay policy/external idempotency key, and recovery
  credential descriptor.
- Define the cross-language two-stage deterministic hash: execution payload
  excludes hash/credential fields; recovery scope binds the resulting hash.
- Add typed `ClientCapabilityReceipt` states
  `PREPARED|APPLIED|FAILED|RECONCILED_UNKNOWN`, immutable result identity, and
  ToolBatch identity plus signed recovery proof.
- Add typed capability lease renew/revoke contracts with expected-revision CAS.
- Replace client-shaped lease registration with a capability advertisement;
  Station derives actor/device and issues lease/session identity, revision, and
  policy-capped expiry.
- Add canonical actor-device command proof to register, renew, revoke, pull,
  and active receipt requests; reserve retired registration field 1 so old
  payloads fail closed.
- Split active receipt and terminal recovery into distinct typed endpoints that
  share one result CAS but cannot downgrade proof modes.
- Add typed execution-envelope/receipt events or RPCs for the client capability
  kernel. Executable envelopes are not Web `TurnEvent` commands.
- Generate Go, Desktop TS/Rust, and Mobile TS only through canonical scripts.

**Failure behavior**:

- Unknown fields/schema versions fail before dispatch.
- Actor JWT plus forged `X-Device-ID` fails before capability authority access.
- Command nonce reuse with another command/body conflicts; identical write
  replay returns the same durable outcome.
- Portable contracts reject arbitrary local paths and unbounded payloads.
- No handwritten JSON request becomes an independent contract.

**Checks**:

```bash
./model/build.sh
./tooling/scripts/proto-gen-mobile.sh web
(cd apps/station && go test ./app/subserver/agent/... -run 'Tool|Decision|Capability')
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml agent_turn
(cd apps/desktop && pnpm exec tsc --noEmit --skipLibCheck \
  --moduleResolution bundler --module ESNext --target ES2022 \
  src/gen/proto/domain/agent/{agent,agent_config,turn_stream}_pb.ts)
(cd apps/mobile && pnpm exec tsc --noEmit --skipLibCheck \
  --moduleResolution bundler --module ESNext --target ES2022 \
  src/gen/proto/domain/agent/{agent,agent_config,turn_stream}_pb.ts \
  src/contracts/agentV2Contract.test.ts)
```

**Status**: complete on 2026-08-22. Accepted D19A/D19B contracts are generated
for Go, Desktop TS, Mobile TS, and Rust prost. Descriptor coverage, generated
model compilation, Desktop/Mobile TypeScript contract checks, Mobile fenced
request/receipt round-trip, and Rust compile pass. Station service call sites
intentionally move to G1-B because the atomic contract cutover removes the old
client-shaped registration and single-deadline fields.

#### G1-B — Station Decision, Outbox, Result, And Continuation Authority

**Depends on**: G1-A.

**Owner**: Station Agent ToolDispatch/Turn services and persistence.

**Deliverables**:

- Route every client-owned ToolCall in the active `TurnService` loop through
  `ToolDispatchService.Propose`; direct device-local execution is forbidden.
- Persist one decision revision with CAS and payload-bound idempotency.
- In one transaction, commit the approved decision, execution claim, target
  capability session/device, lease revision, fence, dispatch sequence, payload
  hash, execution/reconciliation deadlines, replay policy, one recovery
  credential/nonce, and one targeted outbox envelope.
- Accept receipts/results only for the committed
  actor/device/session/lease revision/claim/fence/revision/payload tuple and the
  applicable execution or recovery authority.
- Verify device-signed terminal recovery, consume the nonce with the result CAS,
  return the original acknowledgement for identical replay, and reject
  conflicting digests or revoked device keys.
- Renew/revoke leases through actor/device/session-bound revision CAS; renewal
  cannot mutate capability-set hash, connection identity, or signing key.
- Verify canonical actor-device command proof and nonce/digest replay before
  register, renew, revoke, pull, or active receipt authority access.
- Expose terminal recovery through the credential-scoped signed endpoint so
  actor JWT/session revoke cannot destroy already-PREPARED settlement authority.
- Commit each unique terminal result by `(tool_call_id, result_id)`. When the
  final member of a provider-response ToolBatch is `APPLIED` and every other
  member is also `APPLIED`, atomically create the unique continuation key
  `(turn_id, attempt_id, tool_batch_id)` before scheduling the next model step.
- Run continuation through a Station-owned durable lease. Restart may reclaim
  only pre-emission or provider-idempotent work; ambiguous non-idempotent
  post-emission work becomes `reconciliation_required`.
- Persist loop budgets, denial/expiry/timeout/cancel outcomes, and audit-safe
  arguments/results.

**Failure behavior**:

- Same idempotency key and payload returns the original acknowledgement.
- Same key with another payload conflicts; stale expected revision rejects.
- Duplicate envelope/result cannot create a second side effect, ToolResult
  event, or model continuation.
- Old-fence, expired, revoked, or untargeted receipts are audit-only rejects.
- A batch with denied, expired, cancelled, failed, or unknown-side-effect
  members creates no automatic continuation.

**Checks**:

```bash
(cd apps/station && go test ./app/subserver/agent/... -run \
  'Tool|Policy|Decision|Outbox|Fence|Receipt|Continuation|Budget')
```

**Status**: complete on 2026-08-22. Station owns authenticated capability
leases, lease revision CAS, canonical actor-device command proof, decision CAS,
targeted outbox dispatch, split execution/reconciliation deadlines,
Station-pinned replay policy, receipt tuple validation, signed terminal
recovery, atomic nonce/result/ack settlement, and one continuation per eligible
provider ToolBatch. The active Turn path durably pauses instead of waiting on
the request context; a lifecycle-owned worker resumes ready continuations,
reclaims only permitted expired leases, and interrupts reconciliation-required
work without replay. Valid post-PREPARED terminal recovery after the execution
deadline records the result fact, while cancelled or blocked batches cannot
reopen lifecycle authority or continuation. Pre-D19B leases and credential-less
PREPARED rows fail closed during migration. Full/focused Agent tests,
proof/recovery/concurrency race tests, vet, Go style, generated-contract checks,
and diff-check passed. G1-C through G1-F implementation/static gates are
complete; G-F and all Product Gates remain `UNPROVEN`.

#### G1-C — Desktop Rust Fenced Executor

**Depends on**: G1-A and G1-B contract/behavior complete.

**Owner**: Desktop Rust client capability kernel.

**Deliverables**:

- Consume only authenticated Station-targeted execution envelopes.
- Validate capability session, target device, decision revision, claim, lease,
  revision, fence, dispatch sequence, payload hash, schema, replay policy,
  execution/reconciliation deadlines, recovery descriptor, and opaque refs.
- Persist a durable receipt attempt before execution; record `PREPARED` before
  any side effect and `APPLIED|FAILED|RECONCILED_UNKNOWN` afterward.
- Return the existing receipt/result for identical duplicate delivery.
- Resolve opaque local resource refs through an encrypted actor/device-scoped
  registry inside the kernel permission boundary.
- Submit typed receipt/result to Station; never mutate approval state.
- Sign recovery receipts with the existing actor-device Ed25519 identity;
  recovery can report terminal state only.

**Failure behavior**:

- Mismatch/stale/expired/revoked input rejects before side effects.
- Crash after `PREPARED` replays only under Station-pinned
  `REPLAY_WITH_EXTERNAL_IDEMPOTENCY` with the exact issued key; otherwise
  report `RECONCILED_UNKNOWN`.
- Restart reconstructs receipt state from durable storage.
- Lease revoke/expiry or execution deadline never blocks valid signed terminal
  settlement before reconciliation deadline, and never restores execution.

**Checks**:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml \
  'agent_turn|client_capability|tool_receipt'
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

**Completion audit — 2026-08-22**:

- The production supervisor is wired into Tauri setup/shutdown, pins each
  worker and durable receipt to its issuing Station, and passes 15 focused
  tests covering PREPARED ordering, duplicate delivery, stale/revoked/expired
  authority, no-replay recovery, Station-required same-fence replay rejection,
  higher-fence exact external idempotency-key forwarding, opaque-resource
  scope, path redaction, and signed terminal recovery.
- Current production capability contracts and Station dispatches are
  fail-closed at `NO_REPLAY_AFTER_PREPARED`; opaque resource issuance belongs
  to F3 while G1-C owns encrypted resolution. `integrity_hash` remains pinned
  metadata because no content-hash algorithm is defined by the accepted
  contract.
- G1-C implementation and static gates are complete. D19C now requires a new
  Station-issued fence before any external-idempotency restart execution,
  validates the immutable original envelope and current lease after locks,
  preserves the original deadline/key, rejects and audits old-fence recovery,
  and fails closed for identity, capability/schema, deadline, hash, and
  resource mismatches. No current production capability advertises external
  idempotency, so real external-idempotent product reachability remains
  `UNPROVEN`.

**MCA-D19C accepted execution closure — 2026-08-22**:

1. Station takeover transaction: for an unresolved externally idempotent
   PREPARED ToolCall before its original execution deadline, CAS the current
   fence/status, keep ToolCall/decision/claim/arguments/idempotency identity,
   bind a matching current lease, increment the fence, issue a new
   request/outbox/recovery credential, and invalidate prior recovery authority.
2. Desktop consumption: accept only the newly Station-issued envelope through
   the normal signed pull path; persist a distinct receipt attempt under the
   higher fence and pass the exact external idempotency key to the adapter.
3. Failure closure: no takeover for non-idempotent, expired, capability/schema
   mismatch, actor/device/signing-key mismatch, or resource-bearing work.
   Existing reconciliation remains the only terminal path.
4. Deterministic evidence: prove takeover success, old-fence rejection,
   duplicate takeover idempotency, unchanged external key/deadline, and every
   no-takeover condition before G1-C completion.

#### G1-D — Desktop Web Projection And Decision Intent

**Depends on**: G1-B and G1-C.

**Owner**: registered Desktop `RuntimeDescriptor` for `toolRuntime`.

**Deliverables**:

- Replace the untracked draft with a registered runtime and pure
  proposal/decision/result reducer.
- `chatRuntime` only demultiplexes typed Station projection events.
- `ToolCallCard` submits
  `(approval_id, tool_call_id, decision_id, expected_revision, approved,
  idempotency_key)` through the Desktop Rust Station-command proxy.
- `toolRuntime` deduplicates projections by decision ID/revision and is the
  sole writer for ToolCallCard/AgentProfile tool state.
- Generic streaming reducer has no approval mutation or side effect.

**Forbidden**:

- Web policy classification or auto-approval.
- Web execution claim, native tool invocation, receipt/result submission, or
  turn continuation.
- Direct `fetch('/agent/tool/*')` from the Web runtime.

**Checks**:

```bash
(cd apps/desktop && pnpm run check)
(cd apps/desktop && pnpm run test -- toolRuntime messageActions)
```

#### G1-E — Atomic Authority Cutover And Legacy Deletion

**Depends on**: G1-B, G1-C, and G1-D deterministic checks pass.

**Owner**: G1 production owner; no concurrent production writer.

**Cutover**:

1. Stop new legacy approval admission.
2. Drain or explicitly cancel pre-cutover waiters; a ToolCall never changes
   owner in flight.
3. Activate the Station outbox -> Rust receipt -> Station continuation path.
4. Activate Web projection/decision intent.
5. In the same closure, delete all replaced authority.

**Delete**:

- `store/chat.ts#decideToolApproval` and all consumers.
- Dead `store/tool/index.ts#pendingCalls`; retain read-only `store/tool.ts`.
- Approval cases/subscriptions in generic streaming handler/types.
- Rust `tool_approval_registry`, `ApprovalWaiter`, `Condvar`, and direct
  Web-to-waiter command.
- Generic unfenced Web-to-Rust local tool resolver.
- Station `LocalToolBroker`, `/turn/local-tool-result`, and any direct
  device-local execution/continuation path.

**Zero-residual gate**:

```bash
tooling/scripts/review/agent-v2-old-paths.sh --closure C07
```

The result must be zero unresolved live matches. Documentation, generated
artifacts, and tests require explicit disposition; they cannot hide a live
authority match.

#### G1-F — Exact-Turn Usage, Feedback, And Redacted Replay

**Depends on**: G1-E and the canonical Turn/ToolCall continuation from G1-B.

**Owner**: Station TurnTrace/usage/feedback/diagnostic services; Desktop is a
read-only projection.

**Status**: implementation/static gates complete on 2026-08-23; Native product
proof remains `UNPROVEN`.

**Deliverables**:

- Immutable per-attempt usage bound to exact Turn/attempt/ToolCall lineage.
- Durable typed feedback with create/readback and actor isolation.
- Station-generated exact-turn diagnostic replay containing source/runtime/
  context/tool/usage/terminal facts with secrets, credentials, local paths,
  and disallowed PII redacted.
- Delete client-derived diagnostic authority and screenshot-only claims after
  source-matching readback passes.

**Checks**:

```bash
(cd apps/station && go test ./app/subserver/agent/... -run \
  'Trace|Feedback|Usage|Diagnostic|Redact')
(cd apps/desktop && pnpm run check && pnpm run test)
```

#### G1-X — Acceptance Contract And Deterministic Evidence

**May run in parallel**: after G1-A contract freeze. It exclusively owns
`tooling/acceptance/**` and must not edit production files.

**Status**: implementation/static gates complete on 2026-08-23; runtime proof
remains `UNPROVEN`.

**Deliverables**:

- Map active `turn_service.go`, ToolDispatch persistence/handlers,
  Desktop Rust ingress/receipt, `toolRuntime`, feedback/usage, and
  `agentTurnDiagnostics.ts` to C07/C09.
- Replace generic V2 Gate runner wiring with canonical fail-closed
  `agent_v2_gate.py` candidate validation.
- Add deterministic fixtures/tests for decision revision, duplicate/conflicting
  idempotency, stale acknowledgement, one execution, one continuation,
  PREPARED crash, restart replay, usage/feedback readback, and redaction.
- Keep Foundation and governed ToolCall product Gates `UNPROVEN` until their
  declared environments execute and source-bound evidence validates.

**Checks**:

```bash
make acceptance-validate DOMAIN=agent
python3 -m unittest discover -s tooling/acceptance/tests -p 'test_agent_v2*.py'
python3 tooling/scripts/acceptance-plan.py \
  --changed-file apps/desktop/src/diagnostics/agentTurnDiagnostics.ts \
  --output /tmp/agent-v2-c09-plan.json
```

The diagnostics path must select C09 and its required Gate; exit zero with an
empty plan is failure.

#### G1-XR — Foundation Candidate Producer And Safe Provisioning

**Depends on**: G1-X contract/validator closure.

**Status**: D-12 contract migration, producer/provisioner scaffolding, and
XR-4-P1/P2/P3 implementation/static checks complete; Group 1 production probe
wiring active.

**Owner**: Acceptance runtime producer/provisioner; product truth remains in
Station and receiver DOM.

**Progress**: credential redaction, candidate producer core, provisioner, and
D-12 matrix/schema/validator migration complete; Mobile/D11 adapters cover 17
tuples. MCA-D19D now defines the production frozen-profile/readiness projection,
Station/Desktop monotonic activity counters, and isolated Browser lifecycle
needed by the 8 non-advertisement tuples. P3 now provides a
Browser-lifecycle-owned zero-capability session, actor-scoped Station session
readback, and readiness validation against an active non-revoked lease. The
Group 1 now has a manifest-bound Native/Browser lifecycle controller, bounded
session convergence, unified raw runtime capture, and an exact matrix-driven
28-tuple dispatcher. AS-F02 additionally has explicit-idempotency concurrent
Turn submission, pre-drain queue capture, visible queue projection, typed stream
outcomes, and queued cancellation controls. After rebasing onto
`origin/master@6a0dce42b`, commits `c2498afd3` and `83f75f9d8` removed restored
runtime artifacts and reconciled Acceptance/Chat contracts. AS-F10 now has a
fail-closed oracle for unsupported, unauthorized, signature-tamper,
schema-mismatch, cross-device, selected-device, Desktop-fallback, and
zero-execution facts; Station also explicitly rejects a capability-session pull
whose persisted device differs from the authenticated device. Commit
`f5c59fe33` adds acceptance-gated emitters that send real unauthorized,
signature-tampered, and cross-device pull requests through the production
Station endpoints while recording before/after executor counters.
Unsupported-capability and schema-mismatch rejection remain blocked because
their authority path exists only inside Station `ProposeBatch`; no production
callable trigger currently reaches that path. An Acceptance-only bypass is
forbidden because it would not prove the product path. The remaining AS-F10
controls, other scenario-specific controls, remaining direct-runtime adapters,
and exact-source deployment remain open; all affected product cells remain
`UNPROVEN`.

**XR-4 execution finding (2026-08-24)**:

- Provider/model list filtering proves that CLI-shaped records are not returned,
  but does not expose the effective profile identity or independently prove that
  P12 `EXTERNAL_AGENT` is absent from readiness.
- TurnTrace count is not a provider-process, runtime-home, external-session, or
  workspace-creation counter and therefore cannot satisfy AS-F11/AS-F13 zero
  hidden-dispatch evidence.
- The current Foundation provisioner allocates only a Native Tauri client, so a
  Browser observation cannot be source-bound to an isolated Browser runtime.
- An adapter based on those weaker signals was rejected before evidence
  emission. Owner accepted MCA-D19D on 2026-08-25; XR-4 must now implement
  those production readbacks and Browser lifecycle before evidence emission.

**XR-4 direct-runtime Harness audit (2026-08-25)**:

- The remaining 394 Desktop/Browser tuples reduce to 53 unique direct-runtime
  scenarios: 11 Foundation scenarios, 28 typed error scenarios, and 14
  quantitative scenarios.
- The current production Agent Harness exposes login/logout, Agent navigation,
  provider configuration, send/wait/message readback, operation snapshot,
  source/budget/capability indicators, Station conversation readback, and the
  MCA-D19D non-advertisement snapshot.
- No direct-runtime cell is fully runnable yet because the Harness and Fixture
  layer still lack source-backed controls/readbacks for queue pressure,
  boundary-specific cancellation, Tool policy/approval/expiry, attachments,
  deterministic provider failures, branch mutation, ContextLedger,
  usage/feedback/diagnostics, capability-session ownership, two-topic restart,
  and quantitative raw-sample capture.
- A generic send-message loop is forbidden as evidence for these cells. The
  direct adapter must dispatch by scenario ID to a production action/readback
  contract and fail closed for every unimplemented scenario.

**Direct-runtime implementation groups**:

1. Foundation state/readback: AS-F01/F02/F07/F08/F09/F10/F12.
2. Streaming and recovery: AS-F03/F06, cancellation, replay, latency.
3. Tool and resource behavior: AS-F04/F05, tool cancellation, approval, and
   resource-budget boundaries.
4. Typed failure fixtures: all 28 `BASE-*` cells with exact error and zero
   forbidden side effects.
5. Quantitative loops: continuity, queue, loop, safety, quality, and bounded
   sample emission.

**XR-4 production prerequisite amendment (2026-08-25)**:

The first Group 1 probe wiring pass proved that three plan assumptions were
inventory claims rather than implemented production paths. The accepted D05,
D06, and D13 architecture remains unchanged, so this is a mechanical execution
amendment:

1. `XR-4-P1`: implement `GetCapabilityReadiness` as an actor-scoped Station
   projection over the selected Agent config and `RuntimeAdmissionResolver`;
   Desktop/Browser read it through the controlled BFF.
2. `XR-4-P2`: implement one-active-turn bounded FIFO admission, queue position,
   cancellation, capacity overflow, and conversation projection updates before
   AS-F02 or `QUEUE_Q_QPLUS1` probes.
3. `XR-4-P3`: implement a Browser-owned capability session with an explicitly
   reduced capability set. A headless Desktop supervisor behind the Browser
   gateway cannot count as Browser authority or evidence.
4. Only after P1-P3 pass focused production tests may the Group 1 scenario
   probe emit captures for the direct adapter.

No Harness, Fixture, or Gate may write readiness/queue/session facts to close
these gaps.

**XR-4-P4 design amendment accepted (2026-08-25)**:

AS-F10 Browser execution exposed a contradiction in the accepted evidence
contract. The Browser capability session correctly advertises zero local
execution capabilities and must create zero ToolCalls, while the current
`direct_runtime` attestation profile requires both a non-empty
`clientSession.capabilities` array and a `toolCallBinding` whose capability is
present in that lease. A placeholder capability or ToolCall would fabricate the
fact being proved.

Owner-approved amendment: add a dedicated
`direct_runtime_no_local_capability` attestation profile for Browser direct
cells. It retains actor, conversation, runtime snapshot, Turn
attempt, session identity, readiness, and zero-execution evidence while
forbidding ToolCall binding and allowing an empty capability list. Matrix
row-level ownership applies the profile to every `foundation-browser-direct`
tuple because the Browser session has no device-local executor in this product
stage. The reviewed matrix advances to `2026-08-25.1`; the proof contract and
runtime-attestation schema advance to version `3`.

**XR-4-P5 design amendment accepted (2026-08-27)**:

The first source-matched AS-F01 Turn proved that `ConversationRuntimeBinding`
and `TurnAttempt.runtime_snapshot` existed only in generated contracts. Station
did not persist, validate, or project either authority. XR-4-P5 closes the
already accepted MCA-D03/MCA-D05 contract without changing product scope:

1. Station persists the first resolved conversation binding and the complete
   attempt runtime snapshot before provider execution.
2. A subsequent mismatched runtime/config/capability tuple rejects instead of
   overwriting the conversation binding.
3. Conversation and diagnostic readback return the stored protobuf facts after
   restart.
4. Capability, config, and runtime-snapshot hashes use the canonical JSON rules
   recorded in `modern-chat-agent/data-model.md`; Harness synthesis is
   forbidden.
5. Focused persistence, conflict, readback, and restart tests must pass before
   the next G-F rerun.

**Dependency order**:

```text
XR-1 matrix role policy + new identity
  -> XR-2 evidence contract/schema v2
  -> XR-3 validator/producer subset semantics
  -> XR-4 Desktop/Browser/Mobile/D11/non-advertisement adapters
  -> XR-5 clean commit + exact Station deployment + G-F
```

`XR-1` through `XR-3` form one atomic contract cutover. No candidate produced
with the old role × tuple Cartesian semantics remains valid.

**Deliverables**:

1. Redact secret-bearing values from `make profile` and `make config` output.
2. Add a dedicated Foundation candidate producer that consumes the exact
   expanded matrix and executes all 419 tuples across Desktop Native, Browser,
   Mobile contract, D11 guard, CLI absence, and External Agent absence rows.
3. Extend the `agent` Acceptance Harness and deterministic fixtures only for
   production actions required by the reviewed matrix; no store-only proof or
   fabricated observation is allowed.
4. Emit the nine scenario-owned roles to the external Evidence Store and hand
   the immutable candidate manifest to `agent_v2_gate.py`; runner-owned roles
   remain generated by the canonical runner.
5. Add `agent-v2-kernel-foundation-e2e` provisioning support for the approved
   `two` profile, including source identity, actor isolation, credential
   references, cleanup, and port ownership.
6. Create one clean candidate commit, deploy that exact commit to `station-1`
   through the approved Make/Git deployment path, and prove matching local,
   remote, client, and proto identities before Native execution.

**Checks**:

```bash
python3 tooling/scripts/expand-agent-v2-runtime-matrix.py \
  --check tooling/acceptance/matrices/agent-v2-runtime-matrix.yaml
python3 -m unittest tooling.acceptance.gates.agent.agent_v2_gate_test
python3 tooling/acceptance/gates/agent/agent_native_static_test.py
make acceptance-validate DOMAIN=agent
```

**Runtime gate**:

- G-F remains blocked until the producer emits all required roles from the
  exact deployed source.
- Deployment and commit require explicit owner authorization.
- Any credential value printed to stdout/stderr or evidence fails preflight.

#### G1 Join Barrier

G1 closes only when:

- G1-A through G1-F pass in dependency order.
- G1-X contracts and deterministic tests pass.
- G1-XR candidate producer, provisioning, secret-redaction, and exact-source
  deployment checks pass.
- `tooling/scripts/review/agent-v2-old-paths.sh --closure C07,C09` reports
  zero unresolved live matches.
- Station, Desktop TS, and Desktop Rust checks pass on one stable source
  snapshot.
- Usage, feedback, and replay read back from Station for the exact Turn.
- No local Station was started; environment-backed evidence uses the approved
  `two` profile and external Evidence Store.

Only then may G-F preflight begin.

#### F4 Acceptance Scenarios

##### AS-F4-01 Manual approval executes once
- **Precondition**: One manual-policy ToolCall and one compatible Desktop capability session.
- **Action**: User approves once; duplicate decision and envelope delivery are injected.
- **Expected**: UI shows the committed revision; Rust records one PREPARED/APPLIED receipt; Station stores one result and one batch continuation; side-effect count is one.
- **Failure variant**: Same key with another approved value conflicts and dispatch count remains unchanged.
- **Evidence**: receiver DOM, Station decision/ToolCall/continuation readback, executor receipt, side-effect counter.
- **Status**: pending

##### AS-F4-02 Denial, expiry, and stale revision
- **Precondition**: Manual ToolCalls at current and stale revisions.
- **Action**: User denies one, lets one expire, and submits one stale decision.
- **Expected**: Durable denied/expired/conflict states are visible; execution and continuation counts are zero.
- **Failure variant**: Network retry returns the original acknowledgement without another decision.
- **Evidence**: receiver DOM, Station readback, zero-execution artifact.
- **Status**: pending

##### AS-F4-03 Fenced execution rejection
- **Precondition**: One committed envelope and variants with wrong device, session, lease revision, claim, fence, payload, replay policy, execution deadline, and resource ref.
- **Action**: Deliver every variant to Desktop Rust.
- **Expected**: Only the exact envelope reaches PREPARED; every variant rejects before side effects.
- **Failure variant**: Old-fence result after takeover is audit-only.
- **Evidence**: Rust receipt ledger, rejection codes, Station audit, side-effect counter.
- **Status**: pending

##### AS-F4-04 Crash and restart reconciliation
- **Precondition**: Barriers before PREPARED, after PREPARED, and after APPLIED.
- **Action**: Terminate and restart the executor at each barrier.
- **Expected**: Before PREPARED may redispatch with a new fence; after PREPARED replays only Station-declared idempotent work with the exact key; non-idempotent ambiguity becomes UNKNOWN_SIDE_EFFECT; APPLIED never repeats.
- **Failure variant**: After lease expiry, a valid signed recovery before reconciliation deadline returns the original result acknowledgement and continuation ID on replay; a conflicting digest or revoked device key rejects.
- **Evidence**: durable receipts, Station ToolCall/result/continuation, side-effect counter, restart log.
- **Status**: pending

##### AS-F4-04A Multi-ToolCall batch barrier
- **Precondition**: One provider response emits two client-owned ToolCalls in the same ToolBatch.
- **Action**: Submit both terminal results in either order and replay the final result.
- **Expected**: No continuation exists after the first result; the second successful result creates exactly one `(turn_id, attempt_id, tool_batch_id)` continuation; replay returns the original acknowledgement.
- **Failure variant**: One member fails, is denied, expires, is cancelled, or becomes unknown; automatic continuation count remains zero.
- **Evidence**: ToolBatch membership, per-call results, continuation row, provider invocation count.
- **Status**: pending

##### AS-F4-05 Cancel, revoke, and timeout
- **Precondition**: ToolCalls paused before dispatch and after PREPARED.
- **Action**: Cancel the Turn, revoke the capability session, and advance the deadline in both orderings.
- **Expected**: Pre-dispatch produces zero side effects; post-dispatch settles as APPLIED, cancelled, failed, or UNKNOWN_SIDE_EFFECT according to the committed fence; no indefinite waiter remains.
- **Failure variant**: Late old-fence business result cannot change terminal state.
- **Evidence**: Station state, receipt ledger, cleanup result, side-effect counter.
- **Status**: pending

##### AS-F4-05A Lease and recovery authority
- **Precondition**: One active lease, one PREPARED ToolCall, and deterministic barriers around renew/revoke, execution deadline, recovery signature verification, and nonce/result CAS.
- **Action**: Execute renew-first/revoke-first, submit terminal receipts before and after both deadlines, replay an identical signed digest, submit a conflicting digest, and revoke the device signing key.
- **Expected**: Renewal changes only revision/expiry; revoke blocks new execution; valid recovery settles only matching PREPARED before reconciliation deadline; identical replay returns the original acknowledgement; conflicting/revoked/expired recovery creates no second result or continuation.
- **Failure variant**: Attempt PREPARED, pull, lease renewal, or new dispatch with the recovery credential; every attempt rejects. A late APPLIED fact against a cancelled/expired Turn cannot reopen its ToolBatch or continuation.
- **Evidence**: lease revisions, recovery credential/nonce row, verified-key state, ToolCall/result/continuation readback, side-effect counter.
- **Status**: pending

##### AS-F4-06 Usage, feedback, and diagnostic replay
- **Precondition**: A completed Turn with provider usage, one ToolCall, context sources, and user feedback.
- **Action**: Restart Desktop and request exact-turn usage, feedback, and diagnostic replay.
- **Expected**: Readback preserves exact Turn/attempt/tool lineage and terminal reason; replay equals Station facts and contains no secret, credential, local path, or disallowed PII.
- **Failure variant**: Cross-actor read returns authorization failure without metadata leakage.
- **Evidence**: receiver DOM, Station readback, redaction scan, replay equality report.
- **Status**: pending

##### AS-F4-07 Opaque resource reference
- **Precondition**: An authorized device-local file capability and opaque resource ref.
- **Action**: Execute through the fenced envelope and inspect every portable artifact.
- **Expected**: Rust resolves the local handle; Station and evidence retain only opaque refs/hashes.
- **Failure variant**: Expired or foreign-device ref rejects before execution.
- **Evidence**: Station readback, Rust authorization record, repository/evidence local-path scan.
- **Status**: pending

### G-F — Foundation Native Gate

**Depends on**: F1, F2, F3, F4.
**Owns**: the C01-C10/A01-A14 advancement decision, not implementation.
**Status**: in progress. Commits through `cb8652436` repaired the profile-owned
provider/model fixture, durable Station runtime authority, portable
attestation normalization, AS-F01 source-backed evidence roles, conversation
lifecycle authority, and the AS-F02 production queue/lifecycle probe. The
source-matched 2026-08-27 run
`20260827T032844432467Z-41d3cda5cf95768c9328b15de39b69b2` reached
`foundation-browser-direct / AS-F02 / en / single / sample-001`; the eight-entry
queue, cancellation, active-dependency guard, rename, archive, restore, and
delete actions completed, but the deliberately long active provider call hit
the 120-second request deadline. The harness then attempted runtime-attestation
readback for the failed Turn and received `turn trace not found`. The Gate
remains `PARTIAL / UNPROVEN`; cleanup passed. Commit `b9401a7e3` made queue
submission concurrent and rejected non-completed Turns before evidence
construction. Its source-matched rerun
`20260827T034717562603Z-456b774434d6ad952826a03261baf6c0` proved that the
20-item response request still consumed the full 120-second provider deadline
and now failed honestly as `turnSubmissionTimeout`. W1 stays blocked while
AS-F02 separates the queue workload from attestation: a long running Turn holds
the real admission window until the eight-entry queue and overflow are proven,
then the production cancel command settles it; an independent bounded `ready`
Turn in the same conversation must complete and provide the trace used for
runtime attestation. The source-matched `eafa75571` rerun
`20260827T035716041867Z-a6d1e4cce1aa822c6c8434df73daa8ac`
confirmed that using the bounded Turn for both duties instead let queued work
drain before the capacity snapshot and failed as
`queueCapacitySnapshotMismatch`. The source-matched `2801648ac` rerun
`20260827T040501845625Z-bd426c146ada6031b6d46676ae2a9285` then passed the
capacity snapshot and production cancel command; it exposed that Desktop
classifies the persisted `cancelled` stream event as a successful terminal
callback. AS-F02 therefore verifies the typed `cancelled` event rather than
incorrectly requiring the transport result to be an error. Its source-matched
`d39533d5d` rerun
`20260827T041813209061Z-d0377f0a2c9dbda1c9692849656d0f91` passed that check,
then exposed two coupled defects: provider completion remains nondeterministic
for the extra attestation Turn, and Station did not persist `TurnTrace` on the
cancel/error terminal path even though its attempt/runtime snapshot was
durable. The current fix persists terminal traces with a non-cancelled context
and uses the already-proven cancelled Turn for AS-F02 attestation, removing the
unnecessary second provider call. The source-matched `04dfd5084` run
`20260827T042720116767Z-86248accfaff35a32fc1841c4a55445e` completed AS-F02
and advanced to `foundation-browser-direct / AS-F03 / en / single /
sample-001`, where the direct-runtime adapter failed closed because AS-F03 is
not yet implemented. Cleanup passed; G-F remains `PARTIAL / UNPROVEN`.

```bash
test -n "${PT_ACCEPTANCE_ARTIFACT_ROOT:-}"
python3 tooling/scripts/acceptance-prove.py --gate agent-v2-kernel-foundation-e2e
```

The Gate emits independent C01-C10 cell results and all mandatory artifact
roles. W1 remains blocked unless every required cell is source-matching
`PROVEN`; a broad aggregate PASS is insufficient. It executes all applicable
§8.3 quantitative workloads. P12 and CLI non-advertisement cells on Desktop
and Browser are mandatory. No hidden-candidate, certification, promotion, or
advertised-runtime cell exists in this plan. W9 reruns this Gate after all V2
cutovers to prevent foundation regression.

### W1 — Capability Authority

**Depends on**: G-F foundation Gate `PROVEN`.
**Owns**: C12, D15, A16.

**Target roots**: Station Agent domain/service/persistence/handler packages,
`model/domain/agent/`, Desktop generated adapters, and capability projection
runtime tests.

Deliverables:

- Station Capability Manifest Registry.
- Versioned Agent Capability Binding Service.
- Admission-time Capability Readiness Snapshot.
- Actor ownership, expected-version conflict, manifest retirement.
- Source adapters for builtin/Skill/Knowledge/MCP/Connector/client capability.
- The rejected Custom HTTP Plugin entity is not a manifest source and cannot be
  auto-imported into Tool/MCP/Connector without a future accepted product and
  architecture mapping.

Staging and migration:

- Build and backfill the new authority without production consumers or
  dual-write.
- Record row counts, payload hashes, actor ownership, binding revisions, and
  rejected invalid legacy rows, including every embedded
  `store/agent.ts#chatConfig` Skill/Knowledge/MCP/Tool/Connector binding.
- Keep the new read/write entrypoints unreachable until W8. W1 does not switch
  consumers or delete the old path.

Checks:

```bash
(cd apps/station && go test ./app/subserver/agent/... -run 'CapabilityManifest|AgentCapabilityBinding|Readiness')
(cd apps/desktop && pnpm run check && pnpm run test)
tooling/scripts/review/agent-v2-old-paths.sh --inventory-only --closure C12
```

Final product Gate executed by W9: `agent-v2-capability-binding-e2e`.
Evidence: manifest/binding/snapshot rows, conflict/incompatibility results, and
the backfill reconciliation report.

### W2 — Home Projection

**Depends on**: W1.
**Owns**: C11, D14, A15.

**Target roots**: Home proto, Station Home projection/command handlers,
`apps/desktop/src/runtimes/homeRuntime.ts`,
`apps/desktop/src/pages/HomePage*.tsx`, and browser-gateway contract tests.

Deliverables:

- Station `HomeWorkProjection` with revision, slice freshness/errors.
- Atomic `CreateConversationAndSubmitTurn`.
- Idempotent `CreateAndStartAgentTask`.
- Desktop `homeRuntime`; Home page becomes a pure renderer.
- Browser uses the same Station commands/projection.

Failure behavior:

- stale/partial retains accepted work and blocks unsafe commitment.
- duplicate payload returns original IDs; mismatch returns conflict.
- actor/Station switch clears prior projection.
- network/Station loss preserves accepted slices; invalid Chat/Task input
  leaves the draft editable; timeout/cancel is authoritative and bounded.

Cutover preparation:

- Identify page-owned durable recents/Brief/readiness aggregation and mock
  success paths for W8 deletion; W2 does not activate a second live source.

```bash
(cd apps/station && go test ./app/subserver/agent/... -run 'HomeProjection|CreateConversationAndSubmitTurn|CreateAndStartAgentTask')
(cd apps/desktop && pnpm run test -- homeRuntime)
tooling/scripts/review/agent-v2-old-paths.sh --inventory-only --closure C11
```

Final product Gate executed by W9: `agent-v2-home-command-center-e2e`.
Evidence: Native and Browser DOM, projection revision/slice errors, Chat/Task
command IDs, Station topic/task rows, restart and actor-switch readback, and
R-11 both-ordering artifacts.

### W3 — Capability Operation Substrate

**Depends on**: W1.
**Owns**: shared substrate for C13/C14 and D16/D17.

**Target roots**: capability operation proto, Station operation/outbox/lease
domain-service-persistence packages, Desktop Rust capability executor, and
deterministic barrier fixtures.

Deliverables:

- Station operation aggregate, transactional outbox, event cursor.
- Business lease and independent cleanup lease fencing.
- all-outcome cleanup settlement and cleanup deadline.
- Receipt recovery credential/nonce/signature validation.
- client capability executor reporting and resource cleanup.

Failure behavior:

- old fence and duplicate sequence rejected.
- non-idempotent ambiguity becomes `UNKNOWN_SIDE_EFFECT`.
- unreachable cleanup ends `cleanup_failed`; never hangs.

Checks:

```bash
(cd apps/station && go test ./app/subserver/agent/... -run 'CapabilityOperation|CleanupLease|Receipt')
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml capability_operation
```

Done: deterministic unit/integration barriers cover R-01 through R-04 and
actor/device/session/lease mismatch; runtime proof remains `UNPROVEN` until the
owning W4/W6 Gates execute.

### W4 — MCP Lifecycle

**Depends on**: W3 for W4a; W6 for W4b invocation closure.
**Owns**: C13, D16, A17.

**Target roots**: Station CapabilityOperation MCP adapter, Desktop Rust MCP
manager/commands, Desktop MCP projection UI, disposable MCP fixture, and
process/port/secret canaries.

Deliverables:

- install/configure/test/connect/reconnect/uninstall as CapabilityOperation.
- local MCP process/secret remains Desktop Rust owned.
- invoke uses canonical ToolCall, not operation.
- cancellation, timeout, process/port/secret cleanup and restart reconciliation.

Cutover preparation:

- Identify client-only terminal/progress truth for W8 deletion.
- Retain client-local MCP configuration only as executor input.

```bash
(cd apps/station && go test ./app/subserver/agent/... -run 'MCPCapabilityOperation')
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml mcp_capability_operation
tooling/scripts/review/agent-v2-old-paths.sh --inventory-only --closure C13
```

Final product Gate executed by W9: `agent-v2-mcp-lifecycle-e2e`.
W4a is complete when lifecycle mutation/recovery tests pass. W4b is complete
only after a real canonical ToolCall invocation passes through W6 and the
process/port/secret cleanup artifacts are clean.

### W5 — Connector Resource Tools

**Depends on**: W1 and W3 for W5a; W6 for W5b invocation closure.
**Owns**: C14, D17, A18.

**Target roots**: Station OAuth/resource-manifest adapters, capability manifest
and binding services, Desktop Connector projection UI, approved disposable
OAuth fixture, and provider-revoke barriers.

Deliverables:

- OAuth connection/revision owner.
- scoped Connector resource manifests and tool versions.
- Agent binding to manifest IDs.
- normal disconnect and force security revoke semantics.
- provider revoke retry and `revocation_unconfirmed`.

Cutover preparation:

- Identify `enabledTools`/Connector labels used as readiness or binding truth
  for W8 deletion.
- Never move OAuth tokens into Agent/Tool contracts.

```bash
(cd apps/station && go test ./app/subserver/agent/... -run 'ConnectorResourceManifest|OAuthRevision|ProviderRevoke')
(cd apps/desktop && pnpm run test -- agentConnectors)
tooling/scripts/review/agent-v2-old-paths.sh --inventory-only --closure C14
```

Final product Gate executed by W9: `agent-v2-connector-invocation-e2e`.
W5a is complete when resource/version/revocation behavior passes. W5b is
complete only when a real W6 ToolCall produces one result/trace and expiry,
disconnect, resource removal, and provider-revoke timeout remain recoverable.
Evidence includes R-06 both-ordering artifacts.

### W6 — Governed ToolCall Fencing

**Depends on**: W1, W3.
**Owns**: C12/C13, D15/D16, A19.

**Target roots**: canonical ToolCall proto, Station decision/claim/outbox/
receipt/result services and persistence, Desktop Rust executor receipt store,
Desktop approval projection, and deterministic side-effect counter fixture.

Deliverables:

- unique decision, claim, outbox envelope, fenced receipt attempts, result.
- PREPARED/APPLIED durable receipt and external idempotency key.
- dispatch/cancel/revoke/delete linearization.
- idempotent replay or `UNKNOWN_SIDE_EFFECT`.
- exactly-one result-to-model continuation.

Cutover preparation:

- Identify the Desktop in-memory approval registries and unfenced local
  ToolCall dispatch for W8 deletion.

```bash
(cd apps/station && go test ./app/subserver/agent/... -run 'ToolCall|ExecutionClaim|SideEffectReceipt|DispatchFence')
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tool_call_receipt
tooling/scripts/review/agent-v2-old-paths.sh --inventory-only --closure C12,C13
```

Final product Gate executed by W9: `agent-v2-governed-tool-loop-e2e`.
Evidence: one decision/claim/result lineage, PREPARED/APPLIED receipts, both
race orderings R-03/R-05/R-07, counter <=1, replay equality, and typed
`UNKNOWN_SIDE_EFFECT`.

### W7 — Evaluation Aggregate

**Depends on**: W0, W1, W6.
**Owns**: C15, D18, A20.

**Target roots**: Evaluation proto, Station Evaluation domain/service/
persistence/handler packages, canonical Turn integration, Desktop Evaluation
projection runtime/UI, and scheduler/cancel/retry barrier fixtures.

Deliverables:

- Station benchmark/dataset/test-case/run/attempt/result/metrics aggregate.
- command-scoped idempotency and scheduler claim uniqueness.
- canonical Turn execution for each case.
- cancel-intent CAS, ACK deadline, typed partial fallback.
- terminal parent + child retry run with source lineage.
- atomic terminal metrics/version/comparability.

Cutover preparation:

- Backfill dataset truth without activating a second live write path.
- Identify Evaluation localStorage run/result and `quickCompletion` execution
  for W8 deletion.

```bash
(cd apps/station && go test ./app/subserver/agent/... -run 'Evaluation|SchedulerClaim|CancelIntent|ChildRetry')
(cd apps/desktop && pnpm run test -- evaluationRuntime)
tooling/scripts/review/agent-v2-old-paths.sh --inventory-only --closure C15
```

Final product Gate executed by W9: `agent-v2-evaluation-lab-e2e`.
Evidence: dataset/run/attempt/result/Turn rows, R-08 through R-10 barrier facts,
atomic terminal metrics, child lineage, restart/actor isolation, and deletion
retention results.

### W8 — Desktop And Browser Consumer Cutover

**Depends on**: W2, W4b, W5b, W6, W7.

**Owns**: the single activation, migration verification, consumer switch, and
old-authority deletion for C11-C15.

**Target roots**: C11-C15 consumers in §3.1, including
`store/agent.ts#chatConfig`; Desktop runtime/page/component registries, browser
gateway, `packages/locales/{en,zh-CN}/agent.json`; rejected Custom Plugin
page/store/navigation/localStorage/direct-fetch files plus Model/Station
proto/CRUD/persistence/table roots; prototype synchronization; and operational
knowledge entries covering changed paths.

Deliverables:

- Production UI conforms to confirmed prototype and UI Identity.
- Runtime descriptors own Home/capability/Evaluation projections.
- Home, Agent Profile, Tool cards, MCP, Connector, Evaluation use canonical
  contracts only.
- `store/agent.ts`, Agent Sidebar/Profile, Connector binding, and diagnostics
  no longer read or write embedded Skill/Knowledge/MCP/Tool/Connector binding
  truth from `chatConfig`.
- Retire the rejected Custom HTTP Plugin product: unregister and delete its
  page/command/navigation surface, purge `peers-ai-custom-plugins` without
  logging/copying `authValue`, remove direct arbitrary `fetch`, delete
  `CustomPlugin*` proto/generated types and Station CRUD/handler/service/model/
  route/table ownership, and remove its locale keys.
- Browser unavailable device-local capabilities degrade before commitment.
- Every ERR/D11 receiver renders the planned locale key and safe arguments in
  both English and Simplified Chinese; Gate DOM records locale, key, and
  rendered text.
- component-tree registry and prototype synchronization updated.

Atomic activation:

1. Freeze mutable legacy binding/Evaluation writes and all Custom Plugin
   create/update/test/direct-fetch paths for the migration window.
2. Backfill and compare actor-scoped counts, IDs, payload hashes, revisions,
   tombstones, retained historical snapshots, and embedded `chatConfig`
   bindings.
3. Record Custom Plugin actor-scoped row/key counts and non-secret metadata
   hashes only. Automatic import is forbidden because no accepted successor
   mapping exists.
4. Activate canonical Station reads/writes and Desktop/Browser projections in
   one versioned deployment.
5. Drain or fence active legacy ToolCalls/operations; no in-flight item changes
   owner without a durable claim/receipt outcome.
6. Irreversibly purge the Custom Plugin localStorage credential key and Station
   rows/table, then delete its page/store/proto/generated/CRUD/persistence
   paths and every other old authority in the same closure.
7. Rollback is permitted only before step 6. After secret/data purge begins,
   the deployment is roll-forward-only; no compatibility or credential backup
   is retained.

Checks:

```bash
(cd apps/desktop && pnpm run check && pnpm run test && pnpm run build)
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
(cd apps/mobile && pnpm run check && pnpm run test:agent-contract)
tooling/scripts/review/agent-v2-old-paths.sh
node tooling/scripts/check-agent-v2-locales.mjs
! rg -n 'custom-plugins|CustomPlugins|customPlugins|CustomPlugin|ecosystem/plugin|ecosystem_custom_plugins|peers-ai-custom-plugins' \
  apps/desktop/src apps/station/app/subserver/agent model/domain/agent packages/locales
```

Done:

- Tree-wide search finds no live consumer of deleted truth.
- Seeded Custom Plugin local credential and Station-row fixtures are purged;
  old page/command/route access fails, direct network count is zero, and no
  secret appears in logs/evidence.
- Product states cover default/narrow/light/dark/error/recovery.
- Migration reconciliation is exact or explicitly fails; historical snapshots
  and tombstones remain readable under `data-model.md §6`.
- Browser preserves all Station-backed outcomes; Mobile shared-contract tests
  reject unsupported local capabilities before commitment.

### W9 — Native Acceptance, Deletion, Cleanup, Final Audit

**Depends on**: W8.

**Target roots**: seven Agent Gate runners/contracts, race fixtures, Acceptance
Evidence Store, brain-map overlay, plan anchor, and cleanup/leak audit.

Deliverables:

- Foundation plus six V2 Gates run with their required Native/Browser/
  contract cells, receiver DOM, and Station readback.
- race barriers run in both orderings with side-effect counts and cleanup.
- §8.3 workloads meet every accepted threshold with all failed/cold samples.
- actor/device isolation and Browser compatibility cells.
- D11 Canvas Web/Station guards reject every run path with zero provider/task
  execution; W9 does not remove the guard.
- English and Simplified Chinese receiver DOM covers all 55 BASE/ERR/D11 locale
  keys plus every non-`none` recovery-action key with safe arguments.
- runtime evidence outside source tree via Acceptance Evidence Store.
- old paths deleted and no process/port/secret/debug instrumentation leak.
- `AS-16-CUSTOM-PLUGIN-RETIREMENT` proves the rejected page, credential key,
  arbitrary HTTP path, proto/CRUD routes, persistence model, and table are gone.
- brain-map overlay and Context Anchor updated only from Gate evidence.

Checks:

```bash
set -euo pipefail
make acceptance-validate DOMAIN=agent
test -n "${PT_ACCEPTANCE_ARTIFACT_ROOT:-}"
proof_tmp="$(mktemp -d)"
trap 'rm -rf "$proof_tmp"' EXIT
for gate in \
  agent-v2-kernel-foundation-e2e \
  agent-v2-home-command-center-e2e \
  agent-v2-capability-binding-e2e \
  agent-v2-governed-tool-loop-e2e \
  agent-v2-mcp-lifecycle-e2e \
  agent-v2-connector-invocation-e2e \
  agent-v2-evaluation-lab-e2e
do
  python3 tooling/scripts/acceptance-prove.py \
    --gate "$gate" \
    --proof-envelope-ref-out "$proof_tmp/$gate.json"
done
python3 tooling/scripts/acceptance-proof-set.py \
  --proof-envelope-ref-file "$proof_tmp/agent-v2-kernel-foundation-e2e.json" \
  --proof-envelope-ref-file "$proof_tmp/agent-v2-home-command-center-e2e.json" \
  --proof-envelope-ref-file "$proof_tmp/agent-v2-capability-binding-e2e.json" \
  --proof-envelope-ref-file "$proof_tmp/agent-v2-governed-tool-loop-e2e.json" \
  --proof-envelope-ref-file "$proof_tmp/agent-v2-mcp-lifecycle-e2e.json" \
  --proof-envelope-ref-file "$proof_tmp/agent-v2-connector-invocation-e2e.json" \
  --proof-envelope-ref-file "$proof_tmp/agent-v2-evaluation-lab-e2e.json" \
  --proof-set-ref-out "$proof_tmp/proof-set-ref.json" \
  --proof-set-sha-out "$proof_tmp/proof-set.sha256"
python3 tooling/scripts/acceptance-validate.py \
  --validate-agent-v2-proof-set \
  --proof-set-ref-file "$proof_tmp/proof-set-ref.json" \
  --proof-set-manifest-sha256 "$(cat "$proof_tmp/proof-set.sha256")"
python3 tooling/scripts/review/agent-d11-entrypoints.py
node tooling/scripts/check-agent-v2-locales.mjs
tooling/scripts/review/hard-rules.sh
trap - EXIT
rm -rf "$proof_tmp"
```

Final readiness:

- all nine MCA-V2 composite capabilities `PROVEN`;
- every C01-C10 foundation cell is current-HEAD `PROVEN`;
- brain-map overlay 9/9;
- no aggregate false positive;
- completion auditor passes.

## 7. Atomic Cutover Matrix

F1-F4 own the C01-C10 foundation cutovers. W8 owns every C11-C15 activation and
deletion below. W1-W7 may create unreachable target implementations and
backfill data, but may not activate a second live read/write authority.

| Concern | New truth | Migration and in-flight rule | Old path deleted | Cutover proof |
|---|---|---|---|---|
| Agent/config/conversation (F1) | Station Agent/config/conversation/message/queue/branch | freeze local mutation; reconcile actor/version/lineage; accepted turns drain against Station IDs | Desktop Rust `ChatStore`, actor buckets, local durable topic/message/config | restart/readback, duplicate first turn, queue/branch cells, scoped tree search |
| Runtime/stream/recovery (F2) | Station runtime/TurnEvent/SSE cursor plus platform-neutral client session | old App/Browser turns drain on old deployment; new deployment accepts Station SSE only; no event crosses source epoch | Browser one-shot Agent fallback, Desktop provider/CLI authority, ephemeral-only projection | App/Browser progressive timestamps, cancel/replay equality, zero old-path caller |
| Context/resources (F3) | Station ContextLedger and opaque resource refs | historical turns without ledger remain explicitly unknown; new turns require ledger; legacy local paths are rejected/redacted | untyped prompt-only attribution and local-path/metadata-only resource identity | fixed source cases, auth/model rejects, restart readback, leakage scan |
| Capability/portability (F2) | fresh runtime snapshot and client capability session | expire old device leases at cutover; new admission pins snapshot/session revision | provider-name inference and Desktop-specific shared contract fields | Desktop/Browser/Mobile contract cells and zero hidden dispatch |
| Tool policy/observability (F4) | Station policy/decision/trace/usage/feedback + toolRuntime projection + fenced Rust execution ingress | pre-cutover calls drain or cancel; no call changes owner; new calls require Station decision/trace before executable dispatch | Web/chat approval authority, Rust registry/waiter, Desktop-specific shared contract, unfenced continuation, client-only diagnostics | auto/manual/deny/expiry, one result, usage/feedback/replay/redaction |
| Home | Station Home projection | no durable backfill; first projection is rebuilt from canonical Agent/topic/task sources; actor switch clears prior revision | page/store durable aggregation and mock Brief success | restart/readback, partial-slice and actor-switch cells, scoped tree search |
| Binding/readiness | Manifest/Binding/Snapshot | freeze legacy mutation; backfill actor/version/hash; reject invalid rows; no dual-write | embedded arrays/config JSON authority and parallel readiness selectors | exact reconciliation, version conflict, incompatible pre-admission reject, scoped tree search |
| Rejected Custom HTTP Plugin | none; accepted Tool/MCP/Connector authorities remain the only extension boundaries | freeze all mutations/tests; record actor-scoped non-secret counts/hashes; no auto-import; purge local credentials and Station rows/table at the irreversible cutover boundary | Desktop page/container/descriptor/store/navigation/command/locale/direct fetch/localStorage key; Model proto/generated types; Station routes/handlers/service/model registration/persistence/table | `AS-16-CUSTOM-PLUGIN-RETIREMENT`, zero network call, localStorage canary absent, route/page unavailable, DB migration readback, zero symbol search |
| MCP operation | Station operation + client executor | new operations use Station only after activation; pre-cutover local operations drain or are cancelled and cleanup-audited | client-only terminal/progress authority; local process/config executor retained | cancel/reconnect/takeover/cleanup proof and no leaked process/port/secret |
| Connector tools | OAuth owner + resource manifests + binding | pin connection/resource revision; pre-dispatch items reject stale revision; post-dispatch items settle under W6 fence | `enabledTools`/labels as readiness or binding identity | expiry/revoke/invocation cells, provider-revoke outcome, scoped tree search |
| ToolCall | fenced decision/claim/receipt/result | pre-cutover calls drain; no call changes owner without a durable claim; unresolved non-idempotent work becomes `UNKNOWN_SIDE_EFFECT` | residual non-toolRuntime approval projection and unfenced local dispatch; Rust waiter already deleted by F4 | all crash/race barriers, counter <=1, replay equality, scoped tree search |
| Evaluation | Station aggregate + canonical Turn | freeze legacy mutation; backfill datasets; old terminal runs remain read-only historical snapshots; active local runs are cancelled and never imported as terminal truth | localStorage run/result and `quickCompletion` execution | cancel/retry/restart/isolation/deletion cells, exact backfill report, scoped tree search |

Rollback uses version-control/deployment rollback. No permanent dual write/read
path is accepted.

The tree-search report records every match with one disposition:
`deleted-authority`, `retained-local-executor`, `historical-migration-reader`,
`test-fixture`, or `unresolved`. Any `unresolved` match fails W8/W9. A raw
zero-match assertion is invalid where the accepted design retains local MCP
configuration/process ownership.

## 8. Acceptance Scenarios

All statuses start `pending`. Execution records external Evidence Store paths.

### AS-F01 Agent Readiness And Config
- **Precondition**: Actor has configurable Direct Model; missing-credential, unavailable-model, and unsupported vision/tool/reasoning fixtures.
- **Action**: Save Agent/model, refresh readiness, restart, and switch actor/device.
- **Expected**: `UNKNOWN -> CHECKING -> READY/DEGRADED/BLOCKED` follows Station facts; versioned config survives restart.
- **Failure variant**: Missing credential/unavailable model blocks send; stale version conflicts; no cross-actor config.
- **Evidence**: Native DOM, Station config/readiness rows, zero provider execution on block.
- **Status**: pending

### AS-F02 Topic, Composer, Queue, And First Turn
- **Precondition**: New local draft with valid/invalid input and bounded queue fixture.
- **Action**: Validate and submit, force duplicate, queue follow-ups, overflow, reject/retry, then rename, archive, recover, and explicitly delete.
- **Expected**: Topic/composer transitions preserve draft until Station acceptance; queued intent retains position/controls; archive/delete follows retention and dependency rules.
- **Failure variant**: Invalid input creates no topic; queue overflow is visible; rejected submit restores editable input; active dependency blocks delete.
- **Evidence**: Native DOM, Station topic/message/queue rows, command IDs, duplicate counts.
- **Status**: pending

### AS-F03 Progressive Turn, Tool Waits, And Terminals
- **Precondition**: Delayed provider and tool/approval fixtures.
- **Action**: Stream a turn through waiting approval/tool/compression/retry states; cancel during text, approval, and tool waits.
- **Expected**: Progressive events and exactly one authoritative completed/partial/failed/cancelled/interrupted terminal state.
- **Failure variant**: Provider timeout/rate limit/retry exhaustion stays typed; transport loss alone never marks failed.
- **Evidence**: Native/Browser DOM, raw event timestamps/sequences, provider cancel, Station Turn/Trace.
- **Staged proof amendment**: pre-W1 G-F proves ordered progressive text,
  production cancellation during text, one authoritative cancelled terminal,
  and durable Station Turn/Attempt/Trace readback. Tool/approval waits and
  cancellation remain mandatory W6 evidence because governed ToolCall
  decision/claim/result authority does not exist before W1/W3/W6. This changes
  dependency ownership only; it does not remove or reduce any of the 419
  Foundation tuples or final quantitative workloads.
- **Status**: pending

### AS-F04 Tool Policy Auto, Manual, Deny, And Expiry
- **Precondition**: Safe auto-approved tool, manual-risk tool, and deny policy.
- **Action**: Trigger each policy, approve/deny once, allow one decision to expire, and force duplicate delivery.
- **Expected**: `POLICY_CHECK -> AUTO_APPROVED/AWAITING_USER`; manual approval executes once; deny/expiry executes zero.
- **Failure variant**: Executor disconnect/timeout/cancel remains terminal and recoverable; loop budget stops repeated calls.
- **Evidence**: DOM, policy/decision/execution/result rows, side-effect counter, replay equality.
- **Status**: pending

### AS-F05 Attachment And Resource Admission
- **Precondition**: Valid PNG/PDF plus oversized, unsupported, unauthorized, and failed-upload fixtures.
- **Action**: Select, validate, upload, attach, remove/retry one failure, send, restart, and reopen.
- **Expected**: Valid opaque refs progress to ready/attached/consumed or explicit omitted; valid siblings survive one failure.
- **Failure variant**: Invalid/unauthorized resources reject before provider call and never expose local paths.
- **Evidence**: Composer DOM, object/resource rows, model-visible trace, zero provider execution for rejected refs.
- **Status**: pending

### AS-F06 Disconnect, Replay, And Recovery
- **Precondition**: Accepted streaming turn and acknowledged cursor.
- **Action**: Drop connection, switch page, restart Desktop/Station, replay, and force replay failure/retry.
- **Expected**: `CONNECTION_LOST -> RECONNECTING -> REPLAYING -> RECONCILING -> CONNECTED`; projection remains idempotent.
- **Failure variant**: Recovery failure offers retry/snapshot reload and cannot overwrite a newer revision.
- **Evidence**: App/Browser DOM, cursor/event rows, replay equality, terminal readback.
- **Status**: pending

### AS-F07 Retry, Regenerate, Edit, And Branch
- **Precondition**: Completed and failed turns with feedback/usage references.
- **Action**: Retry failure, regenerate twice, edit/resend user message, and switch active branch.
- **Expected**: Retry is an attempt; regenerate/edit create immutable siblings; original content/usage/feedback remains.
- **Failure variant**: Stale branch mutation conflicts; delete is never represented as retry/regenerate.
- **Evidence**: DOM branch selector, Station lineage/active-branch rows, independent usage/feedback.
- **Status**: pending

### AS-F08 Context Attribution And Omission
- **Precondition**: Fixed memory, Skill, Knowledge, history, and token-budget fixtures.
- **Action**: Run ten turns carrying fixed early facts, force history compression after turn six, repeat the final turn twice, disable one source, and exceed context budget.
- **Expected**: Turn ten recalls pre-compression facts; ContextLedger identifies the compression source/snapshot, retained facts, exact source IDs, token accounting, and typed truncation/omission deterministically.
- **Failure variant**: Disabled/unauthorized source is absent; ledger redaction exposes no secrets.
- **Evidence**: Source-detail DOM, ContextLedger/Turn rows, fixed-answer assertions.
- **Status**: pending

### AS-F09 Usage, Feedback, And Diagnostic Replay
- **Precondition**: Terminal turn with context/tool activity.
- **Action**: Inspect usage/source details, submit feedback, restart, and export diagnostics.
- **Expected**: Exact-turn usage/feedback persists; redacted export reconstructs events/context/tool lineage.
- **Failure variant**: Missing runtime facts remain unknown/partial; secrets, credentials, and local paths are absent.
- **Evidence**: DOM, Station usage/feedback/trace rows, redaction scan, replay equality.
- **Status**: pending

### AS-F10 Platform Capability Contract
- **Precondition**: Desktop, Browser, and Mobile capability sessions with distinct local abilities.
- **Action**: Execute Station-backed commands and request shell/stdio MCP/local work on each platform.
- **Expected**: Core command/event outcomes match; unsupported local capability rejects before commitment; selected device owns local execution.
- **Failure variant**: No Desktop fallback or cross-device lease/result acceptance.
- **Evidence**: Desktop/Browser DOM, Mobile executable contract tests, readiness/session rows, zero hidden dispatch.
- **Status**: pending

**DESIGN_AMENDMENT (2026-08-25) — unsupported/schemaMismatch production proof path**:

The only non-fabricated production path for `unsupported` and `schemaMismatch`
capability rejection is:

1. Native Gate runtime sends a real Agent conversation message.
2. Station provider returns a response containing a ToolCall.
3. Station `ProposeBatch` checks the client capability advertisement.
4. The requested ToolCall capability is either absent from the advertisement
   (`REJECTED_UNSUPPORTED`) or its schema version does not match
   (`REJECTED_SCHEMA_MISMATCH`).
5. Station marks the ToolCall with the rejection status in ProposeBatch.
6. Client reads the rejection via `TurnDiagnosticReplay` ToolCall status.

This path requires W6 (Governed ToolCall Fencing, Action 18+) to land the
ProposeBatch capability-check logic. No external endpoint currently triggers it.

Consequence:
- `unsupported` and `schemaMismatch` sub-assertions are deferred to post-W6.
  They do not block the current G-F gate for the remaining tuples.
- The 3 already-proven emitters (`unauthorized`, `signatureTamper`,
  `crossDevice`) plus `zeroExecutionOnReject` proceed in-gate.
- Oracle/probe treat these two sub-assertions as `None` (deferred) when the
  capture reports `availability: "unavailable"` with
  `unavailable_reason: "NO_PRODUCTION_CAPABILITY_ENDPOINT"`.

### AS-F11 Conditional External Agent Runtime
- **Precondition**: Read Station effective provider/model projection, D12 profile, and D05 readiness snapshot for P12 `EXTERNAL_AGENT`.
- **Action**: Run `AS-F11-NON_ADVERTISED` on Desktop and Browser; query the effective profile/readiness APIs and every runtime selector.
- **Expected**: P12 is absent from advertised profile/readiness and selectors; no runtime home, external session, process, or workspace is created.
- **Failure variant**: Any selectable/runtime-ready P12 entry or hidden dispatch fails the Gate and requires PRODUCT/DESIGN/PLAN amendment rather than in-plan promotion.
- **Evidence**: Desktop/Browser selector DOM, profile/readiness API readback, and zero runtime-home/session/process/workspace creation.
- **Status**: pending

### AS-F12 Two-Topic Restart Isolation
- **Precondition**: Two new topics under one actor, each with a distinct code word and active response branch.
- **Action**: Interleave turns in both topics, switch active branches independently, restart Station and Desktop, then reopen each topic.
- **Expected**: Each topic restores only its own messages/fact/runtime binding and the same active branch; no ID, message, context, branch, or runtime-home/session crosses topics.
- **Failure variant**: Inject a stale topic/branch revision; mutation conflicts without altering either topic.
- **Evidence**: Native DOM before/after restart, Station conversation/message/branch/runtime-binding rows, zero cross-topic references.
- **Status**: pending

### AS-F13 Conditional Stateless CLI Adapter
- **Precondition**: Read Station effective provider/model projection, D12 profile, and D05 readiness snapshot for the actor.
- **Action**: Run `AS-F13-NON_ADVERTISED` for registered-but-catalog-disabled `trae-cli` on Desktop and Browser; query effective provider/model/profile/readiness APIs and selectors.
- **Expected**: Registry/provider-list presence alone makes no claim; `trae-cli` remains absent from advertised readiness and selectors, with zero process start.
- **Failure variant**: Any selectable/runtime-ready CLI entry, Desktop-local execution, or hidden dispatch fails the Gate and requires PRODUCT/DESIGN/PLAN amendment.
- **Evidence**: Provider/model/profile/readiness readback, Desktop/Browser absent-selector DOM, and zero CLI process/Turn attempt.
- **Status**: pending

### AS-D11 Canvas Downstream Guard
- **Precondition**: Current Canvas route exists while orchestration still bypasses canonical TurnService.
- **Action**: Open Canvas and attempt Run/desktop claim; call Browser gateway resume and verify typed forwarding; bypass Web and exercise exact generic/official Atelier create/resolve/rerun, collaboration interrupt resolve, boot recovery, resume, node-result submission, desktop-executor claim/report, scheduler supervisor dispatch, Tick, Sweep, transaction helper, and shared execution starters; separately exercise message/status nonexecution mutations, Tauri subscribe/cancel-stream, cancel, release, and purge.
- **Expected**: Browser resume routes to resume, never cancel; Web shows typed single-Agent-readiness blocker; every execution-producing path rejects before scan/claim/transaction/first mutation with the same stable code; provider/CLI/task/node/lease/rerun creation counts remain zero; message/status mutate only their declared event/meta rows with no start edge; subscribe/cancel-stream and cleanup paths succeed.
- **Failure variant**: Any Canvas task/provider execution before a future accepted canonical-kernel migration fails the Gate.
- **Evidence**: Canvas blocked DOM, gateway command/input/target trace, Station rejection/audit, zero task/provider calls.
- **Status**: pending

### AS-01 Home Chat Idempotency
- **Precondition**: Ready Agent; no topic.
- **Action**: User submits the same Chat intent twice through a forced duplicate.
- **Expected**: One conversation/Turn; both responses return identical IDs.
- **Failure variant**: Same key/different payload returns conflict and preserves draft.
- **Evidence**: Native DOM + Station rows + command IDs.
- **Status**: pending

### AS-02 Home Task And Recovery
- **Precondition**: Fresh actor first sees an empty Home; then a ready projection is available.
- **Action**: User opens empty state, cancels one pending create, creates Task, restarts Desktop, and reopens Home.
- **Expected**: Empty state exposes a useful Chat/Task action; one Task/run and restored recent/Brief/task state.
- **Failure variant**: cancelled create leaves no Task and preserves intent; stale projection retains accepted work and blocks submit.
- **Evidence**: Native DOM before/after restart + Station Task readback.
- **Status**: pending

### AS-03 Capability Binding
- **Precondition**: Versioned manifest exists.
- **Action**: User binds it to an Agent.
- **Expected**: Binding revision and readiness read back.
- **Failure variant**: stale expected version conflicts; incompatible runtime rejects before execution.
- **Evidence**: DOM + Station manifest/binding/snapshot.
- **Status**: pending

### AS-04 MCP Lifecycle
- **Precondition**: Disposable MCP package and clean process state.
- **Action**: Install, test, connect, invoke, cancel, reconnect, uninstall.
- **Expected**: Operation states and one ToolCall result are authoritative.
- **Failure variant**: timeout/disconnect/cleanup failure remains visible; no leaked process/port/secret.
- **Evidence**: DOM + operation/ToolCall readback + process/port/secret canary.
- **Status**: pending

### AS-04-UNAVAILABLE Browser/Mobile Local MCP Degradation
- **Precondition**: Browser or Mobile capability session advertises no local process, shell, or stdio MCP executor.
- **Action**: Resolve an Agent binding that requires local MCP, then attempt test/connect/invoke before commitment.
- **Expected**: Browser renders typed unavailable/degraded state; Mobile contract returns the same stable unavailable outcome; Station creates no CapabilityOperation, claim, ToolCall, or local dispatch.
- **Failure variant**: Desktop fallback, synthetic success, hidden process start, or a committed operation fails the cell.
- **Evidence**: Browser DOM or Mobile contract-test output, capability/readiness snapshot, Station zero-row readback, and process/port/secret zero canary.
- **Status**: pending

### AS-05A Governed Tool Decision And Terminal Result
- **Precondition**: Ready bounded tool with manual approval policy.
- **Action**: User triggers proposal, approves once, then repeats with deny and approval-expiry fixtures.
- **Expected**: One durable decision and at most one execution/result per ToolCall; model continues only after authoritative result.
- **Failure variant**: denial, expiry, invalid arguments, timeout, and cancellation remain typed terminal outcomes with no hidden retry.
- **Evidence**: Native approval/result DOM, Station decision/claim/result rows, side-effect counter, Turn continuation.
- **Status**: pending

### AS-05 ToolCall Crash Fencing
- **Precondition**: Deterministic side-effect counter tool.
- **Action**: Crash before decision commit; after durable decision before claim; after atomic claim+outbox; at PREPARED-before-effect; external-effect-succeeded-before-APPLIED; after durable APPLIED; and after result-before-continuation.
- **Expected**: Side-effect count <=1; one decision/claim/result; post-effect/pre-APPLIED handling differs only by the declared external idempotency contract.
- **Failure variant**: Non-idempotent ambiguous crash becomes `UNKNOWN_SIDE_EFFECT` and cannot retry.
- **Evidence**: Station ledger, executor receipt, counter, replay output.
- **Status**: pending

AS-05 crash cells use final counts after all allowed recovery/reconciliation.
Any lower successful count, including a no-op recovery, fails.

| Cell | Forced crash barrier | decision | claim | outbox | PREPARED | APPLIED | UNKNOWN | effect | result | continuation |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| CR-00 | before approval decision commit | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 |
| CR-01 | decision durable before atomic claim+outbox | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 |
| CR-02 | claim+outbox durable before delivery | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 |
| CR-03 | PREPARED durable before effect starts | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 |
| CR-04N | non-idempotent effect succeeds before APPLIED | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 0 | 0 |
| CR-04I | idempotent effect succeeds before APPLIED | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 |
| CR-05 | APPLIED durable before result report | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 |
| CR-06 | result durable before model continuation | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 |

### AS-06 Connector Invocation
- **Precondition**: Approved disposable OAuth fixture.
- **Action**: Discover resource, bind tool, invoke through a real turn.
- **Expected**: One manifest version, ToolCall, result, and trace.
- **Failure variant**: expiry/disconnect/provider revoke timeout disables locally and shows recovery.
- **Evidence**: DOM + OAuth/resource/manifest/binding/ToolCall readback.
- **Status**: pending

### AS-07 Evaluation Success
- **Precondition**: Benchmark/dataset/cases and ready Agent.
- **Action**: Start run and wait for all cases.
- **Expected**: Terminal results and atomically frozen comparable metrics.
- **Failure variant**: invalid dataset/target snapshot rejects before scheduling.
- **Evidence**: DOM + run/attempt/result/Turn/Trace readback.
- **Status**: pending

### AS-08 Evaluation Cancel And Retry
- **Precondition**: Running Evaluation.
- **Action**: Cancel at case-completion barrier, then retry failed/partial cases.
- **Expected**: Cancel intent blocks completion; parent immutable; child run links source attempts/results.
- **Failure variant**: missing ACK reaches bounded typed partial; never hangs.
- **Evidence**: Station fences/ACKs/metrics + DOM + child lineage.
- **Status**: pending

### AS-09 Revocation And Deletion Races
- **Precondition**: Active MCP/Connector ToolCall.
- **Action**: Revoke device/OAuth or delete binding/manifest before and after dispatch commit.
- **Expected**: deterministic oracle from design §23.1; no stale admission or repeat side effect.
- **Failure variant**: unreachable receipt/cleanup becomes UNKNOWN/cleanup_failed.
- **Evidence**: barrier trace, side-effect count, cleanup ledger, Station readback.
- **Status**: pending

### AS-10 Actor/Device Isolation
- **Precondition**: Two actors and two devices.
- **Action**: Cross-use binding, operation lease, receipt credential, Connector resource, Evaluation run.
- **Expected**: Every cross-scope attempt rejects and logs safe context.
- **Failure variant**: revoked session cannot dispatch; receipt credential cannot execute.
- **Evidence**: typed errors + zero cross-read/mutation + audit.
- **Status**: pending

### AS-11 Browser Degradation
- **Precondition**: Browser Gateway without local MCP/shell capability.
- **Action**: Select Agent requiring local capability.
- **Expected**: unavailable state before commitment; Station capabilities remain usable.
- **Failure variant**: no hidden Desktop fallback.
- **Evidence**: Browser DOM + readiness snapshot + zero local dispatch.
- **Status**: pending

### AS-12 Final Cutover
- **Precondition**: W1-W8 complete.
- **Action**: Run structural Agent domain validation, exact Agent V2 proof-set validation, and tree-wide old-path search.
- **Expected**: Foundation plus six V2 Gates and 9/9 overlay pass; no live old truth.
- **Failure variant**: missing evidence or residual path fails closed.
- **Evidence**: Acceptance aggregate + per-Gate artifacts + search report.
- **Status**: pending

### AS-13 Home Partial Projection And Actor Switch
- **Precondition**: Home has accepted recents/tasks; one projection slice is unavailable.
- **Action**: User refreshes, then switches account or Station.
- **Expected**: Accepted slices remain visible with typed partial/stale state; commitment is blocked; switch clears all prior-actor projection before ready.
- **Failure variant**: Network timeout reaches bounded failed/stale state and retry; no prior-actor row is rendered.
- **Evidence**: Native DOM, projection revisions/slice errors, two-actor Station rows, network timing.
- **Status**: pending

### AS-14 Evaluation Restore, Delete, And Retention
- **Precondition**: One running run, one terminal parent/child pair, and a referenced dataset.
- **Action**: Restart Desktop/Station, reload runs, then delete the dataset/run under the accepted retention policy.
- **Expected**: Running state restores without local inference; terminal metrics/lineage remain immutable; deletion rejects or tombstones referenced history exactly as `data-model.md §6` requires.
- **Failure variant**: Readback timeout remains restoring/failed with retry; actor/device cross-read returns a typed rejection.
- **Evidence**: DOM, Station aggregate/tombstone rows, lineage/metrics hashes before and after restart/delete.
- **Status**: pending

### AS-15 Mobile Contract Compatibility
- **Precondition**: Generated shared contracts and a Mobile capability session without shell/stdio MCP.
- **Action**: Contract tests execute every matrix cell below against generated commands/events, a Station fixture, and the Mobile capability adapter.
- **Expected**: Each P01-P11 and V2 Station-backed semantic contract decodes identically; unsupported local work rejects before commitment with typed degradation.
- **Failure variant**: No Desktop fallback, hidden dispatch, or Mobile UI delivery claim.
- **Evidence**: Per-cell generated-contract test result, Station readback/hash where durable state exists, readiness snapshot, and zero local dispatch.
- **Status**: pending

| Matrix cell | Binary Mobile contract assertion |
|---|---|
| `AS-15-P01` | Agent config/readiness command and snapshot round-trip; blocked readiness produces zero send/provider call |
| `AS-15-P02` | Conversation/message IDs, revisions, and restart readback decode without client durable ownership |
| `AS-15-P03` | Ordered TurnEvents, cancel command, and one terminal state reconcile from Station |
| `AS-15-P04` | ContextLedger source IDs, omission reasons, and redacted segments decode deterministically |
| `AS-15-P05` | Tool proposal/decision/result contracts decode; unsupported local executor rejects before claim |
| `AS-15-P06` | Opaque attachment/resource refs round-trip; local paths and unauthorized refs reject |
| `AS-15-P07` | Queue position, overflow, cursor replay, and recovery states preserve accepted intent |
| `AS-15-P08` | Retry/regenerate/edit lineage and active branch revisions decode without destructive replacement |
| `AS-15-P09` | Capability snapshot exposes degraded/unavailable local work before commitment |
| `AS-15-P10` | Usage/feedback/diagnostic contracts round-trip with secret/local-path redaction |
| `AS-15-P11` | Client capability session advertises no shell/stdio MCP and accepts only matching device/session/lease results |
| `AS-15-V2-H01` | Home projection and Chat/Task command outcomes decode; no Mobile UI claim |
| `AS-15-V2-T01-T03` | Manifest/binding/readiness revisions and incompatibility errors round-trip |
| `AS-15-V2-T04` | Governed ToolCall proposal/decision/result lineage decodes with no local approval authority |
| `AS-15-V2-M01` | Local MCP unavailable lifecycle returns the `AS-04-UNAVAILABLE` oracle with zero operation/dispatch |
| `AS-15-V2-C01` | OAuth/resource-manifest/binding/ToolCall outcomes decode without token ownership on Mobile |
| `AS-15-V2-O01` | Typed retryability, terminality, replay, and redacted diagnostics decode identically |
| `AS-15-V2-E01` | Evaluation dataset/run/attempt/result/metrics/cancel/retry projections decode from Station truth |

### AS-16-CUSTOM-PLUGIN-RETIREMENT Rejected Product Removal
- **Precondition**: Seed `peers-ai-custom-plugins` with a fake credential, seed actor-owned `ecosystem_custom_plugins` metadata, and install network/secret canaries.
- **Action**: Execute the W8 cutover, restart Desktop/Station, search/open the former page and command, call every former plugin CRUD route, and trigger the former test action.
- **Expected**: The localStorage key and Station rows/table are absent; page/command/navigation and CRUD routes are unavailable; unified capability inventory contains no Custom Plugin source; network call count is zero.
- **Failure variant**: Any retained credential, arbitrary HTTP request, page/route/proto/persistence symbol, automatic import, or secret in logs/evidence fails the cell.
- **Evidence**: LocalStorage canary, Desktop registry/DOM, route responses, Station migration/table readback, network counter, redaction scan, and scoped zero-symbol report.
- **Status**: pending

### 8.1 Visible-State And Failure Coverage

| Exact accepted transition set | Scenario coverage |
|---|---|
| `UNKNOWN -> CHECKING -> READY / DEGRADED / BLOCKED` | AS-F01 |
| `LOCAL_DRAFT -> ACCEPTING_FIRST_TURN -> ACTIVE / REJECTED`; `ACTIVE -> ARCHIVED / RECOVERING / DELETED` | AS-F02, AS-F06, AS-F07 |
| `EMPTY <-> DIRTY -> VALIDATING -> READY_TO_SEND / INVALID -> SUBMITTING -> ACCEPTED / QUEUED / REJECTED` | AS-F02 |
| `ACCEPTED -> QUEUED / STARTING -> STREAMING`; waits/compress/retry -> all terminal Turn states | AS-F02, AS-F03, AS-F06 |
| `PROPOSED -> POLICY_CHECK -> AUTO_APPROVED / AWAITING_USER -> APPROVED / DENIED / EXPIRED -> RUNNING -> terminal` | AS-F04, AS-05A, R-03 |
| `SELECTED -> VALIDATING -> UPLOADING / REJECTED -> READY -> ATTACHED -> CONSUMED / OMITTED`; upload fail/retry | AS-F05 |
| `CONNECTED -> CONNECTION_LOST -> RECONNECTING -> REPLAYING -> RECONCILING -> CONNECTED / RECOVERY_FAILED` | AS-F06 |
| `ACTIVE_BRANCH -> RETRY_ATTEMPT / REGENERATE_BRANCH / EDIT_RESEND_BRANCH` | AS-F07 |
| `HOME_LOADING -> HOME_READY / HOME_EMPTY / HOME_STALE / HOME_FAILED` | AS-02, AS-13 |
| `HOME_READY -> CHAT_SUBMITTING -> TOPIC_ACCEPTED / CHAT_REJECTED` | AS-01, R-11 |
| `HOME_READY -> TASK_CREATING -> TASK_RUNNING / TASK_REJECTED` | AS-02, R-11 |
| `HOME_STALE -> HOME_REFRESHING -> HOME_READY / HOME_FAILED` | AS-13 |
| `DISCOVERED -> CHECKING -> READY / INCOMPATIBLE / DISCONNECTED / BLOCKED` | AS-03, AS-04, AS-04-UNAVAILABLE, AS-06, AS-11 |
| `READY -> BINDING -> BOUND` | AS-03 |
| `BOUND -> PROPOSED -> AWAITING_APPROVAL / RUNNING` | AS-05A |
| `AWAITING_APPROVAL -> APPROVED -> RUNNING / DENIED / EXPIRED` | AS-05A |
| `RUNNING -> SUCCEEDED / FAILED / TIMED_OUT / CANCELLED / DISCONNECTED` | AS-04, AS-05A, AS-06, R-03, R-04 |
| `DISCONNECTED -> RECONNECTING -> READY / FAILED` | AS-04, AS-06, R-04 |
| `EVAL_DRAFT -> EVAL_PENDING -> EVAL_RUNNING` | AS-07 |
| `EVAL_RUNNING -> EVAL_CANCELLING -> EVAL_CANCELLED / EVAL_PARTIAL` | AS-08, R-09 |
| `EVAL_RUNNING -> EVAL_COMPLETED / EVAL_PARTIAL / EVAL_FAILED` | AS-07, AS-08, R-08, R-09 |
| `EVAL_FAILED / EVAL_PARTIAL -> CREATE_RETRY_RUN -> CHILD_EVAL_PENDING` | AS-08, R-10 |
| `RESTORING_EVAL -> EVAL_RUNNING / EVAL_COMPLETED / EVAL_FAILED` | AS-14 |
| Desktop/Browser/Mobile platform adaptation and actor/device isolation | AS-10, AS-11, AS-13, AS-15 |

| Closure | Success | Network/disconnect | Timeout | Invalid input/version | Cancellation |
|---|---|---|---|---|---|
| Home | AS-01/02 | AS-13 | AS-13 | AS-01/R-11 | AS-02 |
| Capability binding | AS-03 | AS-03/11 | AS-03 | AS-03 | AS-03 leaves prior revision unchanged |
| MCP | AS-04 | AS-04/R-04 | AS-04/R-04 | AS-04/AS-04-UNAVAILABLE | AS-04/R-03 |
| Connector | AS-06 | AS-06/R-06 | AS-06/R-06 | AS-03/06 | AS-05A/R-03 |
| Governed ToolCall | AS-05A | R-05 | AS-05A/R-04 | AS-05A | AS-05A/R-03 |
| Evaluation | AS-07 | AS-14 | AS-08/R-09 | AS-07 | AS-08/R-09 |

Every Gate records each listed cell independently. A family cannot PASS when
one transition or required failure cell has no source-bound evidence.

Forbidden-transition oracles:

| Forbidden transition | Proving scenario |
|---|---|
| Local draft becomes active before Station acceptance | AS-F02 |
| Waiting approval succeeds without decision/result | AS-F04, AS-05A |
| Transport loss alone marks Turn failed | AS-F03, AS-F06 |
| Degraded becomes ready without fresh capability fact | AS-F01, AS-F10 |
| Partial/failed/cancelled becomes completed by client inference | AS-F03, AS-F06 |
| Regenerate destructively replaces source response | AS-F07 |
| Rejected attachment is silently omitted | AS-F05 |
| Static Home cards imply ready | AS-02, AS-13 |
| Discovered/bound capability implies ready without compatibility/connection | AS-03, AS-11 |
| Desktop-local Evaluation completion becomes authoritative | AS-07, AS-14 |
| Cancelling Evaluation becomes cancelled before Station authority | AS-08, R-09 |

The full accepted failure matrix is mandatory: missing credential/model,
unsupported vision/tool/reasoning/local capability, queue overflow,
provider timeout/rate-limit/retry exhaustion, tool denial/expiry/disconnect,
attachment validation/upload failure, cancel during text/tool/approval,
page/client/Station restart, duplicate command/event, stale Agent/branch,
Home partial/stale, MCP disconnect, Connector expiry, and Evaluation
cancel/retry/partial/restart/isolation. These map respectively to
AS-F01-F13, AS-D11, AS-01-AS-16, and R-01-R-11; no aggregate status may hide one
missing cell.

Shared capability taxonomy uses six independent executable cells:

| Cell | Precondition/action | Binary expected result | Evidence |
|---|---|---|---|
| TAX-01 `known` | Provide fresh manifest/model/runtime/client-session facts and refresh readiness | state is `known`; authority/revision/expiry are visible; compatible send may proceed | DOM + exact snapshot/readback |
| TAX-02 `pending` | Pause capability resolution or binding before Station acknowledgement | state is `pending`; no ready/terminal inference; user may cancel | DOM + pending command/revision + zero dispatch |
| TAX-03 `degraded` | Select a runtime with an accepted reduced path | state is `degraded`; affected capability and reduced outcome are disclosed before send | DOM + snapshot reason + reduced-path trace |
| TAX-04 `unavailable` | Select a device/runtime lacking the required local capability | state is `unavailable`; commitment rejects; local/provider dispatch count is zero | DOM + snapshot + zero-dispatch counter |
| TAX-05 `unknown` | Remove or stale every authoritative fact source | state remains `unknown`; support is not inferred; unsupported commitment is blocked | DOM + missing/stale source facts + zero dispatch |
| TAX-06 `blocked` | Apply explicit policy or required-capability blocker | state is `blocked`; contextual recovery is visible; bypass count is zero | DOM + policy/readiness row + zero bypass |

The capability-binding Gate executes TAX-01 through TAX-06 separately. Product
readiness `READY/CHECKING/...` remains a different state family; Gate evidence
records both dimensions without translating one into the other.

Foundation error cells are executable contracts (`R/T` is retryable/terminal):

| Cell | Stable code / locale key | R/T | Safe args | Action -> Station/side-effect oracle |
|---|---|---|---|---|
| BASE-QUEUE_FULL | `ADMISSION_QUEUE_FULL` / `agent.errors.queueFull` | true/true | `conversation_id,capacity` | `Edit queue` -> count remains Q; zero provider call |
| BASE-DUPLICATE_CONFLICT | `ADMISSION_DUPLICATE_CONFLICT` / `agent.errors.duplicateConflict` | false/true | `idempotency_key_hash,existing_command_id` | `Open original` -> original IDs/hash unchanged; zero new row |
| BASE-ACTIVE_MUTATION_CONFLICT | `ADMISSION_ACTIVE_MUTATION_CONFLICT` / `agent.errors.activeMutationConflict` | true/true | `resource_id,expected_revision,actual_revision` | `Reload latest` -> active revision unchanged; zero stale mutation |
| BASE-FORBIDDEN_ACTOR | `OWNERSHIP_FORBIDDEN_ACTOR` / `agent.errors.forbiddenActor` | false/true | `resource_kind,resource_id` | `Switch account` -> zero cross-read/mutation |
| BASE-UNAUTHORIZED_RESOURCE | `OWNERSHIP_UNAUTHORIZED_RESOURCE` / `agent.errors.unauthorizedResource` | false/true | `resource_kind,resource_id` | `Remove resource` -> zero context/provider use |
| BASE-RUNTIME_UNAVAILABLE | `RUNTIME_UNAVAILABLE` / `agent.errors.runtimeUnavailable` | true/true | `runtime_kind,reason_code` | `Select runtime` -> no attempt/provider call |
| BASE-INCOMPATIBLE_CAPABILITY | `RUNTIME_INCOMPATIBLE_CAPABILITY` / `agent.errors.incompatibleCapability` | false/true | `capability_id,reason_code` | `Choose compatible model` -> zero rejected-path execution |
| BASE-RESUME_UNAVAILABLE | `RUNTIME_RESUME_UNAVAILABLE` / `agent.errors.resumeUnavailable` | true/true | `runtime_profile_id,reason_code` | `Confirm reset` -> old epoch unchanged until confirmation |
| BASE-EXECUTOR_UNAVAILABLE | `CLIENT_EXECUTOR_UNAVAILABLE` / `agent.errors.executorUnavailable` | true/true | `target_device_id,capability_id` | `Reconnect executor` -> zero claim/side effect |
| BASE-LEASE_EXPIRED | `CLIENT_LEASE_EXPIRED` / `agent.errors.clientLeaseExpired` | true/false | `session_id,lease_id,expired_at` | `Reconcile` -> old event audit-only; current lease unchanged |
| BASE-PERMISSION_DENIED | `CLIENT_PERMISSION_DENIED` / `agent.errors.clientPermissionDenied` | false/true | `capability_id,permission_kind` | `Open permission settings` -> zero local execution |
| BASE-TARGET_DISCONNECTED | `CLIENT_TARGET_DISCONNECTED` / `agent.errors.targetDisconnected` | true/false | `target_device_id` | `Reconnect` -> same request remains pending/disconnected |
| BASE-INVALID_RESOURCE_REF | `CLIENT_INVALID_RESOURCE_REFERENCE` / `agent.errors.invalidResourceReference` | false/true | `resource_kind,resource_ref_hash` | `Choose resource again` -> zero resource read/provider call |
| BASE-CREDENTIAL_MISSING | `PROVIDER_CREDENTIAL_MISSING` / `agent.errors.providerCredentialMissing` | true/true | `provider_id` | `Configure credential` -> zero provider call |
| BASE-RATE_LIMIT | `PROVIDER_RATE_LIMIT` / `agent.errors.providerRateLimit` | true/true | `provider_id,retry_after_ms` | `Retry later` -> one terminal attempt; no hidden retry |
| BASE-MODEL_UNAVAILABLE | `PROVIDER_MODEL_UNAVAILABLE` / `agent.errors.providerModelUnavailable` | true/true | `provider_id,model_id` | `Choose model` -> zero successful completion |
| BASE-PROVIDER_TIMEOUT | `PROVIDER_TIMEOUT` / `agent.errors.providerTimeout` | true/true | `provider_id,model_id,deadline` | `Retry` -> timed-out attempt terminal; upstream cancel sent |
| BASE-CONTEXT_OVERFLOW | `CONTEXT_OVERFLOW` / `agent.errors.contextOverflow` | false/true | `limit_tokens,actual_tokens` | `Reduce context` -> zero persistence/provider call |
| BASE-INVALID_REFERENCE | `CONTEXT_INVALID_REFERENCE` / `agent.errors.contextInvalidReference` | false/true | `reference_kind,reference_hash` | `Remove reference` -> zero context inclusion |
| BASE-ATTACHMENT_REJECTED | `CONTEXT_ATTACHMENT_REJECTED` / `agent.errors.attachmentRejected` | false/true | `attachment_id,reason_code` | `Remove attachment` -> zero provider call |
| BASE-UNKNOWN_TOOL | `TOOL_UNKNOWN` / `agent.errors.toolUnknown` | false/true | `tool_id,tool_version` | `Choose tool` -> zero decision/execution |
| BASE-APPROVAL_DENIED | `TOOL_APPROVAL_DENIED` / `agent.errors.toolApprovalDenied` | false/true | `tool_call_id,decision_id` | `Continue without tool` -> decision denied; side-effect 0 |
| BASE-APPROVAL_EXPIRED | `TOOL_APPROVAL_EXPIRED` / `agent.errors.toolApprovalExpired` | true/true | `decision_id,expires_at` | `Request again` -> expired decision immutable; side-effect 0 |
| BASE-LOOP_BUDGET_EXHAUSTED | `TOOL_LOOP_BUDGET_EXHAUSTED` / `agent.errors.toolLoopBudgetExhausted` | false/true | `turn_id,budget_kind,limit` | `Inspect budget` -> terminal budget outcome; no next tool call |
| BASE-CANCELLED | `LIFECYCLE_CANCELLED` / `agent.errors.lifecycleCancelled` | false/true | `resource_kind,resource_id` | `none` -> cancelled terminal and one cleanup; no late success |
| BASE-INTERRUPTED | `LIFECYCLE_INTERRUPTED` / `agent.errors.lifecycleInterrupted` | true/true | `turn_id,reason_code` | `Recover` -> interrupted terminal; no completed inference |
| BASE-STALE_VERSION | `LIFECYCLE_STALE_VERSION` / `agent.errors.lifecycleStaleVersion` | true/true | `resource_id,expected_revision,actual_revision` | `Reload latest` -> current revision unchanged |
| BASE-TERMINAL_MUTATION | `LIFECYCLE_TERMINAL_MUTATION` / `agent.errors.lifecycleTerminalMutation` | false/true | `resource_id,terminal_status` | `Open result` -> terminal hash unchanged; zero mutation |

Every typed error below is an independent binary cell. Common expected
contract: exact stable code and locale key; safe structured arguments only;
declared retryability and terminality; contextual receiver action; matching
Station readback; zero forbidden side effect; source-bound external evidence.

`R/T` below means literal retryable/terminal booleans.

| Cell | Stable code / locale key | R/T | Safe argument allowlist | Fixture/action -> binary receiver/Station oracle |
|---|---|---|---|---|
| ERR-H01 | `HOME_PROJECTION_STALE` / `agent.errors.homeProjectionStale` | true/false | `projection_revision,latest_revision` | serve older revision -> stale DOM, retry action, Station revision unchanged |
| ERR-H02 | `HOME_SLICE_UNAVAILABLE` / `agent.errors.homeSliceUnavailable` | true/false | `slice,reason_code` | fail one source -> partial DOM, accepted slices retained |
| ERR-H03 | `HOME_READINESS_UNRESOLVED` / `agent.errors.homeReadinessUnresolved` | true/false | `agent_id,reason_code` | remove readiness fact and submit -> blocked DOM, zero dispatch |
| ERR-CAT01 | `CAPABILITY_MANIFEST_NOT_FOUND` / `agent.errors.capabilityManifestMissing` | false/true | `capability_id,capability_version` | bind unknown ID -> rejected mutation, choose-manifest action |
| ERR-CAT02 | `CAPABILITY_MANIFEST_VERSION_STALE` / `agent.errors.capabilityManifestVersionStale` | true/true | `capability_id,expected_version,actual_version` | stale mutation -> conflict DOM/readback, reload action |
| ERR-CAT03 | `CAPABILITY_MANIFEST_SCHEMA_INVALID` / `agent.errors.capabilityManifestSchemaInvalid` | false/true | `capability_id,schema_field,reason_code` | register malformed schema -> rejected mutation, zero catalog row |
| ERR-B01 | `CAPABILITY_BINDING_VERSION_CONFLICT` / `agent.errors.capabilityBindingVersionConflict` | true/true | `binding_id,expected_revision,actual_revision` | concurrent mutation -> conflict DOM, latest binding unchanged |
| ERR-B02 | `CAPABILITY_UNAVAILABLE` / `agent.errors.capabilityUnavailable` | true/true | `capability_id,target_device_id,reason_code` | bind unavailable target -> rejected mutation, select-target action |
| ERR-B03 | `CAPABILITY_POLICY_INVALID` / `agent.errors.capabilityPolicyInvalid` | false/true | `binding_id,policy_kind,reason_code` | submit invalid policy -> rejected mutation, prior policy unchanged |
| ERR-O01 | `CAPABILITY_EXECUTOR_UNAVAILABLE` / `agent.errors.capabilityExecutorUnavailable` | true/true | `operation_id,target_device_id,capability_id` | dispatch without executor -> failed operation, reconnect action |
| ERR-O02 | `CAPABILITY_LEASE_EXPIRED` / `agent.errors.capabilityLeaseExpired` | true/false | `operation_id,lease_id,expired_at` | old-lease report -> rejected audit fact, current operation unchanged |
| ERR-O03 | `CAPABILITY_CANCELLED` / `agent.errors.capabilityCancelled` | false/true | `operation_id,cancelled_by` | cancel fence wins -> cancelled after cleanup, no retry |
| ERR-O04 | `CAPABILITY_TIMEOUT` / `agent.errors.capabilityTimeout` | true/true | `operation_id,deadline` | deadline wins -> timed-out after cleanup, explicit retry |
| ERR-O05 | `CAPABILITY_DISCONNECTED` / `agent.errors.capabilityDisconnected` | true/false | `operation_id,target_device_id` | drop session -> disconnected DOM/readback, reconnect action |
| ERR-O06 | `CAPABILITY_CLEANUP_FAILED` / `agent.errors.capabilityCleanupFailed` | false/true | `operation_id,resource_kind,cleanup_outcome` | expire cleanup -> cleanup-failed, manual recovery action |
| ERR-O07 | `CAPABILITY_UNKNOWN_SIDE_EFFECT` / `agent.errors.capabilityUnknownSideEffect` | false/true | `operation_id,tool_call_id,receipt_id` | after PREPARED, execute a non-idempotent external effect to confirmed success, then crash before durable APPLIED -> unknown-side-effect, auto-retry absent |
| ERR-O08 | `CAPABILITY_STALE_FENCE` / `agent.errors.capabilityStaleFence` | false/false | `operation_id,expected_fence,actual_fence` | old-fence event -> rejected audit fact, current owner unchanged |
| ERR-CON01 | `CONNECTOR_OAUTH_EXPIRED` / `agent.errors.connectorOAuthExpired` | true/true | `connector_id,connection_revision,expires_at` | expire before admission -> unavailable DOM, reconnect action, zero dispatch |
| ERR-CON02 | `CONNECTOR_SCOPE_DENIED` / `agent.errors.connectorScopeDenied` | true/true | `connector_id,resource_id,required_scopes` | remove scope -> rejected before dispatch, reauthorize action |
| ERR-CON03 | `CONNECTOR_RESOURCE_REMOVED` / `agent.errors.connectorResourceRemoved` | true/true | `connector_id,resource_id,resource_version` | delete resource -> unavailable/terminal call, choose-resource action |
| ERR-CON04 | `CONNECTOR_MANIFEST_STALE` / `agent.errors.connectorManifestStale` | true/true | `manifest_id,expected_version,actual_version` | invoke old revision -> rejected, resync/rebind action |
| ERR-E01 | `EVALUATION_DATASET_REVISION_CONFLICT` / `agent.errors.evaluationDatasetRevisionConflict` | true/true | `dataset_id,expected_revision,actual_revision` | stale start -> rejected before scheduler claim, reload action |
| ERR-E02 | `EVALUATION_TARGET_SNAPSHOT_INVALID` / `agent.errors.evaluationTargetSnapshotInvalid` | true/true | `agent_id,snapshot_id,reason_code` | invalid target -> rejected before scheduler claim, reselect action |
| ERR-E03 | `EVALUATION_RUN_NOT_CANCELLABLE` / `agent.errors.evaluationRunNotCancellable` | false/true | `run_id,run_status` | cancel terminal run -> rejected mutation, run hash unchanged |
| ERR-E04 | `EVALUATION_CASE_RETRY_CONFLICT` / `agent.errors.evaluationCaseRetryConflict` | false/true | `parent_run_id,existing_child_run_id` | same key/different cases -> conflict; parent/child hashes unchanged |
| ERR-E05 | `EVALUATION_EVALUATOR_UNAVAILABLE` / `agent.errors.evaluationEvaluatorUnavailable` | true/true | `run_id,evaluator_id,reason_code` | remove evaluator -> failed/retry action, zero case Turn |

| Cell | Literal receiver action | Exact Station readback | Forbidden side-effect oracle |
|---|---|---|---|
| ERR-H01 | `Reload latest` | latest revision unchanged | zero command mutation |
| ERR-H02 | `Retry unavailable slice` | accepted slices plus typed slice error | zero erasure/mutation of accepted slices |
| ERR-H03 | `Resolve readiness` | no Chat/Task command row | zero provider/tool dispatch |
| ERR-CAT01 | `Choose manifest` | no new binding row | zero capability mutation |
| ERR-CAT02 | `Reload latest` | actual manifest version unchanged | zero stale mutation |
| ERR-CAT03 | `Edit schema` | no manifest version created | zero binding/admission |
| ERR-B01 | `Reload and reapply` | latest binding revision unchanged | zero duplicate binding mutation |
| ERR-B02 | `Select compatible target` | prior binding unchanged | zero executor dispatch |
| ERR-B03 | `Correct policy` | prior policy/revision unchanged | zero approval/tool dispatch |
| ERR-O01 | `Reconnect executor` | one failed operation, no claim | zero side effect |
| ERR-O02 | `Reconcile or take over` | current lease/fence unchanged; old event audit-only | zero accepted old-fence result |
| ERR-O03 | `none` | cancelled terminal plus one cleanup outcome | zero post-cancel execution/result |
| ERR-O04 | `Retry as new operation` | timed-out terminal plus one cleanup outcome | zero late accepted result |
| ERR-O05 | `Reconnect` | same operation in disconnected state | zero second operation |
| ERR-O06 | `Open manual recovery` | cleanup-failed terminal/orphan diagnostics | zero false success |
| ERR-O07 | `Open side-effect review` | unknown-side-effect terminal/receipt | zero automatic redispatch |
| ERR-O08 | `none` | current fence/owner unchanged; stale event audit-only | zero accepted stale progress/result |
| ERR-CON01 | `Reconnect OAuth` | connection revision unavailable/expired | zero ToolCall dispatch |
| ERR-CON02 | `Reauthorize scopes` | resource manifest unavailable with missing scopes | zero ToolCall dispatch |
| ERR-CON03 | `Choose resource` | removed resource/version remains unavailable | zero redispatch against removed resource |
| ERR-CON04 | `Resync and rebind` | current manifest version unchanged | zero stale-version ToolCall |
| ERR-E01 | `Reload dataset` | run count unchanged | zero scheduler claim/Turn |
| ERR-E02 | `Reselect target` | run count unchanged | zero scheduler claim/Turn |
| ERR-E03 | `Open terminal results` | terminal run status/revision/hash unchanged | zero cancellation dispatch |
| ERR-E04 | `Open existing child or use new key` | parent/child IDs and hashes unchanged | zero duplicate child/attempt |
| ERR-E05 | `Retry when evaluator is ready` | failed run with zero case attempts | zero case Turn/provider call |

| Owning Gate | Required ERR cells |
|---|---|
| `agent-v2-home-command-center-e2e` | ERR-H01-H03 |
| `agent-v2-capability-binding-e2e` | ERR-CAT01-CAT03, ERR-B01-B03 |
| `agent-v2-mcp-lifecycle-e2e` | ERR-O01-O08 |
| `agent-v2-governed-tool-loop-e2e` | ERR-O01-O08 and REPLAY-O07I |
| `agent-v2-connector-invocation-e2e` | ERR-CON01-CON04 |
| `agent-v2-evaluation-lab-e2e` | ERR-E01-E05 |

Missing any TAX or ERR cell keeps the owning Gate `UNPROVEN`.

Companion replay cell `REPLAY-O07I` uses an externally idempotent tool: after
PREPARED, execute the external effect to confirmed success, crash before
durable APPLIED, then redeliver with the same `tool_call_id` external
idempotency key. Reconcile PREPARED/APPLIED and require side-effect count <=1
plus exactly one Station result/model continuation. It must not emit ERR-O07.

### 8.2 Mandatory Deterministic Race Scenarios

Each race executes Order A and Order B from a clean fixture. Evidence always
contains barrier timestamps, actor/device/session/lease identities, Station
rows, receiver DOM before/after each user-visible transition, executor receipts,
side-effect count, cleanup outcome, replay result, and the external artifact
manifest.

#### R-01 MCP Lease Takeover Versus Old Result
- **Barrier/orders**: pause old executor after PREPARED; expire business lease; A commits old result before takeover CAS, B commits takeover before old result.
- **Oracle**: exactly one fence owns business result; old result after takeover is rejected; old cleanup-only receipt may settle; side-effect count <=1; ambiguity blocks repeat.
- **Status**: pending

#### R-02 Cleanup Lease Expiry Versus Settlement
- **Barrier/orders**: pause in `settling_cleanup`; expire cleanup lease; A accepts cleanup before takeover, B commits takeover before old cleanup.
- **Oracle**: one cleanup fence wins; old cleanup is rejected after takeover; deadline commits `cleanup_failed`; operation never hangs.
- **Status**: pending

#### R-03 Capability Cancel Versus Result
- **Barrier/orders**: pause before cancel/result fence CAS; execute cancel-first and result-first.
- **Oracle**: first committed fence wins; both orders settle cleanup exactly once; late terminal facts are audit-only.
- **Status**: pending

#### R-04 Capability Timeout Versus Reconnect
- **Barrier/orders**: pause before timeout fence/reconnect CAS; execute timeout-first and reconnect-first.
- **Oracle**: timeout-first never returns running; reconnect-first still respects deadline and cleanup; no unbounded reconnecting.
- **Status**: pending

#### R-05 Device Revoke Versus ToolCall
- **Barrier/orders**: pause before/after outbox commit and PREPARED/APPLIED; execute revoke-before-dispatch and dispatch-before-revoke.
- **Oracle**: before dispatch has zero side effects; after dispatch ends APPLIED/cancelled/UNKNOWN only; receipt nonce/signature/scope/expiry hold; APPLIED is globally unique.
- **Status**: pending

#### R-06 OAuth Disconnect Versus Connector Invoke
- **Barrier/orders**: pause around connection-revision/outbox commit; execute disconnect-first and dispatch-first; inject provider revoke rejection/timeout.
- **Oracle**: disconnect-first dispatches zero; dispatch-first may finish only pinned revision; local remains disabled while provider revoke is unconfirmed; retry reuses idempotency key.
- **Status**: pending

#### R-07 Manifest/Binding Delete Versus Active ToolCall
- **Barrier/orders**: pause before/after dispatch commit; execute delete-first and dispatch-first.
- **Oracle**: no new admission after delete; prior claim settles or explicitly cancels; historical snapshots remain immutable; side effect never repeats.
- **Status**: pending

#### R-08 Evaluation Duplicate Scheduler
- **Barrier/orders**: pause after scheduler claim and Turn creation; deliver duplicate before and after each commit.
- **Oracle**: one attempt, Turn, and result; duplicate returns existing IDs; no duplicate model/tool side effect.
- **Status**: pending

#### R-09 Evaluation Cancel Versus Case Completion
- **Barrier/orders**: pause before cancel-intent/completion CAS; execute each first; drop one cancellation ACK and advance deadline.
- **Oracle**: cancel-first blocks completion; completion-first atomically freezes metrics; missing ACK reaches bounded partial with `CANCEL_ACK_TIMEOUT`.
- **Status**: pending

#### R-10 Evaluation Retry Versus Metrics
- **Barrier/orders**: pause after parent terminal transaction and child creation; issue duplicate retry before and after each commit.
- **Oracle**: parent status/metrics/revision remain unchanged; one child ID exists with exact source attempt/result lineage.
- **Status**: pending

#### R-11 Home Duplicate Chat And Task Submit
- **Barrier/orders**: run Chat and Task separately; pause after idempotency claim and object creation; redeliver before and after each commit.
- **Oracle**: same payload returns original IDs and count 1; different payload conflicts; draft remains recoverable; no empty topic or duplicate task/run.
- **Status**: pending

### 8.3 Quantitative Measurement Gates

G-F executes the C01-C10 rows; W9 reruns them on the final source snapshot and
adds C11-C15/V2 rows. Reports retain every failed and cold sample.

| Claim | Mandatory workload | Pass threshold |
|---|---|---|
| `BASIC_USEFULNESS_5_TURNS` | fixed five-turn factual continuity on required Direct Model plus AS-F11/AS-F13 Desktop/Browser non-advertisement cells | all five Direct facts correct; P12/CLI have no selectable/profile/readiness claim and no hidden dispatch |
| `CONTINUITY_10_TURNS_COMPRESSION` | AS-F08, force compression after turn six and restart before turn ten | pre-compression facts remain correct; ContextLedger explains compression snapshot/source and token accounting |
| `TWO_TOPIC_ISOLATION` | AS-F12, distinct facts/branches in two topics across Desktop/Station restart | zero cross-topic message/branch/runtime leakage; each active branch survives |
| `STREAM_LATENCY` | 30 successful turns per App/Browser and runtime cell; record raw receipt-to-projection timestamps | report P50/P95/P99; P95 <=250 ms; no synthetic stream or dropped cold sample |
| `CANCEL_TEXT`, `CANCEL_TOOL`, `CANCEL_APPROVAL` | 20 Direct-runtime cancellations at text, tool, and approval boundaries | Station terminal <=2 s; local executor cleanup <=5 s where invoked; zero leaked process/port/secret |
| `REPLAY_RECONCILIATION` | 20 forced disconnects at varied event sequences plus Desktop restart | every terminal projection byte/field-equivalent to Station snapshot; zero duplicate mutation |
| `CONTEXT_BUDGET_BOUNDARIES`, `RESOURCE_BUDGET_BOUNDARIES` | for resolved input budget `B`, run floor(0.5B), floor(0.8B), B-1, B, B+1 token cases; for attachment byte/count limits `A`/`N`, run A-1/A/A+1 and N/N+1 | <= limit is accounted/included or explicitly truncated by policy; limit+1 rejects before persistence/provider with zero partial runtime binding |
| `QUEUE_Q_QPLUS1` | test policy `Q=8`; pause dequeue, admit eight unique requests one-by-one and assert count after each; submit a barrier-controlled ninth unique request; while full, replay one admitted key with same then different payload; release exactly one slot and race two unique requests at the admission-claim barrier; repeat independently for two actors | requests 1..Q accepted with counts 1..Q; deterministic Q+1 returns queue-full; same key/payload returns original IDs without consuming capacity; same key/different payload conflicts; after one release exactly one claimant wins and one overflows; zero cross-actor mutation |
| `SAFETY_NEGATIVES` | all actor/device/session/lease/credential/resource negative cells | zero cross-read, credential leak, unregistered binary, or approval bypass |
| `LOOP_LIMIT_LIMITPLUS1` | immutable test budget: attempts=2, agent_steps=3, tool_calls=2, identical_tool_calls=1, delegation_depth=2, wall_time=2000 ms, input/output limits=fixture B-in/B-out, normalized cost quantum=0.001 and max_cost=0.010; execute each limit and limit+1 (cost 0.011), including repeat and ping-pong | every limit completes when otherwise valid; every limit+1 stops at the exact boundary with typed terminal/human-escalation outcome and no next provider/tool/delegation call |
| `QUALITY_OBSERVABILITY` | versioned continuity, memory, Skill, Knowledge, tool, unsupported-claim, usage/feedback/export cases | all required cases pass; export reconstructs sources/attempts/tools/usage/terminal reason with zero secret/local-path leak |

Every measurement artifact records the exact source-identity tuple, Station
profile, Desktop mode, provider/runtime/model, capability snapshot, network
path, machine, cold/warm state, raw events, terminal/readback, and diagnostic
export. Unknown identity, missing raw sample, omitted failure, or threshold
miss keeps the relevant Gate `UNPROVEN`.

## 9. Risk And Anti-Regression

| Risk | Required control |
|---|---|
| Split binding/readiness truth | W1 disabled backfill; W8 atomic consumer cutover and disposition-aware deletion search |
| Duplicate side effects | outbox, receipt ledger, fencing, crash barriers |
| Hung cleanup | independent cleanup lease/deadline and leak canary |
| OAuth/device revoke race | revision/dispatch barriers and both-ordering tests |
| Evaluation divergence | canonical Turn kernel and child retry runs |
| Prototype drift | replica/sync gates in W8 |
| Source-tree evidence | Evidence Store only; write failure aborts Gate |
| Overclaim | every missing cell remains `UNPROVEN` |

## 10. Execution Rules

- Follow DAG dependencies; do not start consumers before contracts/owners.
- Update plan Context Anchor and brain-map overlay after source-bound evidence.
- Any undefined lifecycle returns `DESIGN_AMENDMENT_REQUIRED`.
- No compatibility shim or dual source may survive final cutover.
- Do not mark a workstream done from compile/static checks alone.
- D11: F1 installs Web and Station fail-closed Canvas guards. They remain closed
  throughout and after this plan. W9 proof is only a prerequisite for a future
  separately accepted Agent Canvas canonical-TurnService migration; it never
  auto-removes or bypasses the guards.
- Commit/push/PR require explicit delivery-stage authorization.

## 11. Plan Review Gate

The nineteenth review covered D01-D18. The Owner approved the D19-core amended
plan on 2026-08-21. The G1-C entry audit found additional architecture
requirements, and the Owner accepted `MCA-D19A` on 2026-08-22. G1-A then
verified a missing device-possession boundary and produced `MCA-D19B`, accepted
into the main Goal G1 task on 2026-08-22. The active gate is
`OWNER_APPROVED_EXECUTION`; G1-A through G1-F are complete, G1-XR
candidate-producer and safe-provisioning closure is active, G-F remains
blocked, and all Product Gates remain `UNPROVEN`.

Any later independent review must confirm:

- every C01-C15 closure and D01-D19 decision maps to predecessor/workstream/Gate;
- dependency/parallel order is sound;
- atomic deletions prevent split truth;
- every lifecycle state/race has a binary scenario;
- evidence is receiver/Station/runtime/cleanup complete;
- no plan item redesigns accepted architecture.

The review must specifically confirm D19A signed recovery scope, nonce replay,
device-key revocation, split deadlines, lease CAS, Station-pinned replay policy,
opaque resource ownership; D19B command proof, body hashing, actor/device
binding, replay behavior; G1-A through G1-F dependency order, G1-X's
Acceptance-only firewall, Station-only execution authority, Rust
PREPARED-before-side-effect durability, atomic result/continuation, and
zero-residual deletion.
