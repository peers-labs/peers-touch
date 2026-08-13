# P1-M1: Tool Execution Runtime — Reference Analysis (S1)

> Source: LobeHub lobe-chat (lobehub/lobe-chat, main branch, analyzed 2026-08-13)
> Paths analyzed: `src/store/tool/slices/builtin/`, `src/store/tool/slices/mcpStore/`, `src/features/Conversation/Messages/`

---

## 1. Architecture Overview

LobeHub's tool system is a **client-centric executor architecture** with lazy-loaded server extensions:

- **Tool Store** (`src/store/tool/`) — Zustand store with multiple slices: `builtin`, `mcpStore`, `connector`, `composioStore`, `agentSkills`, `customPlugin`, `lobehubSkillStore`, `plugin`.
- **Executor Registry** — A `Map<identifier, IBuiltinToolExecutor>` loaded on-demand via dynamic `import('./catalog')`. Each executor implements the `IBuiltinToolExecutor` interface with `invoke(apiName, params, ctx)`, `hasApi()`, and `getApiNames()`.
- **Tool manifests** — Each tool declares a `ToolManifest` with `api[]` entries (name + description + parameters schema). These are what get sent to the LLM as tool definitions.
- **Separation of concerns**: The chat store handles the LLM conversation loop; the tool store handles executor dispatch. Connector/MCP/Composio slices handle external tool connectivity.

---

## 2. Invocation Flow

1. LLM streams a response containing `tool_calls` (function name + arguments).
2. Chat store parses the tool call, creates a tool message in the conversation (role=`tool`), and identifies the tool by `identifier/apiName` composite key.
3. Chat store calls `toolStore.invokeBuiltinTool(identifier, apiName, params, ctx)`.
4. `invokeBuiltinTool` sets a loading flag, then delegates to `invokeExecutor()`.
5. `invokeExecutor()` lazily registers all executors (one-time dynamic import of `catalog.ts`), looks up the executor by identifier, validates `hasApi(apiName)`, then calls `executor.invoke(apiName, params, ctx)`.
6. After execution, a "work registration intent" is stashed (best-effort artifact tracking for cost/audit), and the result (`BuiltinToolResult`) is returned.
7. Chat store writes the tool result back to the message, feeds it to the LLM in the next turn.
8. If the executor errors, a structured `{ success: false, error: { type, message, body } }` is returned (never throws to the caller).

---

## 3. Built-in Tool Catalog

LobeHub ships ~28 built-in tool executors (from `catalog.ts`):

| Category | Tools |
|----------|-------|
| **AI/Agent Management** | agentBuilder, agentManagement, groupAgentBuilder, groupManagement, lobeAgent, pageAgent |
| **Content Generation** | imageGeneration (DALL-E), cloudSandbox (code execution) |
| **Web/Browsing** | browser (web browsing), webBrowsing, webOnboarding |
| **Knowledge/Memory** | knowledgeBase, memory, agentDocuments, notebook, topicReference |
| **System/Local** | localSystem (file operations), calculator, creds (credential management) |
| **Interaction** | userInteraction (human-in-the-loop prompts), message, activator |
| **Tasks** | task (async task management), skillStore, skills |
| **Heterogeneous CLI** | amp, claudeCode, codex, openCode (observe-only hooks for external CLI agents) |

---

## 4. Client vs Server Execution Model

- **Client-side (dominant)**: Most built-in tools execute in the browser/Electron renderer process. The executor registry lives in the client Zustand store. Tools like `browser`, `localSystem`, `knowledgeBase`, `task`, and `lobeAgent` have explicit `/client/executor` import paths.
- **Server-side**: Tools that need backend resources (e.g., image generation via DALL-E API, cloud sandbox code execution) make TRPC calls from the client executor to server routers. The executor itself is still instantiated client-side but delegates heavy work server-side.
- **MCP tools**: Execute via the MCP protocol — either STDIO (Desktop/Electron only, spawns a local process), HTTP (streamable, works everywhere), or Cloud (LobeHub-hosted MCP proxy). The MCP store manages connections and converts MCP tool schemas into the LobeChat manifest format.
- **Connector/Composio tools**: Third-party integrations (GitHub, Linear, etc.) resolved per-agent with a priority chain: Agent-owned > Mounted > Personal/Workspace base.

---

## 5. Tool Result Handling

**LLM Feedback Loop:**
- Tool results are serialized to string (JSON) and injected as the `tool` role message in the conversation history.
- `transformApiArgumentsToAiState()` optionally transforms tool params into a summary string for the LLM context (reducing token usage for verbose tool results).
- The LLM sees the tool result in its next turn and can decide to call another tool or respond to the user.

**UI Rendering:**
- `src/features/Conversation/Messages/` contains specialized renderers per message type: `Assistant`, `AssistantGroup` (multi-step tool chains), `Task`, `TaskCallback`, `GroupTasks`, `EditedFilesCard`, `SignalCallbacks`, `MessageWorks`.
- Tool calls are rendered as collapsible "step" cards within an `AssistantGroup` — showing tool name, parameters, loading state, and results inline.
- The "Work" system tracks artifacts created by tools (documents, external resources) and renders summary cards with version history.

---

## 6. MCP Integration Pattern

- **Connection types**: STDIO (local process, Desktop only), HTTP (remote server), Cloud (LobeHub-hosted proxy with `cloudEndPoint`).
- **Installation flow** (`installMCPPlugin`): Fetch manifest -> Check system dependencies (STDIO) -> Resolve configuration schema -> Test connection -> Register tool manifest -> Persist to user settings.
- **Manifest conversion**: MCP's `{ name, description, inputSchema }` is normalized to LobeChat's `{ name, description, parameters }` API format at install time.
- **Runtime**: MCP tools appear alongside built-in tools in the agent's available tool list. When invoked, the client routes through `mcpService` which manages the protocol transport (STDIO pipe / HTTP fetch).
- **Agent-scoped connectors**: An agent can own, copy, or mount (reference-lock) a connector. Priority resolution: agent-owned > mounted-by-this-agent > free base. This prevents credential leakage across agents.

---

## 7. Key Takeaways for Peers-Touch

1. **Registry pattern is proven**: A lazy-loaded `Map<identifier, executor>` with an `IBuiltinToolExecutor` interface is simple, extensible, and keeps the initial bundle small. We should adopt a similar pattern in our `tool_registry_service.go` / client-side broker.

2. **Client-first with server delegation**: LobeHub runs executors client-side and delegates to the server only when needed (API keys, heavy compute). Our `local_tool_broker.go` aligns with this — the Desktop client executes tools locally and calls Station only for server-side capabilities.

3. **Composite key `identifier/apiName`**: Each tool has a namespace (identifier) with multiple APIs. This is more flexible than flat tool names and matches our existing `skill_service.go` skill/action hierarchy.

4. **Structured error contract**: `{ success: boolean, error?: { type, message } }` — never throw. Adopt this for our tool result proto.

5. **MCP as a first-class connector type**: LobeHub treats MCP as one of several connector patterns (alongside Composio OAuth, custom plugins). We should design our MCP integration as a connector adapter, not a separate subsystem.

6. **Tool approval is settings-driven**: LobeHub uses `humanIntervention` settings per tool (not per-call). The `userInteraction` executor handles human-in-the-loop prompts. We should implement a similar declarative permission model in our tool registry.

7. **Work/Artifact tracking**: LobeHub's "Work" system registers artifacts produced by tool executions (files edited, issues created) with version history. This is relevant for our agent output tracking.

8. **Agent-scoped tool resolution**: The priority chain (agent > workspace > personal) for connector resolution is directly applicable to our multi-user Station architecture where tools may be scoped per-agent or per-user.
