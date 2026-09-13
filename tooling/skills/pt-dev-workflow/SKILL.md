---
name: pt-dev-workflow
description: >-
  Orchestrates Peers-Touch development from requirement classification through
  public resource declaration, product-first execution, Acceptance promotion,
  review and delivery. Invoke for every non-trivial task or tracked-work resume.
stage: orchestrator
requires: []
produces: ["declared and closed development work item", "product-functional evidence", "formal delivery evidence"]
---

# Dev Workflow

This is the single entry point for non-trivial Peers-Touch development. It owns
workflow order and claim discipline; specialist Skills own their stages.

Architecture source:
`docs/architecture/development-workflow/README.md`.

## Invoke When

- Starting or resuming a non-trivial feature, bug fix, refactor, migration, or
  cross-module task.
- The user asks to implement, continue, finish, verify, submit, or deliver
  tracked work.
- A task needs PRODUCT, DESIGN, PLAN, EXECUTE, Acceptance, or DELIVER routing.

Do not use for read-only discussion or trivial typo/comment changes with no
product or runtime impact.

## Core Rule

```text
read-only intake
  -> public resource declaration before first write/runtime acquisition
  -> PRODUCT -> DESIGN -> PLAN
  -> product-first EXECUTE
  -> exact-source FUNCTIONAL_PASS
  -> Acceptance promotion and proof
  -> Quality and DELIVER
  -> release declaration and leases
```

Never enter broad Acceptance while a required product Journey is not
`FUNCTIONAL_PASS`.

## 1. Read-Only Intake

Before mutation:

1. Bind and verify the explicit worktree.
2. Classify the task: product behavior, infrastructure, refactor, or docs.
3. Resolve existing product, architecture, plan, Journey and `active_work`
   sources.
4. Derive preliminary source and runtime claims.
5. Record the authorization envelope for local checkpoint, push, PR, deploy,
   reset and history rewrite.

Read-only inspection does not require a declaration.

## 2. Public Resource Declaration

Before the first repository write or runtime acquisition:

```bash
make dev-start \
  WORK_ITEM=<stable-id> \
  PURPOSE='<short purpose>' \
  SOURCE_CLAIMS='<shared-read|exclusive-write>:<repo-path>[;...]' \
  RUNTIME_CLAIMS='<shared|exclusive>:<kind>:<resource-id>[;...]' \
  [JOURNEY=<id>] [SESSION=<id>]
```

Requirements:

- `~/.peers-touch/dev/work.json` is the machine-wide public intent ledger.
- `make dev-start` must atomically publish, conflict-check and read back the
  declaration.
- Run `make dev-check WORK_ITEM=<id>` before each mutation slice.
- Use `make dev-update` before writing outside the declared source claims or
  acquiring an undeclared resource.
- After an authorized commit, rebase or merge, use `make dev-update` to publish
  the new source HEAD before the next mutation slice.
- `make dev-status-all` is the cross-worktree public view.
- A declaration is intent, not a runtime lease or authorization.
- `RESOURCE_DECLARATION_CONFLICT` blocks the overlapping action. Do not select
  another worktree, Profile, path or resource as a workaround.

## 3. Outer Stage Dispatch

| Stage | Owner Skill | Exit Gate |
|---|---|---|
| PRODUCT | `pt-product-design-methodology`; `pt-prototype-design` when needed | accepted journeys, states and product acceptance |
| DESIGN | `pt-architecture-design-methodology` | accepted ownership, contracts, failures and decisions |
| PLAN | `pt-architecture-execution-methodology` then `pt-plan-and-document` | approved plan, Journey mapping and authorization envelope |
| EXECUTE | `pt-execution-plan-guardian` | required Journeys reach functional pass and formal proof |
| DELIVER | commit/PR/review Skills | merged or explicitly held/rejected |

Update the public declaration whenever stage scope or resources change. Create
`active_work` only after the formal plan exists.

## 4. Product-First EXECUTE

For each dependency-ready workstream, select one Journey and enforce:

```text
REPRODUCING -> REPRODUCED
  -> IMPLEMENTING
  -> FOCUSED_CHECKING -> FOCUSED_PASS
  -> CHECKPOINTING -> CHECKPOINTED
  -> DEPLOYING -> DEPLOYED
  -> FUNCTIONAL_RUNNING
       -> FAILED: return first actionable failure to IMPLEMENTING
       -> BLOCKED: park the environment/authorization edge
       -> FUNCTIONAL_PASS
```

Rules:

- Reproduce once and identify the owning layer before fixing.
- Run focused unit/type/contract checks, not broad Acceptance.
- Remote/exact-source runtime requires an authorized clean checkpoint commit.
- Deployment and runtime startup use Local Dev Control Plane and Make owners.
- Functional verification must use the required real product runtime and
  receiver perspective.
- Stop on the first actionable failure.
- Every command declares one purpose and a bounded budget.
- Do not run coverage, Gap Detector, Completion Auditor, cross-platform
  matrices, submit pipeline or broad Gate bundles before `FUNCTIONAL_PASS`.

## 5. Acceptance Promotion

After `FUNCTIONAL_PASS`:

1. Check whether the formal Gate consumes the same business Journey.
2. Use `pt-acceptance-engineering` to add or complete missing business
   injection.
3. Promote the Dev Journey adapter; do not copy actions/assertions into another
   implementation.
4. Create a final checkpoint.
5. If product code or Journey semantics changed, return to focused checking and
   functional execution.
6. Run formal Acceptance on final exact source.
7. Preserve `UNPROVEN` for every required Gate not run.

Development records are diagnostics and cannot satisfy Acceptance proof.

## 6. Verification Classes And Claims

| Class | Legal claim |
|---|---|
| `SOURCE_CHECK` | named source check passed |
| `STRUCTURAL_CHECK` | named structural relation passed |
| `UX_REVIEW` | named UX/prototype review passed |
| `FUNCTIONAL_CHECK` | named exact-source Journey works |
| `ACCEPTANCE_PROOF` | declared capability scope is formally proven |

`PROVEN` is reserved for formal Acceptance interpretation. Static/typecheck,
Harness-only, API-only, browser-only or prototype results never imply
`FUNCTIONAL_PASS`.

## 7. Delivery

Only after required formal proof:

1. Run `pt-completion-auditor`.
2. Run `pt-quality-check` / submit pipeline once for final source.
3. Use `pt-github-commit`, `pt-github-pr`, and `pt-github-review`.
4. Keep unrun product scope explicit.

A checkpoint commit is deployment identity, not delivery approval. Local
checkpoint, push, PR, reset and history rewrite are separate authorizations.

## 8. Close And Resume

On resume:

- verify worktree binding;
- read plan status and `active_work`;
- run `make dev-check WORK_ITEM=<id>`;
- heartbeat or update the declaration;
- continue from the earliest non-stale state.

On completion, cancellation, abandonment, or handoff:

1. stop/release owned runtime resources;
2. run `make dev-release WORK_ITEM=<id> [SESSION=<id>]`;
3. delete transient Development artifacts after promoting durable conclusions;
4. update plan status and `active_work`;
5. never leave a live declaration as conversational memory.

## Verification

Before claiming workflow completion:

- Public declaration was visible and conflict-free.
- Required focused checks passed.
- Required Journey has current exact-source `FUNCTIONAL_CHECK`.
- Required formal Gates have current `ACCEPTANCE_PROOF`.
- Quality/CI gaps are explicit.
- Runtime resources and public declaration are released.

## Anti-Patterns

Never:

- Write or acquire runtime resources before `dev-start`.
- Add a second workflow orchestrator Skill.
- Treat `active_work`, branch name, process discovery or a private `.local` file
  as public resource intent.
- Run broad Acceptance to diagnose the first product failure.
- Copy a business Journey into separate Dev and Acceptance scripts.
- Use dirty overlays, manual Station execution or ad hoc SSH deployment.
- Claim functionality from Gate count, test count, static checks or old proof.
- Leave the work declaration active after closure.
