# P4 — Infrastructure Deepening & Power Features — Execution Plan

> **Status**: active
> **Created**: 2026-08-14
> **Source**: Deep comparison report (P3 completion round)
> **Methodology**: S1 分析 → S2 设计 → S3 实现 → S4 验收 → S5 交付

---

## Scope Decisions

| Feature | Decision | Rationale |
|---------|----------|-----------|
| Image/Video Generation | **reject** | 不在当前阶段 scope |
| AgentBuilder Wizard | **reject** | 现有 Agent Profile 页面够用 |
| DailyBrief | **defer** | 暂不需要 |
| File Management | **adapt** | 对接现有 OSS/attachment 基建，不新建通用能力 |
| Connectors for Agent | **adapt** | 复用 desktop/mobile 已有 connector，暴露给 agent 调用 |

---

## Module Decomposition

| # | Module | Topology Source | Existing Infrastructure | New Work |
|---|--------|----------------|------------------------|----------|
| M1 | **Task System** | `store/task` (config/detail/lifecycle/list) | Orchestration + delegation exist on Station | Task store, Task CRUD UI, lifecycle (run/cancel/complete), agent-driven scheduling |
| M2 | **TTS (Text-to-Speech)** | `store/chat/slices/tts` | None | TTS store, Web Speech API / external TTS service, AudioPlayer component, voice config |
| M3 | **Session Groups** | `store/session/slices/sessionGroup` | Sessions exist in chat store | sessionGroup actions, UI for group management, drag-to-group |
| M4 | **File Integration for Agent** | `store/file` (chat upload, document) | `oss_upload_agent_attachment_bytes`, `ChatAttachmentInput` exist | Agent file picker, upload progress in chat, file reference in messages, chunk preview |
| M5 | **Connectors for Agent** | `store/tool/slices/connector` | Desktop/mobile connectors exist (OAuth, etc.) | Expose connector list to agent config, bind connector tools to agent, invoke via MCP-like interface |
| M6 | **WorkingSidebar** | `features/WorkingSidebar` | Portal panel exists (right panel) | Extend portal: Files tab, Progress section, Agent Overview, Resources section |
| M7 | **CommandMenu** | `features/CommandMenu` | None | Global command palette (Cmd+K), action registry, fuzzy search across agents/topics/pages |
| M8 | **ChatTerminal** | `features/ChatTerminal` | Applet system + remote-cli applet exist | Inline terminal panel in chat, pipe output to agent context, terminal applet integration |
| M9 | **Intervention System** | `store/chat/slices/agentRun` (hetero) | Tool approval exists (approve/deny) | InterventionBar UI, setInterventionDraft/Answers, multi-step intervention flow |
| M10 | **Multi-transport Architecture** | `store/chat/agents/transports/` | Single streaming transport | Abstract transport layer, gateway transport for server-side agents, client transport refactor |
| M11 | **localStorage → Station Migration** | All P3 stores | P3 stores: agentGroups, topicComments, evaluation, customPlugins | Create Station endpoints, migrate stores to API calls, keep localStorage as offline fallback |

---

## Priority & Dependency Order

```
Independent (can parallelize):
  M2 TTS                        ← self-contained, no deps
  M3 Session Groups             ← extends existing session store
  M7 CommandMenu                ← self-contained UI feature
  M9 Intervention System        ← extends chat runtime

Sequential chain:
  M11 localStorage→Station      ← foundation for M1, M4, M5
  M1 Task System               ← needs Station endpoints (from M11 pattern)
  M4 File Integration          ← needs OSS baseline understood
  M5 Connectors for Agent      ← needs connector discovery API

Depends on portal:
  M6 WorkingSidebar            ← extends PortalPanel

Deeper architecture:
  M8 ChatTerminal              ← can start with applet integration
  M10 Multi-transport          ← largest refactor, impacts streaming core
```

**Recommended execution order**: M2 → M3 → M7 → M9 → M11 → M1 → M4 → M5 → M6 → M8 → M10

Rationale: Quick wins first (TTS, SessionGroups, CommandMenu, Intervention), then infrastructure (localStorage migration), then deeper features that depend on it.

---

## M1: Task System

**Topology source**: `store/task` — config, detail, lifecycle, list

**Scope**:
- Task store: createTask, updateTask, deleteTask, fetchTaskList, fetchTaskDetail
- Task lifecycle: run, pause, cancel, complete, fail
- Agent-driven: agent can create/manage tasks during conversation
- Task list UI (sidebar section or dedicated page)
- Task detail panel (in portal)

**Depends on**: M11 (Station endpoints), existing orchestration_service.go

---

## M2: TTS (Text-to-Speech)

**Topology source**: `store/chat/slices/tts`

**Scope**:
- TTS store: speak(messageId), stop(), setVoice(voiceId), isPlaying state
- Web Speech API as v1 backend (speechSynthesis)
- AudioPlayer component inline in message actions
- Voice picker in settings
- "Read Aloud" action already registered in message action bar

**Depends on**: None (self-contained)

---

## M3: Session Groups

**Topology source**: `store/session/slices/sessionGroup`

**Scope**:
- Add sessionGroup to agentTopics store: createGroup, renameGroup, deleteGroup, moveTopicToGroup
- UI: collapsible group headers in topic sidebar
- Drag-and-drop topic into group (optional v1: context menu "Move to group")
- Default groups: "Pinned", "Recent", user-created

**Depends on**: Existing agentTopics store

---

## M4: File Integration for Agent

**Topology source**: `store/file` (chat upload, document reference)

**Scope**:
- Expose existing `oss_upload_agent_attachment_bytes` in agent chat flow
- File picker UI in agent chat composer (attach files)
- Upload progress indicator
- File reference rendering in messages (thumbnail + download link)
- Agent can reference uploaded files in subsequent turns

**Depends on**: Existing OSS infrastructure (`desktop_api.ts` lines 598-690)

---

## M5: Connectors for Agent

**Topology source**: `store/tool/slices/connector`

**Scope**:
- Discover existing desktop connectors (OAuth services, APIs)
- Expose connector list in agent config UI (bind connectors to agent)
- When agent needs connector tool → invoke via existing connector infrastructure
- Connector status display (connected/disconnected) in agent settings

**Depends on**: Existing desktop connector system

---

## M6: WorkingSidebar

**Topology source**: `features/WorkingSidebar`

**Scope**:
- Extend PortalPanel with new views: "Files", "Progress", "Overview"
- Files view: list files attached to current topic/session
- Progress view: show active operations, task status
- Overview: agent config summary, token usage, model info

**Depends on**: Existing PortalPanel

---

## M7: CommandMenu

**Topology source**: `features/CommandMenu`

**Scope**:
- Global Cmd+K command palette overlay
- Action registry: navigate to page, switch agent, open topic, create new chat, search
- Fuzzy search across agents, topics, pages, actions
- Keyboard-driven (arrow keys + enter)
- Recent commands history

**Depends on**: None (self-contained)

---

## M8: ChatTerminal

**Topology source**: `features/ChatTerminal`

**Scope**:
- Inline terminal panel in agent chat (toggle-able)
- Integration with existing remote-cli applet
- Agent can suggest commands; user executes in terminal
- Terminal output can be piped to agent as context
- Resizable panel below chat input

**Depends on**: Existing remote-cli applet (`packages/applets/remote-cli/`)

---

## M9: Intervention System

**Topology source**: `store/chat/slices/agentRun` (heterogeneous intervention)

**Scope**:
- InterventionBar component (appears when agent requests human input mid-turn)
- Store: setInterventionDraft, setInterventionAnswers, submitIntervention, cancelIntervention
- Agent can pause and ask for clarification/approval beyond tool calls
- Multi-step: agent proposes → user edits/approves → agent continues
- Distinct from tool approval (which is binary approve/deny)

**Depends on**: Streaming runtime (needs new event type from Station)

---

## M10: Multi-transport Architecture

**Topology source**: `store/chat/agents/transports/` (client/gateway/hetero)

**Scope**:
- Abstract transport interface: `AgentTransport { send, subscribe, cancel }`
- ClientTransport: current streaming implementation (refactored)
- GatewayTransport: server-side agent execution (Station manages the agent turn entirely)
- Agent config: select transport mode per agent
- Enables: long-running server agents, background tasks, offline execution

**Depends on**: Station-side gateway mode support (new Station feature)

---

## M11: localStorage → Station Migration

**Topology source**: All P3 localStorage stores

**Scope**:
- Create Station endpoints for: agentGroups, topicComments, evaluation datasets, customPlugins
- Migrate stores from localStorage to API calls
- Keep localStorage as offline cache / optimistic update buffer
- Proto definitions for new entities
- Backward-compatible: handle users with existing localStorage data (one-time migration)

**Depends on**: Station subserver development

---

## Progress Tracker

| # | Module | Stage | Date | Notes |
|---|--------|-------|------|-------|
| M2 | TTS | ✅ S5 交付 | 2026-08-14 | Web Speech API, TTSControls, TTSSettings, toggle behavior |
| M3 | Session Groups | ✅ S5 交付 | 2026-08-14 | Store + sidebar groups + context menu "Move to group" |
| M7 | CommandMenu | ✅ S5 交付 | 2026-08-14 | Cmd+K palette, fuzzy search, pages/agents/topics/actions |
| M9 | Intervention | ✅ S5 交付 | 2026-08-14 | InterventionBar (text/choice/confirm), streaming event hook |
| M4 | File Integration | ✅ S5 交付 | 2026-08-14 | Enhanced attachment drafts, progress, retry, MessageAttachments |
| M6 | WorkingSidebar | ✅ S5 交付 | 2026-08-14 | Portal: WorkingFiles + WorkingProgress + AgentOverview views |
| M8 | ChatTerminal | ✅ S5 交付 | 2026-08-14 | Terminal panel, command history, v1 /run forward mode |
| M11 | localStorage→Station | ✅ S5 交付 | 2026-08-14 | Go CRUD (16 endpoints), GORM models, ecosystem.proto |
| M5 | Connectors for Agent | ✅ S5 交付 | 2026-08-14 | Reuse OAuth2Store, binding panel in AgentProfile capabilities |
| M1 | Task System | ✅ S5 交付 | 2026-08-14 | Full CRUD + lifecycle + subtasks + TasksPage + TaskIndicator |
| M10 | Multi-transport | 🔵 S2 设计完成 | 2026-08-14 | Architecture design doc, deferred to P5 |
