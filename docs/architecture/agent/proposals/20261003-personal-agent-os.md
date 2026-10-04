# Personal Agent OS Product And Architecture Amendment

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-10-03 | **Updated**: 2026-10-03
> **Owner**: Peers-Touch Agent Team
> **Module**: `model/domain/agent/`, `apps/station/app/subserver/agent/`, `apps/desktop/`

---

## 1. Scope

This amendment expands the accepted Modern Chat Agent product into a
Peers-owned Personal Agent OS without creating a second Agent runtime.

It defines:

- the product promise above Chat, Task, Goal, Canvas, Atelier, and Acceptance;
- the canonical ownership relationship between those existing capabilities;
- the first-class Goal contract missing from the current Station model;
- the completion and evidence boundary for long-running Agent work;
- the shared Station EventBus boundary for every Agent realtime projection;
- the implementation cutover that removes overlapping task authorities.

It does not:

- replace Modern Chat Agent, Agent Canvas, Atelier, or Acceptance Framework;
- copy LobeHub navigation, source code, visual identity, hosted market, or
  commercial distribution behavior;
- make every external coding Agent a required runtime;
- move Station-owned truth into Desktop or an applet;
- include image generation, video generation, or Mobile UI delivery.

## 2. Product Thesis

> Peers Agent is a Station-owned Personal Agent OS. A user starts with one
> persistent Agent, expresses a Chat, Task, or Goal, and receives governed,
> recoverable execution whose result is independently accepted with durable
> evidence.

The product layers are:

```text
Modern Chat Agent
  -> conversation, context, capability use, and execution facts

Personal Goal
  -> durable objective, constraints, budget, graph, decisions, and acceptance

Agent Canvas
  -> multi-Agent composition and orchestration over the same Goal and Task truth

Atelier / Home
  -> user workbench and read/write projection, never a second state machine

Acceptance Framework
  -> read-only receiver-perspective proof, never production Goal mutation
```

## 3. Users, Jobs, And Outcomes

Primary users:

- people who repeatedly use one persistent Agent for consequential work;
- people who need a complex objective to continue beyond one chat turn;
- people who need to understand progress, cost, blockers, decisions, and proof;
- people who move between sessions or devices and expect accepted work to
  remain recoverable.

Primary jobs:

1. Start from Chat for exploratory work and promote it into a durable Goal.
2. Start a Goal directly with explicit outcome, constraints, and acceptance.
3. Let one or more Agents execute bounded work without repeated "continue"
   prompts.
4. Intervene only for ambiguity, risk, budget, permissions, or subjective
   acceptance.
5. Resume after disconnect or restart without duplicating accepted work.
6. Inspect why the system claims success and which evidence supports it.

First useful Goal outcome:

```text
Create Goal
  -> review contract and acceptance
  -> start
  -> observe at least one TaskRun
  -> receive one evidence-backed acceptance result
  -> restart Desktop
  -> read back the same Goal, work graph, result, and evidence
```

## 4. Capability Profile

| ID | Capability | Classification | Product claim |
|---|---|---|---|
| PAOS-P01 | Durable Goal contract | required | Goal, non-goals, constraints, budget, owner, and acceptance survive restart |
| PAOS-P02 | Goal graph and TaskRun | required | Goal work is decomposed into dependency-bound executable units with one canonical lifecycle |
| PAOS-P03 | Autonomous coordination | required | Eligible work advances automatically within policy, budget, and concurrency limits |
| PAOS-P04 | Human decision and replan | required | Ambiguity, risk, exhaustion, and subjective decisions pause with actionable choices and evidence |
| PAOS-P05 | Evidence-backed acceptance | required | Goal completion requires criteria verdicts and durable evidence, not an Agent's completion claim |
| PAOS-P06 | Workbench and recovery | required | Home/Atelier show Goal, graph, Needs You, progress, recovery, and durable terminal readback |
| PAOS-P07 | Runtime portability | required | Direct Model and registered external runtimes execute through the same TaskRun and evidence contracts |
| PAOS-P08 | Multi-Agent collaboration | optional-advertised | Agent Canvas may assign multiple Agents only when the complete orchestration journey is proven |

Existing `MCA-P01` through `MCA-P12` remain the single-Agent foundation.
`PAOS-P01` through `PAOS-P08` extend that foundation; they do not redefine it.

## 5. Benchmark Disposition

| Benchmark behavior | Evidence | Disposition | Peers rationale |
|---|---|---|---|
| Peers-Touch durable queue, exact Turn identity, recovery, isolation, and intervention | Peers-Touch unified Agent and Workflow source at `42cdb83` | adapt | Preserve failure closure and host capability security under Station ownership |
| Peers-Touch workflow graph, HumanTask, artifacts, and retry semantics | Peers-Touch Agentic Workflow source | adapt | Reuse behavior, but one Peers Goal/Task truth must serve Chat, Canvas, and Atelier |
| LobeHub typed run slots for origin, principal, plan, world, binding, and host | LobeHub `packages/agent-runtime/src/types/state.ts` at `1fb1350` | adopt | Frozen typed facts prevent metadata drift and host-specific re-derivation |
| LobeHub first-class Goal graph, decisions, events, budgets, measured acceptance, and replay | LobeHub `packages/agent-tracing/src/goal/` at `1fb1350` | adapt | Preserve user value while using Peers Station, TaskRun, and Acceptance owners |
| LobeHub heterogeneous Agent descriptor and adapter catalog | LobeHub `packages/heterogeneous-agents/src/registry.ts` at `1fb1350` | adapt | Standardize adapter contracts; do not make all adapters release blockers |
| LobeHub product Acceptance pages, evidence, comments, repair rounds, and workbench | LobeHub Acceptance services and Workbench at `1fb1350` | adapt | Peers Acceptance remains the proof owner; Atelier presents its projection |
| LobeHub app split, database migrations, navigation, hosted market, and visual identity | LobeHub application structure at `1fb1350` | reject | These are implementation/product choices outside the Peers ownership model |

The local LobeHub reference must be refreshed from `183e5dd` to
`1fb1350c46e0aa020bfec274f4aac66701332132` before benchmark evidence is
regenerated. Reference updates do not authorize source copying.

## 6. Product Journeys

### PAOS-J01: Create And Start A Goal

1. The user enters a Goal from Home, Chat, or Atelier.
2. The system drafts outcome, non-goals, constraints, budget, and acceptance.
3. The user reviews material assumptions and starts the Goal.
4. Station persists one Goal identity and creates the initial graph.
5. The UI opens the same durable Goal rather than a local placeholder.

Failure preserves the draft. No TaskRun starts before Goal admission succeeds.

### PAOS-J02: Execute And Observe Work

1. The coordinator selects ready graph nodes.
2. Each dispatch creates one TaskRun and one or more ExecutionSteps.
3. Direct Model or external runtime execution emits ordered events and
   artifacts.
4. Home/Atelier project the same Station facts.
5. Budget, concurrency, cancellation, and tool policy remain visible.

An executor never writes Goal or Task terminal state directly.

### PAOS-J03: Decide, Recover, And Replan

1. Policy, risk, ambiguity, budget, or subjective acceptance pauses progress.
2. The user sees the issue, evidence, cost, consequence, and valid choices.
3. One durable decision resumes, replans, accepts risk, or cancels.
4. Restart and duplicate delivery replay the same decision exactly once.
5. Accepted work remains anchored during replan.

### PAOS-J04: Accept And Reopen The Result

1. Every required TaskRun reaches an authoritative terminal state.
2. Independent acceptance evaluates required criteria and evidence.
3. Unmet criteria create a repair decision or a partial/failed Goal.
4. Passed criteria produce a durable accepted Goal and result summary.
5. Reopening after restart shows the same graph, result, verdicts, and evidence.

## 7. Visible State Contract

Goal lifecycle:

```text
DRAFT -> REVIEWING -> READY -> RUNNING
DRAFT | REVIEWING | READY -> CANCELLED
RUNNING -> NEEDS_USER | REPLANNING | RECOVERING
RUNNING | REPLANNING | RECOVERING -> ACCEPTING
ACCEPTING -> ACCEPTED | PARTIAL | FAILED
RUNNING | NEEDS_USER | REPLANNING | RECOVERING -> CANCELLED
```

Required rules:

- only `ACCEPTED` communicates complete success;
- cancelling `DRAFT`, `REVIEWING`, or `READY` work is authoritative before
  execution and creates no TaskRun;
- client disconnect never implies `FAILED`;
- `NEEDS_USER` names the decision, evidence, consequence, and allowed actions;
- `REPLANNING` preserves accepted anchors and marks reset work;
- `RECOVERING` blocks duplicate execution until ownership is reconciled;
- `PARTIAL` names unmet acceptance and reusable output;
- terminal states are Station readback, never client inference.

## 8. Architecture Ownership

| Concern | Canonical owner | Consumers |
|---|---|---|
| Goal contract and lifecycle | Station Agent Goal service | Home, Atelier, Canvas, API |
| Goal graph and decisions | Station Goal coordinator | Atelier/Canvas projections |
| Executable work | Station `TaskRun` and `ExecutionStep` | Direct Model and external runtime adapters |
| Conversation and Turn | Modern Chat Agent Station owners | TaskRun execution and clients |
| Tool/MCP/Connector capability | Station capability plane plus explicit execution owner | TaskRun executor |
| Artifacts and Gate results | Station task artifact/gate owners | Goal acceptance and workbench |
| Goal acceptance policy and terminal verdict | Station `GoalAcceptanceService` | Goal coordinator and workbench |
| Formal product proof | Acceptance Framework | Release/readiness review only |
| Realtime fan-out | Shared Station `apps/station/app/subserver/events.EventBus` | `/events/stream`, Desktop and applet projections |
| Workbench state | Station projections | Home and Atelier |

### 8.1 Architecture Evidence Ledger

| Claim | Class | Evidence | Consequence |
|---|---|---|---|
| Station already has one durable, bounded realtime fan-out owner | verified fact | `apps/station/app/subserver/events/bus.go::EventBus`; `docs/architecture/realtime/event-stream.md` section 3.3 | Reuse it; do not build an Agent bus |
| Agent currently creates a separate unbounded goroutine fan-out path | verified fact | `agent.go::Handlers`; `infrastructure/event/MemoryEventBus.Publish`; `EventStreamService.dispatch` | Delete private bus, subscribers, and routes |
| Agent durable append failure can still produce a live event | verified fact | `TaskEventWriter.Publish` | Replace best-effort mirror with transactional outbox and relay |
| Current realtime schema has no typed Agent event arm | verified fact | `model/domain/realtime/event.proto::StreamEvent` | Add a versioned oneof arm before consumer cutover |
| Goal-like state and acceptance still derive from collaboration records and metadata | verified fact | `CreateProjectFromGoal`; `project_state_machine.go`; `evaluateGoalKeeperVerdict` | Introduce Goal and GoalAcceptance owners; delete inference |
| `TaskRun` already owns execution steps, leases, checkpoints, artifacts, and gates | verified fact | `model/domain/agent/orchestration.proto`; Station persistence/services | Extend this lifecycle instead of creating another task runtime |
| Transactional outbox plus shared EventBus closes the failure window | proposed decision | PAOS-D07 | Must pass event fan-out and final architecture Gates |

## 9. Architecture Decisions

### PAOS-D01: Introduce A First-Class Station Goal Aggregate

`AgentGoal` is the durable root for objective, non-goals, constraints, budget,
owner, graph revision, lifecycle, and acceptance policy. Goal semantics may not
remain encoded only in `CollaborationTask.title`, `description`, or `meta_json`.
Atelier `ProjectState` is a read projection keyed by the same `goal_id`, not an
independent Project lifecycle or mutation authority.

### PAOS-D02: Use TaskRun As The Only Executable Work Lifecycle

`TaskRun`, `ExecutionStep`, and `TaskRunStatus` become the only executable work
contract. `AgentTask`, `CollaborationTask`, and their status contracts may be
migrated as source data, but cannot remain parallel mutation authorities after
consumer cutover.

### PAOS-D03: One Coordinator Serves Goal, Canvas, And Atelier

Agent Canvas supplies participant composition and optional engine intent.
The Station Goal coordinator owns planning, frontier selection, budget,
decisions, replan, and the transition into acceptance. Station
`GoalAcceptanceService` alone owns acceptance rounds and terminal verdicts.
Atelier and Home never host their own scheduler or state machine.

### PAOS-D04: Runtime Adapters Execute Work But Do Not Own It

Direct Model and external Agent adapters implement one descriptor, admission,
execution, cancellation, resume, error taxonomy, usage, and artifact contract.
Adding every LobeHub adapter is not a completion requirement.

### PAOS-D05: Acceptance Is Independent And Evidence-Bound

The executor cannot approve its own result. Station
`GoalAcceptanceService` owns criteria evaluation, acceptance rounds, repair
decisions, and the authoritative Goal terminal transition. Deterministic
criteria use L0/L1 evaluators; subjective L2 criteria require a separate
reviewer or human. The Acceptance Framework drives production paths and records
formal receiver evidence, but it cannot mutate Goal state or act as a
production dependency.

### PAOS-D06: Hard Cut Duplicate Authorities

After migration and consumer cutover, legacy task CRUD, metadata-derived Goal
state, applet-side completion inference, and duplicate acceptance decisions are
deleted. Rollback uses version/deployment control, not permanent dual writes.

### PAOS-D07: Durable Events Enter One Shared Realtime Fan-Out

Every Station mutation that emits a Goal, TaskRun, decision, artifact, gate, or
acceptance event commits its authoritative metadata record and an
`AgentRealtimeOutbox` row in one database transaction before realtime delivery.
External artifact bytes must already be durable and digest-addressed before
their metadata commits. A leased relay adapts each pending outbox row to the
shared Station `apps/station/app/subserver/events.EventBus.Publish` entry point
and reaches clients only through the canonical `/events/stream` projection.
After publish, it records the realtime cursor; crash-window retries are
at-least-once and projections deduplicate by stable domain event identity.

The Agent-private `MemoryEventBus`, feature-owned subscriber registry,
`EventStreamService.dispatch`, and Agent-specific SSE endpoints are migration
sources to delete, not a second realtime architecture. An append failure cannot
publish an uncommitted event. A fan-out failure remains retryable from the
durable event and cannot be hidden as success.

### 9.1 Decision Rationale And Consequences

| Decision | Rejected alternative | Rationale | Negative consequence |
|---|---|---|---|
| PAOS-D01 | Keep Goal in task title and metadata | Goal must outlive any one execution and remain independently reviewable | Adds one aggregate and migration |
| PAOS-D02 | Keep three task authorities | Parallel task truth makes recovery and completion ambiguous | Requires consumer migration and deletion |
| PAOS-D03 | Add a separate Goal scheduler | Canvas, Chat, and Atelier must not dispatch the same work differently | Coordinator becomes a critical Station service |
| PAOS-D04 | Let Atelier own workflow state | Applet-local truth cannot survive devices or provide authoritative readback | Projection APIs must cover all visible states |
| PAOS-D05 | Trust executor completion | Completion without independent evidence is not a product guarantee | Acceptance adds latency and evaluator cost |
| PAOS-D06 | Retain compatibility writes | Permanent dual writes preserve split-brain behavior | Cutover requires a bounded migration window |
| PAOS-D07 | Keep an Agent-private bus/SSE or poll progress | Multiple fan-out owners create divergent ordering, replay, and backpressure | Agent events require typed adaptation into the shared realtime contract |

### 9.2 Operational Contracts

- Goal create/update/start/cancel/replan/decision requests carry a stable
  idempotency key and expected revision; stale writers receive a typed conflict.
- Goal events use a per-Goal monotonic sequence. Replay is idempotent and gaps
  force snapshot reconciliation before new projection events are applied.
- One coordinator lease owns a Goal revision. Lease expiry permits takeover
  only after durable TaskRun ownership reconciliation.
- Every graph dispatch pre-allocates stable Goal node, TaskRun, ExecutionStep,
  and attempt identities before invoking a runtime.
- Admission is bounded by Goal budget, maximum ready frontier, concurrency,
  payload size, artifact limits, and executor readiness. Overload rejects or
  queues explicitly; it never starts hidden work.
- Cancellation writes durable intent before signaling executors. Late results
  cannot overwrite cancellation or a newer attempt.
- Goal deletion is unavailable while work or cleanup remains active. Retention
  removes evidence only after references and cleanup reach a terminal state.
- Actor, workspace, device, runtime, and capability authority are checked by
  Station at every mutation or dispatch boundary. Client-supplied ownership is
  never authoritative.
- Goal contracts, decisions, and event payloads are versioned typed messages;
  large artifacts remain outside event rows and are referenced by immutable
  identity and digest.
- Goal and Task events follow exactly one path: `domain mutation + outbox
  commit -> leased outbox relay -> shared EventBus.Publish -> /events/stream
  -> idempotent projection`. There is no direct handler/service fan-out and no
  Agent-private subscriber registry.
- Goal progress polling is not a primary synchronization mechanism. A client
  uses snapshot plus cursor replay; gaps, overflow, or reconnect require an
  explicit `Resync` and authoritative snapshot reload. A sandboxed applet may
  drain a bounded Desktop Host bridge queue, but that device-local transport
  follows the canonical SSE subscription and owns no Station cursor or truth.
- Subscriber queues and replay buffers are bounded. Overflow disconnects or
  emits `Resync`; it never silently drops a progress event while keeping the
  projection apparently healthy.
- Outbox relay preserves target-actor sequence, does not overtake a pending
  predecessor, and derives target actor/device from persisted ownership plus
  authenticated context. Client metadata cannot redirect delivery.
- Pending outbox rows are bounded per actor/workspace with reserved capacity
  for terminal/control events. The coordinator pauses or rejects new dispatch
  before that bound is exceeded.

## 10. Current Reality And Gap

Verified current foundations:

- `TaskRun`, `ExecutionStep`, events, artifacts, gates, checkpoints, leases,
  interrupts, and budgets exist in `model/domain/agent/orchestration.proto`.
- `CreateProjectFromGoal` currently writes the Goal text into a
  `CollaborationTask`.
- `AgentTask`, `CollaborationTask`, and `TaskRun` are separate lifecycle
  authorities.
- Agent currently constructs a private `MemoryEventBus`, exposes
  Agent-specific event streams, and has direct publishers outside
  `TaskEventWriter`.
- `TaskEventWriter.Publish` currently continues to realtime publication after
  a non-interrupt durable append failure, so a client can observe an event that
  has no replayable Station record.
- GoalKeeper terminal logic currently derives acceptance mainly from node
  completion and a final summary.
- Acceptance predicates, ProjectState, Milestone, TaskGraph, Atelier
  projections, Home, external runtime, capability governance, and Evaluation
  foundations already exist.
- Formal Agent and Atelier product Gates remain partly or wholly `UNPROVEN`.

The principal gap is convergence, not module absence.

## 11. Product Acceptance

| Journey | Receiver assertion | Required evidence |
|---|---|---|
| PAOS-J01 | I can review and start one durable Goal without creating hidden work | Goal readback, revision, zero TaskRun before admission |
| PAOS-J02 | I can observe ordered work and know which Agent/runtime owns it | Goal graph, TaskRun/Step IDs, runtime events, usage and artifacts |
| PAOS-J03 | I can make one decision and recover without duplicate execution | decision CAS, restart replay, stable accepted anchor, side-effect count |
| PAOS-J04 | I can trust completion and reopen the same accepted result | independent verdict, evidence refs, Station readback before/after restart |

Required runtime cells:

- Desktop Native + Direct Model;
- Desktop Native + one stateful external runtime;
- Browser projection of Station-owned Goal outcomes;
- two actors for isolation;
- two devices for replay and stale-writer rejection.

Prototype or static source evidence cannot prove these cells.

### 11.1 Anti-Architecture Acceptance

The release is blocked when any invariant below fails:

| ID | Forbidden architecture | Binary oracle |
|---|---|---|
| PAOS-AA01 | Agent-private fan-out bus or Agent-specific SSE remains live | All Agent realtime delivery enters the shared Station EventBus and canonical `/events/stream`; old constructors/routes have zero live references |
| PAOS-AA02 | Realtime publication occurs before or without durable commit | Injected transaction failure produces no client event; publish failure leaves a retryable outbox row; crash-window duplicate delivery converges by domain identity |
| PAOS-AA03 | Handler/service publishes durable Agent progress directly | Durable Goal/Task publishers are reachable only through the canonical writer/outbox adapter |
| PAOS-AA04 | Polling is the primary Goal progress mechanism | Live progress arrives by SSE; cursor gap/overflow causes `Resync` plus snapshot reconciliation |
| PAOS-AA05 | Applet, Desktop, or runtime adapter mutates Goal/Task truth | Unauthorized direct mutation fails and Station readback remains unchanged |
| PAOS-AA06 | Metadata or natural language is interpreted as lifecycle truth | Terminal status, ownership, session phase, and acceptance come only from typed records |
| PAOS-AA07 | Outbox, realtime queues, replay, or ready frontier are unbounded | Configured limits pause/reject admission, disconnect, or resync deterministically under overload |
| PAOS-AA08 | Executor or Acceptance Framework self-approves production work | Only Station `GoalAcceptanceService` can commit a verdict; L2 requires an independent reviewer/human |
| PAOS-AA09 | Client metadata selects another actor/device as fan-out target | Relay derives target identity from persisted ownership and authenticated context; redirect attempts fail |

`agent-personal-goal-event-fanout-e2e` closes the early PAOS-D07 vertical path.
`agent-personal-goal-architecture-guard` re-runs that proof and aggregates
PAOS-AA01 through PAOS-AA09 on the final exact source. Unit tests or source
grep alone cannot satisfy durable-before-fan-out, replay, overload, or
mutation-authority rows.

## 12. Approval

The Product Owner approved the Product Thesis in conversation on 2026-10-03.
Architecture decisions PAOS-D01 through PAOS-D07 passed the amended
findings-first review on 2026-10-03. The review corrected the production
acceptance owner, closed the durable-commit/fan-out failure window, split the
EventBus and task/workbench cutovers into bounded closures, removed multi-Agent
execution from core completion, and made MCP plus anti-architecture Gates
machine-checked dependencies. Implementation and runtime evidence remain
`UNPROVEN` until the prepared Plan executes.
