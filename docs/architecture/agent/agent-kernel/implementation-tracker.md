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
| Runtime | Turn lifecycle, provider call, trace persistence, memory hook | Implemented local desktop runtime split and traces |
| Memory | White-box memory with list/search/persona/events/delete/feedback | Local persistence implemented; feedback UI/API added in current stage |
| Skill | Package + `SKILL.md` + projection + controlled runtime load | Designed; implementation pending |
| Tool / MCP | Schema-first registry, policy, approval, audit, dynamic MCP projection | Designed; implementation pending |
| A2A / Groups | Agent Card, task state, local/remote transport, group orchestration UI | Designed; implementation pending |
| Desktop UX | LobeHub-style interaction on Peers-Touch framework | Memory page, Agent rail, and Agent Profile center improved |
| Growth / Diagnostics | TurnTrace, feedback, provider degradation, suggestions | Trace persistence implemented; dashboards pending |

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

---

## 5. Current Stage: Provider Guardrail Feedback

### Delivered

- Provider settings debounced save now records backend errors in component state.
- Failed provider saves are displayed inline with an error alert.
- Successful provider saves clear the previous error state.
- Switching providers clears stale save errors.
- This makes CLI guardrail failures such as invalid timeout, cwd, env, or command quoting visible immediately in the settings page.
- Localization:
  - English and Chinese provider save error labels.

### Acceptance Criteria

- Backend guardrail errors are not silently swallowed by Provider settings autosave.
- The user can see why a CLI-wrapped provider configuration did not persist.
- JSON locales remain valid.
- Targeted TypeScript check has no errors in the changed files.

---

## 6. Remaining Delivery Backlog

### P0: Make Agent Usable End-to-End

| Task | Outcome |
|------|---------|
| Conversation projection | Message stream, tool cards, memory use/write markers, provider trace detail drawer |
| CLI bridge hardening | Restricted bridge token lifecycle, tool allowlist UI, approval cards, and bridge audit events |
| CLI runtime policy polish | Sandbox presets and retry policy |

### P1: Add Core Power Features

| Task | Outcome |
|------|---------|
| Skill package runtime | Install/list/view/toggle/load Skill packages with progressive disclosure |
| Tool registry | Schema-first tools with policy, approval, audit, and replayable events |
| MCP server management | Add custom MCP servers, project tools into Tool registry, health/status UI |
| A2A local orchestration | Agent group calls, child task tracking, local/remote transport abstraction |
| Knowledge resources | Bind documents/projects to agents, expose retrieval policy in profile |

### P2: Polish, Growth, and Ecosystem

| Task | Outcome |
|------|---------|
| Growth dashboard | Feedback, failure attribution, memory/skill recommendations |
| Marketplace | Agent / Skill / MCP discovery, install, trust metadata |
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

---

## 8. Open Risks

1. Full Desktop TypeScript check currently has unrelated pre-existing failures outside this Agent Kernel slice; use targeted checks until the unrelated issues are scheduled.
2. CLI-wrapped providers cannot guarantee the same internal tool loop fidelity as Eino-native providers. The contract must model capability degradation explicitly instead of pretending they are equally controllable.
3. Current CLI guardrails validate config shape and process controls, but sandbox presets, retry policy, and bridge approval UX still need dedicated delivery.
4. Conversation now has a compact provider trace marker, but the full trace detail drawer and tool/memory event cards still need dedicated UI.
