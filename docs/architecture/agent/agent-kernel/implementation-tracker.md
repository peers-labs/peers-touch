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
| Provider | Unified AgentProvider over Eino-native and CLI-wrapped providers | Implemented initial adapters, CLI controls, traces |
| Model Backend | Model/vendor API remains model backend; AgentProvider is the execution strategy above it | Designed; provider UI partially wired |
| Runtime | Turn lifecycle, provider call, trace persistence, memory hook | Implemented local desktop runtime split and traces |
| Memory | White-box memory with list/search/persona/events/delete/feedback | Local persistence implemented; feedback UI/API added in current stage |
| Skill | Package + `SKILL.md` + projection + controlled runtime load | Designed; implementation pending |
| Tool / MCP | Schema-first registry, policy, approval, audit, dynamic MCP projection | Designed; implementation pending |
| A2A / Groups | Agent Card, task state, local/remote transport, group orchestration UI | Designed; implementation pending |
| Desktop UX | LobeHub-style interaction on Peers-Touch framework | Memory page improved; Agent list redesign pending |
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

---

## 5. Current Stage: Memory Feedback Loop

### Delivered

- Desktop Rust contract: `MemoryFeedbackInput`.
- Desktop Rust application command: `memory_feedback`.
- Local memory behavior:
  - helpful feedback increments `helpful_count`
  - harmful feedback increments `harmful_count`
  - trust score adjusts within `[0.0, 1.0]`
  - feedback emits a local memory event
- Station path:
  - desktop command proxies to `/agent/memory/feedback` when authenticated
- Desktop API:
  - `api.feedbackMemory(memoryId, helpful, reason?)`
  - Memory type exposes trust and feedback fields
- Memory page:
  - displays trust score
  - displays helpful / harmful counts
  - displays frozen state
  - provides helpful / harmful action buttons
  - reloads list and stats after feedback
- Localization:
  - English and Chinese memory feedback labels

### Acceptance Criteria

- Memory feedback works without a Station token using local memory storage.
- Memory feedback works with a Station token through the proto endpoint.
- UI exposes feedback without opening a secondary detail page.
- Feedback is visible in Memory event logs.
- JSON locales remain valid.
- Rust memory tests and desktop `cargo check` pass.

---

## 6. Remaining Delivery Backlog

### P0: Make Agent Usable End-to-End

| Task | Outcome |
|------|---------|
| Agent list redesign | Feishu-style pinned/normal list, direct selection, drag order, persisted preference |
| Agent Profile | One place for instructions, provider, memory, skills, tools, MCP, workspace, collaboration |
| Conversation projection | Message stream, tool cards, memory use/write markers, provider degradation markers |
| Provider capability matrix | Same provider contract, explicit supported/partial/unsupported controls |
| CLI provider guardrails | Process sandbox policy, env allowlist, cwd/workspace validation, kill/timeout/retry UI |

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
| 2026-06-07 | `cargo check --quiet` | Passed | Existing warnings remain |
| 2026-06-07 | `python3 -m json.tool packages/locales/en/memory.json` | Passed | Locale JSON valid |
| 2026-06-07 | `python3 -m json.tool packages/locales/zh-CN/memory.json` | Passed | Locale JSON valid |
| 2026-06-07 | `git diff --check` | Passed | No whitespace errors |
| 2026-06-07 | `npm --prefix apps/desktop run check` | Failed outside current slice | No `MemoryPage`, `desktop_api`, `memory_feedback`, or `feedbackMemory` errors; failures remain in existing App/social/media/navigation areas |

---

## 8. Open Risks

1. Full Desktop TypeScript check currently has unrelated pre-existing failures outside this Agent Kernel slice; use targeted checks until the unrelated issues are scheduled.
2. CLI-wrapped providers cannot guarantee the same internal tool loop fidelity as Eino-native providers. The contract must model capability degradation explicitly instead of pretending they are equally controllable.
3. Memory feedback updates local trust immediately, but Station scoring policy may evolve independently. Keep the UI bound to returned `trust_score`.
4. Agent list drag ordering needs a clear persistence model before UI work starts, otherwise optimistic ordering and projection replay can diverge.
