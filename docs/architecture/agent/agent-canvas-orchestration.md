# Agent Canvas Orchestration

> **Status**: active design
> **Version**: v0.1
> **Created**: 2026-06-25
> **Owner**: Peers-Touch Agent Team
> **Module**: `apps/desktop/`, `apps/station/app/subserver/agent/`, `model/domain/agent/`

---

## 1. Thesis

Agent Canvas Orchestration is the multi-agent orchestration system for Peers-Touch.

The user-facing entry is lightweight:

```text
existing agents + canvas + collaboration prompt + run
```

The runtime behind it is strong:

```text
goal contract + engine match + run plan + autonomous execution + verification + reduction
```

The system must let a user place existing agents on a small canvas, describe the collaboration goal in natural language, and let the runtime choose and execute the appropriate work engine.

---

## 2. Product Entry

The orchestration entry lives inside the existing Agent product surface.

It must preserve the existing Agent page capabilities:

- Agent list.
- Agent creation.
- Agent detail.
- Agent templates.
- Agent run history.
- Agent settings and capability management.

The canvas is an additional work surface, not a replacement for the Agent page.

### 2.1 User Flow

```text
Open Agent page
  -> drag existing agents into Canvas
  -> write collaboration prompt
  -> runtime auto-matches a work engine
  -> user starts the run
  -> runtime executes the run plan
  -> user sees status and final result
```

### 2.2 User Sees

- Selected agents on the canvas.
- The collaboration prompt.
- The automatically matched engine label.
- High-level run status.
- Final summarized result.
- Per-agent contribution summary.
- Risks, disagreements, and next actions.

### 2.3 User Does Not See

- Internal policy names.
- Internal reducer configuration.
- Internal convergence rules.
- Long agent chat transcripts by default.
- Manual engine configuration as the main path.

---

## 3. Runtime Workflow

The orchestration runtime is a compiler and execution controller.

```text
Canvas
  -> OrchestrationRequest
  -> GoalKeeper.BuildContract
  -> EngineMatcher
  -> RunPlanBuilder
  -> GoalKeeper.CheckPlan
  -> AutonomyController
  -> Scheduler
  -> AgentRuns
  -> Verifier
  -> GoalKeeper.CheckStage
  -> FixLoop / Continue / Escalate
  -> Reducer
  -> GoalKeeper.FinalCoverageCheck
  -> CanvasRunResult
```

### 3.1 Stage Semantics

| Stage | Responsibility |
|---|---|
| `OrchestrationRequest` | Captures canvas agents, collaboration prompt, context, and user options. |
| `GoalKeeper.BuildContract` | Converts the user goal into a stable goal contract. |
| `EngineMatcher` | Selects the appropriate work engine. |
| `RunPlanBuilder` | Compiles the canvas and prompt into executable steps. |
| `GoalKeeper.CheckPlan` | Rejects plans that drift from the goal or violate constraints. |
| `AutonomyController` | Advances stages without asking the user after every step. |
| `Scheduler` | Dispatches run steps to existing agent turn execution. |
| `Verifier` | Checks local quality of stage outputs. |
| `GoalKeeper.CheckStage` | Checks whether stage output still serves the overall goal. |
| `Reducer` | Aggregates multiple agent outputs into a final result. |
| `GoalKeeper.FinalCoverageCheck` | Prevents completion hallucination by checking acceptance coverage. |

---

## 4. Core Modules

### 4.1 GoalKeeper

`GoalKeeper` is the target anchor of the orchestration runtime.

It owns:

- Goal.
- Non-goals.
- Acceptance criteria.
- Constraints.
- Assumptions.
- Escalation rules.
- Coverage state.

It does not implement the task. It prevents the rest of the runtime from losing the user's goal.

```text
GoalKeeper = GoalContract + DriftDetector + AcceptanceCoverage + EscalationJudge
```

#### Required Checks

```text
BuildContract:
  user prompt -> GoalContract

CheckPlan:
  RunPlan -> continue / revise / escalate / stop

CheckStage:
  Stage output -> continue / revise / escalate / stop

FinalCoverageCheck:
  final result -> completed / partially_completed / failed
```

### 4.2 EngineMatcher

`EngineMatcher` selects a work engine from the canvas and prompt.

Inputs:

- Agent count.
- Agent capabilities.
- Agent local prompts.
- Global collaboration prompt.
- Optional user mode: `auto`, `fast`, `deep`.

Output:

```text
EngineMatch {
  engine
  confidence
  reasons
}
```

The first implementation should be rule-first. LLM-assisted matching can be added later, but hard rules must win.

### 4.3 RunPlanBuilder

`RunPlanBuilder` compiles the selected engine into executable steps.

```text
Canvas agents + prompt + engine -> RunPlan
```

The run plan is the runtime contract for execution. The canvas itself is not the execution plan.

### 4.4 AutonomyController

`AutonomyController` decides how the run advances.

It removes the need for repeated user prompts like:

```text
continue?
yes?
next?
```

It advances automatically when stage exit conditions are satisfied.

It asks the user only when escalation rules require it.

### 4.5 Scheduler

`Scheduler` dispatches run steps to the existing single-agent execution path.

It should reuse the existing Agent turn loop instead of creating a separate agent runtime.

The existing delegation service can be reused as a parallel execution primitive, but it is not the product-level orchestration model.

### 4.6 Verifier

`Verifier` checks local quality:

- Type/build/test result.
- Output format.
- Tool result validity.
- Stage-level acceptance.
- Runtime errors.

It is not responsible for overall user-goal alignment. That is the `GoalKeeper`.

### 4.7 Reducer

`Reducer` converts multiple agent outputs into one user-facing result.

It must preserve:

- Final summary.
- Per-agent contributions.
- Disagreements.
- Risks.
- Next actions.
- Incomplete acceptance criteria.

---

## 5. Work Engines

Work engines are internal runtime modes. The UI may show a simple label, but users should not configure internal engine details.

### 5.1 Primitive Engines

| Engine | Use Case | Shape |
|---|---|---|
| `parallel_analysis` | Multiple agents analyze the same prompt independently. | Parallel fan-out, then reduction. |
| `review_gate` | One or more agents produce, another agent reviews or challenges. | Produce, review, summarize. |
| `relay_chain` | Agents process outputs sequentially. | Step A -> Step B -> Step C. |
| `debate_judge` | Agents argue alternatives and the runtime summarizes/calls the tradeoff. | Positions -> judgement -> result. |
| `synthesis` | Agents collect complementary material and produce one synthesis. | Collect -> cluster -> synthesize. |

### 5.2 Composite Engines

Composite engines are staged autonomous workflows built from primitive engines.

| Engine | Use Case | Shape |
|---|---|---|
| `design_to_implementation` | Design, implement, verify, and summarize a product/engineering change. | Contract -> design -> implement -> verify -> fix loop -> final result. |
| `bugfix_to_verified_patch` | Diagnose, patch, test, and report. | Reproduce -> patch -> verify -> summarize. |
| `research_to_report` | Research, source-check, synthesize, and produce a report. | Collect -> verify -> synthesize -> review. |

MVP must include `parallel_analysis`, `review_gate`, and a minimal `design_to_implementation`.

---

## 6. Data Model

### 6.1 OrchestrationRequest

```ts
type OrchestrationRequest = {
  canvasSessionId: string
  prompt: string
  agents: CanvasAgentNode[]
  context?: Record<string, unknown>
  userOptions?: {
    mode?: "auto" | "fast" | "deep"
  }
}
```

### 6.2 CanvasAgentNode

```ts
type CanvasAgentNode = {
  nodeId: string
  agentId: string
  name: string
  capabilities: string[]
  localPrompt?: string
}
```

### 6.3 GoalContract

```ts
type GoalContract = {
  goal: string
  nonGoals: string[]
  acceptanceCriteria: string[]
  constraints: string[]
  assumptions: string[]
  escalationRules: string[]
}
```

### 6.4 EngineMatch

```ts
type EngineMatch = {
  engine: WorkEngineType
  confidence: number
  reasons: string[]
}
```

### 6.5 RunPlan

```ts
type RunPlan = {
  runId: string
  engine: WorkEngineType
  goalContract: GoalContract
  steps: RunStep[]
  reduceStrategy: ReduceStrategy
  autonomy: AutonomyPolicy
}
```

### 6.6 RunStep

```ts
type RunStep = {
  stepId: string
  agentId?: string
  kind: "agent_turn" | "verify" | "reduce" | "goal_check"
  prompt: string
  dependsOn?: string[]
  exitCriteria?: string[]
}
```

### 6.7 CanvasRunResult

```ts
type CanvasRunResult = {
  runId: string
  engine: WorkEngineType
  status: "completed" | "partially_completed" | "failed" | "cancelled"
  summary: string
  agentOutputs: AgentRunOutput[]
  disagreements?: string[]
  risks?: string[]
  nextActions?: string[]
  coverage: AcceptanceCoverage
}
```

---

## 7. Autonomy Rules

The runtime should continue automatically when:

- The stage exit criteria are satisfied.
- The verifier passes the stage output.
- The GoalKeeper confirms the stage remains aligned.
- No escalation rule is triggered.
- Retry and budget limits are not exceeded.

The runtime should fix and retry when:

- A stage fails with a repairable error.
- A verifier identifies a concrete fix.
- The fix loop count is below the configured cap.

The runtime should ask the user only when:

- The user goal is internally conflicting.
- A high-risk side effect is required.
- The change is destructive or hard to reverse.
- A product tradeoff cannot be decided from the goal contract.
- Required context is missing.
- The fix loop exceeds the retry cap.
- Budget or time limits are exceeded.

The runtime must never mark a run as completed unless `GoalKeeper.FinalCoverageCheck` passes.

---

## 8. Engine Matching Rules

The initial matcher should be deterministic and explainable.

Examples:

```text
prompt contains "review/check/risk/validate"
  -> review_gate

prompt contains "compare/tradeoff/which is better"
  -> debate_judge

prompt contains "summarize/synthesize/report"
  -> synthesis

canvas has explicit sequence or ordered local prompts
  -> relay_chain

prompt asks to design and implement
  -> design_to_implementation

otherwise multiple agents
  -> parallel_analysis
```

The matcher returns reasons that can be shown as a lightweight explanation:

```text
Auto-matched: Review Gate
Reason: prompt asks for review and the canvas includes a reviewer-capable agent.
```

---

## 9. MVP Scope

### 9.1 Must Build

- Canvas orchestration request model.
- Goal contract generation.
- Engine matching for `parallel_analysis`, `review_gate`, and `design_to_implementation`.
- Run plan generation.
- Autonomous stage advancement.
- Existing Agent turn execution integration.
- Per-step status.
- Basic fix loop.
- Result reduction.
- Final acceptance coverage report.

### 9.2 Must Not Build Yet

- Remote A2A agent nodes.
- Full workflow editor.
- Manual policy configuration UI.
- Separate saved-template management product.
- Versioning system for saved collaboration templates.
- Generic business process automation.

### 9.3 Success Criteria

- A user can drag 2-4 existing agents into Canvas, enter a prompt, and run.
- The runtime auto-matches an engine with reasons.
- The runtime generates a run plan.
- At least two agents can run in parallel.
- `review_gate` can run producer/reviewer flow.
- `design_to_implementation` can proceed through contract, design, implementation, verification, and summary stages without requiring repeated user confirmation.
- The final result reports completed and incomplete acceptance criteria.
- A single agent failure does not crash the whole canvas run.

---

## 10. Implementation Placement

Recommended Station placement:

```text
apps/station/app/subserver/agent/domain/orchestration.go
apps/station/app/subserver/agent/service/orchestration_service.go
```

Recommended service API:

```text
MatchEngine(request) -> EngineMatch
BuildRunPlan(request, engineMatch) -> RunPlan
StartRun(runPlan) -> CanvasRun
GetRunStatus(runId) -> CanvasRunStatus
CancelRun(runId) -> CanvasRunStatus
GetRunResult(runId) -> CanvasRunResult
```

Recommended Desktop API additions:

```text
agentCanvas.matchEngine()
agentCanvas.startRun()
agentCanvas.getRunStatus()
agentCanvas.cancelRun()
agentCanvas.getRunResult()
```

---

## 11. Runtime Principle

```text
Canvas is the entry.
GoalKeeper is the target anchor.
EngineMatcher chooses the work engine.
RunPlanBuilder compiles the plan.
AutonomyController advances the run.
Scheduler executes existing agents.
Verifier checks local quality.
Reducer produces the result.
GoalKeeper prevents false completion.
```

The orchestration system is valid only when this chain runs end to end.
