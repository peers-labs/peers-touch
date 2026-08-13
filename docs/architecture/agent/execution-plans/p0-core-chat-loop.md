# P0: Core Chat Loop — Execution Tracking

> **Status**: complete
> **Created**: 2026-08-12
> **Batch**: P0 — One user, one agent, complete conversation loop
> **Architecture source**: `docs/architecture/agent/lobehub-feature-topology.md`
> **Methodology**: `pt-architecture-design-methodology` (Step 1b) → `pt-architecture-execution-methodology` (Step 7b) → `pt-execution-plan-guardian`

---

## Scope

P0 delivers a complete, end-to-end single-agent chat experience:

- User sends message → agent streams response (with thinking/tool events visible)
- User can stop/retry/regenerate/branch/continue/delete messages
- Input supports file upload, model selection, context display
- Agent can be configured (system prompt, model, tools binding, opening message)
- Provider/model management (add, enable, configure, fallback)
- Session/topic management (create, switch, rename, delete, search, auto-name)

## Modules

| # | Module | Scope (from topology) | S1 分析 | S2 设计 | S3 实现 | S4 验收 | S5 交付 | PR |
|---|--------|----------------------|---------|---------|---------|---------|---------|-----|
| 1 | **Streaming Runtime** | store/chat/agentRun (entries, controls, lifecycle, state, transports) | ✅ | ✅ | ✅ | ✅ curl+deterministic | ✅ | #86 |
| 2 | **Message & Actions** | store/chat/message + Messages/ components + MessageActionBar | ✅ | ✅ | ✅ | ✅ deterministic+E2E | ✅ | #86 |
| 3 | **Chat Input & Composer** | features/ChatInput (ActionBar, InputEditor, ControlBar, Desktop variant) | ✅ | ✅ | ✅ | ✅ deterministic | ✅ | #86 |
| 4 | **Agent Config & Profile** | store/agent + features/AgentSetting | ✅ | ✅ | ✅ | ✅ deterministic | ✅ | #86 |
| 5 | **Provider & Model Infra** | store/aiInfra + features/ModelSwitchPanel | ✅ | ✅ | ✅ | ✅ deterministic | ✅ | #86 |
| 6 | **Session & Topic** | store/session + store/chat/topic + features/AgentSidebar/Topic | ✅ | ✅ | ✅ | ✅ deterministic+E2E | ✅ | #86 |

## Module Dependency Order

```
1. Streaming Runtime        ← foundation, everything depends on this
2. Message & Actions        ← needs streaming events to render
3. Chat Input & Composer    ← needs message store to submit
4. Agent Config & Profile   ← needs provider/model from #5
5. Provider & Model Infra   ← independent, but agent config references it
6. Session & Topic          ← needs message/streaming to function
```

Parallelizable: #4 + #5 can run together after #1-3 are done. #6 can start after #1-2.

## Existing Assets (reuse, not rewrite)

| Asset | Location | Reuse strategy |
|-------|----------|---------------|
| Station Agent backend | `apps/station/app/agent/` | Source of truth — extend, don't replace |
| Rust BFF agent_turn | `apps/desktop/src-tauri/src/application/agent_turn/` | Extend event types, keep existing SSE flow |
| Desktop chat store | `apps/desktop/src/store/chat.ts` | Add actions/selectors incrementally |
| Desktop agent store | `apps/desktop/src/store/agent.ts` | Add config fields |
| AgentChatPage | `apps/desktop/src/pages/AgentChatPage.tsx` | Split into child components |
| Proto definitions | `model/domain/` | Add new message/event types |
| PR #80 mergeServerMessages | chat.ts L199-280 | Keep — handles optimistic/server reconciliation |
| PR #81 agent row menu + pin | AgentChatPage.tsx, AppSideNav.tsx | Keep — already part of agent list UX |

## Per-Module Document Structure

Each module produces under `docs/architecture/agent/modules/<module>/`:

```
<module>/
├── lobehub-analysis.md    ← S1: LobeHub source-level analysis
├── peers-design.md        ← S2: Peers architecture design
└── acceptance.md          ← S2: Acceptance scenarios (executed in S4)
```

## Status Legend

| Symbol | Meaning |
|--------|---------|
| — | Not started |
| 🔄 | In progress |
| ✅ | Complete |
| ❌ | Blocked |

---

## How To Use This Document

1. Agent updates this table after completing each step for each module.
2. User can check status at any time by reading this file.
3. A module is "done" only when all 5 columns show ✅ and the PR is merged.
4. P0 is "done" when all 6 modules show ✅ across all columns.
