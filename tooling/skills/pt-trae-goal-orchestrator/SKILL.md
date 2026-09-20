---
name: "pt-trae-goal-orchestrator"
description: "Schedules one bounded TRAE Goal Slice from an owner-supplied work graph. It selects ready work, parked work, ordering, and safe concurrency without executing or mutating durable state."
stage: "cross-stage"
requires: ["TRAE runtime", "verified binding", "authoritative stage work graph"]
produces: ["Goal Slice schedule", "Ready/Parked projection", "concurrency decision"]
---

# TRAE Goal Orchestrator

This Skill is the scheduler for TRAE Goals. It answers:

```text
From the work that owners already authorized, what should run next and in
which safe order or lanes?
```

It does not decide whether an action is permitted at execution time; that is
`pt-execution-plan-guardian`. It does not execute actions; that is
`pt-dev-workflow`.

## Invoke When

- The user asks to author, review, continue, or select the next TRAE `/goal`.
- A Development Run needs a bounded Ready/Parked schedule.
- Independent work may benefit from subagents.
- A blocked action must be parked while legal work continues.

Return `TRAE_RUNTIME_REQUIRED` when the TRAE Goal/subagent runtime is
unavailable.

## Ownership Boundary

| Concern | Owner |
|---|---|
| Stage and workflow route | `pt-god-view` / `pt-dev-workflow` |
| Product and architecture semantics | owning methodology Skills |
| Vertical dependency graph | `pt-architecture-execution-methodology` |
| Durable Plan Package and Task lifecycle | plan owners via `pt-dev-workflow` |
| Schedule, Ready/Parked frontier, lane allocation | this Skill |
| Per-action permission | `pt-execution-plan-guardian` |
| Execution and durable result writes | `pt-dev-workflow` |
| Status rendering | `pt-context-anchor` |

The scheduler is read-only with respect to plan, Task, Session,
`active_work`, evidence, Git, and runtime registries.

## Scheduler Input

The caller supplies:

- verified worktree binding and active Development declaration;
- current methodology stage;
- authoritative work graph;
- for tracked execution, validated Plan Package and current Task;
- completed dependencies and current evidence;
- declared source/runtime claims;
- Goal budget and hard boundaries;
- live agent registry with backend reachability.

Missing or contradictory inputs return `GOAL_SOURCE_UNRESOLVED`. Do not inspect
chat history to invent them.

## Goal Slice

```text
authoritative work graph -> one bounded Goal Slice -> proposed actions
```

A valid Slice is:

- dependency-closed;
- inside one stage, worktree, ownership envelope, and current Task;
- broad enough to close the current Task and produce the
  `planctl status.progress.nextProgressBoundary` effect;
- bounded by time, runtime, and review limits;
- recoverable from durable owner state;
- explicit about Ready, In Progress, Parked, and Done actions.

Goal completion must imply the selected Task closure. It never implies broader
stage, plan, or product completion.

## Schedule Algorithm

1. Remove actions whose owner completion criteria already pass.
2. Park actions with incomplete dependencies or hard external/governance
   boundaries.
3. Put dependency-ready actions in the Ready Queue.
4. Group ready actions by frozen contracts, disjoint write sets, isolated
   runtime resources, independent verification, and integration order.
5. Choose one bounded serial, parallel, or hybrid horizon whose successful end
   closes the current Task. Internal setup or diagnostic actions are not Slice
   boundaries.
6. Submit proposed actions and lanes to `pt-execution-plan-guardian`.
7. Return the schedule to `pt-dev-workflow`.

The scheduler never adds a missing deliverable to the Plan Package. Discovery
of unmodeled required work returns `PLAN_AMENDMENT_REQUIRED` to the workflow.
If the current Task cannot be closed within one bounded Goal Slice, return
`PLAN_AMENDMENT_REQUIRED`; do not schedule a knowingly zero-delta continuation.

## Blocker Routing

`action blocked` is not `Goal blocked`.

- `RECOVERABLE_IMPLEMENTATION`: propose a diagnostic/root-cause action already
  implied by accepted sources.
- `PLAN_AMENDMENT_REQUIRED`: return to Dev Workflow; do not amend here.
- `SOFT_EXTERNAL`: park the action and continue independent ready work.
- `HARD_GOVERNANCE`: park pending the owning decision or authorization.

Recompute to a fixed point after every result. `GOAL_SLICE_BLOCKED` is legal
only when the Ready Queue is empty and every parked action has a named
unblocking condition outside the scheduler's authority.

## Mandatory Concurrency Decision

Every executable Slice records `parallel`, `serial`, or `hybrid` and explains:

- dependency-ready units;
- why shared contracts are frozen;
- that exclusive write sets are disjoint;
- isolated shared runtime resources;
- independent verification;
- integration order and rollback boundary;
- why any ready unit remains serial.

Reserve every write path before spawning. Shared files, generated outputs,
lockfiles, plan/tracking files, commits, deployments, and final product Gates
have one integrator owner unless the authoritative source defines stronger
isolation.

Subagents:

- receive the same verified binding and explicit `workdir`;
- own non-overlapping source paths;
- never stage, commit, deploy, mutate tracking, or run broad generators;
- stop on unexpected writes in their ownership;
- return exact changed files and focused verification results.

## Existing-Agent Reconciliation

An agent is a live conflict only when it is:

1. equivalent by worktree, branch, stage, and source unit;
2. backend-addressable by ID or canonical task name;
3. currently owns an overlapping write/runtime resource.

A listed but unaddressable entry is `SUBAGENT_REGISTRY_STALE`; exclude it from
live ownership. A rejected fresh spawn after reconciliation is
`SUBAGENT_RUNTIME_UNAVAILABLE`; recompute serial/hybrid scheduling without
turning that incident into a permanent no-subagent rule.

If the active Goal objective contains stale binding or invalid authorization
that cannot be edited, return `GOAL_REPLACEMENT_REQUIRED`.

## Modes

| Mode | Output |
|---|---|
| `AUTHOR` | One copyable Goal Slice from [`GOAL_TEMPLATE.md`](./GOAL_TEMPLATE.md) |
| `REVIEW` | Findings against [`REVIEW_RUBRIC.md`](./REVIEW_RUBRIC.md), then one corrected Goal if needed |
| `NEXT` | One successor candidate after durable owner state has advanced |

`NEXT` never activates or persists its candidate.

## Output Contract

The schedule contains:

- source/stage/current Task identity;
- progress baseline and the machine-derived Task completion effect;
- Ready, In Progress, Parked, and Done projections;
- selected horizon and stop boundary;
- Concurrency Decision and lane ownership;
- proposed action IDs for Guardian evaluation;
- hard blockers and unblocking conditions;
- evidence expected from each action;
- the one Task closure that makes the Slice successful;
- one integrator and reconcile order.

For `AUTHOR`, render one four-backtick `markdown` block with `/goal` as the
first line. Do not embed `Use Skill:` directives.

## Verification

- Every proposed action exists in the owner-supplied graph.
- The Slice success boundary closes the current Task and produces the declared
  `+1` Task-closure delta.
- No action crosses stage, current Task, worktree, or declared scope.
- Dependencies and parked boundaries are explicit.
- Concurrent writes and runtime resources do not overlap.
- Existing agents were reconciled by identity and reachability.
- The scheduler did not execute, mutate durable state, weaken evidence, or
  claim completion.

## Anti-Patterns

Never:

- become a second plan or execution workflow;
- amend the Plan Package, Task, Session, `active_work`, or evidence;
- make Guardian policy decisions itself;
- execute commands or mutate source;
- infer dependencies or acceptance from chat;
- mark the Goal blocked on its first parked action;
- treat stale agent metadata as a blanket spawn ban;
- let one Goal cross a stage/review boundary;
- auto-activate the next Goal.
- return a Goal whose successful boundary is only setup, status, authorization,
  diagnosis, checkpoint, deploy, or an individual check.
