# TRAE Adaptive Goal Slice Output Template

Render the populated template inside one four-backtick `markdown` fence. Do not
include this title or explanatory text in the generated Goal.

/goal

## Objective

<One meaningful stage-owned outcome that may require several queued actions.>

## Goal Slice

- Stage: <PRODUCT | DESIGN | PLAN | EXECUTE | DELIVER>
- Source unit: <stage checkpoint or formal plan workstream/task IDs>
- Execution horizon: <the broadest same-stage/worktree/owner scope this Goal may drain>
- Completion boundary: <what this Goal may complete without crossing a stage gate>
- Hard cut point: <product, architecture, authorization, ownership, worktree, or external-resource boundary>

## Worktree Binding

- Canonical runtime worktree root: `<materialized-canonical-absolute-path>`
- Branch: `<materialized-branch>`
- `workspaceId`: `<materialized-workspaceId>`
- Initial HEAD: `<materialized-full-commit>`
- Expected HEAD: `<initially identical to Initial HEAD; refresh only after an explicitly authorized commit, rebase, or merge>`
- Worktree-set digest: `<materialized-digest>`
- Capture command: `python3 tooling/scripts/verify-worktree-binding.py --root '<materialized-canonical-absolute-path>' --capture`
- Verification command: `python3 tooling/scripts/verify-worktree-binding.py --root '<materialized-canonical-absolute-path>' --branch '<materialized-branch>' --workspace-id '<materialized-workspaceId>' --head '<materialized-expected-head>' --worktree-set-digest '<materialized-digest>'`
- Shell quoting: every materialized value is one POSIX shell-safe argument;
  use equivalent `shlex.quote` escaping when a value contains a single quote.
- Identity source: the current verified worktree; skill resolution and skill
  source locations are not execution-target authority.
- Mismatch policy: verifier absence or an unresolved field stops with
  `WORKTREE_IDENTITY_UNAVAILABLE`; capture/verification from any directory
  other than the bound root or any identity drift stops with
  `WORKTREE_IDENTITY_MISMATCH`. Never automatically run `cd`, switch branches,
  or select another worktree to repair either state.
- Mutation policy: every mutating tool call sets the canonical runtime worktree
  root above as its explicit `workdir`.
- Reverification: every agent verifies first, all agents reverify after resume
  or context compaction against persisted values without recapturing a new
  baseline, and the integrator reverifies before reconcile and before Slice
  completion.
- Refresh policy: retain Initial HEAD; refresh Expected HEAD only after an
  explicitly authorized commit, rebase, or merge; refresh the worktree-set
  digest only after the exact explicitly requested worktree operation.
- Forbidden worktree operations: no `git switch`, `git checkout`,
  `git worktree add`, `git worktree remove`, `git worktree prune`, or new
  worktree unless the user explicitly requests that exact operation.

## Governing Sources

- `<repo-relative-path>`: <authority>

## In Scope

- <all source-defined work inside the bounded execution horizon>

## Out Of Scope And Remainder

- <work retained by the broader stage or plan>
- <different-stage, different-worktree, or different-owner work>

## Hard Constraints

- <project and stage invariants projected from authoritative sources>

## Source Work Graph

<Projection of the owning stage workflow or formal plan DAG. Do not redesign
dependencies here.>

## Concurrency Decision

- Mode: <parallel | serial | hybrid>
- Dependency-ready units:
- Dependency barriers and contract-freeze points:
- Exclusive write-set owners:
- Shared files / generated artifacts:
- Shared runtime resources:
- Active and queued execution lanes:
- Critical path:
- Serial units and concrete reason:
- Integration order and rollback boundary:
- Existing-agent reconciliation:
  - only live, backend-addressable agents with the same Goal identity conflict;
  - stale, backend-unaddressable entries are recorded as
    `SUBAGENT_REGISTRY_STALE` and excluded from active ownership;
  - never persist a blanket no-subagent rule from stale registry metadata.
- Degraded execution: if a fresh spawn is rejected after reconciliation,
  report `SUBAGENT_RUNTIME_UNAVAILABLE`, recompute the mode, and continue
  serially only when that remains safe and materially useful.

## Adaptive Execution Queue

### Initial Ready Queue

| Action | Source task | Dependencies | Owner/write set | Required evidence |
|---|---|---|---|---|
| <action> | <plan/checkpoint ID> | <complete prerequisites> | <owner> | <gate/check> |

### Initial In Progress

- None at Goal creation, or <resumed action with verified owner and state>.

### Initial Parked Queue

| Action | Blocking class | Exact blocking edge | Owner | Unblocking condition |
|---|---|---|---|---|
| <action> | <SOFT_EXTERNAL or HARD_GOVERNANCE> | <evidence-backed reason> | <owner> | <observable condition> |

### Completed Baseline

| Action | Source task | Evidence |
|---|---|---|
| <completed prerequisite> | <plan/checkpoint ID> | <source-owned evidence> |

### Dynamic Admission Rules

- Admit root-cause fixes, diagnostics, tests, evidence repair, documentation
  synchronization, and other already-modeled remediation when accepted sources already
  determine the behavior and the work remains inside this Goal's stage,
  worktree, ownership, and scope.
- A newly discovered deliverable or dependency is not admitted by the Goal.
  Return `PLAN_AMENDMENT_REQUIRED` to `pt-dev-workflow`; only the plan owners
  may update the formal plan before the scheduler is invoked again.
- Never auto-admit product semantics, architecture/ownership/topology changes,
  version or schema bumps requiring approval, destructive operations requiring
  authorization, cross-worktree work, or weaker evidence substitutes.

## Development Run Contract

1. Reverify the Worktree Binding before every resumed execution interval.
2. Submit dependency-ready actions and the Concurrency Decision to
   `pt-execution-plan-guardian`.
3. `pt-dev-workflow` executes only `ACTION_ALLOWED` work and owns all durable
   state updates.
4. When an action blocks, classify it as
   `RECOVERABLE_IMPLEMENTATION`, `MECHANICAL_PLAN_GAP`, `SOFT_EXTERNAL`, or
   `HARD_GOVERNANCE`.
5. Return plan gaps to the workflow; otherwise park the blocked action with
   its unblocking condition.
6. Recompute the complete in-scope ready frontier and continue. One parked
   action never blocks unrelated ready work.
7. The workflow persists plan, Session, `active_work`, and evidence through
   their owners; the Goal does not write them.
8. Mark the whole Goal blocked only after the Ready Queue is empty, no legal
   diagnostic or remediation remains, every remaining action is hard-blocked,
   and the repeated-blocker lifecycle threshold is satisfied.

## TRAE Subagent Topology

### Agent A — <role>

- First action: run the Worktree Binding verification command from the bound
  root and stop with `WORKTREE_IDENTITY_MISMATCH` on any mismatch.
- Mutating tool workdir: the bound canonical runtime worktree root.
- Source unit:
- Prerequisites:
- Exclusive write set:
- Read-only sources:
- Shared paths the agent must not edit:
- Forbidden scope:
- Required verification:
- Return contract:
- Hard stops:

<Repeat only for genuinely independent agents.>

## Reconcile

- Integrator:
- Binding recheck: run the Worktree Binding verification command before
  reconcile and again before Slice completion.
- Inputs:
- Interface checks:
- Conflict policy:
- Required focused verification:

## Stage-Owned Gate Projection

- Owning skill:
- Required gate or review:
- Commands or review artifact:
- Evidence:
- Cleanup, when applicable:
- Non-claims:

## Failure And Escalation

- <Project-defined failure state>: <owner and stop behavior>
- `GOAL_REPLACEMENT_REQUIRED`: close or cancel an active Goal whose persisted
  binding or execution constraints cannot be corrected in place; do not use an
  Anchor to mask the stale objective.
- `RECOVERABLE_IMPLEMENTATION`: <root-cause remediation and retry>
- `MECHANICAL_PLAN_GAP`: <owning plan amendment and enqueue behavior>
- `SOFT_EXTERNAL`: <parked action and independent work that continues>
- `HARD_GOVERNANCE`: <required decision/authorization/owner/resource>
- Goal-level stop: only after queue exhaustion proof; never on the first
  blocked action.

## Slice Completion

- Complete when:
- Remains unproven:
- Parked at completion:
- Exhaustion proof, when blocked:
- Plan/stage completion effect:

## Tracking And Handoff

- Durable source update by `pt-dev-workflow`:
- `active_work` update by its owner, when tracked:
- Context Anchor, when tracked: include completed delta, ready queue, execution
  mode and lanes, conflict controls, critical path, and evidence-backed ETA or
  `unknown`.
- Next action: continue the Ready Queue; use `NEXT` only after this Goal reaches
  its completion, stage, or hard-boundary cut.
