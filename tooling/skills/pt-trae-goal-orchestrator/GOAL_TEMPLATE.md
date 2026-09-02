# TRAE Goal Slice Output Template

Render the populated template inside one four-backtick `markdown` fence. Do not
include this title or explanatory text in the generated Goal.

/goal

## Objective

<One meaningful outcome for this Goal Slice.>

## Goal Slice

- Stage: <PRODUCT | DESIGN | PLAN | EXECUTE | DELIVER>
- Source unit: <stage checkpoint or formal plan workstream/task IDs>
- Completion boundary: <what this Goal may complete>
- Cut point: <where this Goal must stop>

## Worktree Binding

- Canonical runtime worktree root: `<materialized-canonical-absolute-path>`
- Branch: `<materialized-branch>`
- `workspaceId`: `<materialized-workspaceId>`
- Initial HEAD: `<materialized-full-commit>`
- Expected HEAD: `<initially identical to Initial HEAD; refresh only after an explicitly authorized commit, rebase, or merge>`
- Worktree-set digest: `<materialized-digest>`
- Capture command: `python3 tooling/scripts/verify-worktree-binding.py --root '<materialized-canonical-absolute-path>' --capture`
- Verification command: `python3 tooling/scripts/verify-worktree-binding.py --root '<materialized-canonical-absolute-path>' --branch '<materialized-branch>' --workspace-id '<materialized-workspaceId>' --head '<materialized-expected-head>' --worktree-set-digest '<materialized-digest>'`
- Shell quoting: every materialized value is one POSIX shell-safe argument;
  use equivalent `shlex.quote` escaping when a value contains a single quote.
- Identity source: the current verified worktree; skill resolution and skill
  source locations are not execution-target authority.
- Mismatch policy: verifier absence or an unresolved field stops with
  `WORKTREE_IDENTITY_UNAVAILABLE`; capture/verification from any directory
  other than the bound root or any identity drift stops with
  `WORKTREE_IDENTITY_MISMATCH`. Never automatically run `cd`, switch branches,
  or select another worktree to repair either state.
- Mutation policy: every mutating tool call sets the canonical runtime worktree
  root above as its explicit `workdir`.
- Reverification: every agent verifies first, all agents reverify after resume
  or context compaction against persisted values without recapturing a new
  baseline, and the integrator reverifies before reconcile and before Slice
  completion.
- Refresh policy: retain Initial HEAD; refresh Expected HEAD only after an
  explicitly authorized commit, rebase, or merge; refresh the worktree-set
  digest only after the exact explicitly requested worktree operation.
- Forbidden worktree operations: no `git switch`, `git checkout`,
  `git worktree add`, `git worktree remove`, `git worktree prune`, or new
  worktree unless the user explicitly requests that exact operation.

## Governing Sources

- `<repo-relative-path>`: <authority>

## In Scope

- <selected dependency-ready work>

## Out Of Scope And Remainder

- <work retained by the broader stage or plan>
- <blocked or later work>

## Hard Constraints

- <project and stage invariants projected from authoritative sources>

## Source Work Graph

<Projection of the owning stage workflow or formal plan DAG. Do not redesign
dependencies here.>

## TRAE Subagent Topology

### Agent A — <role>

- First action: run the Worktree Binding verification command from the bound
  root and stop with `WORKTREE_IDENTITY_MISMATCH` on any mismatch.
- Mutating tool workdir: the bound canonical runtime worktree root.
- Source unit:
- Prerequisites:
- Exclusive write set:
- Read-only sources:
- Forbidden scope:
- Required verification:
- Return contract:
- Hard stops:

<Repeat only for genuinely independent agents.>

## Reconcile

- Integrator:
- Binding recheck: run the Worktree Binding verification command before
  reconcile and again before Slice completion.
- Inputs:
- Interface checks:
- Conflict policy:
- Required focused verification:

## Stage-Owned Gate Projection

- Owning skill:
- Required gate or review:
- Commands or review artifact:
- Evidence:
- Cleanup, when applicable:
- Non-claims:

## Failure And Escalation

- <Project-defined failure state>: <owner and stop behavior>

## Slice Completion

- Complete when:
- Remains unproven:
- Plan/stage completion effect:

## Tracking And Handoff

- Durable source update:
- `active_work` update, when tracked:
- Context Anchor, when tracked:
- Next action: rerun Goal Slice selection from the updated source graph.
