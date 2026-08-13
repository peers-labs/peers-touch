# P1: Tool & Knowledge — Execution Tracking

> **Status**: active
> **Created**: 2026-08-13
> **Batch**: P1 — Agent uses tools, retrieves knowledge, retains memory
> **Architecture source**: `docs/architecture/agent/lobehub-feature-topology.md`
> **Batch strategy**: `docs/architecture/agent/execution-plans/batch-strategy.md`
> **Methodology**: Same as P0 — per-module S1→S5 gates

---

## Scope

P1 makes the agent _intelligent_ beyond text generation:

- Agent can invoke tools (built-in + external via MCP protocol)
- Agent can retrieve knowledge from uploaded documents (RAG)
- Agent remembers user preferences and conversation context across sessions
- Side panel shows tool outputs, artifacts, and retrieved knowledge

## Modules

| # | Module | Scope (from topology) | S1 分析 | S2 设计 | S3 实现 | S4 验收 | S5 交付 | PR |
|---|--------|----------------------|---------|---------|---------|---------|---------|-----|
| 1 | **Tool Execution Runtime** | store/tool/slices/builtin + store/chat/slices/builtinTool + local_tool_broker | ✅ | ✅ | ✅ | ✅ deterministic (E2E blocked: provider) | ✅ | 2c0375 |
| 2 | **MCP Plugin System** | store/tool/slices/mcpStore + features/MCP (server list, tool list, modal) | ✅ | ✅ | ✅ | ✅ deterministic | ✅ | eec5675 |
| 3 | **Knowledge Base & RAG** | store/library + store/file (upload, chunking) + knowledge_retrieval_service | ✅ | ✅ | ✅ | ✅ deterministic (F1-F6: needs GUI) | — | — |
| 4 | **User Memory** | store/userMemory (identity, activity, context, experience, preference) + memory_service | — | — | — | — | — | — |
| 5 | **Portal / Side Panel** | store/chat/slices/portal + features/Portal (ToolUI, Artifacts, Thread, AgentInfo) | — | — | — | — | — | — |

## Module Dependency Order

```
1. Tool Execution Runtime     ← foundation: tool_call events from P0 streaming need a handler
2. MCP Plugin System          ← extends tool runtime with external tool discovery + invocation
3. Knowledge Base & RAG       ← independent of tools, but Portal renders both
4. User Memory                ← independent, consumed by prompt assembly (system prompt injection)
5. Portal / Side Panel        ← rendering surface for tool results + knowledge + artifacts
```

Parallelizable: M3 + M4 can run in parallel after M1. M5 starts after M1+M3.

## Existing Assets (reuse, not rewrite)

| Asset | Location | Status |
|-------|----------|--------|
| Tool registry service | `apps/station/app/subserver/agent/service/tool_registry_service.go` | Exists — manages tool definitions |
| Local tool broker | `apps/station/app/subserver/agent/service/local_tool_broker.go` | Exists — handles client-side tool execution |
| Knowledge retrieval | `apps/station/app/subserver/agent/service/knowledge_retrieval_service.go` | Exists — RAG pipeline |
| Memory service | `apps/station/app/subserver/agent/service/memory_service.go` | Exists — CRUD + embedding |
| Memory embedding | `apps/station/app/subserver/agent/service/memory_embedding.go` | Exists — vector indexing |
| Skill service | `apps/station/app/subserver/agent/service/skill_service.go` | Exists — skill definitions |
| Delegation service | `apps/station/app/subserver/agent/service/delegation_service.go` | Exists — sub-agent dispatch |
| Desktop streaming handler | `apps/desktop/src/store/streaming/handler.ts` | P0 — already handles tool_call/tool_result events |
| Desktop chat store | `apps/desktop/src/store/chat.ts` | P0 — `decideToolApproval` action exists |
| turn_stream.proto | `model/domain/agent/turn_stream.proto` | P0 — tool payloads defined |
| ToolCallCard component | `apps/desktop/src/components/messages/ToolCallCard.tsx` | P0 — basic rendering exists |

## Per-Module Document Structure

Each module produces under `docs/architecture/agent/modules/<module>/`:

```
<module>/
├── reference-analysis.md    ← S1: LobeHub source-level analysis
├── peers-design.md          ← S2: Peers architecture design
└── acceptance.md            ← S2: Acceptance scenarios (executed in S4)
```

## Status Legend

| Symbol | Meaning |
|--------|---------|
| — | Not started |
| 🔄 | In progress |
| ✅ | Complete |
| ❌ | Blocked |
