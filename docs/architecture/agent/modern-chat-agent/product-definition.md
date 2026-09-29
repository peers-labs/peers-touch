# Modern Chat Agent — Product Definition

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-07-30 | **Updated**: 2026-09-08
> **Owner**: Peers-Touch Agent Team

---

## 1. Product Thesis

Modern Chat Agent is a persistent model-powered teammate for people who need
more than one-off answers. It should understand durable context, use governed
capabilities, survive interruptions, and explain what it used and what happened.

Product promise:

> Configure an Agent once, then use trustworthy conversations to investigate,
> create, and complete work without repeatedly rebuilding context or guessing
> whether the Agent is still running.

## 2. Target Users And Jobs

Primary users:

- A professional who repeatedly works with the same domain, project, or
  preferences and wants a persistent Agent.
- A technical user who expects the Agent to inspect resources, use tools, and
  return evidence instead of only suggesting steps.
- A user who moves between conversations and devices and expects accepted work
  to remain recoverable.

Excluded from this product claim:

- A marketplace publisher managing public commercial distribution.
- A multi-Agent workflow designer. That product is governed by Agent Canvas.
- A user requiring offline model execution without Station.

Primary jobs:

1. Configure a trustworthy Agent for a recurring role.
2. Ask a question or assign a bounded task and receive progressive output.
3. Continue work across turns without repeating relevant context.
4. Let the Agent use memory, skills, knowledge, files, and tools with visible
   attribution and consent.
5. Recover from cancellation, disconnect, restart, provider failure, or an
   unsupported capability without losing confirmed work.
6. Inspect usage, sources, tool activity, and failure details when confidence
   matters.
7. Resume or start work from one Home command surface without reconstructing
   Agent, topic, task, and capability context.
8. Evaluate a configured Agent against durable test cases and inspect
   authoritative results before trusting a change.

## 3. First And Recurring Value

First useful outcome:

- A user selects or creates an Agent, chooses an available model, sends one
  prompt, sees a real streamed answer, and can reopen the persisted
  conversation after restart.

Recurring value:

- The Agent recalls approved context, applies relevant skills, uses governed
  tools, and leaves a durable, searchable record of decisions and outputs.

The product is not activated by showing an Agent list. Activation requires the
first persisted useful answer.

## 4. Feasible First Product Loop

The first delivery target is one complete loop, not a broad feature batch:

```text
Start Station and Desktop
  -> open Agent
  -> select an Agent with one ready Direct Model
  -> start a local draft topic
  -> send "Reply with TEST_OK"
  -> observe progressive text and terminal completion
  -> close and reopen Desktop
  -> reopen the same Station-backed topic and read TEST_OK
```

Tangible user actions:

1. Run `make station` and `make desktop`.
2. Open **Agent**, select an existing Agent, and resolve any readiness blocker.
3. Click **New Topic**, type `Reply with TEST_OK`, and press Send.
4. Observe the draft become a real topic only after acceptance.
5. Observe more than one progressive text update and one terminal state.
6. Restart Desktop, reopen that topic, and verify the same messages remain.

Current feasibility basis:

| Existing foundation | Evidence |
|---|---|
| Station turn execution, prompt assembly, messages, and trace | `apps/station/app/subserver/agent/service/turn_service.go` and persistence services |
| Station provider and credential foundations | `provider_service.go`, `credential_pool_service.go` |
| Desktop App Station stream bridge and cancellation | `apps/desktop/src-tauri/src/application/agent_turn/` |
| Desktop topic/chat projection foundations | `agentTopicRuntime.ts`, chat store/reducer and Agent page |
| Executable product shape | `modern-chat-agent` prototype mounted in the Desktop Shell Agent surface |

Missing closure:

- One Station-owned conversation/message contract across App and browser.
- Sequenced replay/reconciliation and durable terminal readback.
- Removal of Desktop-local conversation truth and local provider execution.
- Live Surface Gate evidence using a real model and no mock API.

Feasibility judgment: repository foundations support this vertical loop without
inventing a second runtime. The loop is `unproven` until the exact runtime
scenario and Station readback pass.

## 5. Product Capability Profile

| ID | Capability | Classification | Product claim |
|---|---|---|---|
| MCA-P01 | Agent setup and readiness | required | User can understand and resolve Agent/model readiness before sending |
| MCA-P02 | Persistent topics and messages | required | Conversations and branch selection survive restart |
| MCA-P03 | Progressive model conversation | required | Real streaming, cancellation, and terminal outcome are visible |
| MCA-P04 | Context intelligence | required | History, memory, skills, and knowledge contribute with attribution |
| MCA-P05 | Governed tools and intervention | required | Tool progress, approval, denial, timeout, result, and audit are visible |
| MCA-P06 | Attachments and references | required | Supported images/files are admitted, attributed, and recoverable |
| MCA-P07 | Queue and recovery | required | Follow-ups, disconnect, replay, retry, and restart preserve accepted intent |
| MCA-P08 | Branching and revision | required | Edit, retry, and regenerate preserve original evidence |
| MCA-P09 | Runtime capability transparency | required | Unsupported or degraded behavior is disclosed before commitment |
| MCA-P10 | Usage, feedback, and diagnostics | required | User can inspect and rate an immutable turn |
| MCA-P11 | Client portability | required | Desktop now and future Mobile share outcomes without pretending device parity |
| MCA-P12 | Stateful external Agent runtime | optional-advertised | When enabled, runtime/device/session constraints and reset are explicit |
| MCA-P13 | Generated artifacts | optional-advertised | When enabled, substantial output has a durable preview/export surface |
| MCA-P14 | Advanced generation and commercial distribution | mixed unsupported/deferred | Image and video generation are unsupported in Peers-Touch; server-side audio generation, commercial marketplace/community, and public sharing remain deferred |
| MCA-P15 | Multi-Agent collaboration | deferred | Begins only after single-Agent readiness passes |

`optional-advertised` means the product may ship without the capability, but it
cannot advertise it until its complete journey and acceptance cells pass.
One-shot CLI Providers that receive complete context and do not retain an
external session are an allowed `DIRECT_MODEL` transport for MCA-P01/MCA-P03;
they are not MCA-P12.

### 5.1 V2 Required Capability Extension

V2 extends the same product contract; it does not create a second completion
ledger. The brain-map node remains the status source for each mapped capability.

| ID | Brain-map nodes | Classification | Product claim |
|---|---|---|---|
| MCA-V2-H01 | P3 | required | Home restores or starts Chat/Task work with Agent/model readiness, recents, Brief/Needs You, task state, and capability status |
| MCA-V2-T01 | R5, C6, C7, X1, X5 | required | One inventory explains Tool/MCP/Connector/Skill/Knowledge source, compatibility, readiness, and version |
| MCA-V2-T02 | C3, C6, C7, X1, X5 | required | Agent capability binding and policy save through Station and read back authoritatively |
| MCA-V2-T03 | C1, C2, C4 | required | Model/runtime compatibility is resolved before admission |
| MCA-V2-T04 | R5, R6 | required | Tool proposal, policy, decision, execution, result, and replay form one governed lineage |
| MCA-V2-M01 | X1, R5, R6 | required | MCP install/config/test/connect/invoke/cancel/recover is one visible lifecycle |
| MCA-V2-C01 | C7, R5, R6 | required | OAuth Connector resources become governed Agent tools with expiry and recovery |
| MCA-V2-O01 | R4, R5, R6 | required | Tool failures, timeout, denial, disconnect, replay, and redacted diagnostics are actionable |
| MCA-V2-E01 | E1 | required | Evaluation Lab runs durable benchmark cases against a real Agent runtime and supports cancel, retry, result, metrics, and restart readback |

V2 scope dispositions:

- `G1 Image Generation`: unsupported.
- `G2 Video Generation`: unsupported in Peers-Touch; any future video product
  requires a separate project and product contract.
- `G3b` server-side TTS and other audio generation: deferred.
- Existing `G3a` client read-aloud remains supported without expanding the
  audio-generation claim.
- Existing Peers package discovery (`X3`) remains supported; only hosted
  commercial marketplace/community behavior is deferred.
- Independent Custom HTTP Plugin product: rejected and merged into governed
  Tool/MCP/Connector boundaries.

## 6. Trust, Privacy, And Portability Promises

- Agent state, conversations, accepted tool outcomes, and feedback are durable
  Station truth.
- Credentials and private runtime identifiers are never shown as chat context.
- The Agent identifies when memory, skill, knowledge, attachment, or tool
  evidence affected a turn.
- Sensitive actions disclose target, scope, authority, and consequence before
  approval.
- Cancellation and failure never imply successful completion.
- Desktop-local capabilities are not advertised on Mobile unless a compatible
  Mobile capability exists.
- Private model reasoning is not promised. The product exposes model-provided
  reasoning summaries/status only when policy and provider capability allow it.
- Thinking mode is independent from reasoning effort. `auto` is the default and
  leaves the provider's mode unchanged; `enabled` explicitly requests thinking;
  `disabled` explicitly requests direct answer text. An explicit unsupported
  mode rejects before provider execution instead of being silently ignored or
  remapped to an effort level.

## 7. Non-Goals

- Cloning LobeHub navigation, marketplace, or visual identity.
- Copying Peers-Touch's local-machine ownership model.
- Requiring every model to support tools, vision, reasoning, or artifacts.
- Hiding runtime distinctions behind a generic success state.
- Treating a prototype, unit test, or response screenshot as product readiness.

## 8. Product Decisions Requiring Approval

| Decision | Approved position | Approval Date | Gate |
|---|---|---|---|
| First profile runtime scope | Direct Model is required; stateful external Agent is optional-advertised | 2026-07-30 | APPROVED |
| Artifact delivery | Optional-advertised after core conversation readiness | 2026-07-30 | APPROVED |
| Topic deletion | Archive is recoverable; permanent delete requires explicit destructive confirmation | 2026-07-30 | APPROVED |
| Memory consent | Extracted memory must remain inspectable and removable; automatic approval policy deferred to beta tuning | 2026-07-30 | APPROVED |
| Mobile claim | Contract compatibility is required now; Mobile UI delivery is deferred | 2026-07-30 | APPROVED |
| V2 Home depth | Include pinned/favorite, Station recents, Agent/model readiness, Chat/Task composer, Brief/Needs You, Task state, Connector/Tool readiness, and recovery; exclude promotion, commercial recommendation, Community, and generation entry points | 2026-08-17 | APPROVED |
| V2 Evaluation | User-visible Evaluation Lab is required; Station owns benchmark, dataset, test-case, run, result, and metrics truth | 2026-08-17 | APPROVED |
| V2 generation scope | Image and video generation are unsupported in Peers-Touch; any future video capability belongs to a separate project. Server-side audio generation remains deferred | 2026-09-08 | APPROVED |
| V2 platform claim | Desktop is the complete delivery; Browser preserves Station-backed outcomes with explicit device-capability degradation; Mobile contract compatibility is required while Mobile UI remains deferred | 2026-08-17 | APPROVED |
| Direct Model thinking mode | Agent default and per-Turn override use `auto / enabled / disabled`; default is `auto`; reasoning effort remains an independent control | 2026-08-27 | APPROVED |

All owner-level scope decisions are approved. The Home/Tool/Evaluation
prototype is Owner-confirmed, and the independent PRODUCT review passed on
2026-08-17. Production behavior remains subject to the execution and
receiver-perspective Acceptance Gates.
