---
name: "pt-context-anchor"
description: "Synchronizes verified tracked-work state and emits a copyable chat anchor. Invoke for resume, status, handoff, blockers, stage changes, or session close."
stage: "cross-stage"
requires: ["formal execution plan and active_work entry for tracked work"]
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

1. `active_work` in `project_memory.md` stores the durable locator and
   current-state index.
2. Chat carries the complete copyable human-readable projection.

Execution plans and tracking artifacts remain the durable sources for scope,
status details, and evidence. They MUST NOT contain a `## Context Anchor`
section. Chat, todos, and dashboards are projections and never become truth
sources.

If no readable formal plan or matching `active_work` entry exists, do not
invent an Anchor. Continue through PRODUCT/DESIGN/PLAN using the owning skills;
`pt-plan-and-document` registers tracked work only after creating the plan.

## Field Ownership

Resolve each field from its owner instead of applying one global precedence:

| Field | Owner |
|---|---|
| Worktree and branch | Actual Git state |
| Product and architecture decisions | Accepted source documents |
| Plan path, stage, current step, blocked flag, last session | `active_work` |
| Main task and scope | Formal execution plan |
| Progress, last completed, blocker detail, decisions | Plan status table or linked tracking source |
| Overall progress ratio | Count of done/total workstreams from the plan status table; must not be guessed |
| Evidence | Named commands and repository evidence |
| Chat Anchor | Projection of the sources above |

Any disagreement blocks progress reporting until reconciled. Never choose the
most convenient value or reconstruct state from conversation memory.

## Required Active Work Schema

```markdown
## active_work

| id | plan | stage | current_step | branch | blocked | last_session |
|----|------|-------|--------------|--------|---------|--------------|
| 1 | docs/.../execution-plans/example.md | EXECUTE | Step 2 | feat/example | false | YYYY-MM-DD |
```

Rules:

- `plan` is repository-relative and must resolve to a formal execution plan.
- A row is created only after the plan file exists.
- `branch` must match verified Git state.
- `stage`, `current_step`, and `blocked` must agree with the plan/tracking state.
- Completed work remains addressable with `stage: complete` until explicitly archived.

## Required Chat Projection

Every user-facing Context Anchor is one fenced `markdown` block exactly like:

````markdown
```markdown
**Context Anchor**
- **Main task**:
- **Current task**:
- **Worktree / branch**:
- **Stage / step**:
- **Overall progress**: <done>/<total> workstreams (<percentage>%)
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

Use repository-relative paths inside the block. Do not split, quote, render as
a table, wrap in a widget, or omit worktree, branch, evidence, next action, or
tracking document.

## Workflow

### 1. Resolve Tracked Work

1. Read `active_work`.
2. Select the matching non-complete row.
3. Open its formal plan and linked tracking source.
4. Stop if the row is missing, ambiguous, or points to a missing plan.

### 2. Verify Physical Context

Run from the intended worktree:

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git status --short
```

The actual root and branch must match the selected work. Preserve unrelated
dirty files. Persist repository paths as `<repo-root>` or repo-relative paths,
never a developer or CI home-directory path.

### 3. Derive And Reconcile

1. Read objective and scope from the plan.
2. Read progress and evidence from its status table or tracking source.
3. Compare those facts with `active_work`.
4. Reconcile stale fields before reporting or executing.
5. Mark absent proof `UNPROVEN`; do not infer success.

### 4. Synchronize Meaningful Changes

After a step, stage, branch, blocker, decision, or evidence change:

1. Update the plan status table or tracking evidence first.
2. Update `active_work` to match.
3. Update current-session todos if used.
4. Emit the chat projection when reporting to the user.

Anchor synchronization never completes a task by itself.

### 5. Handoff And Resume

At handoff, record the last completed evidence, exact current action, one
dependency-ready next action, blockers, and decisions. At resume, verify Git
state and reconcile sources before continuing from that next action.

## Integration

- `pt-plan-and-document` creates the formal plan, then registers `active_work`.
- `pt-god-view` resolves tracked work through `active_work`.
- `pt-execution-plan-guardian` updates plan/tracking evidence before Anchor state.
- `pt-completion-auditor` verifies Anchor claims against repository evidence.
- `pt-dev-workflow` synchronizes stage transitions and handoffs.

## Verification

- Frontmatter name matches `pt-context-anchor`.
- A matching `active_work` row and readable plan exist before Anchor output.
- The execution plan contains no `## Context Anchor` section.
- Actual Git root and branch were verified.
- Progress and evidence match plan/tracking sources.
- Evidence distinguishes `PASS`, `FAIL`, `NOT RUN`, and `UNPROVEN`.
- The chat Anchor is one final fenced `markdown` block.
- `git diff --check -- tooling/skills AGENTS.md` passes.

## Anti-Patterns

Never:

- create an Anchor before a formal plan and `active_work` row exist;
- write a Context Anchor section into an execution plan;
- reconstruct tracked state from chat history;
- continue after a worktree or branch mismatch;
- use chat, todos, or dashboards as durable truth;
- copy an Anchor across worktrees without verification;
- claim completion from summaries or missing evidence;
- persist absolute user-home paths, transient command logs, or secrets;
- use an Anchor to bypass product, architecture, plan, or review gates.
