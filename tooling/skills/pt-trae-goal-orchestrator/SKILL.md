---
name: "pt-trae-goal-orchestrator"
description: "Selects bounded Goal Slices, reconciles live agents, and builds conflict-aware TRAE execution envelopes. Invoke for Goal authoring, review, or selecting the next long-running unit."
stage: "cross-stage"
requires: ["TRAE runtime", "resolvable project stage and governing sources"]
produces: ["reviewed TRAE /goal prompt", "bounded Goal Slice", "next-slice handoff"]
---

# TRAE Goal Orchestrator

## Invoke When

- The user asks for a `/goal`, autonomous long-running focus, or multi-subagent
  execution envelope.
- The user asks to review an existing Goal.
- A completed Goal needs one next dependency-ready Goal selected.

This skill works only in TRAE. If TRAE Goal lifecycle or subagent capabilities
are unavailable, return `TRAE_RUNTIME_REQUIRED`. Do not translate the Goal into
another IDE's workflow model.

## Core Rule

Goal is a TRAE runtime focus and persistence mechanism. It is not a product
definition, architecture, execution plan, stage dispatcher, guardrail, or
completion authority.

```text
pt-ew
  -> pt-god-view resolves the current stage
  -> owning stage skill provides the authoritative work graph and gates
  -> pt-trae-goal-orchestrator selects one bounded Goal Slice
  -> TRAE runs that Slice with focused subagents
  -> owning stage skill judges its output
  -> durable state advances
  -> next invocation selects the next Slice
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
| `AUTHOR` | Select and render one copyable Goal Slice |
| `REVIEW` | Review a Goal; correct it only when authoritative sources permit |
| `NEXT` | After Slice completion, reread durable state and select one next Slice |

There is no `GUIDE` mode. A running Goal is guided by `pt-god-view` and the
current stage's owning skill.

## Goal Slice

```text
Plan or stage workflow = durable full-scope work graph
Goal Slice = one bounded TRAE execution lease
Subagent = one parallel unit inside that Slice
active_work = tracked-plan continuity, only after a formal plan exists
```

A valid Slice is:

- **dependency-closed**: prerequisites are complete or included;
- **ownership-closed**: write and integration ownership are explicit;
- **evidence-closed**: available inputs can produce a decisive stage result;
- **recovery-closed**: durable sources can resume interrupted work;
- **scope-bounded**: the Slice ends before a stage or external-resource gate;
- **outcome-meaningful**: it delivers a coherent outcome, not one command.

State invariants:

```text
subagent complete != Goal Slice complete
Goal Slice complete != stage or plan complete
stage or plan complete = all mandatory source-owned closures and gates complete
```

One Goal Slice belongs to exactly one PRODUCT, DESIGN, PLAN, EXECUTE, or DELIVER
stage. End it before a stage review boundary. Goal persistence never bypasses a
methodology gate.

## Required Source Pass

Before authoring or reviewing:

1. Verify TRAE runtime, Goal state, existing/background agents, repository,
   and the fail-closed Worktree Binding below. Classify listed agents by Goal
   identity and backend reachability; display presence alone is not ownership.
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

### Existing-Agent Reconciliation

Before treating a listed agent as active:

1. Compare its repository/worktree, branch, stage, and source unit with the
   candidate Goal identity.
2. Confirm the backend can address it by agent ID or canonical task name.
3. Treat only a live, addressable, equivalent agent as
   `GOAL_LIFECYCLE_CONFLICT`.
4. If an entry is listed but the backend reports it does not exist, record
   `SUBAGENT_REGISTRY_STALE`, exclude it from active ownership, and continue
   Goal authoring.
5. If a fresh spawn is rejected after reconciliation, report
   `SUBAGENT_RUNTIME_UNAVAILABLE`; do not convert that runtime incident into a
   durable no-subagent rule.

Goal text MUST NOT contain a blanket prohibition based only on stale agent
visibility, historical agent count, or a prior runtime incident.

### Goal Replacement

If an active Goal's persisted objective contains a stale Worktree Binding,
superseded authorization boundary, or invalid blanket execution constraint and
the runtime cannot edit that objective in place, return
`GOAL_REPLACEMENT_REQUIRED`. The old Goal must be explicitly closed or
cancelled before authoring its corrected replacement. Neither `active_work` nor
a Context Anchor may be used to pretend the stale Goal was repaired.

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
2. Compute the dependency-ready frontier without adding, removing, or reordering
   semantic dependencies.
3. Exclude work blocked by decisions, approvals, resources, environments, or
   conflicting ownership.
4. Group ready work by shared stage outcome, evidence tier, runtime environment,
   and reconcile boundary.
5. Select the smallest group that produces one meaningful stage-owned result.
6. Stop before the first different stage, review, resource, environment,
   ownership, or proof boundary.
7. Record the remainder as source-owned work, not a second Goal backlog.

If the authoritative graph is incomplete or wrong, return
`PLAN_AMENDMENT_REQUIRED`, `DESIGN_AMENDMENT_REQUIRED`, or
`PRODUCT_AMENDMENT_REQUIRED` through the owning skill. Do not repair it here.

If no work is ready, return `GOAL_SLICE_BLOCKED` with the exact blocking edge
and do not emit `/goal`.

## TRAE Worker Projection

The owning source decides what work may be parallel. This skill only maps those
approved independent units onto TRAE subagents.

Every Goal MUST include an explicit `parallel`, `serial`, or `hybrid`
concurrency decision. Select parallel subagent lanes only after proving frozen
shared contracts, non-overlapping write sets and generated outputs, isolated
runtime resources, independent checks, and a deterministic integration order.
Serialize dependent work, shared-file/generated-artifact changes, database or
Fixture mutation, deployment, and final product Gates unless the owning source
defines safe isolation.

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

Before spawning, reserve each exclusive write set in the Goal. A subagent must
re-read its owned files immediately before patching, avoid broad formatters and
generators, never stage or commit, stop if an unexpected writer changes its
owned paths, and return its exact changed-file list. The integrator owns shared
files and verifies the combined diff before accepting any lane.

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
- Completing a Slice advances only its source-owned checkpoint or plan task.
- `NEXT` rereads the updated source graph and returns one next candidate. It
  does not persist or activate a successor queue.

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
- The Slice maps only to source-defined ready work.
- It does not cross a stage review boundary.
- It does not redefine dependencies, acceptance, failure, or claim semantics.
- Concurrent write sets do not overlap.
- External blockers remain outside the executable Slice.
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
- invent a task graph, execution closure, architecture rule, or product state;
- duplicate God View dispatch or Guardian execution rules;
- create a second progress, successor, evidence, or completion source of truth;
- create a Goal when equivalent Goal/background work already exists;
- treat a Goal from another worktree as a semantic duplicate;
- treat a stale, backend-unaddressable agent entry as a live conflict;
- persist a transient stale-agent or spawn-runtime incident as a blanket
  `do not spawn subagents` authorization constraint;
- resume a Goal whose persisted objective requires
  `GOAL_REPLACEMENT_REQUIRED`;
- infer the execution target from a skill's resolved or source path;
- auto-change directories, branches, or worktrees to satisfy a binding;
- mutate without an explicit bound `workdir`;
- refresh `HEAD` or worktree-set identity without the required explicit user
  authorization;
- allow one Goal to cross a methodology stage gate;
- include blocked external work to make the Goal appear comprehensive;
- activate the next Goal before durable state is updated and reread;
- create extra worktrees unless explicitly requested;
- operate outside TRAE.
