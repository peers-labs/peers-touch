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
| Plan Package persistence and initial `active_work` registration | `pt-plan-and-document` |
| Ready/Parked selection and concurrency lanes | `pt-trae-goal-orchestrator` |
| Whether a proposed action may run | `pt-execution-plan-guardian` |
| Plan/Task/Session/`active_work` mutation order | `pt-dev-workflow` through their owning commands |
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

## 1. Intake And Binding

Before mutation:

1. Bind one explicitly selected worktree. Never infer it from a Skill path,
   branch name, plan path, or nearby repository.
2. Capture and verify canonical root, branch, `workspaceId`, initial HEAD,
   expected HEAD, and worktree-set digest with
   `tooling/scripts/verify-worktree-binding.py`.
3. Resolve user intent, authorization envelope, existing accepted sources, and
   whether the work is tracked.
4. Preserve unrelated dirty files. Never switch branches or worktrees
   implicitly.

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
  [JOURNEY=<id>] [SESSION=<id>]
```

Rules:

- Run `make dev-check WORK_ITEM=<id>` before each mutation slice.
- Run `make dev-update` before expanding scope/resources and after an
  authorized commit, merge, or rebase changes source HEAD.
- Different worktrees on different branches may overlap with
  `SOURCE_OVERLAP_WARNING`; same-workspace overlap, same-branch parallel
  writes, and exclusive runtime overlap return
  `RESOURCE_DECLARATION_CONFLICT`.
- A declaration is public intent, not a runtime lease or operation
  authorization.

## 3. Dispatch Stages

Invoke the owning Skill and consume its typed output:

| Stage | Owner output required |
|---|---|
| PRODUCT | accepted Journey/state/acceptance contract |
| DESIGN | accepted ownership/contracts/failure semantics |
| PLAN model | accepted vertical dependency model |
| PLAN persistence | validated Plan Package and `active_work` locator |
| EXECUTE | scheduler proposal plus Guardian policy decision |
| ACCEPTANCE | formal evidence for required scope |
| DELIVER | reviewed commit/PR result |

Dev Workflow owns transition order, not stage content. It never edits a
specialist's answer in place to bypass a blocked gate.

## 4. Tracked Execution Loop

For an accepted Plan Package:

1. Validate the package and resolve its current Task.
2. Verify `active_work.current_task_id`, `current_task_path`, and `dev_state`
   against the manifest and Development Session.
3. Ask `pt-trae-goal-orchestrator` for the bounded Ready/Parked schedule and
   concurrency lanes.
4. Submit each proposed action to `pt-execution-plan-guardian`.
5. Execute only `ACTION_ALLOWED` work within declared source/runtime scope.
6. Record the first actionable failure in the Session and stop that action.
7. Persist meaningful results in owner order:
   - Session transition/evidence;
   - Task snapshot and manifest lifecycle through `planctl`;
   - `active_work` locator/binding projection.
8. Recompute the schedule until the current Task closes or only a hard boundary
   remains.
9. Invoke read-only `pt-context-anchor` when a user-facing projection is due.

The Guardian cannot execute, schedule, mutate a plan, or update tracking.
The scheduler cannot admit work outside accepted sources or mutate durable
state. The Anchor cannot repair state.

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
```

- Use the real required runtime and receiver perspective.
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

## 7. Acceptance Promotion

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

## 8. Delivery And Close

After required proof:

1. Run completion and quality review for the named scope.
2. Use `pt-github-commit`, `pt-github-pr`, and `pt-github-review`.
3. Stop/release owned runtime resources.
4. Run:

```bash
make dev-release WORK_ITEM=<id> [SESSION=<id>]
```

5. Persist final owner state, then emit the read-only Context Anchor.

A checkpoint commit is source identity, not delivery approval. Push, PR,
deploy, destructive reset, and history rewrite remain separate
authorizations.

## Resume

On resume, verify the persisted binding, run `make dev-check`, validate the
Plan Package, reconcile current Task/Session/`active_work`, then resume the
earliest legal action. Do not pause merely to print the Anchor.

## Verification

- One Development Run owns the lifecycle.
- Public declaration preceded mutation and was released at closure.
- Scheduler, Guardian, persistence, and projection boundaries remained
  separate.
- Required Journey has current exact-source functional evidence.
- Required formal proof and unproven scope are explicit.
- Durable state was updated only through its owner.

## Anti-Patterns

Never:

- add another complete-development orchestrator;
- let God View execute or persist workflow state;
- let the scheduler or Guardian mutate the Plan Package;
- let Context Anchor repair `active_work`;
- write before declaration or outside declared scope;
- diagnose product behavior with broad Acceptance;
- copy one Journey into separate Development and Acceptance implementations;
- claim readiness from static checks or stale proof;
- leave declarations or owned runtime resources active after closure.
