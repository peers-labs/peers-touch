# P3 — Multi-Agent & Ecosystem — Execution Plan

> **Status**: active
> **Created**: 2026-08-14
> **Source**: `batch-strategy.md` P3 definition + `lobehub-feature-topology.md`
> **Methodology**: S1 分析 → S2 设计 → S3 实现 → S4 验收 → S5 交付

---

## Existing Infrastructure

Before scoping new work, inventory what's already built:

| Capability | Status | Evidence |
|-----------|--------|----------|
| Agent orchestration (multi-step) | ✅ built | `orchestration_service.go`, `AgentCanvasPage.tsx` |
| Delegation (agent-to-agent) | ✅ built | `delegation_service.go`, `DelegationTaskInfo` in chat store |
| Collaboration events | ✅ built | `agent:collaboration-event` listener, `streamAgentCollaborationEvents` |
| Skills market | ✅ built | `skills_market_*` Rust commands, `SkillsTab.tsx` |
| Agent packages (export/import) | ✅ built | `agents_export_package`, `agents_import_package` |
| Knowledge/RAG | ✅ built (P1) | `knowledge_retrieval_service.go`, frontend binding |
| Evaluation predicates | ✅ built | `acceptance_predicate_evaluator.go` |
| Notebook | Partial | `NotesPage.tsx` exists |

---

## Module Decomposition

| # | Module | Topology Source | Existing | New Work |
|---|--------|----------------|----------|----------|
| M1 | **Agent Groups** | `store/agentGroup` | Orchestration + delegation exist | Group CRUD UI, member management panel |
| M2 | **Marketplace / Discovery** | `store/discover` | Skills market exists | Unified discover page (agents + skills + MCP) |
| M3 | **Custom Plugins** | `store/tool/slices/customPlugin` + `connector` | MCP system exists (P1) | Custom plugin authoring UI, connector config |
| M4 | **Evaluation System** | `store/eval` | Acceptance predicates exist | Benchmark UI, dataset management, run dashboard |
| M5 | **Notebook / Pages** | `store/notebook` + `store/page` + `store/document` | NotesPage exists | Rich document editor, doc-agent linking |
| M6 | **Home Page** | `store/home` | Agent list exists in sidebar | Dedicated home with recent, pinned, activity feed |
| M7 | **Topic Comments** | `store/topicComment` | Topics exist | Comment thread on topics (lightweight) |
| M8 | **Mentions** | `store/mention` | Multi-agent collaboration exists | @mention in chat input, mention resolution |

---

## Priority & Dependency Order

```
Independent (can parallelize):
  M1 Agent Groups           ← highest ecosystem value
  M2 Marketplace/Discovery  ← agent sharing/reuse
  M6 Home Page              ← daily UX improvement
  M7 Topic Comments         ← lightweight, quick win

Sequential:
  M3 Custom Plugins         ← extends M2 (marketplace has plugins)
  M4 Evaluation System      ← needs datasets (can start independently)
  M5 Notebook/Pages         ← extends existing NotesPage
  M8 Mentions               ← needs M1 (agent groups to mention)
```

**Recommended execution order**: M7 → M6 → M2 → M1 → M5 → M3 → M8 → M4

Rationale: Quick wins first (M7, M6), then the highest-value ecosystem features (M2, M1), then deeper integrations.

---

## M1: Agent Groups

**Topology source**: `store/agentGroup` — CRUD, member management, multi-agent orchestration

**Scope**:
- Agent group creation / editing / deletion
- Add/remove agents from a group
- Group-level orchestration mode (sequential / parallel / router)
- Group chat — user message dispatched to coordinator agent
- Reorder members (priority/sequence)

**Depends on**: P0 agent config, existing `orchestration_service.go`

---

## M2: Marketplace / Discovery

**Topology source**: `store/discover` — assistants, plugins, models, providers, skills

**Scope**:
- Unified discovery page with category tabs (Agents / Skills / MCP Servers)
- Agent cards with preview, install/clone
- Skill detail page (from existing skills market)
- Search + filter by category
- Social: favorites, likes (future)

**Future data-plane closure**:
- Ship at least one governed default marketplace source so first use is not empty.
- Replace the current URL-to-JSON convention with an explicit Git repository/branch contract or an official/federated catalog API.
- Define publisher identity, signature, trust/risk, version, revoke, and federation ownership.
- Add source-bound Acceptance for default source discovery, synchronization, visible catalog data, install readback, uninstall, and cleanup.

**Depends on**: Existing skills_market, agent package import

---

## M3: Custom Plugins

**Topology source**: `store/tool/slices/customPlugin` + `slices/connector`

**Scope**:
- Plugin authoring: define tool schema (JSON Schema) + endpoint
- Connector config: API key, base URL, auth mode
- Plugin testing (invoke from UI with sample input)
- Publish to local skill market

**Depends on**: P1 MCP, M2 marketplace

---

## M4: Evaluation System

**Topology source**: `store/eval` — benchmark, dataset, experiment, run

**Scope**:
- Dataset CRUD (question + expected answer pairs)
- Benchmark creation (dataset + agent + metrics)
- Run execution: iterate dataset, score responses
- Results dashboard (accuracy, latency, cost)
- RAG evaluation (existing `ragEval` slice)

**Depends on**: P1 knowledge base, existing acceptance evaluator

---

## M5: Notebook / Pages

**Topology source**: `store/notebook` + `store/page` + `store/document`

**Scope**:
- Rich document editor (markdown-based)
- Link documents to agents/conversations
- Document versioning
- Page tree navigation

**Depends on**: Existing `NotesPage.tsx`, P2 markdown rendering

---

## M6: Home Page

**Topology source**: `store/home` — agentList, group, homeInput, recent, sidebarUI

**Scope**:
- Dedicated home/landing page
- Recent conversations list
- Pinned/favorite agents
- Quick-start actions (new chat, import agent)
- Activity feed (recent turns, delegations)

**Depends on**: P0 sessions, P1 agents

---

## M7: Topic Comments

**Topology source**: `store/topicComment` — create, listReplies, listThreads, summary

**Scope**:
- Add comments/notes to any topic
- Comment list view in topic sidebar
- Reply threading (simple)
- Comment summary (LLM-generated, optional)

**Depends on**: P0 topics

---

## M8: Mentions

**Topology source**: `store/mention` — addMentionedUser, clearMentionedUsers

**Scope**:
- @mention agents in chat input
- Mention resolution → invoke mentioned agent as collaborator
- Mention autocomplete dropdown
- Mentioned agent's response rendered as delegation result

**Depends on**: M1 agent groups, existing delegation system

---

## Progress Tracker

| # | Module | Stage | Date | Notes |
|---|--------|-------|------|-------|
| M7 | Topic Comments | ✅ S5 交付 | 2026-08-14 | localStorage persistence, Portal view, sidebar menu entry |
| M6 | Home Page | ✅ S5 交付 | 2026-08-14 | Dedicated landing page, recent topics, pinned agents, quick actions |
| M2 | Marketplace / Discovery | 🟨 UI/本地目录已交付；数据供应待做 | 2026-08-14 | Unified page、JSON index source 与安装分发已实现；默认可信 source、官方/联邦 catalog 和治理进入未来工作 |
| M1 | Agent Groups | ✅ S5 交付 | 2026-08-14 | Group CRUD, member management, orchestration mode, localStorage v1 |
| M5 | Notebook / Pages | ✅ S5 交付 | 2026-08-14 | Notebook store layer over existing NotesPage, locale keys |
| M3 | Custom Plugins | ✅ S5 交付 | 2026-08-14 | Plugin authoring UI, JSON Schema, test panel, auth config |
| M8 | Mentions | ✅ S5 交付 | 2026-08-14 | @mention store, popup, tag bar, trigger hook, ready for ChatInput integration |
| M4 | Evaluation System | ✅ S5 交付 | 2026-08-14 | Dataset CRUD, run execution via quickCompletion, results dashboard |
