# Modern Chat Agent — Integration

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-07-30 | **Updated**: 2026-07-30
> **Owner**: Peers-Touch Agent Team

---

## 1. Integration Boundary

This design specializes the governing Agent blueprint into one canonical
single-Agent runtime. The referenced benchmark-era source remains an upstream
constraint, not the product identity. This design does not create a second
Agent subsystem.

Upstream constraints retained:

- `docs/global/architecture.md`
- `docs/architecture/agent/agent-lobehub-blueprint.md`
- `docs/architecture/agent/provider-station-ownership/`
- `docs/architecture/agent/agent-memory-architecture.md`
- `docs/architecture/agent/agent-self-growth-architecture.md`
- `docs/client/desktop/runtime-projections.md`

Downstream consumers:

- Modern Chat execution plan.
- Desktop Agent page/runtimes.
- Agent Canvas individual node execution.
- Future Mobile/channel Agent clients.

## 2. Current Assets To Retain

### Station

| Asset | Retained responsibility |
|---|---|
| `service/turn_service.go` | Canonical turn state machine and model-tool-model loop |
| `service/prompt_assembly_service.go` | Context assembly foundation |
| `service/memory_service.go` | Memory retrieval, snapshots, extraction, attribution |
| `service/skill_service.go` and `skills_guard_service.go` | Skill truth, versioning, trust, scan |
| `service/knowledge_retrieval_service.go` | Knowledge retrieval and trace references |
| `service/compression_service.go` | Context compression foundation |
| `service/provider_service.go` | Direct model provider execution |
| `service/credential_pool_service.go` | Actor-scoped credential lease and rotation |
| `service/tool_registry_service.go` | Tool schema/owner resolution |
| `service/local_tool_broker.go` | Transitional client-local capability request/result bridge |
| `service/error_classifier_service.go` | Typed recovery classification foundation |
| `service/growth_*` and `review_service.go` | Feedback, evaluation, and correction foundation |
| `service/cli/` | Station-local registered CLI execution foundation |
| `infrastructure/persistence/` | Station durable Agent entities |

### Desktop Rust

| Asset | Retained responsibility |
|---|---|
| `application/agent_turn/` | Station stream bridge, cancellation forwarding, local tool request handling |
| `application/mcp/` and `application/tools/` | Device-local capability execution |
| `application/agent_orchestration/` | Agent Canvas bridge, downstream of the single-Agent kernel |
| `interface/http_gateway/` | Browser gateway to the same Station business contracts |

### Desktop Web

| Asset | Retained responsibility |
|---|---|
| `runtimes/agentTopicRuntime.ts` | Conversation projection lifecycle, after Station rebinding |
| `store/agentTopics.ts` | Conversation projection cache |
| `store/chat.ts` | Transitional message/stream reducer only |
| `services/desktop_api.ts` | Low-level transport adapter |
| `MessageBubble` and chat components | Rendering and user actions |
| Agent capability/tool/skill/knowledge stores | Runtime projections, not truth |

## 3. Current Assets To Replace Or Delete

| Current path/behavior | Target | Disposition after cutover |
|---|---|---|
| Desktop-local CLI turn execution in `application/agent_turn` | Station Direct Model or External Agent runtime | Delete |
| Desktop-local CLI model command execution in provider module | Station runtime/catalog discovery | Delete |
| Desktop in-memory `application/chat::ChatStore` | Station Agent conversation/message APIs | Delete |
| Browser gateway one-shot chat path | Sequenced Station SSE gateway | Remove from interactive Agent chat |
| `workspace_root` and client-submitted execution fields | Station config plus opaque client/Station resource refs | Delete from shared turn authority |
| Desktop-specific local tool names/owner/guidance | Platform-neutral ClientCapabilitySession contract | Replace |
| Local durable Agent definition/config files | Station AgentDefinition | Delete shared-state fields; retain local UI preference only |
| Flat retry/regenerate mutation | Station message lineage and branch selection | Replace |
| Metadata-only attachment turn path | Canonical opaque AttachmentRef | Replace |
| Unsequenced ephemeral stream assumptions | TurnEvent cursor/replay/snapshot | Replace |
| Phase labels that redefine P0-P2 | `MODERN_CHAT_AGENT_V1` capability IDs | Replace in revised plan |

## 4. Document Reconciliation

### 4.1 `provider-runtime-strategy.md`

Current Desktop-local CLI topology conflicts with this design and Provider
Station Ownership.

After this design is accepted:

- Mark it `superseded`.
- Point to this module and Provider Station Ownership.
- Preserve useful historical CLI output-format notes only as context, not
  current architecture.

### 4.2 `provider-station-ownership/`

Retain Station-sole-executor, actor isolation, credentials, and SSE rules.
Extend it to distinguish:

- Stateless registered model CLI adapter.
- Stateful registered external Agent runtime with conversation binding.

The current statement that Provider Execution Runtime retains no state across
turns remains true for Direct Model Runtime only.

### 4.3 `agent-lobehub-blueprint.md`

Retain it as the broader capability/product architecture. This module becomes
the detailed single-Agent runtime contract it references.

Its existing LobeHub capability ledger remains useful, but completion claims
must satisfy this module's runtime, evidence, and ownership gates.

### 4.4 `agent-canvas-orchestration.md`

Retain as the multi-Agent architecture. Each Agent node invokes the canonical
Modern Chat Agent kernel and inherits:

- Runtime capability resolution.
- Context and budget contracts.
- Turn events and trace.
- Tool policy.
- Feedback and terminal semantics.

Agent Canvas may add task-graph events, but cannot redefine individual turn
completion.

### 4.5 Existing 20260411 Agent Plans

System prompt, memory, skill routing, error recovery, context compression, and
background review plans are implementation foundations. They are not separate
runtime owners.

Their acceptance evidence should map into ContextLedger, TurnTrace, runtime
budget, and evaluation contracts defined here.

### 4.6 `20260730-modern-chat-agent.md`

The current execution plan remains blocked. After design acceptance it must be
rewritten to:

- Trace to `MCA-D01` through `MCA-D13`.
- Prioritize single-Agent context, continuity, budgets, capability, and
  evaluation before collaboration.
- Remove multi-Agent implementation from the plan and use Agent Canvas as a
  downstream readiness consumer.
- Add stateful runtime binding and event replay closures.
- Use the `MODERN_CHAT_AGENT_V1` profile instead of conflicting P0-P2 labels.

## 5. Capability Mapping

| Capability | Existing foundation | Missing architecture closure |
|---|---|---|
| Streaming/cancel | Station SSE, Rust bridge, Web reducer | Sequencing, reconnect, snapshot, browser parity |
| Conversation/history | Station persistence plus Desktop local store | Station CRUD truth, branch lineage, active-turn admission |
| Prompt/context | Prompt assembly, memory, skills, compression, knowledge | Typed ContextLedger and complete budget |
| Direct providers | Provider service and credential pool | Capability snapshot and attempt semantics |
| CLI providers | Station and Desktop CLI implementations | Remove split path; classify stateless vs stateful |
| External Agent runtime | CLI foundations | Conversation binding, external session epoch, runtime home lifecycle |
| Tools/MCP | Tool registry, local broker, Desktop executor | Budgets, loop detection, replay, durable approval evidence |
| Client-local capabilities | Desktop-specific bridge and workspace path | Capability lease, opaque resource refs, Mobile-compatible degradation |
| Attachments | Composer/upload metadata | Opaque durable references, extraction, capability checks |
| Retry/regenerate | Desktop actions | Immutable Station lineage and typed commands |
| Memory/skills | Strong Station services | Context attribution and end-to-end quality evidence |
| Feedback/growth | Growth and review services | Unified terminal outcome, usage, and replay contract |
| Multi-Agent | Orchestration service and Canvas design | Downstream gating on single-Agent readiness |

## 6. Trust And Security Integration

Trust boundaries:

```text
Client Web
  -> Client capability kernel trust boundary
  -> TLS/JWT
  -> Station actor/business boundary
  -> registered provider/runtime boundary
```

Rules:

- JWT actor identity is never taken from request payload.
- Station credentials never return to clients.
- Client-local tools receive least-authority opaque requests.
- Runtime-home references and external session handles are internal metadata.
- Diagnostic exports redact secrets, local paths, and sensitive tool data.
- Stateful runtime homes cannot cross actors or conversations.
- Station accepts only registered runtime adapters and bounded process policy.

## 7. Projection Integration

The Desktop Agent page already declares `agentCapability` and `agentTopic`
runtimes. The target projection split is:

| Runtime | Projection |
|---|---|
| `agentRuntime` / `agentCapability` | Agent definition, bindings, runtime readiness |
| `agentTopicRuntime` | Conversations, branch heads, active/queued turn summaries |
| `chatRuntime` | Messages, sequenced turn events, replay cursor, stream lifecycle |
| `toolRuntime` | Tool registry, approvals, execution/audit status |
| `skillRuntime` | Skill bindings, trust, activation diagnostics |
| `knowledgeRuntime` | Resource/index/retrieval diagnostics |

Every runtime has:

- Typed event consumption.
- Actor-scoped bootstrap.
- Periodic reconciliation.
- Idempotent install/teardown.
- No overlapping ownership.

Pages render these projections and do not fetch durable business state on mount.

## 8. Compatibility Policy

Compatibility is allowed only as an observable migration mechanism:

- A compatibility adapter may translate old command shapes into canonical
  Station commands.
- It cannot retain independent persistence or execution.
- Every compatibility path has a deletion condition.
- No fallback may execute an Agent turn locally when Station fails.
- Old unsequenced stream events may be consumed during migration only if the
  adapter assigns deterministic canonical semantics.

## 9. Required Acceptance Evidence

Architecture acceptance requires evidence plans for:

- Direct model and registered stateless CLI runtime.
- Stateful external Agent runtime if claimed in `MODERN_CHAT_AGENT_V1`.
- Desktop App, browser gateway, and Mobile contract compatibility.
- Two actors and two conversations.
- Five-turn continuity, compression, memory, skill, and knowledge attribution.
- Tool approval, denial, timeout, loop, and cancellation.
- Queued input, duplicate submission, reconnect, replay, and restart.
- Model capability degradation.
- Usage/feedback/diagnostic replay.
- Cross-actor, credential, runtime-home, and attachment security.

If a runtime kind lacks evidence, the capability profile must mark it
unsupported rather than silently partial.

## 10. Integration Review Questions

1. Is stateful external Agent runtime support required for the first accepted
   capability profile, or should the first profile support Direct Model only?
2. What event retention window and text-checkpoint compaction policy satisfy
   replay without excessive storage?
3. Which cost facts are authoritative when a provider does not report cost?
4. Which local capabilities require mandatory approval regardless of user
   preference?
5. What retention policy applies to message branches, runtime homes, traces,
   and diagnostic evidence?
6. When multiple user devices are online, what explicit selection policy
   chooses the client capability session for a privileged local request?

These are review decisions. They must be resolved before execution planning,
not silently chosen by implementation.

## 11. Measurement Protocol

Every runtime evidence report records:

- Commit, Station profile, Desktop mode, provider/runtime/model, capability
  snapshot, network path, machine, and cold/warm state.
- Raw event timestamps, terminal state, persisted readback, and diagnostic
  export path.
- Infrastructure failures separately from product failures.

Required sample policy:

| Claim | Workload |
|---|---|
| Stream bridge latency | 30 successful turns per App/browser and runtime cell; report P50/P95/P99 without dropping cold samples |
| Cancellation cleanup | 20 cancellations per runtime kind at text, tool, and approval boundaries; all must reach bounded terminal cleanup |
| Replay/reconciliation | 20 forced disconnects at varied event sequences plus Desktop restart; terminal projection must equal Station snapshot |
| Context budget | Fixed short, long, attachment-heavy, and tool-heavy cases at 50%, 80%, and near-limit context usage |
| Queue/idempotency | Concurrent duplicate submissions and capacity overflow under one conversation and two actors |
| Quality | Versioned fixed cases for continuity, memory, skill procedure, knowledge citation, tool completion, and unsupported-claim rejection |

The evidence report includes every failed sample. Missing raw evidence, an
unknown runtime identity, or an unverified capability snapshot fails closed.

## 12. Architecture Acceptance Mapping

The product-level source is `acceptance-matrix.md`. These architecture
scenarios map its receiver-perspective outcomes to runtime and persistence
proof. A plan may add cases but cannot remove or weaken them without accepted
product and architecture amendments.

| ID | Receiver-perspective scenario | Required result |
|---|---|---|
| MCA-A01 | Configure Agent and Direct Model | Station persists versioned Agent/runtime config; client shows readiness |
| MCA-A02 | First real turn | Progressive response, durable messages/turn/trace, no synthetic stream |
| MCA-A03 | Ten-turn continuity | Earlier facts remain correct; ContextLedger explains history/compression |
| MCA-A04 | New topic and restart | Topic isolation and active branch survive Desktop/Station restart |
| MCA-A05 | Memory and skill use | Correct recall/procedure with exact memory/skill attribution |
| MCA-A06 | Knowledge use | Answer cites the actual retrieved resource chunks; disabled resource is absent |
| MCA-A07 | Tool approve/deny/timeout | Tool executes once only after policy; denial/timeout remains durable |
| MCA-A08 | Attachment | Authorized image/file works on compatible model; unsupported/oversized input rejects early |
| MCA-A09 | Cancel/reconnect/replay | Upstream work stops; reconnect reconstructs the Station terminal projection |
| MCA-A10 | Retry/regenerate/branch | Original response remains; active branch and usage attribution are correct |
| MCA-A11 | Capability degradation | Missing vision/tool/reasoning/local capability is disclosed before execution |
| MCA-A12 | Usage/feedback/diagnostics | Usage and feedback persist; redacted export reconstructs the turn |
| MCA-A13 | Actor/device isolation | Two actors and two devices cannot cross-read state, credentials, runtime homes, or resource refs |
| MCA-A14 | Future Mobile contract | Mobile can use all Station capabilities and cleanly reject unsupported Desktop-only local capabilities |

Surface evidence must include the visible interaction, Station readback, and
trace/runtime evidence. A screenshot alone is not a pass.

## 13. Canonical Completion Locator

This is the authoritative starting point for the next planning job.

| Capability ID | Architecture decisions | Contract root | Owning runtime/module | Verified foundation | Remaining closure | Deletion obligation | Completion evidence |
|---|---|---|---|---|---|---|---|
| MCA-C01 Agent/config truth | D01, D12 | `AgentDefinition` | Station Agent config | Agent/config services exist | Versioned shared Agent truth and projection | Local durable Agent truth | A01, A04, A13 |
| MCA-C02 Conversation/message truth | D01, D06, D08 | `Conversation`, `AgentMessage` | Station conversation/turn | Persistence models exist | CRUD, branches, queue, idempotency | Desktop `ChatStore` | A02-A04, A09-A10 |
| MCA-C03 Runtime execution | D02, D03, D05 | `RuntimeSnapshot`, runtime binding | Station runtime resolver/direct/external | Provider and CLI foundations exist | Runtime classification, binding, resume/reset | Desktop AI CLI execution | A02, A11, A13 |
| MCA-C04 Context intelligence | D04 | `ContextLedger` | Station prompt/memory/skill/knowledge | Services exist | Deterministic ledger and complete token budget | Untyped prompt-only attribution | A03, A05-A06 |
| MCA-C05 Stream/recovery | D06, D07 | `Turn`, `TurnEvent` | Station turn/event plus client chat runtime | SSE bridge exists | Sequence, cursor, replay, snapshot, queue | Browser one-shot path | A02, A09 |
| MCA-C06 Model capability | D05, D09 | capability snapshot, budget | Station runtime resolver | Model metadata partially exists | Fresh provenance, degradation, hard limits | Client/provider-name inference | A08, A11 |
| MCA-C07 Tool/MCP policy | D09, D10, D13 | `ToolCall`, capability request/result | Station registry plus client executor | Tool loop/approval bridge exists | Loop budget, durable audit, portable owner | Desktop-specific tool contract | A07, A09, A13-A14 |
| MCA-C08 Attachments/resources | D04, D05, D13 | attachment/resource refs | Station storage/context plus client capability kernel | Upload/composer foundations exist | Opaque refs, extraction, auth, model gate | Metadata/local-path payload | A08, A13-A14 |
| MCA-C09 Evaluation/evidence | D10, D12 | usage, feedback, diagnostic export | Station trace/evaluation | Trace/growth foundations exist | Unified outcomes, fixed cases, replay export | Screenshot-only claims | A12 |
| MCA-C10 Client portability | D01, D05, D07, D13 | client capability session | Shared client contract plus platform kernels | Desktop and Mobile Tauri kernels exist | Portable bridge, platform capability registry, Mobile contract test | `desktop-rust` shared semantics | A11, A13-A14 |

Locator rules:

1. The execution plan creates at least one internally complete closure for
   every `MCA-Cxx` row.
2. Every task cites its `MCA-Cxx`, `MCA-Dxx`, target owner, deletion obligation,
   deterministic gate, and evidence path.
3. Work not mapped to a locator row is out of scope or requires a design
   amendment.
4. A row is complete only when its acceptance scenarios pass and its deletion
   obligation is proven by tree-wide search.
5. The Agent module is complete only when all required `MCA-Cxx` rows are
   complete; file counts or “code exists” do not count.

## 14. Planning Handoff Query

The next planning job must begin by reading:

1. `README.md`
2. `decisions.md`
3. `data-model.md §7`
4. This document §12-13
5. The blocked execution plan

It must output a traceability report answering:

```text
For each MCA-Cxx:
  current repository assets
  target execution closure
  dependency predecessors
  deletion closure
  deterministic commands
  Surface Gate cases
  evidence path
  status and blockers
```

If any row cannot be mapped without inventing architecture, planning returns
`DESIGN_AMENDMENT_REQUIRED`.
