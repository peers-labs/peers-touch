# P1-M2: MCP Plugin System — Peers Design (S2)

> **Module**: P1-M2 MCP Plugin System
> **Step**: S2 — Peers Design
> **Status**: draft
> **Finding**: MCP system is 90%+ implemented. This module closes remaining gaps.

---

## 1. Current State (already implemented)

| Layer | Component | Status |
|-------|-----------|--------|
| Rust BFF | Full MCP client (STDIO/HTTP/SSE transports) | ✅ |
| Rust BFF | Security (shell rejection, SSRF protection, sandbox) | ✅ |
| Rust BFF | Tauri commands (CRUD + test + execute) | ✅ |
| Station | `local_mcp` tool bridge (intercept + emit local_tool_request) | ✅ |
| Desktop UI | `MCPTab.tsx` (server list, add/edit/delete, JSON import) | ✅ |
| Desktop Store | `store/mcp.ts` (Zustand, optimistic CRUD) | ✅ |
| Desktop Service | `mcp-service.ts` (Tauri IPC wrapper) | ✅ |
| Agent Config | Per-agent `chatConfig.mcpServers` binding | ✅ |

## 2. Gaps to Close

| # | Gap | Impact | Effort |
|---|-----|--------|--------|
| G1 | Per-MCP-tool schema not expanded to Station prompt | LLM doesn't know MCP tool params → can't call correctly | Medium |
| G2 | No persistent MCP server connections | Extra latency per call (spawn+kill) | Low (deferred) |
| G3 | No MCP marketplace/discovery | Manual config only | Low (P3 scope) |

## 3. Design: G1 — Tool Schema Expansion

**Problem**: Station's prompt assembly only sees the generic `local_mcp` tool. It doesn't know the individual MCP tools available (e.g., `github.create_issue`, `slack.send_message`).

**Solution**: Desktop sends tool schemas to Station when starting a turn.

**Flow**:
1. On turn start, Desktop calls `mcp_tool_registry_entries()` (already exists)
2. The resulting tool entries are passed as `available_tools[]` in the turn request body
3. Station uses these in prompt assembly alongside built-in tools
4. When LLM calls an MCP tool, Station emits `local_tool_request` with the MCP tool name
5. Desktop routes it to the correct MCP server via existing infrastructure

**Changes needed**:
- `AgentExecuteTurnInput` in `desktop_api.ts` — add `available_tools?: ToolSchemaEntry[]`
- `streamAgentCollaborationEvents` — include tool schemas in the request
- Station `turn_service.go` — read `available_tools` from request, merge into tool list

## 4. Files to Change

| File | Change |
|------|--------|
| `apps/desktop/src/services/desktop_api.ts` | Add `available_tools` field to `AgentExecuteTurnInput` |
| `apps/desktop/src/store/chat.ts` | Before starting stream, fetch MCP tool schemas and include in request |
| Station `turn_service.go` | Accept and merge client-provided tool schemas |
| Station `prompt_assembly_service.go` | Include client tools in prompt |

## 5. What Does NOT Change

- MCP Rust client (already working)
- MCPTab UI (already complete)
- store/mcp.ts (already working)
- Security policies (already enforced)
- Per-agent binding (already working)
