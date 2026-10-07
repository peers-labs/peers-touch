# Host-Neutral Goal Slice Output Template

## Objective

<One meaningful stage-owned outcome that may require several queued actions.>

## Goal Slice

- Stage: <PRODUCT | DESIGN | PLAN | EXECUTE | DELIVER>
- Source unit: <stage checkpoint or formal plan workstream/task IDs>
- Execution horizon: <same-stage/worktree/owner scope this Goal may drain>
- Completion boundary: <Task-closing outcome>
- Hard cut point: <semantic, authorization, ownership, worktree, or external-resource boundary>
- Plan Run relationship: after durable closure, `pt-dev-workflow` activates a
  dependency-ready successor and continues without asking the user.

## Progress Contract

- Unit: `task-closure`
- Baseline: <completed>/<total> Task closures (<percentage>%)
- Target Task: <current Task ID and title>
- Required transition: `in_progress -> done`
- Expected delta: <completed/total -> completed+1/total>
- Unlock effect: <newly dependency-ready Task IDs>
- Reporting boundary: setup, authorization, diagnosis, checkpoint, deploy, and
  individual checks remain internal actions.
- Zero-delta rule: only source-backed hard-boundary exhaustion may end the
  Slice without progress.

## Worktree Binding

- Canonical runtime worktree root: `<materialized-canonical-absolute-path>`
- Branch: `<materialized-branch>`
- `workspaceId`: `<materialized-workspaceId>`
- Bound Plan ID/path: `<materialized-planId>` / `<repository-relative-planPath>`
- Initial HEAD: `<immutable Plan audit baseline>`
- Expected HEAD: `<current source projection>`
- Capture command: `python3 tooling/scripts/verify-worktree-binding.py --root '<root>' --capture`
- Verification command: `python3 tooling/scripts/verify-worktree-binding.py --root '<root>' --branch '<branch>' --workspace-id '<workspaceId>' --head '<expected-head>'`
- Shell quoting: materialize every value as one shell-safe argument, including
  a root containing whitespace.
- Mismatch policy: unresolved identity returns
  `WORKTREE_IDENTITY_UNAVAILABLE`; any drift returns
  `WORKTREE_IDENTITY_MISMATCH` without changing directory, branch, or
  worktree.
- Mutation policy: every mutating tool call uses the bound root as `workdir`.
- Forbidden operations: no `git switch`, `git checkout`, `git worktree add`,
  `git worktree remove`, or `git worktree prune` without explicit
  authorization for that exact operation.

## Governing Sources

- `<repo-relative-path>`: <authority>

## In Scope

- <source-defined work inside the bounded horizon>

## Out Of Scope

- <different-stage, worktree, or owner work>

## Source Work Graph

<Projection of the owner-supplied graph. Do not redesign dependencies here.>

## Concurrency Decision

- Mode: <parallel | serial | hybrid>
- Dependency-ready units:
- Contract-freeze points:
- Exclusive write-set owners:
- Shared files and generated artifacts:
- Shared runtime resources:
- Integration order and rollback boundary:
- Existing-worker reconciliation:
- Host capability request: <none | workers | UI transport>
- Host adapter: <none | pt-trae-host-adapter | pt-cursor-host-adapter | pt-codex-host-adapter>
- Invocation owner: `pt-dev-workflow` after `ACTION_ALLOWED`; this Goal only
  projects the request.
- Degraded execution: `HOST_PARALLELISM_UNAVAILABLE` recomputes serial or
  hybrid work when safe.

## Adaptive Execution Queue

### Initial Ready Queue

| Action | Progress role | Dependencies | Owner/write set | Required evidence |
|---|---|---|---|---|
| <action> | <supports closure or closes Task> | <prerequisites> | <owner> | <check> |

### In Progress

- <none or resumed action with verified owner>

### Initial Parked Queue

| Action | Blocking class | Exact edge | Owner | Unblocking condition |
|---|---|---|---|---|
| <action> | <SOFT_EXTERNAL or HARD_GOVERNANCE> | <reason> | <owner> | <condition> |

### Done Baseline

| Action | Source task | Evidence |
|---|---|---|
| <completed prerequisite> | <ID> | <owner evidence> |

## Execution Contract

1. Reverify worktree binding before every resumed interval.
2. Submit each action to `pt-execution-plan-guardian`.
3. Let `pt-dev-workflow` execute `ACTION_ALLOWED` work and persist owner state.
4. Dispatch a host adapter only for a capability the project-native path lacks.
5. Recompute the full frontier after every result.
6. Do not report success until the target Task is `done` and the progress delta
   is visible.
7. Return `NEXT` candidates to Dev Workflow; never activate them here.

## Worker Lanes

For each independent worker:

- Verified binding and explicit `workdir`:
- Source unit:
- Exclusive write set:
- Shared paths it must not edit:
- Required focused verification:
- Exact return contract:
- Hard stops:

## Reconcile

- Integrator:
- Binding recheck:
- Inputs:
- Interface checks:
- Conflict policy:
- Required focused verification:

## Failure And Escalation

- `GOAL_REPLACEMENT_REQUIRED`: stale objective cannot be repaired in place.
- `RECOVERABLE_IMPLEMENTATION`: source-backed remediation and retry.
- `PLAN_AMENDMENT_REQUIRED`: Dev Workflow records the execution-model change
  with `planctl amend` and continues the same Plan Run.
- `HOST_PARALLELISM_UNAVAILABLE`: recompute serial/hybrid transport.
- `SOFT_EXTERNAL`: park and continue independent work.
- `HARD_GOVERNANCE`: name the missing decision, authorization, or resource.
- Goal-level stop: require an explicit exhaustion proof after the Ready Queue
  and every legal remediation are empty.

## Slice Completion

- Complete when:
- Remains unproven:
- Parked at completion:
- Exhaustion proof, when blocked:
- Successor candidates:
