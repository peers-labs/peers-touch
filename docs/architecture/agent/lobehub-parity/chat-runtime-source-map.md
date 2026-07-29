# Agent LobeHub Parity - Chat Runtime / Streaming / Recovery Source Map

> **Status**: implemented-for-design
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Station + Desktop Rust + Desktop Web
> **BOM**: BOM-007, BOM-009, BOM-015
> **Spec**: SPEC-002, SPEC-009, SPEC-011, SPEC-013
> **Plan Step**: PLAN-P0 / PLAN-P4
> **Gates**: GATE-001, GATE-002, GATE-006, GATE-008
> **Evidence**: EVID-011-U-pre

---

## 1. Purpose

This document closes the BOM-007 design gap by mapping LobeHub chat runtime, streaming and recovery semantics to the Peers-Touch Station/Desktop runtime contract.

It complements `session-topic-action-map.md`:

- `session-topic-action-map.md` maps user-visible action families and lineage.
- This file maps runtime execution, stream chunks, transport boundaries, parked/terminal states, tool approval resume and recovery semantics.

It is source audit and migration design evidence only. It does not implement GATE-008.

## 2. LobeHub Source Map

| Domain | LobeHub source | Responsibility observed |
| --- | --- | --- |
| Streaming chunk handler | `external/lobehub/src/store/chat/agents/StreamingHandler.ts` | Accumulates text, reasoning, multimodal content, tool calls, grounding, generated images, trace ID and finish type. |
| Agent executors | `external/lobehub/src/store/chat/agents/createAgentExecutors.ts` | Bridges agent-runtime instructions to message creation, LLM calls, tool calls, task/sub-agent execution, compression and error updates. |
| Agent run slice composition | `external/lobehub/src/store/chat/slices/agentRun/actions/index.ts` | Composes conversation lifecycle, control, memory, client tool execution, gateway, streaming executor and streaming state actions. |
| Client streaming executor | `external/lobehub/src/store/chat/slices/agentRun/actions/transports/client/streamingExecutor.ts` | Builds runtime state/context, resolves tools, executes client agent runtime, handles parked states and local completion. |
| Gateway transport | `external/lobehub/src/store/chat/slices/agentRun/actions/transports/gateway/gateway.ts` | WebSocket agent events, auth refresh, session completion fallback, interrupt, resume approval and resume tool result. |
| Conversation lifecycle | `external/lobehub/src/store/chat/slices/agentRun/actions/entries/conversationLifecycle.ts` | Send-message lifecycle, runtime selection, context/materialization, topic/thread creation, heterogeneous execution and persistence fallback. |
| Conversation control | `external/lobehub/src/store/chat/slices/agentRun/actions/entries/conversationControl.ts` | Stop/cancel, approval/rejection, tool interaction resume, branch metadata and paused-op cleanup. |
| Run lifecycle | `external/lobehub/src/store/chat/slices/agentRun/actions/lifecycle/buildRunLifecycle.ts` | Normalizes terminal disposition, keeps parked states non-terminal, centralizes title/notification/queue/completion side effects. |
| Runtime state | `external/lobehub/src/store/chat/slices/agentRun/actions/state/streamingStates.ts`, `external/lobehub/src/store/chat/slices/message/actions/runtimeState.ts` | Tracks tool streaming arrays, loading arrays and AbortController-bound beforeunload protection. |
| Pending intervention derivation | `external/lobehub/src/features/Conversation/store/slices/data/pendingInterventions.ts` | Derives pending human/tool approvals from persisted/display messages and tool result IDs. |
| Context engine | `external/lobehub/packages/context-engine/src/engine/messages/MessagesEngine.ts`, `ToolsEngine.ts`, `providers/**` | Builds model input from system role, history, tools, skills, memory, knowledge, files and agent/task/page contexts. |

## 3. LobeHub Runtime Taxonomy

| Runtime family | Representative source behavior | Peers-Touch target semantics |
| --- | --- | --- |
| Stream chunk accumulation | `StreamingHandler.handleChunk` handles `text`, `reasoning`, `reasoning_part`, `content_part`, `tool_calls`, `grounding`, `base64_image`, `stop`. | `AgentRuntimeEvent` must distinguish transient text, thinking/reasoning, content parts, tool call deltas, grounding/citations, generated image artifacts and stop/abort. |
| Finalization | `handleFinish` waits for image uploads, flushes tool calls, stores trace ID and finish type, builds final content/reasoning/images/tools. | Station/contract events must carry final trace, finish reason, usage/cost where available, durable message IDs and artifact refs; Desktop may accelerate with transient stream state. |
| Tool-call streaming | Tool call deltas are throttled, transformed to display payloads, and `toolCallingStreamIds` drives animation. | Peers must separate tool-call delta display from durable tool call records; unresolved tool names must become diagnostic states, not silent success. |
| Reasoning/thinking | Reasoning start/end produces duration, content or multimodal reasoning parts. | Thinking is a first-class stream state with duration/signature fields where provider supplies them; UI must not collapse it into plain assistant text. |
| Runtime dispatch | `selectRuntimeType` chooses client, gateway or heterogeneous path from agent config, gateway mode and parent runtime. | Peers must type execution route: Station provider, Desktop local/CLI, gateway/remote, heterogeneous/external. Route affects cancellation, resume and diagnostics owner. |
| Client runtime | `executeClientAgent` builds agent state, ToolsEngine, context refs and handles `isParkedStatus`. | Desktop-owned runtime can execute local tools/providers, but durable truth and post-run reconcile must remain Station/model-contract aligned. |
| Gateway runtime | Gateway tracks `agent_runtime_end`, `error`, `session_complete`, auth failure, token refresh and fallback when terminal events are missing. | Peers Station stream must distinguish terminal event, session transport close, auth failure and reconnect/replay; transport close alone is not semantic success. |
| Parked states | `waiting_for_human` and `waiting_for_async_tool` are explicitly non-terminal and must not emit completion side effects. | Peers runtime contract must model parked states separately from `done/error/abort`; topic title, queue drain and unread notifications must not run for parked states. |
| Resume approval/result | Gateway resume sends `resumeApproval` / `resumeToolResult`; control code snapshots paused ops and cleans up only after successful resume. | Tool approval and async tool result resume must be action-lineage events bound to original run/tool call and new resume operation. |
| Stop/cancel | `stopGenerateMessage` cancels running AI runtime operations; gateway sends interrupt; client paths normalize aborted errors. | Stop must emit local abort intent, runtime cancellation state and later Station/transport confirmation or degraded outcome. |
| Error recovery | Client/gateway/heterogeneous branches update operation/message errors differently; Google block reasons are localized in executors. | Peers must classify provider/tool/context/bridge failures at Station/contract boundary and expose owner/retryability, not only localized message text. |
| Context construction | Context engine and runtime executor inject tools, skills, memory, knowledge, files, topic references, page/task contexts and local system snapshots. | Peers runtime input builder must be traceable: every injected context source needs ownership, authorization, token budget and diagnostic metadata. |

## 4. Required Peers Runtime Contract Implications

| Requirement | Contract implication |
| --- | --- |
| Stream events must be typed | `AgentRuntimeEvent` needs canonical `type`, IDs and payloads for text, thinking, tool call, grounding, artifact, error, done, abort and reconcile. |
| Terminal and parked are different | `waiting_for_human` / `waiting_for_async_tool` are parked; they must not trigger completion side effects or clear recoverable state. |
| Transport lifecycle is not business lifecycle | WebSocket/session close, auth failure, interrupted stream and provider terminal event require separate event kinds. |
| Resume must be auditable | Approval/rejection/tool-result resume creates a new operation/action referencing original run, tool call, tool message and actor. |
| Context injection must be explainable | Runtime trace must identify memory/knowledge/tool/file/topic/page/task inputs, source owner, authorization and token impact. |
| Tool deltas are not durable truth | Streaming tool-call animation cannot replace persisted tool call/result records or approval policy state. |
| Stop must be fail-closed | UI may show local abort immediately, but cannot claim provider/server cancellation without runtime/Station evidence. |
| Errors must be classified by owner | Provider, bridge, gateway, local tool, context, memory, knowledge and authorization failures require distinct recovery states. |

## 5. Mapping To Existing Peers-Touch Specs

| Peers document | This source map contributes |
| --- | --- |
| `contract-foundation.md` | Runtime event taxonomy and IDs needed in model/proto contracts. |
| `session-topic-runtime.md` | Stream/reconcile/lineage semantics for M4 typed runtime closure. |
| `error-recovery-diagnostics.md` | Parked/terminal, owner/retryability and diagnostics source behavior for M9. |
| `tool-plugin-skill-parity.md` | Tool-call streaming, pending interventions and resume approval semantics. |
| `knowledge-files-parity.md` | Runtime context input explainability for file/knowledge injection. |
| `memory-projection-parity.md` | Memory injected/updated trace visibility in runtime events. |

## 6. Forbidden Relationships

1. Desktop Web must not convert transport close into semantic `done`.
2. Parked tool/human states must not be treated as terminal completion.
3. Streaming deltas must not be the only persisted record of tool calls, grounding, images or reasoning.
4. Retry/recover actions must not be local message rewrites with no action lineage.
5. Runtime context injection must not hide authorization/source/token-budget decisions.
6. Product implementation must not copy LobeHub runtime code.

## 7. Current Claim

BOM-007 is implemented for design as a source-backed chat runtime/streaming/recovery map.

M4 and M9 product implementation remain blocked until Owner confirmation and their respective evidence targets, `EVID-015` and `EVID-020`.
