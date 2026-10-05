# P1-M2: MCP Plugin System — Reference Analysis (S1)

## 1. MCP Protocol Overview

MCP (Model Context Protocol) is an open standard by Anthropic that allows LLM applications to connect to external tool servers over a JSON-RPC 2.0 transport. The protocol defines a lifecycle: `initialize` handshake (exchanging protocol version + capabilities), `notifications/initialized` confirmation, then `tools/list` discovery and `tools/call` execution. Each MCP server exposes a set of tools with JSON Schema input definitions. The protocol supports three transport types: STDIO (child process with Content-Length framed JSON-RPC over stdin/stdout), HTTP (stateless POST JSON-RPC), and SSE (Server-Sent Events streaming over HTTP). The protocol version in active use is `2024-11-05`.

## 2. LobeHub's MCP Integration Architecture

LobeHub (lobe-chat) integrates MCP through a plugin-style system under `src/features/MCP/`. The core flow is:
1. **Registry**: MCP servers are stored as configuration records (name, transport type, command/URL, env, auth).
2. **Discovery**: On connection/test, the client sends `initialize` + `tools/list` to discover available tools.
3. **Tool conversion**: MCP tool schemas are converted to LobeChat's internal `PluginTool` format with name, description, and JSON Schema parameters.
4. **Execution**: During chat, when the LLM calls an MCP tool, LobeChat routes through `MCPClientManager` which manages server connections, spawns STDIO processes or HTTP clients, and returns results.
5. **Lifecycle**: Servers can be enabled/disabled/reconnected; STDIO processes are spawned per-session and killed on disconnect.

## 3. Transport Types (STDIO/HTTP/Cloud)

| Transport | Mechanism | Use Case |
|-----------|-----------|----------|
| **STDIO** | Spawn child process; communicate via Content-Length framed JSON-RPC over stdin/stdout | Local tools (filesystem, git, shell wrappers) |
| **HTTP** | Stateless POST to a URL with JSON-RPC body; response is JSON | Remote hosted MCP servers |
| **SSE** | POST to URL; response uses `text/event-stream` with `data:` lines containing JSON-RPC | Streaming-capable remote servers |

LobeHub additionally supports a "Cloud" variant (hosted MCP marketplace) which is essentially HTTP with an auth layer managed by their platform. Our implementation supports all three core transports (stdio, http, sse) with security policy enforcement.

## 4. Installation & Lifecycle Flow

LobeHub's `installMCPPlugin` flow:
1. **Manifest fetch**: User provides server config (name, transport, command/URL) or imports JSON from Claude Desktop format (`mcpServers` key).
2. **Config persist**: Server record stored in local settings with transport params, env vars, and auth tokens.
3. **Connect**: Client sends `initialize` request with `clientInfo` and `protocolVersion`.
4. **Discover**: After initialized notification, sends `tools/list` to enumerate available tools.
5. **Register tools**: Tool schemas are converted and registered in the agent's available tool set.
6. **Reconnect**: On failure, exponential backoff retry; STDIO processes are restarted.
7. **Disconnect**: STDIO child processes are killed; HTTP connections are simply dropped.

## 5. Tool Schema Conversion

MCP tools expose standard JSON Schema for their `inputSchema`. LobeHub converts these to its internal format:
- MCP `name` becomes the tool identifier (prefixed with server name for namespacing).
- MCP `description` maps directly to tool description.
- MCP `inputSchema` (JSON Schema object) becomes the tool's parameter schema.
- LobeHub adds metadata: `source: "mcp"`, `serverName`, `transport`, `needs_approval` flag.
- Tools from disabled servers are excluded from the active tool set.

Our Desktop Rust layer uses a similar approach: `mcp_tool_registry_entries()` builds entries with format `mcp.<server_name>.<tool_name>` including source, transport, category, and approval metadata.

## 6. UI Components

LobeHub provides under `features/MCP/`:
- **MCPServerList**: Shows all configured MCP servers with status indicators (connected/failed/unknown).
- **MCPServerModal**: Add/edit server dialog with transport selection, command/URL input, env vars editor.
- **MCPToolList**: Shows tools discovered from a server after successful connection test.
- **MCPImport**: Import from Claude Desktop JSON format (`mcpServers` object).
- **MCPStatusBadge**: Per-server status indicator with tool count.

Our Desktop already has equivalent components (see Section 8).

## 7. Our Station's Existing MCP Infrastructure

The Station has a **placeholder-based MCP routing** architecture:

**File**: `apps/station/app/subserver/agent/service/tool_registry_service.go`
- `registerLocalMCPTool()` registers a `local_mcp` tool definition with schema accepting `server_name`, `tool_name`, and `arguments`.
- The handler is a no-op placeholder; actual execution is intercepted by TurnService.

**File**: `apps/station/app/subserver/agent/service/turn_service.go` (line 976)
- During tool dispatch, if `tc.ToolName == "local_mcp"`, the turn loop calls `executeLocalMCPTool()`.
- This method: (1) parses server_name/tool_name/arguments, (2) registers a result channel via `localToolBroker`, (3) emits a `local_tool_request` SSE event with `Source: "mcp"` to the Desktop client, (4) blocks waiting for the Desktop to execute and respond via the broker.
- The pattern is: **Station plans tool use, Desktop executes locally, results flow back through the broker**.

**Key insight**: Station never directly connects to MCP servers. It delegates all MCP execution to the Desktop Rust layer through the local tool bridge. This preserves the security boundary (MCP servers run in the user's local environment, not on the server).

## 8. Our Desktop's Existing MCP Support

The Desktop has a **full MCP client implementation** in Rust:

**File**: `apps/desktop/src-tauri/src/application/mcp/mod.rs` (1708 lines)
- Complete MCP protocol implementation: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`.
- Supports all three transports: STDIO (process spawn), HTTP (reqwest POST), SSE (event-stream parsing).
- Server config persistence via JSON file at `<app_data>/mcp/servers.json`.
- Security policies: STDIO rejects shell wrappers (sh/bash/zsh), reserved env prefix protection; HTTP enforces HTTPS for non-loopback, rejects private/link-local IPs, validates headers against injection.
- Workspace sandbox: `McpToolExecutionPolicy` validates file path arguments stay within allowed roots.
- Tauri commands exposed: `mcp_list_servers`, `mcp_get_server`, `mcp_create_server`, `mcp_update_server`, `mcp_delete_server`, `mcp_toggle_server`, `mcp_test_server`, `mcp_execute_tool`.
- `mcp_tool_registry_entries()` builds namespaced tool entries (`mcp.<server>.<tool>`) for the agent tool registry.

**File**: `apps/desktop/src/components/MCPTab.tsx`
- Full settings UI: server list with status/type/tool-count badges, add modal (stdio/http/sse), import from JSON, edit modal with connection test, enable/disable toggle, delete with confirmation.

**File**: `apps/desktop/src/store/mcp.ts`
- Zustand store with optimistic updates, mutation tracking, and revalidation for all MCP CRUD operations.

**File**: `apps/desktop/src/services/mcp-service.ts`
- Service layer wrapping Tauri IPC calls (list/get/create/update/delete/toggle/test).

**File**: `apps/desktop/src/pages/AgentProfilePage.tsx` (line 1595)
- Per-agent MCP server binding: `chatConfig.mcpServers` array links specific MCP servers to an agent profile.

**File**: `apps/desktop/src/runtimes/agentCapabilityRuntime.ts`
- MCP store is loaded at runtime startup alongside other capability stores.

## 9. Key Takeaways for Peers-Touch

1. **We already have a working MCP system** — Desktop Rust implements the full MCP client (all transports, security policies, workspace sandboxing) and Station routes MCP calls through the local tool bridge. This is architecturally sound.

2. **Gap: No MCP plugin marketplace/discovery** — LobeHub has a cloud marketplace for discovering MCP servers. We currently only support manual configuration or JSON import.

3. **Gap: No persistent server connections** — Our implementation spawns/kills MCP server processes per-call (both probe and execute). LobeHub maintains long-lived STDIO connections. For frequently-used servers, connection pooling would reduce latency.

4. **Gap: No schema-aware tool planning** — Station's `local_mcp` tool has a generic schema. The LLM sees one tool and must know server/tool names. LobeHub expands each MCP tool into a distinct tool definition visible to the LLM. Our `mcp_tool_registry_entries()` already builds these entries but the Station-side planning needs to consume them.

5. **Gap: Per-agent MCP binding exists in UI** — `AgentProfilePage` already binds MCP servers to agents via `mcpServers` array, but the Station prompt assembly may not yet inject per-agent MCP tool schemas.

6. **Security advantage** — Our SSRF protection (loopback-only HTTP, private IP blocking), shell wrapper rejection, reserved env prefix, and workspace path sandboxing exceed LobeHub's security posture. This is a strength to preserve.

7. **Architecture alignment** — The Station-plans/Desktop-executes split via local tool broker is the correct pattern for a decentralized system where MCP servers run in the user's trusted environment. A future "Plugin System" module should enhance discovery and lifecycle management without breaking this security boundary.
