---
name: "pt-context-anchor"
description: "Reads verified tracked-work sources and renders one copyable chat projection for status, resume, handoff, blockers, readiness, or close. It never repairs or mutates workflow state."
stage: "cross-stage"
requires: ["valid Plan Package", "matching workspace active-work record", "verified worktree identity"]
produces: ["verified read-only Context Anchor"]
---

# Context Anchor

Context Anchor is a read-only projection adapter.

```text
durable owner state -> validate -> project to chat
```

It does not synchronize, repair, or write durable state.

## Invoke When

- Reporting tracked-work status, progress, blocker, readiness, handoff, or
  close.
- Preparing for context compaction.
- A resume needs a verified projection before or after continued execution.

Do not invoke before a formal plan and matching workspace active-work record
exist.

## Boundary

This Skill may read:

- the current workspace's `workflow/active-work.json`;
- compact Plan Package `plan.md`;
- the manifest's current Task Slice;
- matching Development `session.json`;
- referenced durable evidence;
- verified Git/worktree identity;
- scheduler lane state supplied by the current Development Run.

It must not:

- update active-work state;
- change Plan Package or Task lifecycle;
- append Session events;
- recompute or persist a scheduler queue;
- acquire resources or execute work;
- infer missing facts from chat;
- write a `## Context Anchor` section into any repository document.

When sources disagree, return `CONTEXT_PROJECTION_STALE` with the mismatched
fields and their owning writer. `pt-dev-workflow` coordinates repair through
the owner, then invokes this Skill again.

## Source Ownership

| Projected field | Read owner |
|---|---|
| Worktree, branch, `workspaceId` | verified Git binding |
| Initial HEAD | Plan Package immutable binding |
| Expected HEAD | workspace active-work projection verified against declaration and Git |
| Main task, scope, architecture/product decisions | accepted sources |
| Stage and tracked locator | workspace active-work record |
| Task lifecycle/current Task/dependencies | Plan Package manifest |
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
- `planId/planPath` match the immutable workspace binding;
- `currentTaskId/currentTaskPath/taskStatus` mirror the manifest-selected Task;
- `devState` mirrors `session.json` or is `null`;
- branch, workspace and expected HEAD match declaration and verified Git state;
- initial HEAD matches the Plan's immutable baseline.

The Anchor reports a mismatch; it never rewrites the record. Project memory is
not an input.

## Read Procedure

1. Resolve the workspace's immutable machine Plan binding and read only that
   workspace's active-work record with `make active-work-status`.
2. Verify the persisted worktree and Plan bindings. Do not recapture a new
   baseline or rebind the workspace.
3. Run `planctl validate`, `planctl current`, and `planctl status`.
4. Read compact `plan.md`, only `current_task_path`, and matching
   `session.json`.
5. Validate each projected field against its owner.
6. Use `unknown` for ETA when critical-path or throughput evidence is
   insufficient.
7. Require one source-backed Next Progress Slice for an active non-blocked
   package. It must target the current Task's `in_progress -> done` boundary,
   copy `completedAfter` and `percentageAfter` from
   `planctl status.progress.nextProgressBoundary`, state the exact
   percentage-point and unlock delta, and identify the post-closure successor
   frontier or the Plan terminal state. Never derive the target by adding a
   rounded percentage or by counting unlocked Tasks as complete.
8. Render one final chat block.

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

- The Plan Package and matching locator exist.
- Git identity matches persisted binding.
- `planctl current`, current Task, Session, declaration, Git and workspace
  active-work agree.
- Progress, completed delta, Next Progress Slice, projected progress after
  Next, expected progress effect, Plan Run queue, remaining frontier,
  execution mandate, autonomous horizon, stop conditions, lanes, conflict
  controls, and critical path are source-backed.
- Evidence distinguishes `PASS`, `FAIL`, `NOT RUN`, and `UNPROVEN`.
- No file, registry, plan, Session, or runtime state was mutated.
- The response ends with one fenced chat projection.

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
