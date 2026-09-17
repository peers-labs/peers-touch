# TRAE Adaptive Goal Slice Review Rubric

Score each dimension from 0 to 2.

| Dimension | Pass condition |
|---|---|
| Source grounding | Every instruction projects an authoritative source or explicit owner decision |
| Stage purity | The Slice belongs to one methodology stage and stops before its review boundary |
| Slice closure | The Slice is dependency-, ownership-, evidence-, recovery-, and scope-closed |
| Queue completeness | All in-scope actions are classified as ready, in progress, parked, or done |
| Queue liveness | A blocked action is parked and the complete ready frontier continues |
| Progress contract | The Slice targets one current Task closure with a machine-derived baseline, exact `+1` delta, and unlock effect |
| Reporting boundary | Supporting actions stay inside the Slice; success cannot stop at setup, authorization, diagnosis, deploy, or one check |
| Dynamic admission | Only already-modeled remediation is admitted; new deliverables return `PLAN_AMENDMENT_REQUIRED` to the Development Run |
| Exhaustion proof | Goal-level blocked requires an empty Ready Queue, no legal remediation, and explicit hard blockers |
| Scope fidelity | Selected work and remainder match the owning workflow or formal plan |
| Dependency fidelity | The Goal does not invent, remove, or reorder semantic dependencies |
| Worktree binding | Explicit-root capture, six literal identity values, shell-safe exact verifier command, explicit mutating `workdir`, and recheck points form a fail-closed contract |
| Concurrency decision | Parallel, serial, or hybrid mode follows explicit dependency, write-set, generated-output, shared-resource, verification, and integration analysis |
| Worker ownership | Concurrent subagents have reserved non-overlapping writes, forbidden shared paths, focused checks, and exact changed-file returns |
| Agent reconciliation | Only live, backend-addressable, identity-equivalent agents block; stale entries cannot create a blanket spawn ban |
| Reconciliation | One integrator verifies interfaces, diffs, and combined behavior |
| Gate projection | Review, acceptance, evidence, and cleanup are copied from owning sources |
| Failure routing | Every hard stop routes to the skill that owns the missing decision |
| Claim discipline | Slice completion cannot imply stage, plan, or product completion |
| TRAE operability | Goal lifecycle, existing agents, focus, and handoff are executable in TRAE |
| Copy safety | One four-backtick outer block contains the entire Goal |

Interpretation:

- `35-38`: executable.
- `30-34`: conditionally executable after named corrections.
- `<30`: reject.

## Mandatory Rejection Conditions

Reject regardless of score when:

- an equivalent Goal or background agent with the same repository/worktree,
  branch, stage, and source unit is already active;
- a listed but backend-unaddressable agent is treated as a live conflict or
  converted into a persistent no-subagent constraint;
- an active Goal has a stale binding or superseded execution constraint that
  cannot be edited in place and is not rejected with
  `GOAL_REPLACEMENT_REQUIRED`;
- no current stage can be resolved;
- the `Worktree Binding` section is absent or leaves the canonical runtime
  worktree root, branch, `workspaceId`, initial `HEAD`, or expected `HEAD`
  unresolved or as a placeholder;
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
  or merge;
- the Goal crosses a stage review boundary;
- an EXECUTE Goal has no approved plan or matching tracked-work state;
- the Goal changes product, architecture, or plan semantics;
- the Goal, scheduler, or Guardian writes Plan, Task, Session, `active_work`, or
  evidence state instead of returning the result to `pt-dev-workflow`;
- concurrent writers overlap;
- execution mode is chosen from task count or speed preference without explicit
  dependency, write-set, generated-output, shared-resource, verification, and
  integration analysis;
- the Goal lacks an explicit Ready Queue and Parked Queue;
- one blocked action can mark the whole Goal blocked without recomputing the
  complete in-scope dependency-ready frontier;
- Goal-level blocked is allowed without an exhaustion proof or before the
  repeated-blocker lifecycle threshold is satisfied;
- blocked external work is treated as ready or counted as progress;
- the Goal can complete successfully without closing its target Task;
- the reported next continuation has no exact Task-closure delta;
- dynamic admission may change product behavior, architecture, ownership,
  topology, version/schema policy, destructive authorization, or proof
  strength;
- a source-defined root-cause fix or mechanical plan amendment is left out
  merely because it was discovered after Goal creation;
- evidence required by the source is omitted or weakened;
- the output is not one uninterrupted copyable block.

An unrelated Goal in another worktree is not a duplicate.

When rejection is caused by missing or conflicting sources, return the named
blocker and do not emit an executable Goal. When the sources are valid but the
Goal text is defective, return findings followed by one complete corrected
Goal.
