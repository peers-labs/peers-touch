---
name: pt-dev-workflow
description: "Drives Peers-Touch work from planning through implementation and PR delivery. Invoke for complete development tasks requiring stage tracking."
stage: orchestrator
requires: []
produces: ["completed task with merged PR"]
---

# Dev Workflow — Stage Orchestrator

This skill is the **single entry point** for any non-trivial development task.
It detects the current stage, dispatches to the correct skill, tracks progress,
and manages cross-session continuity.

## Stage Pipeline

```
PRODUCT → DESIGN → PLAN → EXECUTE → DELIVER
```

Each stage has a dedicated skill, a gate, and an artifact. See AGENTS.md §13.5
for the authoritative dispatch table. This skill's job is to **detect + dispatch
+ track**, not to perform the work of individual stages.

---

## 1. Entry Point

This skill is invoked by `pt-god-view` after it determines the stage and either
classifies new pre-plan work or selects tracked work. For tracked work, it receives:

- The execution plan path
- The current stage
- The current step

It then dispatches to the stage-specific skill (§3) and manages progress tracking (§5).

If invoked directly by the user (without god-view), it assumes the user knows
what they want to do and proceeds with task classification (§2).

---

## 2. Task Classification

| Signal | Starting stage | Rationale |
|--------|---------------|-----------|
| User requests a new product/module/capability, workflow redesign, or benchmark rebuild | PRODUCT | Needs product outcome, experience, and acceptance contract |
| User requests Acceptance Infra optimization or audit | CROSS-STAGE via `pt-acceptance-infra-engineering` | Framework responsibility must remain separate from business injection |
| User requests business Domain Acceptance injection or proof | CROSS-STAGE via `pt-acceptance-engineering` | Product contracts and runtime evidence own the closure |
| Product contract accepted; user mentions new architecture / boundary / ownership / protocol | DESIGN | Needs architecture methodology |
| Product and architecture accepted; user says "plan" / "execute" / "implement" | PLAN | Needs execution breakdown |
| Plan exists and is accepted, user says "start coding" / "do it" | EXECUTE | Plan already passed review |
| Code is done, user says "PR" / "submit" / "deliver" | DELIVER | Needs commit + PR |
| Single-file bug fix / cosmetic tweak / "just fix X" | EXECUTE (via `pt-small-fix-discipline`) | Skip PRODUCT+DESIGN+PLAN |

If ambiguous, ask whether this is a new product/capability, a new architecture
decision, or implementation of something already accepted and planned.

---

## 3. Stage Dispatch

Invoke by the classified stage. For tracked work, `active_work.stage` must agree
with that classification:

### Stage: PRODUCT

```
Invoke: pt-product-design-methodology
Also:   pt-prototype-design (when UI/interaction is material)
Gate:   Product review passes; required prototype is confirmed or explicitly blocked
Output: Product definition, benchmark disposition, experience/state contracts,
        acceptance matrix, and optional executable prototype
Next:   → DESIGN
```

### Stage: DESIGN

```
Invoke: pt-architecture-design-methodology
Gate:   Architecture review prompt generated + review passes
Output: docs/architecture/<module>/ (design.md, decisions.md, etc.)
Next:   → PLAN
```

### Stage: PLAN

```
Invoke: pt-architecture-execution-methodology (dependency analysis)
Then:   pt-plan-and-document (落盘 + review prompt generation)
Gate:   Plan review prompt generated + review passes
Output: execution-plans/<plan>.md + active_work registration
Next:   → EXECUTE
```

### Stage: EXECUTE

```
Invoke: pt-execution-plan-guardian (keeps work on plan rails)
Also:   pt-read-before-edit (before any file edit)
        pt-desktop-runtime-projections (if touching Desktop kernel)
Gate:   All completion criteria in plan checked + pt-completion-auditor passes
Output: Code + tests + evidence
Next:   → DELIVER
```

### Stage: DELIVER

```
Invoke: pt-github-commit (standardized commits)
Then:   pt-github-pr (create PR with template)
Then:   pt-github-review (self-review or request review)
Gate:   PR merged
Output: Merged PR
Next:   → complete
```

---

## 4. Gate Protocol

Every stage gate follows the same pattern:

1. Generate a structured review prompt (per skill's template)
2. Present prompt to user
3. User decides: send to reviewer, iterate, or accept
4. If review returns "needs modification" → iterate within current stage
5. If review passes → move to the next stage; update `active_work.stage` only
   when a registered plan row exists

**Agent MUST NOT auto-advance past a gate.** Gate passage requires either:
- User explicitly says "pass" / "approved" / "move on"
- A review result says "通过" / "有条件通过" (conditions resolved)

---

## 5. Progress Tracking

### active_work registry (project_memory.md)

Maintained as a table — one row per in-flight task:

```markdown
## active_work

| id | plan | stage | current_step | branch | workspace_id | initial_head | expected_head | worktree_set_digest | blocked | last_session |
|----|------|-------|--------------|--------|--------------|--------------|---------------|---------------------|---------|--------------|
| 1 | docs/.../20260723-phase1-station-api.md | EXECUTE | Step 1 | main | 0123456789abcdef | `<full-head>` | `<full-head>` | `<sha256>` | false | 2026-07-23 |
```

**Update rules:**
- PRODUCT/DESIGN work without a formal execution plan has no row and no Context Anchor
- Plan creation → capture and verify the selected worktree once, then register
  the repo-relative plan path with `stage: PLAN`, branch, `workspace_id`,
  immutable `initial_head`, initially equal `expected_head`, and
  `worktree_set_digest`
- Stage transition → update `stage` + `current_step`
- Session end → update `last_session`
- All phases complete → set `stage: complete`
- Branch merged with remaining phases → update `branch` to merge target
- User says "close this" → set `stage: complete`
- Stale (>14 days idle) → ask user on next session
- Resume/context compaction → verify persisted identity; never recapture it as a
  replacement baseline
- Explicitly authorized commit/rebase/merge → refresh only `expected_head`
- Explicitly requested worktree operation → refresh only
  `worktree_set_digest`

Capture and verification use
`tooling/scripts/verify-worktree-binding.py`. Its `workspaceId` output maps to
`workspace_id`, and its worktree-set digest maps to
`worktree_set_digest`. Missing identity stops with
`WORKTREE_IDENTITY_UNAVAILABLE`; drift stops with
`WORKTREE_IDENTITY_MISMATCH`.

### Execution plan status table

Each execution plan has an "Implementation Status" table at the bottom.
Update individual step status as work progresses:

```markdown
| Step | Status | Completed | Notes |
|------|--------|-----------|-------|
| Step 1 | ✅ done | 2026-07-23 | commit abc123 |
| Step 2 | 🔄 in progress | — | |
| Step 3 | ⬜ pending | — | |
```

---

## 6. Cross-Session Resume

When resuming a previous session:

1. Read `active_work` from project memory
2. Read the referenced execution plan
3. Invoke `pt-context-anchor` and verify actual worktree identity against the
   persisted branch, `workspace_id`, `expected_head`, and
   `worktree_set_digest`
4. Reconcile the plan status table with `active_work`
5. Emit the required fenced chat projection
6. Dispatch to the correct stage skill

**Key principle**: The execution plan's status table is ground truth for "what's done".
Project memory's `active_work` is just an index pointing to it.

---

## 7. Skill Dependencies (Dispatch Map)

| Stage | Primary skill | Supporting skills |
|-------|--------------|-------------------|
| PRODUCT | `pt-product-design-methodology` | `pt-prototype-design`, `pt-plan-and-document` (document routing only) |
| DESIGN | `pt-architecture-design-methodology` | `pt-plan-and-document` (for doc落盘) |
| PLAN | `pt-architecture-execution-methodology` + `pt-plan-and-document` | `pt-context-anchor` after plan registration |
| EXECUTE | `pt-execution-plan-guardian` | `pt-context-anchor`, `pt-read-before-edit`, `pt-desktop-runtime-projections`, `pt-small-fix-discipline`, `pt-completion-auditor` |
| DELIVER | `pt-github-commit` + `pt-github-pr` + `pt-github-review` | `pt-quality-check` |

---

## 8. Anti-Patterns

- **Skip a gate** — never advance to next stage without explicit gate passage
- **Premature active_work** — never create a placeholder row before a formal plan exists
- **Untracked planned execution** — after plan creation, never execute without a matching `active_work` row
- **Forget to update status** — every step completion / stage transition must be recorded
- **Resume without reading plan** — always re-read execution plan status table before continuing
- **Invoke stage skill without context** — always tell the skill what plan you're executing and what step you're on
- **Self-approve a review** — agent generates prompts, user decides whether to send; agent never marks its own review as "passed"
