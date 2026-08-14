# P1-M2: MCP Plugin System — Acceptance (S2/S4)

> **Module**: P1-M2 MCP Plugin System
> **Status**: complete (deterministic pass, functional pending GUI)

---

## Deterministic Checks (automated)

| # | Check | Command / Verification |
|---|-------|----------------------|
| D1 | TypeScript compiles | `cd apps/desktop && pnpm run check` — 0 errors |
| D2 | Rust compiles | `cd apps/desktop && cargo check --manifest-path src-tauri/Cargo.toml` |
| D3 | Station compiles | `cd apps/station && go build ./app/subserver/agent/...` |
| D4 | No `any` types in MCP components | `grep -r ': any' apps/desktop/src/components/mcp/ apps/desktop/src/store/mcp*.ts` → 0 hits |
| D5 | No hardcoded strings | All MCP UI text uses `t()` from i18n |
| D6 | No console.log | `grep -r 'console.log' apps/desktop/src/components/mcp/ apps/desktop/src/store/mcp*.ts` → 0 hits |
| D7 | MCP tool schemas in turn request | Code path exists: `mcp_tool_registry_entries()` → `available_tools` field in `AgentExecuteTurnInput` |

## Functional Scenarios (manual, S4)

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| F1 | MCP schemas sent on turn | Agent has MCP server bound → send message | Turn request body contains `available_tools` with MCP tool schemas |
| F2 | LLM calls MCP tool | MCP server has tool → user prompt triggers it → LLM emits tool_call → Desktop routes to MCP → result | ToolCallCard shows MCP tool name; result in conversation |
| F3 | MCP server CRUD | Add server → test connection → enable → disable → delete | All operations succeed; list updates reactively |
| F4 | Per-agent MCP binding | Agent profile → bind server → verify only bound tools sent | Unbound server tools not in turn request |
| F5 | Multi-server same tool name | Two servers both expose `search` tool → LLM calls `search` | Routed to correct server via namespace prefix (server.tool) |
| F6 | MCP server offline | Bound server unreachable → user sends message | Turn proceeds without those tools; no crash; warning in tool list UI |

## Integration Checks

| # | Check | Verification |
|---|-------|-------------|
| I1 | MCP extends tool runtime | MCP tools use same ToolCallInfo/ToolCallCard rendering as built-in tools |
| I2 | Server auth credentials secure | API keys stored in Rust keychain, not in frontend state |
| I3 | Turn request backward-compatible | `available_tools` field is optional; turns without MCP still work |
