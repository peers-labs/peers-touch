# Agent LobeHub Fullstack Parity — M4 Session/Topic/Message Runtime Closure Spec

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Station + Desktop Rust + Desktop Web
> **Module**: `apps/station/app/subserver/agent/`, `apps/desktop/src-tauri/src/application/agent_turn/`, `apps/desktop/src/store/{chat,agentTopics}.ts`, `apps/desktop/src/services/`
> **Plan Step**: PLAN-P4 / M4 pre-execution
> **Evidence**: EVID-011-D-pre

---

## 1. Purpose

This document turns M4 in `migration-plan.md` into a Session/Topic/Message runtime implementation-ready specification.

M4 closes the runtime loop that LobeHub-level Agent chat requires: durable Station truth, typed stream projection, retry/regenerate/continue/branch semantics, cancel/reconnect reconciliation, and topic/message projection consistency.

This is a pre-execution spec. It does not modify product code and does not claim GATE-008 complete.

## 2. Source Inputs

| Source | Role |
| --- | --- |
| `contract-foundation.md` | Defines target `AgentRuntimeEvent`, `AgentModelRef`, resource/tool event contracts |
| `desktop-runtime-shell.md` | Requires runtime/store-owned projection and page renderer discipline |
| `provider-model-correctness.md` | Defines selected provider/model ref input to turns |
| `session-topic-action-map.md` | Maps LobeHub session/topic/thread/message/generation actions to Peers ownership and action-lineage requirements |
| `chat-runtime-source-map.md` | Maps LobeHub streaming chunks, client/gateway runtime, parked states and recovery semantics to the Peers runtime contract |
| `apps/station/app/subserver/agent/handler/turn_handler.go` | Current execute/stream/trace/local tool result handlers |
| `apps/station/app/subserver/agent/service/turn_service.go` | Current turn lifecycle, event sink, message persistence and trace |
| `apps/station/app/subserver/agent/service/chat_task_service.go` | Chat root task, execution step and recovery contract |
| `apps/station/app/subserver/agent/service/task_event_writer.go` | Durable outbox and event_seq writer |
| `apps/station/app/subserver/agent/domain/event.go` | Current domain event taxonomy |
| `apps/station/app/subserver/agent/infrastructure/persistence/{conversation,message,turn}.go` | Durable conversation/message/turn tables |
| `apps/desktop/src-tauri/src/interface/tauri_commands/agent_turn.rs` | Desktop command entrypoints for turn stream/cancel/trace/tool approval |
| `apps/desktop/src-tauri/src/application/agent_turn/mod.rs` | Desktop Rust Station stream bridge and CLI provider path |
| `apps/desktop/src/services/desktop_api.ts` | TS turn input, stream event and collaboration replay APIs |
| `apps/desktop/src/services/agent-service.ts` | Agent turn stream facade |
| `apps/desktop/src/services/chat-service.ts` | Session/message/topic action facade |
| `apps/desktop/src/store/chat.ts` | Current chat runtime projection and send/retry/branch/stop logic |
| `apps/desktop/src/store/agentTopics.ts` | Current Agent topic projection and title lifecycle |

## 3. Current State Inventory

| Area | Current Behavior | Risk |
| --- | --- | --- |
| Station turn stream | `HandleExecuteTurnStream` writes SSE with event name from string `TurnEvent.Type`; final `done` carries `turn` and `task_id`. | Event taxonomy is string/ad-hoc and not generated from `AgentRuntimeEvent`. |
| Station turn lifecycle | `TurnService.ExecuteTurn` persists user/assistant messages, emits progress/text/error events, writes trace. | Some actions are inferred by Desktop stream state rather than a typed lifecycle contract. |
| Station chat task/outbox | `ChatTaskService` maps a conversation to a root task and writes replayable task events with `event_seq`. | Good foundation, but Desktop only partially consumes it after local turn stream completion. |
| Desktop Rust stream bridge | `agent_turn/mod.rs` keeps JSON temporary adapter, maps SSE/Tauri events, supports local CLI provider and local tool approval. | Bridge emits ad-hoc event payloads and cancellation is local stream flag first. |
| Desktop Web stream | `streamAgentTurn` normalizes Tauri payload into `StreamEvent { event, data }`, flattening typed data to strings. | Tool/knowledge/error/done semantics are lossy and untyped. |
| Desktop chat store | `chat.ts` supports send, stop, regenerate, retry, delete-and-regenerate, branch, tool approval, syncMessages, outbox replay fallback. | Complex action logic lives in one store; retry/regenerate/branch are not mapped to Station-owned action objects. |
| Desktop topic store | `agentTopics.ts` lists sessions by Agent, creates draft topics, rename/delete/duplicate/smart rename. | Topic projection is session-list based; no typed event cursor or reconciliation state machine. |
| Persistence | Station has `agent_conversations`, `agent_messages`, `agent_turns`, task runs, execution steps and task events. | Conversation/message DTOs and Desktop session model still carry only partial provider/model/operation metadata. |

## 4. Target Runtime Contract

M4 must make the runtime lifecycle explicit:

```text
User action
  -> Desktop Web dispatches typed chat action
  -> Desktop Rust bridges Station or local CLI execution
  -> Station owns durable turn/session/message/task truth
  -> Runtime stream emits typed transient deltas
  -> Durable outbox emits replayable task/session events
  -> Desktop Web reconciles by cursor and re-renders projection
```

Rules:

- Streaming deltas are transient UI acceleration.
- Durable Station messages/tasks/outbox are the source of truth.
- Cancel does not replay an interrupted LLM turn.
- Retry/regenerate/branch create new Station-owned attempts or conversations; Desktop must not silently rewrite history as truth.
- Topic title state is a projection of conversation state plus explicit title operation state.
- LobeHub action semantics in `session-topic-action-map.md` are source reference only; Peers implementation must persist Station-owned lineage for retry/regenerate/continue/branch/delete instead of copying LobeHub store code.
- LobeHub runtime semantics in `chat-runtime-source-map.md` are source reference only; Peers implementation must type stream events, parked states, gateway/client boundaries and tool resume events instead of copying LobeHub store code.

## 5. Action Semantics

| User Action | Current Approximation | Target M4 Semantics |
| --- | --- | --- |
| Send | Append local temp user/assistant, stream turn, sync messages after done. | Create/ensure Station conversation/task step, stream typed deltas, reconcile persisted messages/outbox by cursor. |
| Stop | Abort controller + local stream cancel + local UI finalization. | Cancel local stream, mark UI as `aborted`, reconcile Station step state; never claim provider stopped unless Station confirms. |
| Retry | Find prior prompt, append replacement assistant, stream fresh turn. | Create new attempt linked to source message/turn; Station records attempt lineage. |
| Regenerate | Similar to retry with replacement marker. | New turn linked as regeneration of prior assistant response; prior response remains auditable. |
| Continue | Not fully proven in current inspected store. | Continue from last assistant context as explicit action; must bind to source turn/message. |
| Delete and regenerate | Delete response messages locally/server-side then regenerate. | Must be Station-owned delete/prune action or explicit replacement lineage; no silent irreversible local rewrite. |
| Branch | Duplicate session, prune messages after selected point. | Station creates child conversation with parent/cut message metadata; Desktop renders branch marker. |
| Rename/smart rename | `agentTopics.ts` rename/smartRename. | Station-owned title mutation with projection event and rollback/retry states. |
| Delete topic/session | `deleteSession` / `deleteTopic`. | Station-owned deletion/archive action with projection reconciliation; visible list updates from Station truth. |

## 6. Implementation Slices

### M4.1 Typed Runtime Event Adapter

Target paths:

- `model/domain/agent/` after M1
- `apps/station/app/subserver/agent/service/turn_service.go`
- `apps/station/app/subserver/agent/handler/turn_handler.go`
- `apps/desktop/src-tauri/src/application/agent_turn/mod.rs`
- `apps/desktop/src/services/desktop_api.ts`
- `apps/desktop/src/store/chat.ts`

Required changes:

1. Map current Station `TurnEvent{Type,Stage,...}` to M1 `AgentRuntimeEvent`.
2. Keep legacy SSE event names during staged migration, but attach canonical event type in payload.
3. Desktop Rust preserves canonical event type and original payload.
4. Desktop Web consumes canonical event type first and falls back to legacy `event` only for compatibility.
5. Event payload must preserve:
   - `turn_id`
   - `conversation_id`
   - `agent_id`
   - `message_id` when available
   - `tool_call_id` when available
   - `task_id` / `step_id` / `event_seq` when available

Acceptance:

- One table/test maps all current stream cases: text, thinking, progress, knowledge retrieved, tool request, approval, tool result, error, done, aborted/reconcile.
- No new Desktop-only event names are introduced outside the canonical mapping.

### M4.2 Durable Reconcile Cursor

Target paths:

- `apps/station/app/subserver/agent/service/task_event_writer.go`
- `apps/station/app/subserver/agent/service/chat_task_service.go`
- Collaboration stream handlers/bridge paths
- `apps/desktop/src/services/desktop_api.ts`
- `apps/desktop/src/store/chat.ts`
- `apps/desktop/src/store/agentTopics.ts`

Required changes:

1. Treat `task_id + event_seq` as the durable replay cursor for chat task state.
2. Persist last consumed cursor per chat root task in Desktop projection state or an explicit runtime-owned cache.
3. On stream `done`, `error`, local abort, reconnect and hidden-window resume, run replay from last cursor.
4. If collaboration stream is unavailable, fallback to `syncMessages()` and topic reconcile must be marked degraded.
5. Cursor update must be monotonic; event_seq 0 means replay from snapshot/start.

Acceptance:

- Missed outbox events after stream completion are replayed once.
- Reconnect does not duplicate tool/knowledge/status cards.
- `chatTaskEventSeq` ad-hoc map is either formalized in a runtime-owned module or replaced.

### M4.3 Station-Owned Action Lineage

Target paths:

- Station action/proto paths after M1
- `apps/station/app/subserver/agent/handler/turn_handler.go`
- `apps/station/app/subserver/agent/service/chat_task_service.go`
- `apps/station/app/subserver/agent/infrastructure/persistence/`
- Desktop `chat.ts`

Required changes:

1. Define a small action lineage model:
   - `SEND`
   - `STOP`
   - `RETRY`
   - `REGENERATE`
   - `CONTINUE`
   - `BRANCH`
   - `DELETE_MESSAGE`
   - `RENAME_TOPIC`
   - `DELETE_TOPIC`
2. Persist source references:
   - `source_conversation_id`
   - `source_message_id`
   - `source_turn_id`
   - `replacement_of_message_id`
   - `branch_parent_conversation_id`
   - `branch_cut_message_id`
3. Desktop may show optimistic markers, but final state comes from Station response/reconcile.
4. Existing destructive local/server delete flows must be reviewed before they are used for regenerate/branch.

Acceptance:

- Retry/regenerate/branch can be audited after reload.
- Deleted/replaced messages do not disappear without lineage or explicit archive/delete action evidence.

### M4.4 Desktop Chat Store Split

Target paths:

- `apps/desktop/src/store/chat.ts`
- New local modules under `apps/desktop/src/store/chat/` or `apps/desktop/src/services/agent-runtime/`

Required changes:

1. Extract pure event reducer from `applyStreamEvent`.
2. Extract action builders for send/retry/regenerate/branch.
3. Extract reconciliation controller for stream completion/outbox replay.
4. Keep Zustand store as projection owner, but reduce one-file runtime complexity.
5. Preserve public store actions during staged migration.

Acceptance:

- Unit tests can exercise stream reducer without Tauri.
- Current UI actions still call the same store API or a compatibility wrapper.

### M4.5 Topic Projection Runtime Closure

Target paths:

- `apps/desktop/src/store/agentTopics.ts`
- `apps/desktop/src/runtimes/agentTopicRuntime.ts`
- `apps/desktop/src/services/chat-service.ts`

Required changes:

1. Topic list refresh remains runtime/store-owned, not component-owned.
2. Topic actions have explicit states:
   - idle
   - loading
   - renaming
   - generating-title
   - deleting
   - failed
3. Smart rename errors remain visible and retryable.
4. Topic list reconciles after turn done/error/abort and after collaboration event replay.
5. Draft topics must be replaced or reconciled with Station conversation IDs once persisted.

Acceptance:

- Topic switch, rename, smart rename, duplicate and delete survive reload/reconcile.
- Draft topic does not permanently diverge from Station conversation truth.

### M4.6 Desktop Rust Bridge Closure

Target paths:

- `apps/desktop/src-tauri/src/interface/tauri_commands/agent_turn.rs`
- `apps/desktop/src-tauri/src/application/agent_turn/mod.rs`
- `apps/desktop/src-tauri/src/interface/contracts/mod.rs`

Required changes:

1. Replace temporary JSON adapter only after M1 proto can carry the full turn payload.
2. Stream cancellation must emit local aborted event and trigger Station reconcile; if Station cannot cancel provider call, UI says local stream stopped.
3. Local CLI provider stream should emit the same canonical runtime events as Station stream where possible.
4. Local tool approval/result events must include turn/tool identifiers and audit trace.

Acceptance:

- Targeted Rust tests cover stream cancel registry, CLI stream event mapping and tool approval timeout/decision paths when touched.
- Desktop Rust does not become business source-of-truth for Station-owned sessions/topics/messages.

### M4.7 HTTP Gateway Compatibility

Target paths:

- `apps/desktop/src/services/desktop_api.ts`
- `apps/desktop/src/store/chat.ts`

Required changes:

1. HTTP gateway non-stream fallback continues to work.
2. One-shot `executeAgentTurnOnce` synthesizes canonical `TEXT_DELTA` and `DONE` events for Web store.
3. Missing stream/offline gateway modes are marked degraded and reconciled via messages.

Acceptance:

- Desktop web/dev gateway can still send a turn without Tauri stream.
- Event reducer receives the same normalized event shape in gateway and Tauri modes.

## 7. Required Test Matrix

| Test Class | Required Case |
| --- | --- |
| Event reducer | Canonical text/thinking/tool/error/done/aborted/reconcile events update message projection deterministically. |
| Send lifecycle | User/assistant optimistic messages reconcile to persisted Station messages after done. |
| Stop lifecycle | Local abort stops stream UI, emits aborted projection and reconciles Station step state. |
| Retry/regenerate lineage | Replacement response is linked to source user/assistant message and survives reload. |
| Branch lineage | Branch child conversation records parent/cut message and pruned messages are auditable. |
| Topic reconcile | Turn done/error/abort updates topic list and smart title state. |
| Cursor replay | Dropped realtime event is replayed from `task_id/event_seq` without duplication. |
| Gateway fallback | Non-Tauri path synthesizes canonical events and completes sync. |

## 8. Forbidden Relationships

M4 implementation must not:

1. Treat Tauri stream events as durable truth.
2. Add page/component mount fetch as primary chat/topic freshness.
3. Delete or rewrite existing messages without Station action lineage.
4. Claim provider cancel if only local stream listener was aborted.
5. Introduce Desktop-only runtime event names outside M1 canonical mapping.
6. Make Desktop Rust the owner of Station sessions/topics/messages.
7. Collapse retry/regenerate/branch into indistinguishable send operations.
8. Combine deep Memory/Knowledge/Tool UI parity with M4 unless the Evidence row explicitly expands scope.

## 9. Verification Commands

Run the subset matching touched paths:

```bash
pnpm --dir apps/desktop run check
```

If Desktop Rust turn bridge is touched:

```bash
cargo test
```

from `apps/desktop/src-tauri`, or a narrower targeted command recorded in Evidence.

If Station turn/chat task/outbox is touched:

```bash
go test ./app/subserver/agent/...
```

from the Station app root used by the repository.

## 10. Evidence Target

After EVID-010, EVID-012, EVID-013 and EVID-014, the implementation batch should append:

| Evidence ID | BOM ID | Spec ID | Plan Step | Gate ID | Artifact | Result | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EVID-015 | BOM-002/BOM-007/BOM-008/BOM-009/BOM-015 | SPEC-002/SPEC-008/SPEC-009/SPEC-011/SPEC-013 | PLAN-P5 / M4 | GATE-006/GATE-008 | Station turn/chat task/outbox changes, Desktop Rust stream bridge, Desktop Web chat/topic runtime, command/browser evidence | Session/topic/message runtime closure implemented with typed events and durable reconcile | Deep Memory/Knowledge/Tool trace parity remains later batches |

## 11. Current M4 Readiness

| Requirement | Status | Evidence |
| --- | --- | --- |
| Station turn and SSE stream inventory known | implemented | `turn_handler.go`, `turn_service.go` inspected |
| Station chat task/outbox foundation known | implemented | `chat_task_service.go`, `task_event_writer.go` inspected |
| Desktop Rust stream/cancel bridge inventory known | implemented | `agent_turn.rs`, `agent_turn/mod.rs` inspected |
| Desktop Web chat/topic action risks identified | implemented | `chat.ts`, `agentTopics.ts`, `desktop_api.ts`, `agent-service.ts`, `chat-service.ts` inspected |
| Product implementation allowed | blocked | Pending revised prototype acceptance after EVID-010 `REVISION REQUIRED` and EVID-012/EVID-013/EVID-014 implementation sequence |
