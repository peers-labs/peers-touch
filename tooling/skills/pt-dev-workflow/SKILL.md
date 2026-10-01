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
`docs/architecture/development-workflow/README.md`.

## Responsibility Boundary

| Concern | Owner |
|---|---|
| Route into this workflow | `pt-god-view` |
| Product Journey and visible states | `pt-product-design-methodology` |
| Architecture boundaries and contracts | `pt-architecture-design-methodology` |
| Vertical dependency plan model | `pt-architecture-execution-methodology` |
| Plan Package persistence and generation-bound workspace Plan binding | `pt-plan-and-document` |
| Ready/Parked selection and concurrency lanes | `pt-goal-orchestrator` |
| Whether a proposed action may run | `pt-execution-plan-guardian` |
| Plan/Task/Session/workspace active-work mutation order | `pt-dev-workflow` through their owning commands |
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

A stage may be skipped only when its owning Skill proves it is unnecessary.
Never enter broad Acceptance while a required Journey is not
`FUNCTIONAL_PASS`.

## Plan Run Authorization

An explicit `continue`, `resume`, `execute the plan`, `finish the plan`, or
equivalent request starts one **Plan Run** over the bound Plan's accepted scope
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

Stop and ask the user only when the remaining frontier requires:

- an operation outside or explicitly denied by both the user's exact grant and
  the accepted Plan authorization envelope;
- an admitted operation that was attempted and returned an actual external
  permission, credential, or scope failure with no legal in-scope remediation;
- a destructive or irreversible operation, including force push, history
  rewrite, merge, release, production mutation, data deletion/reset,
  environment creation, permission expansion, version/schema bump, worktree
  add/remove/prune, or secret access, only when its exact grant is absent;
- a material product, architecture, security, privacy, compatibility, or
  rollout choice with multiple valid outcomes that accepted sources cannot
  resolve;
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

1. When the Workflow Kernel reports `ENFORCED`, consume its immutable
   conversation `executionRoot`; tool `cwd`, target paths, Skill paths, Plan
   paths and sibling repositories cannot replace it. The binding is not a
   worktree lease and says nothing about another conversation's ownership.
2. In `OBSERVE_ONLY`, bind one explicitly selected worktree. Never infer it
   from a Skill path, branch name, Plan path, or nearby repository.
3. Capture and verify canonical root, branch, `workspaceId`, initial HEAD,
   and expected HEAD with `tooling/scripts/verify-worktree-binding.py`.
   Unrelated sibling worktree inventory is not execution identity.
4. Resolve the workspace's current Plan binding generation when present.
   Repository or PR contents may contain many active Plans; only the bound
   `planId + planPath` belongs to this workspace. Never scan by branch. Advance
   only through the binding owner after the previous generation is completed
   and quiescent.
5. Resolve user intent, authorization envelope, existing accepted sources, and
   whether the work is tracked.
6. Preserve unrelated dirty files. Never switch branches or worktrees
   implicitly. Never create a worktree to bypass a Plan binding, lifecycle
   state, or resource conflict; only an explicit user-selected isolation or
   concurrency operation authorizes worktree creation.

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
  Plan ID, current workspace Plan generation, expected HEAD, and single current
  Task. An unbound workspace may publish untracked pre-Plan work; a bound
  workspace cannot publish a locator-less declaration.
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
| PLAN model | accepted vertical dependency model |
| PLAN persistence | validated Plan Package and workspace active-work locator |
| EXECUTE | scheduler proposal plus Guardian policy decision |
| ACCEPTANCE | formal evidence for required scope |
| DELIVER | reviewed commit/PR result |

Dev Workflow owns transition order, not stage content. It never edits a
specialist's answer in place to bypass a blocked gate.

## 4. Tracked Execution Loop

For an accepted Plan Package:

1. Validate the package and resolve its current Task.
2. Verify workspace active-work `currentTaskId`, `currentTaskPath`, and
   `devState` against the manifest, declaration and Development Session.
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
   - Task snapshot and manifest lifecycle through `planctl`;
   - workspace active-work locator projection through
     `make active-work-sync WORK_ITEM=<id>`.
10. Recompute and continue the schedule across setup, authorization, diagnostic,
   checkpoint, deploy, verification, and source-backed remediation actions
   until the current Task closes or only a hard boundary remains.
11. Run the stage-appropriate Agent Review Loop before accepting the Task or
   stage gate.
12. When the Task closes or parks, atomically advance the manifest through its
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

## 5. Product-Functional Fence

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
- Do not run broad Acceptance, Gap Detector, Completion Auditor,
  cross-platform matrices, or submit pipelines before `FUNCTIONAL_PASS`.

## 6. Amendments

When execution finds drift:

- undefined Journey/visible state -> `PRODUCT_AMENDMENT_REQUIRED`;
- undefined ownership/protocol/failure semantic -> `DESIGN_AMENDMENT_REQUIRED`;
- accepted semantics but stale inventory/dependency/deliverable mapping ->
  `PLAN_AMENDMENT_REQUIRED`.

Dev Workflow routes the amendment to its owner. `pt-plan-and-document` persists
an accepted updated plan model. The Guardian and scheduler never self-amend the
Plan Package.

## 7. Agent Review Loop

Review is an internal quality gate, not a default user handoff:

1. Generate the owning methodology or delivery review prompt.
2. Invoke the applicable project review path, normally
   `route-change` -> `pt-code-structure-review` for authored source and record
   its source-bound decision -> `pt-quality-check` ->
   `pt-completion-auditor` -> `pt-github-review`.
3. Treat findings that accepted sources resolve as Run work.
4. Fix them at the owning layer, rerun affected checks, and repeat review.
5. Advance automatically when the review passes.
6. Escalate only the precise unresolved DWF-D20 hard-boundary decision.

An independent subagent may review when available and safely isolated.
Otherwise the current agent performs a separate findings-first review pass.
Automation supplies evidence; the reviewing agent owns judgment.

## 8. Acceptance Promotion

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

## 9. Delivery And Close

After required proof:

1. Run completion and quality review for the named scope.
2. Use `pt-github-commit`, `pt-github-pr`, and `pt-github-review`.
3. Stop/release owned runtime resources.
4. Run:

```bash
make dev-release WORK_ITEM=<id> [SESSION=<id>]
make active-work-close WORK_ITEM=<id> EXPECTED_REVISION=<n>
```

5. Persist final owner state, then emit the read-only Context Anchor.

A checkpoint commit is source identity, not delivery approval. Push, PR,
deploy, destructive reset, and history rewrite remain separate
authorizations.

## Resume

On resume, verify the persisted worktree and current Plan generation, run
`make dev-check`, validate the bound Plan Package, reconcile current
Task/Session/workspace active-work, then resume the earliest legal action and
continue the Plan Run. Synchronized foreign Plans are ignored. Do not pause
merely to print the Anchor or after the first Task closes.

## Verification

- One Development Run owns the lifecycle.
- Public declaration preceded mutation and was released at closure.
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
- let the scheduler or Guardian mutate the Plan Package;
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
- leave declarations or owned runtime resources active after closure.
