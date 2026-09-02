# TRAE Goal Slice Review Rubric

Score each dimension from 0 to 2.

| Dimension | Pass condition |
|---|---|
| Source grounding | Every instruction projects an authoritative source or explicit owner decision |
| Stage purity | The Slice belongs to one methodology stage and stops before its review boundary |
| Slice closure | The Slice is dependency-, ownership-, evidence-, recovery-, and scope-closed |
| Scope fidelity | Selected work and remainder match the owning workflow or formal plan |
| Dependency fidelity | The Goal does not invent, remove, or reorder semantic dependencies |
| Worktree binding | Explicit-root capture, six literal identity values, shell-safe exact verifier command, explicit mutating `workdir`, and recheck points form a fail-closed contract |
| Worker ownership | Concurrent subagents have non-overlapping writes and focused checks |
| Reconciliation | One integrator verifies interfaces, diffs, and combined behavior |
| Gate projection | Review, acceptance, evidence, and cleanup are copied from owning sources |
| Failure routing | Every hard stop routes to the skill that owns the missing decision |
| Claim discipline | Slice completion cannot imply stage, plan, or product completion |
| TRAE operability | Goal lifecycle, existing agents, focus, and handoff are executable in TRAE |
| Copy safety | One four-backtick outer block contains the entire Goal |

Interpretation:

- `24-26`: executable.
- `21-23`: conditionally executable after named corrections.
- `<21`: reject.

## Mandatory Rejection Conditions

Reject regardless of score when:

- an equivalent Goal or background agent with the same repository/worktree,
  branch, stage, and source unit is already active;
- no current stage can be resolved;
- the `Worktree Binding` section is absent or leaves the canonical runtime
  worktree root, branch, `workspaceId`, initial `HEAD`, expected `HEAD`, or
  worktree-set digest unresolved or as a placeholder;
- the binding is inferred from a skill resolution or source location instead
  of the current verified worktree;
- the explicit-root capture command is missing, does not run from that exact
  root, is not shell-safe for a root containing whitespace, or its values are
  not immediately passed to the exact verifier command;
- the verifier command is missing, is not the first action for every subagent,
  does not run from the bound root, or does not use
  `tooling/scripts/verify-worktree-binding.py`;
- the verifier is unavailable or any binding verification exits nonzero;
- `active_work` or the current Context Anchor disagrees with the verified
  binding; return `WORKTREE_IDENTITY_MISMATCH` without automatically running
  `cd` or changing branch or worktree;
- any mutating tool call can run without the bound canonical root as explicit
  `workdir`;
- binding reverification is omitted after resume or context compaction, before
  reconcile, or before Slice completion;
- resume or context compaction may recapture current Git state as a replacement
  baseline instead of verifying persisted identity;
- the Goal permits `git switch`, `git checkout`, `git worktree add`,
  `git worktree remove`, `git worktree prune`, or new-worktree creation without
  an explicit user request for that exact operation;
- expected `HEAD` can refresh without an explicitly authorized commit, rebase,
  or merge, or the worktree-set digest can refresh without the exact explicitly
  requested worktree operation;
- the Goal crosses a stage review boundary;
- an EXECUTE Goal has no approved plan or matching tracked-work state;
- the Goal changes product, architecture, or plan semantics;
- concurrent writers overlap;
- blocked external work is treated as ready;
- evidence required by the source is omitted or weakened;
- the output is not one uninterrupted copyable block.

An unrelated Goal in another worktree is not a duplicate.

When rejection is caused by missing or conflicting sources, return the named
blocker and do not emit an executable Goal. When the sources are valid but the
Goal text is defective, return findings followed by one complete corrected
Goal.
