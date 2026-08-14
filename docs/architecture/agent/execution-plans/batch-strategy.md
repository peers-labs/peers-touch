# Agent LobeHub-Parity — Batch Strategy

> **Status**: active
> **Created**: 2026-08-13
> **Source**: `docs/architecture/agent/lobehub-feature-topology.md`
> **Purpose**: Define the formal batch decomposition for the full LobeHub-parity rebuild.
> Each L2/L3 node from the topology is assigned to a batch with priority rationale.

---

## Batch Definitions

| Batch | Name | Theme | Gate |
|-------|------|-------|------|
| **P0** | Core Chat Loop | One user, one agent, complete conversation cycle | ✅ complete |
| **P1** | Tool & Knowledge | Agent uses tools, retrieves knowledge, retains memory | ✅ complete |
| **P2** | Rich Rendering & Productivity | Markdown, code blocks, TTS, image gen, export, templates | ✅ complete |
| **P3** | Multi-Agent & Ecosystem | Agent groups, marketplace, plugins, evaluation | ✅ complete |
| **P4** | Infrastructure Deepening & Power Features | Task system, TTS, session groups, file integration, connectors, command menu, terminal, intervention, multi-transport, localStorage→Station | — |

---

## P0 — Core Chat Loop (COMPLETE)

Covered topology nodes:
- `store/chat/slices/agentRun` (entries, controls, lifecycle, state, transports — streaming subset)
- `store/chat/slices/message` (core CRUD, optimistic, server reconciliation)
- `store/chat/slices/operation` (operation FSM)
- `store/chat/slices/topic` (create, rename, delete, pin, favorite, search)
- `store/agent/slices/agent` (config, system prompt)
- `store/aiInfra/slices/aiModel` + `aiProvider` (provider management, credentials)
- `features/ChatInput` (composer, action bar, file upload, model picker)
- `features/AgentSetting` (system prompt editor, knowledge binding UI)
- `features/AgentSidebar/Topic` (sidebar list, context menu, search)

Execution plan: `execution-plans/p0-core-chat-loop.md`

---

## P1 — Tool & Knowledge

### Scope

| # | Module | Topology Source | Depends On |
|---|--------|----------------|------------|
| 1 | **Tool Execution Runtime** | `store/tool/slices/builtin` (DALL-E, web browse, file operations) + `store/chat/slices/builtinTool` | P0 streaming (tool_call/tool_result events) |
| 2 | **MCP Plugin System** | `store/tool/slices/mcpStore` + `features/MCP` (MCPServerList, MCPToolList, MCPServerModal) | Tool runtime |
| 3 | **Knowledge Base** | `store/library` (CRUD, content, ragEval) + `store/file` (upload, chunking) + `store/agent/slices/knowledge` | P0 agent config |
| 4 | **User Memory** | `store/userMemory` (identity, activity, context, experience, preference, agent-specific) | P0 conversation lifecycle |
| 5 | **Portal / Side Panel** | `store/chat/slices/portal` + `features/Portal` (ToolUI, Artifacts, Thread, AgentInfo) | Tool runtime + Knowledge |

### Priority Rationale

Tools are the #1 capability gap vs LobeHub — without tools, the agent is a text-only chatbot. Knowledge/RAG is #2 because it enables domain-specific answers. Memory is #3 because it makes the agent feel persistent. Portal is #4 as the rendering surface for tool/knowledge results.

### Dependency Order

```
1. Tool Execution Runtime     ← must exist before MCP or Portal
2. MCP Plugin System          ← extends tool runtime with external tools
3. Knowledge Base             ← independent of tools, but Portal renders both
4. User Memory                ← independent, consumed by system prompt injection
5. Portal / Side Panel        ← needs tools + knowledge to have content to show
```

---

## P2 — Rich Rendering & Productivity

### Scope

| # | Module | Topology Source | Depends On |
|---|--------|----------------|------------|
| 1 | **Markdown Rendering** | `features/Conversation/Markdown/plugins/` (18 plugins: code, mermaid, math, table, thinking, image, video, search, artifact, todo, lobeArtifact, rehypeFootnotes, etc.) | P0 message display |
| 2 | **TTS / STT** | `store/chat/slices/tts` + `features/ChatInput/ActionBar/STT` | P0 message + audio infrastructure |
| 3 | **Image Generation** | `store/image` (createImage, generationBatch, generationConfig, generationTopic) | P1 tool runtime (DALL-E built-in) |
| 4 | **Video Generation** | `store/video` (createVideo, generationBatch, config, topic) | P1 tool runtime |
| 5 | **Translation** | `store/chat/slices/translate` | P0 message actions |
| 6 | **Message Forward / Export** | `store/chat/slices/forward` + `features/MessageForward` | P0 message management |
| 7 | **Task Management** | `store/task` (config, detail, lifecycle, list) + `features/AgentTasks` | P0 session management |
| 8 | **Follow-up Suggestions** | `store/followUpAction` + `features/FollowUp` | P0 streaming (done event) |
| 9 | **Thread (Sub-conversations)** | `store/chat/slices/thread` + `features/Portal/Thread` | P0 branching |
| 10 | **Virtualized Chat List** | `features/Conversation/ChatList` (with virtua) | P0 message list |

### Priority Rationale

Markdown rendering is the highest-impact visual quality improvement. TTS/Image/Video add multimodal capability. The rest are productivity features that improve daily usage but don't block core functionality.

---

## P3 — Multi-Agent & Ecosystem

### Scope

| # | Module | Topology Source | Depends On |
|---|--------|----------------|------------|
| 1 | **Agent Groups** | `store/agentGroup` (CRUD, member management) + multi-agent orchestration in `store/chat/slices/aiAgent` | P1 tool runtime (delegation as tool) |
| 2 | **Marketplace / Discovery** | `store/discover` (assistants, plugins, models, providers market) | P1 MCP + P0 agent config |
| 3 | **Custom Plugins** | `store/tool/slices/customPlugin` + `slices/connector` | P1 MCP system |
| 4 | **Evaluation System** | `store/eval` (dataset CRUD, records, RAG eval) | P1 knowledge base |
| 5 | **Notebook / Pages** | `store/notebook` + `store/page` + `store/document` | P1 knowledge |
| 6 | **Home Page** | `store/home` (agentList, group, homeInput, recent, sidebarUI) | All of the above |
| 7 | **Topic Comments** | `store/topicComment` | P0 topics |
| 8 | **Mentions** | `store/mention` | P3 agent groups |

### Priority Rationale

Multi-agent and marketplace are the ecosystem play — they make the platform extensible beyond single-user/single-agent. These depend on having a solid tool and knowledge layer first.

---

## Tracking

| Batch | Modules | Status | Execution Plan |
|-------|---------|--------|----------------|
| P0 | 6 | ✅ complete | `execution-plans/p0-core-chat-loop.md` |
| P1 | 5 | ✅ complete | `execution-plans/p1-tool-knowledge.md` |
| P2 | 10 | ✅ complete | `execution-plans/p2-rich-rendering.md` |
| P3 | 8 | — not started | `execution-plans/p3-ecosystem.md` (to create) |

---

## Decision Log

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | 4 batches (P0-P3) | Mirrors user-visible capability tiers: basic chat → intelligent agent → rich media → platform |
| D2 | P1 before P2 | Tools/knowledge make the agent _smart_; rendering makes it _pretty_. Smart first. |
| D3 | P3 last | Ecosystem features are force-multipliers but require all lower layers to be solid |
| D4 | Each batch gets its own execution plan | Same methodology as P0: per-module S1→S5 gates |
