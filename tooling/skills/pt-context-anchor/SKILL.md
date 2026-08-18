---
name: "pt-context-anchor"
description: "Maintains a plan-owned Context Anchor and verified worktree projection. Invoke for plan creation, resume, status, handoff, blockers, stage changes, or session close."
stage: "cross-stage"
requires: ["formal execution plan for tracked work"]
produces: ["plan-owned Context Anchor", "verified worktree context", "synchronized status projection"]
---

# Context Anchor

## Invoke When

- Creating or updating a formal execution plan.
- Starting, resuming, switching, reporting, or closing tracked work.
- Worktree, branch, stage, workstream, evidence, blocker, or next action changes.
- The user supplies or requests a Context Anchor or handoff.
- Before context compaction or session close while tracked work remains active.

## Core Rule

Every tracked execution plan owns exactly one durable `## Context Anchor`.
`active_work`, todo lists, dashboards, and chat responses are projections of
that section, not competing truth sources.

Resolve disagreement in this order:

1. Actual repository state: `pwd`, Git root, branch, status.
2. Accepted architecture and product decisions.
3. Formal execution plan and its Context Anchor.
4. Tracking source and evidence ledger.
5. `active_work`, todos, dashboards, and chat summaries.

A worktree or branch mismatch blocks edits until reconciled.

## Required Plan Schema

```markdown
## Context Anchor

| Field | Current value |
|---|---|
| Main task | <durable objective> |
| Plan source | `<repo-relative execution plan path>` |
| Tracking source | `<repo-relative path or this plan>` |
| Worktree | `<repo-root>` |
| Branch | `<verified branch>` |
| Stage | `PRODUCT / DESIGN / PLAN / EXECUTE / DELIVER / complete` |
| Current workstream | `<formal task ID>` |
| Current step | `<one dependency-ready step>` |
| Progress | `<evidence-backed completed/total>` |
| Last completed | `<closed step and evidence>` |
| Current action | `<current action and reason>` |
| Next action | `<one dependency-ready action>` |
| Blockers | `<none or concrete blocker>` |
| Decisions required | `<none or explicit decision>` |
| Evidence | `<PASS/FAIL/UNPROVEN commands and repo-relative evidence>` |
| Last updated | `<YYYY-MM-DD HH:MM timezone or date>` |
```

Persist `<repo-root>`, never a developer or CI user's home-directory path.
Verify the real absolute root at runtime without copying it into committed text.

## Required Chat Projection

Every status, resume, progress, blocker, readiness, or handoff response ends
with one copyable fenced block:

````markdown
```markdown
**Context Anchor**
- **Main task**:
- **Current task**:
- **Worktree / branch**:
- **Stage / step**:
- **Progress**:
- **Action and reason**:
- **Evidence**:
- **Next action**:
- **Blockers / decisions**:
- **Tracking document**:
```
````

Use repo-relative paths. Do not split, quote, or replace this block with
rendered bullets or a table. Explanatory prose belongs before it.

## Workflow

### 1. Resolve The Active Plan

1. Read `active_work`.
2. Open its execution plan and Context Anchor.
3. Read the tracking source and current workstream.
4. If no Anchor exists, add one before tracked execution.

### 2. Verify Physical Context

Run from the intended worktree:

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git status --short
```

The Git root and branch must match the Anchor. Preserve unrelated dirty files.

### 3. Synchronize Meaningful Changes

Update the plan status table and Anchor together after:

- workstream or step start/completion;
- verification PASS, FAIL, NOT RUN, or UNPROVEN;
- worktree, branch, scope, stage, blocker, or decision change;
- handoff, resume, or session close.

Then update `active_work` and other projections. Never update a projection
first and backfill the plan later.

### 4. Apply Evidence Discipline

- Progress comes from the plan status table or tracking source.
- Name commands or evidence for `PASS`.
- Static/type evidence is not runtime or Native proof.
- Missing evidence remains `UNPROVEN`.
- Anchor changes never make a workstream complete by themselves.

## Integration

- `pt-plan-and-document` creates the Anchor.
- `pt-god-view` resolves it after `active_work`.
- `pt-dev-workflow` verifies it before stage dispatch.
- `pt-execution-plan-guardian` synchronizes it during execution.
- `pt-completion-auditor` checks projections against it.

## Verification

- The plan contains exactly one `## Context Anchor`.
- Runtime Git root and branch were verified.
- Persisted Worktree is `<repo-root>`.
- Stage, step, progress, blockers, and evidence agree with plan details.
- The chat projection is one final fenced `markdown` block.
- `git diff --check -- tooling/skills AGENTS.md docs` passes.

## Anti-Patterns

Never:

- reconstruct status from conversation memory;
- continue after worktree or branch mismatch;
- treat chat, `active_work`, or a todo list as the durable source;
- persist user-home absolute paths;
- copy an Anchor from another worktree without verification;
- infer completion from summaries or missing evidence;
- omit worktree, branch, evidence, tracking document, or next action;
- use the Anchor to bypass product, architecture, plan, or review gates.
