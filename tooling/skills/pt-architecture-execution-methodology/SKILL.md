---
name: "pt-architecture-execution-methodology"
description: "Transforms an accepted architecture into an ordered, dependency-backed execution plan with atomic cutovers, deliverables, gates, and evidence. Invoke for planning only; it must not redesign or execute."
stage: "PLAN"
requires: ["accepted product contract when applicable", "accepted architecture docs"]
produces: ["dependency graph", "execution closures", "ordered step list", "acceptance scenarios per closure"]
next: "pt-plan-and-document"
---

# Architecture Execution Methodology

## Stage Contract

This skill owns **PLAN** only.

```text
accepted product and architecture contracts
  -> impact inventory
  -> dependency graph
  -> execution closures
  -> formal execution plan
  -> pt-execution-plan-guardian
  -> implementation and evidence
```

It consumes accepted outputs from `pt-product-design-methodology` when
applicable and `pt-architecture-design-methodology`, then answers:

- What current assets must change, move, or be deleted.
- Which workstreams own each deliverable.
- What depends on what.
- What can run in parallel.
- Where atomic cutovers are required.
- Which gates and evidence close each workstream and the whole plan.

It does **not**:

- Choose or revise architecture topology, ownership, protocols, invariants, or
  forbidden relationships.
- Accept an architecture on the owner's behalf.
- Implement code, update task status, or claim runtime readiness.
- Invent compatibility layers not present in the accepted design.

`pt-execution-plan-guardian` executes the resulting plan. It does not replace
this planning skill.

## Preconditions

Required inputs:

- Accepted architecture document paths.
- Accepted product document paths, capability/journey IDs, visible state
  contracts, and product acceptance matrix when the work is product-facing.
- Accepted decision IDs.
- Invariant and forbidden-relationship IDs.
- Target-state retention/deletion list.
- Required quality gates and evidence.
- Explicitly accepted open risks.

If any input is missing, stale, contradictory, or still `draft`/`proposed`,
return:

```text
PLAN_BLOCKED_BY_DESIGN
```

Name the exact missing architecture decision or contract. Do not silently fill
the gap inside the execution plan.

Use `PLAN_BLOCKED_BY_PRODUCT` instead when a product-facing plan lacks an
accepted product contract, confirmed required prototype, or complete
receiver-perspective acceptance matrix.

## Core Rule

Plan by:

```text
Architecture Contract
  -> Current-State Inventory
  -> Execution Closure
  -> Dependency Order
  -> Atomic Cutover
  -> Verifiable Delivery
```

An **execution closure** is the smallest deliverable that can be completed,
verified, and left internally consistent. It must not leave split ownership,
two live sources of truth, or a compatibility shim with no accepted removal
condition.

## Method

### Step 1. Bind The Plan To Architecture

Create a traceability table:

| Plan requirement | Product capability/journey | Architecture source | Decision/invariant | Required evidence |
|---|---|---|---|---|

Every product-facing plan item must trace through accepted product and
architecture requirements. Unmapped work is out of scope or requires a product
or architecture amendment.

### Step 2. Inventory The Current Impact Surface

Inspect the repository and enumerate:

- Current runtime entrypoints and owners.
- Public and internal contracts.
- Command/event registries and generated artifacts.
- Callers, consumers, stores, projections, and UI surfaces.
- Persistence, auth, logging, metrics, and diagnostics.
- Tests, fixtures, acceptance gates, scripts, docs, and knowledge entries.
- Old symbols, paths, and implementations that the target state deletes.

Do not trust architecture estimates for counts or file lists; derive the
inventory from the current tree.

### Step 3. Define Responsibility Workstreams

Split work by stable responsibility, not pages, files, teams, or exciting
features.

Each workstream defines:

- Responsibility and scope.
- Current assets.
- Target deliverables.
- Inputs and outputs.
- Dependencies.
- Architecture IDs it satisfies.
- Deletion obligations.
- Acceptance gates and evidence.

Examples for a transport re-architecture might be contract catalog, transport
runtime, admission/QoS, event reconciliation, data plane, security bootstrap,
consumer migration, and performance evidence. These are examples only; the
accepted architecture decides the real workstreams.

### Step 4. Rebuild The End-To-End Execution Closure

Walk representative lifecycles from start to finish:

- Startup and bootstrap.
- Authentication and account switch.
- Read and write command paths.
- Streaming and server-push paths.
- Cancellation and timeout.
- Disconnect, restart, and recovery.
- Overload and user-spam behavior.
- Large-payload/data-plane behavior.
- Shutdown and cleanup.

Map every lifecycle step to a workstream and deliverable. An unmapped step is a
plan gap; an undefined semantic is a design gap and must return to DESIGN.

### Step 5. Build The Dependency Graph

Order work from actual dependencies:

- Canonical contracts/catalog before generated adapters.
- Runtime substrate before consumers.
- Security/bootstrap before authenticated traffic.
- Admission/cancellation before load testing.
- Reconciliation semantics before event migration.
- Evidence instrumentation before readiness claims.
- Consumer migration before old-path deletion.
- Old-path deletion before final single-source gate.

Mark independent workstreams that may run in parallel. Do not convert the graph
into arbitrary phase numbering until dependencies are explicit.

### Step 6. Define Atomic Cutovers

For each replaced concern, state:

- New source of truth.
- Complete consumer inventory.
- Exact cutover condition.
- Old path to delete.
- Tree-wide search proving no live references remain.
- Rollback mechanism through version control or deployment rollback, not a
  permanent dual path unless the accepted architecture explicitly requires one.

If a clean cut cannot fit in one merge, define slices that are internally
complete and architecture-conformant. Do not call a half-migration complete.

### Step 7. Define Deliverables And Gates

Every plan item requires:

- Target files/directories or generated artifacts.
- Behavior delivered.
- Failure behavior delivered.
- Tests and deterministic checks.
- Runtime/acceptance scenario.
- Evidence path or report.
- Documentation/knowledge updates.
- Definition of done and explicit non-claims.

Quality gates come from the accepted architecture. The plan may make them
executable; it may not weaken thresholds or substitute a smoke test.

### Step 7b. Define Acceptance Scenarios (mandatory)

Every execution closure must produce an `acceptance.md` (or acceptance section
within the plan) containing end-to-end scenarios that:

1. **Are user-perspective** — Written as "User does X → System shows Y → User
   can then Z". Not internal implementation checks.
2. **Cover happy path and failure path** — At minimum: success, network error,
   timeout, invalid input, cancellation.
3. **Have binary pass/fail criteria** — Each scenario has an explicit expected
   behavior that can be verified with runtime evidence (screenshot, curl
   response, log line, DOM state).
4. **Are executable before S5 (delivery)** — The implementer must run every
   scenario and record pass/fail with evidence. A scenario without evidence is
   unproven, not passed.

Acceptance scenarios are authored during PLAN, not after implementation. They
define what "done" means before code is written. Implementation that passes all
scenarios is complete; implementation that fails any scenario is incomplete
regardless of code coverage or build status.

**Self-judgment rules (no user gate between steps)**:
- Agent verifies scenario coverage against the state machine: every transition
  must appear in at least one scenario. If coverage is complete, proceed.
- Agent does NOT ask the user to "confirm scenarios are correct" — scenarios
  derive mechanically from the design's state machine and contracts.
- Escalate to user ONLY when: (a) the design has an ambiguous product behavior
  that affects what "expected result" means, or (b) two valid UX patterns exist
  and the choice is a product preference.
- During implementation (S3/S4), run each scenario as soon as the code supports
  it. Do not wait until all code is written. A scenario that passes early stays
  passed; a scenario that fails gets fixed immediately.

Format:

```markdown
## Acceptance Scenarios

### AS-01: <scenario name>
- **Precondition**: <setup state>
- **Action**: <what the user does>
- **Expected**: <observable result>
- **Failure variant**: <what happens when X fails>
- **Evidence**: <how to prove it — screenshot / curl / log / DOM>
- **Status**: pending | pass | fail
```

### Step 8. Define Risk And Anti-Regression Work

Include:

- Positive success metrics.
- Regression and overload metrics.
- Security and data-loss failure modes.
- Performance baseline and comparison cells.
- Flaky/infra-noise policy.
- Fail-closed behavior when required evidence is missing.
- Review-system growth: invariant, pitfall, playbook, fixture, or gate updates
  exposed by the migration.

### Step 9. Write The Formal Execution Plan

Place plans under the nearest `execution-plans/` directory.

The plan must contain:

- Accepted architecture sources and IDs.
- Accepted product sources, capability/journey IDs, visible states, and
  receiver-perspective acceptance when applicable.
- Scope and non-scope.
- Current-state inventory.
- Responsibility workstreams.
- End-to-end lifecycle mapping.
- Dependency DAG and parallelizable units.
- Atomic cutover/deletion matrix.
- Deliverables, gates, commands, and evidence per workstream.
- Final readiness gate.
- Risks, non-claims, and escalation conditions.

Use date-prefixed names. Organize by stable responsibility when multiple plan
documents are needed.

## Plan Acceptance Gate

Return `PLAN_READY_FOR_EXECUTION` only when:

- Architecture inputs are accepted and unchanged.
- Product inputs are accepted and unchanged when applicable.
- Every plan item traces to architecture IDs.
- Current-state inventory is repository-backed.
- End-to-end lifecycles have no unmapped step.
- Dependencies and parallel units are explicit.
- Every replaced path has an atomic deletion closure.
- Every deliverable has failure behavior, gates, and evidence.
- The final gate proves the architecture's claimed outcome.
- No plan item silently redesigns the architecture.

The owner/reviewer approves the plan before execution.

## Handoff To Execution Guardian

The handoff package to `pt-execution-plan-guardian` is:

- Formal plan paths.
- Accepted architecture paths.
- Accepted product paths and product acceptance IDs when applicable.
- In-scope workstream/task IDs.
- Dependency and parallelization constraints.
- Per-task acceptance commands and evidence paths.
- Cutover/deletion obligations.
- Final readiness gate and prohibited claims.
- A plan-owned `Context Anchor` created through `pt-context-anchor`, with the
  verified worktree, branch, entry stage, first dependency-ready step, and
  initial evidence state.

## Design Escalation

During planning, return `DESIGN_AMENDMENT_REQUIRED` when:

- A lifecycle has undefined retry, replay, cancellation, ordering, auth,
  overload, or data-plane semantics.
- The current code reveals a runtime/trust boundary absent from the design.
- A plan item would violate an invariant or require a forbidden relationship.
- Required evidence cannot prove the architecture's central claim.
- A compatibility period or dual path becomes necessary but is not an accepted
  architecture decision.

Describe the gap and stop. Do not repair architecture inside the plan.

Return `PRODUCT_AMENDMENT_REQUIRED` when current repository evidence shows that
a required user journey, visible state, platform promise, benchmark
disposition, or receiver-perspective assertion is undefined or contradictory.
Do not repair product design inside the plan.

## Anti-Patterns

Never:

- Design topology or contracts inside an execution plan.
- Start planning from files without architecture IDs.
- Split only by frontend/backend/page/API.
- List phases without a dependency graph.
- Leave old/new paths coexisting without an accepted architecture decision.
- Define deliverables without failure behavior and evidence.
- Weaken architecture gates to make delivery easier.
- Execute code or mark progress while using this skill.
