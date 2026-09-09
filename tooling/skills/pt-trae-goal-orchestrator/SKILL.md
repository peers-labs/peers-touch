---
name: "pt-trae-goal-orchestrator"
description: "Builds adaptive TRAE Goal Slices that drain ready work, park blockers, and stop only at hard boundaries. Invoke for Goal authoring, review, or continuation."
stage: "cross-stage"
requires: ["TRAE runtime", "resolvable project stage and governing sources"]
produces: ["reviewed TRAE /goal prompt", "bounded adaptive Goal Slice", "queue and blocker handoff"]
---

# TRAE Goal Orchestrator

## Invoke When

- The user asks for a `/goal`, autonomous long-running focus, or multi-subagent
  execution envelope.
- The user asks to review an existing Goal.
- A completed Goal needs one next dependency-ready Goal selected.
- A running Goal repeatedly stops on one blocked action instead of draining
  other legal work.

This skill works only in TRAE. If TRAE Goal lifecycle or subagent capabilities
are unavailable, return `TRAE_RUNTIME_REQUIRED`. Do not translate the Goal into
another IDE's workflow model.

## Core Rule

Goal is a TRAE runtime focus and persistence mechanism with a bounded adaptive
execution queue. It is not a product definition, architecture, execution plan,
stage dispatcher, guardrail, or completion authority.

```text
pt-ew
  -> pt-god-view resolves the current stage
  -> owning stage skill provides the authoritative work graph and gates
  -> pt-trae-goal-orchestrator selects one bounded adaptive Goal Slice
  -> TRAE drains ready work, parks blocked actions, and recomputes the frontier
  -> durable state advances
  -> NEXT selects a successor only after this Goal reaches its boundary
```

Authority remains:

| Concern | Owner |
|---|---|
| Product outcomes and journeys | `pt-product-design-methodology` |
| Architecture and contracts | `pt-architecture-design-methodology` |
| Execution closures and semantic dependency DAG | `pt-architecture-execution-methodology` |
| Durable plan and tracked-work registration | `pt-plan-and-document` |
| Stage dispatch | `pt-god-view` |
| Approved-plan execution discipline | `pt-execution-plan-guardian` |
| Acceptance semantics and evidence | Acceptance owning skills |
| Tracked status projection | `pt-context-anchor` |
| Readiness judgment | `pt-completion-auditor` |

This skill projects those decisions into TRAE. It never redefines them.

## Modes

| Mode | Result |
|---|---|
| `AUTHOR` | Select and render one copyable adaptive Goal Slice |
| `REVIEW` | Review a Goal, including queue liveness and blocker routing |
| `NEXT` | After Goal completion or a hard boundary, reread durable state and select one successor |

There is no `GUIDE` mode. A running Goal is guided by `pt-god-view` and the
current stage's owning skill.

## Goal Slice

```text
Plan or stage workflow = durable full-scope work graph
Goal Slice = one bounded stage/worktree execution horizon with an adaptive queue
Subagent = one parallel unit inside that Slice
active_work = tracked-plan continuity, only after a formal plan exists
```

A valid Slice is:

- **dependency-closed**: prerequisites are complete or included;
- **ownership-closed**: write and integration ownership are explicit;
- **evidence-closed**: available inputs can produce a decisive stage result;
- **recovery-closed**: durable sources can resume interrupted work;
- **scope-bounded**: execution never crosses a stage or hard external-resource
  boundary; affected actions are parked explicitly;
- **outcome-meaningful**: it delivers a coherent outcome, not one command;
- **queue-live**: one blocked action is parked while other dependency-ready
  work continues;
- **admission-bounded**: newly discovered actions are admitted only when they
  are implied by accepted sources and remain in the same stage, worktree, and
  ownership boundary.

State invariants:

```text
subagent complete != Goal Slice complete
Goal Slice complete != stage or plan complete
stage or plan complete = all mandatory source-owned closures and gates complete
```

One Goal Slice belongs to exactly one PRODUCT, DESIGN, PLAN, EXECUTE, or DELIVER
stage. It may contain multiple source-defined workstreams inside that stage and
worktree. End it before a stage review boundary. Goal persistence never bypasses
a methodology gate.

## Adaptive Queue Contract

The Goal carries a projection of the source-owned work graph:

- `Ready Queue`: dependency-ready actions that may execute now.
- `In Progress`: at most the work currently owned by active agents.
- `Parked Queue`: in-scope actions that are blocked, including the exact
  blocking edge, owner, evidence, and unblocking condition.
- `Done`: actions whose source-owned completion criteria and evidence passed.

The queue is not a second plan. For tracked work, any newly discovered
deliverable or dependency is written to the formal plan first, then projected
into the Goal queue.

### Dynamic Action Admission

The running Goal may add and execute an action without user interruption when
all of these are true:

1. accepted product and architecture sources already define the behavior;
2. the action is in the same stage, worktree, ownership boundary, and declared
   Goal scope;
3. it is a root-cause fix, diagnostic, test, evidence repair, documentation
   synchronization, or mechanical plan amendment needed by an in-scope result;
4. it does not weaken a Gate, assertion, cleanup rule, or source identity;
5. its dependencies are complete or can be completed by other admissible
   actions in the same Goal.

The Goal must not auto-admit:

- new product behavior or user-visible semantics;
- a new architecture boundary, ownership move, topology, persistence model, or
  compatibility strategy;
- a version/schema/protocol bump requiring explicit approval;
- a destructive operation requiring explicit authorization;
- work owned by another worktree, branch, team, or active Goal;
- a weaker substitute for unavailable runtime or receiver evidence.

### Blocker Routing

`action blocked` is not `Goal blocked`.

When an action blocks:

1. record the failed action, evidence, and exact blocking edge;
2. classify the blocker:
   - `RECOVERABLE_IMPLEMENTATION`: diagnose the root cause, enqueue the legal
     remediation and its regression evidence, then retry;
   - `MECHANICAL_PLAN_GAP`: use the owning execution skill to amend the plan,
     enqueue the resulting task, and continue;
   - `SOFT_EXTERNAL`: park the action and continue other ready work;
   - `HARD_GOVERNANCE`: park the action and require the owning decision,
     authorization, resource, or worktree;
3. recompute the dependency-ready frontier from the complete in-scope source
   graph;
4. continue every legal ready action, including newly exposed work;
5. synchronize durable plan state and `active_work` after each meaningful
   transition.

Unexpected test, environment, tooling, or implementation failures are not
automatically hard blockers. Investigate them and admit a root-cause action when
the accepted sources determine the fix.

### Goal-Level Blocked Gate

The whole Goal may be marked `blocked` only after an exhaustion proof:

1. reread the authoritative work graph and current evidence;
2. reconcile stale status and mechanically add every omitted in-scope action
   permitted by Dynamic Action Admission;
3. recompute the ready frontier to a fixed point;
4. prove the Ready Queue is empty and no active diagnostic/remediation can make
   progress;
5. show every remaining action in the Parked Queue with a
   `HARD_GOVERNANCE` or unavailable external-resource boundary;
6. satisfy the TRAE Goal lifecycle requirement for repeated confirmation of
   the same blocking condition before setting the Goal-level blocked state.

On the first blocker occurrence, checkpoint, park, recompute, and continue.
Never mark the whole Goal blocked merely because the current action cannot run.

Hard Goal boundaries include unresolved product/architecture semantics,
worktree identity mismatch, explicit destructive or version authorization,
cross-owner write authority, a mandatory stage review, and unavailable external
resources with no source-authorized equivalent. These boundaries forbid only
the affected action until the Ready Queue is exhausted.

## Required Source Pass

Before authoring or reviewing:

1. Verify TRAE runtime, Goal state, existing/background agents, repository,
   and the fail-closed Worktree Binding below.
2. Ask `pt-god-view` for the current stage and owning skill.
3. Read that skill's authoritative workflow and artifacts.
4. For EXECUTE/DELIVER, read `active_work`, its formal plan, task statuses,
   dependency DAG, gates, and evidence.
5. For PRODUCT/DESIGN before a formal plan, do not fabricate `active_work` or a
   Context Anchor.
6. Inspect current code/evidence only to verify readiness and file ownership;
   do not redesign source-owned dependencies.
7. Exclude unrelated dirty paths.

Goal identity is the tuple:

```text
repository/worktree + branch + stage + source unit or Slice
```

Only an equivalent Goal or background agent with the same identity returns
`GOAL_LIFECYCLE_CONFLICT`. A Goal for another worktree is not a semantic
duplicate and must not block `AUTHOR`.

If no stage is resolvable, return `GOAL_STAGE_UNRESOLVED`.

## Fail-Closed Worktree Binding

The execution target is the current verified worktree by default. Skill
resolution and skill source locations provide instructions only; they are
never authority to select or change the execution target.

Before emitting or reviewing an executable Goal:

1. Resolve the current worktree's canonical runtime root.
2. From that exact root, capture the candidate identity:
   `python3 tooling/scripts/verify-worktree-binding.py --root '<absolute-root>' --capture`.
   Materialize the root as one POSIX shell-safe argument; use equivalent
   `shlex.quote` escaping when the path itself contains a single quote.
3. Compare the captured root, branch and `workspaceId` with the explicit user
   selection, `active_work` and current Context Anchor.
4. Immediately verify all captured values from the same root:
   `python3 tooling/scripts/verify-worktree-binding.py --root '<absolute-root>' --branch '<branch>' --workspace-id '<workspaceId>' --head '<head>' --worktree-set-digest '<digest>'`.
5. Materialize these literal values in the Goal's `Worktree Binding` section:
   canonical runtime worktree root, branch, `workspaceId`, initial `HEAD`,
   expected `HEAD`, and worktree-set digest. Initial and expected HEAD are
   identical when the Goal is created. Placeholders are not executable.

If capture or verification is unavailable or cannot materialize the exact
command, return `WORKTREE_IDENTITY_UNAVAILABLE`. If it runs from a different
working directory, reports a mismatch, or detects later drift, return
`WORKTREE_IDENTITY_MISMATCH`. Both states stop Goal authoring and execution.

Never repair a mismatch by automatically running `cd`, switching branches, or
selecting another worktree. Never run `git switch`, `git checkout`,
`git worktree add`, `git worktree remove`, or `git worktree prune`, and never
create a worktree, unless the user explicitly requests that exact operation.

Every subagent contract must require, as its first action:

- run the materialized `tooling/scripts/verify-worktree-binding.py` command
  against the Goal's binding;
- stop with `WORKTREE_IDENTITY_MISMATCH` on any mismatch;
- set the explicit bound worktree root as `workdir` on every mutating tool call.

The integrator must reverify the same binding before reconcile and before Slice
completion. All agents must reverify after resume or context compaction before
reading mutable state or continuing work.

The initial `HEAD` remains the Goal's immutable starting identity. The expected
runtime `HEAD` may be refreshed only after a commit, rebase, or merge that the
user explicitly authorized. The worktree-set digest may be refreshed only
after the exact worktree operation explicitly requested by the user. After an
authorized refresh, rerun the verifier, record the new expected value in Goal
state and tracked `active_work`, and retain the initial `HEAD`. Resume and
context compaction verify these persisted values; they never recapture current
Git state as a replacement baseline.

## Slice Selection

1. Obtain the current stage's authoritative work graph:
   - PRODUCT/DESIGN/PLAN: ordered checkpoints and review gate from the owning
     stage skill;
   - EXECUTE/DELIVER: workstreams, closures, dependencies, and gates from the
     accepted plan.
2. Inventory every in-scope action and classify it as ready, in progress,
   parked, or done without adding, removing, or reordering semantic
   dependencies.
3. Compute the complete dependency-ready frontier.
4. Group ready work by shared stage outcome, evidence tier, runtime environment,
   and reconcile boundary.
5. Select the broadest bounded execution horizon that can safely drain within
   the same stage, worktree, ownership boundary, and Goal budget. Do not force
   each action or workstream into a separate Goal.
6. Include currently blocked in-scope actions in the Parked Queue with their
   unblocking conditions; they remain non-executable until those conditions
   change.
7. Stop before a different stage, review boundary, forbidden owner, or
   architecture/product decision, while continuing unrelated ready work inside
   the horizon.
8. Record out-of-scope remainder in the durable source, not as an invented Goal
   backlog.

If the authoritative graph is incomplete or wrong, return
`PLAN_AMENDMENT_REQUIRED`, `DESIGN_AMENDMENT_REQUIRED`, or
`PRODUCT_AMENDMENT_REQUIRED` through the owning skill. Do not repair it here.

If no work is initially ready, run the Goal-Level Blocked Gate before returning
`GOAL_SLICE_BLOCKED`. A single blocked action or an incomplete first-pass
inventory is insufficient.

## TRAE Worker Projection

The owning source decides what work may be parallel. This skill only maps those
approved independent units onto TRAE subagents.

Each subagent contract contains:

- first-action Worktree Binding verification and explicit bound `workdir`;
- source checkpoint, closure, workstream, or task ID;
- prerequisites;
- in-scope and forbidden behavior;
- exclusive write set, including focused tests;
- read-only shared sources;
- verification command;
- expected return;
- source-defined hard stops.

Never give concurrent writers overlapping files or generated artifacts. Keep
inseparable work serial.

Assign one integrator. For EXECUTE, its reconcile behavior is projected from
`pt-execution-plan-guardian`; for other stages, it uses that stage's review or
reduction contract. The integrator reads actual outputs, checks interfaces and
combined behavior, and never treats subagent summaries as evidence.

## Gate And Claim Projection

Copy only the selected Slice's gates, evidence, cleanup, failure states, and
non-claims from authoritative sources.

- PRODUCT uses its product review gate.
- DESIGN uses its architecture review gate.
- PLAN uses its plan review gate.
- EXECUTE uses plan-defined verification and Acceptance.
- DELIVER uses quality, completion, commit, PR, and review gates.

Do not require runtime evidence for a stage whose source does not require it.
Do not define new `PASS`, `PROVEN`, readiness, or failure semantics in the Goal.

## Tracking

- PRODUCT/DESIGN before a formal plan: track through their source artifacts and
  TRAE Goal state only.
- After a formal plan exists: update plan evidence/status, then `active_work`,
  then invoke `pt-context-anchor`.
- Every queue transition projects source-owned state; it never becomes a second
  completion authority.
- A dynamically admitted tracked action must be added to the formal plan before
  it enters the Ready Queue.
- Blocking one action updates its plan evidence and Parked Queue entry without
  setting `active_work.blocked=true` while another legal action is ready.
- Completing a Slice advances only its source-owned checkpoints or plan tasks.
- `NEXT` rereads the updated source graph only after the current Goal reaches
  its completion, stage, or hard-boundary cut. It does not persist or activate
  a successor queue.

## Output

For `AUTHOR`, read and populate [`GOAL_TEMPLATE.md`](./GOAL_TEMPLATE.md).

Render the entire Goal inside one four-backtick `markdown` fence:

- `/goal` is the first line inside the fence;
- internal examples may use triple-backtick fences;
- no four-backtick sequence may appear inside the Goal;
- no Goal content may appear outside the fence;
- do not embed `Use Skill:` directives; `pt-god-view` owns dispatch.

Fence failure is `COPY_UNSAFE_GOAL`; regenerate instead of returning partial
output.

For `REVIEW`, read [`REVIEW_RUBRIC.md`](./REVIEW_RUBRIC.md). Missing/conflicting
sources produce the named blocker without an executable Goal. A text-only Goal
defect produces findings followed by one complete corrected Goal.

For `NEXT`, return one candidate only after the prior Slice's durable state is
updated. The candidate still passes the full AUTHOR workflow.

## Verification

- Current stage and owning skill resolve.
- The Slice maps only to source-defined or mechanically admitted in-scope work.
- Ready, in-progress, parked, and done states are explicit.
- One blocked action cannot stop unrelated ready work.
- Dynamic admission cannot redefine product, architecture, ownership, version,
  destructive authorization, or proof strength.
- Goal-level blocked requires an empty Ready Queue and a recorded exhaustion
  proof.
- It does not cross a stage review boundary.
- It does not redefine dependencies, acceptance, failure, or claim semantics.
- Concurrent write sets do not overlap.
- External blockers stay parked and non-executable until their source-defined
  unblocking conditions change.
- The Worktree Binding contains six materialized identity values.
- Every subagent verifies the binding first and uses the bound `workdir` for
  every mutating tool call.
- Binding verification repeats after resume or compaction and before reconcile
  and completion.
- The output is one copy-safe TRAE block.
- Goal completion cannot imply broader stage or plan completion.

## Anti-Patterns

Never:

- copy an entire plan into one Goal by default;
- split every ready action into a separate Goal when one bounded adaptive queue
  can execute them safely;
- invent a task graph, execution closure, architecture rule, or product state;
- duplicate God View dispatch or Guardian execution rules;
- create a second progress, successor, evidence, or completion source of truth;
- create a Goal when equivalent Goal/background work already exists;
- treat a Goal from another worktree as a semantic duplicate;
- infer the execution target from a skill's resolved or source path;
- auto-change directories, branches, or worktrees to satisfy a binding;
- mutate without an explicit bound `workdir`;
- refresh `HEAD` or worktree-set identity without the required explicit user
  authorization;
- allow one Goal to cross a methodology stage gate;
- include blocked external work in the Ready Queue or count it as progress;
- treat the first blocked action as proof that the whole Goal is blocked;
- leave legal dependency-ready work unexecuted because another queue item is
  parked;
- auto-admit a task that changes product, architecture, ownership, version,
  destructive authorization, or proof semantics;
- activate the next Goal before durable state is updated and reread;
- create extra worktrees unless explicitly requested;
- operate outside TRAE.
