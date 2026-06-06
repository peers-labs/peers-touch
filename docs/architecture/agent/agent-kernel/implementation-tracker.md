# Agent Kernel — Implementation Tracker

> **Status**: active
> **Version**: 2026.06
> **Updated**: 2026-06-07
> **Scope**: Peers-Touch Agent Kernel implementation progress, validation, and remaining delivery work

---

## 1. Purpose

This tracker records the implementation path for the Agent Kernel rebuild so the work is not only represented by scattered commits or chat context.

It tracks:

- target architecture status
- completed implementation slices
- current validation status
- remaining delivery backlog
- product constraints that must stay true during implementation

It does not track or modify any thirdparty repository. thirdparty remains a reference source only.

---

## 2. Product Constraints

1. Peers-Touch is the new target product; no historical migration burden is assumed.
2. UI / UX uses Peers-Touch Desktop, LobeUI, PageDescriptor / RuntimeDescriptor, and Peers-Touch interaction patterns.
3. Agent selection uses a Feishu-style list with pinned and normal sections, drag ordering, and direct selection. It must not use a two-step switcher.
4. Provider design uses a unified AgentProvider contract:
   - Eino-native providers are controllable and can expose fine-grained tool, memory, skill, and trace events.
   - CLI-wrapped providers are black-box providers with explicit capability degradation, process controls, workspace controls, and observation-based tracing.
5. Memory follows white-box product behavior: visible, editable, deletable, searchable, and feedback-driven.
6. Skill follows package-based behavior with progressive disclosure and controlled runtime loading.
7. Tools, MCP, A2A, approvals, and CLI bridge calls must be policy-controlled and auditable.

---

## 3. Overall Design Map

| Area | Target Design | Current Status |
|------|---------------|----------------|
| Agent Kernel | Proto-first Station domain, Desktop projection, TurnTrace-first execution | Designed; runtime split started |
| Provider | Unified AgentProvider over Eino-native and CLI-wrapped providers | Initial adapters, CLI controls, traces, capability matrix, and guardrail validation implemented |
| Model Backend | Model/vendor API remains model backend; AgentProvider is the execution strategy above it | Designed; provider UI now distinguishes model backend from AgentProvider control level |
| Runtime | Turn lifecycle, provider call, trace persistence, memory hook, runtime assets projection | Implemented local desktop runtime split, traces, and conversation runtime cards |
| Memory | White-box memory with list/search/persona/events/delete/feedback | Local persistence implemented; feedback UI/API added in current stage |
| Skill | Package + `SKILL.md` + projection + controlled runtime load | Local persisted Skill store and default market install path implemented |
| Tool / MCP | Schema-first registry, policy, approval, audit, dynamic MCP projection | Tool registry metadata, MCP persistence/health, and approval/audit projection implemented |
| A2A / Groups | Agent Card, task state, local/remote transport, group orchestration UI | Local persisted A2A run/task orchestration and Profile UI implemented |
| Desktop UX | LobeHub-style interaction on Peers-Touch framework | Memory page, Agent rail, and Agent Profile center improved |
| Growth / Diagnostics | TurnTrace, feedback, provider degradation, suggestions | Trace persistence, conversation diagnostics, and local growth fallback implemented |

---

## 4. Completed Implementation Slices

| Slice | Delivered Capability | Validation |
|-------|----------------------|------------|
| Desktop agent runtime split | Separated local agent runtime execution into clearer modules | `cargo test --bin peers-touch-desktop agent_runtime` passed previously |
| Provider adapters | Added provider-level adapters for Agent execution | Provider tests passed previously |
| CLI provider process controls | Added command, timeout, cwd, env, and protocol controls | Provider tests passed previously |
| Shared CLI provider runtime | Consolidated CLI execution behavior | Provider/runtime checks passed previously |
| Provider call tracing | Added provider call trace events | Runtime tests passed previously |
| Persistent turn traces | Persisted local agent turn traces | Runtime tests passed previously |
| Local memory persistence | Persisted local memory records, stats, persona, search, events, import/export | Memory commands available locally |
| CLI provider controls in UI | Provider settings expose protocol and CLI control fields | Provider tests and `cargo check` passed previously |
| Memory feedback loop | Added memory feedback command, API, UI controls, trust/count display, and feedback events | Memory tests, `cargo check`, locale JSON, and diff checks passed |
| Agent list redesign | Feishu-style pinned/normal Agent rail, direct selection, pin/unpin, drag ordering, persisted preference | Agent reorder tests and locale JSON checks passed |
| Agent Profile center | Added overview, instructions, model/runtime, capabilities, memory, and task tabs in one Peers-Touch profile surface | Agent locale JSON and targeted TS checks passed |
| Provider capability matrix | Provider settings now show Eino-native vs CLI-wrapped supported/partial/unsupported capability degradation | Provider locale JSON and targeted TS checks passed |
| CLI provider guardrails | Provider save/check validates CLI timeout, command quoting, absolute existing cwd, env shape, and check results return capability/warning metadata | Provider Rust tests and `cargo check` passed |
| Conversation provider trace markers | Agent turns now propagate provider call capability metadata into stream `done` events and show CLI black-box / structured trace markers on assistant messages | Chat locale JSON and targeted TS checks passed |
| Provider guardrail feedback | Provider settings now show backend save validation errors instead of silently swallowing failed debounced saves | Provider locale JSON and targeted TS checks passed |
| Conversation trace detail drawer | Clicking a provider trace marker opens a drawer with turn trace, counts, provider call capability, latency, and fallback metadata | Chat locale JSON, targeted TS check, and diff checks passed |
| Conversation runtime context cards | Assistant messages now show memory used, memory write, loaded skills, projected tools, and projected MCP servers from the turn assets | Agent runtime tests, chat locale JSON, targeted TS check, and diff checks passed |
| CLI bridge and runtime policy | CLI-wrapped providers now persist sandbox preset, retry count, and bridge tool allowlist; runtime injects per-run policy env and ephemeral bridge token | Provider tests, provider locale JSON, targeted TS check, and diff checks passed |
| Skill runtime and market install | Skill store is persisted locally; default Skill market lists installable skills; URL/GitHub/default market installs write into the active Skill store | Skill market Rust tests passed |
| Tool registry policy/audit surface | Built-in and bridge tools now expose category, source, approval requirement, policy, schema, audit event, and replay metadata in Settings and runtime projection | Tool Rust tests, settings locale JSON, targeted TS check, and diff checks passed |
| Local growth diagnostics | Growth dashboard normalizes Station camelCase responses and derives a local snapshot from turn traces, memories, and skills when Station growth APIs are unavailable | Targeted TS check has no `desktop_api` or `AgentGrowthTab` errors; diff checks passed |
| Bridge approval and audit cards | Agent turn runtime now projects approval requests and bridge audit events; assistant messages render bridge governance cards for approval/audit visibility | Agent runtime and MCP Rust tests passed; chat locale JSON and targeted TS checks passed |
| MCP persistence and health projection | MCP servers now persist to local Desktop storage; test results write status, last tested time, errors, and projected tools back into Settings and runtime context | MCP Rust tests, provider locale JSON, targeted TS check, and diff checks passed |
| A2A local orchestration | Added persisted local A2A run/task store, Tauri/dev HTTP commands, Desktop API helpers, and Agent Profile collaboration UI with child Agent selection, artifacts, status updates, audit event display, and local transport projection | `cargo test --bin peers-touch-desktop a2a`, agent locale JSON, and targeted desktop check passed for changed files |
| Knowledge resources | Added persisted Agent knowledge resource bindings with resource type, source, retrieval policy, enable/disable, delete, audit metadata, and Agent Profile Knowledge tab | `cargo test --bin peers-touch-desktop knowledge`, agent locale JSON, and targeted desktop check passed for changed files |
| Agent / MCP marketplace | Added built-in Agent/MCP discovery catalog with publisher/source/trust/risk metadata and Profile install flow through existing Agent and MCP creation APIs | `cargo test --bin peers-touch-desktop marketplace`, agent locale JSON, and targeted desktop check passed for changed files |
| Task board review flow | Added persisted task review store and scheduled task Profile controls for run-now plus accepted / needs-changes / rejected review states | `cargo test --bin peers-touch-desktop task_review`, agent locale JSON, and targeted desktop check passed for changed files |
| Channel bindings | Added persisted Agent-channel bindings with mirror mode, topic isolation policy, execution policy, enable/disable/delete, and Agent Profile Channels tab | `cargo test --bin peers-touch-desktop channel_binding`, agent locale JSON, and targeted desktop check passed for changed files |
| Agent package import/export | Added Agent Profile Package tab that exports Agent config, enabled Skill bundle references, and provider preset to Peers-Touch Agent Package JSON; import creates a new local Agent from package JSON | Agent locale JSON and targeted desktop check passed for changed files |

---

## 5. Current Stage: P0-P2 Local Capability Completion

### Delivered

- P0 end-to-end Agent use is now covered by direct Agent list selection, profile center, conversation runtime cards, memory visibility, provider traces, and bridge approval/audit cards.
- P1 core power features now have local persisted implementations for Skill packages, Tool registry metadata, MCP health, A2A orchestration, and Knowledge resource bindings.
- P2 ecosystem and polish now have local implementations for Growth fallback diagnostics, Agent/MCP marketplace discovery, scheduled task review flow, Channel bindings, and Agent package import/export.
- All new P0-P2 surfaces are tracked in Agent Profile or Settings and expose policy/audit/trust metadata where relevant.

### Acceptance Criteria

- Users can select an Agent directly, inspect its runtime/memory/skills/tools/MCP/collaboration/knowledge/channel/package state, and start work without a switcher.
- CLI-wrapped and Eino-native provider behavior is represented through explicit capability degradation, policy controls, trace details, and audit cards.
- Agent collaboration, knowledge, marketplace, task review, channel binding, and package flows are locally usable and persisted where stateful.
- Tracker documents the implementation path and validation status instead of relying on chat context.

---

## 6. Remaining Delivery Backlog

### P0: Make Agent Usable End-to-End

| Task | Outcome |
|------|---------|
| Conversation projection | Done: message stream, tool cards, memory use/write markers, provider trace detail drawer |
| CLI bridge audit cards | Done: approval cards and bridge audit events |

### P1: Add Core Power Features

| Task | Outcome |
|------|---------|
| Skill package runtime | Done: persisted install/list/view/toggle/load Skill packages with progressive disclosure |
| Tool registry | Done: schema-first tools with policy, approval flags, audit names, and replay metadata |
| MCP server management | Done: custom MCP servers, projected tools, persistence, health/status UI |
| A2A local orchestration | Done: Agent group calls, child task tracking, local transport abstraction, Profile UI |
| Knowledge resources | Done: bind documents/projects/notebooks to agents, expose retrieval policy in profile |

### P2: Polish, Growth, and Ecosystem

| Task | Outcome |
|------|---------|
| Growth dashboard | Done: feedback, failure attribution, local turn/memory/skill diagnostics fallback |
| Marketplace | Done: Skill discovery/install plus Agent / MCP discovery with trust metadata and install flow |
| Task board | Done: scheduled runs, run-now action, and review/acceptance flow |
| Channel bindings | Done: external channel mirroring, topic isolation, channel-specific execution policies |
| Import/export | Done: Agent package JSON with skill bundle references and provider presets |

### Future Hardening

| Area | Remaining Work |
|------|----------------|
| Remote sync | Promote local Desktop stores to Station-backed sync once server contracts are ready |
| Runtime execution depth | Execute remote A2A transports and channel bot policies beyond local state/config surfaces |
| Full TS gate | Fix unrelated App/social/media/navigation TypeScript failures outside this Agent Kernel slice |

---

## 7. Validation Log

| Date | Command | Result | Notes |
|------|---------|--------|-------|
| 2026-06-07 | `cargo test --bin peers-touch-desktop memory` | Passed | 2 memory feedback tests passed; existing warnings remain |
| 2026-06-07 | `cargo test --bin peers-touch-desktop agents` | Passed | 2 agent tests passed, including pin/order persistence; existing warnings remain |
| 2026-06-07 | `python3 -m json.tool packages/locales/en/agent.json` | Passed | Locale JSON valid |
| 2026-06-07 | `python3 -m json.tool packages/locales/zh-CN/agent.json` | Passed | Locale JSON valid |
| 2026-06-07 | `npm --prefix apps/desktop run check` | Failed outside current slice | No `AgentProfilePage` or `agent.json` errors; failures remain in existing App/social/media/navigation areas |
| 2026-06-07 | `cargo check --quiet` | Passed | Existing warnings remain |
| 2026-06-07 | `python3 -m json.tool packages/locales/en/memory.json` | Passed | Locale JSON valid |
| 2026-06-07 | `python3 -m json.tool packages/locales/zh-CN/memory.json` | Passed | Locale JSON valid |
| 2026-06-07 | `git diff --check` | Passed | No whitespace errors |
| 2026-06-07 | `npm --prefix apps/desktop run check` | Failed outside current slice | No `MemoryPage`, `desktop_api`, `memory_feedback`, or `feedbackMemory` errors; failures remain in existing App/social/media/navigation areas |
| 2026-06-07 | `cargo test --bin peers-touch-desktop provider` | Passed | 52 provider-related tests passed, including CLI guardrail and capability matrix tests; existing warnings remain |
| 2026-06-07 | `cargo check --quiet` | Passed | Existing warnings remain |
| 2026-06-07 | `python3 -m json.tool packages/locales/en/provider.json` | Passed | Locale JSON valid |
| 2026-06-07 | `python3 -m json.tool packages/locales/zh-CN/provider.json` | Passed | Locale JSON valid |
| 2026-06-07 | `npm --prefix apps/desktop run check` | Failed outside current slice | No `ProviderDetail`, `provider.ts`, `desktop_api`, or `provider.json` errors; failures remain in existing App/social/media/navigation areas |
| 2026-06-07 | Forbidden reference scan | Passed | No forbidden reference string found |
| 2026-06-07 | `python3 -m json.tool packages/locales/en/chat.json` | Passed | Locale JSON valid |
| 2026-06-07 | `python3 -m json.tool packages/locales/zh-CN/chat.json` | Passed | Locale JSON valid |
| 2026-06-07 | `npm --prefix apps/desktop run check` | Failed outside current slice | No `MessageBubble`, `BuilderPanel`, `store/chat`, `desktop_api`, or `chat.json` errors; failures remain in existing App/social/media/navigation areas |
| 2026-06-07 | `git diff --check` | Passed | No whitespace errors |
| 2026-06-07 | `python3 -m json.tool packages/locales/en/provider.json` | Passed | Locale JSON valid |
| 2026-06-07 | `python3 -m json.tool packages/locales/zh-CN/provider.json` | Passed | Locale JSON valid |
| 2026-06-07 | `npm --prefix apps/desktop run check` | Failed outside current slice | No `ProviderDetail` or `provider.json` errors; failures remain in existing App/social/media/navigation areas |
| 2026-06-07 | `git diff --check` | Passed | No whitespace errors |
| 2026-06-07 | `python3 -m json.tool packages/locales/en/chat.json` | Passed | Locale JSON valid |
| 2026-06-07 | `python3 -m json.tool packages/locales/zh-CN/chat.json` | Passed | Locale JSON valid |
| 2026-06-07 | `npm --prefix apps/desktop run check` | Failed outside current slice | No `MessageBubble`, `desktop_api`, or `chat.json` errors; failures remain in existing App/social/media/navigation areas |
| 2026-06-07 | `git diff --check` | Passed | No whitespace errors |
| 2026-06-07 | `cargo test --bin peers-touch-desktop agent_runtime` | Passed | 11 agent runtime/provider/trace tests passed; existing warnings remain |
| 2026-06-07 | `python3 -m json.tool packages/locales/en/chat.json` | Passed | Locale JSON valid |
| 2026-06-07 | `python3 -m json.tool packages/locales/zh-CN/chat.json` | Passed | Locale JSON valid |
| 2026-06-07 | `npm --prefix apps/desktop run check` | Failed outside current slice | No `MessageBubble`, `store/chat`, `desktop_api`, `chat.json`, or `agent_runtime` errors; failures remain in existing App/social/media/navigation areas |
| 2026-06-07 | `git diff --check` | Passed | No whitespace errors |
| 2026-06-07 | `cargo test --bin peers-touch-desktop provider` | Passed | 55 provider-related tests passed, including CLI policy, retry, and bridge env tests; existing warnings remain |
| 2026-06-07 | `python3 -m json.tool packages/locales/en/provider.json` | Passed | Locale JSON valid |
| 2026-06-07 | `python3 -m json.tool packages/locales/zh-CN/provider.json` | Passed | Locale JSON valid |
| 2026-06-07 | `npm --prefix apps/desktop run check` | Failed outside current slice | No `ProviderDetail`, `store/provider`, `desktop_api`, `provider.json`, `cli_runtime`, or `agent_runtime/provider` errors; failures remain in existing App/social/media/navigation areas |
| 2026-06-07 | `git diff --check` | Passed | No whitespace errors |
| 2026-06-07 | `cargo test --bin peers-touch-desktop skills` | Passed | 2 Skill market tests passed, including default market listing and install; existing warnings remain |
| 2026-06-07 | `cargo test --bin peers-touch-desktop tools` | Passed | 2 Tool registry tests passed, including bridge tool audit metadata; existing warnings remain |
| 2026-06-07 | `python3 -m json.tool packages/locales/en/settings.json` | Passed | Locale JSON valid |
| 2026-06-07 | `python3 -m json.tool packages/locales/zh-CN/settings.json` | Passed | Locale JSON valid |
| 2026-06-07 | `npm --prefix apps/desktop run check` | Failed outside current slice | No `SettingsPage`, `desktop_api`, `settings.json`, or `tools` errors; failures remain in existing App/social/media/navigation areas |
| 2026-06-07 | `git diff --check` | Passed | No whitespace errors |
| 2026-06-07 | `npm --prefix apps/desktop run check` | Failed outside current slice | No `AgentGrowthTab` or `desktop_api` errors; failures remain in existing App/social/media/navigation areas |
| 2026-06-07 | `git diff --check` | Passed | No whitespace errors |
| 2026-06-07 | `cargo test --bin peers-touch-desktop agent_runtime` | Passed | 11 agent runtime/provider/trace tests passed; existing warnings remain |
| 2026-06-07 | `cargo test --bin peers-touch-desktop mcp` | Passed | MCP policy projection test passed; existing warnings remain |
| 2026-06-07 | `python3 -m json.tool packages/locales/en/chat.json` | Passed | Locale JSON valid |
| 2026-06-07 | `python3 -m json.tool packages/locales/zh-CN/chat.json` | Passed | Locale JSON valid |
| 2026-06-07 | `npm --prefix apps/desktop run check` | Failed outside current slice | No `MessageBubble`, `desktop_api`, `agent_runtime`, `mcp/mod`, or `chat.json` errors; failures remain in existing App/social/media/navigation areas |
| 2026-06-07 | `git diff --check` | Passed | No whitespace errors |
| 2026-06-07 | `cargo test --bin peers-touch-desktop mcp` | Passed | 2 MCP tests passed, including health persistence; existing warnings remain |
| 2026-06-07 | `python3 -m json.tool packages/locales/en/provider.json` | Passed | Locale JSON valid |
| 2026-06-07 | `python3 -m json.tool packages/locales/zh-CN/provider.json` | Passed | Locale JSON valid |
| 2026-06-07 | `npm --prefix apps/desktop run check` | Failed outside current slice | No `MCPTab`, `desktop_api`, `mcp/mod`, or `provider.json` errors; failures remain in existing App/social/media/navigation areas |
| 2026-06-07 | `git diff --check` | Passed | No whitespace errors |
| 2026-06-07 | `cargo fmt` | Passed | Rust formatting applied after A2A / Knowledge / Marketplace / Task board / Channel binding modules |
| 2026-06-07 | `cargo test --bin peers-touch-desktop a2a` | Passed | 2 A2A local orchestration tests passed; existing warnings remain |
| 2026-06-07 | `cargo test --bin peers-touch-desktop knowledge` | Passed | Knowledge resource bind/update test passed; existing warnings remain |
| 2026-06-07 | `cargo test --bin peers-touch-desktop marketplace` | Passed | Agent/MCP marketplace filtering and trust metadata test passed; existing warnings remain |
| 2026-06-07 | `cargo test --bin peers-touch-desktop task_review` | Passed | Task review upsert test passed; existing warnings remain |
| 2026-06-07 | `cargo test --bin peers-touch-desktop channel_binding` | Passed | Channel binding upsert/toggle test passed; existing warnings remain |
| 2026-06-07 | `python3 -m json.tool packages/locales/en/agent.json` | Passed | Locale JSON valid after Profile P0-P2 tabs |
| 2026-06-07 | `python3 -m json.tool packages/locales/zh-CN/agent.json` | Passed | Locale JSON valid after Profile P0-P2 tabs |
| 2026-06-07 | `npm --prefix apps/desktop run check` | Failed outside current slice | No `AgentProfilePage`, `desktop_api`, `agent.json`, `a2a`, `knowledge`, `marketplace`, `channel_binding`, or `task_board` errors; failures remain in existing App/social/media/navigation areas |

---

## 8. Open Risks

1. Full Desktop TypeScript check currently has unrelated pre-existing failures outside this Agent Kernel slice; use targeted checks until the unrelated App/social/media/navigation issues are scheduled.
2. CLI-wrapped providers cannot guarantee the same internal tool loop fidelity as Eino-native providers. The contract models this as explicit capability degradation instead of pretending they are equally controllable.
3. P1/P2 ecosystem state is implemented as local Desktop stores and UI flows. Remote sync, remote A2A transport, and production channel execution should be promoted when Station/server contracts are available.
4. Agent Profile now has many capability tabs. A follow-up UX pass should consolidate dense tabs once product priorities settle, without regressing direct Feishu-style Agent selection.
