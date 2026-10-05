# Agent LobeHub Blueprint Rebuild

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-06-16 | **Updated**: 2026-06-16
> **Owner**: Peers-Touch Agent Team
> **Module**: `apps/desktop/`, `apps/desktop/src-tauri/src/application/{agent_turn,mcp,skills,tools,agents}/`, `apps/station/app/subserver/agent/`

---

## 1. Document Scope

This document defines the formal architecture target for rebuilding Peers-Touch Agent capabilities with LobeHub as the product and engineering benchmark.

This document covers:

- UI / UX capability mapping from LobeHub to Peers-Touch Desktop.
- Desktop Web, Desktop Rust, and Station backend responsibility boundaries.
- Required capability closure for chat, tools, MCP, skills, agent configuration, knowledge, state management, voice, connectors, and diagnostics.
- Architectural decisions that constrain implementation plans.

This document does not define:

- Low-level component styling details. Those belong to `docs/client/desktop/` and Desktop coding guides.
- Station service implementation details already covered by existing Agent architecture documents.
- Temporary investigation notes. Those may live in `.trae/documents/`, but they are not source of truth.

---

## 2. Background

The current Peers-Touch Agent experience is behind the intended product direction:

1. Streaming is not truly streaming in Desktop Web. The current frontend path calls `chat_completion_once` and simulates stream events after receiving a full response.
2. Several Desktop Rust Agent modules are local stubs or partial local stores, especially MCP, tools, skills market, cron, and agent persistence.
3. Agent UI state is concentrated in large frontend modules, making tool, skill, runtime, and chat responsibilities hard to reason about independently.
4. LobeHub has a mature tool / plugin / MCP / agent settings ecosystem that should be used as a benchmark, not copied as-is.
5. Peers-Touch already has strong Station-side Agent services. The rebuild must use those strengths instead of duplicating Station responsibilities in Desktop.

The target is not “clone LobeHub”. The target is:

- LobeHub-level product completeness.
- Peers-Touch architecture boundaries.
- Auditable, policy-controlled, federated Agent runtime.

---

## 3. Core Principles

1. **Station owns Agent intelligence.** Turn loop, memory, skill security, provider fallback, growth, delegation, and trace persistence remain Station-owned unless a capability is explicitly local-only.
2. **Desktop Rust owns local capability execution.** MCP process management, local file access, local tool execution, OS integration, and secure local persistence belong in Desktop Rust.
3. **Desktop Web owns interaction and projection.** UI renders runtime state, approvals, progress, configuration, and diagnostics. It must not become the hidden runtime owner.
4. **Every powerful action is observable.** Tool calls, MCP calls, approvals, errors, retries, and fallbacks must project into trace and UI.
5. **LobeHub is the benchmark, Peers-Touch is the product.** We borrow capability shape and UX maturity while preserving Client -> Model -> Station boundaries.

---

## 4. Capability Map

Legend:

- `ready`: already functional enough to retain.
- `partial`: implemented or designed, but not complete enough for target UX.
- `missing`: must be built.

| Domain | LobeHub Benchmark | Peers-Touch Current State | Target |
|---|---|---|---|
| Chat streaming | Token-level streaming and progressive events | partial: frontend simulates streaming in some paths | True stream from provider / Station / Rust to Web with cancellation |
| Turn loop | Multi-round model -> tool -> model loop | ready in Station `TurnService` | Keep Station-owned, project trace to Desktop |
| Tool execution | Builtin, plugin, MCP, connector tools | partial: Station tools exist; Desktop tools were stub-like | Unified tool registry projection plus local execution bridge |
| MCP | stdio, HTTP, SSE, cloud / remote variants | partial: initial Desktop Rust stdio/http/sse probe now exists | Persistent MCP server management, health, tools, execution, audit |
| Skill system | CRUD, import, marketplace, per-agent binding | partial: Station strong; Desktop local/market gaps | Station-backed or synced skill packages with import and trust metadata |
| Agent settings | Rich prompt, model, plugin, opening message, chat config | partial: settings modal exists | Modular Agent Profile / Settings surfaces |
| Agent management | CRUD, default agent, favorites, marketplace | partial: UI exists; local persistence gaps | Persisted agents, pinning, package import/export, market install |
| Knowledge base | Documents bound to agents and injected into context | missing / partial framework | Bind resources, retrieval policy, injection trace |
| Tool call UI | Progress, approval, collapsed results, errors | partial | Rich cards for progress, result, approval, audit, replay |
| State management | Separate chat / agent / tool stores with selectors | partial / monolithic areas remain | Split runtime ownership and UI stores by domain |
| UX polish | Hotkeys, artifacts, wide screen, portal, search | partial | Prioritized UX parity where it affects Agent work completion |

---

## 5. Target Architecture

```text
Desktop Web
  ├─ Chat / Agent Profile / Settings / Tool Cards
  ├─ chatStore: message projection and composer state
  ├─ agentStore: agent profile, config, selection, package state
  └─ toolStore: tools, MCP servers, approvals, audit projection

Desktop Rust
  ├─ agent_turn: stream forwarding, cancellation, turn assets projection
  ├─ mcp: stdio/http/sse server management, health, tools, execution
  ├─ tools: local builtin and bridge tool registry
  ├─ skills: local package cache / import bridge where needed
  └─ persistence: local Desktop state that must survive restart

Station Agent Subserver
  ├─ TurnService: prompt, provider call, tool loop, recovery, trace
  ├─ MemoryService: memory CRUD, search, feedback, snapshots
  ├─ SkillService: skill CRUD, versions, guard scan, rollback
  ├─ ToolRegistryService: Station tool dispatch
  ├─ Growth / Review / Delegation services
  └─ PostgreSQL persistence
```

The important boundary is directional:

- Desktop Web must call Desktop Rust or Station-facing service APIs; it must not secretly own long-lived runtime behavior.
- Desktop Rust may execute local capabilities and bridge to Station.
- Station remains authoritative for federated Agent execution and persisted Agent intelligence.

---

## 6. End-To-End Implementation Architecture

The implementation architecture is a Peers-Touch Agent Kernel, not a feature-by-feature frontend clone.

The kernel has five layers:

```text
┌───────────────────────────────────────────────────────────────────────┐
│ Desktop Web: Agent Workbench                                           │
│ Pages are renderers; runtimes own projections.                         │
│ Chat, Agent Profile, Tool/MCP/Skill panels, approvals, diagnostics.     │
└───────────────────────────────▲───────────────────────────────────────┘
                                │ Tauri commands + typed events
┌───────────────────────────────┴───────────────────────────────────────┐
│ Desktop Rust: Local Agent Runtime                                      │
│ Local capability execution, MCP stdio/http/sse, workspace policy,       │
│ secure local persistence, Station stream bridge, local audit events.     │
└───────────────────────────────▲───────────────────────────────────────┘
                                │ HTTP/SSE/gateway + protobuf/domain DTOs
┌───────────────────────────────┴───────────────────────────────────────┐
│ Station Agent Subserver: Agent Intelligence Runtime                    │
│ Turn loop, prompt assembly, memory, skills, tool registry, provider     │
│ fallback, delegation, growth, review, durable trace, policy decisions.  │
└───────────────────────────────▲───────────────────────────────────────┘
                                │ domain persistence / model access
┌───────────────────────────────┴───────────────────────────────────────┐
│ Model + Storage Layer                                                   │
│ Proto/domain contracts, PostgreSQL, vector/index storage, providers,    │
│ OAuth connector credentials, object storage, knowledge embeddings.       │
└───────────────────────────────────────────────────────────────────────┘

External Capability Plane:
  MCP servers, OAuth connectors, plugin packages, CLI providers, file system,
  clipboard, shell-safe local commands, and future marketplace sources.
```

### 6.1 Source-Of-Truth Matrix

| State / Capability | Source of Truth | Projection / Executor | Rule |
|---|---|---|---|
| Conversation, messages, turn trace | Station | Desktop Web runtime projection | Desktop may cache but not own durable truth |
| Turn orchestration | Station | Desktop Rust stream bridge | Desktop does not reimplement the Agent turn loop |
| Agent config | Station when cross-device; Desktop only for device-local draft/preferences | Desktop Web Agent runtime | Persisted Agent identity and bindings must converge to Station |
| Agent selection, pinning, local layout | Desktop local preference unless shared explicitly | Desktop Web Agent runtime | UI preference, not business truth |
| Memory | Station | Desktop Web projection | Memory CRUD/evaluation remains Station-owned |
| Skill package trust, scan, versions | Station | Desktop Rust cache + Desktop Web projection | Local cache cannot override trust decision |
| MCP server config | Station policy + Desktop local endpoint details | Desktop Rust executor | Secrets and local commands stay device-local; enabled binding is Agent policy |
| MCP tool discovery/execution | Desktop Rust for local server execution; Station for turn decision and trace | Desktop Web tool projection | Every execution returns structured trace/audit |
| Builtin local tools | Desktop Rust | Desktop Web approval cards | Device-privileged execution never happens in Web |
| OAuth connectors | Station owns credential/session truth | Desktop Web authorization UX; Desktop Rust callback bridge where needed | Tokens are never prompt-visible or log-visible |
| Knowledge resources | Station for shared resources; Desktop Rust for local file handles | Desktop Web knowledge projection | Retrieval/injection must be traceable |
| Artifacts | Station or Desktop Rust depending on storage target | Desktop Web artifact surface | Artifact provenance links back to turn/message |
| Voice input/output | Desktop Rust device adapter + provider capability | Desktop Web voice controls | Audio device access is local; transcription/synthesis follows provider policy |
| Diagnostics/replay | Station trace + Desktop Rust local audit | Desktop Web diagnostics | Replay must not depend on hidden component state |

### 6.2 Turn Execution Path

Every Agent turn follows one canonical path:

```text
User action in Desktop Web
  → agentRuntime/chatRuntime validates UI state and creates a turn request
  → Desktop Rust agent_turn opens a stream to Station
  → Station TurnService assembles prompt from Agent config, memory, skills, context, knowledge
  → Provider call streams model output
  → Tool call requested?
      → Station ToolRegistry resolves owner and policy
      → local tool/MCP needed?
          → Station emits local execution request through Desktop Rust bridge
          → Desktop Rust checks workspace, approval, transport, and audit policy
          → Desktop Rust executes builtin/MCP/plugin/connector bridge where allowed
          → Result returns to Station TurnService
      → Station continues model/tool loop
  → Station persists TurnTrace, messages, memory/skill attribution, diagnostics
  → Desktop Rust forwards stream events to Desktop Web
  → Desktop Web runtimes update projections; pages render only
```

The rule is strict: Desktop may execute local capabilities, but Station owns the turn state machine and final trace.

### 6.3 Runtime Projection Architecture

Desktop Agent UI must follow `docs/client/desktop/runtime-projections.md`:

- `agentRuntime`: selected Agent, Agent list projection, Profile state, bindings, package state.
- `chatRuntime`: conversations, messages, stream events, cancellation, search projection.
- `toolRuntime`: builtin tools, MCP tools, approval requests, audit events, execution status.
- `skillRuntime`: skill packages, trust metadata, install/import status, per-Agent bindings.
- `knowledgeRuntime`: resource bindings, indexing status, retrieval diagnostics.
- `connectorRuntime`: OAuth connectors, third-party connector status, credential health projection.
- `voiceRuntime`: STT/TTS availability, audio device permissions, active voice state.

Pages are pure renderers over these runtimes. Any page that stays correct only because it calls a mount-time fetch is incomplete.

### 6.4 Contract And Protocol Architecture

Implementation must preserve the project contract direction:

1. **Proto/domain first for shared contracts.** Shared Agent, Tool, Skill, Memory, Knowledge, Connector, and TurnTrace models must be defined in domain contracts before code creates duplicate manual shapes.
2. **Station HTTP/SSE APIs are business APIs.** They expose turn execution, memory, skills, knowledge, connector, marketplace, and trace operations.
3. **Tauri commands are local capability APIs.** They expose device-local execution, MCP process management, workspace, file/clipboard, audio, and secure local storage.
4. **Desktop service modules are adapters.** They translate UI actions into Station or Tauri calls and must not become domain owners.
5. **Events are typed runtime events.** Stream events include text, thinking, tool_call, tool_result, approval_request, audit, memory, skill, knowledge, provider, error, and done.

### 6.5 Policy, Security, And Audit Architecture

All powerful capabilities share one policy pipeline:

```text
Capability request
  → owner resolution
  → schema validation
  → Agent policy check
  → workspace / connector / credential policy check
  → approval decision if required
  → execution
  → structured result
  → audit event
  → TurnTrace attribution
```

This applies to builtin tools, MCP tools, plugins, OAuth connectors, CLI providers, local files, clipboard, shell-safe actions, voice capture, and knowledge ingestion.

No connector token, secret, private file content, or credential may be logged, injected into prompts by default, or stored in frontend state.

### 6.6 Implementation Package Boundaries

The intended code boundaries are:

```text
apps/desktop/src/
  runtimes/agentRuntime.ts
  runtimes/chatRuntime.ts
  runtimes/toolRuntime.ts
  runtimes/skillRuntime.ts
  runtimes/knowledgeRuntime.ts
  runtimes/connectorRuntime.ts
  runtimes/voiceRuntime.ts
  services/agent/*
  services/chat/*
  services/tools/*
  services/mcp/*
  services/skills/*
  services/knowledge/*
  services/connectors/*
  pages/Agent*.descriptor.tsx

apps/desktop/src-tauri/src/application/
  agent_turn/
  mcp/
  tools/
  skills/
  knowledge/
  connectors/
  voice/
  workspace/
  audit/

apps/station/app/subserver/agent/
  domain/
  handler/
  service/
  infrastructure/persistence/
```

Large modules may keep compatibility exports while being split, but new capability work must land in the owning package.

---

## 7. Domain Responsibilities

### 7.1 Desktop Web

Desktop Web is responsible for:

- Rendering messages, streaming text, thinking, tool calls, approvals, MCP health, and trace cards.
- Agent list, Agent Profile, Agent Settings, Skill/MCP/Tool configuration surfaces.
- User choices: approve, deny, retry, cancel, enable/disable, bind/unbind.
- Local UI state that has no runtime authority.

Desktop Web must not:

- Spawn MCP processes directly.
- Execute local files or OS-level actions directly.
- Patch stale runtime state with mount-time refetches when a runtime projection exists.

### 7.2 Desktop Rust

Desktop Rust is responsible for:

- MCP transport implementations:
  - `stdio`: spawn and frame JSON-RPC over process stdio.
  - `http`: JSON-RPC over HTTP POST.
  - `sse`: JSON-RPC-compatible event-stream response handling.
- MCP health checks, tool discovery, local persistence, and execution dispatch.
- Local builtin tools that require OS access.
- Streaming and cancellation bridge between Station/provider and Desktop Web.
- Policy and audit events for local execution.

### 7.3 Station

Station is responsible for:

- Turn orchestration and multi-round tool loop.
- Prompt assembly from memory, skills, context references, and compression.
- Provider fallback, credential rotation, error recovery, delegation, review, and growth metrics.
- Durable persistence of Agent memory, skill versions, turn traces, feedback, and conversations.

---

## 8. Functional Requirements

### P0 Requirements

| ID | Requirement | Acceptance |
|---|---|---|
| P0-1 | True streaming | Assistant text and runtime events arrive progressively; cancellation stops upstream work where supported |
| P0-2 | Store / runtime ownership split | Chat, agent, tool, and MCP state have clear owners and no hidden cross-domain mutations |
| P0-3 | Service modularization | Agent, chat, tool, skill, MCP APIs are not expanded through one unbounded API file |

### P1 Requirements

| ID | Requirement | Acceptance |
|---|---|---|
| P1-1 | MCP stdio/http/sse management | User can create, test, enable, disable, delete, and inspect MCP servers for all three transports |
| P1-2 | MCP tool discovery | `tools/list` results are persisted/projected and visible in UI |
| P1-3 | MCP tool execution | Agent tool calls can dispatch to the selected MCP server through policy checks |
| P1-4 | Tool approval | Sensitive tools pause for explicit user approval and record decision trace |
| P1-5 | Tool UI | Tool calls show status, progress, result summary, error, and audit metadata |

### P2 Requirements

| ID | Requirement | Acceptance |
|---|---|---|
| P2-1 | Skill package persistence | Skills survive restart and expose trust/security metadata |
| P2-2 | Skill import | GitHub, URL, ZIP, or curated source install routes are explicit and auditable |
| P2-3 | Per-agent binding | Agent config declares enabled tools, MCP servers, skills, and policy |
| P2-4 | Agent persistence | Agent CRUD and selection survive restart and actor boundary changes |

### P3 Requirements

| ID | Requirement | Acceptance |
|---|---|---|
| P3-1 | Agent Profile / Settings redesign | Agent configuration is split into understandable tabs, not one overloaded modal |
| P3-2 | Prompt editor | System prompt editing supports token awareness and variables where relevant |
| P3-3 | Thinking and trace UI | Reasoning, memory use, tools, provider fallback, and errors are visible without log digging |

### P4 Requirements

| ID | Requirement | Acceptance |
|---|---|---|
| P4-1 | Knowledge resources | Documents/projects/resources can be bound to Agents and injected by policy |
| P4-2 | Artifacts | Generated code/document artifacts render as first-class outputs |
| P4-3 | Agent / MCP marketplace | Curated discovery supports trust/risk metadata and install flow |

### P5 Requirements

P5 is mandatory parity work after the earlier foundations exist. It is not optional backlog.

| ID | Requirement | Acceptance |
|---|---|---|
| P5-1 | TTS / STT | Voice input and assistant output are available where provider/runtime support exists |
| P5-2 | Realtime gateway | Bidirectional realtime behavior, reconnect, cancellation, and backpressure are implemented where needed |
| P5-3 | Heterogeneous Agent / CLI provider | Non-native Agent providers expose explicit capability degradation and observable runtime control |
| P5-4 | OAuth connectors | OAuth-backed external services integrate through secure connector ownership and tool policy |
| P5-5 | Third-party connector framework | Composio-like connector expansion uses the same approval, audit, and trust pipeline |
| P5-6 | Developer diagnostics | Agent turns can be exported, inspected, and replayed without hidden local state |

---

## 9. Current Implementation Notes

As of 2026-06-16:

- Station Agent services are comparatively strong and should be reused.
- Desktop Rust MCP now has the first real foundation for `stdio`, `http`, and `sse` connection tests and tool discovery.
- Desktop Web MCP UI exposes the three transport types.
- MCP tool execution into the Agent turn loop is not complete yet.
- This document supersedes `.trae/documents/agent-rebuild-lobehub-blueprint.md` as the formal architecture source. The `.trae` document remains a work note.

---

## 10. Related Documents

- [Agent architecture README](./README.md)
- [Agent rebuild execution plan](./execution-plans/20260616-agent-lobehub-rebuild.md)
- [Agent self-growth architecture](./agent-self-growth-architecture.md)
- [Agent memory architecture](./agent-memory-architecture.md)
- [Station/Desktop scope boundary](../../platform/station-desktop-boundary.md)
- [Desktop runtime projections](../../../client/desktop/runtime-projections.md)
