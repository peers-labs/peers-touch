# Development Workflow Control Plane - Architecture Decisions

> **Status**: accepted
> **Version**: v1.4
> **Created**: 2026-09-13 | **Updated**: 2026-09-18
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
| DWF-D10 | Pilot the original control plane in Chat | accepted |
| DWF-D11 | Publish resource intent to one machine-wide work ledger | accepted |
| DWF-D12 | Upgrade `pt-dev-workflow`; do not add another orchestrator Skill | accepted |
| DWF-D13 | Make Plan Package + Task Slice the active-plan source | accepted |
| DWF-D14 | Separate source completion from functional and formal proof | accepted |
| DWF-D15 | Make a Task-closing Progress Slice the continuation unit | accepted |
| DWF-D16 | Bind tracked declarations to an explicit Plan locator | accepted |
| DWF-D17 | Bind the current worktree, not the sibling inventory | accepted |
| DWF-D18 | Bind each workspace to one immutable Plan | accepted |
| DWF-D19 | Keep advancing source identity outside tracked Plan content | accepted |

## DWF-D01: EXECUTE Owns A Mandatory Inner State Machine

**Status**: accepted
**Date**: 2026-09-13

### Context

The outer pipeline groups implementation, verification and evidence without
ordered transition guards.

### Decision

Keep `PRODUCT -> DESIGN -> PLAN -> EXECUTE -> DELIVER`; add the Development
state machine inside `EXECUTE`.

### Rationale

This fixes the missing control boundary without renaming every project stage.

### Alternatives Considered

- Add top-level `DEVELOP` and `VERIFY`: rejected due migration cost and no
  stronger ownership.
- Leave `EXECUTE` informal: rejected because Acceptance can expand too early.

### Consequences

Every active Task/Journey records one machine-owned inner state.

## DWF-D02: Journey Is The Progress Unit

**Status**: accepted
**Date**: 2026-09-13

### Decision

Track product work by named Journey and receiver-visible result. Infrastructure,
refactor and documentation use an equivalent real functional boundary.

### Rationale

File, test and Gate counts measure activity, not a user outcome.

### Alternatives Considered

- Count tasks/tests: rejected as implementation activity.
- Track only formal capability proof: rejected as too expensive for each edit.

### Consequences

Every Task Slice declares one Journey or functional boundary.

## DWF-D03: Functional Pass Precedes Formal Acceptance

**Status**: accepted
**Date**: 2026-09-13

### Decision

Define Acceptance before implementation, but inject or execute broad formal
Acceptance only after exact-source `FUNCTIONAL_PASS`.

### Rationale

Focused checks stay fast while unstable product paths do not generate evidence churn.

### Alternatives Considered

- Acceptance-first implementation: rejected for red-loop diagnosis.
- Defer all tests: rejected; focused source and contract checks remain mandatory.

### Consequences

An exception requires an accepted architecture decision.

## DWF-D04: One Business Journey, Two Execution Policies

**Status**: accepted
**Date**: 2026-09-13

### Decision

Dev Runner and Acceptance Runner consume one business-owned Journey. Provisioning,
persistence, completeness and publication policy remain runner-specific.

### Rationale

Duplicated smoke and Acceptance scripts drift in action and assertion semantics.

### Consequences

Existing Gates that mix behavior with provisioning must separate those concerns.

## DWF-D05: Checkpoint Commits Are Development Infrastructure

**Status**: accepted
**Date**: 2026-09-13

### Decision

A plan carries scoped local checkpoint authorization. Push, PR, reset and history
rewrite remain separate capabilities.

### Rationale

Remote runtimes need Git-addressable exact source without treating checkpoint as delivery.

### Alternatives Considered

- Dirty source overlay: rejected as non-reproducible.
- Per-commit prompts: rejected as repeated administration within accepted scope.

### Consequences

Plans must state authorization; no capability is inferred from another.

## DWF-D06: Development State Is Not Acceptance Evidence

**Status**: accepted
**Date**: 2026-09-13

### Decision

Development records live under the machine Dev workspace. Evidence Store receives
only formal Acceptance runs.

### Rationale

Resume data and immutable product proof have different retention and trust semantics.

### Consequences

Development records can diagnose but cannot prove product readiness.

## DWF-D07: First Failure And Explicit Budgets

**Status**: accepted
**Date**: 2026-09-13

### Decision

Every command/Journey has a purpose and timeout. The red loop stops on the first
actionable failure.

### Rationale

One causal failure is more useful than a matrix of downstream failures.

### Consequences

Independent failures may surface after the first failure is fixed.

## DWF-D08: Compact Plan, External Session Ledger

**Status**: accepted
**Date**: 2026-09-13

### Decision

Git retains current plan state and durable evidence references; per-attempt logs,
screenshots and events stay under the machine Dev root.

### Rationale

Append-only execution diaries obscure the current dependency frontier.

### Consequences

Current snapshots replace prior snapshots. Durable conclusions must be promoted
before session cleanup.

## DWF-D09: `PROVEN` Is A Formal Proof Term

**Status**: accepted
**Date**: 2026-09-13

### Decision

Development uses `PASS/FAIL/BLOCKED/NOT_RUN` plus verification class. `PROVEN`
is reserved for Acceptance capability interpretation.

### Rationale

A static Gate can pass without proving a Native product Journey.

### Consequences

Status renderers always show verification class beside result.

## DWF-D10: Chat Is The Original Control-Plane Pilot

**Status**: accepted
**Date**: 2026-09-13

### Decision

Validate Journey and exact-source rules with Direct and three-client Group Chat
before generic rollout.

### Rationale

Chat exercises UI, native, Station, encryption, actor and multi-client boundaries.

### Consequences

Generalization requires measured pilot evidence, not speculative abstractions.

## DWF-D11: Public Resource Declaration Before Development

**Status**: accepted
**Date**: 2026-09-13

### Decision

After read-only intake and before first write/runtime acquisition, atomically
publish `DevelopmentResourceDeclaration` to `~/.peers-touch/dev/work.json`.

### Rationale

All worktrees need one pre-mutation view of source and runtime intent.

### Alternatives Considered

- Worktree-local or Git-tracked state: rejected as undiscoverable or noisy.
- Infer intent from processes/branches: rejected because observed state is late.

### Consequences

Lock, schema, conflict, heartbeat, expiry, release and digest readback fail closed.
Declarations advertise intent but never grant runtime leases.

## DWF-D12: One Workflow Skill Orchestrator

**Status**: accepted
**Date**: 2026-09-13

### Decision

Upgrade `pt-dev-workflow` as the sole intake-to-close orchestrator. Delegate
execution, defect, runtime, Acceptance and delivery work to specialist Skills.

### Rationale

A second `pt-dev-loop` would create ambiguous entrypoints and split lifecycle truth.

### Consequences

All specialist Skills reference one Development Workflow state model.

## DWF-D13: Plan Package And Task Slice Are The Active Plan Source

**Status**: accepted
**Date**: 2026-09-16

### Context

The current single Markdown plan format mixes stable scope/DAG with current
execution state and historical run narratives. Mobile Shell has grown beyond
4,000 lines, and Context Anchor must parse a large document to recover one task.
`active_work.current_step` then duplicates that state as free text.

### Decision

Replace the active single-file plan with a Plan Package:

```text
<date>-<slug>/
├── plan.md
├── tasks/<task-id>.md
└── archive/<historical-input>.md
```

- `plan.md` owns stable goal, scope, architecture traceability, DAG, task index,
  Task lifecycle/current selection, authorization and the sole Acceptance
  Execution contract.
- Each Task Slice owns one independently resumable execution closure and compact
  specification plus durable snapshot; it does not own Task lifecycle status.
- The machine Session journal owns current transition, attempts and first failure;
  `session.json` is its replayable projection.
- `active_work` mirrors `current_task_id`, `current_task_path` and `dev_state`;
  it removes `current_step` and never overrides manifest/Session truth.
- Context Anchor reads only `active_work`, manifest, current Task and Session.
- Manifest and Task bounds are enforced by `planctl`, not reviewer convention.
- A migrated legacy plan moves under `archive/`, is excluded from discovery and
  cannot remain a live status owner.

New plans use Plan Package immediately. Existing inactive/completed plans remain
historical. An active legacy plan hard-cuts under a plan migration lock/journal:
create and validate a prepared package, verify byte-identical archive and live
reference inventory, atomically replace prepared files, then verify one active
plan. Interrupted migration completes or rolls back from the journal before
readers resume.

DWF-D13 bootstraps inside the current active Mobile Shell legacy plan:

1. the plan adds one bounded `DWF-B` workstream and makes it the current closure;
2. W6A returns to its honest partial status while DWF-B owns tooling,
   package-aware Skill implementation, migration and both reviews;
3. no second DWF plan is activated;
4. DWF-B stages and validates the Mobile Plan Package under a migration lock;
5. the final transaction performs the Skill/reference hard cut, verifies and
   journals the reviewed `active_work NONE -> NONE` disposition, marks DWF-B
   done, archives the legacy plan and publishes the Mobile package as `blocked`
   with typed exhaustion and no current Task because the source/runtime proof
   roots recorded by the package remain incomplete.

Migration recovery is serialized by an owner-token lock plus an exclusive
recovery claim. B4 approves one exact PREPARED journal digest; commit preserves
that input as `migration.json.reviewed` and every later phase must derive from
it. The implementation also re-observes the declared `active_work` registry,
verifies actual root/branch/workspace/HEAD identity and the formal Gate
`workspaceDigest` before mutation, and rehashes every applied target before
COMMITTED and backup deletion. The reviewed crosswalk digest and old-path
reference inventory remain mandatory. Public discovery derives the fixed
`workflow/plan-migration` locator from repository/workspace identity, rejects
locator overrides and malformed phases, while migration writers reject a
caller-selected workspace that differs from canonical `repoRoot` before
journal access. Replacement target/prepared/backup paths are globally unique;
each existing-target mutation materializes an after-image carrier, persists one
`pendingOperation` with hash, device/inode and size/mtime/ctime snapshots before
the syscall, then atomically exchanges the carrier and target and verifies the
resulting file objects. Absent targets use atomic no-replace creation, and
legacy removal and rollback use the same journal-before-syscall protocol. The
engine proves both required primitives on the package and journal filesystems
before taking the lock.

Public package reads fence journal/lock digests across the complete
manifest/Task/crosswalk read window, not only at discovery entry. Lock and
recovery-claim liveness binds PID to boot/start identity so PID reuse cannot
impersonate an owner. Stale takeover atomically captures the exact observed
inode before validation. Terminal backup cleanup captures the complete batch,
revalidates all terminal targets/archive and captured versions, writes
`VALIDATED`, and only then deletes captures; a pre-validation mismatch restores
the whole batch. A changed or missing COMMITTED archive fails closed instead of
being reconstructed. Rollback first rehashes every restored target before
`ROLLED_BACK` and uses the same batch cleanup protocol.

The plan being migrated is therefore also the only execution authority for the
migration. At no point are two plans active for the worktree.

### Rationale

This preserves stable reviewable contracts while making resume cost proportional
to the current Task, not project history. It also gives state transitions a
machine owner and removes chat/prose as recovery truth.

### Alternatives Considered

- Keep one Markdown file and periodically truncate it: rejected because current
  state and history remain coupled.
- One file per test or command: rejected because it destroys execution closure.
- Store all task truth in machine files: rejected because durable scope and
  progress would not be reviewable in Git.
- Support old and new live formats indefinitely: rejected as split-brain.

### Consequences

- Tooling must validate package bounds, DAG, current Task and task/session identity.
- `planctl advance` atomically owns Task status/current selection in the manifest.
- Acceptance plan discovery must understand package manifests.
- Context Anchor and workflow Skills must switch atomically to stable task pointers.
- Migration requires updating every live path reference.
- Source-only, runtime-backed and documentation Tasks require different legal
  completion paths and claim vocabulary.
- Historical narrative remains available, but no resume path reads it.
- The first migration is the current Mobile Shell plan in `peers-social`.

### Review / Reversal Trigger

Reject or revise DWF-D13 if the pilot cannot:

- preserve all legacy content without a second active truth;
- resume from at most manifest + current Task + current Session;
- drive current-closure Acceptance without archive reads; or
- deterministically reject invalid packages and transitions.

## DWF-D14: Source Completion Is Not Functional Proof

**Status**: accepted
**Date**: 2026-09-16

### Context

The Mobile pilot splits implementation source from runtime proof. Treating both
as ordinary functional Tasks either makes source work depend on unavailable
physical proof or mislabels unit/static checks as product-functional evidence.
Embedding an automatically allocated Gate run ID after execution also changes
the source digest that the evidence claims to prove.

### Decision

- Every Task declares `completionClass: source | functional |
  acceptance-aggregate`.
- A `source` Task uses `runtimeClass=source-only`, owns no Acceptance Gate, and
  terminates at `SOURCE_READY` after focused source/structural/UX checks. It
  makes no product-functional claim.
- A non-documentation source Task must have exactly one direct downstream
  `functional` proof Task in the same workstream. Documentation source Tasks
  terminate without inventing runtime proof. Source successors depend on
  predecessor source Tasks; proof successors retain predecessor proof
  dependencies.
- A functional runtime Task reaches `FUNCTIONAL_PASS` through the development
  execution policy for its Journey. Formal `ACCEPTANCE_PROOF` remains a
  separate later transition through the Acceptance policy.
- An `acceptance-aggregate` Task owns no new functional claim; it validates the
  proof set and may run formal Acceptance without fabricating
  `FUNCTIONAL_PASS`.
- Development execution may reuse Acceptance provisioning and Journey adapters,
  but writes only machine Dev artifacts and never publishes an Acceptance
  latest pointer or `PROVEN` result.
- A formal single-Gate run may receive one format-valid, previously unused
  preallocated run ID. The immutable evidence URI is written before source
  capture, so a passing run attests the exact reviewed workspace without a
  post-run source edit. Collision fails closed; the runner never substitutes
  another identity.

### Rationale

Source readiness, functional behavior, and formal proof are different facts
with different owners. Modeling them explicitly preserves implementation-first
iteration without weakening exact-source evidence.

### Alternatives Considered

- Mark source tests as `FUNCTIONAL_CHECK`: rejected because they do not execute
  the product Journey.
- Route every source dependency through physical proof: rejected because
  unavailable evidence would block independent source work.
- Update Task evidence with a generated run ID after the Gate: rejected because
  it invalidates the Gate's source digest.

### Consequences

- `SOURCE_READY` is terminal for one source Task Session but not product
  completion.
- Plan Package validation rejects source closures with Gate ownership or no
  same-workstream functional successor.
- The runner must keep development artifacts outside the repository and outside
  the Acceptance latest namespace.

## DWF-D15: A Progress Slice Is The Continuation Unit

**Status**: accepted
**Date**: 2026-09-17

### Context

Context Anchors currently expose an unstructured `Next action`. Agents can
execute that action successfully while only reading state, obtaining
authorization, changing a profile, or running a diagnostic. The next Anchor
then reports the same completed/total count, so a succession of valid local
actions produces no visible project progress.

### Decision

- Overall progress is completed Task closures divided by total Task closures.
- `planctl status` derives the current Task's exact completion effect:
  `in_progress -> done`, `+1` closure, percentage-point delta, and newly
  unlocked Task IDs.
- Context Anchor replaces `Next action` with one `Next Progress Slice` that
  targets that completion effect.
- Goal orchestration may schedule several supporting actions inside the Slice,
  but Dev Workflow continues through them until the Task closes or reaches a
  hard boundary.
- Successful setup, status, authorization, diagnostic, checkpoint, deploy, or
  focused-check actions cannot by themselves end the user-facing continuation.
- A zero-delta handoff is valid only for a source-backed hard boundary after
  the complete ready frontier is exhausted.

### Rationale

This makes every normal continuation predictably increase durable progress
without turning each command into a Task or duplicating the plan DAG in chat.

### Alternatives Considered

- Add arbitrary percentage weights to Tasks: rejected because weights are
  subjective and hide poorly sliced work.
- Treat every command or Session transition as progress: rejected because it
  rewards activity instead of outcomes.
- Keep free-text `Next action` and rely on prompt quality: rejected because no
  machine contract links the action to durable progress.

### Consequences

- Task Slices must remain meaningful and independently closable.
- Long-running Goals are bounded by Task closure, not by one command.
- Context Anchors become smaller while carrying a stronger continuation
  contract.
- A large Task that repeatedly cannot close must be amended or split rather
  than reporting artificial partial percentages.

## DWF-D16: Tracked Declarations Carry An Explicit Plan Locator

**Status**: accepted
**Date**: 2026-09-17

### Context

The machine work ledger identifies `workItemId` and Journey but does not identify
the Plan Package that owns progress. `workItemId` is not a Plan or Task key and
may intentionally differ from both. Consumers therefore cannot join a live
Development Run to `planctl status` without guessing from repository contents.

### Decision

Every post-rollout declaration stores `planPath`, `planId`, and `taskId`. The
three fields are either all non-null for tracked work or all null for explicitly
untracked work. During rollout, legacy records may omit the tuple and remain
readable without bulk rewrite. `planPath` is repository-relative and
containment-checked. On publication or update, tracked declarations must match
the package identity and immutable workspace binding. An active package must
match its single current Task. A blocked/completed package may retain only the
corresponding blocked/done Task locator until cleanup, delivery, and declaration
release finish.

Task handoff, commit, merge, rebase, or other source-identity change requires
one declaration update. Heartbeat extends liveness only; it does not change the
Plan locator or source identity.

### Rationale

An explicit foreign key is the only deterministic join. Inferring a Plan from
`workItemId`, active-work prose, branch, directory names, or a repository scan
creates ambiguous progress and can attach one task to another plan.

### Alternatives Considered

- Infer Plan from `workItemId`: rejected because work item and Task IDs are
  independent identities.
- Scan for the only active Plan: rejected because repositories may contain
  multiple packages and historical legacy plans.
- Read `active_work` directly in Peers Dev: rejected because the dashboard
  consumes the machine declaration contract and must not gain another mutable
  workflow authority.

### Consequences

- Existing ledger records remain byte-compatible until their worktree adopts
  the new writer; new readers project missing fields as a null locator.
- Tracked workflow commands publish and refresh all three fields atomically.
- Peers Dev can resolve progress through the canonical Plan Package parser and
  expose typed unavailable/mismatch states without filesystem-path leakage.

## DWF-D17: Bind The Current Worktree, Not The Sibling Inventory

**Status**: accepted
**Date**: 2026-09-17

### Context

The execution binding included a digest of every path returned by
`git worktree list`. Adding, removing or pruning an unrelated sibling worktree
therefore invalidated every active task in the repository even when the bound
root, branch, workspace and HEAD were unchanged. The digest also made one
worktree's progress depend on machine topology owned by other tasks.

### Decision

- Immutable execution identity consists of the explicitly selected canonical
  root, current working directory, branch, `workspaceId`, initial HEAD and
  expected HEAD.
- The sibling worktree inventory is operational topology, not identity. It is
  neither emitted nor compared by the verifier, Plan Package, new migration
  journals, `active_work`, Goal, or Context Anchor.
- A pre-DWF-D17 migration may retain the old field only inside its immutable
  reviewed snapshot. Recovery normalizes that reviewed input and removes the
  field from the live journal on its next write.
- Root, branch, workspace or expected-HEAD drift remains fail-closed with
  `WORKTREE_IDENTITY_MISMATCH`.
- Adding, removing or pruning an unrelated sibling worktree does not require a
  binding migration or user authorization for the current task.
- The old digest field is removed as a hard cut; readers and writers do not
  maintain a compatibility alias.

### Rationale

An identity field must describe the selected execution object. Repository-wide
worktree membership describes mutable shared topology and cannot establish
whether the current worktree changed. Canonical root plus `workspaceId` already
distinguishes sibling worktrees, while branch and HEAD fence source state.

### Alternatives Considered

- Automatically refresh the digest after sibling churn: rejected because it
  preserves the false invariant and still interrupts unrelated work.
- Keep the digest as optional persisted telemetry: rejected because persisted
  topology invites callers to treat it as authority again.
- Ignore only known temporary paths: rejected because path allowlists encode
  environment accidents rather than the ownership model.

### Consequences

- Existing Plan Package and `active_work` records must remove the obsolete
  field when they adopt this contract. The `active_work` rewrite preserves
  current-worktree identity and appends an auditable schema-migration record.
- Worktree add/remove authorization remains required for the operation itself;
  it no longer mutates another task's identity.
- Regression coverage must prove that unrelated sibling worktree churn leaves
  capture and verification output unchanged.

## DWF-D18: Bind Each Workspace To One Immutable Plan

**Status**: accepted
**Date**: 2026-09-18

### Context

Independent Agent and Chat worktrees synchronize into the same PR branch. That
branch can therefore contain multiple active Plan Packages with different
workspace owners. Branch-wide discovery treated repository contents as
execution ownership and returned `MULTIPLE_ACTIVE_EXECUTION_PLANS`, or attached
a synchronized foreign Plan to the current worktree.

### Decision

- A repository and PR may contain any number of active Plan Packages.
- Each workspace has exactly one machine-local Plan binding identified by
  `workspaceId + planId + repository-relative planPath`.
- The binding lives at
  `~/.peers-touch/dev/workspaces/<workspaceId>/workflow/plan-binding.json`.
  It is created explicitly once, is idempotent for the same tuple, and has no
  unbind or rebind operation.
- Starting another Plan requires another worktree and therefore another
  `workspaceId`.
- Local Plan discovery resolves the binding directly. It never scans by branch,
  active status, latest timestamp, directory order, or PR contents.
- Plan manifest, tracked declaration, `active_work`, Session and Context Anchor
  must match the immutable binding. They are projections or consumers, not
  alternative binding owners.
- A Plan-bound workspace cannot publish untracked work.
- CI has no machine workspace binding and must receive an explicit Plan path.
  Missing input returns `EXECUTION_PLAN_INPUT_REQUIRED`.

### Rationale

PR synchronization is source transport, not execution ownership. A
workspace-keyed immutable foreign key keeps parallel worktrees independent
while allowing all of their commits and Plan files to coexist in one branch.
Separating the binding from mutable Plan and declaration state prevents either
artifact from silently switching the workspace owner.

### Alternatives Considered

- Filter a branch scan by `Workspace ID`: rejected because the Plan file would
  still define its own selector and two files could claim the same workspace.
- Use the newest live declaration: rejected because declarations expire and are
  mutable intent, not durable ownership.
- Read `active_work` as the runtime binding: rejected because it is a
  repository/cloud projection and can be synchronized from another worktree.
- Allow explicit rebind after Plan completion: rejected because it makes resume
  history ambiguous; create a new worktree for the next Plan instead.

### Consequences

- Existing active worktrees require one explicit initial `plan-bind`.
- Synchronizing a foreign Plan into a branch has no effect on local execution.
- Deleting or corrupting the bound Plan fails closed; no other Plan is selected.
- Tests must cover same-branch multi-Plan isolation, idempotent same binding,
  rebind denial, missing binding, missing bound Plan, and explicit CI input.

## DWF-D19: Keep Advancing Source Identity Outside Tracked Plan Content

**Status**: accepted
**Date**: 2026-09-18

### Context

`Plan Package.binding.expectedHead` made every authorized checkpoint commit
immediately invalidate the tracked Plan that produced it. Updating that field
inside `plan.md` made the worktree dirty again, so exact-source deployment could
never converge on a clean commit without another self-referential Plan edit.

### Decision

- `Plan Package.binding` contains only immutable `branch`, `workspaceId`, and
  `initialHead`.
- Git owns the current physical HEAD.
- `DevelopmentResourceDeclaration.sourceHead` owns the source identity
  authorized for the current mutation slice.
- `DevelopmentSession.source.commit` owns the clean checkpoint used by a
  runtime or formal proof.
- `active_work.expected_head` remains the durable resume projection and is
  refreshed only after an authorized commit, merge, or rebase.
- Plan validation compares immutable Plan identity to the workspace binding;
  declaration and Session validation compare their source identity directly to
  Git. No component writes an advancing HEAD back into tracked Plan content.
- The old Plan `expectedHead` field and Markdown metadata are rejected and
  removed as a hard cut. No compatibility alias or fallback remains.

### Rationale

Stable intent and advancing source identity have different lifecycles. Keeping
the mutable commit outside the tracked Plan removes the clean-checkpoint
self-reference while preserving fail-closed resume, mutation, and runtime
identity checks at their actual owners.

### Consequences

- Existing live Plan Packages remove `expectedHead` before using the new parser.
- `planctl status` no longer projects an advancing HEAD.
- Dev declarations and Sessions must continue to reject any mismatch with the
  actual worktree HEAD.
- Context Anchor still reports expected/verified HEAD from `active_work` plus
  the worktree verifier, not from `plan.md`.
