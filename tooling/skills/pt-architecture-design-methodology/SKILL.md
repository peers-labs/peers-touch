---
name: "pt-architecture-design-methodology"
description: "Designs evidence-backed architecture boundaries, ownership, contracts, topology, failure semantics, and decisions. Invoke before execution planning whenever the target architecture is not yet accepted."
---

# Architecture Design Methodology

## Stage Contract

This skill owns **DESIGN** only.

```text
evidence-backed problem
  -> target architecture
  -> accepted design
  -> pt-architecture-execution-methodology
  -> formal execution plan
  -> pt-execution-plan-guardian
  -> implementation and evidence
```

It answers:

- What problem is verified, inferred, or still unknown.
- What runtime units, trust boundaries, owners, and sources of truth exist.
- What calls, dependencies, state transitions, and failure behaviors are
  allowed or forbidden.
- What contracts and invariants define the target state.
- Which alternative is selected and what negative consequences it carries.
- What evidence will prove the architecture meets its claimed quality outcome.

It does **not**:

- Split work into phases, tasks, owners, or dependency order.
- Select implementation sequencing or migration batches.
- Track progress or execute code.
- Turn an unverified diagnosis into an architecture fact.
- Preserve compatibility merely to make implementation easier.

Use `pt-architecture-execution-methodology` only after the architecture is
accepted. Use `pt-execution-plan-guardian` only after a formal execution plan
exists.

## Source Basis

Read these before designing:

- `docs/README.md`
- `docs/global/architecture-document-standard.md`
- `docs/global/architecture.md`
- `docs/global/first-principles.md`
- `docs/knowledge/playbooks/documenting-large-requirements.md`
- The nearest domain and platform sources for every path in scope.
- Relevant `docs/knowledge/` invariants, pitfalls, and playbooks.

Repository sources constrain the design. External documentation and runtime
evidence may establish platform behavior. Unsupported rules remain proposals,
not repository facts.

## Evidence Discipline

Every material statement must be classified:

| Class | Meaning | May constrain the target architecture? |
|---|---|---|
| `verified_fact` | Confirmed by source code, official docs, trace, benchmark, or reproducible test | Yes |
| `inference` | Reasonable conclusion from verified facts, with reasoning shown | Yes, but must retain uncertainty |
| `hypothesis` | Plausible explanation not yet verified | No; requires an evidence gate |
| `proposal` | New relationship, contract, invariant, or policy | Yes, as a proposed decision |
| `accepted_decision` | Proposal explicitly approved by the owner/reviewer | Yes; downstream plans must conform |

For performance, reliability, concurrency, security, or data-loss architecture:

- A comparative symptom such as "web is fast, native is slow" is evidence of a
  boundary difference, not proof of a specific root cause.
- Root-cause claims require runtime evidence at the affected runtime boundary.
- If evidence cannot be collected yet, design the diagnostic contract first and
  keep irreversible topology decisions in `proposed` status.
- Quantitative claims require a measurement method, workload, runtime profile,
  sample policy, and acceptance threshold.

## Method

### Step 1. Classify The Design Level

Output:

- Target documentation layer and why it owns the decision.
- Upstream sources that constrain it.
- Downstream documents and code that must conform.
- Decisions that belong to another layer and are out of scope.

Architecture defines allowed relationships and target-state truth. Platform
documents refine implementation without redefining those boundaries.

### Step 2. Establish The Evidence Ledger

Before selecting a topology, create a compact ledger:

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|

Required actions:

- Inspect the current implementation rather than relying on remembered counts or
  framework folklore.
- Use official framework/runtime sources for platform semantics.
- For runtime incidents, identify the trace or benchmark that can falsify the
  leading hypothesis.
- Correct conflicting evidence before continuing.

Stop with `DESIGN_EVIDENCE_BLOCKED` when a central root-cause claim is only a
hypothesis and the target design would be expensive or irreversible.

### Step 3. Define Scope And Non-Scope

Output:

- Capabilities and quality outcomes this architecture defines.
- Explicit non-goals.
- Runtime units, layers, platforms, and trust boundaries in scope.
- Current sources that remain upstream.
- Existing paths that will be replaced, retained, or deleted in the target
  state.

Do not introduce phases or task sequencing here.

### Step 4. Establish Sources Of Truth And Ownership

Default repository ownership:

- Station owns cross-end business truth.
- Model owns shared contract semantics.
- Each client owns device-local UI state and runtime orchestration.

Output:

- Source-of-truth table.
- Capability owner and mutation authority.
- State that must not be duplicated.
- Canonical contract roots.
- Exceptions with rationale and consequences.

### Step 5. Define Runtime Units And Boundaries

Output:

- Runtime/process units and lifecycle owners.
- Data flow and control flow.
- Trust and authentication boundaries.
- Local-only versus shared responsibilities.
- Allowed calls and dependencies.
- Forbidden calls and dependencies.

Architecture is incomplete without forbidden relationships.

### Step 6. Define Contracts And Operational Semantics

Contracts must cover happy paths and failure paths.

Required where applicable:

- Request, response, event, stream, storage, and bootstrap contracts.
- Lifecycle or state-machine transitions.
- Ordering, delivery, replay, and deduplication semantics.
- Idempotency rules for reads and writes.
- Cancellation, timeout, disconnect, and retry behavior.
- Authentication bootstrap and credential rotation.
- Backpressure, bounded admission, overload rejection, and fairness/QoS.
- Multi-window, multi-client, and shutdown behavior.
- Control-plane versus data-plane separation and large-payload limits.
- Versioning and compatibility expectations.
- Schema validation and typed errors.

Use proto-first contracts for cross-platform/inter-app semantics. Do not replace
typed contracts with unversioned `string + unknown` envelopes unless the
architecture records why and how validation remains canonical.

### Step 7. Design Component Relationships

Every component definition must include:

- Responsibility and owner.
- Inputs and outputs.
- Dependencies.
- Source of truth it may read or mutate.
- Lifecycle.
- Resource and concurrency model.
- What it must not know, import, or execute.

Every `design.md` includes core principles, a system diagram, contracts,
component relationships, and endpoints/APIs when applicable.

### Step 8. Define Quality Outcomes And Architecture Gates

The architecture must define how its central claim becomes falsifiable.

Output:

- Product/runtime scenarios that represent real use.
- Baseline and target metrics.
- P50/P95/P99 or equivalent policy.
- Load, spam-click, slow dependency, disconnect, restart, and large-payload
  scenarios where relevant.
- Required runtime cells, including packaged/native cells for native claims.
- Fail-closed behavior when evidence is missing.
- Observability needed to attribute failures to components.

"Uses WebSocket", "uses async", "has a thread pool", or "tests pass" are
implementation facts, not proof of responsiveness or reliability.

### Step 9. Record Decisions And Alternatives

Each ADR-lite decision includes:

- Context, with evidence classes preserved.
- Decision.
- Rationale.
- Alternatives and why they were rejected.
- Positive and negative consequences.
- Reversal trigger or review condition for uncertain decisions.

Do not cite industry adoption as proof that an option fits this workload.

### Step 10. Select The Required Document Set

Always:

- `README.md`
- `design.md`
- `decisions.md`

Mandatory, not optional, when triggered:

- `data-model.md`: protocol, state machine, delivery semantics, persistence, or
  type mapping is material.
- `integration.md`: replacing or restructuring an existing system, or crossing
  multiple modules/runtimes.
- `module-layout.md`: the target module tree or single registration/source-of-
  truth structure is necessary to prevent duplication.

`execution-plans/` is not authored by this skill.

### Step 11. Run The Design Acceptance Gate

Return `DESIGN_READY_FOR_REVIEW` only when:

- Evidence ledger distinguishes fact, inference, hypothesis, and proposal.
- Central root-cause claims are verified or explicitly deferred behind a
  diagnostic gate.
- Scope, ownership, runtime boundaries, allowed/forbidden relationships, and
  target deletions are explicit.
- Contracts cover overload, retry, idempotency, cancellation, ordering,
  lifecycle, security, and large payloads where relevant.
- Quality outcomes have executable evidence requirements.
- Required document set is complete and discoverable.
- Decisions include negative consequences and alternatives.
- No execution phases or implementation status are disguised as architecture.

The owner/reviewer must explicitly accept the architecture. Until then, its
status remains `draft` or `proposed`.

## Handoff To Execution Planning

The handoff package to `pt-architecture-execution-methodology` is:

- Accepted architecture document paths.
- Accepted decision IDs.
- Invariant and forbidden-relationship IDs.
- Target-state deletion/retention list.
- Required quality gates and evidence.
- Open risks explicitly accepted by the owner.

The execution-planning skill may decompose this package. It may not redesign it.

## Anti-Patterns

Never:

- Treat correlation as causation or a comparison as root-cause proof.
- Start with files, phases, or tasks before target ownership and contracts.
- Mix execution sequencing into architecture design.
- Leave retry, replay, overload, cancellation, or auth bootstrap undefined.
- Use unbounded queues while claiming backpressure.
- Claim responsiveness without a packaged-runtime performance gate.
- Mark protocol/integration documents optional when their trigger applies.
- Turn a proposal into a repository rule without acceptance.
