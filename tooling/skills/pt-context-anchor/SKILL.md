---
name: "pt-context-anchor"
description: "Reads verified tracked-work sources and renders one copyable chat projection for status, resume, handoff, blockers, readiness, or close. It never repairs or mutates workflow state."
stage: "cross-stage"
requires: ["valid Plan Package", "matching active_work locator", "verified worktree identity"]
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

Do not invoke before a formal plan and matching `active_work` row exist.

## Boundary

This Skill may read:

- the matching `active_work` row;
- compact Plan Package `plan.md`;
- the manifest's current Task Slice;
- matching Development `session.json`;
- referenced durable evidence;
- verified Git/worktree identity;
- scheduler lane state supplied by the current Development Run.

It must not:

- update `active_work`;
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
| Initial/expected HEAD and worktree-set digest | persisted binding |
| Main task, scope, architecture/product decisions | accepted sources |
| Stage and tracked locator | `active_work` |
| Task lifecycle/current Task/dependencies | Plan Package manifest |
| Current transition and first failure | Development Session |
| Completed delta and evidence | Task snapshot plus referenced evidence |
| Ready queue, lanes, conflict controls, critical path | scheduler output backed by the current graph |
| Overall progress | `done` manifest Tasks / total Tasks |
| ETA | remaining critical path plus observed throughput |

No global precedence rule exists. Each field comes from its owner.

## Active Work Locator

Tracked work uses:

```markdown
## active_work

| id | plan | stage | current_task_id | current_task_path | dev_state | branch | workspace_id | initial_head | expected_head | worktree_set_digest | blocked | last_session |
|----|------|-------|-----------------|-------------------|-----------|--------|--------------|--------------|---------------|---------------------|---------|--------------|
```

Validation rules:

- `plan` resolves to package `plan.md`.
- `current_task_id/current_task_path` mirror the manifest or are both `NONE`.
- `dev_state` mirrors `session.json` or is `NONE`.
- branch, workspace, expected HEAD, and digest match verified Git state.
- initial HEAD is immutable.
- one workspace has at most one non-complete row.
- `blocked=true` requires an empty Ready Queue and source-backed exhaustion.

The Anchor reports a mismatch; it never rewrites the row.

## Read Procedure

1. Select exactly one matching non-complete `active_work` row.
2. Verify the persisted worktree binding. Do not recapture a new baseline.
3. Run `planctl validate` and `planctl current`.
4. Read compact `plan.md`, only `current_task_path`, and matching
   `session.json`.
5. Validate each projected field against its owner.
6. Use `unknown` for ETA when critical-path or throughput evidence is
   insufficient.
7. Render one final chat block.

Do not scan archive files, every Task body, raw command logs, or conversation
history.

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
- **Execution mode / lanes**:
- **Conflict controls**:
- **Critical path / ETA**:
- **Progress**:
- **Action and reason**:
- **Evidence**:
- **Next action**:
- **Blockers / decisions**:
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
- `planctl current`, current Task, Session, and `active_work` agree.
- Completed delta, Ready queue, Execution mode / lanes, Conflict controls, and
  Critical path / ETA are source-backed.
- Evidence distinguishes `PASS`, `FAIL`, `NOT RUN`, and `UNPROVEN`.
- No file, registry, plan, Session, or runtime state was mutated.
- The response ends with one fenced chat projection.

## Anti-Patterns

Never:

- repair stale owner state;
- create or update `active_work`;
- reconstruct state from chat;
- recapture Git identity during resume;
- invent progress or ETA;
- report stale agent metadata as a live lane;
- treat one parked action as a Goal-wide blocker;
- use the Anchor as completion authority;
- persist secrets, transient logs, or absolute user-home paths.
