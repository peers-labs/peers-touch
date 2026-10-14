---
name: pt-dev-workflow
description: Runs one non-trivial Peers-Touch development lifecycle from verified intake through implementation, current-source proof, delivery, and owned-resource release. Plans and task progress are optional inputs, not execution authority.
stage: cross-stage
requires: ["explicit request", "canonical worktree", "applicable product/architecture sources"]
produces: ["implemented result", "verification evidence", "delivery state", "resource disposition"]
---

# Peers-Touch Development Workflow

Human operating standard: `docs/global/workflow.md`.

This Skill organizes work. It does not create a second lifecycle beside the
seven-step standard and does not derive authority from Hook, chat identity,
Plan, task state, or a receipt.

## North Star

At intake, identify:

- the inherited product or engineering north star;
- this request's observable contribution;
- completion obligations and non-goals;
- the exact canonical worktree and allowed scope.

Plan completion, Task count, Gate count, and progress percentage never replace
the outcome.

## Plan Policy

- Honor explicit `no plan` / `不要 plan` / equivalent instructions.
- Small and ordinary work does not create a Plan or task record.
- Use product and architecture methodology before implementation when a new
  decision is required.
- Create a frozen Plan Version only for complex work that needs durable
  dependency/closure structure and has received required confirmation.
- Read an explicit Plan directly with `planctl inspect`; never require or
  create PlanMount.
- Never create, switch, remove, or prune a worktree unless the user explicitly
  requested that exact operation.

## Optional Task Progress

Create progress only when cross-session recovery is useful:

```bash
node tooling/scripts/local-dev/dev-work.mjs start \
  --workspace-root "$PWD" \
  --task <taskId> \
  --north-star-ref <ref> \
  --contribution '<observable contribution>' \
  --goal '<task goal>'
```

Task records live under:

```text
.dev-workflow/tasks/<taskId>/task.json
```

Select `taskId` explicitly. Do not infer it from mtime, branch, chat, Plan
count, or historical active-work. A corrupt task affects only that task.
Updating or closing uses revision/CAS on one checksum-protected atomic
snapshot. Status queries are read-only.

Task progress does not authorize writes, runtime operations, delivery, or
formal evidence.

## Lifecycle

### 1. Intake

Confirm north star, contribution, completion obligations, scope, worktree, and
separately governed operations. Ask only when a missing fact changes behavior
or authorization.

### 2. Research

Read governing sources and operational knowledge. Follow actual call paths.
Separate source facts, runtime observations, and hypotheses. Reproduce bugs or
collect equivalent evidence before fixing.

### 3. Design

Choose the owning layer, behavior, data/contracts, failure semantics, and
verification. Use existing SDKs and components. Obtain user confirmation before
implementing a new product/architecture/accepted execution design when
required.

### 4. Prepare

Verify canonical root, branch, current HEAD, dirty state, and allowed paths.
Preserve unrelated changes. Prepare only runtime resources needed for the next
verification slice.

### 5. Implement

Invoke `pt-read-before-edit` and applicable coding/domain Skills. Keep changes
inside scope and at the owning layer. Structural replacement must remove the
old active path and update governing docs/knowledge in the same change.

Hook context is advisory. Missing identity, unknown event, or Hook failure does
not stop ordinary work.

### 6. Verify

Run focused source checks, then exact-source functional Journeys, then required
formal Acceptance. Keep these evidence classes separate:

- `SOURCE_CHECK`
- `STRUCTURAL_CHECK`
- `UX_REVIEW`
- `FUNCTIONAL_CHECK`
- `ACCEPTANCE_PROOF`

Current-source evidence must bind the current commit/workspace digest. A stale
or caller-authored PASS is not proof. Fix failures and rerun affected evidence.

### 7. Deliver

Run findings-first completion review from explicit obligations and current
source. Report implemented, proven, unverified, and blocked scope separately.
Commit, push, PR, merge, deploy, publish, reset, and destructive cleanup each
require their own authorization.

Release only resources owned by this request. Explicitly retained resources
must name their owner and purpose. Do not close unrelated services or seal the
worktree.

## Runtime Operations

Use canonical Local Dev / Acceptance entrypoints. Runtime admission requires:

- authoritative workspace binding;
- reviewed Profile and required capability;
- exact normalized target or reset scope;
- current prepared Git source identity;
- stable Profile protection;
- tracked-clean topology;
- OS-held lease and post-lock revalidation;
- operation-specific authorization where required.

Task declarations, OWNER, PlanMount, resource-plan receipts, Hook receipts, and
task completion neither grant nor block runtime acquisition.

Environment creation remains human-authorized for the exact name and target.
Agent operation of local/compose Station remains forbidden unless an applicable
source explicitly permits it.

## Goal And Concurrency

For a Goal-driven request, derive a bounded work graph from accepted scope.
Schedule by actual dependencies, write overlap, generated outputs, runtime
resources, verification isolation, and integration order.

Parallel workers receive the exact canonical worktree and disjoint ownership.
They never create worktrees, stage/commit, deploy, mutate tracking, run broad
generators, or claim final completion. One integrator owns shared files,
generated artifacts, commits, deployments, and final product Gates.

A blocked action is parked while independent work continues. The Goal is
blocked only when the ready frontier is empty and the remaining condition
requires external input or state.

## Resume And Status

Resume from:

1. the explicit current request;
2. current Git and runtime facts;
3. one explicit optional `taskId`;
4. an explicit Plan path/taskId when supplied;
5. current evidence.

Do not resume from chat history, project memory, newest mtime, OWNER state,
PlanMount, declaration, Session, active-work, or a close receipt.

`pt-context-anchor` may render a read-only checkpoint. Missing optional task
progress is reported as `none`, not as a blocked worktree.

## Completion

Before a non-trivial readiness claim:

1. Re-read completion obligations.
2. Confirm changed paths and removed old paths.
3. Run current-source completion review.
4. Verify functional and formal proof at the required strength.
5. Confirm task-owned resource disposition.
6. Run applicable `pt-code-structure-review`, security, frontend, prototype,
   and Acceptance gap checks.

Close optional task progress only after evidence references are current and
task-owned resources are `released` or explicitly `retained`.

## Anti-Patterns

- Create a Plan/task/worktree to satisfy tooling.
- Require `dev-start`, OWNER, PlanMount, Session, active-work, or close receipt
  for ordinary work.
- Treat Hook as a shell sandbox or permission owner.
- Infer authorization from Plan existence, task state, or test success.
- Use stale builds, another worktree, mocks, or arbitrary PASS files as current
  product proof.
- Stop after analysis when implementation is authorized and feasible.
- Hand deterministic verification to the user before Agent verification.
- Claim overall completion while required product/runtime proof remains
  unverified.
