---
name: pt-dev-workflow
description: >-
  Runs one non-trivial Peers-Touch development lifecycle from verified intake
  through resource declaration, stage dispatch, product-functional proof,
  Acceptance promotion, delivery, and resource release.
stage: orchestrator
requires: []
produces: ["closed Development Run", "durable workflow state", "bounded delivery claim"]
---

# Dev Workflow

This is the single entry point for non-trivial Peers-Touch development.

It is the application service for one Development Run. It coordinates owners,
state transitions, authorization, and cleanup. It does not absorb specialist
methodologies.

Architecture source:
`docs/architecture/engineering/development-workflow/README.md`.

## Responsibility Boundary

| Concern | Owner |
|---|---|
| Route into this workflow | `pt-god-view` |
| Product Journey and visible states | `pt-product-design-methodology` |
| Architecture boundaries and contracts | `pt-architecture-design-methodology` |
| Vertical dependency plan model | `pt-architecture-execution-methodology` |
| Stable Plan persistence, amendment logging, and optional owner-authorized mount | `pt-plan-and-document` |
| Ready/Parked selection and concurrency lanes | `pt-goal-orchestrator` |
| Whether a proposed action may run | `pt-execution-plan-guardian` |
| ExecutionRun/Task/Session/workspace active-work mutation order | `pt-dev-workflow` through their owning commands |
| Domain-specific change classification | Module Skills emitting standard `ModuleImpact` |
| Cross-module target and resource aggregation | `pt-dev-workflow` through `dev-resources-prepare` |
| Physical build, restart, provision, health and quarantine | Local Dev or Acceptance Suite Runtime owner |
| Runtime launch, Journey operation and functional result commit | `pt-dev-runtime-handoff` |
| Optional host tool transport | detected `pt-*-host-adapter` after Guardian admission |
| Status projection | read-only `pt-context-anchor` |
| Formal product proof | Acceptance owning Skills |
| Delivery review | commit, PR, quality, completion, and review Skills |

The scheduler proposes **what runs**. The Guardian decides **whether that
proposed action may run**. Dev Workflow performs the allowed action and
persists the result. No other Skill may duplicate this RUN loop.

## Invoke When

- Starting or resuming a non-trivial implementation, migration, refactor, bug
  closure, verification, or delivery.
- A read-only discussion is about to perform its first write or acquire a
  runtime resource.
- A tracked Development Run must continue, close, or recover.

Do not use for status-only projection or a trivial text-only correction.

## Run Lifecycle

Tracked work:

```text
INTAKE
  -> DECLARED
  -> PRODUCT
  -> DESIGN
  -> PLAN_MODEL
  -> PLAN_PERSISTED
  -> EXECUTING
  -> FUNCTIONAL_PASS
  -> ACCEPTANCE
  -> DELIVER
  -> RELEASED
```

Explicit standalone no-Plan work:

```text
INTAKE
  -> DECLARED
  -> EXECUTING
  -> FOCUSED_VERIFICATION
  -> REVIEW
  -> DELIVER
  -> RELEASED
```

A stage may be skipped only when its owning Skill proves it is unnecessary.
Never enter broad Acceptance while a required Journey is not
`FUNCTIONAL_PASS`.

Explicit user instructions such as `no plan`, `不要 plan`, or equivalent are
an intake constraint, not a stage suggestion. They forbid PLAN modeling,
`pt-plan-and-document`, Plan or Task Slice creation, PlanMount,
ExecutionPlanSnapshot, ExecutionRun, Development Session, active-work, and
Context Anchor state for the current request. If execution lacks an accepted
product or architecture decision, report that precise boundary instead of
creating a Plan.

## Plan Run Authorization

An explicit `continue`, `resume`, `execute the plan`, `finish the plan`, or
equivalent request starts one **Plan Run** over the mounted snapshot's accepted scope
and authorization envelope.

The Plan Run is the user-facing execution horizon. It may cross Task closures,
Goal Slices, internal stage reviews, successor activation, and context
compaction without another confirmation. It does not expand product,
architecture, Plan, source, runtime, or operation authorization.

Already-authorized operations execute directly:

- an exact grant from the user or the accepted Plan's explicit
  `authorization` envelope remains valid throughout the Plan Run;
- Task handoff, context compaction, retries, and a change of agent host do not
  consume or invalidate that grant;
- an operation category such as commit, deploy, reset, merge, or release is not
  by itself a reason to ask again when the exact operation is already granted;
- mere Plan existence, a declaration, or an unrelated prior command is not an
  authorization grant.

Stop and ask the user for the explicit approval of every newly generated Plan
North Star. After that approval, ask again only when the remaining frontier
requires:

- an operation outside or explicitly denied by both the user's exact grant and
  the accepted Plan authorization envelope;
- an admitted operation that was attempted and returned an actual external
  permission, credential, or scope failure with no legal in-scope remediation;
- a destructive or irreversible operation, including force push, history
  rewrite, merge, release, production mutation, data deletion/reset,
  environment creation, permission expansion, version/schema bump, worktree
  add/remove/prune, or secret access, only when its exact grant is absent;
- a product, architecture, security, privacy, compatibility, or rollout
  choice that would change, weaken, or abandon the accepted North Star and
  cannot be resolved from accepted sources;
- an unavailable external resource or credential; or
- fixed-point exhaustion after every dependency-ready Task and legal
  remediation has been drained.

For authorization questions specifically, only an out-of-envelope action or an
observed external permission failure may trigger user confirmation. Do not ask
preemptively because an operation belongs to a sensitive category.

Task closure, review findings, failed checks, source-backed fixes, mechanical
plan repair, successor activation, ordinary retries, and Context Anchor output
are internal Run work, not user approval boundaries.

## 1. Intake And Binding

Before mutation:

1. When the Workflow Kernel reports `ENFORCED`, consume its canonical
   `BindingProjection` and immutable OWNER `executionRoot`; tool `cwd`, target
   paths, Skill paths, Plan paths and sibling repositories cannot replace it.
   TRAE owner identity comes only from `chat_session_id`; internal
   `session_id` values do not create peer owners. WORKER/REVIEWER authority
   requires an assigned, live child projection with exact root/parent lineage.
   The verified root ID is machine-local provenance and must appear in current
   worktree/declaration status; never substitute the Git actor.
2. In `OBSERVE_ONLY`, bind one explicitly selected worktree. Never infer it
   from a Skill path, branch name, Plan path, or nearby repository.
3. Capture and verify canonical root, branch, `workspaceId`, initial HEAD,
   and expected HEAD with `tooling/scripts/verify-worktree-binding.py`.
   Unrelated sibling worktree inventory is not execution identity.
4. Resolve the workspace's current Project Ledger PlanMount when present.
   Repository or PR contents may contain many Plans; only the mounted
   `planId + planPath` and current ExecutionRun snapshot belong to this
   workspace. Never scan by branch. Do not rebind or unmount it; ordinary Plan
   amendments retain the same mount and run.
5. Resolve user intent, authorization envelope, existing accepted sources, and
   `planPolicy=tracked|standalone`. Explicit no-Plan intent fixes
   `planPolicy=standalone` before task-size or stage classification.
6. If explicit no-Plan intent conflicts with a live PlanMount, return
   `PLAN_POLICY_CONFLICT`; only an explicit owner action may release the mount.
   An unmounted standalone request must remain unmounted.
7. Reconcile the previous Development Run before admitting a new one. A
   `DEVELOPMENT_CLOSE_IN_PROGRESS`, terminal live PlanMount, released
   declaration with remaining active-work, or orphan mount is internal close
   work: resume `make dev-close` with the exact work item/mode/reason. Deleted
   worktrees use the owner-authorized `workspaceId + mountId` recovery path.
   Do not ask the user to release individual records by hand.
8. Preserve unrelated dirty files. Never switch branches or worktrees
   implicitly. Never create a worktree to bypass a Plan mount, lifecycle
   state, or resource conflict; only an explicit user-selected isolation or
   concurrency operation authorizes worktree creation. For that authorized
   operation, use:

   ```bash
   make worktree-create \
     WORKTREE=<absolute-path> \
     BRANCH=<new-branch> \
     PURPOSE='<why this worktree exists>' \
     [START=<ref>]
   ```

   Raw `git worktree add` is not an Agent creation path because it cannot write
   the target workspace's immutable main-session provenance.

Missing identity returns `WORKTREE_IDENTITY_UNAVAILABLE`; drift returns
`WORKTREE_IDENTITY_MISMATCH`.

## 2. Public Resource Declaration

Before the first write or runtime acquisition:

```bash
make dev-start \
  WORK_ITEM=<stable-id> \
  PURPOSE='<short purpose>' \
  SOURCE_CLAIMS='<shared-read|exclusive-write>:<repo-path>[;...]' \
  RUNTIME_CLAIMS='<shared|exclusive>:<kind>:<resource-id>[;...]' \
  [PLAN=<repository-relative-package-plan.md>] [TASK=<current-task-id>] \
  [JOURNEY=<id>] [SESSION=<id>]
```

Rules:

- Run `make dev-check WORK_ITEM=<id>` before each mutation slice.
- A tracked run must publish `PLAN` and `TASK`; the declaration validates the
  current Plan digest, workspace PlanMount and ExecutionRun, expected
  HEAD, and single current Task. An unmounted workspace may publish untracked
  pre-Plan or explicit standalone work; standalone declarations omit `PLAN`,
  `TASK`, and Development Session. A mounted workspace cannot publish a
  locator-less declaration.
- Run `make dev-update` before expanding scope/resources and after Task handoff.
- Before a long action crosses half of the current heartbeat-to-expiry window,
  run `make dev-heartbeat`; heartbeat extends liveness but cannot change source,
  scope, or Plan identity.
- After an authorized commit, merge, or rebase changes source HEAD, run
  `make dev-update ... PLAN=<path> TASK=<id>`, then `make dev-check` before the
  next mutation or runtime action. The machine registration does not store
  HEAD; Development declaration and Plan/Session source identities remain the
  mutation fence.
- Different worktrees on different branches may overlap with
  `SOURCE_OVERLAP_WARNING`; same-workspace overlap, same-branch parallel
  writes, and exclusive runtime overlap return
  `RESOURCE_DECLARATION_CONFLICT`.
- A declaration is public intent, not a runtime lease or operation
  authorization.
- New declarations copy the current verified `WorkflowOwnerReference`;
  Session and active-work preserve it, and Workflow Snapshot reports both the
  current owner and the worktree creator.
- `dev-start` and `plan-mount` reject an unfinished
  `DevelopmentCloseReceipt`; resume its exact close before starting new work.
- `peers-dev-workflow` is the canonical source and rollout owner only. Every
  installed copy executes from the conversation-bound worktree. Workflow owner
  state remains worktree-local; the Kernel writes only its separate
  machine-local binding/Anchor/release receipts.

## 2.1 Plan Resource Preparation

Before the first runtime acquisition, collect one standard `ModuleImpact` from
each affected module. A Module Skill classifies its own paths, proof
invalidation, focused checks, logical target selectors, Journeys, Gates, and
optional resource requirements. It must not select concrete resources or issue
build, deploy, login, reset, or provisioning commands.

Dev Workflow combines those outputs with the current Plan target graph and
Runtime Owner inventory:

```bash
make dev-resources-prepare \
  WORK_ITEM=<id> \
  RESOURCE_INPUT=<plan-resource-request.json>
```

The preparation owner:

1. validates every `ModuleImpact` and its dependency closure;
2. resolves target dependencies into deterministic execution waves;
3. merges compatible requirements and computes peak concurrent capacity;
4. selects `REUSE | RESTART | BUILD | PROVISION` from source, artifact,
   runtime and health identity;
5. parks only targets whose mandatory capacity is unavailable;
6. atomically updates the existing declaration with all concrete claims for
   each ready target, or none of that target's claims;
7. writes a source-bound `PlanResourcePlan` under the current work item's
   machine-local workflow directory.

The idempotency key is
`planId + lifecycleScope + requirementId + compatibilityKey`. Repeating the
same input reuses the same resource-plan fencing token. Changed input advances
the token; stale Runtime Owner results are rejected. Receipt and declaration
updates share the workspace lifecycle lock; only `COMMITTED` receipts authorize
Runtime Owner results, while an interrupted `RESERVING` receipt is retried.
Physical lease admission applies the same check for planner-owned claims;
pre-existing declaration claims retain separate base provenance.

All claims use canonical key order. A target never holds a partial reservation
while waiting for another resource. Capacity conflict returns a parked target,
not a global Plan lock; dependency-independent targets remain executable.

The plan is intent and allocation, not physical ownership. Local Dev and
Acceptance Suite Runtime remain the only owners of live process/resource
leases, readiness probes, manifests, cleanup, and quarantine. After one owner
action, record its manifest-bound result:

```bash
make dev-resource-record \
  WORK_ITEM=<id> \
  RESOURCE_RESULT=<runtime-owner-result.json>
```

Business Acceptance Gates are attach-only. They consume the prepared
SuiteRuntime manifest and must never build, deploy, allocate accounts, launch
clients, create automation sessions, or release resources.

Before executing runtime actions, show the developer one concise projection:

```text
Current worktree: <bound worktree>
Ready targets: <target -> REUSE|RESTART|BUILD|PROVISION>
Parked targets: <target -> typed capacity/dependency reason>
Shared resources: <deduplicated account/service/client/device/fixture/session>
```

The developer does not construct resource JSON or select internal commands.

## 3. Dispatch Stages

Invoke the owning Skill and consume its typed output:

| Stage | Owner output required |
|---|---|
| PRODUCT | accepted Journey/state/acceptance contract |
| DESIGN | accepted ownership/contracts/failure semantics |
| PLAN model | accepted vertical dependency model; tracked work only |
| PLAN persistence | validated stable Plan and optional explicit PlanMount; tracked work only |
| EXECUTE | scheduler proposal plus Guardian policy decision |
| ACCEPTANCE | formal evidence for required scope |
| DELIVER | reviewed commit/PR result |

Dev Workflow owns transition order, not stage content. It never edits a
specialist's answer in place to bypass a blocked gate. Explicit standalone
no-Plan work skips both PLAN rows and enters EXECUTE only when existing accepted
sources are sufficient.

## 4. Standalone No-Plan Execution

For `planPolicy=standalone`:

1. Confirm there is no live PlanMount and publish one untracked Development
   declaration with the exact source/runtime scope.
2. Use existing accepted product and architecture sources. Do not dispatch
   PLAN analysis or persistence and do not create substitute Plan-shaped files.
3. Execute the requested change directly within the declaration, preserving
   unrelated dirty files and the user's authorization envelope.
4. Run focused source verification and the applicable findings-first review.
   Product/runtime claims still require their normal exact-source proof; absent
   formal Acceptance remains `NOT RUN/UNPROVEN`.
5. Deliver through the standalone commit/PR path. Do not create a placeholder
   Plan or Development Session to satisfy delivery tooling.
6. Release the declaration and owned runtime resources. There is no
   active-work record or PlanMount to close.

Task size, cross-module scope, and PR checks do not override explicit no-Plan
intent. If a new unresolved product or architecture decision prevents safe
execution, return that decision as the blocker without generating a Plan.

## 5. Tracked Execution Loop

For a mounted Plan:

1. Validate the immutable ExecutionPlanSnapshot and resolve current Task from
   the ExecutionRun.
2. Verify workspace active-work `currentTaskId`, `currentTaskPath`, and
   `devState` against the run, declaration and Development Session.
3. Ask `pt-goal-orchestrator` for the bounded Ready/Parked schedule and
   concurrency lanes. The schedule must bind one Progress Slice to the current
   Task's `planctl status.progress.nextProgressBoundary`.
4. Aggregate all affected module impacts and prepare the current
   `PlanResourcePlan`; omit runtime preparation only when every resolved target
   is source-only.
5. Submit each resource-ready proposed action to
   `pt-execution-plan-guardian`. Keep resource-conflicting lanes parked and
   continue independent lanes.
6. Execute only `ACTION_ALLOWED` work within declared source/runtime scope.
   When the schedule carries a Host Capability Request, Dev Workflow invokes
   the named `pt-*-host-adapter` after admission and remains the sole executor.
7. Record each Runtime Owner result against the current resource-plan fencing
   token. Reject stale, unplanned, wrong-owner, or digest-mismatched results.
8. Record the first actionable failure in the Session and stop that action.
9. Persist meaningful results in owner order:
   - Session transition/evidence;
   - Task and Plan lifecycle through the ExecutionRun owner;
   - workspace active-work locator projection through
     `make active-work-sync WORK_ITEM=<id>`.
10. Recompute and continue the schedule across setup, authorization, diagnostic,
   checkpoint, deploy, verification, and source-backed remediation actions
   until the current Task closes or only a hard boundary remains.
11. Run the stage-appropriate Agent Review Loop before accepting the Task or
   stage gate.
12. When the Task closes or parks, atomically advance the ExecutionRun through its
    owner command, update the declaration's Task locator and workspace
    active-work record, ask the scheduler for `NEXT`, and activate a
    dependency-ready successor.
13. Repeat steps 1-12 while the Plan Run has a legal frontier. A Goal Slice
    closes one Task; it does not close the outer Plan Run.
14. Invoke read-only `pt-context-anchor` when a meaningful user-facing or
    compaction projection is due, then continue without waiting for
    confirmation.

The Guardian cannot execute, schedule, mutate a plan, or update tracking.
The scheduler cannot admit work outside accepted sources or mutate durable
state. The Anchor cannot repair state.

### Host Transport Failure Loop

Host adapters return transport observations to Dev Workflow:

- `HOST_ADAPTER_READY`: consume the result and continue the action.
- `HOST_CAPABILITY_UNAVAILABLE`: for optional workers, recompute serial/hybrid;
  for UI, attempt the repository-native driver once if it has not already been
  attempted for this request. Persist the unavailable observation and park only
  when the interaction is mandatory and no legal driver exists.
- `HOST_TOOL_CALL_FAILED`: if a side effect may remain, submit one idempotent
  cleanup request with the returned `cleanupHandle`; retry once only when the
  adapter classifies the failure retryable.
- `HOST_CLEANUP_QUARANTINED`: never issue recursive cleanup. Persist the bounded
  lease and continue independent ready Tasks. After expiry, submit one read-only
  `inspect-quarantine` request.
- `HOST_CLEANUP_ESCALATION_REQUIRED`: keep the resource branch parked and treat
  it as an external-resource hard boundary only after independent work drains.
- `HOST_DIAGNOSTIC_RETAINED`: accept only
  `blocksPlanRun=false`, `cleanup=retained-bounded`, and a concrete
  `leaseExpiresAt`. Commit deterministic project evidence, Session transition,
  Task closure, and successor activation before any host cleanup follow-up.
  Return from the adapter immediately, retain the host-local lease as a
  non-blocking observation, never write the transient envelope to Session
  `currentFailure`, and never wait for its confirmation workflow.

The scheduler and adapter do not persist these transitions. Dev Workflow owns
retry budgets, parking, cleanup, Session failure records, and reconciliation.
An unavailable capability without a new external observation cannot enter a
zero-progress retry loop; recompute serial/hybrid work or park its dependent
action.
The only in-place blocked observation changes are
`UNAVAILABLE -> AVAILABLE` and
`QUARANTINED -> RELEASED | ESCALATION_REQUIRED`; repeated or pre-expiry
observations fail closed.

### Progress-Bearing Continuation

Each Goal Slice inside a user-authorized Plan Run targets one complete Progress
Slice:

```text
current Task in_progress
  -> supporting actions
  -> Task done
  -> +1 completed Task closure
  -> successor frontier recomputed
```

Before each Slice, read the machine-derived baseline and completion effect from
`planctl status.progress`. After execution, require the manifest to show that
effect before reporting successful progress.

Do not return control merely because an internal action, Task, review, or stage
gate succeeded. Continue until the Plan reaches its accepted terminal state or
a hard boundary prevents progress and no dependency-ready Task or legal
remediation remains.

If a successful action produces no Task progress, keep it inside the current
Slice. If a completed Task unlocks a successor, activate it inside the same
Run. If the Task is too large to close within one bounded Slice, return
`PLAN_AMENDMENT_REQUIRED`; after agent-led amendment review passes, resume
without asking the user. Never invent a partial percentage.

## 6. Product-Functional Fence

For product-facing work:

```text
REPRODUCE
  -> IMPLEMENT ROOT CAUSE
  -> FOCUSED CHECKS
  -> AUTHORIZED CHECKPOINT
  -> EXACT-SOURCE DEPLOY
  -> REAL JOURNEY
  -> FUNCTIONAL_PASS

- Use the real required runtime and receiver perspective.
- On failure, return the first actionable failure to implementation.
- Dispatch runtime work through `pt-dev-runtime-handoff`. Repository-native
  Make/Harness/WebDriver/Appium paths are authoritative; host adapters supply
  only missing tool transport.
- Commit source-bound `FUNCTIONAL_CHECK/PASS` and the matching
  `FUNCTIONAL_PASS` Session projection through the same owner-controlled result
  slice. A PASS report with an earlier Session state is
  `SESSION_PROJECTION_STALE`.
- On failure, return the first actionable failure to implementation.
- Park an external/authorization edge without blocking independent ready work.
- Focused source checks, Gate count, coverage, and test count cannot establish
  `FUNCTIONAL_PASS`.
- Do not run broad Acceptance, Gap Detector, Completion Auditor
  `delivery-ready|close-ready`, cross-platform matrices, or submit pipelines
  before required product `FUNCTIONAL_PASS`. Lifecycle-only
  `implementation-ready` remains available during source work.

## 7. Amendments

When execution finds drift:

- undefined Journey/visible state -> `PRODUCT_AMENDMENT_REQUIRED`;
- undefined ownership/protocol/failure semantic -> `DESIGN_AMENDMENT_REQUIRED`;
- accepted semantics but stale inventory/dependency/deliverable mapping ->
  `PLAN_AMENDMENT_REQUIRED`.

Dev Workflow handles `PLAN_AMENDMENT_REQUIRED` inside the current Plan Run:

1. Update the accepted execution model in `plan.md`, Task Slices, and
   `Acceptance Execution`.
2. Run `planctl amend` with the concrete reason and change summary.
3. Let the command append the Amendment record, derive affected Task/Gate IDs,
   revalidate the complete package, publish a new immutable internal snapshot,
   and CAS-update the existing ExecutionRun.
4. Refresh the declaration and dependent projections, then continue.

The Agent performs this flow without asking for routine Gate, write-set,
dependency, command, Task decomposition/order, or implementation-path changes.
`criterionCoverage` is part of that Agent-owned execution model and does not
invalidate approval while `northStar` is unchanged.

A generated Plan starts with `northStarApproval=null` and cannot mount or
execute. After the user explicitly accepts the proposed objective and
source-backed criteria, run `planctl approve-north-star` with the durable
decision reference. Any later `northStar` change makes that approval stale and
returns `NORTH_STAR_APPROVAL_REQUIRED`; after fresh user approval, publish the
change with an owner-approved amendment carrying the same decision reference.
Without that publication authority, return `OWNER_DECISION_REQUIRED`. The
response must identify the conflict, impacted goal/acceptance, viable options
and tradeoffs, and a recommendation. Operation authorization expansion remains
independently gated.

For explicit standalone no-Plan work, `PRODUCT_AMENDMENT_REQUIRED` or
`DESIGN_AMENDMENT_REQUIRED` is reported as the exact missing decision.
`PLAN_AMENDMENT_REQUIRED` is not a license to create a Plan; the request remains
standalone unless the user explicitly changes its Plan policy.

## 8. Agent Review Loop

Review is an internal quality gate, not a default user handoff:

1. Generate the owning methodology or delivery review prompt.
2. For tracked work, run `completion-review-prepare` from the current successful Development
   Session. The command creates one immutable request and one owner-private
   reviewer capability. Pass the returned capability path to the independent
   reviewer; `completion-review-submit` rejects a missing, wrong-review, or
   wrong-digest capability and derives delegation provenance internally. The
   capability proves request-scoped delegation, not reviewer independence.
   For standalone work, run a separate findings-first review pass without
   manufacturing a Development Session or Completion Review receipt.
3. Invoke the applicable project review path, normally
   `route-change` -> `pt-code-structure-review` for authored source and record
   its source-bound decision -> `pt-quality-check` ->
   `pt-completion-auditor claimClass=delivery-ready` ->
   `pt-github-review`.
4. Treat findings that accepted sources resolve as Run work.
5. Fix them at the owning layer, rerun affected checks, and repeat review.
6. Advance automatically when the review passes.
7. Escalate only the precise unresolved DWF-D20 hard-boundary decision.

An independent subagent may review when available and safely isolated.
Otherwise the current agent performs a separate findings-first review pass.
Automation supplies evidence; the reviewing agent owns judgment.

## 9. Acceptance Promotion

After `FUNCTIONAL_PASS`:

1. Select scenarios from product states, architecture risks, and changed
   failure semantics. Do not require a canned success/network/timeout/invalid/
   cancellation matrix.
2. Reuse the same Journey and provisioning adapters.
3. Use `pt-acceptance-engineering` for missing business injection.
4. Run formal Acceptance on final exact source.
5. Keep every required but unrun Gate explicitly `UNPROVEN`.

`PROVEN` is reserved for formal Acceptance evidence. Development Session
records remain diagnostics.

## 10. Delivery And Close

After required proof:

1. For tracked work, publish the immutable repository completion attestation:

```bash
make plan-seal-completion PLAN=<package-plan.md>
```

2. Run completion and quality review for the named scope.
3. Use `pt-github-commit`, `pt-github-pr`, and `pt-github-review`.
4. Stop/release owned runtime resources through their physical owner.
5. Run the single close coordinator:

```bash
make dev-close \
  WORK_ITEM=<id> \
  MODE=<tracked|standalone> \
  CLOSE_REASON=<completed|cancelled|owner-abandon> \
  ENVIRONMENT_POLICY=<retain|unregister> \
  [MOUNT=<mount-id>] [WORKSPACE_ID=<workspace-id>]
```

   Normal completion/cancellation archives a terminal Session, closes
   active-work, releases the declaration and mount, then retains the reusable
   environment unless the user authorized worktree removal. `owner-abandon` is
   an explicit Owner decision and may archive a non-terminal Session without
   relabeling it as successful. The coordinator is idempotent and resumes from
   its machine-local `DevelopmentCloseReceipt`.
   `make dev-release`, `make active-work-close`, Session archive, Plan unmount,
   and environment unregister remain low-level owner/recovery commands; normal
   closure never treats one of them as complete.
6. Run `pt-completion-auditor` with `claimClass=close-ready`; it must consume
   that exact `CLOSED` receipt and resource matrix.
7. For tracked work, emit the final read-only Context Anchor before close when
   the host contract requires it. Standalone work creates no Anchor.

A checkpoint commit is source identity, not delivery approval. Push, PR,
deploy, destructive reset, and history rewrite remain separate
authorizations.

## Resume

On resume, first restore the request's Plan policy. Tracked work verifies the
persisted worktree, PlanMount, immutable snapshot, and ExecutionRun, runs
`make dev-check`, reconciles current Task/Session/workspace active-work, and
continues the Plan Run. Standalone work verifies that no live mount or tracked
projection was created, runs `make dev-check` for its declaration, and resumes
the requested mutation. Synchronized foreign Plans are ignored.

## Verification

- One Development Run owns the lifecycle.
- Explicit no-Plan intent remained standalone and created no tracked Plan
  artifacts or projections.
- Public declaration preceded mutation and was released at closure.
- One `DevelopmentCloseReceipt` closed every owned resource or names the exact
  blocker; no manual owner-by-owner cleanup was delegated to the user.
- Every affected module emitted one standard `ModuleImpact`; one
  `PlanResourcePlan` resolved targets and capacity for the whole Task.
- Ready target claims were published atomically; parked targets retained no
  partial reservation and did not block independent lanes.
- Runtime Owner results matched the current resource-plan fencing token,
  identity digests, and owner.
- Business Gates attached to prepared manifests and performed no provisioning.
- Every completed Goal Slice closed its declared Progress Slice and matched the
  `planctl status.progress` delta.
- One authorized Plan Run drained every dependency-ready successor until Plan
  completion or a named DWF-D20 hard boundary.
- Required review was agent-led; source-backed findings were remediated and
  re-reviewed without delegating ordinary review work to the user.
- Scheduler, Guardian, persistence, and projection boundaries remained
  separate.
- Required Journey has current exact-source functional evidence.
- Required formal proof and unproven scope are explicit.
- Durable state was updated only through its owner.

## Anti-Patterns

Never:

- add another complete-development orchestrator;
- let a module Skill allocate concrete resources or own deployment;
- let a business Gate build, provision, log in, or release Suite resources;
- acquire one resource while waiting for another resource in the same target;
- retry a parked target while an independent ready target can progress;
- let God View execute or persist workflow state;
- mutate a Plan without `planctl amend`, rewrite its Amendment Log, or replace
  its PlanMount for an ordinary execution correction;
- create or mount a Plan after the user explicitly selected no-Plan standalone
  execution;
- let Context Anchor repair workspace active-work;
- write project memory or another workspace's active-work record;
- write before declaration or outside declared scope;
- diagnose product behavior with broad Acceptance;
- return an Anchor after a successful administrative action while its Progress
  Slice remains open;
- return control after a Task closure, stage review, or Context Anchor while
  the authorized Plan Run still has dependency-ready work;
- ask the user to perform routine product, architecture, plan, completion, or
  code review that project Review Skills can decide;
- ask the user to re-authorize an operation already granted by the user or the
  accepted Plan's explicit authorization envelope;
- require one IDE/agent host for scheduling, app operation, or proof;
- ask the user to execute a deterministic product Journey that the repository
  driver or a detected host adapter can operate;
- let a host adapter own PASS/FAIL, Session state, or cleanup;
- claim progress from commands, checks, files, commits, declarations, leases,
  or Session transitions that did not close a Task;
- copy one Journey into separate Development and Acceptance implementations;
- claim readiness from static checks or stale proof;
- call `dev-release`, `active-work-close`, or `plan-unmount` as a substitute
  for the coordinated `dev-close` lifecycle;
- leave declarations or owned runtime resources active after closure.
