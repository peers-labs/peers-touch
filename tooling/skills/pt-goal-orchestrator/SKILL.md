---
name: pt-goal-orchestrator
description: Schedules one bounded host-neutral Goal Slice from an owner-supplied work graph. Use when a Development Run needs ready, parked, ordering, or concurrency decisions.
stage: cross-stage
requires: ["verified binding", "authoritative stage work graph"]
produces: ["Goal Slice schedule", "Ready/Parked projection", "concurrency decision"]
---

# Goal Orchestrator

Human operating standard: `docs/global/workflow.md`.

This Skill is the host-neutral scheduler for Development Runs. It answers:

```text
From the work that owners already authorized, what should run next and in
which safe order or lanes?
```

It does not decide whether an action is permitted, execute actions, call
host-specific tools, or mutate durable state.

## Invoke When

- A Development Run needs a bounded Ready/Parked schedule.
- The user asks to author, review, continue, or select the next Goal Slice.
- Independent work may benefit from agents exposed by the current host.
- A blocked action must be parked while legal work continues.

Host-specific Goal syntax and worker tools are optional transports. Their
absence does not make the schedule unavailable.

## Ownership Boundary

| Concern | Owner |
|---|---|
| Stage and workflow route | `pt-god-view` / `pt-dev-workflow` |
| Product and architecture semantics | owning methodology Skills |
| Vertical dependency graph | `pt-architecture-execution-methodology` |
| Frozen Plan Version and durable ExecutionRun lifecycle | plan owners via `pt-dev-workflow` |
| Schedule, Ready/Parked frontier, lane allocation | this Skill |
| Host capability projection | this Skill |
| Host adapter invocation | `pt-dev-workflow` after Guardian admission |
| Per-action permission | `pt-execution-plan-guardian` |
| Execution and durable result writes | `pt-dev-workflow` |
| Status rendering | `pt-context-anchor` |

The scheduler is read-only with respect to Plan, Task, Session, workspace
active-work, evidence, Git, runtime registries, and host tool state.

## Scheduler Input

The caller supplies:

- verified worktree binding and active Development declaration;
- current methodology stage and authoritative work graph;
- for tracked execution, validated ExecutionPlanSnapshot, ExecutionRun, and current Task;
- completed dependencies and current evidence;
- declared source/runtime claims;
- Goal budget and hard boundaries;
- host capability inventory, when parallel workers are requested.

Missing or contradictory owner inputs return `GOAL_SOURCE_UNRESOLVED`. Do not
inspect chat history or host metadata to invent them.

## Goal Slice

A valid Goal Slice is:

- dependency-closed;
- inside one stage, worktree, ownership envelope, and current Task;
- broad enough to close the current Task and produce the
  `planctl status.progress.nextProgressBoundary` effect;
- bounded by time, runtime, and review limits;
- recoverable from durable owner state;
- explicit about Ready, In Progress, Parked, and Done actions.

Goal completion implies only the selected Task closure. It is an internal
scheduling and recovery unit inside a Plan Run, not a user interaction
boundary or a host-specific Goal object.

## Schedule Algorithm

1. Remove actions whose owner completion criteria already pass.
2. Park actions with incomplete dependencies or hard external/governance
   boundaries.
3. Put dependency-ready actions in the Ready Queue.
4. Group ready actions by frozen contracts, disjoint write sets, isolated
   runtime resources, independent verification, and integration order.
5. Choose one bounded serial, parallel, or hybrid horizon whose successful end
   closes the current Task.
6. Submit proposed actions and lanes to `pt-execution-plan-guardian`.
7. Return the schedule to `pt-dev-workflow`.

Discovery of unmodeled required work returns `PLAN_AMENDMENT_REQUIRED`. If the
current Task cannot close within one bounded Slice, return the same typed
result; do not schedule a knowingly zero-delta continuation.

## Host Capability Projection

The Goal Orchestrator is the sole request projector. Schedule first, then
project transport requirements:

1. Detect the current host from explicit runtime product metadata.
2. Use environment markers or the exposed tool registry only as corroboration.
   Directory existence and installed binaries are not host identity.
3. Select the matching adapter name as schedule metadata:
   - TRAE -> `pt-trae-host-adapter`
   - Cursor -> `pt-cursor-host-adapter`
   - Codex -> `pt-codex-host-adapter`
4. Emit one `Host Capability Request` per approved lane or UI action.
5. Return `HOST_IDENTITY_UNRESOLVED` only when a host-specific capability is
   required and the host cannot be established.

The scheduler never invokes an adapter. `pt-dev-workflow` submits the action to
the Guardian, invokes the selected adapter only after `ACTION_ALLOWED`, and
owns fallback, retries, cleanup, persistence, and reconciliation.

## Blocker Routing

`action blocked` is not `Goal blocked`.

- `RECOVERABLE_IMPLEMENTATION`: propose a source-backed diagnostic or fix.
- `PLAN_AMENDMENT_REQUIRED`: return to Dev Workflow.
- `SOFT_EXTERNAL`: park the action and continue independent work.
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
lockfiles, tracking files, commits, deployments, and final product Gates have
one integrator owner unless the authoritative source defines stronger
isolation.

Workers:

- receive a create-once WORKER assignment rooted in the same OWNER
  `BindingProjection`, preserve exact root/parent lineage, and use the OWNER
  execution root as explicit `workdir`;
- own non-overlapping source paths;
- never stage, commit, deploy, mutate tracking, or run broad generators;
- stop on unexpected writes in their ownership;
- return exact changed files and focused verification results.
- terminalize their child binding on PASS, FAIL, BLOCKED, or CANCELLED; an
  expired or terminal child is history and never blocks a later assignment.

Only live, addressable workers with equivalent worktree, branch, stage, source
unit, and overlapping ownership are conflicts. Stale metadata is
`SUBAGENT_REGISTRY_STALE`. A rejected fresh spawn is
`HOST_PARALLELISM_UNAVAILABLE`, not a permanent no-worker rule.

## Modes

| Mode | Output |
|---|---|
| `AUTHOR` | One host-neutral Goal Slice from [`GOAL_TEMPLATE.md`](./GOAL_TEMPLATE.md) |
| `REVIEW` | Findings against [`REVIEW_RUBRIC.md`](./REVIEW_RUBRIC.md), then one corrected Goal if needed |
| `NEXT` | One successor candidate after durable owner state has advanced |

`NEXT` never activates or persists its candidate. During an authorized Plan
Run, `pt-dev-workflow` consumes it and continues without user confirmation.

## Verification

- Every proposed action exists in the owner-supplied graph.
- Slice success closes the current Task and produces the declared `+1` delta.
- No action crosses stage, current Task, worktree, or declared scope.
- Concurrency is based on dependencies and ownership, not host branding.
- Host capability absence degrades only the affected transport.
- The scheduler did not execute, mutate state, weaken evidence, or claim
  completion.

## Anti-Patterns

Never:

- require TRAE, Cursor, Codex, or any other host to compute a schedule;
- become a second plan or execution workflow;
- execute commands or call host tools;
- infer dependencies or acceptance from chat;
- mark the Goal blocked on its first parked action;
- treat stale worker metadata as a blanket spawn ban;
- let one Goal cross a stage/review boundary;
- auto-activate the next Goal;
- return a Goal whose success boundary is only setup, diagnosis, deploy, or an
  individual check.
