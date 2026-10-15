---
name: "pt-architecture-execution-methodology"
description: "Transforms accepted product and architecture contracts into a vertical, dependency-backed execution model. Planning only: it neither persists the frozen Plan Version nor executes work."
stage: "PLAN"
requires: ["accepted product contract when applicable", "accepted architecture"]
produces: ["accepted vertical execution model", "dependency DAG", "risk-based verification model"]
next: "pt-plan-and-document"
---

# Architecture Execution Methodology

This Skill owns PLAN analysis. It answers:

```text
How can the accepted target state be delivered as vertical, dependency-closed
increments?
```

It does not write repository artifacts. `pt-plan-and-document` persists the
accepted model as a frozen Plan Version.

## Boundary

This Skill owns:

- current-state impact inventory;
- vertical execution closures;
- dependency order and atomic cutovers;
- architecture/product traceability;
- risk-based functional and Acceptance obligations;
- deletion and rollback boundaries.

It does not:

- invent or revise product behavior;
- redesign architecture, ownership, topology, or protocols;
- choose runtime scheduling or subagent lanes;
- persist `plan.md`, Task Slice files, or optional task progress;
- execute implementation or verification;
- update task progress or evidence state.

## Preconditions

Require:

- accepted product Journey/state contract for product-facing work;
- accepted architecture sources, decisions, invariants, and forbidden
  relationships;
- repository-backed inventory;
- explicit open risks and required quality thresholds.

Return `PLAN_BLOCKED_BY_PRODUCT` or `PLAN_BLOCKED_BY_DESIGN` with the exact
missing source. Do not fill semantic gaps inside the plan.

## Core Model

```text
Product Journey / functional boundary
  -> end-to-end vertical closure
  -> architecture dependencies
  -> atomic cutover
  -> focused functional evidence
  -> risk-based Acceptance proof
```

A vertical closure leaves one usable or internally complete behavior across all
required owners. Do not decompose the primary DAG into isolated frontend,
backend, database, test, or documentation phases. Those are deliverables inside
a vertical closure.

Each persisted Task Slice will be one progress unit. Size every closure so one
bounded Progress Slice can finish it and produce a durable Task transition to
`done`. If that is not realistic, split the closure along a real dependency
boundary before persistence; do not rely on subjective partial percentages.

## Method

### 1. Bind To Accepted Sources

Build:

| Required outcome | Product Journey/state | Architecture decision/invariant | Evidence needed |
|---|---|---|---|

Unmapped work is out of scope or requires amendment.

### 2. Inventory Current Reality

Inspect:

- runtime entrypoints and owners;
- public/internal contracts and generated outputs;
- callers, consumers, stores, projections, and UI;
- persistence, auth, observability, and cleanup;
- tests, fixtures, Gates, docs, and knowledge;
- old paths that the target state removes.

Use current repository evidence, not estimated file lists.

### 3. Define Vertical Closures

For each Journey or class-specific functional boundary, define:

- observable outcome;
- participating owners from input to receiver;
- source and runtime scope;
- contract/data changes;
- implementation and consumer changes;
- migration/deletion obligations;
- focused functional check;
- risks requiring formal proof;
- exact completion and non-claims.

Split a closure only when the pieces remain internally consistent and have a
real dependency relation. Do not split merely to maximize parallelism.

### 4. Build The Dependency DAG

Derive dependencies from:

- accepted contracts before consumers;
- canonical source before projections;
- security/bootstrap before protected traffic;
- persistence before recovery;
- event semantics before event consumers;
- observability before claims that require it;
- consumer cutover before old-path deletion;
- deletion before single-source completion.

Mark possible parallelism as a property of the graph. Runtime lane selection is
deferred to the host-neutral `pt-goal-orchestrator`.

### 5. Define Atomic Cutovers

For every replaced concern, name:

- new source of truth;
- complete consumer inventory;
- cutover preconditions;
- old implementation to delete;
- search/check proving removal;
- rollback through version/deployment control.

Do not create an indefinite dual path unless the accepted architecture
explicitly requires one.

For a **clean-cut** replacement (the accepted architecture has no compatibility
layer, no dual-running), rollback is a **VCS revert of the cut commit**, not a
runtime toggle or a retained fallback path. The cut commit must be atomic and
self-contained so reverting it restores the prior mechanism without depending
on code that was deleted inside that same commit.

### 5b. Bootstrapping When The Acceptance System Is The Work

Trigger: the work changes the acceptance mechanism itself (its contract,
executor, or evidence form). The normal rule "verify the produced closure with
the acceptance framework" cannot apply, because that would make the new
mechanism its own witness while the old one is being deleted.

Bootstrap the verification in three ordered layers; each lower layer must hold
before the next, and all three must hold before the old mechanism is deleted:

1. **Plain unit tests for the new contract/executor** — these run outside any
   gate and do not depend on the acceptance mechanism. They prove parsing,
   target resolution, event dispatch, and fail-closed behavior.
2. **Independent-oracle exemplar** — one exemplar journey is verified against
   an oracle independent of the new system (direct human-checkable readback or
   an authority read through a separate path), not by a gate of the new system
   certifying itself.
3. **Product journeys under the new mechanism** — ordinary product journeys are
   then verified in operation language.

Only after all three layers pass is the clean-cut deletion allowed. The
bootstrap layers are part of the closure's evidence, not ad hoc debugging.

### 6. Define Verification By Risk And State

For each closure, select evidence from:

- required product state transitions;
- receiver-perspective outcomes;
- changed failure semantics;
- architecture invariants and trust boundaries;
- data loss, replay, ordering, auth, overload, recovery, and cleanup risks that
  are actually introduced or materially affected;
- regression surfaces discovered in inventory.

Do not require a canned `success + network error + timeout + invalid input +
cancellation` set for every closure. Include a scenario only when a product
state, accepted contract, changed failure semantic, or identified risk makes it
relevant. Conversely, never omit a relevant risk merely because a generic
happy-path check passes.

Each selected scenario has:

- source Journey/state/risk ID;
- precondition and user/system action;
- observable expected result;
- required runtime and receiver;
- binary pass/fail oracle;
- per-step execution channel and event mechanism (`touch` / `dom-event` /
  `harness`) fixed in the model, not left to execution time;
- evidence class and artifact;
- explicit non-claim when not run.

Development functional checks and formal Acceptance may reuse the same Journey
adapter, but they retain separate evidence ownership.

### 7. Produce The Plan Model

Return a structured model containing:

- stable goal, scope, and non-goals;
- product/architecture traceability;
- vertical closure list;
- dependency DAG;
- read/write and runtime claim requirements;
- atomic cutovers and deletions;
- focused checks and risk-based Acceptance mapping;
- authorization requirements;
- completion/release criteria.

The model is not yet a repository Plan Version and has no Task lifecycle,
current selection or task-progress state.

## Handoff To Persistence

Pass the accepted model to `pt-plan-and-document`, which:

- renders `plan.md` and bounded Task Slices;
- creates the single machine-readable `Acceptance Execution` contract;
- records authorization without execution worktree identity;
- runs `planctl validate`;
- freezes the Plan Version digest;
- returns the explicit Plan path and digest for direct inspection; Dev Workflow
  may later save that reference in an explicitly selected optional task record.

The persistence Skill may reject an invalid model but may not redesign it.

## Plan Review Gate

Return `PLAN_MODEL_READY` only when:

- every closure is vertical and source-backed;
- dependencies and cutovers are explicit;
- no required lifecycle step is unmapped;
- deletion and rollback boundaries are complete;
- when the acceptance system itself is the work, the three bootstrap layers
  (plain unit tests, independent-oracle exemplar, product journeys) are mapped
  and gate the deletion;
- per-step channel and event mechanism are fixed in the model;
- verification traces to product states or concrete risks;
- no plan item redesigns architecture;
- completion claims are bounded.
- each closure is small enough to be one meaningful Task-closing continuation.

Before persistence, the Development Run invokes an agent-led plan-model review.
An independent agent, or the current agent in a separate findings-first pass,
checks closure verticality, dependency fidelity, cutovers, evidence, claim
boundaries, and Task sizing. Source-backed findings are corrected and reviewed
again inside the Run.

Human owner input is required only for a product/architecture/security/privacy/
compatibility/rollout choice that accepted sources cannot resolve, or for a
DWF-D20 destructive, irreversible, permission, or external-resource boundary.
Routine plan review is not a user handoff.

## Escalation

- Undefined user-visible behavior -> `PRODUCT_AMENDMENT_REQUIRED`.
- Undefined ownership, protocol, retry/replay/order/auth/lifecycle semantics ->
  `DESIGN_AMENDMENT_REQUIRED`.
- Insufficient current-tree evidence -> `PLAN_INVENTORY_INCOMPLETE`.

Name the source gap and stop the affected closure.

## Verification

- Work is organized by vertical outcome, not technical layer.
- The dependency graph reflects real producer/consumer order.
- Parallel candidates do not imply an execution schedule.
- Scenario obligations are risk/state based.
- No repository or workflow state was mutated.

## Anti-Patterns

Never:

- persist the Plan Version directly;
- create `current_task_id`, `current_task_path`, or `dev_state`;
- execute code or tests;
- turn every technical layer into a separate phase;
- mandate generic failure variants without a traced risk;
- weaken accepted architecture or quality thresholds;
- leave old and new owners live without an accepted cutover;
- use Gate count as a planning quality metric.
- ask the user to review the entire plan model when project Review Skills can
  decide and remediate it.
