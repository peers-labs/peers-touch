---
name: "pt-context-anchor"
description: "Reads verified tracked-work sources and renders one copyable chat projection for status, resume, handoff, blockers, readiness, or close. It never repairs or mutates workflow state."
stage: "cross-stage"
requires: ["canonical BindingProjection", "valid PlanMount and ExecutionRun", "matching workspace active-work record", "verified worktree identity"]
produces: ["verified read-only Context Anchor"]
---

# Context Anchor

Context Anchor is a read-only projection adapter.

```text
durable owner state -> validate -> project to chat
```

It does not synchronize, repair, or write durable state.
At a host Stop boundary, `workflow-anchor.mjs` is the rendering owner: the
Skill emits the exact machine-rendered block and does not reconstruct or edit
it. The Kernel stores the machine-local receipt and validates response
completeness before release.

## Invoke When

- Reporting tracked-work status, progress, blocker, readiness, handoff, or
  close.
- Preparing for context compaction.
- A resume needs a verified projection before or after continued execution.

Do not invoke before a formal plan and matching workspace active-work record
exist.

## Boundary

This Skill may read:

- the current canonical `BindingProjection`;
- the current workspace's `workflow/active-work.json`;
- the stable Plan through its current immutable ExecutionPlanSnapshot;
- the ExecutionRun's current Task Slice;
- matching Development `session.json`;
- referenced durable evidence;
- verified Git/worktree identity;
- scheduler lane state supplied by the current Development Run.

It must not:

- update active-work state;
- change PlanMount, ExecutionRun, or Task lifecycle;
- append Session events;
- recompute or persist a scheduler queue;
- acquire resources or execute work;
- infer missing facts from chat;
- write a `## Context Anchor` section into any repository document.
- rewrite, abbreviate, or manually recreate a Kernel-rendered Stop Anchor.

When sources disagree, return `CONTEXT_PROJECTION_STALE` with the mismatched
fields and their owning writer. `pt-dev-workflow` coordinates repair through
the owner, then invokes this Skill again.

## Source Ownership

| Projected field | Read owner |
|---|---|
| Worktree, branch, `workspaceId` | verified Git binding |
| Initial HEAD | ExecutionPlanSnapshot execution binding |
| Expected HEAD | workspace active-work projection verified against declaration and Git |
| Main task, scope, architecture/product decisions | accepted sources |
| Stage and tracked locator | workspace active-work record |
| Task lifecycle/current Task/dependencies | ExecutionRun plus immutable snapshot DAG |
| Current transition and first failure | Development Session |
| Completed delta and evidence | Task snapshot plus referenced evidence |
| Remaining frontier, lanes, conflict controls, critical path | scheduler output backed by the current graph |
| Overall progress and next completion effect | `planctl status.progress` |
| Next Progress Slice | current Task plus scheduler horizon |
| Plan Run queue | ordered dependency-ready successor frontier from the Plan DAG and scheduler |
| Execution mandate and autonomous horizon | verified Plan Run input supplied by `pt-dev-workflow` plus accepted Plan authorization |
| Stop conditions | DWF-D20 hard boundaries plus current verified blockers |
| ETA | remaining critical path plus observed throughput |

No global precedence rule exists. Each field comes from its owner.

## Active Work Locator

Tracked work reads exactly:

```text
~/.peers-touch/dev/workspaces/<workspaceId>/workflow/active-work.json
```

Validation rules:

- schema, revision and digest validate;
- `mountId/runId/snapshotDigest/planId/planPath` match current Plan owners;
- `currentTaskId/currentTaskPath/taskStatus` mirror the run-selected Task;
- `devState` mirrors `session.json` or is `null`;
- branch, workspace and expected HEAD match declaration and verified Git state;
- initial HEAD matches the Plan's immutable baseline.

The Anchor reports a mismatch; it never rewrites the record. Project memory is
not an input.

## Read Procedure

1. Resolve the workspace's current PlanMount, snapshot, and ExecutionRun; read only that
   workspace's active-work record with `make active-work-status`.
2. Revalidate the current `BindingProjection`. Its role, binding/root/parent
   digests, assignment, release/child state, and execution root must match the
   invoking lineage. Never select a binding by enumerating a worktree.
3. Verify the persisted worktree and mount. Do not recapture a snapshot,
   replace a live mount, or change an unfinished run.
4. Run `planctl validate`, `planctl current`, and `planctl status`.
5. Read the immutable snapshot, only `current_task_path`, and matching
   `session.json`.
6. Validate each projected field against its owner.
7. Use `unknown` for ETA when critical-path or throughput evidence is
   insufficient.
8. Require one source-backed Next Progress Slice for an active non-blocked
   package. It must target the current Task's `in_progress -> done` boundary,
   copy `completedAfter` and `percentageAfter` from
   `planctl status.progress.nextProgressBoundary`, state the exact
   percentage-point and unlock delta, and identify the post-closure successor
   frontier or the Plan terminal state. Never derive the target by adding a
   rounded percentage or by counting unlocked Tasks as complete.
9. Render one final chat block.

When invoked by the Workflow Kernel at Stop, steps 1-8 are already represented
by the supplied receipt. Emit its `content` byte-for-byte; do not append fields
or replace unknown values.

Do not scan archive files, every Task body, raw command logs, or conversation
history.

## Required Chat Projection

Every user-facing Context Anchor is one fenced `markdown` block exactly like:

````markdown
```markdown
**Context Anchor**
- **Main task**:
- **Execution mandate**: <status-only or authorized Plan Run>
- **Autonomous horizon**: <Plan terminal state or named hard boundary>
- **Execution horizon**:
- **Current closure / state**:
- **Worktree / branch / workspace**:
- **Initial HEAD**:
- **Expected / verified HEAD**:
- **Progress**: <done>/<total> Task closures (<percentage>%)
- **Completed delta**:
- **Next Progress Slice**: <Task ID, outcome, and completion boundary>
- **Projected progress after Next**: <completedAfter>/<total> Task closures (<percentageAfter>%)
- **Expected progress effect**: <+1 closure, percentage-point delta, unlocked Task IDs>
- **Plan Run queue**: <ordered dependency-ready successor Tasks/Slices after the current closure>
- **Remaining frontier**:
- **Execution mode / lanes**:
- **Conflict controls**:
- **Critical path / ETA**:
- **Evidence**:
- **Stop conditions / decisions**:
- **Tracking document**:
```
````

The block is the final section of tracked status/handoff responses. Render the
worktree as `<worktree-name> (<repo-root>)`; never persist a user-home absolute
path.

## Resume Behavior

For status-only requests, emit the projection and stop.

For `continue`/`resume`, projection must not pause execution. `pt-dev-workflow`
continues first and invokes this Skill at the next meaningful report boundary.
A successful declaration, authorization, status check, diagnostic, checkpoint,
deploy, or focused check is internal Slice activity and must not trigger a new
Anchor while the Task remains open. Task closure, review success, and Anchor
emission are also internal Plan Run boundaries when a dependency-ready
successor exists. A zero-delta Anchor is valid only at a hard boundary after the
complete ready frontier is exhausted.

## Output Errors

- `TRACKED_WORK_NOT_FOUND`
- `TRACKED_WORK_AMBIGUOUS`
- `WORKTREE_IDENTITY_UNAVAILABLE`
- `WORKTREE_IDENTITY_MISMATCH`
- `PLAN_PACKAGE_INVALID`
- `CONTEXT_PROJECTION_STALE`

Each error names the mismatched field and owning writer.

## Verification

- The PlanMount, snapshot, ExecutionRun, and matching locator exist.
- Git identity matches persisted binding.
- Binding role and lineage match the current canonical `BindingProjection`;
  expired or terminal child state cannot support a status or final claim.
- `planctl current`, current Task, Session, declaration, Git and workspace
  active-work agree.
- Progress, completed delta, Next Progress Slice, projected progress after
  Next, expected progress effect, Plan Run queue, remaining frontier,
  execution mandate, autonomous horizon, stop conditions, lanes, conflict
  controls, and critical path are source-backed.
- Evidence distinguishes `PASS`, `FAIL`, `NOT RUN`, and `UNPROVEN`.
- No file, registry, plan, Session, or runtime state was mutated.
- The response ends with one fenced chat projection.
- A terminal or blocked host Stop has a matching machine-local Anchor receipt
  and create-once release receipt.

## Anti-Patterns

Never:

- repair stale owner state;
- create or update active-work state;
- read project memory as runtime truth;
- reconstruct state from chat;
- recapture Git identity during resume;
- invent progress or ETA;
- emit a free-text administrative `Next action`;
- end an authorized Plan Run with `Continue?` or imply that Anchor output needs
  user confirmation;
- emit a successful zero-delta continuation while the current Task remains
  closable;
- report stale agent metadata as a live lane;
- treat one parked action as a Goal-wide blocker;
- use the Anchor as completion authority;
- persist secrets, transient logs, or absolute user-home paths.
