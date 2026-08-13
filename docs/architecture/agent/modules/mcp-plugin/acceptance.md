# P1-M2: MCP Plugin System — Acceptance Scenarios

> **Module**: P1-M2 MCP Plugin System
> **Coverage**: Tool schema expansion gap (G1)

---

## AM-01: MCP tool schemas sent to Station on turn start

**Precondition**: Agent has 1+ MCP servers bound and enabled
**Steps**:
1. User sends a message in a conversation
2. Desktop fetches `mcp_tool_registry_entries()` for bound servers
3. Tool schemas are included in the turn request to Station
4. Station includes MCP tool definitions in the LLM prompt

**Acceptance**:
- Turn request body contains `available_tools` array with MCP tool schemas
- LLM can see and reference the MCP tools in its response
- **Status**: pending

---

## AM-02: LLM calls an MCP tool successfully

**Precondition**: GitHub MCP server bound with `create_issue` tool
**Steps**:
1. User says "Create a GitHub issue titled 'test'"
2. LLM emits tool_call for `mcp.github.create_issue`
3. Station emits `local_tool_request` to Desktop
4. Desktop routes to GitHub MCP server via `mcp_execute_tool`
5. Result submitted back

**Acceptance**:
- ToolCallCard shows MCP tool name and arguments
- Result appears in conversation
- **Status**: pending

---

## AM-03: MCP server CRUD still works (regression)

**Acceptance**:
- Can add a new MCP server via MCPTab
- Can test connection
- Can enable/disable
- Can delete
- **Status**: pending (verify existing UI)

---

## AM-04: Per-agent MCP binding still works (regression)

**Acceptance**:
- Agent profile shows MCP servers section
- Can bind/unbind servers to agent
- Only bound servers' tools are sent on turn start
- **Status**: pending
