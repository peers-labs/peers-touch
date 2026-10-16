---
name: "pt-context-anchor"
description: "Reads current Git, one explicitly selected optional task, runtime facts, and evidence; renders a copyable status, resume, handoff, blocker, readiness, or close projection without mutating state."
stage: "cross-stage"
requires: ["explicit canonical worktree", "optional explicit taskId"]
produces: ["read-only Context Anchor"]
---

# Context Anchor

Context Anchor is a read-only projection. It never grants authority, creates a
task, repairs a record, mounts a Plan, or blocks ordinary work.

## Invoke When

- Reporting status, progress, blockers, readiness, handoff, or close.
- Preparing a cross-session resume.
- The user requests a concise copyable state projection.

Do not invoke merely because a Plan, Hook, OWNER, declaration, Session, or
active-work record is absent.

## Inputs

Always read:

- the exact canonical worktree and current branch/HEAD;
- the explicit request and governing product/architecture sources;
- current runtime facts and evidence relevant to the claim.

When the caller provides `taskId`, also read exactly:

```text
<worktree>/.dev-workflow/tasks/<taskId>/task.json
```

Do not guess a task from mtime, branch, chat history, old active-work, or the
number of Plan files. A corrupt selected task is reported locally. Corrupt
unrelated task records do not erase valid Git, runtime, or evidence facts.

When the caller provides a Plan path, read that exact frozen Plan Version and
optional taskId with `planctl inspect` / `planctl task`. PlanMount and
ExecutionRun are not required.

## Read Procedure

1. Verify `$PWD` is the requested canonical Git root.
2. Run the standalone workflow snapshot once.
3. If `taskId` is explicit, read its checksum-protected snapshot without repair.
4. Read current runtime ownership and evidence from their existing owners.
5. Mark missing, stale, corrupt, and unverified facts independently.
6. Render one projection and exit.

Never write snapshot, task, Plan, runtime, evidence, or project-memory state.

## Required Projection

```markdown
**Context Anchor**
- **North star / contribution**:
- **Request / completion obligations**:
- **Worktree / branch / HEAD**:
- **Selected task**: <taskId or none>
- **Task stage / state**:
- **Plan reference**: <explicit path+digest or none>
- **Completed delta**:
- **Next action**:
- **Runtime resources**:
- **Evidence**:
- **Blockers / decisions**:
- **Unverified scope**:
```

Use `none`, `unknown`, or `unverified` rather than inventing a lifecycle.
Omit absolute user-home paths from the chat projection.

## Resume Behavior

For status-only requests, emit the projection and stop. For `continue` or
`resume`, use it as a checkpoint and continue immediately unless a concrete
decision, permission, or real resource conflict blocks the requested action.

## Errors

- `WORKTREE_IDENTITY_UNAVAILABLE`
- `WORKTREE_IDENTITY_MISMATCH`
- `TASK_PROGRESS_NOT_FOUND`
- `TASK_PROGRESS_SNAPSHOT_INVALID`
- `TASK_PROGRESS_CHECKSUM_INVALID`
- `PLAN_PACKAGE_INVALID`

Each error names only the affected fact and its owner.

## Verification

```bash
node --test \
  tooling/scripts/local-dev/workflow-snapshot.test.mjs \
  tooling/scripts/local-dev/dev-work.test.mjs
```

## Anti-Patterns

- Require Hook, OWNER, declaration, PlanMount, Session, or active-work.
- Repair task progress while answering a status request.
- Infer completion from task count, Gate count, or an arbitrary PASS file.
- Treat a missing optional task as an unusable worktree.
- Create or switch worktrees while projecting status.
