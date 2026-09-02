# Agent LobeHub Blueprint Rebuild — Execution Plan

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-06-16 | **Updated**: 2026-06-17
> **Owner**: Peers-Touch Agent Team
> **Module**: `apps/desktop/`, `apps/desktop/src-tauri/`, `apps/station/app/subserver/agent/`

---

## 1. Purpose

This execution plan turns [Agent LobeHub Blueprint Rebuild](../agent-lobehub-blueprint.md) into ordered implementation phases.

The plan follows:

1. Domain Responsibility
2. Execution Closure
3. Dependency Order
4. Verifiable Delivery

---

## 2. Worktree

Implementation work for this rebuild is done in:

```text
<repo-root>
```

Reference implementation:

```text
external/lobehub
```

The reference is read-only. Peers-Touch implementation must preserve Peers-Touch architecture boundaries.

---

## 3. Phase Overview

| Phase | Goal | Primary Owner | Status |
|---|---|---|---|
| P0 | Streaming, state, service foundations | Desktop Web + Desktop Rust | pending |
| P1 | Tool and MCP execution closure | Desktop Rust + Desktop Web + Station bridge | active |
| P2 | Skill / plugin / Agent persistence | Desktop Rust + Station | active |
| P3 | Agent settings and UX parity | Desktop Web | pending |
| P4 | Knowledge, artifacts, marketplace | Desktop Web + Desktop Rust + Station | pending |
| P5 | Voice, connectors, and advanced parity | Desktop Web + Desktop Rust + Station | pending |

Delivery principle:

- The plan optimizes for complete LobeHub Agent capability coverage, not shortest calendar time.
- Capabilities are implemented one by one in dependency order until the full coverage gate is closed.
- Later phases are not optional. They only mean later in dependency order.

---

## 4. LobeHub Agent Capability Coverage Gate

This plan is only complete if every LobeHub Agent-related capability has one of the following outcomes:

- `build`: Peers-Touch must implement the capability.
- `reuse`: Peers-Touch already has the capability and must preserve or project it.
- `adapt`: Peers-Touch implements the same product outcome through Peers-Touch architecture instead of copying LobeHub internals.
- `not-applicable`: Excluded with a Peers-Touch-specific reason.

No capability may remain implicit under a broad phase title.
No LobeHub Agent-related capability may be dropped for schedule reasons.

| LobeHub Agent Capability | Peers-Touch Outcome | Task / Phase |
|---|---|---|
| Token-level streaming | build | P0-1 |
| Multi-round tool loop | reuse | Station `TurnService`, projected by P0-1 / P1-4 |
| Message types: user / assistant / tool / system / thinking | adapt | P0-1, P1-4, P3-4 |
| Topic / thread grouping | build | P0-4 |
| Multimodal input: image / file / paste | build | P0-5 |
| Context compression | reuse | Station compression, projected by P3-4 |
| Cross-session message search | reuse/adapt | P0-6 |
| Message edit / regenerate / copy / delete | build | P0-7 |
| Portal / notebook / saved messages | adapt | P3-8 |
| TTS / STT | build | P5-1 |
| Agentic turn loop | reuse | Station `TurnService` |
| Client-side local tool execution | build | P1-5 |
| Gateway realtime channel | build/adapt | P0-1 streaming; P5-2 bidirectional gateway completion |
| Context engineering: prompt + memory + skills | reuse/adapt | Station services, P3-4 projection |
| Memory management | reuse/adapt | Station `MemoryService`, P3-4 projection |
| Error classification and recovery | reuse/adapt | Station services, P3-4 projection |
| Provider rotation / fallback | reuse/adapt | Station services, P3-4 projection |
| Delegation / child Agent | reuse/adapt | Station `DelegationService`, P4-6 UI |
| Human-in-the-loop approval | build | P1-3 |
| Heterogeneous Agent / CLI provider | build | P5-3 |
| Abort / cancel | build | P0-1 |
| Builtin tools | build/adapt | P1-5 |
| MCP stdio | build | P1-1, P1-2 |
| MCP HTTP | build | P1-1, P1-2 |
| MCP SSE | build | P1-1, P1-2 |
| Custom plugin | build | P2-5 |
| Plugin marketplace | build | P2-4, P4-3 |
| OAuth connector | build | P5-4 |
| Composio-like third-party connector | build/adapt | P5-5 |
| Tool progress / telemetry | build/adapt | P1-4 |
| Skill CRUD | build/adapt | P2-1 |
| Skill import from GitHub | build | P2-2 |
| Skill import from URL / ZIP | build | P2-2 |
| Skill marketplace | build | P2-4 |
| Skill resource tree | build | P2-6 |
| Skill trust / security scan | reuse/adapt | Station `SkillsGuardService`, P2-1/P2-2 |
| Skill versioning / rollback | reuse/adapt | Station `SkillService`, P2-7 UI |
| Per-Agent skill binding | build | P2-3 |
| System prompt editor with token awareness | build | P3-2 |
| Model / provider selection | reuse/adapt | P3-1 preserves and improves |
| LLM params | reuse/adapt | P3-1 preserves and improves |
| Per-Agent plugin / tool binding | build | P2-3 |
| Document / knowledge binding | build | P4-1 |
| Opening message / starter questions | build | P3-5 |
| AI-assisted Agent metadata generation | build | P3-6 |
| Chat behavior config: history / compression | build/adapt | P3-7 |
| Agent clone / transfer / package import-export | build | P2-8 |
| Agent CRUD | build/adapt | P2-3 |
| Agent list / sidebar | reuse/adapt | P3-9 |
| Default / inbox Agent | build | P2-9 |
| Agent pin / favorite / ordering | build | P2-10 |
| Agent marketplace discovery | build | P4-3 |
| Workspace isolation | build/adapt | P1-6, P2-3 |
| Knowledge document upload | build | P4-1 |
| Agent document binding | build | P4-1 |
| Knowledge retrieval / context injection | build | P4-2 |
| Chunking / embedding | build/adapt | P4-2 |
| Rich chat input commands / mentions / references | build | P3-10 |
| Tool call rendering | build | P1-4 |
| Thinking / reasoning display | build | P3-4 |
| Artifacts | build | P4-4 |
| Code block rendering | build/adapt | P3-11 |
| Portal side panel | build/adapt | P3-8 |
| Hotkeys | build | P3-12 |
| Wide screen mode | reuse | Preserve in P3 |
| Multi-store architecture | build | P0-2 |
| Slice composition / selectors | build | P0-2 |
| SWR / revalidation | build/adapt | P0-8 |
| Optimistic updates | build | P0-8 |
| DevTools diagnostics | build | P5-6 |
| Local file access for Agent tools | build | P1-5 |
| Per-Agent working directory | build | P1-6 |
| Clipboard integration | build | P1-5 |

---

## 5. Architecture Conformance Gate

Every task in this plan must pass the end-to-end architecture gate from [Agent LobeHub Blueprint Rebuild](../agent-lobehub-blueprint.md#6-end-to-end-implementation-architecture).

For each implementation slice, the executor must record the following before marking it done:

| Gate | Required Answer |
|---|---|
| Source of truth | Station, Desktop Rust local state, or Desktop Web UI preference |
| Runtime projection owner | Which Desktop runtime owns freshness and reconciliation |
| Local executor | Whether Desktop Rust executes anything device-local |
| Station owner | Which Station service owns durable business state or turn orchestration |
| Protocol | Station HTTP/SSE, Tauri command/event, protobuf/domain DTO, or external protocol |
| Policy path | Which policy/approval/audit steps apply |
| Trace path | How the result appears in TurnTrace and Desktop diagnostics |
| Reconciliation path | How missed events/reloads/reconnects become correct |

Blocking rules:

- Desktop Web cannot become the source of truth for Agent business state.
- Desktop pages cannot keep state fresh only through mount-time fetches.
- Desktop Rust cannot own cross-device Agent intelligence or durable business truth.
- Station cannot execute device-privileged local actions directly.
- Tool, MCP, plugin, connector, voice, file, clipboard, and CLI actions must enter the shared policy/audit pipeline.
- New shared contracts must be proto/domain-first; no duplicate manual cross-layer model is allowed.
- Every stream/event shape must be typed and rendered through runtime projection, not ad hoc component state.

---

## 6. Phase P0 — Foundations

### P0-1 True Streaming

Scope:

- Replace one-shot `chat_completion_once` paths used as fake streaming.
- Stream text, thinking, tool calls, progress, errors, and done events.
- Preserve `applyStreamEvent` reducer contract where possible.

Target files:

- `apps/desktop/src/services/desktop_api.ts`
- `apps/desktop/src/store/chat.ts`
- `apps/desktop/src-tauri/src/application/agent_turn/mod.rs`
- `apps/station/app/subserver/agent/handler/turn_handler.go`

Current status:

- P0-1 implementation complete for the current architecture slice.
- Desktop Rust local tool bridge exists through `agent_resolve_local_tool_request`.
- Station now exposes `/agent/turn/stream` as an SSE event endpoint with `progress`, `text`, `error`, and `done` frames.
- Desktop Rust now exposes `agent_execute_turn_stream`, reads Station SSE frames, and emits `agent:turn-stream-event` Tauri events.
- Desktop Web now exposes `streamAgentTurn` and `startAgentTurnStream` service adapters.
- Desktop Web `streamAgentTurn` now normalizes Station `TurnEvent` fields into the existing chat stream reducer contract (`content`, `id`, `name`, `args`, `message`).
- The main Desktop `chat.ts` send and regenerate paths now use the Agent turn stream instead of the legacy `chat_completion_stream` path.
- Station `TurnService` now has an `EventSink` and emits live `progress`, `text`, `tool_call`, `tool_result`, and `error` events from inside the turn loop.
- Station `/agent/turn/stream` now writes TurnService events through a channel instead of synthesizing all frames after the blocking turn returns.
- OpenAI-compatible Station provider calls now support streaming `text` and `thinking` deltas into the same TurnService event sink.
- Anthropic Messages SSE and Ollama NDJSON provider calls now stream token deltas into the same TurnService event sink when a `DeltaSink` is present.
- Station now registers a `local_mcp` turn-loop tool, emits `local_tool_request`, waits on a scoped broker, accepts `/agent/turn/local-tool-result`, and resumes the same live turn with the Desktop-local MCP result.
- Desktop Rust now auto-resolves `local_tool_request` stream events through `agent_resolve_local_tool_request`, executes MCP locally, and submits the result back to Station before the turn loop continues.
- Desktop Web abort now calls `agent_cancel_turn_stream`; Desktop Rust tracks stream cancellation by `stream_id` and stops consuming the Station turn stream when the cancel flag is observed.

Architecture gate:

| Gate | Answer |
|---|---|
| Source of truth | Station owns turn state and final trace |
| Runtime projection owner | `chatRuntime` / current `chat.ts` stream reducer until P0-2 split |
| Local executor | Desktop Rust handles `local_tool_request` events for MCP/tool capabilities |
| Station owner | Station `TurnService` and turn handler |
| Protocol | Station `/agent/turn/stream` SSE to Desktop Rust; Tauri `agent:turn-stream-event` to Desktop Web |
| Policy path | P1-3 approval gate applies before local execution |
| Trace path | TurnService stream events are emitted from the same provider/tool paths that populate TurnTrace records |
| Reconciliation path | Final `done` event plus later trace fetch reconcile missed events |

Acceptance:

- Done: Station has an Agent turn SSE endpoint.
- Done: Station stream endpoint is connected to TurnService `EventSink`.
- Done: Desktop Rust can bridge Station SSE frames into Tauri events.
- Done: Desktop Web has a service adapter for the Agent turn stream.
- Done: OpenAI-compatible provider-token `text` and `thinking` deltas arrive before final done.
- Done: user sees the Agent turn stream through the current `chat.ts` reducer while P0-2 prepares the dedicated `chatRuntime` split.
- Done: Anthropic/Ollama provider-token streaming parity feeds the same provider delta path as OpenAI-compatible streaming.
- Done: Desktop-local MCP tool execution result is returned to the live Station turn loop through `local_tool_request` → Desktop Rust execution → `/agent/turn/local-tool-result`.
- Done: cancel/abort stops the visible stream and asks Desktop Rust to cancel the upstream Agent turn stream.

Verification:

```bash
cd apps/desktop && pnpm run check
cd apps/desktop/src-tauri && cargo check --quiet
```

### P0-2 Runtime / Store Split

Scope:

- Split chat, agent, tool, MCP, and skill state ownership.
- Keep pages as renderers; long-lived state belongs to runtime/store owners.

Target files:

- `apps/desktop/src/store/chat.ts`
- `apps/desktop/src/store/agent*`
- `apps/desktop/src/store/tool*`
- `apps/desktop/src/runtimes/*`

Acceptance:

- Done: Agent selection/config is owned by `store/agent.ts`, not incidental `chat.ts` state.
- Done: MCP projection is owned by `store/mcp.ts`; `MCPTab` reads and mutates through that store.
- Done: Tool projection is owned by `store/tool.ts`.
- Done: Skill projection is owned by `store/skill.ts`; `SkillAppletSelector` reads and toggles skills through that store.
- Done: `runtimes/agentCapabilityRuntime.ts` bootstraps and reconciles agent/model/applet, MCP, tool, and skill projections.
- Done: Existing chat send/read flows still pass Desktop type checks.

Verification:

```bash
cd apps/desktop && pnpm run check
```

### P0-3 API Module Boundaries

Scope:

- Stop expanding `desktop_api.ts` as an unbounded surface.
- Introduce domain service modules while preserving a compatibility export if needed.

Target files:

- `apps/desktop/src/services/desktop_api.ts`
- `apps/desktop/src/services/mcp-service.ts`
- New service modules under `apps/desktop/src/services/`

Acceptance:

- Done: Agent turn streaming is consumed through `agentService.streamTurn`; `desktop_api.ts` remains the low-level compatibility bridge.
- Done: MCP calls are consumed through `mcp-service.ts` and `store/mcp.ts`.
- Done: Tool calls are consumed through `tool-service.ts` and `store/tool.ts`.
- Done: Skill calls are consumed through `skill-service.ts` and `store/skill.ts` for the chat skill selector and installed skills tab.
- Done: TypeScript check passes.

Verification:

```bash
cd apps/desktop && pnpm run check
```

### P0-4 Topic / Thread Projection

Scope:

- Add explicit topic/thread lifecycle for Agent chat.
- Preserve manual session behavior while adding automatic topic naming/grouping where reliable.

Current status:

- P0-4 implementation complete for the current Desktop projection slice.
- `store/agentTopics.ts` now owns Agent topic projection, including topic list loading, draft topic creation, optimistic delete/rename/duplicate, smart rename state, and generated-title undo history.
- `runtimes/agentTopicRuntime.ts` now bootstraps and periodically reconciles the selected Agent's topic projection.
- `AgentSidebar` now renders topics from the projection store instead of component-local state or direct API calls.
- Topic title generation is visible through `generating` / `generated` UI states, and generated titles can be reverted to the previous title.
- Chat turn completion reconciles topic projection and auto-generates a title for draft topics when the topic is still untitled.
- `ChatService` owns the Desktop Web API boundary for topic/session operations; `desktop_api.ts` remains the low-level compatibility bridge.

Architecture gate:

| Gate | Answer |
|---|---|
| Source of truth | Desktop Rust local chat conversation state for the current slice; Station durable Agent conversation truth remains the target owner for later persistence work |
| Runtime projection owner | `agentTopicRuntime` + `store/agentTopics.ts` own Desktop Web topic freshness and reconciliation |
| Local executor | None; topic operations are Desktop Rust chat commands through `ChatService` |
| Station owner | Future Station Agent conversation/session service when P2 persistence work lands |
| Protocol | Desktop Web `ChatService` → Tauri chat commands → Desktop Rust chat application store |
| Policy path | No privileged local action; rename/delete remain user-initiated UI actions |
| Trace path | Topic title state is projected in Desktop diagnostics/logs; turn trace remains owned by P0-1/P1 turn streaming |
| Reconciliation path | Runtime bootstrap, 60s periodic reconcile, explicit sidebar reload, and turn-completion reconcile |

Acceptance:

- Done: Conversations can be grouped by topic through `agentTopics` projection and date-grouped sidebar rendering.
- Done: Topic title generation is visible and reversible through generated-title state plus undo.

Verification:

```bash
cd apps/desktop && pnpm run check
```

### P0-5 Multimodal Composer Foundation

Scope:

- Normalize image, file, paste, drag-drop, and command inputs into one composer attachment model.
- Keep binary/file handling in Desktop Rust or approved storage services.

Current status:

- P0-5 implementation complete for the current Desktop composer foundation slice.
- Agent `ChatInput` now uses the shared `useChatAttachmentDrafts` composer model instead of the old image-only `/upload` path.
- Image, PDF, text, Markdown, JSON, and CSV attachments can be added through picker, paste, or drag/drop.
- Agent attachment upload runs through the Agent-owned encrypted OSS adapter (`services/agentAttachments.ts`) instead of Social IM or component-owned binary handling.
- Attachment drafts render upload, retry, remove, image preview, and file-card states before send.
- Outgoing user messages preserve attachment projection locally, including across post-turn `syncMessages` merges when the durable owner has not yet returned attachment metadata.
- Agent turn bridge accepts and forwards attachment metadata in `AgentExecuteTurnInput`; Station durable multimodal ingestion remains future proto/domain work.

Architecture gate:

| Gate | Answer |
|---|---|
| Source of truth | Desktop Web owns transient composer drafts; Desktop Rust / OSS owns uploaded attachment objects; Station durable multimodal turn truth remains future proto work |
| Runtime projection owner | `chat.ts` owns current message projection; composer attachment drafts are local view state and are cleared on send/session change |
| Local executor | Desktop Rust / OSS attachment commands handle file picking/path upload and storage-side upload |
| Station owner | Future Station Agent conversation/multimodal turn service once attachment fields are promoted into proto/domain contracts |
| Protocol | Desktop Web `agentAttachments` → `oss_upload_agent_attachment_bytes`; Agent turn metadata travels through Tauri `agent_execute_turn_stream` request body |
| Policy path | Unsupported file types are rejected in UI with localized errors; privileged local file path upload remains Desktop Rust mediated |
| Trace path | Attachment metadata is visible in the user message projection; future Station trace attachment persistence is tracked by P4/P5 persistence work |
| Reconciliation path | Local message attachment projection is preserved during `syncMessages`; uploaded objects are reconciled through OSS metadata |

Acceptance:

- Done: User can attach supported image/file inputs via picker, paste, or drag/drop and see them represented in the outgoing message.
- Done: Unsupported file types fail with localized, actionable errors.

Verification:

```bash
cd apps/desktop && pnpm run check
cd apps/desktop/src-tauri && cargo check --quiet
git diff --check
```

### P0-6 Agent Message Search Projection

Scope:

- Reuse Station session search where available.
- Add Desktop UI projection for cross-session Agent search.

Current status:

- P0-6 implementation complete for the current Desktop projection slice.
- `store/agentSearch.ts` now owns Agent message search state, result projection, loading state, and local failure state.
- Agent sidebar search now performs topic-title filtering and cross-topic message search for the selected Agent.
- Search results show topic title plus message snippet and jump to the matching topic through the existing `selectSession` path.
- Current implementation reuses Desktop chat message listing as the available projection source; Station `session_search` exists as an Agent tool, but a first-class Station UI API remains future persistence/API work.

Architecture gate:

| Gate | Answer |
|---|---|
| Source of truth | Desktop Rust local chat message projection for this slice; Station session search remains target durable owner once exposed as UI API |
| Runtime projection owner | `store/agentSearch.ts` owns query/result projection; `store/agentTopics.ts` supplies searchable topic scope |
| Local executor | None; Desktop Web calls Desktop Rust chat list through `ChatService.getMessages` |
| Station owner | Station `SessionSearchService` exists for tool use; future Station handler/API should own durable cross-session search |
| Protocol | Desktop Web `ChatService` → Tauri `chat_list_messages` through `desktop_api.ts` |
| Policy path | Read-only message search; no privileged local action |
| Trace path | Search selection jumps through existing session selection; no turn trace mutation |
| Reconciliation path | Results are recomputed per query from current topic projection and message list source |

Acceptance:

- Done: User can search Agent conversations and jump to the result.

Verification:

```bash
cd apps/desktop && pnpm run check
git diff --check
```

### P0-7 Message Operations

Scope:

- Ensure edit, regenerate, copy, delete, retry, and branch-from-message are complete and trace-safe.

Acceptance:

- Regenerate preserves original message history and creates an auditable replacement.
- Delete/edit operations update local projection and durable owner consistently.

Status:

- P0-7 implementation complete for the current Desktop projection slice.
- `store/chat.ts` now separates regenerate, retry, and delete-and-regenerate semantics. Regenerate/retry preserve the original response and mark the replacement chain in local projection metadata; delete-and-regenerate keeps the explicit destructive path.
- `store/chat.ts` adds branch-from-message by duplicating the current topic, pruning messages after the selected branch point through the durable chat owner, and selecting the new topic.
- `MessageBubble.tsx` exposes retry and branch-from-message actions and renders operation/audit tags for replaced and replacement messages.
- Chat locale bundles include retry, branch, and message audit labels.

Architecture closure:

| Path | Closure |
|------|---------|
| Desktop Web | Owns message operation projection, action entry points, and local audit labels |
| Desktop Rust durable owner | Existing conversation duplicate / message delete / message update commands remain the durable mutation path |
| Station | No new Station ownership introduced in this slice; Agent turn execution remains the source for new assistant output |
| Policy path | Branch uses existing conversation duplication and pruning commands; retry/regenerate only call the Agent turn stream |
| Trace path | Replacement metadata remains visible in the Desktop projection; destructive replacement is an explicit separate action |
| Reconciliation path | Topic/session lists are reloaded after branch and after streamed replacement turns |

Verification:

```bash
cd apps/desktop && pnpm run check
git diff --check
```

### P0-8 Data Fetching, Revalidation, And Optimistic Updates

Scope:

- Introduce predictable revalidation and optimistic update patterns for Agent, Tool, Skill, MCP, and Settings surfaces.
- Do not hide runtime ownership behind component-level mount fetches.

Acceptance:

- Create/update/delete operations update UI immediately and reconcile with the owner service.
- Failed optimistic updates roll back with visible error state.

Status:

- P0-8 implementation complete for the current Desktop projection slice.
- Added `store/revalidation.ts` as the shared metadata contract for loading, last successful load, visible error state, and pending mutation tracking.
- `store/agent.ts`, `store/mcp.ts`, `store/tool.ts`, `store/skill.ts`, and `store/settings.ts` now expose revalidation metadata instead of silently swallowing owner failures.
- MCP create/toggle/delete and Skill toggle/delete now perform optimistic projection updates, roll back on failure, and reconcile with the owner service after success.
- Agent config/app\-let updates and Settings agent updates now record mutation state, revalidate from the durable owner, and preserve rollback state for failed optimistic writes.
- MCP, Skills, and Settings Tools surfaces render visible error alerts from their owning stores.

Architecture closure:

| Path | Closure |
|------|---------|
| Desktop Web | Store owners expose shared revalidation metadata; pages/components render errors from projection state |
| Desktop Rust durable owner | Existing Agent, MCP, Skill, Tool, Settings commands remain the mutation and reconciliation source |
| Station | No Station ownership introduced in this slice |
| Policy path | Mutations call existing service APIs only; rollback never invents durable state |
| Trace path | Pending mutation keys make optimistic changes observable in store state |
| Reconciliation path | Successful mutations reload from the owner service; failed mutations restore previous projections |

Verification:

```bash
cd apps/desktop && pnpm run check
git diff --check
```

---

## 7. Phase P1 — Tool And MCP Execution Closure

### P1-1 MCP Transport Support

Scope:

- Support `stdio`, `http`, and `sse`.
- Persist server configuration locally.
- Test connection through real protocol paths.
- Discover MCP tools with `tools/list`.

Target files:

- `apps/desktop/src-tauri/src/application/mcp/mod.rs`
- `apps/desktop/src/components/MCPTab.tsx`
- `apps/desktop/src/services/desktop_api.ts`
- `packages/locales/{en,zh-CN}/provider.json`

Current status:

- Initial implementation exists for local persistence, three transport types, health/test, and tool discovery.
- Unit tests launch temporary MCP fixtures for all three transports.

Acceptance:

- `stdio` fixture discovers `stdio_fixture_tool`.
- `http` fixture discovers `http_fixture_tool`.
- `sse` fixture discovers `sse_fixture_tool`.

Verification:

```bash
cd apps/desktop/src-tauri
cargo test --bin peers-touch-desktop mcp -- --test-threads=1
```

### P1-2 MCP Tool Execution

Scope:

- Convert discovered MCP tools into executable tool descriptors.
- Dispatch tool calls to the owning MCP server.
- Return structured success/error results.

Target files:

- `apps/desktop/src-tauri/src/application/mcp/mod.rs`
- `apps/desktop/src-tauri/src/application/tools/mod.rs`
- `apps/desktop/src-tauri/src/application/agent_turn/mod.rs`
- `apps/station/app/subserver/agent/service/tool_registry_service.go`

Current status:

- Desktop Rust local execution slice is implemented.
- `mcp_execute_tool` dispatches `tools/call` over `stdio`, `http`, and `sse`.
- `tools_list` projects discovered MCP tools as executable tool registry descriptors with source, server, transport, approval, and execution metadata.
- Desktop `ToolService.execute` can route MCP tool requests to the local Rust executor.
- Desktop Rust `agent_resolve_local_tool_request` bridge is implemented for future Station local-tool request events.
- The bridge returns a typed `tool_result` event payload with `desktop-rust` ownership, audit metadata, call id, turn id, server name, and tool name.

Architecture gate:

| Gate | Answer |
|---|---|
| Source of truth | Station remains turn/trace owner; Desktop Rust owns device-local MCP execution state |
| Runtime projection owner | Future `toolRuntime`; current slice exposes command/service projection and typed local `tool_result` payload |
| Local executor | Desktop Rust `application/mcp` executes MCP `tools/call`; Desktop Rust `application/agent_turn` bridges local tool requests |
| Station owner | Station `TurnService` / `ToolRegistryService` remains turn owner and must emit/consume local-tool request/result events in P0 streaming integration |
| Protocol | Tauri command / dev HTTP gateway to Rust; MCP JSON-RPC over stdio/http/sse; local bridge event payload for turn streaming |
| Policy path | MCP registry marks projected tools as approval-required; full approval gate is P1-3 |
| Trace path | Local execution returns structured audit metadata and bridge `tool_result`; Station TurnTrace persistence remains streaming integration work |
| Reconciliation path | MCP tools are re-projected from persisted server state after health/test discovery |

Acceptance:

- Done: an MCP tool can execute through Desktop Rust over `stdio`, `http`, and `sse`.
- Done: Desktop Rust can convert a local MCP request into a typed `tool_result` bridge payload.
- Done: execution result is returned to the live Station Agent turn loop.
- Done: tool call is visible in Desktop message trace from the live turn stream.

### P1-3 Tool Approval And Audit

Scope:

- Mark sensitive tools as approval-required.
- Pause before execution and require user decision.
- Persist approval/audit event metadata.

Target files:

- `apps/desktop/src/components/MessageBubble.tsx`
- `apps/desktop/src/components/MCPTab.tsx`
- `apps/desktop/src-tauri/src/application/tools/mod.rs`
- `apps/desktop/src-tauri/src/application/agent_turn/mod.rs`

Acceptance:

- User can approve/deny before a sensitive local tool runs.
- Denial returns a structured tool error to the turn.
- Trace shows actor, decision, time, and tool name.

Status:

- P1-3 implementation complete for the current Desktop-local MCP tool slice.
- Desktop Rust now pauses `local_tool_request` handling, emits `tool_approval_required`, waits for a Web decision through `agent_decide_tool_approval`, and only executes the MCP tool after approval.
- Denial and approval timeout return structured local tool errors to Station through `/agent/turn/local-tool-result`.
- Desktop Web projects `tool_approval_required` and `tool_approval_decision` into message tool-call state.
- `MessageBubble.tsx` renders approval-needed tool cards with approve/deny actions and shows actor/time decision metadata in the message trace projection.

Architecture closure:

| Path | Closure |
|------|---------|
| Desktop Web | Owns user decision UX and projects approval/audit state into message trace cards |
| Desktop Rust | Owns approval waiters, secure local MCP execution, and denial/result submission to Station |
| Station | Remains turn owner and resumes the turn only after Desktop submits the local tool result |
| Policy path | Local MCP requests are approval-gated before any Desktop-local execution |
| Trace path | Approval id, actor, decision, decision time, server name, and tool name are emitted into stream events and message projection |
| Reconciliation path | Tool result still flows through Station local-tool-result broker before the provider loop continues |

Verification:

```bash
cd apps/desktop && pnpm run check
cd apps/desktop/src-tauri && source ~/.cargo/env && cargo test --bin peers-touch-desktop agent_turn -- --test-threads=1
git diff --check
```

### P1-4 Tool Call UI

Scope:

- Render tool call lifecycle as first-class UI cards.
- Include pending, running, approval-needed, success, failed, cancelled states.

Acceptance:

- Users can inspect inputs, outputs, error summaries, and audit data without logs.

Status:

- P1-4 implementation complete for the current Desktop message trace slice.
- `ToolCallInfo` now models queued, approval-required, approved, denied, pending/running, success, error, and cancelled states.
- `MessageBubble.tsx` renders tool lifecycle cards with explicit status tags, approval controls, server metadata, arguments, results, and approval actor metadata.
- Stopped Agent streams now mark unfinished tool calls as `cancelled` instead of projecting them as successful.

Architecture closure:

| Path | Closure |
|------|---------|
| Desktop Web | Owns lifecycle card rendering and per-tool inspection UX |
| Desktop Rust | Emits approval and local tool result events consumed by the Web projection |
| Station | Remains live turn owner and emits tool call/result frames into the stream |
| Policy path | Approval-needed state blocks local execution through P1-3 before UI can show running/success |
| Trace path | Inputs, outputs, status, approval actor, and server metadata are visible in message cards |
| Reconciliation path | Stream events update the in-memory message projection; durable message sync preserves tool metadata where available |

Verification:

```bash
cd apps/desktop && pnpm run check
cd apps/desktop/src-tauri && source ~/.cargo/env && cargo test --bin peers-touch-desktop agent_turn -- --test-threads=1
git diff --check
```

### P1-5 Builtin Local Tools

Scope:

- Implement schema-first local tools for files, clipboard, shell-safe operations where allowed, memory bridge, and Station-backed search.
- Apply approval and audit policy before execution.

Acceptance:

- Builtin tools are listed with schema, category, risk level, approval requirement, and execution owner.
- Local file and clipboard tools cannot run without policy approval.

Status:

- P1-5 implementation complete for the schema-first Desktop-local builtin tool bridge.

Delivered:

- Desktop Rust `tools_list` now projects builtin tools with schema, category, risk level, approval requirement, source, executability, and execution owner metadata.
- Desktop Rust implements approved local execution for:
  - `local_file_read`
  - `local_workspace_list`
  - `local_clipboard_read`
  - `local_clipboard_write`
  - `local_shell_safe`
- Desktop local file/workspace operations require an explicit `workspace_root` and reject paths outside the approved workspace.
- Station registers Desktop-local builtin tools as Station-visible tool definitions while keeping execution owned by Desktop Rust.
- Station `TurnService` routes Desktop-local builtin calls through the live `local_tool_request` broker with `source: "builtin"` and `workspaceRoot`, so P1-3 approval blocks execution before Desktop Rust runs the tool.
- Station prompt guidance now tells the model that builtin local tools execute through the Desktop local bridge and return results to the same turn.

Verification:

```bash
cd apps/desktop && pnpm run check
cd apps/desktop/src-tauri && source ~/.cargo/env && cargo test --bin peers-touch-desktop tools::tests -- --test-threads=1
cd apps/desktop/src-tauri && source ~/.cargo/env && cargo test --bin peers-touch-desktop agent_turn::tests -- --test-threads=1
cd apps/station/app && go test ./subserver/agent/service
```

### P1-6 Agent Workspace Controls

Scope:

- Add per-Agent working directory, allowed path policy, and workspace metadata.
- Ensure CLI/local tools run only inside the approved workspace.

Acceptance:

- Agent workspace is visible in Agent Profile.
- Tool execution outside allowed workspace is denied and audited.

Status:

- P1-6 implementation complete for current per-Agent Desktop workspace controls.

Delivered:

- Agent `chatConfig.workspace` records the per-Agent workspace root and `workspace-only` allowed path policy without introducing a parallel Agent model.
- Agent Settings exposes workspace configuration through localized UI strings.
- Agent Profile shows the current workspace root and policy state beside the Agent model controls.
- Desktop chat turn construction forwards the selected Agent workspace as `workspace_root` on send, retry, and regenerate flows.
- Desktop Rust local workspace tools require `workspace_root`, reject paths outside the approved workspace, and preserve audit metadata on denial.

Verification:

```bash
cd apps/desktop && pnpm run check
cd apps/desktop/src-tauri && source ~/.cargo/env && cargo test --bin peers-touch-desktop agent_turn::tests -- --test-threads=1
```

---

## 8. Phase P2 — Skills, Plugins, And Persistence

### P2-1 Skill Persistence

Scope:

- Replace volatile local skill state with durable persistence or Station-backed sync.
- Preserve Station security scanning and versioning as authority.

Status:

- P2-1 implementation complete for Station-backed Desktop skill persistence.

Delivered:

- `model/domain/agent/skill.proto` now carries skill `enabled` state plus typed update/delete request and response contracts.
- Station Agent exposes `/agent/skill/update` and `/agent/skill/delete` typed handlers alongside list/get/install.
- Station `SkillService` supports durable update/delete by skill ID, records a new version on content changes, re-runs `SkillsGuardService` scanning on content updates, and preserves trust / scan verdict / source / version metadata through `SkillManifest`.
- Desktop Rust `application/skills` no longer uses process-local `OnceLock<Mutex<...>>` skill state; list/search/get/create/update/delete/toggle now route through authenticated Station proto endpoints.
- Desktop skill UI models and cards expose Station-backed `trustLevel`, `scanVerdict`, `source`, `version`, and enabled state.

Architecture gate:

| Gate | Answer |
|---|---|
| Source of truth | Station `agent_skills` and `agent_skill_versions` tables |
| Runtime projection owner | Desktop `useSkillStore` remains a cache/revalidation projection only |
| Local executor | None for skill persistence; Desktop Rust is an authenticated Station bridge |
| Station owner | `SkillService` and `SkillHandlers` own CRUD, scan, trust, and versioning |
| Protocol | Desktop Web → Tauri skills commands → Desktop Rust → Station protobuf typed handlers |
| Policy path | Station `SkillsGuardService` scan and install/update policy decide whether content can be persisted |
| Trace path | Station logs and growth events record create/update/delete; Desktop logs only transport failures |
| Reconciliation path | Desktop skill store reloads from Station after mutations |

Acceptance:

- Done: Skills survive restart because Desktop skill state is Station-backed, not process-local.
- Done: Skill trust, scan result, source, enabled state, and version are visible in Desktop skill list/detail projections.

Verification:

```bash
./model/build.sh
cd apps/station && go test ./app/subserver/agent/...
cd apps/desktop && pnpm run check
cd apps/desktop/src-tauri && cargo test --bin peers-touch-desktop skills::tests -- --test-threads=1
```

### P2-2 Skill Import

Scope:

- Import from curated market, GitHub, URL, or ZIP.
- Validate package shape and scan before enablement.

Status:

- P2-2 implementation complete for the current Desktop import surfaces.

Delivered:

- URL and GitHub skill imports now fetch real remote `SKILL.md` content instead of returning placeholder import results.
- ZIP import and validation now use a Tauri command path with base64 file bytes, Rust ZIP parsing, UTF-8 `SKILL.md` extraction, and package-shape validation.
- Market source add/list/sync/list-skills/detail/install now uses a real market index JSON source in Desktop Rust rather than hardcoded empty/mock responses.
- All install paths converge on Station `/agent/skill/install`, so Station security scanning and install policy decide whether imported content is persisted and enabled.
- Invalid packages return structured invalid-argument errors before Station install; valid packages are bound to the selected/default Agent ID through the Station skill table.

Architecture gate:

| Gate | Answer |
|---|---|
| Source of truth | Station `agent_skills`; Desktop market source cache is only an import discovery cache |
| Runtime projection owner | Desktop `SkillsTab` and `useSkillStore` project import results and reload installed skills from Station |
| Local executor | Desktop Rust fetches URL/GitHub/market/ZIP content and validates package shape |
| Station owner | `SkillService.CreateSkill` owns scan, install policy, trust, and persistence |
| Protocol | Desktop Web file/market UI → Tauri skills market commands → Desktop Rust import parser → Station protobuf install |
| Policy path | Import package validation runs before install; Station `SkillsGuardService` is authoritative for final allow/block |
| Trace path | Station logs scan/install decisions; Desktop logs transport/import parse errors |
| Reconciliation path | Desktop reloads installed skills after import success |

Acceptance:

- Done: Invalid URL/GitHub/ZIP/market packages fail with concrete validation or fetch errors.
- Done: Valid packages install through Station and are bound to the requested/default Agent.

Verification:

```bash
cd apps/desktop && pnpm run check
cd apps/desktop/src-tauri && cargo test --bin peers-touch-desktop skills_market::tests -- --test-threads=1
```

### P2-3 Agent Persistence And Binding

Scope:

- Persist Agent config, selected Agent, enabled MCP servers, tools, and skills.
- Keep actor isolation.

Status:

- P2-3 implementation complete for the current Desktop Agent configuration surface.

Delivered:

- Desktop Rust Agent store now loads and persists per-actor Agent records under the app data storage layout instead of keeping Agent CRUD in a process-only `OnceLock` bucket.
- Selected Agent is now part of the same per-actor persisted Agent store and is exposed through `agents_get_selected` / `agents_set_selected` Tauri and HTTP gateway commands.
- Desktop Web `useAgentStore` now reconciles selected Agent from Desktop Rust during `loadAgents` and persists user selection changes through the Desktop Rust bridge.
- Agent `chatConfig` now explicitly types `mcpServers`, `tools`, and `skills` bindings, so MCP/tool/skill binding state is persisted through the existing `agents_update` path rather than a side-channel store.
- Actor isolation uses the existing actor session resolver plus storage user scope; switching actor reads a different persisted Agent file and cannot see another actor's selected Agent or Agent config.

Architecture gate:

| Gate | Answer |
|---|---|
| Source of truth | Desktop Rust per-actor Agent store for local Agent configuration; Station remains Agent turn owner |
| Runtime projection owner | Desktop `useAgentStore` projects Agent list and selected Agent into Web state |
| Local executor | None for Agent config persistence; tool execution still goes through Desktop Rust local tool bridge |
| Station owner | Station owns turn execution and durable skill records; Desktop Agent config references skill/tool/MCP bindings by ID/name |
| Protocol | Desktop Web `api.*Agent` calls → Tauri Agent commands → Desktop Rust per-actor persisted store |
| Policy path | Tool execution policy remains P1 approval/audit; persistence does not grant execution by itself |
| Trace path | Desktop Rust logs Agent store read/write failures and selection persistence failures |
| Reconciliation path | `useAgentStore.loadAgents` reloads Agent list and selected Agent from Desktop Rust; selection changes write through immediately |

Acceptance:

- Done: Restart does not lose Agents, selected Agent, or `chatConfig` MCP/tool/skill bindings.
- Done: Switching actor does not leak Agent state because each actor resolves to a separate storage scope.

Verification:

```bash
cd apps/desktop && pnpm run check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --bin peers-touch-desktop application::agents::tests -- --test-threads=1
```

### P2-4 Skill And Plugin Marketplace

Scope:

- Provide curated discovery for skills, plugins, and MCP packages.
- Include publisher, source, trust, risk, version, and install state.

Status:

- P2-4 implementation complete for the current Desktop marketplace surface.

Delivered:

- Desktop Rust skill marketplace store now persists configured market sources, synced package metadata, and installed-package ledger under the app data storage layout.
- Market index parsing now preserves publisher, homepage, repository, package type, trust level, risk level, source, version, license, author, and keywords.
- Marketplace list/detail responses now expose install state, installed Station skill ID, scan verdict, trust/risk metadata, and package type instead of returning `installed: false` for every package.
- Market install records the Station skill ID after `/agent/skill/install` succeeds, making marketplace install state auditable and reversible.
- Market uninstall calls Station `/agent/skill/delete` and removes the local install ledger, so installed packages can be reversed from the same marketplace UI.
- Desktop marketplace detail UI now shows package type, trust level, risk, scan verdict, publisher, repository, and homepage, and provides uninstall controls for installed packages.

Architecture gate:

| Gate | Answer |
|---|---|
| Source of truth | Market source/sync/installed projection is Desktop Rust local data; installed skill content remains Station `agent_skills` |
| Runtime projection owner | `SkillsTab` marketplace browser projects Desktop Rust market state and reloads installed skills after install/uninstall |
| Local executor | Desktop Rust fetches and parses market index/package content; Station executes skill install/delete policy |
| Station owner | `SkillService` remains authoritative for scan, trust, persistence, and delete of installed skills |
| Protocol | Desktop Web marketplace UI → Tauri skills market commands → Desktop Rust market store/import parser → Station skill install/delete |
| Policy path | Market metadata is informational; Station `SkillsGuardService` is authoritative before content can be enabled |
| Trace path | Desktop Rust persists market install ledger with Station skill ID and scan verdict; Station logs scan/install/delete |
| Reconciliation path | Market store reloads from Desktop storage on process start; UI reloads market list and installed skills after mutations |

Acceptance:

- Done: User can inspect a package before install, including content and trust/risk/source/version metadata.
- Done: Installed package is reversible from marketplace UI and auditable through the persisted market install ledger.

Verification:

```bash
cd apps/desktop && pnpm run check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --bin peers-touch-desktop skills_market::tests -- --test-threads=1
```

### P2-5 Custom Plugin Runtime

Scope:

- Define custom plugin package shape, manifest validation, and runtime constraints.
- Route plugin tool definitions into the same tool policy and approval system.

Status:

- P2-5 implementation complete for a constrained Desktop plugin runtime.

Delivered:

- Added Desktop Rust `application::plugins` package with a persisted plugin store under the app data storage layout.
- Defined a custom plugin manifest shape with `pluginId`, `name`, `description`, `version`, `trustLevel`, `riskLevel`, `source`, and `tools[]`.
- Plugin tool manifests require schema plus an explicit constrained runtime; the initial runtime only supports `{"kind":"static","response":...}` and rejects unsupported runtime kinds such as process/shell execution.
- Plugin tools are projected into the shared `tools_list` registry with `source: "plugin"`, `trustLevel`, `riskLevel`, `needs_approval`, `executionOwner: "desktop-rust"`, schema, and package metadata.
- Agent local tool resolution now accepts `source: "plugin"` and routes execution through the same Desktop Rust local tool bridge used by MCP/builtin tools.
- Plugin execution emits audit metadata including source, plugin ID, tool name, approval requirement, trust level, risk level, execution owner, and execution time.
- Marketplace install/uninstall now branches by `packageType: "plugin"`: plugin packages are manifest-validated into the plugin store instead of being sent to Station as skills, while market install ledger still records the installed package for reversibility.

Architecture gate:

| Gate | Answer |
|---|---|
| Source of truth | Desktop Rust plugin store owns local plugin manifests; Station remains turn owner |
| Runtime projection owner | `tools_list` projects plugin tool descriptors into the same Web tool registry surface |
| Local executor | Desktop Rust plugin runtime executes only constrained manifest runtimes |
| Station owner | Station requests plugin tool calls through the same `local_tool_request` bridge and receives results through `/agent/turn/local-tool-result` |
| Protocol | Market package → Desktop Rust plugin manifest validation → plugin tool registry → Station local tool request → Desktop approval → Desktop plugin execution → Station tool result |
| Policy path | Plugin tools are approval-gated by the existing P1 local tool approval flow before execution |
| Trace path | Plugin execution returns structured audit metadata and participates in existing tool result trace cards |
| Reconciliation path | Plugin store reloads from Desktop storage on process start and `tools_list` reprojects installed plugin tools |

Acceptance:

- Done: Custom plugin cannot bypass tool policy, audit, or trust metadata; arbitrary shell/process plugin runtimes are rejected at manifest validation.

Verification:

```bash
cd apps/desktop && pnpm run check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --bin peers-touch-desktop plugins::tests -- --test-threads=1
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --bin peers-touch-desktop application::agent_turn::tests -- --test-threads=1
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --bin peers-touch-desktop application::tools::tests -- --test-threads=1
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --bin peers-touch-desktop application::skills_market::tests -- --test-threads=1
```



### P2-6 Skill Resource Tree

Scope:

- Show installed skill files/resources with progressive disclosure.
- Allow safe inspection without automatically loading all content into prompts.

Status:

- P2-6 implementation complete for installed Station-backed skills.

Delivered:

- Desktop Rust `skills_get` now returns a `resourceTree` projection for the installed skill content without changing the Station skill source of truth.
- Resource tree includes `SKILL.md`, `SKILL.md#frontmatter`, and `SKILL.md#instructions` nodes with path, kind, role, bytes, line count, sha256, load trigger, and loaded-at-runtime flags.
- Desktop Rust `skills_get` now returns `runtimeLoad` metadata showing that prompt assembly loads only the skill index by default and full `SKILL.md` content only on `skill_view`.
- Desktop Web skill detail dialog now renders a resource panel before manifest/content/raw protocol preview, including system prompt load count, `skill_view` load count, bytes, line count, trigger, and hash.
- Builtin skill details remain supported without pretending they have Station resource tree metadata.

Architecture gate:

| Gate | Answer |
|---|---|
| Source of truth | Station `agent_skills.content` remains the skill source; Desktop only projects resource metadata from returned content |
| Runtime projection owner | Desktop `SkillsTab` owns installed skill resource tree UI projection |
| Local executor | None; resource inspection is read-only UI projection |
| Station owner | Station remains owner of skill persistence and turn-time `skill_view` loading |
| Protocol | Desktop Web `api.getSkill` → Tauri `skills_get` → Station `/agent/skill/get` → Desktop resource projection |
| Policy path | Resource tree inspection does not grant execution or prompt loading; `skill_view` remains the explicit runtime load trigger |
| Trace path | `runtimeLoad` exposes loaded resources, bytes, line count, sha256, version, trust, and scan verdict |
| Reconciliation path | Skill detail reloads through `skills_get`; edits still persist through Station `skills_update` |

Acceptance:

- Done: User can inspect installed skill resources and see that runtime prompt assembly loads only the index until `skill_view` loads `SKILL.md`.

Verification:

```bash
cd apps/desktop && pnpm run check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --bin peers-touch-desktop application::skills::tests -- --test-threads=1
```

### P2-7 Skill Versioning And Rollback UI

Scope:

- Project Station skill versions and rollback operations into Desktop UI.

Status:

- P2-7 implementation complete.

Delivered:

- Desktop Rust now exposes `skills_versions` and `skills_rollback` commands over Tauri and HTTP gateway.
- `skills_versions` calls Station `/agent/growth/skill/versions` and projects `versions`, `total`, and rollback policy metadata for the UI.
- `skills_rollback` calls Station `/agent/growth/skill/rollback`; Station remains the rollback authority and records the current skill content before restore, making rollback reversible.
- Desktop Web skill detail dialog now loads version history for installed skills, shows version number, trigger, timestamp, total count, refresh control, and rollback policy.
- Rollback action requires confirmation, refreshes the skill content/resource tree/version history after success, and does not apply to builtin skills.

Architecture gate:

| Gate | Answer |
|---|---|
| Source of truth | Station `agent_skill_versions` and `agent_skills` remain the source of truth |
| Runtime projection owner | Desktop `SkillsTab` owns version history UI projection |
| Local executor | None; rollback is Station-side mutation |
| Station owner | `SkillService.ListVersions` and `SkillService.RollbackSkill` own version listing and restore semantics |
| Protocol | Desktop Web `api.listSkillVersions/api.rollbackSkill` → Tauri skill commands → Desktop Rust Station JSON client → Station growth skill endpoints |
| Policy path | Rollback is explicit user-confirmed mutation; Station records pre-rollback state first |
| Trace path | Version rows expose version ID, trigger, timestamp, total, and rollback policy |
| Reconciliation path | After rollback, Desktop reloads skill detail and version history through `skills_get` and `skills_versions` |

Acceptance:

- Done: User can view installed skill versions and rollback with confirmation.

Verification:

```bash
cd apps/desktop && pnpm run check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --bin peers-touch-desktop application::skills::tests -- --test-threads=1
```

### P2-8 Agent Package Import / Export / Clone

Scope:

- Export Agent config, provider preset, enabled skills, tools, MCP bindings, opening messages, and chat behavior policy as a package.
- Import package as a new Agent without overwriting existing Agents.
- Clone an Agent locally.

Status:

- P2-8 implementation complete.

Delivered:

- Defined the portable Agent package schema `peers.agent.package.v1`.
- Desktop Rust now exposes `agents_export_package` and `agents_import_package` through Tauri and HTTP gateway.
- Exported packages include Agent profile/config, provider/model preset, params, MCP server bindings, tool bindings, skill bindings, opening message/questions, and chat behavior policy.
- Imported packages always create a new Agent ID and a unique Agent name; existing Agents are never overwritten.
- Clone keeps using local Agent persistence but now has explicit tests proving the cloned Agent has a distinct identity.
- Desktop Agent switcher now exposes import, export, and clone actions; import accepts JSON package files and selects the imported Agent after creation.

Architecture gate:

| Gate | Answer |
|---|---|
| Source of truth | Desktop Rust per-actor Agent store owns local Agent config packages |
| Runtime projection owner | Desktop `useAgentStore` and `AgentSidebar` project import/export/clone into the UI |
| Local executor | Desktop Rust imports/exports local Agent package JSON; no Station mutation is required |
| Station owner | Station remains turn owner; packages only carry local Agent config and binding references |
| Protocol | Desktop Web Agent switcher → Tauri Agent commands → Desktop Rust per-actor Agent store |
| Policy path | Package import generates a new Agent identity and never overwrites existing Agents |
| Trace path | Package schema includes exported timestamp and source Agent ID/name |
| Reconciliation path | After import/clone, Desktop reloads Agents and selects the new Agent |

Acceptance:

- Done: Import/export round trip preserves the supported package fields.
- Done: Clone creates a distinct Agent identity.

Verification:

```bash
cd apps/desktop && pnpm run check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --bin peers-touch-desktop application::agents::tests -- --test-threads=1
```

### P2-9 Default / Inbox Agent

Status: Done.

Scope:

- Define the fallback Agent used when no explicit Agent is selected.
- Keep default behavior visible and configurable.

Implementation:

| Layer | Decision |
| --- | --- |
| Desktop Rust store | Persist `defaultAgent` next to `selectedAgent`; seed `assistant` as the visible default |
| Agent projection | Keep per-Agent `isDefault` synchronized on load, update, delete, import, and clone |
| Command surface | Expose `agents_get_default` and `agents_set_default` through Tauri and HTTP gateway |
| Desktop Web store | Load `defaultAgent` with the Agent list and fall back to it when selected Agent is missing |
| UI | Show the default Agent marker in the Agent picker and provide a set-as-default action |

Acceptance:

- Done: User can identify and configure the default Agent.
- Done: Default Agent persists after cache reset/restart.
- Done: Deleting the default Agent falls back to the remaining first Agent.
- Done: Import and clone do not steal the default slot.

Verification:

```bash
cd apps/desktop && pnpm run check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --bin peers-touch-desktop application::agents::tests -- --test-threads=1
```

### P2-10 Agent Pinning, Favorites, And Ordering

Status: Done.

Scope:

- Support pin/favorite state and stable ordering in Agent list.

Implementation:

| Layer | Decision |
| --- | --- |
| Desktop Rust store | Persist `pinned`, `favorite`, and `sortOrder`; sort pinned first, favorites next, then stable order |
| Update semantics | Merge Agent updates into existing records so UI metadata changes do not erase prompts, model, tools, skills, or bindings |
| Desktop Web API | Project `favorite` and `sortOrder` as first-class Agent fields |
| Agent picker UI | Expose pin/unpin and favorite/unfavorite controls inline; pinned Agents render in the pinned section |

Acceptance:

- Done: Pinned Agents remain in a separate ordered section after restart.
- Done: Favorite state persists and is visible in the Agent picker.
- Done: Partial Agent metadata updates preserve the rest of the Agent package/config.

Verification:

```bash
cd apps/desktop && pnpm run check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --bin peers-touch-desktop application::agents::tests -- --test-threads=1
```

---

## 9. Phase P3 — Agent Settings And UX

Scope:

- Replace overloaded settings modal with modular Agent Profile / Settings surfaces.
- Improve prompt editor, model params, opening message, starter questions, tool/skill binding, thinking display, hotkeys, and trace drawer.

Acceptance:

- Users can configure an Agent without understanding implementation terms.
- Tool, skill, memory, MCP, and provider behavior is visible from one Agent-centered surface.

### P3-1 Agent Profile / Settings Redesign

Status: Done.

Scope:

- Split configuration into overview, prompt, model, runtime, tools, MCP, skills, memory, knowledge, collaboration, and diagnostics.

Implementation:

| Layer | Decision |
| --- | --- |
| Agent Profile page | Expanded the profile surface into overview, prompt, model, runtime, tools, MCP, skills, memory, knowledge, collaboration, and diagnostics tabs |
| Settings visibility | Kept the existing settings modal as an editor, but exposed critical Agent state directly on the Agent-centered profile page |
| Runtime projection | Profile reads Agent `chatConfig`, `params`, tool/MCP/skill bindings, workspace policy, memory, opening prompts, and diagnostics as visible cards |
| Localization | Added English and Chinese labels for all new Agent Profile modules and fields |

Acceptance:

- Done: No Agent-critical setting is hidden inside a generic modal-only flow.
- Done: Tool, skill, memory, MCP, model, workspace, and diagnostics state is visible from the Agent Profile surface.

Verification:

```bash
cd apps/desktop && pnpm run check
```

### P3-2 Prompt Editor

Status: Done.

Scope:

- Add token awareness, variables, preview, and validation.

Implementation:

| Layer | Decision |
| --- | --- |
| Prompt editor | Show estimated prompt tokens next to the editor |
| Variable system | Support `{{agent}}`, `{{user}}`, `{{date}}`, `{{workspace}}`, and `{{model}}` variables |
| Validation | Reject save when unsupported variables are present and show the invalid variable names |
| Preview | Render a resolved prompt preview using current Agent, workspace, model, date, and user placeholders |

Acceptance:

- Done: Invalid prompt variables are shown before save.
- Done: Unsupported variables block autosave and blur-save.
- Done: User can preview variable resolution before saving.

Verification:

```bash
cd apps/desktop && pnpm run check
```

### P3-3 Model And LLM Parameter UX

Status: Done.

Scope:

- Preserve provider/model selection and LLM params while making capability differences visible.

Implementation:

| Layer | Decision |
| --- | --- |
| Agent Profile model tab | Keep provider/model selection and current LLM params visible in one place |
| Capability matrix | Show tools, vision, reasoning, streaming, and context-window support from selected model metadata |
| Localization | Added English and Chinese labels for model capability cards |

Acceptance:

- Done: User can see which model/provider supports tools, vision, reasoning, streaming, and context size.

Verification:

```bash
cd apps/desktop && pnpm run check
```

### P3-4 Thinking, Trace, Memory, And Provider Diagnostics

Status: Done.

Scope:

- Render reasoning, memory usage, compression, provider fallback, errors, and delegation in message-level and turn-level diagnostics.

Implementation:

| Layer | Decision |
| --- | --- |
| Assistant message UI | Added an expandable diagnostics panel for assistant turns |
| Thinking trace | Render streamed thinking content and completion state when present |
| Provider diagnostics | Show provider/model, duration, and error summaries without requiring logs |
| Runtime diagnostics | Show tool count, pending/failed tool count, memory state, and compression state |

Acceptance:

- Done: A failed or degraded turn can be explained from the UI without reading logs.

Verification:

```bash
cd apps/desktop && pnpm run check
```

### P3-5 Opening Message And Starter Questions

Status: Done.

Scope:

- Add per-Agent opening message and starter questions.

Implementation:

| Layer | Decision |
| --- | --- |
| Source of truth | Agent `openingMessage` and `openingQuestions` remain Agent profile state projected into Desktop Web |
| Runtime projection owner | `useAgentStore` owns the selected Agent list/projection; `ChatPage` only renders the current empty-session projection |
| Welcome rendering | Empty conversations prioritize trimmed Agent opening message, then Agent description, then localized fallback |
| Starter parsing | Starter questions accept persisted JSON arrays, tolerate legacy newline text, remove empty entries, de-duplicate, and cap visible actions |
| Default fallback | Agents without starter questions keep localized default quick actions |

Acceptance:

- Done: New conversations show Agent-specific opening copy and starter question actions.

Verification:

```bash
cd apps/desktop && pnpm run check
```

### P3-6 AI-Assisted Agent Metadata

Status: Done.

Scope:

- Generate Agent name, description, tags, starter questions, and prompt suggestions from user intent.

Implementation:

| Layer | Decision |
| --- | --- |
| Source of truth | Agent metadata remains persisted through Desktop Rust `agents_update` |
| Runtime projection owner | `useAgentStore` reloads and projects the updated Agent list after save |
| Generation path | Agent Profile invokes the existing Desktop AI stream bridge for an `agent-builder` scoped metadata draft |
| Preview gate | Generated title, description, tags, opening message, starter questions, and system prompt render as a draft first |
| Save gate | No generated metadata is persisted until the user clicks Apply |

Acceptance:

- Done: Generated metadata is previewed and user-approved before save.

Verification:

```bash
cd apps/desktop && pnpm run check
```

### P3-7 Chat Behavior Config

Status: Done.

Scope:

- Expose history window, compression policy, memory policy, tool policy, and provider fallback policy.

Implementation:

| Layer | Decision |
| --- | --- |
| Source of truth | Agent `chatConfig`, `toolsProfile`, `toolsAllow`, and `toolsDeny` remain persisted through Desktop Rust Agent storage |
| Runtime projection owner | `useAgentStore` projects Agent config into Agent Profile and Chat turn setup |
| Settings UX | Agent settings chat tab exposes streaming, history window, context compression, context window, search, memory effort, tool policy, workspace, and provider recovery |
| Turn protocol | Chat store forwards Agent `contextWindowSize` and provider recovery retry count into Station turn input |
| Pre-turn visibility | Agent Profile runtime tab summarizes context, memory, provider fallback, and tool policy before starting a turn |

Acceptance:

- Done: User can understand what context the Agent will use before starting a turn.

Verification:

```bash
cd apps/desktop && pnpm run check
```

### P3-8 Portal / Notebook / Saved Message Panel

Status: Done.

Scope:

- Make saved messages, notes, and useful turn outputs accessible from a side panel.

Implementation:

| Layer | Decision |
| --- | --- |
| Source of truth | Notebook documents remain persisted by Desktop Rust notebook commands |
| Runtime projection owner | `useChatStore` owns current topic portal documents and refreshes after mutations |
| Saved output path | Message actions save assistant outputs and tool context into the current topic notebook |
| Side panel path | Saving a message opens the Notebook portal so the result is immediately inspectable |
| Reuse path | Document editor can send the saved notebook page back into the current chat as explicit context |

Acceptance:

- Done: User can save, inspect, and reuse Agent outputs.

Verification:

```bash
cd apps/desktop && pnpm run check
```

### P3-9 Agent List UX

Status: Done.

Scope:

- Improve Agent list/sidebar with pinned section, default Agent, search, marketplace entry, and status badges.

Implementation:

| Layer | Decision |
| --- | --- |
| Source of truth | Agent ordering, default state, pinning, favorite state, and runtime config remain Agent store data |
| Runtime projection owner | `useAgentStore` projects Agent list metadata into the sidebar picker |
| List UX | Sidebar preserves search, pinned ordering, default Agent marker, pin/favorite controls, import/export, clone, and create actions |
| Marketplace entry | Sidebar exposes a marketplace entry that routes to the skills/marketplace surface |
| Status badges | Agent rows show runtime indicators for memory, tools, and workspace readiness |

Acceptance:

- Done: User can switch Agents directly and understand runtime status.

Verification:

```bash
cd apps/desktop && pnpm run check
```

### P3-10 Rich Chat Input

Status: Done.

Scope:

- Support commands, mentions, context references, drag/drop, paste, and attachment previews.

Implementation:

| Layer | Decision |
| --- | --- |
| Source of truth | Composer state remains local UI state until send; attachments remain uploaded through the existing Desktop attachment pipeline |
| Runtime projection owner | `ChatInput` owns transient input, per-topic drafts, and selected structured references |
| Attachments | Existing drag/drop, paste, upload, retry, and attachment preview behavior is preserved |
| Commands | `/` opens command suggestions for search, memory, and tool-directed turns |
| Mentions and references | `@` suggests Agents and `#` suggests recent messages; selected entries become visible chips and structured context in the sent message |

Acceptance:

- Done: Composer can produce structured input events for files, images, commands, and references.

Verification:

```bash
cd apps/desktop && pnpm run check
```

### P3-11 Code Block Rendering

Status: Done.

Scope:

- Add syntax highlighting, copy, collapse, and safe run/export actions where policy allows.

Implementation:

| Layer | Decision |
| --- | --- |
| Rendering | Assistant Markdown keeps LobeUI full-featured syntax highlighting and code block collapse |
| Copy | Code blocks keep LobeUI block-level copy, so users do not need manual text selection |
| Export | Code blocks can be exported as a downloaded text file with language-derived extension |
| Safe run | Code blocks can be sent back into chat as a tool-directed prompt; Station turn ownership and Desktop Rust local tool approval remain the execution gate |
| i18n | Code block action labels, exported toast, run prompt, and collapsed message text are localized |

Acceptance:

- Done: Code blocks are usable without manual text selection, can be collapsed, copied, exported, or routed through the existing safe tool execution path.

Verification:

```bash
cd apps/desktop && pnpm run check
```

### P3-12 Hotkeys

Status: Done.

Scope:

- Add global and composer hotkeys for search, send, new chat, switch Agent, toggle portal, and command palette.

Implementation:

| Layer | Decision |
| --- | --- |
| Global owner | `AppSideNav` owns application-level hotkeys because it already has navigation, Agent, and chat store context |
| Command palette | Side nav exposes a discoverable command palette with search, new chat, next Agent, portal toggle, notes, and settings commands |
| Conflict policy | Global hotkeys ignore input, textarea, select, and contenteditable targets so text entry keeps ownership |
| Composer | `ChatInput` keeps Enter send / Shift+Enter newline behavior and exposes it in the placeholder |
| Navigation | The previous `useNavigation` `Cmd/Ctrl+K` listener was removed to avoid duplicate global hotkey handling |
| i18n | Command labels, descriptions, empty state, palette title, and composer hint are localized |

Acceptance:

- Done: Hotkeys are discoverable through the command palette and side-nav keyboard entry, while global handlers do not intercept text input.

Verification:

```bash
cd apps/desktop && pnpm run check
```

### P3-13 Agent Workbench UX Convergence

Status: Active.

Scope:

- Convert the first visible Agent creation/editing path from a plain form drawer into an Agent Workbench onboarding surface.
- Make the empty Agent chat state communicate Agent identity, model/runtime readiness, tool access, memory, workspace, and knowledge status before the first turn.
- Keep the change inside Desktop Web projection surfaces. No Station, Desktop Rust, proto, or persistence ownership changes are introduced by this UX convergence slice.

Implementation:

| Layer | Decision |
| --- | --- |
| Agent creation entry | `AgentSettingsDrawer` becomes a guided Workbench surface with hero preview, starter templates, grouped tabs, capability cards, and the same existing `AgentCreate` / `updateAgent` persistence path |
| Post-create flow | Saving an Agent selects it and lands on the Agent Profile so users continue into tools, MCP, knowledge, diagnostics, and a test run instead of falling back to a closed drawer |
| Agent Profile Workbench | `AgentProfilePage` becomes the task hub with readiness signals, delivery checklist, direct tab routing, settings, avatar edit, and launch action above the detailed configuration tabs |
| Agent chat empty state | `ChatPage` welcome state becomes an Agent-centered launch surface with runtime capability cards and starter actions |
| Launch surface continuity | The empty chat launch surface links back to Agent Profile, keeping configuration and conversation connected as one workflow |
| Builder Workbench linkage | `AgentProfilePage` sends the current Agent identity, active tab, readiness signals, checklist progress, runtime capabilities, workspace state, and bindings into `BuilderPanel`; the panel shows a compact context summary and asks `agent-builder` for checklist-aware configuration advice |
| Builder context navigation | Each Builder context summary item carries a `targetTab`; clicking it routes the left Profile to the matching configuration tab, and the checklist item jumps to the first incomplete delivery step so advice and configuration share one focus |
| Markdown performance boundary | Markdown rendering is routed through a local Desktop wrapper and Vite manual chunks separate LobeUI, Markdown core, syntax, and Mermaid visualization dependencies from the application entry chunk |
| Runtime ownership | Existing `useAgentStore` and `useChatStore` remain projection owners; the new UI does not introduce a page-local business source of truth |
| Localization | All visible Workbench and launch-surface copy is added to `packages/locales/*/{agent,chat}.json` |

Acceptance:

- Done: Creating an Agent no longer presents a 1990s-style single-column form as the primary experience.
- Done: Saving an Agent lands users in the Agent Profile instead of ending the workflow at a closed modal.
- Done: Agent Profile exposes model runtime, tools/MCP, knowledge context, diagnostics, and launch readiness as a single Workbench surface.
- Done: The empty chat surface visibly communicates what the selected Agent can do before the user sends the first message.
- Done: Users can jump from the chat launch surface back to the Agent Profile to continue configuration.
- Done: Agent Builder is no longer context-free inside the Profile; it receives Workbench state and can answer against the current checklist, focused tab, runtime, and bindings.
- Done: Builder context summary items are actionable; clicking a summary item focuses the matching Profile configuration tab so the user can act on advice without hunting for the setting.
- In progress: Build chunking isolates Markdown and visualization dependencies; final chunk-size acceptance requires a stable local build run.
- Pending: Browser screenshot review against the LobeHub-level visual benchmark.

Verification:

```bash
cd apps/desktop && pnpm run check
```

---

## 10. Phase P4 — Knowledge, Artifacts, Marketplace

Scope:

- Bind knowledge resources to Agents.
- Inject retrieved context by policy.
- Render artifacts as first-class outputs.
- Add Agent/MCP marketplace with trust/risk metadata.

Acceptance:

- Agent can use bound knowledge and show which resources were used.
- Marketplace install flow is explicit and reversible.

### P4-1 Knowledge Resource Binding

Status: Done.

Scope:

- Upload or bind documents, folders, projects, URLs, notebooks, and other resources to Agents.

Implementation:

| Layer | Decision |
| --- | --- |
| Proto source | Added `KnowledgeResource`, type, policy, and status enums to `model/domain/agent/agent.proto` |
| Generated contracts | Regenerated Go and Desktop TS proto outputs with `./model/build.sh` |
| Agent source of truth | Agent records now preserve `knowledgeResources` JSON in Desktop Rust durable agent storage |
| Desktop API | Added typed knowledge resource parsing and `knowledgeResources` update support |
| Desktop UI | Agent Profile Knowledge tab can bind and remove document, folder, project, URL, notebook, and workspace resources |
| Projection | Bound resources show type, source, policy, status, and last indexed time; status defaults to `bound` until P4-2 indexing runs |
| Boundary | P4-1 does not perform chunking, embedding, retrieval, or injection; those remain P4-2 responsibilities |

Acceptance:

- Done: Bound resources show source, policy, status, and last indexed time.

Verification:

```bash
cd apps/desktop && pnpm run check
./model/build.sh
cd apps/station/app && gofmt -l subserver/agent/model/agent.pb.go && go test ./subserver/agent/...
git diff --check
```

Note:

- The documented broad command `cd apps/station && gofmt -l . && go test ./...` is currently blocked by existing unrelated formatting output and the active root `go.work` selection; the narrowed generated-agent package check above passes.

### P4-2 Retrieval, Chunking, Embedding, And Injection

Status: Done.

Scope:

- Chunk, embed, retrieve, and inject knowledge resources according to Agent policy.

Implementation:

| Layer | Decision |
| --- | --- |
| Proto source | Added `KnowledgeChunkReference` and `ExecuteTurnRequest.knowledge_resources` to `model/domain/agent/agent.proto` |
| Desktop Web | Chat turn input now maps the selected Agent's enabled `knowledgeResources` into the turn payload |
| Desktop Rust | `AgentExecuteTurnInput` forwards `knowledge_resources` unchanged to Station for both normal and streaming turns |
| Station request owner | `TurnHandlers` converts proto knowledge resources into domain resources before invoking `TurnService` |
| Retrieval owner | Station owns deterministic retrieval through `KnowledgeRetrievalService`: load resource content, split into overlapping chunks, build hash embeddings, rank by cosine plus keyword overlap |
| Prompt assembly | `PromptAssemblyService` injects retrieved chunks as a dedicated `<knowledge_context>` layer before workspace context files |
| Diagnostics | `TurnTrace` persists `knowledge_chunks`, streaming turns emit `knowledge_retrieved`, and Desktop diagnostics show the retrieved chunk count, titles, indexes, and scores |
| Policy | Disabled resources are skipped; document, folder, project, workspace, notebook, and URL resources are supported with bounded content loading |

Acceptance:

- Done: Turn diagnostics show which knowledge chunks were used.

Verification:

```bash
./model/build.sh
cd apps/station/app && go test ./subserver/agent/...
cd apps/desktop && pnpm run check
cd apps/desktop/src-tauri && source ~/.cargo/env && cargo check
```

### P4-3 Agent / MCP / Skill Marketplace

Status: Done.

Scope:

- Provide curated discovery and install flows for Agents, MCP servers, and skills.

Implementation:

| Layer | Decision |
| --- | --- |
| Marketplace model | Reused the existing Desktop Rust market store instead of creating a parallel marketplace |
| Package taxonomy | Market entries now install `skill`, `plugin`, `agent`, and `mcp` package types from the same index |
| Agent package install | `packageType=agent` imports a `peers.agent.package.v1` payload through Desktop Agent package import under the active actor scope |
| MCP package install | `packageType=mcp` installs an MCP server config through the existing MCP server store, preserving stdio/http/sse support |
| Reversibility | Market uninstall removes installed skills from Station, plugins from the plugin runtime, imported Agents from the Agent store, and MCP servers from the MCP store |
| Ledger | Market install records now preserve package type, installed id, source, scan verdict, and installed timestamp |
| UI | Marketplace cards and detail views show package type, publisher/source metadata, version, trust level, risk level, and install state |
| Entry copy | Marketplace text now refers to packages instead of skill-only collections |

Acceptance:

- Done: Marketplace entries show publisher, source, version, trust, and risk metadata and support Agent/MCP/Skill/Plugin install and uninstall flows.

Verification:

```bash
cd apps/desktop && pnpm run check
cd apps/desktop/src-tauri && source ~/.cargo/env && cargo check
cd apps/desktop/src-tauri && source ~/.cargo/env && cargo test market_index_parser
```

### P4-4 Artifacts

Status: Done.

Scope:

- Render generated documents, code, diagrams, and structured outputs as first-class artifacts.

Implementation:

| Layer | Decision |
| --- | --- |
| Source of truth | Station remains the durable owner of conversations/messages; Desktop Web derives transient artifacts from assistant message content |
| Desktop model | Added `MessageArtifact` and `extractMessageArtifacts` in `apps/desktop/src/store/chat.ts` for code, document, diagram, and structured output artifacts |
| Message surface | Assistant messages now render first-class artifact cards with artifact type, language, source message id, open, copy, and export actions |
| Artifact panel | `ChatPage` owns the active artifact preview panel; artifacts open in a right-side panel without introducing a new page or long-lived projection |
| Provenance | Each artifact carries `messageId`, stable derived id, source range where available, and the preview panel can jump back to the generating message |
| Export/copy | Artifact copy uses clipboard; artifact export writes a local text file with a type-aware extension |
| i18n | Artifact card, panel, toast, type, and action labels are localized in `packages/locales/*/chat.json` |
| Tests | Added `chatArtifacts.test.ts` to cover fenced code/diagram/structured artifacts, markdown document promotion, and user-message exclusion |

Architecture gate:

| Gate | Answer |
| --- | --- |
| Source of truth | Station message content and trace remain durable truth; Desktop Web only derives view artifacts from rendered assistant messages |
| Runtime projection owner | Current `chat.ts` message projection owns the in-memory message list; artifacts are deterministic per-message derivations, not separate business state |
| Local executor | None for artifact extraction; export uses browser download only and does not execute device-privileged actions |
| Station owner | Existing Station turn/message persistence remains owner; P4-4 does not add Station artifact storage |
| Protocol | Existing Desktop Web message projection; no new proto/domain contract needed because artifacts are derived from already-persisted message content |
| Policy path | No tool execution policy applies; existing code-run action still routes through the safe local tool prompt path |
| Trace path | Artifact provenance links to the generating message; turn diagnostics remain unchanged |
| Reconciliation path | Reloaded messages re-derive the same artifacts deterministically from message content |

Acceptance:

- Done: Artifacts can be opened in a right-side panel, copied/exported, and linked back to the generating message.

Verification:

```bash
cd apps/desktop && pnpm vitest run src/store/chatArtifacts.test.ts
cd apps/desktop && pnpm run check
cd apps/desktop && pnpm run build
git diff --check
```

### P4-5 Agent Sharing

Status: Done.

Scope:

- Share Agent package or preset with policy-controlled export.

Acceptance:

- Shared package excludes secrets and records source metadata.

Implementation:

- Desktop Rust `agents_export_package` now accepts `includeLocalPaths` and exports `peers.agent.package.v1` with source metadata, share policy, and redaction records.
- Share-safe export redacts secret-like values from Agent data, provider params, and chat behavior, strips local workspace paths by default, and keeps only shareable knowledge resources.
- Desktop Web exposes Agent Profile sharing actions for default share-safe export and explicit local-path export.

Verification:

```bash
cd apps/desktop/src-tauri && source ~/.cargo/env && cargo test agent_package
cd apps/desktop/src-tauri && source ~/.cargo/env && cargo check
cd apps/desktop && pnpm run check
cd apps/desktop/src-tauri && source ~/.cargo/env && cargo fmt
git diff --check
```

### P4-6 Delegation / Multi-Agent UI

Status: Done.

Scope:

- Surface Station delegation and child Agent results in Desktop UI.

Acceptance:

- Parent turn shows child tasks, status, outputs, and failures.

Implementation:

- Desktop reuses Station's existing `delegate_task` turn tool path instead of adding a parallel delegation API.
- `delegate_task` tool results are parsed into structured child task diagnostics with task id, parent turn id, description, child toolset, status, result summary, and tool iteration count.
- Parent assistant messages render child Agent tasks in the tool-call detail view and summarize delegation status in the turn diagnostics panel.
- Failed and timed-out child tasks are visible both in the child-task block and in the diagnostics failure count.

Verification:

```bash
cd apps/desktop && pnpm vitest run src/store/chatDelegation.test.ts
cd apps/desktop && pnpm run check
git diff --check
```

---

## 11. Phase P5 — Voice, Connectors, And Advanced Parity

P5 contains LobeHub Agent-related capabilities that depend on the earlier runtime, tool, skill, knowledge, and settings foundations. These are mandatory parity tasks, not optional backlog.

### P5-1 TTS / STT

Status: Done.

Scope:

- Add voice input, voice output, and per-Agent voice configuration.

Acceptance:

- User can speak to an Agent and play assistant output where provider support exists.

Implementation:

- `AgentChatConfig` now carries per-Agent voice settings for TTS provider, TTS voice, TTS speed, auto-read, STT provider, STT language, and STT auto-stop.
- Agent settings expose voice input/output controls under Chat Preferences and persist them through the existing Agent `chatConfig` update path.
- AI ChatInput uses the active Agent voice config for browser speech recognition language and final-result auto-stop; unavailable non-browser STT providers are surfaced as a localized runtime limitation.
- Assistant messages use the active Agent voice config for browser speech synthesis voice/rate, provider-backed TTS through the existing Desktop API, and optional auto-read after the response completes.

Verification:

```bash
cd apps/desktop && pnpm run check
git diff --check
```

### P5-2 Realtime Gateway Upgrade

Status: Done.

Scope:

- Decide whether true bidirectional gateway behavior is required beyond P0 streaming.

Acceptance:

- If required, gateway lifecycle, reconnect, backpressure, and auth behavior are documented and tested.

Decision:

- No true bidirectional transport upgrade is required for the Agent rebuild. The canonical realtime architecture keeps one SSE egress stream and uses authenticated HTTP POST ingress; it explicitly rejects WebSocket or JSON-RPC-over-SSE back-channels.
- Agent turn streaming remains a per-turn SSE stream because turn deltas are ephemeral UI delivery, not durable cross-device realtime state. Durable realtime state continues to use `docs/architecture/realtime/event-stream.md`.

Implementation:

- Desktop Web now predeclares an Agent turn stream id, registers the Tauri event listener first, and passes that stream id into Desktop Rust before the Station turn stream starts.
- Desktop Rust accepts the caller-provided stream id and falls back to a generated id for compatibility.
- This closes the early-frame listener race without changing the approved SSE-egress / HTTP-ingress architecture.

Verification:

```bash
cd apps/desktop && pnpm run check
cd apps/desktop/src-tauri && source ~/.cargo/env && cargo check
cd apps/desktop/src-tauri && source ~/.cargo/env && cargo test agent_turn --quiet
cd apps/desktop/src-tauri && source ~/.cargo/env && cargo fmt
git diff --check
```

### P5-3 Heterogeneous Agent / CLI Provider

Status: Done.

Scope:

- Support CLI-wrapped or remote heterogeneous Agents with explicit capability degradation.

Acceptance:

- UI shows which capabilities are native, partial, or unavailable.

Implementation:

- Desktop preserves provider-advertised capability metadata when flattening available models, including tool calling, vision, reasoning, search, image output, video, and protocol override.
- Agent Profile now includes a runtime compatibility panel that classifies chat, tools, vision, search, and voice as native, partial, or unavailable for the selected Agent/model/runtime pair.
- Partial degradation is explicit: for example, local Desktop/MCP/skill tool bindings can partially cover a model without native function calling, and tool-backed search can partially cover models without native search.
- This phase exposes capability degradation in UI without changing Station provider ownership; Station/Desktop provider source-of-truth unification remains a separate architecture landing task.

Verification:

```bash
cd apps/desktop && pnpm run check
git diff --check
```

### P5-4 OAuth Connectors

Status: Foundation Done; provider resource adapters pending.

Scope:

- Connect external services through OAuth-backed connectors.

Acceptance:

- Connector credentials are never exposed to prompts or logs.
- OAuth-backed connector access follows the Station turn owner / Desktop Rust local executor architecture.
- OAuth connector tool calls require the same approval and audit pipeline as other Desktop-local tools.
- Provider-specific resource adapters must use explicit token leases and per-resource scope policy before this phase is considered feature-complete.

Implementation:

- Station registers `oauth_connector_call` as a schema-first tool and routes it through the existing `local_tool_request` bridge instead of executing credential-adjacent work inside Station.
- Desktop Rust implements `oauth_connector_call` as an approval-required builtin local tool with safe resources:
  - `connections.list`
  - `connection.status`
  - `connection.profile`
- OAuth connector output uses a safe connection DTO and recursively redacts secret-like keys such as `token`, `access_token`, `refresh_token`, `client_secret`, `private_key`, `password`, and `credential`.
- The existing `oauth2_call_resource` command now delegates to the same safe connector execution path instead of echoing raw params.
- Redaction now uses the shared Desktop Rust security policy in `apps/desktop/src-tauri/src/application/security.rs`, not per-module copies.

Remaining architecture work:

- Add an OAuth token lease abstraction that exposes only scoped, time-bound connector access to resource adapters.
- Add provider resource adapters behind `oauth_connector_call` instead of expanding ad hoc resource strings.
- Add per-resource scope checks before any adapter can call an external service.

Verification:

```bash
cd apps/desktop/src-tauri && cargo fmt
gofmt -w apps/station/app/subserver/agent/service/tool_registry_service.go apps/station/app/subserver/agent/service/turn_service.go apps/station/app/subserver/agent/service/turn_event_test.go
cd apps/desktop/src-tauri && cargo test oauth_connector --quiet
cd apps/desktop/src-tauri && cargo test builtin_registry_exposes_policy_metadata --quiet
cd apps/station && go test ./app/subserver/agent/service -run 'Test(IsDesktopLocalBuiltinTool|DesktopLocalBuiltinToolUsesLocalBridge)'
cd apps/desktop/src-tauri && cargo check
cd apps/desktop && pnpm run check
git diff --check
```

### P5-5 Third-Party Connector Framework

Status: Done.

Scope:

- Provide a Composio-like integration point only if it fits Peers-Touch governance and federation rules.

Acceptance:

- Third-party connectors use the same tool policy, approval, and audit pipeline.
- Third-party connectors do not gain arbitrary local process execution.
- Secret-like arguments and JSON response fields are redacted before becoming tool results.

Implementation:

- Extended the existing Desktop plugin framework instead of introducing a separate connector executor.
- Added a constrained plugin runtime:
  - `kind: "static"` remains supported for deterministic packaged tools.
  - `kind: "http"` supports bounded `GET` / `POST` HTTPS connector calls from Desktop Rust; `http` is limited to loopback development fixtures.
- Plugin tools continue to project into the shared tool registry as `source: "plugin"`, `executionOwner: "desktop-rust"`, `needs_approval`, `riskLevel`, and `trustLevel`.
- Agent turn execution still flows through Station `local_tool_request` → Desktop Rust approval → plugin execution → Station local tool result submission.
- Direct frontend tool execution now recognizes `plugin` source and calls the same local tool resolver rather than misrouting plugin tools as MCP tools.
- HTTP connector runtime validates URL/header/status policy and redacts secret-like request arguments and JSON response fields before audit/result serialization.
- Connector policy denies inline secret-like headers, URLs with embedded credentials, non-loopback `http`, private/metadata IP targets, and non-2xx responses.

Verification:

```bash
cd apps/desktop/src-tauri && cargo fmt
cd apps/desktop/src-tauri && cargo test plugin_http_connector --quiet
cd apps/desktop/src-tauri && cargo test redacts_secret_like_keys_recursively --quiet
cd apps/desktop/src-tauri && cargo test plugin_tools_project_policy_metadata_and_execute_with_audit --quiet
cd apps/desktop/src-tauri && cargo check
cd apps/desktop && pnpm run check
git diff --check
```

### P5-6 Developer Diagnostics

Status: Done.

Scope:

- Add store/runtime devtools, trace export, and replay diagnostics for Agent turns.

Acceptance:

- Developers can reproduce a turn from exported trace without hidden local state.

Implementation:

- Added a Desktop-side `AgentTurnDiagnosticsExport` JSON format under `apps/desktop/src/diagnostics/` for reviewable turn replay evidence.
- Diagnostics export can build an export from the current session containing:
  - replay input (`agentId`, `agentName`, provider/model, workspace root, retry/context settings, knowledge resources, latest user input, attachments);
  - Agent binding summary (tools, skills, MCP servers, knowledge resource count);
  - message timeline with tool calls, knowledge chunks, errors, and latest assistant diagnostics;
  - artifact, delegation, and process-duration evidence for the latest assistant message;
  - explicit notes for intentionally excluded hidden local state.
- Tool call arguments/results are recursively redacted through the shared TypeScript security policy in `apps/desktop/src/security/redaction.ts`.
- Agent runtime replay config mapping is shared through `apps/desktop/src/services/agent-runtime-config.ts` instead of being duplicated inside chat state.
- Agent Profile diagnostics tab now exports the current turn diagnostics JSON from the UI.

Verification:

```bash
cd apps/desktop && pnpm vitest run src/store/chatDiagnostics.test.ts
cd apps/desktop && pnpm run check
git diff --check
```

---

## 12. Verification Matrix

| Area | Command / Evidence |
|---|---|
| Desktop TypeScript | `cd apps/desktop && pnpm run check` |
| Desktop Rust | `cd apps/desktop/src-tauri && cargo check --quiet` |
| MCP unit/E2E fixtures | `cd apps/desktop/src-tauri && cargo test --bin peers-touch-desktop mcp -- --test-threads=1` |
| Locale JSON | `python3 -m json.tool packages/locales/en/provider.json` and `zh-CN/provider.json` |
| Station | `cd apps/station && gofmt -l . && go test ./...` when Station code changes |
| Browser smoke | Start Desktop Web and verify MCP/Agent settings routes with browser tooling |

---

## 13. Documentation Rules For This Demand

Every phase that changes architecture, user-visible capability, module boundaries, API contracts, or persistence must update:

- This execution plan.
- [Agent LobeHub Blueprint Rebuild](../agent-lobehub-blueprint.md) if the target design changes.
- The nearest directory `README.md` if file ownership, APIs, or conventions change.
- `docs/knowledge/` if the change creates a reusable invariant, pitfall, or playbook.

`.trae/documents/` may contain working drafts only. It must not be the only record for a module-level demand.
