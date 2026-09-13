# Development Workflow Control Plane - Architecture Decisions

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-13 | **Updated**: 2026-09-13
> **Owner**: Platform Team

---

## Decision Index

| ID | Decision | Status |
|---|---|---|
| DWF-D01 | Keep the outer stage pipeline and add an EXECUTE state machine | accepted |
| DWF-D02 | Make a product Journey the unit of development progress | accepted |
| DWF-D03 | Require functional pass before formal Acceptance execution | accepted |
| DWF-D04 | Share business Journey semantics across Dev and Acceptance runners | accepted |
| DWF-D05 | Use local checkpoint commits for exact-source runtime iteration | accepted |
| DWF-D06 | Separate Development records from Acceptance Evidence | accepted |
| DWF-D07 | Stop on the first actionable failure under explicit budgets | accepted |
| DWF-D08 | Keep plans compact and store transient execution state outside Git | accepted |
| DWF-D09 | Reserve `PROVEN` for formal Acceptance interpretation | accepted |
| DWF-D10 | Pilot the architecture in Chat before generalizing it | accepted |
| DWF-D11 | Publish resource intent to one machine-wide work ledger | accepted |
| DWF-D12 | Upgrade `pt-dev-workflow`; do not add another orchestrator Skill | accepted |
| DWF-D13 | Treat independent-branch source overlap as coordination, not locking | accepted |

## DWF-D01: EXECUTE Owns A Mandatory Inner State Machine

**Status**: accepted
**Date**: 2026-09-13

### Context

The existing `PRODUCT -> DESIGN -> PLAN -> EXECUTE -> DELIVER` pipeline is useful,
but `EXECUTE` currently groups implementation, testing, runtime verification and
evidence work without ordered transition guards.

### Decision

Keep the outer pipeline. Add the Development Workflow state machine inside
`EXECUTE`.

### Rationale

This fixes the missing control boundary without migrating every plan,
`active_work` row and stage skill to a new top-level stage vocabulary.

### Alternatives Considered

- Add top-level `DEVELOP` and `VERIFY` stages: clearer names, but high migration
  cost and no stronger ownership.
- Leave `EXECUTE` informal: rejected because it permits Acceptance expansion
  before functional closure.

### Consequences

Existing plans remain valid, but executors must record the inner state for the
active Journey.

## DWF-D02: Journey Is The Progress Unit

**Status**: accepted
**Date**: 2026-09-13

### Context

File counts, workstream percentages and Gate counts can increase while the
user-visible workflow remains broken.

### Decision

Track development progress by named Journey and receiver-visible result.

### Rationale

A Journey maps engineering activity to a user outcome and exposes partial
delivery directly.

### Alternatives Considered

- Count completed tasks or tests: rejected because they are implementation
  activity, not product outcome.
- Track only capability-level Acceptance: rejected because it is too expensive
  for each red-loop iteration.

### Consequences

Every product work item needs at least one P0 Journey. Infrastructure,
refactor and documentation work use their class-specific functional boundary.

## DWF-D03: Functional Pass Precedes Formal Acceptance

**Status**: accepted
**Date**: 2026-09-13

### Context

Running broad Acceptance while the first product action is still broken creates
evidence churn and delays root-cause feedback.

### Decision

Acceptance criteria remain defined before implementation, but Acceptance Gate
injection and broad execution occur only after the Dev Journey reaches
`FUNCTIONAL_PASS`.

### Rationale

This preserves design discipline and regression coverage while keeping the
development loop short.

### Alternatives Considered

- Implement all Acceptance first: rejected because unstable product paths make
  expensive Gates diagnose implementation rather than guard behavior.
- Defer all tests: rejected; focused unit and contract checks remain mandatory.

### Consequences

An exception requires an accepted decision that the Acceptance mechanism itself
is the implementation target.

## DWF-D04: One Business Journey, Two Execution Policies

**Status**: accepted
**Date**: 2026-09-13

### Decision

Dev Runner and Acceptance Runner consume one business-owned Journey
implementation. They differ only in provisioning, persistence, completeness and
publication policy.

### Rationale

This prevents Harness shortcuts or stale duplicated actions from diverging from
the UI path used during development.

### Alternatives Considered

- Separate smoke and Acceptance scripts: rejected because behavior drifts.
- Run the complete Acceptance runner for every edit: rejected because setup,
  evidence and matrix costs dominate the feedback loop.

### Consequences

Existing Gates that embed both business actions and infrastructure lifecycle
must separate those responsibilities.

## DWF-D05: Checkpoint Commits Are Development Infrastructure

**Status**: accepted
**Date**: 2026-09-13

### Context

Remote Station deployment requires Git-addressable HEAD, while repeated
per-commit authorization can block every functional iteration.

### Decision

An approved execution plan carries a scoped authorization envelope for local
checkpoint commits. Push, PR, reset and history rewrite remain separate
capabilities.

### Rationale

The runtime can attest exact source without conflating a checkpoint with
delivery.

### Alternatives Considered

- Dirty rsync overlay: rejected because runtime source is not reproducible.
- Ask before every checkpoint: rejected because it creates administrative
  latency without changing scope.

### Consequences

Plans must state checkpoint policy. Commit cleanup before delivery remains
explicit and cannot silently rewrite shared history.

## DWF-D06: Development State Is Not Acceptance Evidence

**Status**: accepted
**Date**: 2026-09-13

### Decision

Development session records live under the machine Dev workspace. Acceptance
Evidence Store receives only formal Acceptance runs.

### Rationale

This prevents hundreds of diagnostic iterations from polluting immutable
product evidence while preserving enough state to resume debugging.

### Alternatives Considered

- Write every attempt to Evidence Store: rejected due evidence inflation.
- Keep no development record: rejected because resume and first-failure
  attribution become conversational memory.

### Consequences

Development records have independent retention and cannot satisfy Acceptance
proof.

## DWF-D07: First Failure And Explicit Budgets

**Status**: accepted
**Date**: 2026-09-13

### Decision

Every command and Journey has a declared purpose and timeout. Execution stops at
the first actionable failure and does not launch unrelated checks.

### Rationale

One causally useful failure is more valuable during development than a large
matrix of downstream failures.

### Alternatives Considered

- Continue all checks to collect maximum data: retained only for CI/release
  qualification, not the red loop.

### Consequences

Some independent failures are discovered later, after the primary failure is
fixed. This is an accepted tradeoff for faster causal feedback.

## DWF-D08: Compact Plan, External Session Ledger

**Status**: accepted
**Date**: 2026-09-13

### Decision

Execution plans retain current state, milestone summaries and durable evidence
references. Per-attempt logs, screenshots and event history remain under the
machine Dev root.

### Rationale

Append-only execution diaries make plan recovery expensive and obscure the
current dependency frontier.

### Alternatives Considered

- Continue appending all evidence to plans: rejected.
- Store task truth only in local files: rejected because durable project
  progress must remain reviewable.

### Consequences

Plan updates replace the current snapshot and append only milestone-level
history. Local session cleanup must preserve any promoted durable conclusion.

## DWF-D09: `PROVEN` Is A Formal Proof Term

**Status**: accepted
**Date**: 2026-09-13

### Decision

Development output uses `PASS/FAIL/BLOCKED` plus a verification class. Product
readiness uses `PROVEN` only through Acceptance capability interpretation.

### Rationale

A static Gate may prove its own assertion while proving nothing about a Native
user Journey. The workflow must not collapse those meanings.

### Alternatives Considered

- Rename every existing Acceptance result: rejected as unnecessary framework
  migration.

### Consequences

Status renderers must always show verification class beside result.

## DWF-D10: Chat Is The Pilot

**Status**: accepted
**Date**: 2026-09-13

### Decision

Validate the architecture first with Direct and three-client Group Chat
Journeys. Generalize only after measured improvement.

### Rationale

Chat contains UI, Desktop Rust, Station, encryption, multiple actors,
multi-Station deployment and Native runtime boundaries. It is representative
without requiring a generic platform to be built speculatively.

### Alternatives Considered

- Build a generic Dev platform first: rejected because it repeats the same
  infrastructure-first failure.
- Use a trivial single-process feature: rejected because it would not exercise
  the critical boundaries.

### Consequences

The first implementation may contain Chat-owned adapters around generic
interfaces. Generalization requires evidence from the pilot, not anticipation.

## DWF-D11: Public Resource Declaration Before Development

**Status**: accepted
**Date**: 2026-09-13

### Context

Independent worktree-local state cannot tell another worktree which source
paths, branch, Profile, Station capability, Fixture or client storage a task
intends to use. Process discovery only reports resources after a collision may
already have occurred.

### Decision

After read-only intake and before the first repository write or runtime
acquisition, every work item atomically publishes a
`DevelopmentResourceDeclaration` to:

```text
~/.peers-touch/dev/work.json
```

All worktrees read the same file. Publication requires a machine lock, conflict
evaluation and digest readback. Scope changes at PRODUCT, DESIGN, PLAN or
EXECUTE update the same declaration atomically. `BOUND` additionally requires
the final plan-derived declaration. The declaration owns intent visibility;
Local Dev Control Plane leases continue to own live exclusivity.

### Rationale

Other worktrees need a common, pre-mutation view. Keeping declarations separate
from leases preserves the difference between “plans to use” and “currently
holds”.

### Alternatives Considered

- Worktree-local `.local` declaration: rejected because peers cannot discover it
  through one authority.
- Git-tracked declaration: rejected because machine allocations are private,
  mutable state and would create repository churn.
- Infer intent from processes, branches or `active_work`: rejected because they
  describe observed runtime, source history or delivery status, not resource
  intent.
- Store declarations inside `registry.json`: rejected because the Local Dev
  registry owns allocation while Development Workflow owns task intent.

### Consequences

- Dev start fails closed when the public ledger cannot be locked, validated,
  written or read back.
- Declarations require heartbeat, expiry and explicit release semantics.
- Source claims inside one workspace and writes to the same branch block before
  editing. Overlap between different worktrees on different branches remains
  visible as a coordination warning.
- Runtime mutation still requires the corresponding live lease and
  authorization; a declaration alone cannot deploy or reset.

## DWF-D12: One Workflow Skill Orchestrator

**Status**: accepted
**Date**: 2026-09-13

### Context

`pt-dev-workflow` already claims to be the single entry point for non-trivial
development, but currently owns only outer-stage dispatch. Other Skills cover
plan execution, defect closure and Native Acceptance separately, with no shared
resource-declaration or functional-promotion contract.

### Decision

Upgrade `pt-dev-workflow` as the sole workflow orchestrator. Do not add a
parallel `pt-dev-loop` or similarly overlapping Skill.

It delegates:

- execution-state enforcement to `pt-execution-plan-guardian`;
- bug-specific diagnosis to `pt-defect-closure`;
- runtime preparation to `pt-dev-runtime-handoff`;
- formal proof to `pt-acceptance-engineering`;
- delivery evidence to `pt-quality-check` and GitHub Skills.

### Rationale

One entry point gives every task the same declaration and promotion rules while
keeping domain-specific work in existing specialist Skills.

### Alternatives Considered

- Add `pt-dev-loop`: rejected because it would overlap `pt-dev-workflow` and
  make entry-point selection ambiguous.
- Put the entire loop in `pt-execution-plan-guardian`: rejected because
  resource declaration begins before PLAN/EXECUTE.
- Put the loop in Acceptance Skills: rejected because Acceptance does not own
  product implementation progress.

### Consequences

- Existing Skills must reference one shared Development Workflow state model.
- Stage dispatch cannot bypass public resource declaration.
- `pt-defect-closure` must insert functional verification before Acceptance
  injection.
- `pt-dev-runtime-handoff` must expose Dev and Acceptance policies without
  creating two Journey implementations.

## DWF-D13: Independent-Branch Source Overlap Is Advisory

**Status**: accepted
**Date**: 2026-09-14

### Context

Git worktrees provide separate working directories and indexes. The initial
ledger policy nevertheless treated overlapping repository-relative source
claims as a machine-global lock, even when the declarations belonged to
different worktrees on different branches. A broad claim such as
`apps/desktop` could therefore stop unrelated branch-local implementation
without proving that another process was editing the same files.

### Decision

Keep source claims machine-visible, but distinguish coordination risk from
shared-resource exclusion:

- overlapping source writes inside one workspace remain a hard conflict;
- two worktrees writing the same branch remain a hard conflict;
- overlapping source claims in different worktrees on different branches are
  allowed and emit `SOURCE_OVERLAP_WARNING`;
- runtime claims keep their existing machine-global shared/exclusive conflict
  semantics.

### Rationale

Source trees are isolated by Git and can be reconciled semantically at merge
time. Ports, client storage, Fixtures, deploy targets and resets are not
isolated by Git and still require machine-global exclusion.

### Alternatives Considered

- Keep every overlapping source path as a hard lock: rejected because broad
  declarations serialize independent branches and block useful product work.
- Remove source declarations entirely: rejected because same-workspace and
  same-branch collisions still need prevention, and cross-branch overlap is
  valuable coordination information.
- Infer active editing from a declaration: rejected because a declaration
  records intent, not process liveness.

### Consequences

- Parallel branches can edit the same logical module.
- `dev-start` and `dev-update` report cross-branch overlap without failing.
- Integrators must still reconcile overlapping source changes before merge.
- Runtime resources remain protected independently from source coordination.
