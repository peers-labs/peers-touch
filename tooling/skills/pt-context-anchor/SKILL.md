---
name: "pt-context-anchor"
description: "Reads verified tracked-work sources and renders one copyable chat projection for status, resume, handoff, blockers, readiness, or close. It never repairs or mutates workflow state."
stage: "cross-stage"
requires: ["valid Plan Package", "matching workspace active-work record", "verified worktree identity"]
produces: ["verified read-only Context Anchor"]
---

# Context Anchor

Human operating standard: `docs/global/workflow.md`.

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
| Current Task timing | compact Workflow Snapshot derived from the bounded Session journal |
| Just-closed Task timing | transient `planctl advance` `closureObservation` supplied by the current Development Run |
| Token usage | current host observation when available; otherwise `not-observed` |
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

1. Run `make workflow-snapshot WORKFLOW_SNAPSHOT_PROJECTION=anchor` in the
   consuming worktree.
2. Require the projection kind `peers-touch-context-anchor-projection` and use its
   `HEALTHY | BLOCKED | DRIFT | SUSPENDED` verdict,
   `CONTINUE | HARD_BLOCK | COMPLETE` continuation, and typed findings without
   recomputing cross-owner consistency or Plan Run policy.
3. For `DRIFT`, report each mismatched field and owning writer exactly as the
   snapshot provides it. Do not recapture a baseline, rebind the workspace, or
   repair any owner.
4. Read the compact current Task Slice and referenced durable evidence needed
   for the chat projection; do not independently join Plan, Session,
   declaration, Git, active-work, runtime, or rollout state.
5. Preserve explicit absence in the rendered value: use `none` when no entity
   exists, `not-started` when the current Task has no Session, `not-observed`
   when an optional observation was not supplied, `inactive` when no
   Development Run exists, `blocked` for a verified blocker, and
   `not-scheduled` when no scheduler result exists. Use `UNKNOWN` only when
   source data is incomplete or contradictory.
6. Require one source-backed Next Progress Slice for an active non-blocked
   package. It must target the current Task's `in_progress -> done` boundary,
   copy `completedAfter` and `percentageAfter` from
   `planctl status.progress.nextProgressBoundary`, state the exact
   percentage-point and unlock delta, and identify the post-closure successor
   frontier or the Plan terminal state. Never derive the target by adding a
   rounded percentage or by counting unlocked Tasks as complete.
7. Always render current and recent observations independently. Read current
   Task timing and evidence only from `currentObservation` in the compact
   Snapshot. When Dev Workflow supplies the transient `closureObservation`
   returned by `planctl advance`, render it as the recent closure; otherwise
   render recent as `none`. A source-evidence-only closure has
   `not-observed` timing. Do not run another metrics command, scan old
   Sessions, or infer timing from chat.
8. Render host token usage only when the current host supplied an actual value.
   Otherwise render `not-observed`. Never estimate it and never write it into
   workflow state.
9. Render one final chat block.

Do not scan archive files, every Task body, raw command logs, or conversation
history.

## Required Chat Projection

Every user-facing Context Anchor is one fenced `markdown` block exactly like:

````markdown
```markdown
**Context Anchor** · <HEALTHY|BLOCKED|DRIFT|SUSPENDED>/<CONTINUE|HARD_BLOCK|COMPLETE> · mandate:<plan-run|status-only>
- **Plan**: <main task> · <status> · <done>/<total> (<percentage>%) · <plan-path>
- **Current / Next Progress Slice**: <task-id> · <session-state> · cc:<completion-class> · rc:<runtime-class> · Projected progress after Next:<completedAfter>/<total> (<percentageAfter>%) · Expected progress effect:+<percentagePointDelta>pp, unlocks:[...]
- **Completed delta / Recent**: <closed-task|none> · <outcome> · <delta>
- **Remaining frontier / Plan Run queue**: ready=[...] · waiting=[task:dependency] · parked=[task:reason] · queue=[...] · terminal:<state|none>
- **Execution mode / lanes**: <serial|parallel|hybrid|inactive> · lanes=[<lanes|none>] · Conflict controls:<control|none> · Critical path / ETA:<path|none|blocked>/<value|not-scheduled|blocked|UNKNOWN>
- **Evidence**: current=<SRC:PASS|FAIL|BLOCKED|NOT_RUN|UNPROVEN|UNKNOWN, STRUCT:..., UX:..., FUNC:..., ACC:...|none> · recent=<...|none>
- **Cost**: current[<task-id|none>|<measured|not-started|none|unavailable>] total:<duration|none|UNKNOWN> · implement:<duration|none|UNKNOWN> · test:<duration|none|UNKNOWN> · functional:<duration|none|UNKNOWN> · acceptance:<duration|none|UNKNOWN> · wait:<duration|none|UNKNOWN> · recent[<task-id|none>|<measured|not-observed|none|unavailable>] total:<duration|none|UNKNOWN> · implement:<duration|none|UNKNOWN> · test:<duration|none|UNKNOWN> · functional:<duration|none|UNKNOWN> · acceptance:<duration|none|UNKNOWN> · wait:<duration|none|UNKNOWN> · tokens:<actual|not-observed>
- **Binding**: <worktree-name>(<repo-root>) · <branch> · ws:<workspaceId> · init:<full-sha> · expected:<full-sha> · verified:<full-sha>
- **Autonomous horizon / Stop conditions**: <Plan terminal state or named hard boundary> · only:[hard boundaries]
```
````

The block is the final section of tracked status/handoff responses. Render the
worktree as `<worktree-name> (<repo-root>)`; never persist a user-home absolute
path.

The abbreviations are `SRC=SOURCE_CHECK`, `STRUCT=STRUCTURAL_CHECK`,
`UX=UX_REVIEW`, `FUNC=FUNCTIONAL_CHECK`, and `ACC=ACCEPTANCE_PROOF`. Keep
result names unabridged to avoid ambiguity.
Timing is Session-state residence time, not exclusive Agent CPU time. A partial
compacted journal must be labeled `partial`. `current` is the current Task's
single Session observation. `recent` is at most the one Task just closed by the
current `planctl advance` result; it is never a Plan-wide or all-Task
aggregate.

## Resume Behavior

For status-only requests, emit the projection and stop.

For `continue`/`resume`, projection must not pause execution. `pt-dev-workflow`
continues first when the Snapshot returns `CONTINUE` and invokes this Skill at
the next meaningful report boundary.
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
- `make workflow-snapshot WORKFLOW_SNAPSHOT_PROJECTION=anchor` reports the
  cross-owner consistency verdict used by the projection and the
  machine-derived continuation decision.
- Progress, completed delta, Next Progress Slice, projected progress after
  Next, expected progress effect, Plan Run queue, remaining frontier,
  execution mandate, autonomous horizon, stop conditions, lanes, conflict
  controls, and critical path are source-backed.
- Evidence distinguishes `PASS`, `FAIL`, `NOT RUN`, and `UNPROVEN`.
- Timing comes only from the compact Snapshot or the current Run's transient
  closure observation.
- Anchor rendering causes no workflow write and no additional metrics command.
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
- add a metrics file, mutate active-work, or scan historical Sessions to fill
  observability fields;
- estimate token usage or present state residence as exclusive Agent work time;
- persist secrets, transient logs, or absolute user-home paths.
