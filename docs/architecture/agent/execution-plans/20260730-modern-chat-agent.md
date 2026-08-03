# Modern Chat Agent — Execution Plan (SUPERSEDED)

&gt; **Status**: superseded
&gt; **Superseded by**: [20260730-modern-chat-agent-v1.md](./20260730-modern-chat-agent-v1.md)
&gt;
&gt; This plan was drafted before PRODUCT and DESIGN stages completed. It uses outdated
&gt; P0/P2 labels, includes deferred multi-Agent collaboration, and does not follow
&gt; the MCA-Cxx completion locator. Use the v1 plan above for all execution.

---

## 1. Objective

Close one complete Agent chat lifecycle before expanding:

```text
select Agent and Station-owned provider
  -> create or select Station-owned conversation
  -> submit turn
  -> Station assembles config, history, knowledge, and tool policy
  -> Station executes the provider and owns the turn loop
  -> Desktop Rust bridges local capabilities when Station requests them
  -> Desktop Web renders typed stream events
  -> Station persists messages, turn trace, and collaboration state
```

The plan covers the requested P0 through P2 capability set:

- P0: Direct and CLI turns, true streaming in Desktop App and browser gateway,
  multi-turn context.
- P1: System prompt/persona, conversation management, cancellation, retry, and
  regenerate.
- P2: Tool/MCP loop, knowledge retrieval, attachments, and Agent
  collaboration.

This is primarily an integration, ownership-cutover, and acceptance plan. Most
capabilities already have implementation foundations and must be verified and
repaired rather than rebuilt.

Product-stage conflict: `MCA-P15` defers multi-Agent collaboration until
single-Agent readiness. The replacement plan must remove collaboration from
this plan and treat Agent Canvas as a downstream consumer.

## 2. Product And Design Preconditions

This plan predates the PRODUCT stage and must be replaced after the product and
architecture gates pass. Execution and plan approval must not start until:

| Product prerequisite | Current status |
|---|---|
| `modern-chat-agent/product-definition.md` capability profile and product decisions approved | draft / blocked |
| `benchmark-disposition.md` LobeHub/Peers-Touch dispositions approved | draft |
| `experience-contract.md` and `product-state-model.md` approved | draft |
| `acceptance-matrix.md` receiver-perspective assertions approved | `PRODUCT_DESIGN_INCOMPLETE` |
| Required Agent Chat prototype surfaces confirmed | `pending-review`, not confirmed |

After PRODUCT approval, architecture review must resolve the following
conflicts:

| ID | Blocking issue | Required resolution |
|---|---|---|
| DG-1 | `provider-runtime-strategy.md` assigns CLI turn execution to Desktop Rust, conflicting with Station-sole-executor ownership | Mark it superseded or rewrite it so Station owns all provider execution |
| DG-2 | `provider-station-ownership/{design,decisions}.md` still carry `draft` metadata although the integration document and code treat ADR-1 as current | Promote the accepted ownership decision or record its replacement |
| DG-3 | Durable Agent conversation CRUD is not exposed as a complete Station Agent API; Desktop `application/chat/mod.rs` still owns an in-memory `ChatStore` | Accept the Station conversation CRUD contract and migration/deletion boundary |
| DG-4 | Retry/regenerate durable semantics are not defined: append replacement, supersede, or destructive delete | Record the accepted message lineage and persistence rule |
| DG-5 | Agent attachment transport is metadata-only in the current turn request and lacks an accepted durable multimodal ingestion contract | Define attachment references, ownership, supported media, provider degradation, and trace persistence |
| DG-6 | Browser gateway streaming transport is not defined even though architecture requires SSE-only delivery | Define how HTTP gateway mode proxies Station SSE without falling back to one-shot execution |

Until the PRODUCT gate and DG-1 through DG-6 are accepted, only product/design
review, repository inventory, and test construction may proceed. No
implementation workstream may claim completion.

## 3. Architecture Baseline

### 3.1 Governing Sources

| Source | Status used by this plan | Constraint |
|---|---|---|
| `docs/architecture/agent/agent-lobehub-blueprint.md` | active | Station owns the turn loop and durable Agent intelligence; Desktop Rust owns local capability execution; Desktop Web owns projection |
| `docs/architecture/agent/provider-station-ownership/README.md` | current ownership statement | Station is the sole provider authority and executor; clients are config editors and SSE consumers |
| `docs/architecture/agent/provider-station-ownership/design.md` | pending metadata acceptance under DG-2 | SSE-only delivery, Station CLI adapter execution, per-actor isolation, no client LLM execution |
| `docs/architecture/agent/provider-station-ownership/decisions.md` ADR-1 | pending metadata acceptance under DG-2 | Desktop/Mobile never call LLM APIs or spawn AI CLI processes |
| `docs/architecture/agent/agent-canvas-orchestration.md` | active design | Collaboration lifecycle, GoalKeeper coverage, execution, recovery, and final reduction |
| `docs/client/desktop/runtime-projections.md` | active | Pages render; runtimes own long-lived projections and stream lifecycle |
| `model/domain/agent/*.proto` | canonical contract source | Cross-runtime Agent contracts are proto-first |

### 3.2 Non-Governing Source

`docs/architecture/agent/provider-runtime-strategy.md` is not an execution
source for this plan. Its Desktop-local CLI execution topology conflicts with
the Station ownership architecture and must be resolved by DG-1.

### 3.3 Traceability

| Requirement | Architecture reference | Decision/invariant | Required evidence |
|---|---|---|---|
| Direct and CLI turn execution | Provider Station Ownership | ADR-1; Station-sole-executor | Process/runtime evidence shows both providers execute on Station |
| Per-actor provider isolation | Provider Station Ownership design §1, §5 | Per-actor isolation; turn-time revalidation | Actor A cannot list or use Actor B credentials/config |
| Streaming and cancellation | Provider Station Ownership design §5.2, §5.7 | SSE-only delivery; disconnect cancels Station turn | Progressive frames plus upstream cancellation/process cleanup |
| Turn loop and trace | Agent LobeHub Blueprint §6.2 | Station owns state machine and final trace | Persisted messages and TurnTrace match rendered result |
| Conversation/config truth | Agent LobeHub Blueprint §6.1 | Station owns shared durable state; Desktop owns local preferences only | Restart and second-client readback from Station |
| Local tools and MCP | Agent LobeHub Blueprint §6.2, §6.5 | Station decides/traces; Desktop Rust executes device-local capability | Approval, execution, result, and audit complete one live turn |
| Knowledge | Agent LobeHub Blueprint §6.1, P4 | Retrieval and injection are Station-owned and traceable | Trace records selected knowledge chunks |
| Attachments | Agent LobeHub Blueprint P0-4 and DG-5 | Composer drafts local; durable turn attachment contract proto-first | Durable reference survives restart and provider capability is enforced |
| Collaboration | Agent Canvas Orchestration §2-4 | Station-owned lifecycle and final coverage | Multi-Agent run reaches a legal terminal state with durable evidence |

## 4. Scope And Non-Scope

### 4.1 In Scope

- One Direct/API provider and one registered CLI provider completing real turns.
- Desktop App and `make desktop-web` browser paths.
- Station-owned provider, credential, Agent config, conversation, message,
  turn, trace, and collaboration state.
- Typed stream events: progress, text, thinking, tool call, approval, tool
  result, knowledge, error, and done.
- Existing P0-P2 foundations repaired at their owning layer.
- Removal of Desktop-local provider execution and duplicated durable Agent
  state after consumer cutover.

### 4.2 Non-Scope

- New provider families.
- Mobile UI implementation.
- Voice/video calls.
- Usage/cost dashboards, export, and other P3 polish.
- A second chat runtime or compatibility architecture.
- Mock provider responses or mock APIs as acceptance evidence.
- Version-number changes.

## 5. Repository-Backed Current State

### 5.1 Station: Durable Agent Runtime

| Asset | Current responsibility | Plan treatment |
|---|---|---|
| `service/turn_service.go` | Persists user/assistant messages, assembles prompt, loads history, executes provider/tool loop, writes trace | Retain as canonical turn owner; verify failure and recovery paths |
| `service/provider_service.go` | Provider execution and streaming adapters | Retain; verify Direct provider and registered CLI adapter paths |
| `service/cli/{executor,workspace}.go` | Station-hosted CLI process and actor/session workspace | Retain; verify timeout, cleanup, actor isolation, and output sanitization |
| `service/prompt_assembly_service.go` | Identity, config, memory, skill, workspace, and knowledge prompt layers | Retain; verify ordering and trace |
| `service/knowledge_retrieval_service.go` | Chunking, embedding, ranking, resource policy | Retain; extend tests and E2E evidence |
| `service/tool_registry_service.go` | Station tool definitions and dispatch | Retain; verify local bridge and denial semantics |
| `service/local_tool_broker.go` | Waits for Desktop-local tool result | Retain; verify disconnect/timeout |
| `service/orchestration_service.go` | Collaboration task graph, leases, recovery, reduction, and lifecycle | Retain; verify one complete collaboration run |
| `infrastructure/persistence/{conversation,message,turn,turn_trace}.go` | Durable Agent chat truth | Retain; expose missing conversation operations through accepted proto/API contracts |
| `handler/turn_handler.go` | Blocking and SSE turn entrypoints plus local-tool result | Retain SSE path; blocking entrypoint may remain only for explicitly accepted internal callers |

### 5.2 Desktop Rust: Bridge And Existing Duplicates

| Asset | Current responsibility | Plan treatment |
|---|---|---|
| `application/agent_turn/mod.rs` | Station SSE bridge, cancellation, local tool handling; also contains Desktop-local CLI turn execution | Retain bridge; delete local CLI turn execution after Station CLI gate passes |
| `application/provider/mod.rs` | Station provider proxy; also runs CLI model discovery locally | Retain Station proxy; delete local CLI model execution after Station catalog/adapter discovery closes |
| `application/chat/mod.rs` | In-memory actor-bucket `ChatStore` for conversation/message CRUD | Replace with Station Agent conversation/message APIs; delete store after all consumers migrate |
| `application/agent_orchestration/mod.rs` | Collaboration API/stream bridge | Retain and verify |
| `application/desktop_executor_worker/mod.rs` | Executes leased Desktop-local collaboration nodes | Retain only for architecture-authorized local execution |
| `interface/http_gateway/mod.rs` | Browser command gateway; dispatches Agent stream command but frontend gateway mode still calls one-shot turn | Add accepted SSE proxy behavior under DG-6 |

### 5.3 Desktop Web: Projection And Interaction

| Asset | Current responsibility | Plan treatment |
|---|---|---|
| `store/chat.ts` | Message projection, stream reduction, topics, retry/regenerate, attachments, collaboration reconciliation | Retain temporarily; move long-lived lifecycle to runtime owner where required by runtime-projection contract |
| `runtimes/agentTopicRuntime.ts` and `store/agentTopics.ts` | Topic projection and reconciliation | Rebind to Station conversation truth |
| `services/desktop_api.ts` | Tauri/gateway adapter; Tauri streams, HTTP gateway uses `executeAgentTurnOnce` | Cut gateway mode to true streaming |
| `components/MessageBubble.tsx` | Retry/regenerate and tool/approval projection | Retain rendering; align actions with DG-4 |
| `components/chat/ChatComposer.tsx` and composer attachment modules | Local drafts, upload, preview, retry | Retain draft ownership; bind sent references to DG-5 contract |

## 6. Dependency DAG

```text
G0 Architecture convergence (DG-1 ... DG-6)
  |
  +--> WS-1 Canonical Station turn authority
  |      |
  |      +--> WS-2 Streaming and cancellation parity
  |      |
  |      +--> WS-3 Conversation, config, and multi-turn truth
  |                 |
  |                 +--> WS-4 Persona, topics, retry, regenerate
  |
  +--> WS-5 Tool and MCP live-loop closure
  |      depends on WS-1 + WS-2
  |
  +--> WS-6 Knowledge and attachment closure
  |      knowledge depends on WS-1 + WS-3
  |      attachments also depend on DG-5
  |
  +--> WS-7 Agent collaboration closure
         depends on WS-1 + WS-2 + WS-3

WS-8 Final evidence and deletion gate
  depends on WS-1 ... WS-7
```

Parallel execution after G0:

- WS-2 and WS-3 may proceed in parallel after WS-1.
- WS-5 and the knowledge half of WS-6 may proceed in parallel after their
  dependencies pass.
- Attachment work must wait for DG-5.
- WS-7 may build deterministic tests earlier, but runtime acceptance waits for
  WS-1 through WS-3.

## 7. Workstreams

### G0: Architecture Convergence

**Responsibility**: Remove contradictory ownership and define missing
contracts before implementation.

**Deliverables**:

- Resolve DG-1 through DG-6 in the governing architecture/decision documents.
- Produce an accepted retention/deletion list for Desktop CLI execution,
  Desktop `ChatStore`, blocking gateway mode, and local Agent config.
- Assign stable IDs to accepted retry and attachment decisions.
- Re-run repository inventory after architecture changes.

**Gate**:

- No active document permits Desktop/Mobile provider execution.
- Station conversation/config truth and local-preference exceptions are
  explicit.
- Browser streaming, retry lineage, and attachment contracts are accepted.
- Architecture reviewer returns `passed` or `conditionally passed` with all
  conditions resolved.

**Evidence**:

- `docs/architecture/agent/evidence/20260730-modern-chat-agent/g0-design-review.md`
- Tree search showing no active ownership contradiction.

### WS-1: Canonical Station Turn Authority

**Priority**: P0

**Responsibility**: Prove that both Direct and CLI providers execute through
the same Station-owned turn state machine.

**Deliverables**:

- Direct provider turn completes through Station using actor-scoped provider,
  model, and credential records.
- Registered CLI provider turn executes on the Station host through
  `service/cli`, not Desktop Rust.
- Invalid/disabled provider, model, or credential fails before execution with
  a typed error.
- Desktop-local CLI turn and model-discovery branches are deleted after all
  callers use Station.

**Failure behavior**:

- Missing/expired credentials produce typed user-visible errors without
  leaking secrets.
- CLI timeout/cancel terminates the process group and cleans its workspace.
- Actor B cannot execute with Actor A's provider record.

**Deterministic checks**:

```bash
cd apps/station && go test ./app/subserver/agent/...
rg -n "execute_cli_turn_blocking|stream_cli_turn|execute_cli_models_command" \
  apps/desktop/src-tauri/src
```

The final `rg` must return no live AI provider execution paths.

**Runtime gate**:

1. ARK or another Direct provider completes a real turn.
2. A registered CLI provider completes a real turn.
3. Station persists user message, assistant message, turn, and trace.
4. Process/runtime evidence identifies Station as executor for both paths.

**Evidence**:

- `evidence/ws1-direct-turn.json`
- `evidence/ws1-cli-turn.json`
- `evidence/ws1-station-executor.md`
- `evidence/ws1-negative-security.md`

### WS-2: Streaming And Cancellation Parity

**Priority**: P0

**Responsibility**: Make both Desktop App and browser gateway consume the same
Station SSE semantics without simulated or one-shot streaming.

**Deliverables**:

- Preserve the existing Station SSE -> Desktop Rust -> Tauri event path.
- Replace HTTP gateway mode's `executeAgentTurnOnce` branch with the accepted
  DG-6 SSE proxy.
- Use one typed event vocabulary across App and browser paths.
- Propagate abort/disconnect to Station and provider/CLI execution.
- Preserve a blocking turn API only for explicitly inventoried non-interactive
  internal callers; it must not back the chat UI.

**Failure behavior**:

- Mid-stream provider errors terminate with one typed error and no false done.
- Browser disconnect cancels upstream work.
- Duplicate/stale events do not mutate another stream.

**Deterministic checks**:

```bash
cd apps/desktop && pnpm run check && pnpm run test
cd apps/desktop/src-tauri && source ~/.cargo/env && cargo test agent_turn -- --test-threads=1
rg -n "executeAgentTurnOnce" apps/desktop/src
```

The final search may only find accepted non-chat callers.

**Runtime gate**:

- `make desktop` and `make desktop-web` each render multiple progressive text
  frames from a real provider.
- Stop and disconnect cancel the Station turn.
- No UI path synthesizes token events after receiving a completed response.

**Evidence**:

- `evidence/ws2-desktop-app-stream.jsonl`
- `evidence/ws2-browser-stream.jsonl`
- `evidence/ws2-cancellation.md`

### WS-3: Conversation, Config, And Multi-Turn Truth

**Priority**: P0

**Responsibility**: Make Station the durable truth for Agent conversations,
messages, turn history, and shared Agent config.

**Deliverables**:

- Add or complete proto-first Station Agent conversation APIs accepted by
  DG-3: create, list, get messages, rename, delete, duplicate/branch, and model
  selection where required.
- Rewire Desktop chat/topic consumers to those APIs.
- Remove Desktop Rust in-memory `ChatStore` after consumer migration.
- Persist durable Agent identity/system prompt/bindings on Station; keep only
  explicitly accepted selection/layout preferences locally.
- Verify TurnService history loading, role order, compression split, and
  cross-topic isolation.

**Failure behavior**:

- Station unavailable produces an explicit unavailable state; Desktop does not
  silently create authoritative local history.
- Actor/account switch cannot expose another actor's conversations.
- Delete/rename conflicts return typed errors and reconcile from Station.

**Deterministic checks**:

```bash
./model/build.sh
cd apps/station && go test ./app/subserver/agent/...
cd apps/desktop && pnpm run check && pnpm run test
rg -n "struct ChatStore|CHAT_STORES|with_chat_app_result" \
  apps/desktop/src-tauri/src/application/chat
```

The final search must return no durable Agent conversation owner in Desktop.

**Runtime gate**:

1. A five-turn conversation retains earlier facts.
2. A second topic starts with isolated history.
3. Restarting Desktop reloads both topics from Station.
4. A second authenticated client observes the same durable Agent config and
   conversations.

**Evidence**:

- `evidence/ws3-multi-turn.md`
- `evidence/ws3-restart-readback.md`
- `evidence/ws3-actor-isolation.md`

### WS-4: Persona, Topics, Retry, And Regenerate

**Priority**: P1

**Responsibility**: Close expected chat actions on top of WS-3's Station-owned
conversation contract.

**Deliverables**:

- System prompt/persona is assembled by Station from durable Agent config.
- Create, switch, rename, delete, and branch operate on Station conversations.
- Retry and regenerate implement the accepted DG-4 lineage rule.
- UI projections reconcile after every mutation; components do not own durable
  state.

**Failure behavior**:

- Retry is rejected while another turn owns the conversation generation slot.
- Failed regenerate preserves the prior valid response according to DG-4.
- Persona/config mutation is version-gated and actor-scoped.

**Gate**:

- Persona behavior changes on the next turn and survives restart.
- Topic CRUD and branch survive restart and second-client readback.
- Retry/regenerate history matches the accepted lineage contract in Station
  and Desktop.

**Evidence**:

- `evidence/ws4-persona.md`
- `evidence/ws4-topic-lifecycle.md`
- `evidence/ws4-retry-lineage.json`

### WS-5: Tool And MCP Live-Loop Closure

**Priority**: P2

**Responsibility**: Verify one complete Station-owned model -> local tool ->
model loop with Desktop-local execution and durable audit.

**Current assets**:

- Station `ToolRegistryService`, `LocalToolBroker`, and TurnService tool loop.
- Desktop Rust MCP/tools executors and approval gate.
- Desktop Web tool cards and approval actions.

**Deliverables**:

- Tool request includes typed call ID, owner, schema, arguments, and risk.
- Approval-required calls pause before local execution.
- Approve executes once; deny/timeout returns a structured tool error.
- Tool result returns to the same Station turn and the model continues.
- Trace and UI show request, decision, executor, result, and timing.

**Deterministic checks**:

```bash
cd apps/station && go test ./app/subserver/agent/service/...
cd apps/desktop/src-tauri && source ~/.cargo/env && \
  cargo test --bin peers-touch-desktop tools::tests -- --test-threads=1
```

**Runtime gate**:

- File-read or equivalent local tool completes after approval.
- Denial and timeout do not execute the tool.
- Two sequential tool calls complete in one turn.
- Cancellation while awaiting approval releases Station and Desktop waiters.

**Evidence**:

- `evidence/ws5-tool-approved.jsonl`
- `evidence/ws5-tool-denied.jsonl`
- `evidence/ws5-tool-cancelled.md`

### WS-6: Knowledge And Attachment Closure

**Priority**: P2

**Responsibility**: Prove Station-traceable knowledge injection and, after
DG-5, durable multimodal attachment handling.

**Knowledge deliverables**:

- Retain the existing resource policy, retrieval, prompt injection, stream
  diagnostic, and TurnTrace path.
- Verify enabled/disabled policy, ranking, context budget, and actor access.
- Render the exact resource/chunk references used by the turn.

**Attachment deliverables after DG-5**:

- Promote accepted attachment references into canonical proto/domain contracts.
- Resolve uploaded objects without sending arbitrary local paths or raw secret
  material to Station.
- Enforce model capability metadata for vision/file support.
- Persist attachment provenance with the message/turn trace.

**Failure behavior**:

- Missing or unauthorized resources fail closed.
- Oversized/unsupported files produce typed errors.
- Non-vision models reject image input before provider execution.
- Knowledge retrieval failure is visible and does not silently fabricate
  context.

**Deterministic checks**:

```bash
cd apps/station && go test ./app/subserver/agent/service/... \
  -run 'Knowledge|Prompt|Turn'
cd apps/desktop && pnpm run check && pnpm run test
```

**Runtime gate**:

- A bound knowledge resource changes the answer and its chunks appear in trace.
- A disabled resource is not injected.
- An image-capable model consumes a durable image reference.
- Unsupported and unauthorized attachment cases fail predictably.

**Evidence**:

- `evidence/ws6-knowledge-trace.json`
- `evidence/ws6-disabled-resource.md`
- `evidence/ws6-attachment-vision.md`
- `evidence/ws6-attachment-negative.md`

### WS-7: Agent Collaboration Closure

**Priority**: P2

**Responsibility**: Verify the existing Station orchestration system through a
complete multi-Agent lifecycle rather than deferring P2.4.

**Deliverables**:

- Create a collaboration task from a goal and selected Agents.
- Persist plan, nodes, dependencies, leases, events, artifacts, and gates.
- Execute parallel/sequential nodes through authorized Station or Desktop-local
  executors.
- Handle cancel, failure, human interruption, resume, and final reduction.
- Permit `completed` only after final acceptance coverage passes.

**Deterministic checks**:

```bash
cd apps/station && go test ./app/subserver/agent/service/... \
  -run 'Collaboration|Orchestration|GoalKeeper|Gate'
cd apps/desktop/src-tauri && source ~/.cargo/env && \
  cargo test agent_orchestration -- --test-threads=1
```

**Runtime gate**:

- Two Agents complete one real collaboration goal.
- Per-Agent contribution and final synthesis are visible.
- One interruption/resume scenario reuses accepted work.
- Final status, events, artifacts, and acceptance coverage survive restart.

**Evidence**:

- `evidence/ws7-collaboration-events.jsonl`
- `evidence/ws7-final-coverage.json`
- `evidence/ws7-restart-recovery.md`

### WS-8: Final Evidence And Single-Source Gate

**Responsibility**: Prove the complete P0-P2 claim and remove superseded paths.

**Required commands**:

```bash
cd apps/desktop && pnpm run check && pnpm run test && pnpm run build
cd apps/desktop/src-tauri && source ~/.cargo/env && cargo test
cd apps/station && gofmt -l . && go test ./...
./tooling/scripts/check-go-style.sh
```

**Tree-wide negative checks**:

```bash
rg -n "execute_cli_turn_blocking|stream_cli_turn|execute_cli_models_command" \
  apps/desktop/src-tauri/src
rg -n "struct ChatStore|CHAT_STORES|with_chat_app_result" \
  apps/desktop/src-tauri/src/application/chat
rg -n "executeAgentTurnOnce" apps/desktop/src
```

Every match must be deleted or explicitly justified by an accepted architecture
contract.

**Surface Gate**:

- Run `make desktop` and `make desktop-web`.
- Execute the complete P0-P2 matrix from the receiver's perspective.
- Capture actual browser/App interaction, Station evidence, and persistence
  readback.
- Missing evidence fails closed; screenshots alone are insufficient.

## 8. End-To-End Lifecycle Coverage

| Lifecycle | Owner mapping | Closing workstream |
|---|---|---|
| Startup and provider/config load | Station truth -> Desktop runtime projection | WS-1, WS-3 |
| Authentication/account switch | Actor-scoped Station reads and cache reset | WS-1, WS-3 |
| Create/select conversation | Station conversation API | WS-3, WS-4 |
| Submit Direct/CLI turn | Station TurnService and provider adapter | WS-1 |
| Stream progress/text/thinking | Station SSE -> Rust bridge/gateway -> Web runtime | WS-2 |
| Assemble persona/history/knowledge | Station prompt and conversation services | WS-3, WS-4, WS-6 |
| Request and approve local tool | Station decision -> Desktop approval/execution -> Station result | WS-5 |
| Cancel/disconnect/timeout | Client signal -> Station turn/process cleanup | WS-1, WS-2, WS-5 |
| Retry/regenerate/branch | Accepted Station message lineage | WS-4 |
| Attachment input | Local draft/upload -> canonical durable reference -> provider | WS-6 |
| Collaboration create/run/recover | Station orchestration with authorized executors | WS-7 |
| Restart and reconciliation | Station durable state -> runtime projections | WS-3, WS-7 |
| Shutdown cleanup | Station CLI/tool waiters and Desktop local executors released | WS-1, WS-2, WS-5 |

## 9. Atomic Cutover And Deletion Matrix

| Concern | New/retained source of truth | Complete consumers | Cutover condition | Deletion obligation |
|---|---|---|---|---|
| CLI turn execution | Station `service/cli` through TurnService | Agent chat, collaboration, model discovery | Direct and CLI WS-1 gates pass | Delete Desktop `execute_cli_turn_blocking`, `stream_cli_turn`, and local CLI model command execution |
| Browser turn streaming | Station SSE through accepted gateway proxy | `streamAgentTurn`, chat store/runtime | WS-2 App/browser parity and cancellation pass | Remove chat UI fallback to `executeAgentTurnOnce` |
| Agent conversations/messages | Station `agent_conversations`, `agent_messages`, `agent_turns` | Chat store, topic runtime/store, message actions | WS-3 CRUD, restart, and actor isolation pass | Delete Desktop in-memory `ChatStore` and actor buckets |
| Durable Agent config/persona | Station Agent config service | Agent settings/runtime and turn request | WS-3/WS-4 versioned readback passes | Remove duplicate durable local config fields; retain accepted UI preferences only |
| Retry/regenerate lineage | Station contract accepted under DG-4 | Message actions and turn history | WS-4 positive/negative gates pass | Delete incompatible destructive/local-only mutation path |
| Attachment truth | Accepted DG-5 proto/domain and storage owner | Composer, turn request, Station provider/trace | WS-6 restart and capability gates pass | Delete metadata-only paths that cannot reconcile durable references |

Rollback uses version control/deployment rollback. No permanent dual-write or
fallback ownership path is permitted unless architecture explicitly accepts it.

## 10. Execution Order And Estimate

| Order | Closure | Dependency | Estimated effort after G0 |
|---|---|---|---|
| 0 | G0 Architecture convergence | None | Design-owned; not estimated here |
| 1 | WS-1 Canonical Station turn authority | G0 | 1-2 days |
| 2a | WS-2 Streaming/cancellation parity | WS-1 | 1-2 days |
| 2b | WS-3 Conversation/config truth | WS-1 | 2-3 days |
| 3 | WS-4 Persona/topics/retry | WS-3 | 1-2 days |
| 4a | WS-5 Tool/MCP loop | WS-1, WS-2 | 1-2 days |
| 4b | WS-6 Knowledge/attachments | WS-1, WS-3, DG-5 | 1-3 days |
| 5 | WS-7 Collaboration | WS-1, WS-2, WS-3 | 1-2 days |
| 6 | WS-8 Final evidence/deletion | WS-1 through WS-7 | 1 day |

The original 1-2 week target is plausible only after G0 closes and if DG-3,
DG-5, and DG-6 do not require architecture beyond the existing foundations.
The plan must be re-estimated at the G0 gate.

## 11. Final Readiness Gate

`PLAN_READY_FOR_EXECUTION` requires G0 approval.

`P0_P2_READY` requires all of the following:

1. Direct and CLI providers execute on Station and complete real turns.
2. Desktop App and browser both display true progressive streaming.
3. Cancel/disconnect stops Station/provider/CLI work.
4. Five-turn context and topic isolation survive restart.
5. Shared Agent config/persona is Station-owned and versioned.
6. Conversation CRUD, retry, regenerate, and branch follow accepted durable
   semantics.
7. Tool approval, denial, execution, result, and continued generation close
   one live turn.
8. Knowledge injection is traceable and actor-scoped.
9. Attachments use durable references and enforce provider capabilities.
10. Agent collaboration completes, recovers, and passes final coverage.
11. All deterministic checks pass.
12. All deletion searches pass with no unapproved duplicate owner.
13. Evidence exists under
    `docs/architecture/agent/evidence/20260730-modern-chat-agent/`.

## 12. Risks And Escalation Conditions

| Risk | Required response |
|---|---|
| Station and Desktop both remain capable of provider execution | Stop; ownership cutover is incomplete |
| Conversation CRUD requires a new shared contract | Return to DESIGN, then proto-first implementation |
| Browser gateway cannot propagate SSE cancellation | Return to DESIGN for DG-6; do not simulate streaming |
| Retry semantics differ between UI and Station persistence | Return to DESIGN for DG-4 |
| Attachment payload needs raw local paths/base64 in shared state | Reject design; use an opaque authorized reference |
| CLI process cannot be bounded and reclaimed | Fail WS-1; do not expose CLI provider |
| Tool approval can be bypassed by another execution path | Fail WS-5 and security review |
| Collaboration reports completion without coverage evidence | Persist partial/failed state; never report completed |
| Runtime or acceptance infrastructure is flaky | Record infra failure separately; do not convert it into a product pass |

## 13. Status

| Closure | Status | Blocker |
|---|---|---|
| G0 Architecture convergence | blocked | DG-1 through DG-6 |
| WS-1 Canonical Station turn authority | pending | G0 |
| WS-2 Streaming/cancellation parity | pending | WS-1 |
| WS-3 Conversation/config truth | pending | WS-1 |
| WS-4 Persona/topics/retry | pending | WS-3 |
| WS-5 Tool/MCP loop | pending | WS-1, WS-2 |
| WS-6 Knowledge/attachments | pending | WS-1, WS-3, DG-5 |
| WS-7 Agent collaboration | pending | WS-1, WS-2, WS-3 |
| WS-8 Final evidence/deletion | pending | WS-1 through WS-7 |

## 14. Handoff To Execution Guardian

After G0 review passes, hand off:

- This plan path.
- Accepted architecture paths and decision IDs resolving DG-1 through DG-6.
- The workstream dependency order in §6 and §10.
- Per-workstream commands and evidence paths.
- The deletion obligations in §9.
- The final readiness gate in §11.

Execution must begin with WS-1 and must not mark a workstream complete from
code inspection alone.
