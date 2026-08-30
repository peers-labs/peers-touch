# Modern Chat Agent V2 — Formal Execution Plan

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-17 | **Updated**: 2026-08-30
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
cutovers; W8a owns complete C12 plus D19 governed ToolCall activation/deletion,
and W8b owns C11/C14/C15 plus C13 CapabilityOperation activation/deletion.

| Concern | Current authority/consumer paths | Required disposition |
|---|---|---|
| Core Agent/config/conversation | `apps/station/app/subserver/agent/{domain,service,handler,infrastructure/persistence}/agent_config*`; `service/conversation_service.go`; `service/turn_service.go`; `apps/desktop/src/runtimes/agentTopicRuntime.ts`; `apps/desktop/src/services/chat-service.ts`; `apps/desktop/src/store/{agentTopics,agentSearch,chat}.ts`; `apps/desktop/src-tauri/src/application/chat/mod.rs` in-memory `ChatStore` | F1 moves config/conversation/message truth to Station and deletes `ChatStore`/local durable ownership |
| Runtime/stream/recovery | `apps/station/app/subserver/agent/service/turn_service.go`; Desktop `agentCapabilityRuntime.ts`; `apps/desktop/src-tauri/src/application/agent_turn/mod.rs`; `apps/desktop/src/services/desktop_api.ts#streamAgentTurn` browser `executeAgentTurnOnce` fallback | F2 makes App/Browser consume sequenced Station streaming/replay and deletes one-shot/local execution authority |
| Context/resources | Station context/memory/skill/knowledge services and message persistence; `apps/desktop/src/store/chat.ts`; attachment/composer surfaces; `apps/desktop/src-tauri/src/contracts.rs` portable payloads | F3 adds typed ContextLedger and opaque authorized resource refs; deletes untyped/local-path authority |
| Usage/feedback/diagnostics | Station TurnTrace/user-feedback/diagnostic persistence and services; `apps/desktop/src/diagnostics/agentTurnDiagnostics.ts`; Agent details/feedback surfaces | F4 makes exact-turn usage/feedback/redacted replay durable; screenshot-only evidence is retired |
| Agent config/bindings | `apps/station/app/subserver/agent/domain/agent_config_service.go`; `apps/desktop/src/services/desktop_api.ts`; `apps/desktop/src/pages/AgentProfilePage.tsx`; `apps/desktop/src/store/agent.ts#updateAgentConfig/getCurrentAgentChatConfig`; `apps/desktop/src/store/agentConnectors.ts`; `AgentSidebar.tsx` and diagnostics readers of embedded `chatConfig` | Backfill manifests/bindings while disabled; W8a switches every Tool/MCP/Connector/Skill/Knowledge binding/readiness consumer and retires embedded `chatConfig` arrays plus parallel readers |
| Home | `apps/desktop/src/pages/HomePage.tsx`; `apps/desktop/src/pages/HomePageContainer.tsx`; `apps/desktop/src/pages/HomePage.descriptor.tsx` | W8b replaces page-derived work state with `homeRuntime` projection |
| Tool approval/execution | `ToolCallCard.tsx` -> `store/chat.ts#decideToolApproval` -> Desktop API/Tauri command -> Rust `tool_approval_registry`; `ToolDetailView.tsx` is a read-only inspector, not a decision submitter; event flow uses handwritten `streaming/types.ts`/`index.ts`, mixed reducer `streaming/handler.ts` with intervention side effects, `chat.ts`, AgentProfile activity projection, and Rust approval input; `turn_stream.proto` lacks typed proposal/decision payloads; live inventory uses read-only `store/tool.ts`, while unimported `store/tool/index.ts#pendingCalls` is dead code | G1-A adds the MCA-D19 typed decision/envelope/receipt contract; G1-B/C establish Station authority and fenced Rust execution; G1-D makes `toolRuntime` the sole Web projection and decision-intent owner; W8a deletes every legacy Web/Rust/Station execution authority and unfenced continuation before G-F |
| MCP | `apps/desktop/src/store/mcp.ts`; `apps/desktop/src/services/mcp-service.ts`; `apps/desktop/src/modules/mcp.ts`; `apps/desktop/src-tauri/src/application/mcp/`; `apps/desktop/src-tauri/src/interface/tauri_commands/mcp.rs` | Retain local process/config/secret executor only; replace client terminal lifecycle truth |
| Connector | `apps/desktop/src/store/agentConnectors.ts`; `apps/desktop/src/components/agent/AgentConnectorsPanel.tsx`; OAuth services under Station | Retain OAuth owner; replace `enabledTools`/labels as portable readiness or binding identity |
| Evaluation | `apps/desktop/src/store/evaluation.ts`; `apps/desktop/src/pages/EvaluationPage.tsx`; `apps/desktop/src/services/desktop_api.ts`; Station ecosystem dataset persistence/service | Backfill dataset truth; W8b removes localStorage run/result and `quickCompletion` execution |
| Rejected Custom HTTP Plugin | Desktop `CustomPluginsPage*`, `pages/registry.ts`, `hooks/useCommandMenuItems.ts`, `types/navigation.ts`, `store/customPlugins.ts`, locale keys and `peers-ai-custom-plugins`; `model/domain/agent/ecosystem.proto#CustomPlugin*` and generated clients; Station `agent.go` plugin routes, ecosystem handlers/service/model registration/persistence/table `ecosystem_custom_plugins` | W8b freezes and deletes the independent page, direct arbitrary HTTP execution, local credential storage, proto/CRUD/generated contracts, and persistence/table; no automatic import into Tool/MCP/Connector because no accepted successor mapping exists |
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
  -> W1 Capability Authority
       -> W3 Capability Operation Substrate
            -> W6 Governed ToolCall Fencing
                 -> W8a Capability/ToolCall Atomic Cutover
                      -> G-F Complete 419-Cell Foundation Gate

G-F
  -> W2 Home Projection
  -> W4a MCP Operation Lifecycle -> W4b MCP Invocation Closure
  -> W5a Connector Resource Manifest -> W5b Connector Invocation Closure
  -> W7 Evaluation Aggregate

W2 + W4b + W5b + W7
  -> W8b Remaining Desktop/Browser Consumer Cutover
       -> W9 Native Acceptance, Deletion, Cleanup, Final Audit
```

Parallel policy:

- F3 and F4 may proceed in parallel after F2; both consume the F1 Station
  conversation/turn identity.
- The source-matched Foundation runs through AS-F03 are diagnostic progress,
  not a Gate or advancement proof. W1 enters from completed F1-F4
  implementation checks because AS-F04 itself requires W1/W3/W6.
- W8a atomically activates complete C12 Manifest/Binding/Readiness authority
  across Tool/MCP/Connector/Skill/Knowledge consumers plus D19 governed
  ToolCall authority after W1/W3/W6. It explicitly excludes C13
  CapabilityOperation activation. MCP/Connector capabilities remain
  canonically unavailable until W4/W5 complete and never fall back to legacy
  readiness selectors.
- G-F then runs the unchanged 419-cell
  `agent-v2-kernel-foundation-e2e` Gate and must be fully `PROVEN` before W7 or
  W8b proceeds.
- Inside F4/G1, production authority changes are serial:
  `G1-A contract -> G1-B Station -> G1-C Rust -> G1-D Web -> G1-E cutover
  deletion -> G1-F observability`. Acceptance contract/fixture work may proceed
  in parallel after G1-A, but it cannot modify production owners or publish
  `PROVEN`.
- W3 follows W1; W6 follows W1/W3. W2/W4/W5/W7 do not start until the complete
  G-F Gate is `PROVEN`.
- W4 and W5 cannot close their invocation deliverables or Gates until W6 passes;
  W4b and W5b are explicit join milestones, not independent workstreams.
- W7 starts only after W6 canonical Turn/ToolCall fencing is available.
- W8a and W8b are concern-atomic cutovers. W8a owns complete C12 and D19
  governed ToolCall activation after W1/W3/W6; W8b owns C11/C14/C15 and C13
  CapabilityOperation activation after its predecessors pass. Earlier work may
  compile behind unreferenced adapters but cannot dual-write, serve production
  reads, or claim cutover.

### 5.1 End-To-End Lifecycle Mapping

| Lifecycle | Ordered workstream ownership | Closure condition |
|---|---|---|
| Startup/bootstrap | W0 contracts/evidence -> F1/F2 canonical kernel -> F3/F4 capabilities -> W1 authority -> W3/W6 -> W8a -> G-F -> W2/W4/W5/W7 -> W8b | generated contracts load; C01-C10 close before W2/W4/W5/W7 consumers; no dual authority |
| Authentication/account/Station switch | F1 actor/config authority -> F2 client session -> W1 binding -> W8a capability/tool scope -> W2 projection clearing -> W8b remaining consumers -> W9 isolation | prior actor/device projection is absent before ready; cross-scope mutation/read rejects |
| Conversation/first turn | F1 Station topic/message identity -> F2 runtime/SSE -> F3/F4 context/tool facts -> W8a tool consumer activation -> G-F -> W8b remaining consumer activation -> W9 | accepted topic/messages/turn survive restart; Desktop `ChatStore` and Browser one-shot path are deleted |
| Home Chat/Task write | F1/F2 kernel -> W2 canonical commands -> W6 ToolCall when required -> W8b UI -> W9 Gate | one accepted topic/Turn or Task/run under duplicate delivery; draft survives reject |
| Capability bind/readiness | W1 manifest/binding/snapshot -> W8a Agent Profile/tool consumers -> G-F -> W9 Gate | one versioned binding/readiness source; incompatible/stale input rejects before execution |
| MCP lifecycle/invoke | W1 binding -> W3/W6 substrate -> W8a canonical unavailable state -> G-F -> W4a lifecycle -> W4b invocation -> W8b UI -> W9 Gate | authoritative operation and one ToolCall result; cleanup terminal and leak-free |
| Connector lifecycle/invoke | W1 binding -> W3/W6 substrate -> W8a canonical unavailable state -> G-F -> W5a resource manifest -> W5b invocation -> W8b UI -> W9 Gate | pinned OAuth/resource revision, one result/trace, bounded revoke recovery |
| Streaming/server push/replay | F1 C02 identity -> F2 C05 event/cursor/replay -> W3 outbox -> W6 continuation -> W8a tool projection -> G-F -> W8b remaining projection -> W9 replay | ordered idempotent projection and one terminal state after reconnect/restart |
| Cancellation/timeout | W3 fences/cleanup -> W4/W6 operation/tool cases -> W7 Evaluation CAS -> W9 races | first durable fence wins; cleanup is terminal; no indefinite cancelling/reconnecting |
| Disconnect/restart/recovery | W2 Home revision -> W3/W4 executor reconciliation -> W5 OAuth revision -> W7 Evaluation restore -> W9 | Station readback reconstructs accepted work; client never infers terminal success |
| Overload/user spam/duplicate delivery | F1/F2 queue/admission -> W1 readiness -> W2 idempotency -> W3/W6 claims/fences -> W7 scheduler uniqueness | bounded queue/admission and original IDs; no duplicate provider/tool side effect |
| Deletion/revocation/retention | W1 retirement -> W6 dispatch fence -> W8a C12/D19 cutover -> W5/W7 retention -> W8b remaining cutover -> W9 races/search | no new admission; in-flight work settles; historical snapshots/tombstones obey `data-model.md §6` |
| Shutdown/cleanup | W3 cleanup lease -> W4 process/port/secret cleanup -> W6 receipts -> W8a ToolCall drain -> W8b remaining drain -> W9 leak audit | all resources terminal or typed `cleanup_failed`; no process/port/secret/debug residue |

### 5.2 Workstream Status

| Workstream | Status | Entry condition |
|---|---|---|
| W0 Contract/Evidence/Gates | complete | Owner EXECUTE approval received; W0 verification and completion audit PASS |
| F1 Agent/Conversation Authority | complete | W0 complete |
| F2 Runtime/Stream/Capability/Portability | complete | F1 |
| F3 Context/Resource Intelligence | core complete / C08 unproven | F2 |
| F4 Tool Policy/Observability | G1-A through G1-F and pre-W1 G1-XR diagnostic complete through AS-F03; post-W8a G-F pending | F2 + accepted D19A/D19B/D19C |
| W1 Capability Authority | implementation checks complete; product proof UNPROVEN until W9 Gate | F1-F4 implementation checks complete; Foundation diagnostic reaches AS-F04 |
| W2 Home Projection | pending | G-F complete 419-cell Foundation Gate |
| W3 Capability Operation Substrate | implementation checks complete; activation/proof deferred to W4/W8b | W1 |
| W4 MCP Lifecycle | pending | G-F + W3 + W6 invocation join |
| W5 Connector Resource Tools | pending | G-F + W1 + W3 + W6 invocation join |
| W6 Governed ToolCall Fencing | implementation checks complete; product proof deferred to W9 | W1 + W3 |
| W8a Capability/ToolCall Cutover | complete: MCA-D15K K1-K5 and AS-F04 source-matched Browser/Desktop runtime proof pass | W1 + W3 + W6 |
| G-F Complete Foundation Gate | in progress: exact-source run `20260830T080743547253Z-f94c424ec124071ff62ece0ba30f48a5` passed AS-F06 and advanced the first failure to Browser AS-F07 branch/edit/regenerate semantics; proof remains UNPROVEN | W8a |
| W7 Evaluation Aggregate | pending | W1 + W6 + G-F complete 419-cell Foundation Gate |
| W8b Remaining Consumer Cutover | pending | W2 + W4b + W5b + W7 |
| W9 Native Acceptance/Final Audit | pending | W8b |

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
checks. W1/W3/W6 then build complete C12 plus D19 governed ToolCall authority
behind inactive adapters; W8a performs their concern-atomic production cutover
before the complete G-F execution. W2/W4/W5/W7 begin only after G-F and remain
pre-cutover until W8b; their six V2 product Gates execute after W8b under W9.
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

#### G1-E — D19 Baseline Authority Cutover And Legacy Deletion

**Depends on**: G1-B, G1-C, and G1-D deterministic checks pass.

**Owner**: G1 production owner for the D19 baseline; no concurrent production
writer. W8a later integrates this authority with complete C12 policy and
readiness without restoring any deleted path.

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
  -> XR-5 clean commit + exact Station deployment + source-matched diagnostic
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
  diagnostic checks pass through the first dependency-blocked tuple.
- `tooling/scripts/review/agent-v2-old-paths.sh --closure C07,C09` reports
  zero unresolved live matches.
- Station, Desktop TS, and Desktop Rust checks pass on one stable source
  snapshot.
- Usage, feedback, and replay read back from Station for the exact Turn.
- No local Station was started; environment-backed evidence uses the approved
  `two` profile and external Evidence Store.

Only then may the source-matched diagnostic begin. The complete G-F Gate remains
blocked until W8a.

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

**Depends on**: W8a.
**Owns**: the C01-C10/A01-A14 advancement decision, not implementation.
**Entry condition**: W8a has atomically activated complete C12 capability
authority and D19 governed ToolCall authority after W1/W3/W6. Earlier
source-matched runs through AS-F03 are diagnostic evidence only. This unchanged
419-cell Gate is the only checkpoint allowed to report Foundation `PROVEN`.
**Status**: blocked on W8a. The following runs are diagnostic history, not
Foundation Gate passes. Commits through `cb8652436` repaired the profile-owned
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
Commit `5df06d8da` added the pre-W1 AS-F03 producer and oracle. Its
source-matched run
`20260827T044520664861Z-76d885df1d5db7d853df6997f4119d2c` reached the real
provider stream but observed reasoning/progress without a text delta inside the
60-second cancellation window, so it failed as `progressiveTextMissing`.
The next run uses the existing production `effort=low` request contract and an
immediate-text prompt; cancellation still waits for an actual text delta.
The source-matched `8d610c15f` run
`20260827T045315184423Z-d8fac63761253066106a96f367d9f4ef` proved that
`reasoning_effort=low` does not disable Ark Seed 2.1 Pro thinking: Station
persisted hundreds of ordered `thinking` deltas but no `text` delta within the
60-second text-cancellation barrier. The actor has no other advertised HTTP
model; its remaining models are rejected `trae-cli` runtime entries. AS-F03 is
therefore paused at `PRODUCT_AMENDMENT_REQUIRED`: decide whether Agent/Turn
configuration exposes an explicit provider-portable thinking mode
(`auto|enabled|disabled`). Mapping `low` to disabled or treating thinking as
answer text is forbidden because either silently changes product semantics.
On 2026-08-27 the Owner approved that contract: Agent configuration owns the
durable default, a Turn may explicitly override it, `auto` is the default, and
reasoning effort remains independent. AS-F03 requests `disabled` so it can
prove progressive answer text and cancellation without reinterpreting private
thinking as answer content. Implementation and source-matched rerun are in
progress; G-F remains `PARTIAL / UNPROVEN` until the rerun passes.
The implementation now carries the independent mode through Agent persistence,
Turn override, queue replay, compression, delegation, Tool continuation,
provider/model capability validation, and the immutable RuntimeSnapshot.
Historical snapshots migrate to effective `auto` with a recalculated canonical
hash. AS-F03 reads the persisted mode back from Station and rejects thinking
deltas while `disabled`; harness and Foundation producer paths now map back to
the G-F Gate. Focused Station Agent packages, Desktop checks/tests/build,
Mobile checks, 49 Foundation/proof-contract tests, Agent Domain validation, and
Acceptance Infra self-validation pass. The source-matched runtime rerun remains
pending.
The source-matched `22a627426` run
`20260827T074629271369Z-741e668ec785182b93fe37377bceeb02` persisted
`thinking_mode=disabled` in the AS-F03 RuntimeSnapshot, then failed before text
because Ark rejected the incompatible wire combination
`reasoning_effort=low + thinking.type=disabled`. Cleanup passed. The provider
adapter now omits reasoning effort when thinking is disabled; this preserves
the independent product controls without remapping `low` to `disabled`.
The source-matched `576ac2fbc` run
`20260827T075601574220Z-98a3cebd0b8e800a098b043dc664736f`
then produced text and reached the production cancellation/readback path.
It exposed an Acceptance producer bug: `TurnDiagnosticReplay` carries
authoritative `status` directly, but the AS-F03 evaluator attempted to read a
nonexistent nested `turn.status` and failed as `turnDiagnosticTurnMissing`.
The evaluator now reads the generated replay contract directly.
The source-matched `10715d391` run
`20260827T080148852745Z-6be2f7cf07f9b0013fedabcd5ca19ab4`
confirmed the Station Turn itself was `cancelled`, but exposed a second wire
normalization defect: generated Proto replay status is the numeric
`AgentTurnStatus` enum, not a lowercase string. AS-F03 now compares against the
generated `AgentTurnStatus.CANCELLED` value.
The source-matched `438d1e0db` run
`20260827T080921585076Z-4f993c704528d0b742aa5d0ee6b39c5c`
passed the AS-F03 direct-runtime oracle and advanced the first failing tuple to
`foundation-browser-direct / AS-F04 / en / single / sample-001`, where the
adapter failed closed because AS-F04 is not implemented. Cleanup passed. This
proves the AS-F03 runtime closure but does not make the 419-cell Foundation Gate
`PROVEN`; G-F remains `PARTIAL / UNPROVEN`.

```bash
test -n "${PT_ACCEPTANCE_ARTIFACT_ROOT:-}"
python3 tooling/scripts/acceptance-prove.py \
  --gate agent-v2-kernel-foundation-e2e \
  --proof-envelope-ref-out \
  "${PT_ACCEPTANCE_ARTIFACT_ROOT}/agent-v2-kernel-foundation-e2e-proof-envelope-ref.json"
```

The Gate emits independent C01-C10 cell results and all mandatory artifact
roles. It remains blocked until W8a completes, and then every required cell
must be source-matching `PROVEN`; a broad aggregate PASS is insufficient. It
executes all applicable
§8.3 quantitative workloads. P12 and CLI non-advertisement cells on Desktop
and Browser are mandatory. No hidden-candidate, certification, promotion, or
advertised-runtime cell exists in this plan. W9 reruns this Gate after all V2
cutovers to prevent foundation regression.

### W1 — Capability Authority

**Depends on**: F1-F4 implementation checks complete. The latest source-matched
Foundation diagnostic must reach AS-F04 without an earlier failure, but that
diagnostic is not a Gate and does not claim Foundation `PROVEN`.
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
- Reclassify the rejected Custom Plugin old-path entry out of C12 so W8a can
  prove complete C12 deletion without prematurely deleting the W8b-owned
  C14 product residue.

Staging and migration:

- Build and backfill the new authority without production consumers or
  dual-write.
- Record row counts, payload hashes, actor ownership, binding revisions, and
  rejected invalid legacy rows, including every embedded
  `store/agent.ts#chatConfig` Skill/Knowledge/MCP/Tool/Connector binding.
- Keep the new read/write entrypoints unreachable until W8a. W1 does not switch
  consumers or delete the old path.

Progress:

- Capability authority schema, generated bindings, Station persistence, and
  service-level CAS are implemented. Manifest versions and readiness snapshots
  are immutable; binding mutation validates both Agent version and binding
  revision; deletion retains an actor-scoped tombstone.
- The authority is registered for migration but has no production route or
  consumer before W8a.
- Deterministic startup backfill now imports builtin Tool, Skill, Knowledge,
  MCP, Connector, and client-native capability sources. It reconciles dedicated
  binding rows with embedded `chatConfig`, persists one hash-addressed report,
  and records malformed/unknown rows plus every Custom HTTP Plugin as typed
  rejection instead of inventing a manifest.
- Focused Agent tests, Desktop typecheck, Mobile contract tests, and Go style
  pass. C12 inventory coverage now has zero unregistered or unresolved
  matches. The 40 embedded binding matches remain intentionally classified as
  `deleted-authority` for W8a; the backfill reader is classified only as a
  historical migration reader. Rejected Custom HTTP Plugin residue is assigned
  to W8b-owned C14 rather than C12.
- Authority-backed readiness now joins the pinned runtime snapshot, current
  Agent/binding revisions, immutable manifest availability, required runtime
  capabilities, and the selected authenticated client capability session.
  Missing/stale facts fail closed with typed readiness states and reason codes.
  Its handlers compile but are deliberately absent from the production route
  table until W8a.
- Full Agent package tests, Desktop check plus 321 unit tests, Mobile Agent
  contract tests, changed-file formatting, and Go style pass. Product runtime
  proof remains assigned to `agent-v2-capability-binding-e2e` in W9.

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

**Depends on**: complete G-F `PROVEN`.
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

Progress:

- Proto now defines deadline-bearing Start plus ReportEvent, Reconcile,
  TakeOverOperation, and TakeOverCleanup commands.
- Station persistence now has separate operation, idempotency command, event,
  transactional outbox, business lease, and cleanup lease records.
- Start atomically validates the manifest and actor/device/session lease,
  creates the dispatched operation, first fenced business lease, outbox
  envelope, and idempotency result. Cancel uses expected revision CAS, releases
  the business lease, and enters bounded cleanup settlement under an
  independent cleanup epoch/fence.
- ReportEvent enforces monotonic sequence plus actor/device/session/lease,
  attempt-epoch, and business-fence identity. Invalid events leave the aggregate
  unchanged and persist a rejection audit fact; identical accepted events
  replay the current operation.
- Terminal intent always enters cleanup settlement. Business and cleanup
  takeovers advance independent epochs/fences, non-idempotent ambiguity becomes
  `UNKNOWN_SIDE_EFFECT`, and execution/cleanup deadline sweeps converge to
  bounded timeout or `cleanup_failed`.
- Focused tests prove same-payload replay keeps one operation/outbox/lease,
  cross-actor lease selection rejects, stale cancel revision rejects, old
  business fences reject, both takeover fences advance, and cleanup settles
  exactly once. Rejected late/stale events are retained as immutable audit
  facts without mutating the aggregate.
- Desktop now has a staged fenced operation executor that reports `RUNNING`
  before side effects, reports terminal intent, requires Station-issued cleanup
  authority, and reports cleanup success/failure separately. Device/session
  mismatch rejects before execution. The module is not attached to the worker
  supervisor before W4/W8b.
- Station ReportEvent/Reconcile/business takeover/cleanup takeover and
  execution/cleanup deadline sweeps are implemented. Accepted events use
  monotonic sequence CAS; stale or invalid events are retained in a separate
  rejection-audit table without mutating the aggregate.
- Operation Pull/Report/business-takeover/cleanup-takeover command domains use
  the existing D19B device-possession proof contract. New business and cleanup
  lease IDs are Station-issued; the client cannot choose either authority.
- Station operation pull allocates outbox sequence through the selected
  capability lease's monotonic cursor. Desktop transport signs pull/report
  requests with the existing actor-device command proof and rejects operations
  targeted at another device or session.
- Focused Station tests cover event replay, stale business and cleanup fences,
  terminal cleanup settlement, both lease takeovers, execution timeout, and
  cleanup deadline failure. Desktop binary tests cover the three-report
  execute/cleanup sequence and pre-side-effect device rejection.
- Desktop encrypted operation ledger and polling worker persist per-Station/
  session cursors and operation/fence checkpoints. Restart reconciliation never
  re-executes a non-idempotent operation whose Station state may have crossed
  the side-effect boundary.
- W3 implementation checks pass for Station operation/cleanup/receipt tests and
  Desktop `capability_operation` tests. Production route registration,
  supervisor activation, and concrete MCP operation mapping remain deferred to
  W4/W8b as required by the dependency graph.

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

**Depends on**: complete G-F `PROVEN`; W3 for W4a; W6 and W8a for W4b
invocation closure.
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

**Depends on**: complete G-F `PROVEN`; W1 and W3 for W5a; W6 and W8a for W5b
invocation closure.
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
**Owns**: D19 governed ToolCall slice of C13 and A19; consumes W1-owned C12
bindings and W3-owned execution substrate.

**Target roots**: canonical ToolCall proto, Station decision/claim/outbox/
receipt/result services and persistence, Desktop Rust executor receipt store,
Desktop approval projection, and deterministic side-effect counter fixture.

Deliverables:

- unique decision, claim, outbox envelope, fenced receipt attempts, result.
- PREPARED/APPLIED durable receipt and external idempotency key.
- dispatch/cancel/revoke/delete linearization.
- idempotent replay or `UNKNOWN_SIDE_EFFECT`.
- exactly-one result-to-model continuation.
- Split old-path inventory entries into `C13-TOOLCALL` and
  `C13-OPERATION`; the former is W8a-deletable while the latter remains for
  W8b.

Progress:

- Added a staged authority-only proposal path that joins the actor/Agent-bound
  manifest version, binding revision, immutable readiness snapshot, and
  selected client capability session before any ToolCall or outbox row exists.
- Binding policy is the decision source for authority-backed proposals;
  disabled/stale bindings, retired manifests, expired/mismatched snapshots, and
  non-ready capability entries fail closed and roll back the whole batch.
- ToolCall rows now preserve manifest, binding, and readiness snapshot lineage.
  Existing decision/claim/PREPARED/APPLIED/result/continuation fencing tests and
  Desktop client-capability receipt tests pass. The legacy proposal entrypoint
  remains active only until the W8a atomic consumer switch.

Cutover preparation:

- Identify the Desktop in-memory approval registries and unfenced local
  ToolCall dispatch for W8 deletion.

```bash
(cd apps/station && go test ./app/subserver/agent/... -run 'ToolCall|ExecutionClaim|SideEffectReceipt|DispatchFence')
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml client_capability
tooling/scripts/review/agent-v2-old-paths.sh --inventory-only --closure C12,C13-TOOLCALL
```

Final product Gate executed by W9: `agent-v2-governed-tool-loop-e2e`.
Evidence: one decision/claim/result lineage, PREPARED/APPLIED receipts, both
race orderings R-03/R-05/R-07, counter <=1, replay equality, and typed
`UNKNOWN_SIDE_EFFECT`.

### W7 — Evaluation Aggregate

**Depends on**: W0, W1, W6, and complete G-F `PROVEN`.
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

W8 is split by authority concern so each cutover is atomic and testable without
activating a second source of truth.

#### W8a — Capability And ToolCall Atomic Cutover

**Depends on**: W1, W3, W6.

**Owns**: complete C12 activation/migration/deletion and D19 governed ToolCall
activation/deletion required to make AS-F04 production-reachable. Complete C13
CapabilityOperation activation remains outside W8a.

**Target roots**: Station Manifest/Binding/Readiness and governed ToolCall
services; every Tool/MCP/Connector/Skill/Knowledge binding/readiness consumer;
Desktop Agent Profile capability projection, `toolRuntime`, Tool cards,
Desktop Rust fenced executor, Browser capability routing, and the C12/D19
old-path inventory in §3.1.

Deliverables:

- Activate Manifest/Binding/Readiness across every C12 consumer and governed
  ToolCall reads/writes in one versioned deployment.
- Switch Agent Profile, `toolRuntime`, Tool cards, Desktop Rust executor, and
  Browser routing to the canonical contracts.
- MCP/Connector bindings resolve through C12, but readiness remains typed
  `unavailable` until W4/W5. Legacy selectors cannot answer readiness.
- Drain or fence active legacy ToolCalls; no in-flight item changes owner
  without a durable claim/receipt outcome.
- Delete embedded binding truth, residual non-`toolRuntime` approval
  projection, unfenced dispatch, and parallel readiness selectors.
- Split the old-path inventory so D19 governed ToolCall authority has the
  executable `C13-TOOLCALL` closure distinct from retained pre-W8b
  CapabilityOperation paths.
- Activate AS-F04 production fixtures: binding policies for
  auto/manual/deny/expiry; a Desktop device-local executor; a Browser
  Station-owned governed tool; loop-budget and duplicate delivery; persisted
  decision/claim/receipt/result/batch lineage; ToolCall-bound side-effect
  counters; and replay readback.
- Make the unchanged complete G-F Gate eligible. G-F, not W8a, executes the
  Gate; AS-F04 remains `UNPROVEN` until that Gate passes.

Progress:

- Station now exposes the canonical Manifest/Binding/Readiness handlers and
  routes. The former runtime-only readiness selector and its tests are deleted.
- Turn admission now persists the immutable W1 readiness snapshot ID on
  `TurnAttempt` separately from the runtime admission snapshot. Device-local
  ToolCalls resolve the exact READY binding from that pinned snapshot and enter
  only the authority-backed proposal path.
- The legacy static risk/deny proposal entrypoint is deleted. C13-TOOLCALL
  reports `unresolvedCount=0`, and Agent package tests pass.
- Local capability backfill now uses the executor protocol identities
  (`filesystem.read/1`, `mcp.invoke/1`, and peers) so W1 bindings can join the
  capability lease without an ID/version split. MCP remains explicitly
  unavailable until W4.
- Desktop Rust/Web Manifest/Binding/Readiness transport, the
  `agent-capability` runtime projection, Agent Profile/Sidebar/Connector
  consumers, package refs, and Acceptance cleanup now use the canonical
  authority. C12 and C13-TOOLCALL both report `unresolvedCount=0`.
- Agent updates and live binding revision rebases now commit in one DB
  transaction and publish `agent.authority.invalidated`; Station Agent tests,
  Desktop check/338 tests/build, Rust authority/package/receipt tests, and Go
  style pass.
- Native Desktop now consumes the shared Agent SSE through one extracted
  parser/stream owner; `agent-capability` maintains bounded per-Agent authority
  subscriptions, refreshes the affected projection immediately, and retains
  periodic reconciliation for dropped events. Browser keeps the existing
  resync fallback because the browser gateway has no Tauri event channel.
- Semantic audit found closure work not represented by the original text-only
  inventory: Turn requests can still supply Knowledge resources directly,
  Station-owned Tool/Skill execution can bypass the pinned readiness snapshot,
  and an Agent revision change makes every live binding stale. W8a therefore
  also owns removal of request-supplied Knowledge authority, one authorized
  capability set for prompt and execution, and transactional binding revision
  rebasing with Agent updates.
- `MCA-D15K` is accepted: Station owns the versioned Knowledge descriptor,
  immutable Station content refs, and opaque client resource refs. W8a resumes
  with Turn request authority removal, descriptor/manifest/binding closure,
  and exact snapshot-pinned Knowledge retrieval; static closure alone does not
  promote W8a or G-F runtime proof.
- Package export/import must carry the portable manifest/resource dependency
  closure and must not leave a created Agent with partially imported bindings.
  Compensating client requests are not sufficient proof of atomic import.

Accepted MCA-D15K execution closure:

1. **K1 Contract and persistence** — add proto-first
   `KnowledgeResourceDescriptor` create/update/list/tombstone contracts and
   actor-scoped immutable revisions. Persistence and manifest publication commit
   atomically.
2. **K2 Migration and binding** — migrate embedded Knowledge descriptors as
   historical input, publish exact Knowledge manifest versions, and reconcile
   live bindings without retaining a second mutation authority.
3. **K3 Turn authority cutover** — remove and reserve request-supplied Knowledge
   fields; derive one authorized Knowledge/Skill/Tool set from the pinned
   readiness snapshot before prompt assembly or execution.
4. **K4 Desktop and package cutover** — Profile mutates descriptors/bindings
   through typed commands; package preflights portable descriptors and returns
   unresolved client-local dependencies before Agent creation.
5. **K5 Proof and deletion** — prove actor isolation, stale revision rejection,
   disabled omission, local-session fencing, restart readback, and no partial
   package import; delete embedded Knowledge writes and runtime path/URL reads.

K1 implementation evidence (2026-08-28):

- Descriptor revisions, bounded Station content, command receipts, actor-owned
  Knowledge manifest versions, and CRUD handlers are registered in Station.
- Manifest ownership is enforced for catalog list, binding, retirement, and
  invalidation fan-out. Descriptor tombstone retires every historical manifest
  revision so deleted resources cannot receive new admission.
- Manifest registration uses database-native conflict handling compatible with
  PostgreSQL transactions. Descriptor and binding command replay preserve the
  original immutable mutation result after later lifecycle changes.
- `./model/build.sh`, Agent package tests, focused race tests, Desktop type
  checks, Go style, and diff checks pass. K1 runtime product proof remains
  `UNPROVEN` until K5/W9.
- Residual before K5: the shared binary-protobuf typed-handler error path still
  needs a canonical `ErrorResponse` envelope; current handlers otherwise risk
  returning an empty protobuf error body.

K2 implementation evidence (2026-08-28):

- Startup backfill parses string- or array-encoded legacy
  `config_json.knowledgeResources`, derives actor-scoped deterministic
  descriptor identities, and atomically commits descriptor/content revision,
  owned manifest, canonical binding, migration receipt, legacy authority
  retirement, and immutable reconciliation report.
- Plain bounded document content is ingested as Station content. Mutable URLs,
  local paths, and client-local resource classes fail closed into stable
  rejection reason codes without persisting or reporting the raw locator.
- Legacy JSON and join rows remain read-only migration input until K4/K5 remove
  their writers/readers. The initial import report is distinct from the stable
  reconciliation report; subsequent startup and database reopen preserve the
  same descriptor and binding identities without overwriting canonical policy.
- K2 focused tests, focused race tests, Agent package tests, Desktop type
  checks, Go style, and diff checks pass. Runtime migration proof remains
  `UNPROVEN` until K5/W9.

K3 implementation progress (2026-08-28):

- `ExecuteTurnRequest.knowledge_resources` is removed and reserved; Desktop
  Rust/TypeScript no longer forwards that field.
- Turn admission now resolves and persists readiness before prompt assembly,
  then loads one actor/session-bound `AuthorizedCapabilitySet` from the pinned
  snapshot. Prompt skills, Station tools, client tools, and Knowledge consume
  that set.
- Knowledge retrieval now reads only immutable Station content revisions with
  descriptor/content hash checks. Direct filesystem, directory, and mutable URL
  loaders are deleted.
- JSON and protobuf Turn routes reject non-empty legacy field 13 before
  deserialization, including mixed snake/camel aliases. Scoped Agent tests,
  focused race tests, Desktop type checks, Rust compile, Go style, diff checks,
  and the guard/inventory reconciliation pass. K3 runtime proof remains
  `UNPROVEN` until K5/W9.

K4 implementation evidence (2026-08-28):

- Desktop Profile now mutates Knowledge descriptors and canonical capability
  bindings through generated contracts, while the `agent-capability` runtime
  remains the sole descriptor/binding/readiness projection owner.
- Desktop package export/import uses the generated Station package contracts.
  The former Desktop-local package authority, create-then-bind compensation,
  rollback helpers, public legacy commands, and duplicate package DTOs are
  deleted.
- Marketplace Agent installation converts the external JSON artifact into an
  `AgentPackageDocument`, submits one Station atomic import with a stable
  idempotency key, and returns unresolved dependencies without recording a
  partially imported Agent.
- Station package tests, Desktop 343 tests, Desktop production build, Rust
  package/authority tests, Rust compile, Go style, diff checks, and C12 plus
  C13-TOOLCALL old-path reconciliation pass. K4 runtime product proof remains
  `UNPROVEN` until K5/W9.

K5 implementation and scoped-proof evidence (2026-08-28):

- Removed the obsolete Knowledge/Skill/MCP binding CRUD messages from
  `agent_config.proto` and regenerated Station, Desktop, and Mobile Web
  contracts. Historical database rows remain read-only migration input until a
  source-matched migration/readback run permits their reader to be removed.
- Actor isolation, descriptor revision CAS/tombstone, stale binding rejection,
  disabled Knowledge omission, package dependency preflight/zero-write
  behavior, package rollback, idempotent replay, database restart readback, and
  actor/device/session-scoped opaque local-resource fencing pass focused Station
  and Desktop Rust tests, including the focused Go race suite.
- Desktop typecheck, 343 tests, production build, Mobile check, Agent proto
  coverage, Go style, diff checks, and C12 plus C13-TOOLCALL old-path
  reconciliation pass. These are implementation/scoped evidence only;
  AS-F04 and all Foundation runtime cells remain `UNPROVEN`.

AS-F04 implementation progress (2026-08-28):

- Station-owned tools now enter the same binding-policy, decision, claim,
  result, batch, and unique-continuation authority as client-owned tools.
  The continuation worker durably claims each approved Station tool before
  invoking its production handler.
- Turn diagnostic replay now includes the exact manifest/binding/readiness,
  decision/claim/fence/receipt/result/batch/continuation lineage and persisted
  execution/duplicate counts needed by the source-bound oracle.
- Desktop Rust persists a ToolCall-keyed side-effect-start counter in the
  receipt ledger and exposes it through runtime evidence; duplicate terminal
  replay does not increment the counter.
- AS-F04 is registered in the direct adapter and Group One matrix, and the
  actual Foundation runner independently recomputes Harness assertions from
  scenario facts. Focused Python oracle tests, Desktop typecheck, Agent Go
  tests, Rust receipt/runtime-evidence tests, Go style, diff checks, and Agent
  Acceptance structural validation pass.
- The live `foundationDirectProbe` now drives canonical binding policy
  mutations, real Turn execution, manual decision replay, expiry, loop-budget
  exhaustion, Station diagnostic replay, and Desktop ToolCall-keyed side-effect
  counters. AS-F04 and the complete Foundation Gate remain `UNPROVEN` until the
  source-matched profile `two` run passes.
- Source-matched run
  `20260828T065046273691Z-4d541aa9882e857cff44a2f6aa5838ac`
  reached Browser AS-F04 after AS-F01 through AS-F03 passed, then timed out on
  the auto case. Station readback showed the Turn completed with
  `tool_iterations=0`, no ToolCall/ToolBatch/continuation rows, and
  `ToolDefinitionTokens=0`, while its pinned readiness snapshot contained the
  READY `skills_list` binding. The root cause is therefore the Station
  provider boundary: authorized Tool schemas are not passed to the provider
  and structured provider ToolCalls are not preserved for the governed
  ToolCall loop. W8a must close that provider/Turn integration and add focused
  regression coverage before rerunning Foundation; prompt-only steering,
  parsing arbitrary assistant JSON, or relaxing the Harness is forbidden.
- Source-matched rerun
  `20260828T073454638216Z-6ae190d3fd51b7504e49b2839c2b77f6`
  proved the native provider ToolCall reached `tool iteration 1`, then exposed
  the next persistence defect: the 24-character manifest version was written
  into `agent_tool_calls.schema_version varchar(20)`, rolling back the
  ToolBatch transaction. The ToolCall schema must use the same 64-character
  version bound as the canonical manifest, and terminal failure fields must be
  bounded independently so an underlying persistence error cannot leave the
  Turn running. Cleanup passed; AS-F04 remains `UNPROVEN`.
- Source-matched rerun
  `20260828T074934530974Z-544bd56d178952c1975a02fca4c7638c`
  proved Browser auto policy end to end: one Station-owned `skills_list`
  execution, one result, one continuation, and a completed Turn. The next
  failure moved to manual approval because the Desktop HTTP Gateway omitted
  the already-canonical `agent_submit_tool_decision` application command and
  returned `unknown command`. W8a must expose that same Rust application
  command through the Browser gateway; adding Browser-owned decision logic or
  bypassing Rust is forbidden. Cleanup passed; AS-F04 remains `UNPROVEN`.
- Source-matched rerun
  `20260828T075719129518Z-8a43827694b3398ceb06297c0c6459f8`
  proved auto/manual execution exactly once, deny/expiry zero execution, and
  the 25-iteration runtime loop bound. The independent oracle then rejected
  `manualApprovalExecutedOnce` because the diagnostic contract omitted the
  persisted `ToolCall.approved` fact, causing the Harness to classify a
  successful manual decision as denied. Add that source-backed field
  proto-first and regenerate Station, Desktop, and Mobile Web contracts;
  deriving approval from the terminal status is forbidden. Cleanup passed;
  AS-F04 remains `UNPROVEN`.
- Source-matched run
  `20260828T081151162769Z-b7abdf91b97410ddd1022b4da264a2ad`
  passed AS-F04 for Browser and Desktop through the independent oracle. It
  proved auto/manual execution exactly once, deny/expiry zero execution,
  duplicate replay identity, durable authority lineage, and the exact
  25-iteration loop bound. The complete Gate then advanced to AS-F05 and
  failed closed because that direct-runtime group is not implemented.
- The later exact-source `e15fc07bc` run
  `20260828T165050367799Z-2c9ed1a206d665dd1c55cea5541872d4`
  stopped earlier at Browser AS-F04 `zh-CN` with
  `loopBudgetEnforced=false`; cleanup and redaction passed. Since AS-F04 had
  already produced a source-matched pass and the current loop stimulus depends
  on a real provider voluntarily continuing tool calls, this sample requires a
  trace-level diagnosis of observed iterations, configured limit, terminal
  reason, and post-limit execution before any retry or assertion change.
  Foundation remains `PARTIAL / UNPROVEN`.
- Station readback identified the failing Turn as
  `turn_34beff56135d004d23093c4f`: it completed normally after 16 successful
  `skills_list` ToolCalls and 17 provider calls, while the immediately
  preceding tuple reached 25 ToolCalls. This proves the fixture depends on the
  provider voluntarily continuing and therefore cannot deterministically prove
  exhaustion. Source review also found that the Turn loop still uses a
  hard-coded 25-round bound instead of the pinned D09 `RuntimeBudget`, and
  reports exhaustion as ordinary completion. The mechanical plan correction is
  to carry the already-defined lower requested budget through the active Turn
  contract, pin and enforce it in Station, persist a typed exhaustion outcome,
  and make AS-F04 use that production contract. Prompt-only steering,
  retry-until-green, and synthetic provider evidence remain forbidden.
- The D09 checkpoint now carries `requested_budget` through the canonical
  Browser/Tauri `ExecuteTurnRequest`, resolves it lower-only against Station
  policy, and persists the effective budget in the immutable TurnAttempt
  runtime snapshot. Initial execution and continuation both enforce total and
  identical ToolCall bounds before dispatch or another provider call; budget
  exhaustion terminates with `TOOL_LOOP_BUDGET_EXHAUSTED` and
  `max_tool_calls_exhausted`. Diagnostic replay reads the persisted limit, and
  AS-F04 requests a two-call limit and independently verifies the requested,
  effective, observed, terminal, and zero-post-limit facts. Agent Go tests and
  focused race tests, Desktop 344 tests/build, Mobile check, 78 Foundation
  Python tests, Agent Acceptance validation, Go style, and diff checks pass.
  Shared and Mobile Web protobuf bindings were regenerated; the optional
  native Kotlin/Swift generation path remains unavailable because the local
  native protoc plugins are not installed. Runtime proof remains `UNPROVEN`
  until this checkpoint is committed and deployed.

**W8a checks**:

```bash
(cd apps/station && go test ./app/subserver/agent/... -run 'CapabilityManifest|AgentCapabilityBinding|Readiness|ToolCall|DispatchFence')
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml tool_call_receipt
(cd apps/desktop && pnpm run test -- toolRuntime)
tooling/scripts/review/agent-v2-old-paths.sh --closure C12,C13-TOOLCALL
```

**W8a done**:

- C12 reconciliation is exact and every consumer uses one canonical authority.
- Legacy ToolCall authority is drained/deleted with no split ownership.
- C13 CapabilityOperation remains inactive; MCP/Connector readiness is
  explicitly unavailable without legacy fallback.
- AS-F04 fixtures and evidence readback are production-reachable; G-F itself is
  still `UNPROVEN` until separately executed.

#### W8b — Remaining Desktop And Browser Consumer Cutover

**Depends on**: W2, W4b, W5b, W7, and complete G-F `PROVEN`.

**Owns**: the remaining activation, migration verification, consumer switch,
and old-authority deletion for C11/C13 CapabilityOperation/C14/C15 plus
residual cross-cutting UI.

**Target roots**: C11/C13/C14/C15 consumers in §3.1; Desktop
runtime/page/component registries, browser gateway,
`packages/locales/{en,zh-CN}/agent.json`; rejected Custom Plugin
page/store/navigation/localStorage/direct-fetch files plus Model/Station
proto/CRUD/persistence/table roots; prototype synchronization; and operational
knowledge entries covering changed paths.

Deliverables:

- Production UI conforms to confirmed prototype and UI Identity.
- Runtime descriptors own Home/capability/Evaluation projections.
- Home, MCP operation, Connector resource, and Evaluation consumers use
  canonical contracts only. C12 binding/readiness and governed ToolCall
  consumers were already cut over by W8a and must not regress.
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

1. Freeze remaining mutable legacy Evaluation writes and all Custom Plugin
   create/update/test/direct-fetch paths for the migration window.
2. Backfill and compare remaining actor-scoped counts, IDs, payload hashes,
   revisions, tombstones, and retained historical snapshots.
3. Record Custom Plugin actor-scoped row/key counts and non-secret metadata
   hashes only. Automatic import is forbidden because no accepted successor
   mapping exists.
4. Activate remaining canonical Station reads/writes and Desktop/Browser
   projections, including C13 CapabilityOperation, in the W8b versioned
   deployment.
5. Irreversibly purge the Custom Plugin localStorage credential key and Station
   rows/table, then delete its page/store/proto/generated/CRUD/persistence
   paths and every other old authority in the same closure.
6. Rollback is permitted only before step 5. After secret/data purge begins,
   the deployment is roll-forward-only; no compatibility or credential backup
   is retained.

Checks:

```bash
(cd apps/desktop && pnpm run check && pnpm run test && pnpm run build)
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
(cd apps/mobile && pnpm run check && pnpm run test:agent-contract)
tooling/scripts/review/agent-v2-old-paths.sh --closure C11,C13,C14,C15
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

**Depends on**: W8b.

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

F1-F4 own the initial C01-C10 foundation cutovers. W8a owns complete C12 and
D19 governed ToolCall activation/deletion before the complete G-F run; W8b owns
C11/C14/C15 plus C13 CapabilityOperation activation/deletion. W1-W7 may create
unreachable target implementations and backfill data, but may not activate a
second live read/write authority outside their concern-owning cutover.

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
| MCP operation | Station operation + client executor | W8a makes its C12 binding/readiness canonically unavailable; W8b activates operations only after W4b, then pre-cutover local operations drain or are cancelled and cleanup-audited | client-only terminal/progress authority; local process/config executor retained | cancel/reconnect/takeover/cleanup proof and no leaked process/port/secret |
| Connector tools | OAuth owner + resource manifests + binding | W8a activates C12 binding with canonical unavailable readiness until W5b; W8b activates resource-backed invocation after pinned revision checks | `enabledTools`/labels as readiness or binding identity | expiry/revoke/invocation cells, provider-revoke outcome, scoped tree search |
| ToolCall | fenced decision/claim/receipt/result | W8a drains pre-cutover calls; no call changes owner without a durable claim; unresolved non-idempotent work becomes `UNKNOWN_SIDE_EFFECT` | residual non-toolRuntime approval projection and unfenced local dispatch; Rust waiter already deleted by F4 | all crash/race barriers, counter <=1, replay equality, scoped tree search |
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
- The exact-source `0dd9749b2` run
  `20260828T175353594892Z-f6aec38fb7f6ca76df645a7834bfce6c`
  failed Browser AS-F02 `zh-CN` with
  `agent.acceptance.foundationActiveTurnCancelMissing`; cleanup passed.
  Station truth showed the Turn reached `waiting_local_tool` and was
  authoritatively cancelled with `terminal_reason=cancelled_by_user`, but the
  direct cancellation path had no live execution sink and persisted no
  `cancelled` TurnEvent. `RequestCancelTurn` now writes that same durable typed
  terminal event after cancelling a waiting Turn, allowing Browser replay to
  observe Station truth without client inference. Focused service and race
  regressions pass; runtime proof remains `UNPROVEN`.

### AS-F03 Progressive Turn, Tool Waits, And Terminals
- **Precondition**: Delayed provider and tool/approval fixtures.
- **Action**: Stream a turn through waiting approval/tool/compression/retry states; cancel during text, approval, and tool waits.
- **Expected**: Progressive events and exactly one authoritative completed/partial/failed/cancelled/interrupted terminal state.
- **Failure variant**: Provider timeout/rate limit/retry exhaustion stays typed; transport loss alone never marks failed.
- **Evidence**: Native/Browser DOM, raw event timestamps/sequences, provider cancel, Station Turn/Trace.
- **Diagnostic result**: the pre-W1 source-matched run demonstrates ordered progressive text,
  production cancellation during text, one authoritative cancelled terminal,
  and durable Station Turn/Attempt/Trace readback. Tool/approval waits and
  cancellation remain mandatory W6 evidence because governed ToolCall
  decision/claim/result authority does not exist before W1/W3/W6. This changes
  dependency ownership only; it is not a Gate pass and does not remove or
  reduce any of the 419 Foundation tuples or final quantitative workloads.
- **Status**: pending

### AS-F04 Tool Policy Auto, Manual, Deny, And Expiry
- **Precondition**: Safe auto-approved tool, manual-risk tool, and deny policy.
- **Action**: Trigger each policy, approve/deny once, allow one decision to expire, and force duplicate delivery.
- **Expected**: `POLICY_CHECK -> AUTO_APPROVED/AWAITING_USER`; manual approval executes once; deny/expiry executes zero.
- **Failure variant**: Executor disconnect/timeout/cancel remains terminal and recoverable; loop budget stops repeated calls.
- **Evidence**: DOM, policy/decision/execution/result rows, side-effect counter, replay equality.
- **Dependency amendment**: full AS-F04 proof runs after W1/W3/W6 and W8a.
  W1 owns configurable manifest/binding approval policy, W3 supplies the shared
  lease/outbox/cleanup substrate without activating C13 CapabilityOperation,
  and W6 owns fenced decision/claim/receipt/result plus the ToolCall-bound
  side-effect counter. Pre-W1 code has no production deny-policy configuration,
  Browser advertises no local executor, and current diagnostics omit the
  required receipt/batch lineage. An Acceptance-only proposal endpoint, mutable
  deny map, synthetic executor result, or deferred assertion reported as passed
  is forbidden. The tuple remains `UNPROVEN` until W8a and the complete G-F run.
- **Status**: source-matched Browser/Desktop runtime proof passed in
  `20260828T081151162769Z-b7abdf91b97410ddd1022b4da264a2ad`

### AS-F05 Attachment And Resource Admission
- **Precondition**: Valid PNG/PDF plus oversized, unsupported, unauthorized, and failed-upload fixtures.
- **Action**: Select, validate, upload, attach, remove/retry one failure, send, restart, and reopen.
- **Expected**: Valid opaque refs progress to ready/attached/consumed or explicit omitted; valid siblings survive one failure.
- **Failure variant**: Invalid/unauthorized resources reject before provider call and never expose local paths.
- **Evidence**: Composer DOM, object/resource rows, model-visible trace, zero provider execution for rejected refs.
- **Status**: in progress. Source inventory after AS-F04 proof found that the
  Desktop composer uploads encrypted legacy `ChatAttachmentInput`, while the
  active `ExecuteTurnRequest` silently drops it and Station persists no
  attachment provenance. The accepted C08 closure requires:
  1. actor-private, Station-readable OSS upload for Agent inputs;
  2. portable `AgentAttachmentRef` on the canonical Turn request;
  3. pre-provider owner/expiry/checksum/MIME/count/byte/model admission;
  4. attachment metadata on the user message and an attributed
     `CONTEXT_SEGMENT_TYPE_ATTACHMENT` ledger segment;
  5. provider-native consumption when the selected model proves image/file
     input, otherwise explicit attributed omission before provider assembly;
  6. restart/download readback and explicit object cleanup;
  7. source-backed Browser/Desktop Harness facts and independent oracle.
  Raw paths, client encryption keys, arbitrary URLs, silent omission, and an
  Acceptance-only attachment endpoint are forbidden.
- **Implementation checkpoint (2026-08-28)**: the canonical Turn request now
  carries `AgentAttachmentRef`; Desktop uploads PNG/PDF bytes into an
  actor-private `personal` OSS object bound immutably to the preallocated
  conversation scope; Station validates owner, scope, expiry, content
  signature, MIME, size, checksum, count, and byte budget before Turn
  persistence. Message/cache readback preserves attachment metadata, the
  ContextLedger records explicit model omission when binary provider mapping is
  unavailable, Browser and Native use the same upload/resolve/delete product
  commands, and queued expiry plus idempotent replay fail closed without
  provider execution. The AS-F05 Harness now records Station/message/ledger,
  real upload retry and object deletion, provider-call deltas, DOM attachment
  visibility, authorized download checksum, and verified object cleanup. Static,
  unit, and structural checks pass; source-matching runtime proof remains
  `UNPROVEN` until profile `two` is deployed and the Foundation Gate reruns.
- The source-matched `d4aa25204` run
  `20260828T102252894011Z-58d5aa8e6b76058e71c4d38ed6e43d32`
  reached Browser AS-F05 and failed with `agent.errors.attachmentRejected`;
  cleanup passed. The root cause was test-object aliasing under actor-scoped
  CAS: valid, retry, and negative PNG fixtures reused identical bytes, so they
  resolved to one object. AS-F05 now salts each PNG fixture while preserving
  valid content signatures. Conversation scope remains a Turn-ref constraint;
  actor ownership and private visibility remain the OSS authorization boundary,
  so identical user content can be reused across conversations without
  rebinding or invalidating an earlier Turn.
- The next source-matched run on `5d1bd5b84` again reached Browser AS-F05 and
  exposed the storage-strategy dependency: profile `two` uses random OSS keys,
  whose upload path previously left `sha256` empty. Agent attachment integrity
  now requires both random and CAS key strategies to hash and persist uploaded
  bytes; key strategy controls addressing only, never checksum availability.
- The source-matched `c9aa1e1e2` run reached Browser AS-F05 and reported
  cleanup failure after product execution. A direct Station probe on the same
  commit proved upload, pre-admission, explicit omission, ledger event, and
  provider start. The Harness teardown previously allowed cleanup failure to
  mask an earlier scenario exception; it now preserves the primary failure so
  the next run reports the exact remaining product/readback assertion while
  still attempting cleanup.
- The source-matched `c5e82a269` run
  `20260828T143811340604Z-d070de3e792f3584677bb2b6af31bdbf`
  preserved the Browser AS-F05 primary failure as
  `Cannot read properties of undefined (reading 'length')`; Gate execution
  remained `PARTIAL / UNPROVEN`, while outer cleanup and redaction passed.
  The failing producer dereferenced an omitted `providerCalls` collection in
  `foundationExecutionSnapshot`; this is an Acceptance normalization defect,
  not evidence of provider execution or a Station attachment rejection.
- After normalizing omitted provider-call evidence, the source-matched
  `ce1f6704a` run
  `20260828T145731482275Z-d64e547798278d2032e2f3b330481284`
  failed earlier at Browser AS-F02 `zh-CN` with
  `rejectedDraftRestored=false`; cleanup and redaction passed. The periodic
  Agent topic reconciliation compared a persisted canonical Agent ID with the
  Agent display name and could switch the active conversation before the draft
  was sampled. This is a Desktop runtime projection identity defect, not a
  locale-specific failure or permission to weaken the AS-F02 draft contract.
- Commit `9e7c26211` corrected the Agent ID/display-name mismatch and added a
  deterministic runtime regression. Its first source-matched run was interrupted
  at Browser AS-F01 when the real provider exhausted its 120-second HTTP
  deadline; Station retry subsequently completed, so the run remains an
  external-latency `FAILED / UNPROVEN` sample rather than a product pass. The
  next run
  `20260828T152315053204Z-438f83240fc7631e46886f8668bde597`
  advanced through the prefix to Browser AS-F05 and failed the independent
  oracle on `authorizedDownloadVerified`,
  `failedUploadRemovalPreservedSiblings`, and
  `unauthorizedRejectedBeforeProvider`; source identity matched and cleanup
  passed.
- The follow-up closure forwards the active bearer token when the Desktop OSS
  resolver downloads an actor-private object from its bound Station, retains
  anonymous public and peer-token federation behavior, and verifies that
  deleting one cache entry preserves sibling entries. The AS-F05 producer now
  keeps the original conversation scope when exercising cross-conversation
  rejection and bypasses the browser HTTP cache for read-after-delete checks.
  These changes require a new source-matched Foundation run before any AS-F05
  assertion can be promoted.
- The exact-source `31fa299c1` run
  `20260828T155949944295Z-9aa010f6ae609e980865f1b1c4223f2d`
  retained `cleanup: passed` and advanced the unauthorized negative path:
  `unauthorizedRejectedBeforeProvider` no longer failed. Browser AS-F05 still
  failed `authorizedDownloadVerified` and
  `failedUploadRemovalPreservedSiblings`. Both Browser and Native logs record
  the same bound-station cache miss as `oss network error: builder error`.
  Profile `two` advertises the capabilities host sentinel `self`; the Desktop
  cache path currently concatenates that sentinel into `self/sub-oss/file`,
  which is not an absolute request URL. The architecture contract defines
  `self` as the bound Station origin, so the next implementation checkpoint
  must resolve the sentinel at the capabilities boundary and retain independent
  download, delete, and sibling-preservation assertions. AS-F05 and the full
  Foundation Gate remain `PARTIAL / UNPROVEN`.
- The follow-up Desktop checkpoint canonicalizes empty/`self` capability hosts
  against the origin that was actually queried, preserving foreign Station
  semantics while unifying bound-Station cache lookup, write, and invalidation.
  File request URLs are now built with the structured URL API so actor-private
  downloads cannot degrade into renderer-relative requests. Focused
  verification passes: 23 OSS cache tests, Desktop TypeScript check, 67
  Foundation scenario/probe/static tests, Rust `cargo check`, formatting, and
  `git diff --check`. Runtime proof remains `UNPROVEN` until this checkpoint is
  committed, deployed, and exercised by a new source-matched Foundation run.
- The source-matched `e5ffbd366` run
  `20260828T163131562645Z-91391916156a9a8624bc58875b5d17ce`
  no longer reported the two explicit download/sibling product-fact failures.
  It stopped at Browser AS-F05 because the Harness assertion map differed from
  the independent Python oracle, but the probe emitted only a generic mismatch
  and the all-or-nothing producer did not persist the underlying facts.
  Execution remained `PARTIAL / UNPROVEN`; cleanup and redaction passed. The
  next evidence checkpoint must preserve fail-closed comparison while reporting
  only the differing assertion keys and boolean values so the next run exposes
  the unique owner without leaking scenario payloads or credentials.
- The exact-source `769de77d5` run
  `20260828T180708639605Z-a9eb11363775ebc93819074f61a1942a`
  passed the AS-F02 prefix and reached Browser AS-F05, then failed with
  `agent.error.replayIncomplete`; cleanup passed. Station facts show attachment
  admission and explicit omission completed, after which the provider invoked
  the selected Agent's pre-existing manual `skills_list` binding and left the
  Turn in `waiting_local_tool`. AS-F05 does not exercise Tool policy. Its
  fixture must therefore disable the platform Tool binding through the
  production binding API for the duration of the scenario and restore the
  exact original binding in cleanup, isolating attachment behavior without
  prompt steering, mocks, or weakened provider/negative-path assertions.
- The exact-source `8c5a80fb6` run
  `20260828T184653499318Z-abd4706acc3781a8f2c809beaf7b4393`
  passed the AS-F03/AS-F04 prefix and reached Browser AS-F05. The production
  facts passed the independent oracle, but the Harness self-check reported
  `opaqueReferencesOnly=false` because it read snake-case `object_ref` from
  facts produced as camel-case `objectRef`. The Harness must use the shared
  camel/snake evidence-field reader; this is a producer normalization defect,
  not permission to weaken opaque-reference validation. Cleanup passed and the
  Gate remains `PARTIAL / UNPROVEN`.
- Commit `bdeb9974f` normalized that Harness read through the shared
  camel/snake evidence-field reader. Its exact-source run
  `20260828T191401178548Z-8e145a02d8cf03d2811186b546187f71`
  attested the clean worktree and live Station at `bdeb9974fd93`, but stopped
  earlier at Browser AS-F03 with
  `agent.acceptance.progressiveTextMissing`: the external provider emitted no
  answer-text delta inside the unchanged 60-second cancellation window.
  Cleanup passed with both clients' processes, ports, storage, sessions, and
  actor identity released. This failed provider sample does not invalidate the
  AS-F05 normalization and does not justify treating thinking as answer text or
  weakening the timeout; the next action is a source-matched rerun of the same
  product behavior. The Gate remains `PARTIAL / UNPROVEN`.
- The exact-source `785b3999b` rerun
  `20260828T192441951453Z-4164824609104ada4dd486f69430073f`
  passed the Browser AS-F03/AS-F04/AS-F05 prefix and advanced the unique first
  failure to `foundation-browser-direct / AS-F06 / en / single / sample-001`.
  The adapter failed closed with `AS-F06: direct-runtime group is not
  implemented`; cleanup passed. This is the first source-backed AS-F06
  implementation gap and does not promote AS-F05 or the complete Gate beyond
  diagnostic progress. AS-F06 must now implement the accepted disconnect,
  replay, reconciliation, and stale-revision failure contract through
  production-reachable Browser and Desktop paths before another Gate run.
- The AS-F06 implementation checkpoint now closes the local product and
  evidence prerequisites for that rerun: Station owns generation-fenced Turn
  settlement and attempt-fenced replay/snapshot state; Desktop owns
  PTID-scoped recovery, bounded/cancellable replay transport, authoritative
  snapshot reload, and stale terminal rejection; the Foundation producer
  drives a source-bound Station outage, compares observed raw replay deliveries
  with an independent Station readback, and performs reverse-order cleanup on
  success or failure. Local verification passed Station Agent/OSS packages and
  focused race tests, Desktop typecheck and 389 tests, production build, 18
  Rust Agent-turn tests, 99 Foundation tests, Agent Domain validation, Go style,
  and `git diff --check`. This is implementation evidence only: AS-F06 and G-F
  remain `UNPROVEN` until the checkpoint is committed, deployed to profile
  `two`, and the source-matched Gate advances past AS-F06.
- Commit `1aebfd3bd4d8d86faeeaf0e1bc3dd62db4d62b30` was deployed to profile
  `two` with clean source and Station workspace digests. The exact-source run
  `20260829T005514635679Z-15d1bb8f377ed2e1101bf019636808ee`
  stopped at `foundation-browser-direct / AS-F02 / en / single /
  sample-001`: the active Turn was durably `cancelled`, its Attempt and 83
  ordered events were present, and cleanup passed, but
  `agent_turn_traces` had no row for that Turn and the production trace API
  returned `404`. Two completed sibling Turns from the same run retained
  readable traces, excluding a general trace query or ownership failure.
  Root-cause analysis found that durable cancellation correctly ended the
  Attempt before signalling its execution, after which the execution-owned
  usage checkpoint rejected the terminal Attempt and returned before saving
  its trace. The local fix permits only the current execution generation to
  finalize usage on that same cancelled Attempt and rejects a superseded
  generation. Agent/OSS package tests, the focused cancellation race tests, Go
  style, and `git diff --check` pass. This remains implementation evidence:
  AS-F02, AS-F06, and G-F are `UNPROVEN` until a new exact-source deployment
  and Gate run.
- Checkpoint `a3dd6e509aa24b4815d5b93ef1099935f39a51d6` was deployed
  exact-source to profile `two`. Run
  `20260829T012401200269Z-f5c96ff75d8f89e78fbe4253e0bef963`
  passed the Browser AS-F02 prefix and advanced the unique first failure to
  `foundation-browser-direct / AS-F03 / en / single / sample-001`, where the
  producer reported `agent.acceptance.progressiveTextMissing`. Runtime source
  and Station commits matched, both workspace digests were clean, and cleanup
  passed. This proves the AS-F02 cancellation/trace regression is closed for
  that runtime path; AS-F03 and the complete Gate remain `UNPROVEN`.
- The AS-F03 failure was a fixture-isolation defect rather than a provider
  failure: the shared Agent's enabled `skills_list` binding produced a valid
  production ToolCall under `tool_choice=auto`, so no answer-text delta could
  occur before the text barrier. The local correction uses the production
  capability-binding API to disable every effective binding for the AS-F03
  text-only subcase, verifies zero READY capabilities, checks the admitted
  Turn recorded zero tool-definition tokens, and restores every binding by
  revision in `finally`. Desktop check, 389 tests, production build, 101
  focused Foundation tests, Agent Domain validation, the gap-detector
  self-tests, and `git diff --check` pass. AS-F03 and G-F remain `UNPROVEN`
  pending a new exact-source Gate run.
- Checkpoint `74aa82b0fd0971d8c42d5244ca816af4f3e5869b` was deployed
  exact-source to profile `two`. Run
  `20260829T014951245897Z-7786fc286928468cb8d9818c6fbbce88`
  produced an AS-F03 Turn with 36 ordered text events, zero thinking events,
  one cancelled terminal event, a durable trace, and
  `tool_definition_tokens=0`. The run then failed in the Harness because it
  read usage from the diagnostic replay root instead of the generated
  `TurnAttempt.usage` field. Cleanup passed. The local producer correction now
  reads the last Attempt's generated usage contract; AS-F03 and G-F remain
  `UNPROVEN` pending another exact-source run.
- Checkpoint `a845fe02139774aec735d807ece8e98b9b445847` was deployed
  exact-source to profile `two`. Run
  `20260829T015708712723Z-d7c21cf6c5e8850880998066a7e22485`
  failed at Browser AS-F02 `deletePolicyEnforced`; cleanup passed. Station
  evidence showed the active Turn remained non-terminal when permanent delete
  was attempted, but its provider transition advanced the conversation version
  after the queue snapshot, so the probe observed `AGENT_4009` before reaching
  `ACTIVE_DEPENDENCY`. The local producer now performs a bounded
  compare-and-refresh retry only for that explicit version conflict; all other
  errors remain fail-closed. AS-F02, AS-F03, and G-F remain `UNPROVEN` pending
  another exact-source run.
- Checkpoint `b0c7deed32ee17c4a348d944dab26d61cec66f43` was deployed
  exact-source to profile `two`. Run
  `20260829T020528435564Z-3fc2fbd357dfec397023698978ae8375`
  advanced through AS-F02 and produced an AS-F03 Turn with 44 ordered text
  events, zero thinking events, one cancelled terminal event, a durable trace,
  and `tool_definition_tokens=0`; cleanup passed. The independent oracle still
  rejected `progressiveEventsSequenced` because Proto3 JSON omitted the
  zero-valued scalar and the Harness interpreted absence as `-1`. The local
  correction uses the generated Proto3 default of zero after proving the typed
  Attempt usage object exists. AS-F03 and G-F remain `UNPROVEN` pending another
  exact-source run.
- Checkpoint `cdff0040b61e65003a25f0a9274e0b485ef20478` was deployed
  exact-source to profile `two`. Run
  `20260829T021337638940Z-b4baabdaae0e358b1c110df244ff226e`
  again stopped at AS-F03 `progressiveEventsSequenced`; cleanup passed.
  Station truth for the candidate Turn contained 44 text events, no thinking
  events, one cancelled terminal event, a durable trace, and zero
  tool-definition tokens. Because the compound oracle did not expose which
  client-capture component differed, the next checkpoint adds only redacted
  event type/sequence and isolation-count diagnostics while preserving every
  existing pass condition.
- Diagnostic checkpoint `b196e0f86d83bbc927779af30a928dec3c3176d0`
  was deployed exact-source to profile `two`. Run
  `20260829T021942294103Z-8df4c245f21c9fcdfc314e6c3ce50925`
  showed that the AS-F03 capture contained durable sequences `1..34`, then
  synthetic transport controls `connection_lost`, `reconnecting`, and
  `replaying` at cursor `34`, followed by the durable cancelled event at
  sequence `35`; zero READY capabilities and zero tool-definition tokens were
  preserved. The local correction excludes only defined transport controls
  from AS-F03's durable sequence oracle. Product progress/text/terminal events
  remain mandatory and duplicate durable sequences still fail. Cleanup passed;
  AS-F03 and G-F remain `UNPROVEN` pending another exact-source run.
- Checkpoint `31e7bb855f6f5fca785c2bb5ca516577860511d2` was deployed
  exact-source to profile `two`. Run
  `20260829T022611072017Z-3b3ea1d707f9d1a22b046c642e2e7c29`
  passed the Browser AS-F01-AS-F05 prefix and reached AS-F06. AS-F06 prepare
  then selected the inherited `skills_list` binding instead of producing the
  required mutation-source text cursor, and partial-prepare cleanup attempted
  permanent deletion before cancelling the active Turn. The local correction
  reuses the production capability-binding isolation around each AS-F06
  admission, records the zero-READY-capability fact in the persisted handoff,
  restores bindings immediately after the immutable Turn snapshot is admitted,
  and makes cleanup cancel the Turn before version-safe conversation deletion.
  AS-F06 and G-F remain `UNPROVEN` pending another exact-source run.
- Checkpoint `b0cec10a36c6513e45904c5620d4e91d9eb78333` was deployed
  exact-source to profile `two`. Run
  `20260829T030451243761Z-d74a92305247f4e92186bffffa9383c7`
  failed at Browser AS-F02 while cancelling the fourth queued entry: the first
  three cancellations committed, then a `list -> cancel` optimistic-concurrency
  window returned `409`, leaving five pending entries and one waiting Turn even
  though framework cleanup passed. The local correction chains the
  `conversation_version` returned by each successful cancellation and
  refreshes only on explicit version conflicts. Before creating a new AS-F02
  fixture, it also removes stale `Foundation queue` conversations through the
  production queue-cancel, Turn-cancel, and permanent-delete APIs, failing as
  `CLEANUP_FAILED` if residue cannot be removed. AS-F02, AS-F06, and G-F remain
  `UNPROVEN` pending another exact-source run.
- Checkpoint `c472a3c52eb99f00a73d1d87931ec139dd7d1379` was deployed
  exact-source to profile `two`. Run
  `20260829T031317712137Z-7b1b2c562d50090c8c6246ecfa95544e`
  passed Browser AS-F01-AS-F05 and prepared all four AS-F06 tuples with zero
  READY capabilities. The outage callback then timed out because `docker stop`
  performed a graceful Station shutdown that durably settled all four Turns as
  `station_lifecycle_interrupted` before clients could observe a transport-only
  recovery failure. Failure cleanup also exposed two evidence defects:
  permanent deletion is represented by durable `status=deleted`, not GET 404,
  and clients were not restarted/re-authenticated after an outage callback
  error. The local correction injects an abrupt `SIGKILL` against the same
  source-bound container before restart, accepts only the canonical deleted
  status or not-found as cleanup proof, and restores client authentication
  before reverse-order failure cleanup. AS-F06 and G-F remain `UNPROVEN`
  pending another exact-source run.
- Checkpoint `72d07e291ec7e13a7afedaa12dd4412619f977ea` was deployed
  exact-source to profile `two`. Run
  `20260829T033240508585Z-98a80c68e781d200d212c3fcafc9dc94`
  again passed Browser AS-F01-AS-F05 and admitted all AS-F06 Turns, but timed
  out waiting for Browser `RECOVERY_FAILED`. The abrupt Station kill left the
  Browser SSE `reader.read()` pending, so the client never published
  `connection_lost`; using the existing controller `abort()` was invalid
  because it also semantically cancelled the durable Turn. Failure cleanup
  additionally exposed that provider setup rewrote an already-correct Agent
  during re-authentication and could conflict.
- The local correction separates transport disconnect from semantic Turn
  cancellation. Browser uses an independent transport abort signal and enters
  the existing bounded replay path after either an explicit disconnect or a
  post-admission stream error. Native uses a typed live-stream control channel
  and a dedicated Tauri command that emits the existing source-bound recovery
  handoff without cancelling the Turn. The AS-F06 Harness retains each
  scenario's controller, disconnects it during the bounded outage, and releases
  it during cleanup. Provider setup now refreshes Agent state and skips the
  versioned write when provider/model already match. Desktop check, 391 tests,
  production build, 19 Rust Agent-turn tests, 96 focused Foundation/native
  static tests, Agent Domain validation, Rust formatting, and
  `git diff --check` pass. AS-F06 and G-F remain `UNPROVEN` pending checkpoint
  commit, exact-source profile `two` deployment, and a new Foundation run.
- Checkpoint `4344696983aff53a8edb8056396c88620f4b8e4c` was deployed
  exact-source to profile `two`. Run
  `20260829T040641993969Z-89b3b4e2546ff51716c0739ca4cb8532`
  crossed the prior failure: all outage callbacks observed bounded recovery
  failure, Station restarted successfully, and execution advanced to Browser
  durable reload. It then failed closed with
  `agent.acceptance.foundationF06ObservedRecoveryFailureMissing`; cleanup
  passed. The source-backed cause is a Harness write-order race: an asynchronous
  replay-delivery recorder can read the handoff before recovery failure is
  attached and later overwrite the entire localStorage record. The local
  correction serializes recovery-failure persistence through the same replay
  recording ledger and merges into the latest handoff before every write.
  AS-F06 and G-F remain `UNPROVEN` pending another exact-source run.
- Checkpoint `2b0b7ff9dfe33754e8c35cbbb2f1385ac36bb9e0` was deployed
  exact-source to profile `two`. Run
  `20260829T043023680453Z-c1380cde93d76b3d0e076d85c05366e6`
  failed at Browser AS-F06 while waiting for active recovery failure; cleanup
  passed. Unlike the preceding run, the first prepared provider Turn completed
  before the shared outage because the coordinator prepared all four matrix
  tuples serially before fault injection. The local correction gives every
  tuple its own bounded `prepare -> outage -> recovery failure -> Station
  restart -> durable reload -> client restart -> completion` cycle. This
  removes provider-duration coupling without weakening any tuple, reusing
  evidence, or synthesizing transport failure. The 96 focused
  Foundation/native static tests and `git diff --check` pass. AS-F06 and G-F
  remain `UNPROVEN` pending another exact-source run.
- Checkpoint `648d818b5ae1181635e8976b5bee79648adee4d5` was deployed
  exact-source to profile `two`. Run
  `20260829T044956654767Z-0460304fe03b3e35ef52ba44baddd08f`
  completed the first tuple's outage and reached durable reload, but again
  reported `foundationF06ObservedRecoveryFailureMissing`; cleanup passed. Code
  inspection showed this path can only follow the recovery identity-mismatch
  early return: it claimed `activeFailureObserved=true` without persisting its
  blocker/retry evidence, and the Python coordinator accepted that incomplete
  result. The local correction persists every early-return evidence record and
  requires empty blocker plus an observed retry before Station restart. This
  preserves fail-closed ordering and will expose the underlying identity fact
  directly on the next exact-source run. AS-F06 and G-F remain `UNPROVEN`.
- Checkpoint `af8fc11dc697995fcd07e1f29e0570325088ad64` was deployed
  exact-source to profile `two`. Run
  `20260829T050459651702Z-43df5f11c2e7611a8e4ad1edc1084ca0`
  failed at the newly exposed Browser AS-F06 primary blocker
  `AS_F06_ACTIVE_RECOVERY_IDENTITY_MISMATCH`; cleanup passed. The captured
  recovery record matched the expected Turn, stream, generation, and
  `RECOVERY_FAILED` phase, while only the transient `sessionStore.currentUser`
  projection was absent during Station outage. The local correction verifies
  actor ownership from the durable PTID-fenced recovery record and additionally
  requires any available session projection to match; durable reload follows
  the same ownership rule. The independent oracle now requires the explicit
  session-match fact. AS-F06 and G-F remain `UNPROVEN` pending another
  exact-source run.
- Checkpoint `ab8a82c2cb30e6973a89c69e4a2bf337d315d914` was deployed
  exact-source to profile `two`. Run
  `20260829T052004514366Z-305bbc15288605635bf949662a3ab0d4`
  proved the initial recovery actor, Turn, stream, generation, failure phase,
  and session-consistency facts. Its retry also advanced `recoveryEpoch` from
  1 to 2 and returned to `RECOVERY_FAILED`, but the producer marked
  `retry.observed=false` because that nested assertion still compared the
  recovery actor directly to the unavailable outage-time session projection.
  The local correction applies the same durable-record ownership rule to the
  retry assertion. AS-F06 and G-F remain `UNPROVEN` pending another
  exact-source run.
- Checkpoint `7c92daed568153329aeea1ee8028c8c7197eb397` was deployed
  exact-source to profile `two`. Run
  `20260829T053414430688Z-9b2d9402d0a74e1ac10784e2537acdfa`
  proved the Browser AS-F06 recovery failure and retry path, then reached
  post-restart durable reload. The authoritative snapshot request returned
  HTTP 401 because the coordinator attempted replay before restoring client
  authentication after Station restart; cleanup passed. The local correction
  re-authenticates both existing clients immediately after Station health
  recovery and before durable reload. The later process restart and
  re-authentication remain in place as the independent client-restart portion
  of AS-F06. AS-F06 and G-F remain `UNPROVEN` pending another exact-source run.
- Checkpoint `46a44c7751faeae9bfd554febc03473716a50220` was deployed
  exact-source to profile `two`. Run
  `20260829T055049412419Z-90ce04174f23e6cf6c6ee3a99af04298`
  passed the Browser AS-F06 outage, recovery failure, retry, post-restart
  authentication, durable snapshot reload, and client restart, then failed in
  final evidence collection with `Failed to get agent turn trace`; cleanup
  passed. The interrupted Turn and terminal projection were durable, but trace
  persistence occurred only after the external provider returned, so an abrupt
  process loss could permanently omit the trace row. The local Station
  correction checkpoints the assembled trace before starting the provider
  side effect; existing terminal paths continue to upsert richer trace data.
  AS-F06 and G-F remain `UNPROVEN` pending another exact-source run.
- Checkpoint `5edd1fb021b6fbb3fd073f35b21d52eab837404f` was deployed
  exact-source to profile `two`. Run
  `20260829T061026253831Z-024fb1d63a2b9fe4d4a71d621586b5d3`
  passed trace retrieval and advanced to the post-client-restart terminal
  projection, where it timed out; cleanup passed. Independent Station readback
  confirmed the Turn and assistant message were durably
  `interrupted/station_restart_interrupted`. The Desktop store's
  `selectSession` returned immediately when the requested key was already
  current, even with no active operation, so an explicit post-restart
  selection could retain a stale local projection. The local correction makes
  same-session selection run the normal authoritative message reconciliation
  whenever no live operation owns the session. AS-F06 and G-F remain
  `UNPROVEN` pending another exact-source run.
- Checkpoint `39253c1eb46952718616489d5d01cd0f639e9f31` was deployed
  exact-source to profile `two`. Run
  `20260829T063423272048Z-1c231db35525bc464a71d621586b5d3`
  still timed out on the post-client-restart terminal projection; cleanup
  passed. This disproved same-session message refresh as the owning cause, so
  that product change is removed. The actual ordering defect is that the
  pre-restart durable reload consumes the terminal snapshot and removes the
  active recovery record, after which client restart has no recovery work to
  hydrate. The local correction performs client restart and re-authentication
  first, then invokes the accepted durable snapshot reload against the
  rehydrated recovery record. AS-F06 and G-F remain `UNPROVEN` pending another
  exact-source run.
- Checkpoint `ebd2ef3614250ab82b104ad364e9a8f75f332059` was deployed
  exact-source to profile `two`. Run
  `20260829T065748506580Z-a20565f7c6512b90ccb3f5c4119d95c2`
  stopped at Browser AS-F02 zh-CN with
  `agent.acceptance.foundationActiveTurnCancelMissing`; cleanup passed. The
  cancellation command can commit before its live SSE terminal frame is
  observed. A first local correction incorrectly required the command
  acknowledgement itself to be terminal `cancelled`.
- Checkpoint `2a3c8eb67bdf2df4c03ea7a0391866a4f7980c0e` was deployed
  exact-source to profile `two`. Run
  `20260829T071137788543Z-20a7d49fdcae9ba75cb1a481c6039f36`
  failed immediately at that over-strict assertion because the production
  command correctly returns `cancelling`. The corrected closure requires that
  acknowledgement, then requires either the live SSE frame or the existing
  source-bound replay path to produce a client terminal classified as
  `cancelled`. AS-F02, AS-F06, and G-F remain `UNPROVEN` pending another
  exact-source run.
- Checkpoint `879fde9c2bac2c45bd282cfbe045a06ec6ee1272` was deployed
  exact-source to profile `two`. Run
  `20260829T072234733047Z-3979973b3ad182ccfd05b85deeb22858`
  stopped at Browser AS-F02 `rejectedDraftRestored`; cleanup passed. An
  unchanged exact-source rerun
  `20260829T072540143604Z-a5b0d4fdaffd78d716811aab395d4f84`
  did not reproduce that UI assertion and reached Browser AS-F06, where the
  post-client-restart durable reload returned `observed=false`; cleanup again
  passed. The local diagnostic change includes the redacted reload result in
  the coordinator error without weakening the predicate. AS-F06 and G-F remain
  `UNPROVEN`.
- Diagnostic checkpoint `f3b8e80b63eefdd41185570561fb989933463175`
  was deployed exact-source to profile `two`. Run
  `20260829T074412796991Z-af4768a65c8d79e50af3ae60b3a560ca`
  identified the exact post-restart blocker as
  `AS_F06_DURABLE_RELOAD_TARGET_MISSING`; cleanup passed. The in-memory
  `RECOVERY_FAILED` phase was observable before its asynchronous recovery-store
  write necessarily completed, so immediate client restart could race and
  hydrate no active record. The local correction exposes the runtime's
  persistence chain and makes the outage observer await a current-state flush
  before returning control to the restart coordinator. A focused runtime test
  verifies that the flushed record contains the failed phase and Turn identity.
  AS-F06 and G-F remain `UNPROVEN` pending another exact-source run.
- Checkpoint `dfc7ee6f9654fb23e7e336f848d6e8fec8d10667` was deployed
  exact-source to profile `two`. Run
  `20260829T080520107058Z-238e25cc3794f452b3502748be51d02a`
  still reported `AS_F06_DURABLE_RELOAD_TARGET_MISSING` after client restart;
  cleanup passed. The flushed failed record was present before restart, but
  boot-time automatic replay correctly consumed the terminal snapshot and
  removed it before the explicit reload probe. The preceding terminal
  reconciliation updated only in-memory chat state, while the cursor-based
  message cache could retain the earlier `pending` status for the same message
  sequence. The local correction returns durable reload to the authenticated
  pre-client-restart position and upserts the authoritative terminal status
  into the local message cache before clearing recovery state. The subsequent
  client restart must therefore reload the terminal projection without keeping
  a completed recovery record alive. AS-F06 and G-F remain `UNPROVEN`.
- Checkpoint `87d4a1d513b56ff20bedc81641c37f415247ea58` was deployed
  exact-source to profile `two`. Run
  `20260829T082413336824Z-03fecb99e765dafeebe53458ef456359`
  crossed terminal projection and failed at
  `agent.acceptance.foundationF06ReplaySequencesMissing`; cleanup also failed
  to archive the prepared conversation. The replay snapshot used by explicit
  durable reload carried source-bound delivery metadata but, unlike automatic
  replay, did not publish the observation-only delivery event consumed by the
  evidence recorder. The local correction publishes that same source delivery
  without making it a second state input. Cleanup failure remains open for the
  next source-backed run. AS-F06 and G-F remain `UNPROVEN`.
- Checkpoint `5b209dae2dd347dbfa2f0ffa62a435001c79c873` was deployed
  exact-source to profile `two`. Run
  `20260829T084348162275Z-9b1c6a0eca3e4218374db827330366f9`
  crossed the prior replay-sequence failure and stopped at Browser AS-F06 while
  waiting for the explicit retry action to advance `recoveryEpoch`; outer
  cleanup and redaction passed. The owning runtime's periodic reconciliation
  retried `RECOVERY_FAILED` records automatically, racing the explicit recovery
  action even though the product state contract makes retry and durable reload
  user-owned exits from that phase. The local correction keeps failed records
  quiescent during same-session periodic reconciliation while preserving
  bootstrap recovery after process restart. Desktop check and all 393 tests
  pass; exact-source runtime proof is pending. AS-F06 and G-F remain
  `UNPROVEN`.
- Checkpoint `862c8bae3d76f200a87b0a36bc527f329dcd4e82` was deployed
  exact-source to profile `two`. Run
  `20260829T090209403567Z-83f2593a786eee363fe009af8fa9040e`
  proved the explicit retry (`recoveryEpoch` 1 to 2, resulting phase
  `RECOVERY_FAILED`) and then failed with
  `AS_F06_DURABLE_RELOAD_TARGET_MISSING`; cleanup and redaction passed.
  Station-restart re-auth bootstrapped the same actor while its failed record
  was still present in memory, and bootstrap reconciliation treated that
  existing user-action state like a newly hydrated process-restart record.
  The runtime must preserve same-process failed records while still
  automatically reconciling failed records newly loaded into a fresh process.
  AS-F06 and G-F remain `UNPROVEN`.
- Checkpoint `a2f5c706d7305a34ac1493755f4dbae69504a811` was deployed
  exact-source to profile `two`. Run
  `20260829T091643210639Z-ff78e0b4fc83cf58eff6f89b1fb3c447`
  crossed retry, same-process re-auth, durable reload, and client restart, then
  reached the complete Browser AS-F06 oracle. It failed
  `exactRecoveryTransitionOrdering`, `replayAfterAcknowledgedCursor`, and
  `staleGenerationAndRevisionRejected`; cleanup also found an active
  conversation dependency. The local correction makes explicit terminal
  snapshot reload emit the same `RECONCILING -> CONNECTED` phases as automatic
  replay, deduplicates identical source-sequence deliveries while rejecting
  conflicting payloads, creates a real competing conversation update before
  asserting stale-version rejection, and performs bounded cancel/queue
  convergence before deletion. Desktop check, all 394 Desktop tests,
  production build, 35 Group One oracle tests, 10 scenario-runner tests, 40
  native static tests, and `git diff --check` pass. The broad legacy
  `unittest discover` suite is not a valid current gate because it still
  references migrated files and historical symbols. AS-F06 and G-F remain
  `UNPROVEN` pending another exact-source run.
- Checkpoint `a97bf733c0abe987b3a4c8cde866b0f990119195` was deployed
  exact-source to profile `two`. Run
  `20260829T094145443231Z-cf0a61dda46dbd06236838d4a196acee`
  failed closed during Browser AS-F06 observation with
  `foundationRecoverySequencePayloadConflict`; cleanup and redaction passed.
  The same source sequence was represented once by its persisted terminal
  event and once by the synthesized authoritative snapshot, whose payloads are
  expected to differ. Snapshot delivery already has a separate durable-reload
  proof field, so the replay recorder now excludes snapshots from persisted
  event-sequence equality while retaining conflict detection for repeated
  persisted events. AS-F06 and G-F remain `UNPROVEN`.
- Two accidentally overlapping `52caeb68f` runs were stopped and excluded from
  evidence because they shared profile `two`; all owned client processes and
  ports were released before retrying. The subsequent clean serial run
  `20260829T102930918349Z-6c131acdb12621e339778b72c6057d7e`
  stopped at `foundationF06ReplaySequencesMissing`; cleanup also failed to
  archive the prepared conversation. The explicit snapshot loader requested
  `after_seq = MAX_SAFE_INTEGER`, so it could publish the synthesized snapshot
  but could not expose the persisted post-cursor terminal event to the
  independent replay recorder. The local correction requests from the durable
  recovery cursor, publishes returned event rows as observation-only
  deliveries, and still applies only the authoritative snapshot to projection
  state. Cleanup now retries only while the conversation remains readable and
  reports its normalized deletion code on exhaustion. AS-F06 and G-F remain
  `UNPROVEN`.
- Checkpoint `50041002f8dc6fa0ea68841cdd248e631641de07` was deployed
  exact-source to profile `two`. An initial run
  `20260829T110511958953Z-8b9f9d96e80e09bc8fa3d2f3b03caff1`
  stopped at a previously proven AS-F01 provider timeout with cleanup passing.
  Its unchanged rerun
  `20260829T111024619399Z-ed92416efa7237cf4dc7b99afd1ef599`
  reached Browser AS-F06 but timed out in explicit durable reload. The replay
  transport closed as soon as it received a persisted terminal event during
  catch-up, before consuming the authoritative snapshot that Station emits
  immediately afterward. The local correction keeps both Browser and Native
  replay open across catch-up terminal rows and closes only on a terminal
  snapshot or a terminal event after live-tail establishment. Focused Browser
  and Rust tests cover that ordering. AS-F06 and G-F remain `UNPROVEN`.
- Checkpoint `c457f884f4367ff819153d1f2caffbb471c8ba94` was deployed
  exact-source to profile `two`. Run
  `20260829T113329057061Z-0c78e4730bbb54bdac17ccd146f2d318`
  reached the complete Browser AS-F06 oracle and passed transition ordering,
  stale-generation rejection, stale-terminal rejection, and stale-revision
  rejection. Its sole product assertion failure was
  `replayAfterAcknowledgedCursor`: observed source sequences were `[186, 187]`
  after cursor `31`, so the remaining mismatch is restricted to payload/source
  identity or Station readback equality. Cleanup reported
  `CONVERSATION_DELETED` but still treated the helper's retry exhaustion as an
  error; deletion is now recognized as idempotent success before archive.
  Bounded replay diagnostics were extended without changing any predicate.
  AS-F06 and G-F remain `UNPROVEN`.
- Checkpoint `7a74420126d78a851a52b62d3d91a4f5214bba46` was deployed
  exact-source to profile `two`. Run
  `20260829T115504602448Z-81b5706495f784694d505c6097c642f6`
  again timed out waiting for the explicit retry action to advance the recovery
  epoch; cleanup and redaction passed. This repeated independently after
  periodic failed-state retries were disabled, isolating the remaining race to
  the chat store's fire-and-forget dynamic import. The local correction routes
  the user command synchronously through the typed kernel event bus to the
  already-installed `chatRuntime`, preserving runtime ownership and removing
  delayed command acceptance. AS-F06 and G-F remain `UNPROVEN`.
- Checkpoint `4061954253f04b269b6a17e3dfc7699ec61cf9e0` was deployed
  exact-source to profile `two`. Run
  `20260829T121943527111Z-975f2a034ce0ada85721dd83240a6d93`
  stopped at the AS-F06 Station-restart precondition because the destructive
  test opt-in was absent; this was an invocation error rather than product
  evidence, and cleanup/redaction passed. The unchanged-source rerun
  `20260829T123725220148Z-723c24b6ac16ab96dd98a6afbc6663d3`
  used the required opt-in, crossed explicit retry, restart, durable reload,
  transition ordering, stale-generation, stale-terminal, and stale-revision
  checks, and failed only `replayAfterAcknowledgedCursor`. Client delivery
  metadata was valid and source-bound, but it recorded only sequence `139`
  while independent Station readback returned `32..139` plus a synthesized
  snapshot at sequence `139`. The Acceptance harness was installed through a
  fire-and-forget import, so after renderer restart the runtime could replay
  persisted events before its observer subscribed. The local correction awaits
  harness installation before rendering App runtimes and excludes synthesized
  snapshots from the independent persisted-event comparison. AS-F06 and G-F
  remain `UNPROVEN`.
- Checkpoint `9cf45451d7798aa387a88d0c7532ca7e4970d745` was deployed
  exact-source to profile `two`. Run
  `20260829T130511526884Z-0e55ce925c2f27d25058950661b67e75`
  again reached only `replayAfterAcknowledgedCursor`; cleanup and redaction
  passed. The Browser runtime replayed persisted events through the original
  stream's reconnect path, which publishes normal source-bound runtime events,
  while the Acceptance recorder admitted only observation-only deliveries.
  It therefore omitted sequences `32..202` and retained only the explicit
  snapshot loader's sequence `203`; Station independently returned persisted
  sequences `32..203`. The recorder now accepts both source-bound delivery
  paths only after observing `REPLAYING`, while retaining actor, Turn, stream,
  generation, cursor, payload-hash, and independent Station equality checks.
  AS-F06 and G-F remain `UNPROVEN`.
- Checkpoint `91154e56f52f25dfbacabb8cbbf37c5e0b98a17d` was deployed
  exact-source to profile `two`. Run
  `20260829T133110384766Z-0f2e14721e48fc23a0dc8021925f22e4`
  again reached only `replayAfterAcknowledgedCursor`; cleanup and redaction
  passed. It recorded terminal sequence `107` while Station independently
  returned `32..107`. The recorder admitted primary source deliveries only
  after finding `REPLAYING` in its asynchronously persisted transition list,
  so a fast replay batch could deliver events before that localStorage write
  completed. The recorder now marks each scenario synchronously when its
  matching `replaying` control event arrives, then accepts subsequent
  same-identity source deliveries. The persisted transition list remains an
  independent final ordering proof. AS-F06 and G-F remain `UNPROVEN`.
- Checkpoint `38d813cce5843c1b54cf86315f13e0dd224d3cce` was deployed
  exact-source to profile `two`. Run
  `20260829T135524062282Z-6f28c694e56da4ed4067df8ea3f5e17f`
  reached the complete Browser AS-F06 oracle with cleanup/redaction passing.
  The prepared handoff froze cursor `31`, but the live stream advanced through
  `226` before the injected disconnect, so only replayed terminal sequence
  `227` was correctly observed while independent readback incorrectly compared
  against all persisted rows `32..227`. Pre-fault natural reconnect phases also
  preceded the injected `CONNECTION_LOST`. Fault injection now freezes the
  owning runtime's latest cursor and clears pre-fault transition/replay
  observations before disconnect, aligning both ordering and replay equality
  with the actual injected recovery boundary. AS-F06 and G-F remain
  `UNPROVEN`.
- Checkpoint `2e986fd12e751817c7231182c54b2d87d6d1cbe0` was deployed
  exact-source to profile `two`. Run
  `20260829T141946571190Z-b812720034d45701ed2a6657c74a69d2`
  passed AS-F06 transition ordering and exact replay equality with fault cursor
  `130` and matching client/Station sequence `131`; cleanup and redaction
  passed. Its sole remaining assertion was
  `terminalProjectionEqualsStation`. Bounded diagnostics now expose the
  Station/client terminal statuses, projection hashes, and prefix-preservation
  result without changing the predicate. AS-F06 and G-F remain `UNPROVEN`.
- Checkpoint `59fda660820edddca995c0312b0017b8db8babaf` was deployed
  exact-source to profile `two`. Runs
  `20260829T150141594038Z-183a25360d249aadf6a638728ca151e6`
  and
  `20260829T152315684358Z-b8bd384c8f14fda3b05b5ec5ab8d6368`
  both stopped at Browser AS-F06 prepare with
  `foundationRecoveryRegistrationMissing`; cleanup and redaction passed.
  The provider can complete between the initial event sample and active
  recovery registration, before a handoff exists or the coordinator can inject
  the Station outage. Preparation now performs at most three explicit attempts,
  cleans every partial conversation before retrying, records the successful
  attempt count, and retries only the already-terminal and missing-registration
  timing outcomes. All other failures still fail immediately. AS-F06 and G-F
  remain `UNPROVEN`.
- Checkpoint `3fbbc5268f6dc642f270a36fc21c140f7b8e6ed7` was deployed
  exact-source to profile `two`. Run
  `20260829T155537016167Z-d0c7edaaf594134e11e60a97ff840d60`
  again stopped at Browser AS-F06 prepare after all three bounded attempts
  returned `foundationRecoveryRegistrationMissing`. The Station attestation,
  local source, and evidence source all matched `3fbbc5268`; Gate cleanup and
  redaction passed, all shared client ports were released, and the Gate remains
  `PARTIAL / UNPROVEN`. This repeated exhaustion falsifies the prior assumption
  that a bounded reprovision alone resolves a rare provider-terminal race.
  The aggregate error currently covers missing active state plus actor, Turn,
  stream, cursor, and stream-generation mismatches; the next correction must
  identify the failed invariant from source-backed diagnostics and fix its
  owning lifecycle rather than add further retries.
- Independent read-only reconciliation confirmed that the accepted D07 replay
  contract is complete and no design amendment is required: the defect was the
  AS-F06 evidence producer polling source events before separately reading the
  transient active recovery record. Preparation now uses one conversation and
  commits the matching recovery identity, acknowledged cursor, mutation
  evidence, in-memory handoff, and transport disconnect in one synchronous
  callback. It registers the controller before awaiting the boundary, clears
  the submission timeout at commit, drains pending replay observations before
  publishing fully hashed durable evidence, and no longer retries the same
  race. Desktop check, 395 Desktop tests with one unrelated skip, Desktop build,
  123 focused Foundation tests, Agent Acceptance validation, and
  `git diff --check` pass. This is implementation evidence only; AS-F06 and G-F
  remain `UNPROVEN` until the next exact-source runtime Gate.
- Checkpoint `e8ce6e4255ca4542e24c82446a5fa73403351783` was deployed
  exact-source to profile `two`. Run
  `20260829T163549824710Z-d8c03adb9cbc70c4d96e33fb98dce2c5`
  crossed AS-F06 preparation and passed transition ordering, terminal
  projection equality, prefix preservation, stale generation/revision/terminal
  rejection, cleanup, and redaction. Its only failed assertion was
  `replayAfterAcknowledgedCursor`: the fault cursor was `3`, independent
  Station readback returned `4..119`, but Browser replay evidence began at
  `32`. Source inspection showed that `consumeAgentSSE` checked transport abort
  only before `reader.read()` and continued forwarding complete frames from the
  already-decoded live chunk after `disconnectTransport()`. The decoder now
  stops immediately after the callback that aborts its transport, and a focused
  Browser regression proves buffered sequence `2` is not delivered after the
  sequence `1` boundary and replay requests `afterSequence: 1`. The strict
  replay oracle remains unchanged. AS-F06 and G-F remain `UNPROVEN` pending
  another exact-source run.
- Checkpoint `88bcd726466f728b09c0d5f32fddc997a40b16fc` was deployed
  exact-source to profile `two`. Run
  `20260829T170040764634Z-f27353434f9dd45826422b2bada42926`
  stopped earlier at Browser AS-F03 `zh-CN / sample-001` when the Harness
  polled after the first text frame and the production cancel request returned
  the generic Desktop error `Failed to cancel Agent turn`; exact-source
  attestation, cleanup, and redaction passed. Reconciliation found two related
  defects: the polling interval left a provider-terminal race, and the
  Station/Desktop cancellation adapters erased the authoritative outcome.
  AS-F03 now initiates exactly one production cancel request synchronously from
  the first text callback. Station maps a genuinely missing/foreign Turn to
  typed `AGENT_4004` while preserving internal persistence failures, and
  Desktop Rust returns the Station-authored terminal status rather than
  fabricating `cancelling`. Scoped Station tests, Desktop check/tests, Tauri
  library check, 125 focused Foundation tests, and `git diff --check` pass.
  AS-F03, AS-F06, and G-F remain `UNPROVEN` pending the next exact-source run.
- Checkpoint `d8b0b5557dcc45c7dd2d2664fda447561e0ce704` was deployed
  exact-source to profile `two`. Run
  `20260829T172414332992Z-f6c75fd5f181b61b31c113c0c44e2261`
  first failed at Browser AS-F02 because that earlier consumer still expected
  the removed Desktop-fabricated `cancelling` value. Station correctly returned
  its durable `cancelled` status through the new passthrough; cleanup and
  redaction passed. AS-F02 now consumes the same Station-authored terminal
  status as AS-F03. This is the mechanical completion of the cancellation
  response cutover, not a Gate relaxation. AS-F02, AS-F03, AS-F06, and G-F
  remain `UNPROVEN` pending another exact-source run.
- Checkpoint `64d6c740a781ba361eaeabde5172eb910d35034b` was deployed
  exact-source to profile `two`. Run
  `20260829T173327792006Z-8fc5745467a507b4328706e7a6fd0626`
  passed the Browser AS-F02/AS-F03 cancellation prefix and again reached AS-F06,
  where the synchronous boundary found no active recovery registration;
  cleanup and redaction passed. The Agent chat recovery runtime was registered
  but remained an idle session runtime, while Acceptance login awaited only
  app-scoped deferred projections. A fast Agent turn could therefore publish
  valid stream events before `agent-chat` installed and actor-bootstrap
  completed, causing the runtime to reject them while the direct Harness
  observer still saw them. `agent-chat` is now an authenticated-critical
  runtime through one shared production helper; the production lifecycle and
  Acceptance login both await it, and the idle pass excludes it. Desktop check,
  396 tests with one unrelated skip, 126 focused Foundation tests, and
  `git diff --check` pass. AS-F06 and G-F remain `UNPROVEN` pending the next
  exact-source run.
- Checkpoint `9ebb8ead5804cd3f5425f04be02cc478caafae8b` was deployed
  exact-source to profile `two`. Run
  `20260829T181637661692Z-4ea1eff9f8c2b23cf4f96e40cfcaba2d`
  passed the Browser AS-F01-AS-F05 prefix and proved that the AS-F06 recovery
  record now exists, then timed out waiting for the Browser direct tuple to
  reach `RECOVERY_FAILED` during the bounded Station outage. The runtime and
  Station attestations both identify checkpoint `9ebb8ead5` with clean source
  digests. Cleanup and redaction passed. This narrows the first failure from
  missing runtime registration to recovery-fault ordering: the Browser
  transport is disconnected during prepare while Station is still available,
  so replay can establish a live tail before the coordinator stops Station.
  The Browser live transport now emits a typed recovery handoff and leaves
  replay/reconcile ownership exclusively with `chatRuntime`, matching the
  Desktop runtime contract. AS-F06 and G-F remain `PARTIAL / UNPROVEN` pending
  focused verification, checkpoint deployment, and another exact-source run.
- Checkpoint `4368d1bea09c4cb632bc8005bc43a7e1b4fed4d3` was deployed
  exact-source to profile `two`. Run
  `20260829T184558755894Z-8ad50dcb8c21189961dae5436f2de290`
  stopped earlier at Browser AS-F02 with
  `agent.acceptance.foundationActiveTurnCancelMissing`; cleanup and redaction
  passed. Station logs prove that `/sub-agent/agent/turn/cancel` returned HTTP
  200 and cancelled the provider context immediately afterward, while the
  Browser command bridge delivered a null parsed payload to the Harness.
  The Harness now treats the successful command response only as an
  acknowledgement, rejects any conflicting non-null status, and requires the
  subsequent Station-authored `cancelled` SSE event as the terminal proof.
  AS-F02, AS-F06, and G-F remain `PARTIAL / UNPROVEN` pending focused
  verification, checkpoint deployment, and another exact-source run.
- Checkpoint `ce5d07bde480400c548e7bc245b2106decf95e23` was deployed
  exact-source to profile `two`. Run
  `20260829T191337629969Z-231166391ba17c798964f5b15faf5b5a`
  again stopped at Browser AS-F02
  `agent.acceptance.foundationActiveTurnCancelMissing` after the full
  observation deadline; cleanup and redaction passed. This proves the
  source-bound replay observer alone did not restore the missing terminal.
  The next diagnostic records only event types, durable sequences, result
  state, and recovery phase/cursor so the next run can distinguish a missing
  handoff, cleared recovery record, stalled replay, or absent terminal
  delivery without exposing actor or content data.
- Diagnostic checkpoint `8c4aa5f02e3436f7b3725d2e734a303ac519a66d`
  was deployed exact-source to profile `two`. Run
  `20260829T192655934922Z-bbfb13ebd621bdb52a62e948972f7681`
  again stopped at Browser AS-F02 after observing durable sequences `1..30`
  and `connection_lost` at cursor `30`. The observation timed out with
  `resultOk=false`, `turnSubmissionTimeout`, and the recovery record
  `MISSING`; cleanup and redaction passed. The next diagnostic adds the
  recovery watermark and authenticated-session presence so terminal reduction
  can be distinguished from session-runtime teardown without retaining local
  storage or sensitive identities.
- Diagnostic checkpoint `3283f2ba18cba1e0d59f243568a4ec5f1f7437f7`
  was deployed exact-source to profile `two`. Run
  `20260829T193708550305Z-2f3e1ed308b9cc74db440872ad2e3c1e`
  showed `recoveryActorPresent=true`, `sessionAuthenticated=true`, and a
  terminal watermark at cursor `59` while the active record was missing.
  This rules out session teardown: later queued/terminal events for other Turns
  in the same conversation had superseded the running Turn's recovery record.
  The recovery reducer now excludes queued admissions from active recovery and
  prevents a different Turn's terminal from clearing the current record.
  AS-F02, AS-F06, and G-F remain `PARTIAL / UNPROVEN` pending focused
  verification, checkpoint deployment, and another exact-source run.
- Checkpoint `e4261920d3defe35e763d1e07f6af17b27047131` was deployed
  exact-source to profile `two`. Run
  `20260829T194542519419Z-8f651e9683e0fbd11574820df699798c`
  passed the Browser AS-F02 prefix and returned to AS-F06, where the recovery
  remained connected to a pre-outage replay tail and did not reach
  `RECOVERY_FAILED` within the bounded outage; cleanup and redaction passed.
  Station emits SSE heartbeat bytes every 15 seconds, so the shared Browser SSE
  reader now enforces a 30-second no-byte deadline. A dead live or replay tail
  therefore enters the existing bounded retry/failure path instead of hanging
  indefinitely. AS-F06 and G-F remain `PARTIAL / UNPROVEN` pending checkpoint
  deployment and exact-source verification.
- Checkpoint `9324ff0d4c3bfb31b388462e0fdd19dc2c723f0b` was deployed
  exact-source to profile `two`. After reclaiming `42.44GB` of remote BuildKit
  cache without touching volumes, run
  `20260829T202925054384Z-6d67ce144ad4a2113e5cd06053faf421`
  again reached Browser AS-F06 but did not expose `RECOVERY_FAILED` inside the
  120-second outage window; cleanup and redaction passed. The next diagnostic
  preserves the active phase, cursor, failure key hash, and observed transition
  sequence on timeout so the remaining Browser recovery state divergence is
  source-backed.
- Diagnostic checkpoint `1367e61e4785a0ba564787c0b0dc1adc947930c5`
  was deployed exact-source to profile `two`. Run
  `20260829T204902023757Z-147bdf0c389a7de40dab7e242e447a74`
  reached `CONNECTION_LOST -> RECONNECTING -> REPLAYING -> RECONCILING ->
  CONNECTED`, then timed out with both the active recovery record and
  authenticated session projection missing. The immutable result is
  `PARTIAL / UNPROVEN`; cleanup and redaction passed. Station runtime evidence
  identified an unrelated federation-token `UNAUTHORIZED` response during the
  recovery window. Desktop had treated every `UNAUTHORIZED` command result as
  local session revocation, so the identity lifecycle tore down the
  authenticated runtime and its recovery projection. The Desktop command
  boundary now publishes `AUTH_SESSION_REVOKED` only when the response carries
  the explicit typed detail `code=session_revoked`; other authorization
  failures remain command-local. Desktop check, 400 tests with one unrelated
  skip, 65 focused recovery/API tests, 47 Foundation static tests, and
  `git diff --check` pass. AS-F06 and G-F remain `PARTIAL / UNPROVEN` pending
  checkpoint deployment and exact-source verification.
- Checkpoint `ddc01f9939e465fac18c82d9c78082e3acb40a98` was deployed
  exact-source to profile `two`. Run
  `20260829T211516341470Z-bded0cbd9862cbe09dc0273d73bf3a2a`
  reached Browser AS-F06 and then failed closed before its destructive Station
  restart because `PT_AGENT_V2_ALLOW_STATION_RESTART=1` was not present in the
  runner environment. The immutable result is `PARTIAL / UNPROVEN`; cleanup,
  redaction, runtime storage removal, and release of ports `3130`, `3131`,
  `3310`, `3311`, `4445`, and `4446` passed. This is an execution-environment
  precondition failure, not product proof. The next serial run must retain the
  same Gate and set the explicit restart authorization required by AS-F06.
- Checkpoint `8f86dfcb7478b0e75cf1345aa77e1609798d2825` was deployed
  exact-source to profile `two`, and run
  `20260829T213127221374Z-fb8ae2d367edb773b731f747f790e171`
  executed AS-F06 with explicit restart authorization. It observed
  `RECOVERY_FAILED`, preserved the authenticated session through the outage,
  invoked retry, advanced recovery epoch `1 -> 2`, and observed the retry
  return to `RECOVERY_FAILED`; the next first failure was
  `AS_F06_DURABLE_RELOAD_TARGET_MISSING`. The immutable result is
  `PARTIAL / UNPROVEN`; cleanup and redaction passed. The coordinator had
  unconditionally called `loginWithPassword` after Station restart. That
  production login pipeline invalidates `runtime.projection` and traverses a
  non-ready identity phase whose lifecycle teardown clears the in-memory
  recovery owner, so the subsequent durable reload had no target. AS-F06
  recovery orchestration now requires the original authenticated session after
  both Station and client restarts; it no longer logs in to manufacture
  recovery state. One hundred five focused Foundation tests, Agent Domain
  validation, and `git diff --check` pass. AS-F06 and G-F remain
  `PARTIAL / UNPROVEN` pending checkpoint deployment and exact-source
  verification.
- Checkpoint `40454a1ef08117f4628815bd0b1a798cf372172e` was deployed
  exact-source to profile `two`. Run
  `20260829T215751647699Z-4253464ce1ad27a97bbf8403b497f91b`
  crossed the prior unconditional re-login path but then failed while the
  coordinator prepared both clients after an AS-F06 restart:
  `harness agent.ensureProvider failed: authentication required`. The immutable
  result is `PARTIAL / UNPROVEN`; cleanup and redaction passed. The
  post-restart helper was still broader than the active runtime tuple and also
  rewrote provider fixture state before recovery proof. AS-F06 now restarts and
  validates only the tuple's target client, requires its existing session,
  performs no provider rewrite during recovery, and uses the protected
  capability-session readback as the server-backed authentication check.
  One hundred five focused Foundation tests and `git diff --check` pass.
  AS-F06 and G-F remain `PARTIAL / UNPROVEN` pending checkpoint deployment and
  exact-source verification.
- Checkpoint `726d60b3a290cb119aff52d799d909c22b10e996` was deployed
  exact-source to profile `two`. Run
  `20260829T221837893958Z-96c5aa4db5fcd50232dad4b2af6320b7`
  kept the Station restart and current Browser tuple isolated, then failed
  after the Browser process restart because the renderer reported a ready
  identity while both local and Station capability-session readback returned
  `authentication required`. The immutable result is `PARTIAL / UNPROVEN`;
  cleanup and redaction passed. Browser session restore reused the native
  `desktop-native` takeover identity and the HTTP Gateway restore branch did
  not rebuild its `http-gateway` window-session binding, unlike the native
  Tauri command. Session restore now accepts the caller's device type, the
  Browser Gateway requests `desktop-browser`, and successful one-shot Browser
  login and restore use one shared binding function. The focused HTTP Gateway
  binding test, Rust compilation, 105 focused Foundation tests, and `git diff
  --check` pass. AS-F06 and G-F remain `PARTIAL / UNPROVEN` pending checkpoint
  deployment and exact-source verification.
- Checkpoint `143a98063a8c340c3ab1ca1841e13632fc707f18` was deployed
  exact-source to profile `two`. Run
  `20260829T224556120320Z-30a9c4e61d6d16ecd94bb8dd4ec3d7e0`
  reached Browser AS-F06 recovery but lost authenticated capability readback
  after Browser restart: the renderer lifecycle remained `ready` while both
  local and Station capability probes returned `authentication required`.
  The immutable result is `PARTIAL / UNPROVEN`; cleanup and redaction passed.
  Station logs showed a successful Browser session takeover followed by late
  `session_revoked` responses from the replaced token. The Rust event-stream
  revocation bridge previously emitted those stale failures globally and could
  therefore clear the newly restored session. Revocation delivery is now
  fenced to the token used by the failed stream; a replaced token terminates
  only its stale stream, while a failure for the current token still emits the
  canonical session-revoked event. Two focused token-fencing tests, the HTTP
  Gateway restore-binding test, Rust compilation, 105 focused Foundation
  tests, and `git diff --check` pass. AS-F06 and G-F remain
  `PARTIAL / UNPROVEN` pending checkpoint deployment and exact-source
  verification.
- Checkpoint `7fb5fd9e2f45893745d3e9ef6766dd51d9fbed99` was deployed
  exact-source to profile `two`. Run
  `20260829T231244057538Z-65617cc2d2068d85bf23420f21e01c0b`
  again reached Browser AS-F06. During the Station outage, the visible-page
  liveness probe called `auth_validate_token`; the Rust auth service cleared
  `AppState.session` for the resulting transient Station network error while
  the Web session projection remained authenticated and `ready`. The
  after-restart callback therefore failed capability-session polling before
  Browser process restart: both local and Station readbacks returned
  `authentication required`. The immutable result is `PARTIAL / UNPROVEN`,
  while cleanup and redaction passed. Local source, Station live source, and
  evidence source all matched `7fb5fd9e2`, and all owned runtime ports were
  released. The local correction retains session authority for transient
  Station transport/decode/server failures and clears it only for local JWT
  rejection, explicit `session_revoked`, or HTTP 401. The policy is shared by
  restore, validation, and OAuth session verification. Three focused Rust auth
  tests, Rust library check, Desktop typecheck, 104 focused Foundation tests,
  targeted formatting, and `git diff --check` pass. AS-F06 and G-F remain
  `PARTIAL / UNPROVEN` pending checkpoint deployment and exact-source
  verification.
- Checkpoint `121ff35bee1392169fbe2744615c0b7112647379` was deployed
  exact-source to profile `two`. Run
  `20260829T234856733226Z-73203c902073fa051754dc614e48de10`
  stopped at the previously proven Browser AS-F01 with
  `agent.acceptance.foundationTurnTimeout`; source matching, cleanup, and
  redaction passed. An unchanged-source rerun
  `20260829T235641883075Z-bb61197f590de8036c31c49358d84d6c`
  crossed AS-F01 and the prior AS-F06 outage session-loss path, proving that
  transient Station validation no longer clears the Browser Rust session. It
  reached the complete Browser AS-F06 evaluator and failed closed with
  `agent.acceptance.foundationF06ReplaySequencesMissing`; source matching,
  cleanup, and redaction again passed. The Harness had used a non-empty array
  parser before the unchanged `replayAfterAcknowledgedCursor` assertion, so an
  empty replay observation hid the cursor/client/Station diagnostics from the
  independent Python oracle. The local diagnostic correction accepts typed
  empty replay collections into the evaluator while retaining its explicit
  non-empty requirement, allowing the next exact-source run to report the
  source-backed mismatch without weakening the Gate. Desktop typecheck, 47
  native static tests, 104 focused Foundation tests, and `git diff --check`
  pass. AS-F06 and G-F remain `PARTIAL / UNPROVEN`.
- Diagnostic checkpoint
  `a9613bd9aa30680d66a73338f6c0e6d2cf125917` was deployed exact-source to
  profile `two`. Run
  `20260830T001432603158Z-51e8130865d0e85ca69e332a96ac0315`
  reached the complete Browser AS-F06 oracle with source matching, cleanup,
  and redaction passing. The fault cursor was `3`; independent Station replay
  contained exact persisted sequences `4..187`, while Browser observation was
  empty. Recovery transitions still included `REPLAYING`, `RECONCILING`, and
  `CONNECTED`. The replay observer's armed-state set was process-local and was
  lost on Browser restart even though the durable handoff and recovery-store
  transitions were restored, so it rejected every valid source delivery. The
  same run reported matching `interrupted` terminal statuses and preserved
  prefix but unequal content hashes. Station appends streamed text to the same
  message sequence; cursor-only cache sync therefore retained the pre-restart
  prefix because terminal snapshot reconciliation persisted status but not the
  snapshot's authoritative text. The local correction re-arms observation from
  the durable `REPLAYING` transition, matches source deliveries by their
  source-bound identity, and carries authoritative snapshot text into the
  terminal cache update before client restart. The strict replay and terminal
  equality assertions remain unchanged. Twenty-six focused chat runtime/store
  tests, Desktop typecheck, 47 native static tests, 104 focused Foundation
  tests, and `git diff --check` pass. AS-F06 and G-F remain
  `PARTIAL / UNPROVEN` pending checkpoint deployment and exact-source
  verification.
- Checkpoint `c79d7bfefeba625f3f8ab348824bc1f74d2f043b` was deployed
  exact-source to profile `two`. Run
  `20260830T004212942923Z-2a5ae4c14b42e949b9adc8c60468aff2`
  stopped at the previously proven Browser AS-F02 readiness path; source
  matching, cleanup, and redaction passed. Unchanged-source runs
  `20260830T004712382259Z-9afc68376433bd92aa89686b4af0d1e8`
  and `20260830T010702996955Z-c2fd54d35b49025e933047c1a138e1b5`
  both reached Browser AS-F06 preparation after about sixteen minutes and
  failed with `session revoked`; source matching, cleanup, and redaction again
  passed. The current error bridge omitted the typed revocation reason and
  device type. The local diagnostic now reports only
  `code/detailCode/reason/deviceType`, excluding token, actor, account, and raw
  response data, so the next source-matched run can distinguish expiry from
  same-device takeover without guessing. Replay recording and terminal
  projection corrections remain locally verified but runtime-unproven because
  neither `c79d7bfef` run reached the complete AS-F06 oracle. AS-F06 and G-F
  remain `PARTIAL / UNPROVEN`.
- Diagnostic checkpoint
  `c12ab18aff547fdc41a6793699ac0c2014d064e5` was deployed exact-source to
  profile `two`. Run
  `20260830T012739608708Z-976238cb00d524c2a79b39043e361b86`
  reproduced Browser AS-F06 preparation `session revoked` with source
  matching, cleanup, and redaction passing. The first diagnostic boundary was
  inside `runFoundationF06Prepare`, but the exception arose earlier while
  obtaining the capability-session precondition, so it still omitted the
  typed reason. The local correction moves the same redacted
  `code/detailCode/reason/deviceType` projection to the complete
  `foundationF06Prepare` Harness method. No assertion, retry, cleanup, or
  product behavior changes. AS-F06 and G-F remain `PARTIAL / UNPROVEN`.
- Diagnostic checkpoint
  `0ceae984f723943d1977f671307f593442523faf` was deployed exact-source to
  profile `two`. Run
  `20260830T014644732094Z-786154164c29a051c7f0486c17f9c6f3`
  failed during the first Browser AS-F06 preparation, before its outage and
  restart sequence, with typed authorization evidence
  `code=UNAUTHORIZED`, `detailCode=session_revoked`, and `reason=kicked`;
  `deviceType` was absent. Local source, Station live source, and evidence
  source all matched `0ceae984f`, and redaction passed. The outer Gate manifest
  reported cleanup `passed`, but candidate cleanup artifact
  `20260830T014649454491Z-a20283424c805e0015f5e6a53761670f`
  records `failed` because Desktop logout timed out; cleanup is therefore
  `FAILED`, not `PASS`, despite ports, storage, and actor identity being
  released. This excludes expiry and transient Station validation as the
  current primary failure and narrows ownership to a competing session
  takeover path. The previously deployed replay-sequence and terminal-snapshot
  corrections remain runtime-unproven because the run did not reach the
  complete AS-F06 oracle. AS-F06 and G-F remain `PARTIAL / UNPROVEN`.
  Read-only Station session and request-log correlation then identified the
  crossed authority: the Browser session row remained valid until cleanup,
  while the session rejected during Browser AS-F06 was a `desktop-native`
  session superseded by a later native takeover. Browser Gateway had therefore
  inherited a native renderer's token rather than losing its own
  `desktop-browser` session. In Browser mode, `desktop-rust` still created a
  hidden Tauri WebView; that renderer booted the full identity runtime and
  shared the process-global `AppState.session` with the HTTP gateway. The local
  correction sets Tauri window `create=false` for both Browser BFF launch
  variants, removing the second renderer and leaving the Gateway as the only
  session owner in that process. A dedicated runtime smoke proved Vite,
  Gateway, and WebDriver listeners live while WebDriver remained
  `waiting for webview initialization`; reverse-order cleanup released all
  three ports and temporary storage. Fifteen Desktop runtime isolation tests,
  104 focused Foundation tests, 47 native static tests, Desktop typecheck,
  Agent Acceptance validation, shell syntax, and `git diff --check` pass.
  Runtime proof remains `UNPROVEN` pending checkpoint deployment and a new
  exact-source Foundation run.
- Checkpoint `4c8eb701cfe2f114f2f531a27ffb9aa70b54a327` was deployed
  exact-source to profile `two`. Run
  `20260830T022343527116Z-82001267062fa730fdf9e531e821f189`
  crossed the Browser session-takeover failure and reached the full Browser
  AS-F06 completion path. Station session history showed only
  `desktop-browser` rotations during Browser recovery, while the original
  `desktop-native` session remained active until Native recovery began; the
  rendererless Browser BFF therefore removed the cross-surface session
  authority. The new first failure is
  `agent.acceptance.foundationF06RecoveryDurableReloadDeliveryMissing` while
  parsing the complete Browser AS-F06 capture. Local source, Station live
  source, and evidence source matched `4c8eb701c`; ports and storage were
  released. Candidate cleanup remained `FAILED` because Native logout timed
  out, even though the outer Gate manifest reported `passed`; this discrepancy
  remains part of the required cleanup closure. The durable snapshot reload
  itself returned a source-bound Station delivery and was accepted before the
  client restart, but `runFoundationF06Complete` later derived
  `recoveryFailure` from an earlier handoff object instead of the synchronized
  post-restart handoff. The local correction now drains the evidence chain,
  fail-closes if the durable handoff is absent, and reads recovery evidence
  only from that synchronized snapshot. The Python coordinator additionally
  requires the complete snapshot `sourceDelivery` identity and payload hash
  before restarting the client, while the independent oracle remains
  unchanged. Desktop typecheck, 13 focused coordinator tests, 48 native static
  tests, and `git diff --check` pass. AS-F06 and G-F remain
  `PARTIAL / UNPROVEN` pending exact-source runtime verification.
- Diagnostic checkpoint `aceea9129e4d13f6cf6bf7fe009170ac18093799`
  was deployed exact-source to profile `two`. Run
  `20260830T025500829201Z-59341666bc040c9da3cdcdc80f2abf14`
  crossed the stale durable-reload evidence failure and completed both Browser
  AS-F06 session rotations without creating any `desktop-native` session.
  Execution then reached the Native AS-F06 portion and failed with a 120-second
  WebDriver read timeout on port `4445`. The current runtime client does not
  attach the Harness method name to WebDriver failures, so the source-backed
  operation boundary remains unknown. Candidate cleanup
  `20260830T025505673039Z-64181f24056806d22d02e79df2aa5992`
  again records `FAILED` because the same Native WebDriver timed out during
  logout, while all six runtime ports, storage roots, and actor identity were
  released. The next diagnostic adds only runtime/method context to Harness
  transport errors; no assertion, timeout, retry, or product behavior changes.
  AS-F06 and G-F remain `PARTIAL / UNPROVEN`.
- Diagnostic checkpoint `77bbc182399438701ba0a4977147075d58b28b39`
  was deployed exact-source to profile `two`. Run
  `20260830T032243491098Z-a82a32290139d61b284621d525d3e9d2`
  identified the timed-out operation as Native
  `foundationF06DurableReload`; Station accepted and completed the matching
  replay request with HTTP 200 in approximately 8 ms, while the Native
  WebDriver async call did not return within 120 seconds. Browser AS-F06 had
  already crossed its source-correct `desktop-browser` recovery rotations.
  Candidate cleanup
  `20260830T032249225036Z-1e39427660f5b7348beedab77dfebcec`
  was `FAILED`: the unresponsive Native WebDriver also timed out during logout,
  although all six ports, both storage roots, and actor identity were
  subsequently released. The current pre-fix instrumentation distinguishes
  Station response parsing, Rust `emit_to`, renderer event receipt, and Harness
  completion without changing runtime behavior. AS-F06 and G-F remain
  `PARTIAL / UNPROVEN`.
- Instrumentation checkpoint
  `d9d3e20715a2a0421fbe959aebc0d5ce2ca39faf` was deployed
  exact-source to profile `two`. Run
  `20260830T041506584113Z-c92a4e5e551c6733eab5ec808d79f70f`
  reproduced the Native `foundationF06DurableReload` timeout. Correlated debug
  events prove the exact ordering: the Native renderer received
  `reconnecting`, `replaying`, then persisted terminal `error` sequence `119`;
  Station returned HTTP 200, and Rust successfully emitted `connected`,
  authoritative `snapshot`, and `reconciling` to window `main`, but the
  renderer received none of those later events and never completed the reload.
  The Native replay listener unregistered itself on the persisted terminal
  event before the authoritative snapshot arrived. Station response parsing,
  target window identity, Rust event emission, and WebDriver event-loop
  liveness are therefore excluded. All runtime ports were released; candidate
  cleanup remained `FAILED` because Native logout used the already-unresponsive
  WebDriver control channel. The product correction now aligns the Native
  listener with the existing Browser and Rust replay semantics: a persisted
  terminal row during catch-up no longer closes the listener or clears the
  snapshot deadline; only `catchup_done`, a terminal snapshot, or a terminal
  live-tail event establishes the closing boundary. A focused Native transport
  regression proves `error -> snapshot` delivery without early unsubscribe.
  Desktop typecheck, 401 Desktop tests with one unrelated skip, 106 focused
  Foundation tests, the focused Rust replay-order test, Rust binary check,
  Agent Acceptance validation, and `git diff --check` pass. Post-fix
  instrumentation remains active for one exact-source comparison run. AS-F06
  and G-F remain `PARTIAL / UNPROVEN`.
- Post-fix checkpoint `dbac7302f875afc41c005d923ae4b87e49c53d44`
  was deployed exact-source to profile `two`. Run
  `20260830T045331900639Z-ba7ca0c20d20f858b8424ba9e07c9713`
  proved the Native replay-listener correction: after persisted terminal
  `error` sequence `119`, the renderer received `RECONCILING`, `CONNECTED`, and
  authoritative `snapshot` sequence `119`, then completed durable reload.
  Execution advanced to final Native evidence evaluation and failed with
  `foundationF06RecoveryDurableReloadDeliveryMissing`. The Python coordinator
  had already validated the complete source-bound durable-reload delivery
  before client restart, proving that the evidence was lost only while crossing
  the renderer restart boundary. The local correction carries that already
  validated immutable delivery through the Coordinator and merges it with the
  freshly synchronized post-restart handoff for the independent oracle. Runtime
  ports and storage were released; candidate cleanup still reports `FAILED`
  because Native logout times out after the primary failure. AS-F06 and G-F
  remain `PARTIAL / UNPROVEN`.
- Checkpoint `5f2a6f5f4f0de7b4d76a24a466e896e01a4d3c74` was deployed
  exact-source to profile `two`. A preflight run
  `20260830T053358739674Z-bb5016e2c3e39ffd863392a7d0e43d6e`
  correctly blocked because an Acceptance Driver smoke process still owned
  gateway port `3130`; that process was released before the accepted rerun.
  Run `20260830T053507185569Z-beae2d48d453d4fb6921bc125303e699`
  crossed the durable-reload evidence handoff and passed AS-F06 replay
  sequence equality, source identity, payload hashes, stale-generation,
  stale-revision, and stale-terminal checks. The new first failure is Browser
  AS-F06 `terminalProjectionEqualsStation`: the client retained status
  `failed` and content hash
  `e19e95e4d531ca39a171b3900306e1015fbd1a60b693acd770a4fd373c7ca846`,
  while Station authoritatively reported `interrupted` and hash
  `21f98f1c3b3c5a596b9e9e67c61289115f1fbdbf2f357b74847cc8722eff7cbd`.
  Runtime and evidence source commits matched, redaction passed, and all
  allocated ports were released. The outer cleanup status was `passed`; the
  candidate cleanup artifact requires separate inspection before cleanup can
  be claimed. AS-F06 and G-F remain `PARTIAL / UNPROVEN`.
- Instrumentation checkpoint `98548eedc2a5e905e713fb61c78353b7ae2985f4`
  reproduced the projection mismatch in exact-source run
  `20260830T060656514138Z-212276ef2af0c31e4726da2ea4b68aff`.
  Immediately after authoritative snapshot reconciliation, the failing Native
  tuple held status `interrupted` and content length `576`; after client
  restart, the same projection had reverted to status `failed` and content
  length `163`, while Station remained `interrupted` with content length `576`.
  This proves that replay delivery and the pre-restart reducer are correct and
  isolates the defect to durable cache/startup reconciliation. The local
  product correction makes equal-sequence cache merges revision-aware, lets an
  authoritative same-sequence snapshot supersede a prior terminal event,
  replaces snapshot content by field presence, and prevents generic message
  merging from restoring stale terminal fields over an authoritative terminal.
  Desktop 403 tests with one unrelated skip, 106 focused Foundation tests, 48
  Native static tests, `client-chat-core`, Desktop typecheck/build, Agent
  Acceptance validation, and `git diff --check` pass. AS-F06 and G-F remain
  `PARTIAL / UNPROVEN` pending checkpoint deployment and exact-source rerun.
- Checkpoint `25e8b0e6590aae8aac22c447428ca0aed9aa2ab0` was deployed
  exact-source to profile `two`. Run
  `20260830T064048656280Z-c8bf14ec8c6d1edd6381367a8f05a5fb`
  showed that timestamp ordering alone did not close the restart race: the
  failing Browser tuple was correct immediately after snapshot reconciliation
  (`interrupted`, content length `677`) but restored the older terminal event
  after restart (`failed`, content length `80`). The correction now records
  explicit cache reconciliation provenance and gives a source-bound
  `station-snapshot` precedence over a same-sequence `station-list` row,
  independent of cross-host clocks. The generic message and operation reducers
  retain their authoritative-snapshot protections. Local package tests,
  Desktop 403 tests with one unrelated skip, 106 focused Foundation tests, 48
  Native static tests, Desktop typecheck/build, Agent Acceptance validation,
  and `git diff --check` pass. AS-F06 and G-F remain `PARTIAL / UNPROVEN`
  pending another exact-source run.
- Checkpoint `898ea9f7ef868efdc0463f1dbea7bb8ac30a8d8b` was deployed
  exact-source to profile `two`. Run
  `20260830T070915770693Z-1cd477b38e87581aed2ca2ee1e5131c0`
  proved the first two AS-F06 tuples source-matching after restart, then failed
  at Browser `direct_model / en / single / sample-001` on
  `terminalProjectionEqualsStation`. The final client projection was `failed`
  with hash
  `b7edb953de4072955b8ff7bd91abcac5e7515e59e61a25a4dbaf92e26a021b3d`,
  while Station was `interrupted` with hash
  `2e82651ac94a0272148877b0771f993fd9d6419aedf8f21ffebae04888ed1d06`.
  Source, deployed Station, and evidence all matched `898ea9f7e`; redaction
  passed. Station replay returned persisted terminal sequence `137` before its
  authoritative same-sequence snapshot, while
  `chatRuntime.consumeRecoveryEvent` treated that catch-up `error` as a closing
  terminal, removed the active recovery record, and aborted the transport
  before the snapshot could update the runtime projection. Cache provenance is
  therefore necessary but not sufficient; the remaining correction belongs to
  the `agent-chat` runtime closure predicate.
  The outer Provisioner reported cleanup `passed`, but the candidate cleanup
  artifact remained `failed` because Native logout timed out; all six ports,
  both storage roots, and actor identity were released. AS-F06 and G-F remain
  `PARTIAL / UNPROVEN`.
- The local runtime correction now carries an explicit catch-up/live-tail
  boundary in each recovery subscription. A persisted terminal event advances
  the recovery cursor and may update the provisional message projection, but
  cannot remove the active recovery or close its stream before the
  authoritative snapshot. A terminal snapshot always closes; after
  `catchup_done`, a terminal live-tail event closes normally. Focused runtime
  regressions prove both `error(N) -> snapshot(interrupted,N)` and
  `catchup_done -> error(N)` ordering. Desktop typecheck, 406 Desktop tests
  with one unrelated skip, Desktop build, 106 focused Foundation tests, 48
  Native static tests, `client-chat-core`, Desktop Rust library check, scoped
  ESLint, Agent Acceptance validation, and `git diff --check` pass. This is
  implementation evidence only; AS-F06 and G-F remain `PARTIAL / UNPROVEN`
  pending checkpoint commit, exact-source deployment, and runtime proof.
- Checkpoint `b46ac83020024673030f954a468ea1b5f0944fb4` was deployed
  exact-source to profile `two`. The first invocation,
  `20260830T075138404723Z-81b5c5a7203aea354056ce6a7fc0129d`,
  failed closed before AS-F06 fault injection because the invocation supplied
  the wrong restart-authorization variable; it is not product evidence.
  Correctly authorized run
  `20260830T080743547253Z-f94c424ec124071ff62ece0ba30f48a5`
  proved all four AS-F06 final projections equal to Station after restart. The
  previously failing Browser `en` tuple was `interrupted` on both sides with
  content length `671` and matching hash
  `ce14fc3815dc71b445aed18542415f183f13ce358e5b7444f0b6bf53fc3c8bcf`.
  Runtime instrumentation directly observed catch-up terminal rows with
  `terminalClosesRecovery=false`, followed by same-sequence terminal snapshots
  with `terminalClosesRecovery=true`. The Gate then advanced to Browser AS-F07
  `direct_model / en / single / sample-001`, where
  `branchSwitchPersisted`, `editCreatedSibling`,
  `regenerateCreatedSiblings`, and `staleBranchConflict` were false. Source,
  deployed Station, and evidence all matched `b46ac8302`; redaction passed.
  The outer Provisioner reported cleanup `passed`, but the candidate cleanup
  artifact remained `failed` because Native logout timed out, while all ports,
  storage roots, and actor identity were released. AS-F06 is source-matching;
  G-F remains `PARTIAL / UNPROVEN` at AS-F07.

### AS-F06 Disconnect, Replay, And Recovery
- **Precondition**: Accepted streaming turn and acknowledged cursor.
- **Action**: Drop connection, switch page, restart Desktop/Station, replay, and force replay failure/retry.
- **Expected**: `CONNECTION_LOST -> RECONNECTING -> REPLAYING -> RECONCILING -> CONNECTED`; projection remains idempotent.
- **Failure variant**: Recovery failure offers retry/snapshot reload and cannot overwrite a newer revision.
- **Evidence**: App/Browser DOM, cursor/event rows, replay equality, terminal readback.
- **Status**: source-matching runtime proof passed for all required AS-F06 tuples

### AS-F07 Retry, Regenerate, Edit, And Branch
- **Precondition**: Completed and failed turns with feedback/usage references.
- **Action**: Retry failure, regenerate twice, edit/resend user message, and switch active branch.
- **Expected**: Retry is an attempt; regenerate/edit create immutable siblings; original content/usage/feedback remains.
- **Failure variant**: Stale branch mutation conflicts; delete is never represented as retry/regenerate.
- **Evidence**: DOM branch selector, Station lineage/active-branch rows, independent usage/feedback.
- **Status**: implementation checkpoint locally verified; exact-source runtime proof pending
- Read-only reconciliation of
  `20260830T080743547253Z-f94c424ec124071ff62ece0ba30f48a5`
  confirmed that the prior AS-F07 capture did not invoke any revision action
  and derived four unrelated assertions from `messages.length > 1`; Python had
  no independent AS-F07 oracle. The local correction now drives production
  retry, two regenerations from one source response, edit/resend, stale-version
  branch mutation, and active-branch selection. It emits Station response and
  readback lineage, retry attempt deltas, immutable source/usage/feedback
  hashes, and receiver DOM message IDs. The independent Python evaluator
  recomputes all six AS-F07 assertions and rejects missing, empty, or mutated
  evidence. Desktop typecheck, 406 Desktop tests with one unrelated skip,
  Acceptance-enabled Desktop build, 112 focused Foundation tests, 48 Native
  static tests, Agent Acceptance validation, and `git diff --check` pass.
  Product behavior remains `UNPROVEN` until an exact-source runtime run
  exercises these operations.
- Instrumentation checkpoint `4fc6bcd5645c6c3a8587f822e4ea8a0fbf6ba4b7`
  was built and deployed exact-source to profile `two`. Run
  `20260830T092128791528Z-9a9c827e6d32f6b854cb103f7e29d6d8`
  reached Browser AS-F07 after the source turn emitted text, requested
  cancellation at sequence 3, and observed the authoritative `cancelled`
  terminal event. The first `RetryTurn` command then failed before a retry
  attempt result was returned. The run remained `PARTIAL / UNPROVEN`; outer
  Provisioner cleanup passed. The next diagnostic checkpoint records the
  already-fetched pre-retry attempt state plus the typed command error so the
  owner can be distinguished between Station retry admission and Desktop
  transport mapping without adding waits or changing product behavior.
- The first `cb35152b8` diagnostic rerun,
  `20260830T095130447358Z-e0eb35d39eae19c3651150749c988f8b`,
  is non-product evidence. Coordinator process inspection incorrectly treated
  its live remote source-lease transport as an orphan and terminated it. The
  run consequently failed before AS-F07 with an invalid Native WebDriver
  session, and cleanup correctly reported the source lease exiting before
  cleanup. Two overlapping launch attempts were rejected by the profile lease
  before provisioning and did not execute product scenarios. No product
  conclusion is drawn from these runs; the next run must hold one uninterrupted
  profile/source lease from provisioning through cleanup.
- Exact-source run
  `20260830T095955356967Z-30fdd0228f48a45a926c97824d5fec35`
  held one uninterrupted lease and failed first at Browser AS-F06
  `replayAfterAcknowledgedCursor`. Runtime evidence shows the original
  command-stream fault was injected at cursor 3, while the still-live global
  Station event stream advanced the durable client cursor to 6 before the
  Station outage established recovery. The recovery stream correctly delivered
  7-159 and the final client/Station interrupted projection hashes matched, but
  the evidence producer compared that replay with a Station readback starting
  from the stale injection cursor and therefore included 4-6 only on the
  Station side. Source identity, payload hashes, stale fences, and cleanup
  passed. The correction is limited to deriving the replay readback boundary
  from the first accepted `REPLAYING` transition while retaining the original
  injection cursor for duplicate/out-of-order proof.
- Checkpoint `9ebe0c4de1173fc26831d9c63cb0c3db2b05cade` passed local
  type/static verification and was deployed exact-source. Run
  `20260830T103212068127Z-b561aaacb7748386ae6310f4d09f0d18`
  stopped earlier at Browser AS-F05 with
  `agent.acceptance.turnSubmissionTimeout`; cleanup passed and no AS-F07
  instrumentation event was emitted. This single provider-path timeout does
  not disprove the AS-F06 evidence-boundary correction and is insufficient to
  justify a product or Gate change. The next action is one unchanged
  source-matched rerun; only a repeated AS-F05 failure with runtime evidence
  can become the next implementation owner.

### AS-F08 Context Attribution And Omission
- **Precondition**: Fixed memory, Skill, Knowledge, history, and token-budget fixtures.
- **Action**: Run ten turns carrying fixed early facts, force history compression after turn six, repeat the final turn twice, disable one source, and exceed context budget.
- **Expected**: Turn ten recalls pre-compression facts; ContextLedger identifies the compression source/snapshot, retained facts, exact source IDs, token accounting, and typed truncation/omission deterministically.
- **Failure variant**: Disabled/unauthorized source is absent; ledger redaction exposes no secrets.
- **Evidence**: Source-detail DOM, ContextLedger/Turn rows, fixed-answer assertions.
- **Status**: pending; before execution, audit the pre-existing compression
  session split so one Turn cannot span parent/child conversation replay
  authority

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

This path requires W6 (Governed ToolCall Fencing) to land the ProposeBatch
capability-check logic. No external endpoint currently triggers it.

Consequence:
- `unsupported` and `schemaMismatch` remain `UNPROVEN` until W8a makes the W6
  production path reachable.
- The complete G-F run after W8a requires every AS-F10 assertion to be `true`.
  `None`/deferred values cannot pass a required tuple.
- The 3 diagnostic emitters (`unauthorized`, `signatureTamper`,
  `crossDevice`) plus `zeroExecutionOnReject` remain useful implementation
  evidence but are not a Foundation Gate pass.

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
- **Action**: Execute the W8b cutover, restart Desktop/Station, search/open the former page and command, call every former plugin CRUD route, and trigger the former test action.
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
`OWNER_APPROVED_EXECUTION`; G1-A through G1-F and the pre-W1 G1-XR diagnostic
closure are complete, G-F is blocked on W1/W3/W6/W8a, and all Product Gates
remain `UNPROVEN`.

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
