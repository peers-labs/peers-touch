# Development Workflow Control Plane - Architecture Decisions

> **Status**: active
> **Created**: 2026-09-13 | **Updated**: 2026-10-01
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
| DWF-D18 | Bind each workspace to one immutable current Plan generation | accepted |
| DWF-D19 | Keep advancing source identity outside tracked Plan content | accepted |
| DWF-D20 | Make an authorized Plan Run continuous across Tasks and agent review gates | accepted |
| DWF-D21 | Keep orchestration and runtime verification host-neutral | accepted |
| DWF-D22 | Separate workflow distribution from consuming-worktree runtime state | accepted |
| DWF-D23 | Keep the internal Development Workflow unversioned | accepted |
| DWF-D24 | Reopen frozen source through one Plan-declared invalidation owner | accepted |
| DWF-D25 | Keep user Skill overlays machine-local and interaction-only | accepted |
| DWF-D26 | Bind workflow enforcement to one immutable conversation execution root | accepted |
| DWF-D27 | Project workflow status through one read-only Workflow Snapshot | accepted |
| DWF-D28 | Require independent current-source Completion Review | accepted |
| DWF-D29 | Derive agent activity from bounded Action Receipts | accepted |
| DWF-D30 | Make documentation claims executable through Workflow Doctor | accepted |
| DWF-D31 | Advance completed workspace bindings by explicit Plan generation | accepted |
| DWF-D32 | Aggregate module impacts before resource acquisition | accepted |
| DWF-D33 | Root workflow authority in one owner binding with assigned child lineage | accepted |

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

### Context

Progress was previously inferred from task, file, or test counts without a stable receiver-visible completion boundary.

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

### Context

Formal Acceptance is broad and costly, while implementation needs a fast exact-source feedback loop before product proof is meaningful.

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

### Context

Development checks and formal Acceptance had separate scenario definitions, allowing the same business behavior to drift between runners.

### Decision

Dev Runner and Acceptance Runner consume one business-owned Journey. Provisioning,
persistence, completeness and publication policy remain runner-specific.

### Rationale

Duplicated smoke and Acceptance scripts drift in action and assertion semantics.

### Alternatives Considered

- Maintain separate Journey definitions per runner: rejected because duplicated behavior and assertions diverge.

### Consequences

Existing Gates that mix behavior with provisioning must separate those concerns.

## DWF-D05: Checkpoint Commits Are Development Infrastructure

**Status**: accepted
**Date**: 2026-09-13

### Context

Remote runtime iteration requires Git-addressable exact source, while a checkpoint must not imply delivery authority.

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

### Context

Machine-local resume records and formal product evidence have different trust, retention, and publication requirements.

### Decision

Development records live under the machine Dev workspace. Evidence Store receives
only formal Acceptance runs.

### Rationale

Resume data and immutable product proof have different retention and trust semantics.

### Alternatives Considered

- Publish every development attempt as Acceptance evidence: rejected because transient or failed iterations are not product proof.

### Consequences

Development records can diagnose but cannot prove product readiness.

## DWF-D07: First Failure And Explicit Budgets

**Status**: accepted
**Date**: 2026-09-13

### Context

Long-running verification matrices continued after an actionable causal failure and obscured the shortest repair path.

### Decision

Every command/Journey has a purpose and timeout. The red loop stops on the first
actionable failure.

### Rationale

One causal failure is more useful than a matrix of downstream failures.

### Alternatives Considered

- Continue every check after failure: rejected because derivative failures add cost without improving diagnosis.

### Consequences

Independent failures may surface after the first failure is fixed.

## DWF-D08: Compact Plan, External Session Ledger

**Status**: accepted
**Date**: 2026-09-13

### Context

Tracked plans accumulated per-attempt logs and narrative state, making current work expensive and ambiguous to recover.

### Decision

Git retains current plan state and durable evidence references; per-attempt logs,
screenshots and events stay under the machine Dev root.

### Rationale

Append-only execution diaries obscure the current dependency frontier.

### Alternatives Considered

- Keep all attempt history in the Plan: rejected because durable intent and transient execution have different lifecycles.

### Consequences

Current snapshots replace prior snapshots. Durable conclusions must be promoted
before session cleanup.

## DWF-D09: `PROVEN` Is A Formal Proof Term

**Status**: accepted
**Date**: 2026-09-13

### Context

Development checks and formal Acceptance reused completion language even when they established different levels of evidence.

### Decision

Development uses `PASS/FAIL/BLOCKED/NOT_RUN` plus verification class. `PROVEN`
is reserved for Acceptance capability interpretation.

### Rationale

A static Gate can pass without proving a Native product Journey.

### Alternatives Considered

- Treat every passing check as proven: rejected because source checks cannot establish a product Journey.

### Consequences

Status renderers always show verification class beside result.

## DWF-D10: Chat Is The Original Control-Plane Pilot

**Status**: accepted
**Date**: 2026-09-13

### Context

The control-plane model needed a representative path spanning UI, native clients, Station, encryption, and multiple actors.

### Decision

Validate Journey and exact-source rules with Direct and three-client Group Chat
before generic rollout.

### Rationale

Chat exercises UI, native, Station, encryption, actor and multi-client boundaries.

### Alternatives Considered

- Generalize before a demanding pilot: rejected because untested abstractions would hide real lifecycle requirements.

### Consequences

Generalization requires measured pilot evidence, not speculative abstractions.

## DWF-D11: Public Resource Declaration Before Development

**Status**: accepted
**Date**: 2026-09-13

### Context

Concurrent worktrees previously had no pre-mutation machine-wide view of source and runtime intent.

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

### Context

Adding orchestration entrypoints for each workflow refinement would split lifecycle authority and user expectations.

### Decision

Upgrade `pt-dev-workflow` as the sole intake-to-close orchestrator. Delegate
execution, defect, runtime, Acceptance and delivery work to specialist Skills.

### Rationale

A second `pt-dev-loop` would create ambiguous entrypoints and split lifecycle truth.

### Alternatives Considered

- Add a second orchestration Skill: rejected because two intake owners create ambiguous state and recovery behavior.

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
  `in_progress -> done`, `+1` closure, post-Next completed count and
  percentage, percentage-point delta, and newly unlocked Task IDs.
- The post-Next percentage is recalculated from integer Task counts. Consumers
  cannot add rounded percentages or treat newly unlocked Tasks as completed.
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
the package identity, binding, and single current Task.

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

## DWF-D18: Bind Each Workspace To One Immutable Current Plan Generation

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
- Each workspace has exactly one machine-local current Plan generation
  identified by
  `workspaceId + generation + planId + repository-relative planPath`.
- The binding lives at
  `~/.peers-touch/dev/workspaces/<workspaceId>/workflow/plan-binding.json`.
  Generation 1 is created explicitly and is idempotent for the same tuple.
  A different tuple cannot replace an unfinished generation.
- Starting another Plan in the same workspace follows DWF-D31's explicit,
  completed-and-quiescent generation advance. There is no unbind operation.
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
- Overwrite or delete the binding after Plan completion: rejected because it
  destroys resume history; DWF-D31 retains immutable generation records.

### Consequences

- Existing active worktrees require one explicit initial `plan-bind`.
- Synchronizing a foreign Plan into a branch has no effect on local execution.
- Deleting or corrupting the bound Plan fails closed; no other Plan is selected.
- Tests must cover same-branch multi-Plan isolation, idempotent same binding,
  unfinished-generation replacement denial, missing binding, missing bound
  Plan, and explicit CI input. DWF-D31 adds advance tests.

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

### Alternatives Considered

- Persist advancing HEAD in tracked Plan content: rejected because every checkpoint would immediately dirty and invalidate its own source.

### Consequences

- Existing live Plan Packages remove `expectedHead` before using the new parser.
- `planctl status` no longer projects an advancing HEAD.
- Dev declarations and Sessions must continue to reject any mismatch with the
  actual worktree HEAD.
- Context Anchor reports expected/verified HEAD from the workspace-owned
  active-work record plus the worktree verifier, not from `plan.md`.

## DWF-D20: Plan Run Is The User-Facing Continuation Boundary

**Status**: accepted
**Date**: 2026-09-19

### Context

DWF-D15 made one Task-closing Progress Slice larger than an individual command,
but `continue` still returned control after each Task. Review prompts were also
handed to the user when repository Skills and accepted sources could decide
them, turning a large accepted Plan into many short interactions. Agents also
re-requested checkpoint, deploy, reset, merge, or similar permission solely
because the operation category was sensitive, even when the user or accepted
Plan had already granted the exact operation.

### Decision

- One explicit `continue`, `resume`, `execute the plan`, or equivalent request
  authorizes one Plan Run over the current Plan's accepted scope and
  authorization envelope.
- Dev Workflow repeatedly schedules one Task-bounded Goal Slice, executes it,
  runs agent review and remediation, closes or parks the Task, activates a
  dependency-ready successor and continues.
- Goal Slice remains a single-Task recoverable scheduler unit. It is not the
  user interaction boundary.
- Context Anchor may report at meaningful boundaries, but it does not request
  confirmation or pause an authorized Plan Run.
- An exact authorization granted by the user or recorded as allowed in the
  accepted Plan remains valid for the full Plan Run. Task/Goal transitions,
  retries, context compaction, and host changes do not consume it.
- A sensitive operation category never overrides an existing exact grant.
  `OPERATION_AUTHORIZATION_REQUIRED` is legal only when the action is denied or
  outside every explicit grant. After admission, a permission question is legal
  only when the attempted operation returns an actual external permission,
  credential, or scope failure.
- Plan existence and public declarations do not imply authorization; only
  explicit user grants and the Plan's explicit authorization fields do.
- Human escalation is limited to denied or missing authority, destructive or
  irreversible operations, unresolved product/architecture/security/privacy/
  compatibility/rollout choices, unavailable external resources or
  fixed-point exhaustion.

### Rationale

A Plan Run preserves user intent across bounded Task slices while retaining owner-controlled checkpoints and stop conditions.

### Alternatives Considered

- Pause for confirmation after every Task or review: rejected because it repeats already granted authority without improving safety.

### Consequences

- `pt-dev-workflow` owns the Plan Run loop and successor activation.
- `pt-goal-orchestrator` schedules one Task at a time.
- Ordinary review findings, failed checks, mechanical Plan repairs, Task
  handoff and non-destructive retries remain internal Run work.
- Dev Workflow and Guardian must reject repeat-confirmation behavior for an
  already-authorized operation and preserve the evidence source of the grant.
- Durable Plan, Task, Session, declaration and workspace active-work state
  remain the recovery inputs across context windows.

## DWF-D21: Host Tools Are Replaceable Transport Adapters

**Status**: accepted
**Date**: 2026-09-19

### Context

The Development Workflow named a TRAE-specific scheduler and debugger path as
mandatory. That made project progress depend on one IDE host even though the
repository already owns stronger Make, Session, Journey, WebDriver, Appium and
Acceptance contracts.

### Decision

- `pt-goal-orchestrator` is the single host-neutral scheduler.
- `pt-dev-runtime-handoff` owns runtime launch, product interaction policy,
  deterministic Journey interpretation, Session result commit and cleanup.
- Repository-native drivers are preferred and determine proof strength.
- TRAE, Cursor, Codex and future hosts are optional narrow adapters selected
  only after scheduling and Guardian admission.
- An adapter cannot mutate Plan, Task, Session, active-work state, evidence,
  authorization, scheduling or Journey assertions.
- Missing optional worker capability degrades to safe serial/hybrid execution.
  Missing required UI capability parks only its dependent Task when no
  repository-native driver exists.
- A failed host side effect receives one idempotent cleanup attempt and then a
  bounded quarantine; it cannot recursively retry cleanup or block unrelated
  ready Tasks.
- Deterministic functional PASS and the matching Session transition are
  committed through one owner-controlled result slice.

### Rationale

Host-neutral owners preserve workflow semantics across IDEs while narrow adapters keep optional automation replaceable.

### Alternatives Considered

- Make one IDE scheduler authoritative: rejected because repository workflows must remain portable and independently verifiable.

### Consequences

- The old `pt-trae-goal-orchestrator` source is deleted after references move.
- Host adapters stay intentionally narrow and capability-discovered.
- Rollout is worktree-scoped semantic integration followed by source and host
  projection audit, never raw cross-worktree patching.

## DWF-D22: Workflow Distribution Is Not Runtime-State Ownership

**Status**: accepted
**Date**: 2026-09-19

### Context

`peers-dev-workflow` is the development and distribution source for workflow
scripts and Skills. Treating that repository, or a shared
`project_memory.md ## active_work` table, as the mutable progress owner would
make independent worktrees overwrite one another.

### Decision

- `peers-dev-workflow` owns canonical source, tests, rollout control and release
  metadata only.
- Every consuming worktree executes the distributed implementation in its own
  canonical root and derives its own `workspaceId`.
- Each workspace exclusively writes
  `~/.peers-touch/dev/workspaces/<workspaceId>/workflow/active-work.json`.
- The record is revisioned, CAS-protected, digest-protected and derived only
  from Plan binding, Plan/Task, declaration, Session and Git owners.
- Project memory, Context Anchor and Peers Dev are read-only aggregators. No
  normal runtime path writes a shared cross-workspace progress table.
- Legacy Markdown is readable only by the bounded Plan migration flow and has
  no compatibility writer.

### Rationale

Canonical source can be shared, but mutable execution state must remain isolated by consuming workspace identity.

### Alternatives Considered

- Store all worktree progress in one shared project record: rejected because concurrent worktrees would overwrite each other.

### Consequences

- Concurrent Goals in different worktrees never write the same active-work
  file.
- Corruption in one workspace record is reported for that workspace and does
  not hide healthy workspaces.
- Rollout tests must prove the same distributed code derives disjoint paths in
  at least two consuming roots.

## DWF-D23: The Internal Development Workflow Is Unversioned

**Status**: accepted
**Date**: 2026-09-19

### Context

Development Workflow docs claimed `v1.3/v1.4`, Plan Packages claimed
`schemaVersion: 2`, and rollout receipts claimed `schemaVersion: 3`. These
numbers described unrelated file revisions but appeared to be competing
versions of one unstable internal workflow.

### Decision

- The internal Development Workflow has no project-stage or release version.
- Git history and accepted `DWF-D*` decisions identify the current state.
- Plan Package, Task Slice, Acceptance Execution and rollout receipt contracts
  use `kind` plus one strict current shape and contain no version field.
- Existing machine Session, ledger, registry and active-work format guards may
  remain while they participate in live digest/replay chains. They are
  integrity details, not workflow versions, and must not be surfaced as one.
- External protocol, framework, package and formal Acceptance evidence versions
  retain their own independently governed semantics.

### Rationale

A single current internal contract avoids compatibility machinery for development-only formats that are deployed atomically.

### Alternatives Considered

- Version every internal workflow artifact independently: rejected because unrelated version numbers imply unsupported compatibility promises.

### Consequences

- Workflow documents no longer publish `vN` metadata.
- New workflow contracts cannot introduce `version`, `schemaVersion`,
  `_v2`, `_v3`, `next-gen` or equivalent labels.
- A future incompatible workflow change replaces the current internal shape
  atomically instead of adding a parallel workflow version.

## DWF-D24: Reopen Frozen Source Through One Plan-Declared Invalidation Owner

**Status**: accepted
**Date**: 2026-09-21

### Context

A functional Task can expose a source defect after its source-owning predecessor
has completed. Reopening by hand would make the Plan manifest, immutable
evidence, Session, declaration, and workspace projection disagree. The generic
blocked/reactivate transition cannot select a completed predecessor or
invalidate a transitive functional closure.

### Decision

- A Plan that supports source reopening declares one closed
  `Source Invalidation Policy` block with one `sourceOwnerTaskId` and one or
  more `rootTaskIds`.
- `planctl invalidate-source` accepts only the current failed Task and its first
  failure reference. It derives the source owner and complete transitive
  invalidation closure from the Plan policy.
- The caller must quiesce and release the failed Session, runtime resources,
  leases, and declaration through their existing owners before invalidation.
- The command atomically returns every Task in the affected closure to
  `pending`, makes the completed source owner the sole `in_progress` Task, and
  clears package exhaustion.
- Before Plan replacement, the command creates one immutable machine-local
  proof containing the prior manifest digest and every invalidated durable
  evidence reference. Evidence files are never rewritten or relabeled.
- Plans without the policy fail closed. Callers cannot supply a source owner,
  invalidation root, or affected Task list.

### Rationale

The Plan remains the single source of dependency and invalidation scope, while
runtime cleanup and evidence stores retain their existing owners. The
transition is explicit and recoverable without introducing a second Plan
implementation or allowing arbitrary lifecycle rewrites.

### Alternatives Considered

- Reopen completed Tasks manually: rejected because Plan, Session, declaration, and evidence owners would diverge.

### Consequences

- Source-owning Tasks may be replayed only after all failed runtime ownership is
  quiescent.
- A reopened source owner must produce a new checkpoint and all source-bound
  runtime activation required by its Task.
- Old evidence remains immutable history but cannot satisfy the reopened
  closure.

## DWF-D25: User Skill Overlays Are Machine-Local Interaction Policy

**Status**: accepted
**Date**: 2026-09-21

### Context

`pt-ew` embedded one contributor's English-learning policy in a canonical
project Skill. Every consumer therefore received translation, correction, and
English-response behavior even when they did not want it. Adding user files to
the canonical Skill projection would create the opposite problem: machine
preferences would become repository content or host-specific state.

### Decision

- `pt-ew` is a shared Overlay host that always delegates project routing to
  `pt-god-view`.
- Optional user behavior is installed into a machine-local registry under
  `~/.peers-touch/dev/skill-overlays/`.
- Installation validates a closed unversioned manifest, rejects symlinks,
  copies the source into a digest-addressed immutable store, and atomically
  updates the registry.
- The registry is the only enable/disable source. Runtime resolution verifies
  the installed digest and returns enabled overlays in deterministic priority
  and name order.
- Overlays may transform interaction wording, language, response structure, or
  coaching only. They cannot alter task intent, Plan scope, authorization,
  owner selection, execution, verification, Acceptance, or stop conditions.
- Canonical `make skills` remains limited to repository-owned
  `tooling/skills/pt-*` and supported host hooks; user overlays never enter
  `.trae/skills`, `.cursor/skills`, or `.agents/skills`.
- Overlay resources are treated as data. The host reads the resolved
  `SKILL.md` and never executes scripts or hooks shipped by an overlay.

### Rationale

This keeps shared methodology deterministic while allowing opt-in personal
work habits. A content-addressed installed copy prevents later edits or
symlink retargeting in the source directory from changing active behavior
without an explicit replacement operation.

### Alternatives Considered

- Keep English behavior in canonical `pt-ew`: rejected because personal policy
  becomes mandatory for every user.
- Copy local overlays into the canonical or host Skill tree: rejected because
  it mixes ownership and makes project rollout machine-dependent.
- Resolve the mutable source directory on every turn: rejected because runtime
  behavior could change after installation without registry mutation.

### Consequences

- `pt-ew` has passthrough behavior when no overlay is enabled.
- Local overlay installation has its own control command and lifecycle.
- Existing English behavior moves entirely to the external `english` Overlay;
  no canonical compatibility copy remains.
- Malformed registry entries or modified installed copies fail closed instead
  of silently disabling user policy.

## DWF-D26: Bind Workflow Enforcement To The Conversation

**Status**: accepted
**Date**: 2026-09-23

### Context

The first IDE guard derived the active worktree from every hook payload's
`cwd`. That value describes the current operation and can legitimately point
at a sibling worktree during read-only investigation. Reusing it as authority
let one chat silently change write identity. Regex command classification also
allowed shell composition to escape the intended admission boundary, and
`SessionStart` was treated as mandatory even though Cursor Cloud does not
provide it.

### Decision

- One stable host conversation ID maps to one machine-local, create-once
  `executionRoot` binding.
- `SessionStart` and prompt hooks only prewarm. The first blockable
  `PreToolUse` atomically creates or reads back the binding.
- The installed project integration is the preferred root hint. Tool paths and
  command working directories are separate `subjectRoot` inputs and never
  rebind the conversation.
- Cross-worktree reads are allowed. Every cross-worktree write is denied before
  workflow state inspection.
- Shell commands are parsed into a Tool Intent AST. Multiline, substitution,
  unknown operators, and parse failures fail closed; regular expressions do
  not decide command authority.
- The Kernel validates declaration, immutable Plan binding, active-work,
  Development Session, Git identity and declared source scope without changing
  those owners.
- A host without a stable conversation ID or blockable pre-tool hook is
  explicitly `OBSERVE_ONLY`.
- Stop renders a machine-owned Context Anchor receipt. Active Plans continue;
  terminal or blocked conversations receive a create-once release receipt only
  after the exact rendered Anchor is observable in the response/transcript.
- TRAE, Cursor and Codex adapters only normalize payloads and render native
  responses. Cursor project hooks set `failClosed: true`.

### Rationale

Conversation-bound execution authority prevents command working directories from silently changing the active worktree or workflow owner.

### Alternatives Considered

- Rebind from each tool call cwd: rejected because legitimate cross-worktree reads could change mutation authority.

### Consequences

- Conversation binding is not a worktree lease and does not serialize other
  agents or worktrees.
- The old `workflow-guard.mjs` and cwd-derived authority path are deleted with
  no compatibility wrapper.
- Machine-local conversation records contain the hashed host conversation key,
  never the raw conversation ID.
- Core owner commands remain the final state-transition authority; the Kernel
  is an earlier admission and handoff-completeness boundary.

**Supersession**: DWF-D33 replaces this decision's identity, lifecycle,
review-selection, and rollout contracts. DWF-D26 remains registered only
because immutable completed Plan Packages reference its original safety
boundary.

## DWF-D27: Project Workflow Status Through One Snapshot

**Status**: accepted
**Date**: 2026-09-26

### Context

CLI, UI, and handoff paths independently joined workflow state and could report contradictory progress or freshness.

### Decision

One read-only Workflow Snapshot joins Plan, Task, Session, declaration,
active-work, Git, runtime, review, and Action Receipt owner state. CLI, Context
Anchor, Workflow Doctor, and Peers Dev consume that projection instead of
reimplementing joins.

### Rationale

Independent status joins produced contradictory progress and allowed logs or
prose to stand in for owner state.

### Alternatives Considered

- Keep one state join per consumer: rejected because projection rules and failure semantics would continue to drift.

### Consequences

The Snapshot never repairs or advances state. Progress remains Task closure
progress from the Plan; activity and freshness remain diagnostic projections.

## DWF-D28: Completion Requires Independent Current-Source Review

**Status**: accepted
**Date**: 2026-09-26

### Context

Passing implementation checks did not independently verify that the current source satisfied every declared obligation and deletion.

### Decision

Every Task completion and final Plan completion requires a create-once
Completion Review receipt with `PASS`, produced by a reviewer context distinct
from the implementation context and bound to current source and obligation
digests.

### Rationale

Successful implementation checks prove what was exercised, not that all
required work, deletions, and claim boundaries were included.

### Alternatives Considered

- Let the implementation context self-approve completion: rejected because it cannot provide independent coverage judgment.

### Consequences

Missing, failed, same-context, or stale receipts reject lifecycle completion.
Source or obligation drift reopens the affected closure through the existing
source-invalidation owner.

## DWF-D29: Derive Agent Activity From Bounded Action Receipts

**Status**: accepted
**Date**: 2026-09-26

### Context

Process presence and chat narration could not distinguish productive execution from waiting, repetition, or drift.

### Decision

The Workflow Kernel emits redacted, bounded Action Receipts. The Workflow
Snapshot reduces those receipts into working, waiting, blocked, stalled,
looping, drift, and complete projections.

### Rationale

Process lists and chat prose cannot reliably distinguish useful progress from
repetition or inactivity.

### Alternatives Considered

- Infer activity from processes or prose: rejected because neither is bounded, structured, or owner-authenticated.

### Consequences

Receipts never contain raw prompts, unrestricted tool arguments, or secrets.
Activity is diagnostic and cannot advance Plan, Task, Session, or Acceptance
state.

## DWF-D30: Make Workflow Documentation Executable

**Status**: accepted
**Date**: 2026-09-26

### Context

Human workflow documentation described operational guarantees that could drift from repository-enforced behavior.

### Decision

`docs/global/workflow.md` is the concise human operating guide. Every public
operational promise maps to a `workflow-doctor` check or is explicitly marked
as a non-machine policy.

### Rationale

A guide that describes absent hooks or unenforced gates creates false trust.

### Alternatives Considered

- Rely on manual documentation review: rejected because absent enforcement can still appear trustworthy.

### Consequences

Documentation drift fails the Peers Dev product Gate. Architecture documents
retain design detail and do not duplicate the operating manual.

## DWF-D31: Advance Completed Workspace Bindings By Plan Generation

**Status**: accepted
**Date**: 2026-09-26

### Context

DWF-D18 correctly removed branch-wide Plan discovery, but its permanent
workspace-to-Plan restriction made a long-lived canonical owner worktree
single-use. That rule encouraged an Agent to create a new worktree merely to
start the next owner Plan, contradicting the explicit worktree authorization
boundary.

### Decision

- A workspace binding is immutable for the lifetime of one active Plan
  generation.
- `plan-bind` creates generation 1 and remains idempotent only for the same
  `planId + planPath`.
- A different Plan never replaces an active, blocked, prepared, or otherwise
  unfinished generation.
- An explicit owner command may advance `N -> N+1` only when the current Plan is
  `completed`, no live Development declaration or active-work projection
  remains, and the workspace holds no runtime lease.
- Every generation is retained as an immutable machine-local record; the
  current pointer changes atomically with generation compare-and-swap.
- A new worktree is created only for user-selected isolation or concurrency.
  An Agent must not create one to bypass a binding or lifecycle failure.

### Rationale

Plan ownership must remain fail-closed during execution without turning a
stable owner worktree into disposable infrastructure.

### Alternatives Considered

- Keep one permanent Plan per workspace: rejected because canonical owner
  worktrees necessarily execute sequential maintenance Plans.
- Delete or overwrite `plan-binding.json`: rejected because it destroys
  lineage and permits silent reassignment.
- Auto-select the next repository Plan: rejected because source contents are
  not execution ownership.

### Consequences

- Existing bindings are generation 1 on read and migrate only during an
  explicit successful advance.
- Callers must provide the expected current generation.
- Old generation declarations and Sessions remain historical records and
  cannot authorize mutation after the current pointer advances.
- Binding generation and quiescence checks are covered by focused concurrency,
  migration, tamper, and resource-release tests.

## DWF-D32: Aggregate Module Impacts Before Resource Acquisition

**Status**: accepted
**Date**: 2026-09-30

### Context

Domain Skills can identify their own affected components and proof
invalidation, but they cannot see the complete Plan dependency graph, machine
capacity, or resource demand from other modules. Letting each module directly
select deployment targets, accounts, services, clients, devices, Fixtures, or
automation sessions creates duplicated provisioning and cross-module
deadlocks.

### Decision

- Each affected module emits one closed `ModuleImpact` containing change kinds,
  module dependencies, focused checks, logical target selectors, Journeys,
  Gates, proof invalidation, and optional logical resource requirements.
- `pt-dev-workflow` is the sole Plan-level aggregator. It resolves target
  dependencies, execution waves, requirement deduplication, and peak concurrent
  capacity into one `PlanResourcePlan`.
- Concrete resource selection uses owner-supplied inventory and
  source/artifact/runtime/health identity to choose
  `REUSE | RESTART | BUILD | PROVISION`.
- Mandatory demand is solved across each complete execution wave with
  deterministic rematching. When total capacity cannot satisfy every target,
  constrained targets are considered before flexible targets.
- The idempotency key is
  `planId + lifecycleScope + requirementId + compatibilityKey`.
- Resource claims for one target are published to the existing machine work
  ledger all-or-none and in canonical order. A capacity conflict parks only
  that target and its dependents; independent targets remain runnable.
- Resource-plan persistence uses the existing workspace lifecycle lock and an
  explicit non-authorizing `RESERVING -> COMMITTED` transition so receipt and
  declaration updates are recoverable after interruption. The reserving receipt
  keeps prior and proposed planner claims until commit, preventing provenance
  loss during replacement.
- Physical lease admission checks the matching committed resource-plan fence
  for planner-owned claims. Claims that predate planning retain explicit base
  provenance and are never removed or silently adopted by a later plan. A
  shared `resource.plan:<workItemId>` declaration marker makes a missing
  receipt fail closed.
- The resource-plan receipt carries a monotonic fencing token. Runtime Owner
  results must match its source identity, allocation digest, owner, resource
  identity, exact idempotency requirement keys, and expected digests.
- Local Dev and Acceptance Suite Runtime remain the physical lifecycle owners.
  The plan does not start, log in, reset, clean, or quarantine resources.
- Business Gates are attach-only and consume the prepared runtime manifest.

### Rationale

The workflow needs one cross-module view to avoid duplicate allocation and
unnecessary deployment, while domain-specific impact knowledge and physical
resource lifecycle must remain with their existing owners.

### Alternatives Considered

- Let every module Skill provision its own resources: rejected because it
  creates parallel orchestration and cannot compute aggregate capacity.
- Use one global execution lock: rejected because unrelated targets and Plans
  would block each other.
- Let each business Gate build and provision: rejected because repeated Gates
  duplicate setup and cannot safely reuse Suite resources.
- Treat declarations as physical leases: rejected because intent, process
  possession, health, and cleanup have different owners.

### Consequences

- Module Skills no longer emit concrete deployment targets.
- Resource planning extends the existing `dev-work` owner and machine ledger;
  no second workflow Skill or scheduler is introduced.
- Fine-grained declaration conflicts and Runtime Owner leases replace a global
  lock. The acquisition contract forbids hold-and-wait.
- Quarantined resources remain unavailable until their physical owner records a
  valid replacement or recovery; the workflow cannot clear quarantine.
- Planner tests must cover multi-module closure, account/service reuse,
  parallel capacity shortage, all-or-none target claims, fencing, quarantine
  replacement, and cross-Plan conflicts.

## DWF-D33: Root Workflow Authority In One Owner Binding With Assigned Child Lineage

**Status**: accepted
**Date**: 2026-10-01

### Context

TRAE exposes a stable visible-chat `chat_session_id` and may expose a different
`session_id` for reviewer, retry, or subtask execution. The existing generic
adapter treated `conversation_id`, `conversationId`, `session_id`, and
`sessionId` as interchangeable owner keys. Every internal execution could
therefore create another peer owner binding for the same worktree.

The binding store considered every record without a release receipt active.
Completion Review first tried a recent Action Receipt and then fell back to a
global `candidates.length === 1` check. In the reproduced high-chat workspace,
twenty old records remained active by that definition even though most latest
RUNNING receipts had expired. The review path was blocked by persistence
history rather than a live ownership conflict.

### Decision

- A visible development chat owns exactly one immutable OWNER binding. TRAE
  derives it only from `chat_session_id`; `session_id` never creates owner
  authority. Cursor and Codex use only their documented host-specific fields.
- Internal WORKER and REVIEWER sessions require a create-once assignment from
  an existing OWNER or child. The assignment records role, root and parent
  binding digests, Development Session identity, operation identity, and a
  bounded lease.
- Child claim binds a hashed execution-session identity to one assignment.
  Child liveness comes only from assignment/lease/terminal receipts. OWNER
  liveness has no generic TTL.
- One pure `BindingProjection` joins host identity, owner or child binding,
  role, lineage, release state, execution root, and per-event subject/tool/
  target roots. Hook context, status, readiness, handoff, Stop, Action Receipt,
  worker result, and Completion Review consume that projection.
- Completion Review selects the exact OWNER or assigned REVIEWER from the
  current owner-command Action Receipt. There is no worktree-wide active
  binding fallback.
- `CROSS_WORKTREE_WRITE_DENIED` remains unchanged: all lineage members inherit
  the OWNER execution root, may read sibling roots, and cannot write them.
- TRAE multi-root installations have one workspace bootstrap hook. That hook
  dispatches to the selected canonical integration instead of installing
  competing owner hooks in every worktree.
- Rollout is a hard cut. After proving no live declaration, child assignment,
  or workflow action exists on the machine other than the current exact
  OWNER-bound installer command, the installer deletes
  `~/.peers-touch/dev/conversations/` and every
  `~/.peers-touch/dev/workspaces/*/workflow/actions/` directory before
  installing the new bootstrap. Plan/Session/Review/Acceptance stores remain.
  No legacy schema reader, importer, alias, fallback, or dual-write is allowed.

### Rationale

The visible chat is the authorization boundary; internal execution sessions are
bounded delegates. Persisting this distinction prevents stale review activity
from becoming owner authority and makes completion identity exact instead of
heuristic.

### Alternatives Considered

- Treat every host `session_id` as an owner: rejected because retries,
  reviewers, and subtasks create false peer owners.
- Keep worktree-wide enumeration but add TTL: rejected because OWNER
  authorization must not silently expire and history is not identity.
- Accept old and new schemas during migration: rejected because it preserves
  ambiguous ownership and leaves two active truth models.
- Add adapter routes around Completion Review only: rejected because status,
  handoff, Stop, and worker attribution would remain inconsistent.

### Consequences

- Internal worker/reviewer launchers must issue and terminalize assignments.
- A child without a valid assignment cannot claim independent worker or
  reviewer authority.
- Machine-local conversation and Action Receipt history is intentionally
  discarded at rollout; closed Plan/Session/evidence owners remain unchanged.
- Multi-root bootstrap installation is a separately declared cross-root
  rollout operation and is not performed implicitly by source implementation.
- Tests must cover one owner plus two child roles, nested parent linkage,
  expired and terminal child behavior, compaction/task switching, subject-root
  projection, exact Completion Review selection with twenty stale children,
  and wrong-binding status/final claims.
