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
| Tool / MCP | Schema-first registry, policy, approval, audit, dynamic MCP projection | Designed; implementation pending |
| A2A / Groups | Agent Card, task state, local/remote transport, group orchestration UI | Designed; implementation pending |
| Desktop UX | LobeHub-style interaction on Peers-Touch framework | Memory page, Agent rail, and Agent Profile center improved |
| Growth / Diagnostics | TurnTrace, feedback, provider degradation, suggestions | Trace persistence and conversation diagnostics implemented; dashboards pending |

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

---

## 5. Current Stage: Skill Runtime and Market Install

### Delivered

- Local Skill store now persists to Desktop data storage instead of resetting to seed data on restart.
- Skill create, update, delete, toggle, URL import, GitHub import, and market install all write through the same Skill store.
- Default local Skill market is available without remote setup.
- Market list/search/detail/install paths return concrete installable Skill package data.
- Installed market Skills become visible to the Agent runtime through the existing enabled Skill projection path.

### Acceptance Criteria

- Skill packages survive Desktop restart.
- Market install is not a stub; it creates or updates an enabled Skill record.
- Runtime prompt Skill projection reads the same installed/toggled Skill records.
- Default market works offline and uses `thirdparty` only as a generic reference concept in docs.
- Rust tests cover listing and installing default market Skills.

---

## 6. Remaining Delivery Backlog

### P0: Make Agent Usable End-to-End

| Task | Outcome |
|------|---------|
| Conversation projection | Message stream, tool cards, memory use/write markers, provider trace detail drawer |
| CLI bridge audit cards | Approval cards and bridge audit events |

### P1: Add Core Power Features

| Task | Outcome |
|------|---------|
| Skill package runtime | Persisted install/list/view/toggle/load Skill packages with progressive disclosure |
| Tool registry | Schema-first tools with policy, approval, audit, and replayable events |
| MCP server management | Add custom MCP servers, project tools into Tool registry, health/status UI |
| A2A local orchestration | Agent group calls, child task tracking, local/remote transport abstraction |
| Knowledge resources | Bind documents/projects to agents, expose retrieval policy in profile |

### P2: Polish, Growth, and Ecosystem

| Task | Outcome |
|------|---------|
| Growth dashboard | Feedback, failure attribution, memory/skill recommendations |
| Marketplace | Skill discovery/install implemented locally; Agent / MCP discovery and trust metadata still pending |
| Task board | Async tasks, scheduled runs, review/acceptance flow |
| Channel bindings | External channel mirroring, topic isolation, channel-specific policies |
| Import/export | Agent packages, skill bundles, provider presets |

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

---

## 8. Open Risks

1. Full Desktop TypeScript check currently has unrelated pre-existing failures outside this Agent Kernel slice; use targeted checks until the unrelated issues are scheduled.
2. CLI-wrapped providers cannot guarantee the same internal tool loop fidelity as Eino-native providers. The contract must model capability degradation explicitly instead of pretending they are equally controllable.
3. Current CLI guardrails validate config shape, process controls, sandbox preset, retry policy, and bridge allowlist, but approval card UX still needs dedicated delivery.
4. Conversation now has provider trace details and runtime context cards, but bridge/tool audit approval cards still need dedicated UI.
