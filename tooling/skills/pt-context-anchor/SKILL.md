---
name: "pt-context-anchor"
description: "Synchronizes verified tracked-work state, progress delta, execution topology, conflict controls, critical path, and evidence-backed ETA into a copyable chat anchor. Invoke for resume, status, handoff, blockers, stage changes, or session close."
stage: "cross-stage"
requires: ["valid Plan Package and matching active_work locator for tracked work"]
produces: ["synchronized active_work state", "verified chat Context Anchor"]
---

# Context Anchor

## Invoke When

- Resuming, switching, reporting, handing off, or closing tracked work.
- A tracked worktree, branch, stage, step, evidence state, blocker, or decision changes.
- The user requests a Context Anchor or continuation prompt for tracked work.
- Before context compaction or session close while tracked work remains active.

Do not invoke for standalone work or PRODUCT/DESIGN discussion that has no
formal execution plan and no `active_work` entry.

## Core Rule

A Context Anchor is a normalized projection contract for tracked work, not a
separate durable state document.

It is materialized in two places only:

1. `active_work` in `project_memory.md` stores the durable package/Task/Session
   locator and binding projection.
2. Chat carries the complete copyable human-readable projection.

Execution plans and tracking artifacts remain the durable sources for scope,
status details, and evidence. They MUST NOT contain a `## Context Anchor`
section. Chat, todos, and dashboards are projections and never become truth
sources.

Anchor generation must not pause or replace execution. When the user asks to
resume work, verify and synchronize the Anchor internally, continue the
dependency-ready work, and emit the Anchor only in the final status, blocker,
handoff, readiness, or close response.

If no readable formal plan or matching `active_work` entry exists, do not
invent an Anchor. Continue through PRODUCT/DESIGN/PLAN using the owning skills;
`pt-plan-and-document` registers tracked work only after creating the plan.

## Field Ownership

Resolve each field from its owner instead of applying one global precedence:

| Field | Owner |
|---|---|
| Worktree, branch, and `workspaceId` | Worktree binding verifier and actual Git state |
| Initial HEAD, expected HEAD, and worktree-set digest | Persisted `active_work` binding, verified against actual Git state |
| Product and architecture decisions | Accepted source documents |
| Plan path, stage, blocked flag, last session | `active_work` |
| Task lifecycle, current Task, ready/parked frontier | Plan Package manifest |
| Current Development transition and first failure | Development Session journal |
| Main task and scope | Formal execution plan |
| Progress, last completed, blocker detail, decisions | Manifest Task index plus current Task snapshot |
| Overall progress ratio | Count of `done`/total manifest Tasks; must not be guessed |
| Completed delta | Plan/tracking changes since the previous emitted Anchor |
| Ready queue and critical path | Formal plan dependency graph and current evidence |
| Execution mode and lanes | The execution guardian's Concurrency Decision plus live, backend-addressable agent state |
| Conflict controls | Reserved write sets, shared-file owner, dependency barriers, and reconcile owner from the plan/tracking source |
| ETA | Remaining critical-path units and observed throughput; use `unknown` when evidence is insufficient |
| Evidence | Named commands and repository evidence |
| Chat Anchor | Projection of the sources above |

Any disagreement blocks progress reporting until reconciled. Never choose the
most convenient value or reconstruct state from conversation memory.

## Required Active Work Schema

```markdown
## active_work

| id | plan | stage | current_task_id | current_task_path | dev_state | branch | workspace_id | initial_head | expected_head | worktree_set_digest | blocked | last_session |
|----|------|-------|-----------------|-------------------|-----------|--------|--------------|--------------|---------------|---------------------|---------|--------------|
| 1 | docs/.../execution-plans/example/plan.md | EXECUTE | TASK-02 | docs/.../execution-plans/example/tasks/TASK-02.md | CHECKING | feat/example | 0123456789abcdef | `<full-head>` | `<full-head>` | `<sha256>` | false | YYYY-MM-DD |
```

Rules:

- `plan` is repository-relative and must resolve to package `plan.md`.
- A row is created only after the package and initial Task Slices pass
  `planctl validate`.
- A `workspace_id` may have at most one row whose stage is not `complete`;
  zero or multiple matches block tracked execution.
- `branch`, `workspace_id`, `expected_head`, and `worktree_set_digest` must
  match verified Git state.
- `initial_head` is immutable. On initial registration, `expected_head` equals
  `initial_head`.
- Resume and context compaction verify persisted identity. They never replace
  the persisted baseline by capturing current Git state again.
- A legacy row missing any binding field cannot resume. It may be migrated
  exactly once only after the user explicitly authorizes that row's migration
  and identifies its worktree. Require the recorded plan to exist and the
  recorded branch to match, capture the current identity once, then atomically
  append an immutable `active_work_binding_migrations` audit row and populate
  `workspace_id`, `initial_head`, `expected_head`, and
  `worktree_set_digest`; both HEAD fields equal the captured HEAD. Missing
  authorization, mismatch, ambiguity, or partial persistence returns
  `WORKTREE_IDENTITY_UNAVAILABLE`. This is an explicit baseline migration, not
  resume recapture.
- `current_task_id/current_task_path` mirror the manifest's sole
  `in_progress` Task, or both are `NONE` when the package is `prepared`,
  `blocked`, or `completed`.
- `dev_state` mirrors the replayed `session.json` state or is `NONE` before a
  Session exists/no Task is current.
- `stage` and `blocked` must agree with package status and fixed-point
  exhaustion.
- `blocked=false` while any source-defined Ready Queue action, active
  diagnostic, admissible root-cause fix, or mechanical plan amendment remains.
- `blocked=true` requires the execution skill's fixed-point exhaustion proof:
  the Ready Queue is empty, every remaining item is parked behind a hard
  governance or unavailable external-resource boundary, and the repeated
  blocker lifecycle threshold is satisfied.
- One parked action never makes the whole tracked work blocked.
- Completed work remains addressable with `stage: complete` until explicitly archived.
- `current_step` is forbidden after package cutover; it cannot coexist with
  Task/Session pointers as a parallel truth.

## Required Chat Projection

Every user-facing Context Anchor is one fenced `markdown` block exactly like:

````markdown
```markdown
**Context Anchor**
- **Main task**:
- **Current task**:
- **Worktree / branch / workspace**:
- **Initial HEAD**:
- **Expected / verified HEAD**:
- **Worktree-set digest**:
- **Stage / step**:
- **Overall progress**: <done>/<total> workstreams (<percentage>%)
- **Completed since previous anchor**:
- **Ready queue**:
- **Execution mode / lanes**: <parallel, serial, or hybrid; active and queued lanes>
- **Conflict controls**: <write-set owners, shared-file owner, barriers, reconcile owner>
- **Critical path / ETA**: <remaining critical path and evidence-backed range, or `unknown`>
- **Progress**:
- **Action and reason**:
- **Evidence**:
- **Next action**:
- **Blockers / decisions**:
- **Tracking document**:
```
````

The block is mandatory for tracked-work status, resume, handoff, progress,
blocker, readiness, and session-close responses. It must be the final section
of the response.

Render the worktree as `<worktree-name> (<repo-root>)`, for example
`peers-social (<repo-root>)`, and include the verified branch, `workspaceId`,
both full HEAD values, and worktree-set digest. A bare `<repo-root>` is
ambiguous and invalid. Do not split, quote, render as a table, wrap in a widget,
persist a user-home absolute path, or omit identity, evidence, next action, or
tracking document.

## Self-Hosting Bootstrap

Until DWF-B5 atomically migrates
`docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation.md`,
that exact legacy active Mobile Shell plan remains the sole authority for
DWF-B. Project memory currently has no `active_work` row; migration must verify
and journal `NONE -> NONE` without creating a transient pointer. Do not
activate the prepared package early or treat this exception as generic legacy
resume support.

## Workflow

### 1. Resolve Tracked Work

1. Read `active_work`.
2. Select the matching non-complete row.
3. Run `planctl validate` and `planctl current` against its package.
4. Read only compact `plan.md`, the current Task Slice, and matching
   `session.json`; read no archive or unrelated Task body.
5. Stop if the row is missing, ambiguous, points to an invalid package, or
   disagrees with manifest/Session owners.

### 2. Verify Physical Context

For a new tracked-work row, capture once from the explicitly selected worktree
root, persist all binding fields, and immediately verify them:

```bash
python3 tooling/scripts/verify-worktree-binding.py \
  --root '<absolute-root>' \
  --capture

python3 tooling/scripts/verify-worktree-binding.py \
  --root '<absolute-root>' \
  --branch '<branch>' \
  --workspace-id '<workspaceId>' \
  --head '<expected-head>' \
  --worktree-set-digest '<digest>'
```

Both commands run with the selected root as their actual working directory.
Each materialized value is one POSIX shell-safe argument.
For resume, handoff, or context compaction, skip capture and verify the persisted
branch, `workspace_id`, `expected_head`, and `worktree_set_digest` directly.
The verified root, branch, and `workspaceId` must match the selected work.
Preserve unrelated dirty files. Persist repository paths as `<repo-root>` or
repo-relative paths, never a developer or CI home-directory path.
Unavailable identity stops with `WORKTREE_IDENTITY_UNAVAILABLE`; any root,
branch, workspace, expected HEAD, or worktree-set mismatch stops with
`WORKTREE_IDENTITY_MISMATCH`.

### 3. Derive And Reconcile

1. Read objective, scope, Task index and DAG from compact `plan.md`.
2. Read current closure/snapshot from only `current_task_path`.
3. Replay the matching Development Session and compare `dev_state`.
4. Read the current Concurrency Decision from the Task snapshot.
5. Reconcile the live agent registry by identity and backend reachability.
   Listed but backend-unaddressable entries are stale metadata and cannot be
   reported as active lanes.
6. Compare those facts with `active_work`.
7. Repair stale pointer fields from manifest/Session owners and recompute the
   Ready/Parked frontier from manifest dependencies/statuses
   before reporting or executing.
8. Keep `blocked=false` when any legal action remains; mark absent proof
   `UNPROVEN` without converting one blocked action into a Goal-level block.
9. Derive ETA only from remaining critical-path units and observed throughput;
   otherwise write `unknown`.

### 4. Synchronize Meaningful Changes

After a step, stage, branch, blocker, decision, or evidence change:

1. Update the manifest Task index and current Task snapshot first.
2. Replay/update the Development Session when transition state changed.
3. Update `active_work` to mirror those owners.
4. Update current-session todos if used.
5. Emit the chat projection when reporting to the user.

Anchor synchronization never completes a task by itself.

### 5. Handoff And Resume

At handoff, record the last completed evidence, exact current action, one
dependency-ready next action, blockers, and decisions. At resume, verify Git
state and reconcile sources before continuing from that next action.

## Integration

- `pt-plan-and-document` creates/validates the Plan Package, then registers
  `active_work`.
- `pt-god-view` resolves tracked work through `active_work`.
- `pt-execution-plan-guardian` updates plan/tracking evidence before Anchor state.
- `pt-completion-auditor` verifies Anchor claims against repository evidence.
- `pt-dev-workflow` synchronizes stage transitions and handoffs.

## Verification

- Frontmatter name matches `pt-context-anchor`.
- A matching `active_work` row and valid Plan Package exist before Anchor output.
- `planctl current` agrees with `current_task_id/current_task_path`, and replayed
  `session.json` agrees with `dev_state`.
- The execution plan contains no `## Context Anchor` section.
- Actual Git root, branch, `workspaceId`, expected HEAD, and worktree-set digest
  were verified against the persisted binding; initial HEAD remained unchanged.
- Progress and evidence match the manifest/current Task/Session owners.
- Evidence distinguishes `PASS`, `FAIL`, `NOT RUN`, and `UNPROVEN`.
- The chat Anchor is one final fenced `markdown` block.
- `git diff --check -- tooling/skills AGENTS.md` passes.

## Anti-Patterns

Never:

- create an Anchor before a formal plan and `active_work` row exist;
- scan `archive/` or every Task body to construct current status;
- recover current state from legacy prose, chat, or Acceptance artifacts;
- write a Context Anchor section into an execution plan;
- reconstruct tracked state from chat history;
- recapture current Git state as a new baseline during resume or compaction;
- continue after a worktree or branch mismatch;
- use chat, todos, or dashboards as durable truth;
- present an unchanged Anchor as execution progress;
- report stale or backend-unaddressable agent entries as active execution lanes;
- invent an ETA without a source-backed critical path and observed throughput;
- use an Anchor to overwrite or conceal a stale active Goal objective; route it
  to `pt-trae-goal-orchestrator` as `GOAL_REPLACEMENT_REQUIRED`;
- copy an Anchor across worktrees without verification;
- set `blocked=true` without an empty Ready Queue and exhaustion proof;
- report one parked action as if the entire Goal cannot progress;
- claim completion from summaries or missing evidence;
- persist absolute user-home paths, transient command logs, or secrets;
- use an Anchor to bypass product, architecture, plan, or review gates.
