# Experience Design Control Plane - Decisions

Current executable refinements remain within EDX-20261018:
package linkage and fresh admission are governed by ReviewResult section 2/10;
state ordering is a total order by distance, explicit origin/order and source;
recovery declarations realize graph edges and returns from the blocked source.
Historical blind integrity uses frozen snapshot bindings, while current
evaluation has separate evidence authority. These tighten existing promises
without replacing Product/Client semantics or independent judgment.

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-10-18 | **Updated**: 2026-10-22
> **Owner**: Developer Experience / Product Design

---

## Decision Index

| ID | Decision | Status |
|---|---|---|
| EDX-D01 | Canonical contract stack outside Skills | accepted |
| EDX-D02 | Wireflow before high fidelity | accepted |
| EDX-D03 | Concept-level semantic redundancy | accepted |
| EDX-D04 | Journey-owned path cost vectors | accepted |
| EDX-D05 | Machine-readable UI Grammar binding | accepted |
| EDX-D06 | Findings-only evaluator and independent acceptance | accepted |
| EDX-D07 | Three-class calibration | accepted |
| EDX-D08 | Fail-closed trace and evidence | accepted |
| EDX-RK-D01 | Product / Client semantic authority | accepted |
| EDX-RK-D02 | Source-fenced reasoning records | accepted |
| EDX-RK-D03 | Source-backed JourneyStateGraph | accepted |
| EDX-RK-D04 | Deterministic primary Finding tuple | accepted |
| EDX-RK-D05 | Contract-projected trust review | accepted |
| EDX-RK-D06 | Explicit local recovery contract | accepted |
| EDX-RK-D07 | Independent prototype admission | accepted |
| EDX-RK-D08 | Quality-owned fresh holdout lifecycle | accepted |
| CER-D01 | Identity-neutral paired observation | accepted |
| CER-D02 | Frozen Outcome Oracle with rerun-on-amendment | accepted |
| CER-D03 | Blind delta before identity reveal | accepted |
| CER-D04 | Three-level causal claim | accepted |
| CER-D05 | Non-weighted material-delta priority | accepted |
| CER-D06 | Reviewed proposal-only Target Contract projection | accepted |
| CER-D07 | Blind A/B required for framework value | accepted |

---

## EDX-D01: Canonical Contract Stack Outside Skills

**Status**: accepted
**Date**: 2026-10-18

### Context

Product and Prototype Skills contain useful rules, but a Skill is an execution
adapter. Duplicating design truth across Skills causes drift and makes other
hosts unable to consume the same contracts.

### Decision

The architecture and client methodology own the contract stack. Skills only
bind their workflow to those sources and the machine evaluator.

### Rationale

One source keeps product, prototype, review and quality consumers aligned while
allowing host-specific execution instructions to remain thin.

### Alternatives Considered

- Put all rules in `pt-prototype-design`: rejected because Product and Review
  would depend on one execution adapter.
- Create a new broad design Skill: rejected because existing Product and
  Prototype owners already cover the lifecycle.

### Consequences

Positive: one durable source and no parallel methodology Skill. Negative:
changes require coordinated docs, bindings, tests and Skill references.

## EDX-D02: Wireflow Before High Fidelity

**Status**: accepted
**Date**: 2026-10-18

### Context

Visual prototypes currently expose path and state defects after component work
has already biased the solution.

### Decision

Material UI requires a traced Wireflow before high-fidelity implementation.
The Wireflow contains surfaces, concepts, actions, states and transitions.

### Rationale

Wireflow is cheap to change and exposes semantic or path errors without visual
polish hiding them.

### Alternatives Considered

- Start directly in high fidelity: rejected because late semantic changes are
  expensive and tend to become local patches.
- Use prose only: rejected because transitions and reachable states remain
  ambiguous.

### Consequences

Positive: earlier correction and stronger traceability. Negative: one explicit
artifact is added for material UI work; trivial local UI fixes remain exempt.

## EDX-D03: Concept-Level Semantic Redundancy

**Status**: accepted
**Date**: 2026-10-18

### Context

Exact duplicate-string checks miss paraphrased repetition, while lexical
similarity rules overreject product names, accessibility labels and separated
contexts.

### Decision

Copy nodes bind to concept IDs and per-scope occurrence budgets. Exceptions
must name a safety, accessibility or context-separation reason.

### Rationale

The defect is duplicate meaning, not duplicate tokens. Explicit concept
binding makes the judgment reviewable and supports boundary fixtures.

### Alternatives Considered

- Pure string similarity: rejected as both under- and over-inclusive.
- Human review only: rejected because known recurrence can be detected before
  rendering.

### Consequences

Positive: detects repeated meaning such as redundant Station-selection labels.
Negative: authors must annotate material copy concepts; the tool still cannot
judge prose quality by itself.

## EDX-D04: Journey-Owned Path Cost Vectors

**Status**: accepted
**Date**: 2026-10-18

### Context

A universal click budget ignores risk, reversibility and necessary permission
moments. A single weighted score can also hide one unacceptable dimension.

### Decision

Each Journey defines component-wise budgets for commitments, context switches,
decision load, interruptions and recovery debt. The evaluator derives the
candidate vector from accepted action contracts, surface contexts, transitions
and preservation requirements; a candidate cannot submit an authoritative
aggregate.

### Rationale

The vector preserves why a path is costly and lets a destructive path differ
legitimately from a frequent low-risk path.

### Alternatives Considered

- Maximum three clicks: rejected as context-free.
- Weighted aggregate score: rejected because a low dimension can cancel a
  severe failure.

### Consequences

Positive: explicit tradeoffs and no universal interaction folklore. Negative:
the Product owner must set budgets from Journey evidence.

## EDX-D05: Machine-Readable UI Grammar Binding

**Status**: accepted
**Date**: 2026-10-18

### Context

Human-readable UI Identity defines roles but tools cannot verify that a
semantic action or state is bound to an allowed component family on each
platform.

### Decision

Add one closed JSON binding from semantic roles to UI Identity roles,
representation-specific requirements and Desktop/Mobile adapter families.

### Rationale

The binding prevents ad hoc action representation without freezing transient
component imports or pixel values.

### Alternatives Considered

- Parse Markdown heuristically: rejected as unstable.
- Hardcode rules in evaluator source: rejected because UI Identity would lose
  ownership.

### Consequences

Positive: machine-consumable grammar with UI Identity as owner. Negative:
binding and human docs must evolve together.

## EDX-D06: Findings-Only Evaluator And Independent Acceptance

**Status**: accepted
**Date**: 2026-10-18

### Context

An evaluator that authors, mutates and approves the same contract can
manufacture its own success.

### Decision

The evaluator is read-only and returns findings plus evidence readiness. It
never returns `passed`. Acceptance requires a reviewer distinct from the
contract, candidate, evidence and expectation authors. The review receipt binds
the case, contract, candidate and result digests; the evaluator cannot create
the receipt. Authors, evidence inspectors and reviewers use stable workflow
principal IDs. Independence is enforced by ID non-overlap and exact digest
binding, not by a repository-owned certificate authority or user-managed keys.

### Rationale

This preserves reviewer independence while keeping deterministic checks cheap
and repeatable.

### Alternatives Considered

- Auto-fix contracts: rejected because it changes product intent.
- Auto-pass on zero findings: rejected because visual and semantic judgment
  still require an independent owner.
- Ed25519 author/reviewer signatures: rejected because the control plane has no
  production identity issuer or host signing path, cryptographic proof is not a
  product requirement, and user-managed keys would make ordinary Agent
  injection unusable without strengthening semantic review.

### Consequences

Positive: no self-certification. Negative: a separate review pass remains
mandatory even when deterministic findings are empty. Principal IDs prove
workflow separation only; external identity assurance, if ever required by a
deployment boundary, must be supplied by that boundary rather than duplicated
inside Experience Design.

## EDX-D07: Three-Class Calibration

**Status**: accepted
**Date**: 2026-10-18

### Context

Rules derived only from defects overfit those defects and suppress valid
alternatives.

### Decision

Every enforceable rule must have positive, negative and boundary fixtures.
Fixture validation checks coverage and expected findings; it does not claim
model conformance. Blind holdouts are excluded from calibration discovery.
Their first evaluation is digest-bound, independently reviewed, and can only
seed a new calibration fixture through a receipt reference; the holdout itself
never gains an expectation.

### Rationale

Three classes define the acceptance area, rejection area and deliberate
judgment boundary.

### Alternatives Considered

- Negative regressions only: rejected as overfitting.
- Large screenshot corpus without expected rules: rejected as unreviewable.

### Consequences

Positive: safer generalization. Negative: each new rule carries fixture
maintenance cost.

## EDX-D08: Fail-Closed Trace And Evidence

**Status**: accepted
**Date**: 2026-10-18

### Context

Missing evidence is often interpreted as acceptable, and prototypes can drift
from accepted Journey contracts without a deterministic signal.

### Decision

Missing required layers, unknown grammar roles, conflicting transitions,
contract/candidate drift and absent exact evidence cells are blocking or
`UNPROVEN`; none default to pass. Evidence matching includes source/artifact
digests, platform, runtime profile, input mode, locale/content condition,
state/assertion IDs and metric environment where applicable.

### Rationale

Explicit non-claims are safer than polished but untraceable output.

### Alternatives Considered

- Warn and continue: rejected for material contracts because later artifacts
  would build on ambiguity.
- Require L4 for every draft: rejected because early Wireflow work has no
  runtime claim.

### Consequences

Positive: honest evidence boundary and early drift detection. Negative: authors
must declare claim scope so the required evidence level is known.

---

## EDX-RK-D01: Four-Layer Ownership With Product / Client Semantic Authority

**Status**: accepted
**Date**: 2026-10-19

### Context

The first blind run exposed reasoning gaps, but the corrective design must not
turn an engineering review tool into a second Product or runtime authority.

### Decision

Product / Client contracts own Journey, trust, recovery and platform semantics.
The Kernel owns review procedure, schema and ranking. Prototype Compiler
consumes accepted results. Quality owns holdout, key, scoring and promotion.

### Rationale

The split lets one review procedure operate across domains without hardcoding
Station, Federation or any other business state machine.

### Alternatives Considered

- Put product truth in the Kernel: rejected because it creates a competing
  source of truth.
- Put ranking and holdout policy in Prototype tooling: rejected because the
  producer would control its own acceptance.

### Consequences

Positive: ownership is explicit and domain-neutral. Negative: a missing
Product / Client contract remains a visible `UNPROVEN` gap instead of being
filled automatically.

## EDX-RK-D02: Source-Fenced Facts, Contracts, Inferences And Unproven Points

**Status**: accepted
**Date**: 2026-10-19

### Context

UI/UX findings become unreliable when source observations, accepted promises
and reviewer conclusions are mixed into one prose statement.

### Decision

Every run binds exact package, case, source, manifest, rubric and source blobs.
Every Finding references closed fact, contract and inference records. Material
unknowns are recorded separately as unproven.

### Rationale

Closed references make a report auditable and prevent remembered or ambient
source from silently changing its meaning.

### Alternatives Considered

- Free-form Markdown only: rejected because references and priority cannot be
  validated.
- Source citations without contract IDs: rejected because observed behavior
  alone does not establish a broken product promise.

### Consequences

Positive: findings are reproducible. Negative: reviewers must structure the
reasoning before freezing a report.

## EDX-RK-D03: Source-Backed JourneyStateGraph

**Status**: accepted
**Date**: 2026-10-19

### Context

The first blind run sometimes prioritized later implementation risks over an
earlier visible product failure. A simple case-file order is not sufficient
when source reveals additional reachable states.

### Decision

Build one JourneyStateGraph with starting, explicit and derived states plus
source-backed action/response edges. State ordinal is the shortest reachable
action distance from entry, with deterministic tie-breakers.

### Rationale

Reachability and earliest user exposure become explicit, while cycles do not
distort priority.

### Alternatives Considered

- Put every derived state after every explicit state: rejected because an early
  trust blocker could be displaced by a later explicit ambiguity.
- Use source line order: rejected because file layout is not user order.

### Consequences

Positive: earliest failure is mechanically locatable. Negative: the reviewer
must model the bounded graph and cite its edges.

## EDX-RK-D04: Deterministic Primary Finding Tuple

**Status**: accepted
**Date**: 2026-10-19

### Context

Several valid secondary findings obscured the calibrated core failures in the
first blind run.

### Decision

Filter to in-scope, reachable candidates with visible action and response, then
sort by contract strength, impact, state ordinal, explicit coverage, severity,
confidence and ASCII candidate ID. The tuple is non-weighted and recomputable.

### Rationale

Contract-backed user outcome failures cannot be averaged away or displaced by
implementation risk and polish.

### Alternatives Considered

- Weighted score: rejected because low-value dimensions can cancel a critical
  failure.
- Reviewer-chosen primary without ledger: rejected because selection drift
  cannot be diagnosed.

### Consequences

Positive: primary choice is stable and auditable. Negative: semantic
classification remains a reviewer judgment and must be independently checked.

## EDX-RK-D05: Contract-Projected Trust Boundary Review

**Status**: accepted
**Date**: 2026-10-19

### Context

The blind run separated reachability from verification in one case but failed
to propagate identity and scope meaning in another.

### Decision

TrustBoundaryCheck projects only accepted transition semantics: diagnostic
versus identity evidence, scope effect, next Gate, failure meaning, visible
consequences and previous-scope exposure.

### Rationale

The same procedure can review different domains while the owning domain keeps
authority over the actual trust and runtime protocol.

### Alternatives Considered

- Hardcode Station switching generations and quiesce behavior: rejected as an
  ownership violation and unnecessary runtime design.
- Treat reachability as trust: rejected by current Station access contracts.

### Consequences

Positive: trust reasoning is consistent without domain duplication. Negative:
incomplete upstream trust contracts fail as unproven.

## EDX-RK-D06: Explicit Local Recovery Contract

**Status**: accepted
**Date**: 2026-10-19

### Context

The first blind run analyzed a disabled action's post-click path instead of
first detecting that no visible recovery action existed.

### Decision

Every recoverable blocker declares reason, visible entry, locality, preserved
state, return state and semantic return target. Implicit recovery is invalid.
Exit, retry and requested-outcome recovery are distinct: an exit cannot
reference a `RecoveryPath`, while retry and recovery must.

### Rationale

Recovery must be available from the user's visible failure, not hidden in
implementation knowledge or an unnamed nearby surface.

### Alternatives Considered

- Accept close-and-reopen as generic recovery: rejected because it can discard
  context and is not always visible.
- Require same-surface recovery universally: rejected because an explicitly
  named adjacent surface can be valid.

### Consequences

Positive: missing recovery becomes directly reviewable. Negative: adjacent
recovery must include explicit navigation and return semantics.

## EDX-RK-D07: Findings-Only Result And Independent Prototype Admission

**Status**: accepted
**Date**: 2026-10-19

### Context

An evaluator that treats zero findings as approval can certify its own blind
spots.

### Decision

The Kernel emits `FINDINGS` or `NO_BLOCKING_FINDING`, never `PASS`. Prototype
Compiler requires a current exact binding, no blocking finding, an independent
accepted review and no unproven cell required for review or high fidelity.

### Rationale

Deterministic checks and independent design judgment remain separate.

### Alternatives Considered

- Auto-approve an empty Finding list: rejected because visual and semantic
  judgment are not mechanically proven.
- Let Prototype proceed with warnings about stale input: rejected because
  downstream polish would hide an invalid review basis.

### Consequences

Positive: no self-certification. Negative: even a clean deterministic result
needs one independent review.

## EDX-RK-D08: Quality-Owned Holdout Lifecycle And Irreversible Exposure

**Status**: accepted
**Date**: 2026-10-19

### Context

A previously seen case cannot demonstrate generalization, and post-hoc
integrity failures must revoke promotion without rewriting history.

### Decision

Quality owns the sealed-to-retired lifecycle, immutable Exposure Ledger,
scoring and Promotion Ledger. Exposure is written at sealing and permanently
disqualifies the case from future fresh holdouts. Sealing atomically binds the
run envelope and all exposure entries. Retirement atomically binds score and
promotion. Later defects append a promotion revocation.

### Rationale

The policy prevents answer leakage, run reuse and retroactive relabeling.

### Alternatives Considered

- Allow aborted cases to return to the pool: rejected because the runner may
  already have seen them.
- Rewrite a retired run after a defect: rejected because it destroys the audit
  trail.

### Consequences

Positive: promotion evidence is honest and revocable. Negative: holdout cases
are consumable resources and require ongoing replenishment.

---

## CER-D01: Identity-Neutral Paired Observation

**Status**: accepted
**Date**: 2026-10-22

### Context

Putting a reference product directly into Peers ExperienceContract or UI
Grammar would judge it by Peers-specific identity and component rules before
the user outcome is compared.

### Decision

Both legs first project to the same closed `JourneyObservation` shape. The
projection contains only visible facts, states, actions, recovery and evidence.
Only the revealed Peers leg additionally binds its current EDX case and result.

### Rationale

The shared comparison substrate must be product-identity neutral while Peers
ownership and drift classification remain available after reveal.

### Alternatives Considered

- Evaluate both products as Peers Experience Cases: rejected as structurally
  biased.
- Compare screenshots directly: rejected because dynamic outcome, recovery and
  authority are not visible in one image.

### Consequences

Positive: the reference is evidence rather than authority. Negative:
normalization and an independent leg review add authoring cost.

## CER-D02: Frozen Outcome Oracle With Rerun-On-Amendment

**Status**: accepted
**Date**: 2026-10-22

### Context

Benchmark discovery can reveal a valuable outcome, but changing the evaluation
standard after seeing the paired result creates circular proof.

### Decision

Discovery may propose an Oracle amendment. Once paired evaluation begins, the
Oracle and Comparison Context are digest-bound. Any accepted amendment creates
a new run and requires both legs to be recaptured or reevaluated.

### Rationale

Product learning remains possible without allowing post-hoc score adjustment.

### Alternatives Considered

- Immutable Oracle before all benchmark discovery: rejected because it blocks
  legitimate product learning.
- Edit the active Oracle in place: rejected because historical results become
  uninterpretable.

### Consequences

Positive: comparison criteria are auditable. Negative: an amended outcome
invalidates otherwise usable leg results.

## CER-D03: Blind Delta Before Identity Reveal

**Status**: accepted
**Date**: 2026-10-22

### Context

A reviewer who knows which leg is Peers can unconsciously classify every
difference as a Peers defect or a benchmark advantage.

### Decision

Leg A and B have identical blind schemas. `BlindedDelta` and its independent
review freeze before a sealed IdentityMap can be read. Owner, delta kind and
adopt/adapt/reject/defer are generated only after reveal by a different
reviewer.

### Rationale

Evidence judgment and Peers product judgment are distinct decisions with
different bias surfaces.

### Alternatives Considered

- One reviewer sees identities throughout: rejected because evidence and brand
  prior cannot be separated.
- Hide identity only in the final report: rejected because ranking and causal
  wording would already be contaminated.

### Consequences

Positive: materiality is identity-neutral. Negative: two review boundaries and
one sealed identity artifact are required.

## CER-D04: Three-Level Causal Claim

**Status**: accepted
**Date**: 2026-10-22

### Context

An observed result difference does not prove why it occurred. Existing
`causalMechanism` is an authored Finding field, not intervention evidence.

### Decision

CER distinguishes:

- `differential-observed`;
- `mechanism-supported`;
- `intervention-confirmed`.

Only the last may be described as a proven causal mechanism.

### Rationale

The language of the result must not be stronger than its evidence.

### Alternatives Considered

- Call every coherent explanation a root cause: rejected as overclaim.
- Forbid causal hypotheses without an experiment: rejected because a supported
  mechanism is still useful when labeled honestly.

### Consequences

Positive: findings retain uncertainty and a falsifier. Negative: important
recommendations may remain supported rather than proven until a prototype or
runtime intervention exists.

## CER-D05: Non-Weighted Material-Delta Priority

**Status**: accepted
**Date**: 2026-10-22

### Context

An averaged score can let visual polish cancel a safety, trust, blocked-outcome
or missing-recovery failure.

### Decision

Material deltas sort lexicographically by Oracle criticality, outcome block,
trust/recovery impact, earliest divergent state, Journey frequency, user work
at risk, causal status, confidence and stable ID.

### Rationale

The tuple preserves the reason a gap matters and remains mechanically
recomputable.

### Alternatives Considered

- Weighted quality score: rejected because severe dimensions can be averaged
  away.
- Reviewer-selected primary without a tuple: rejected because priority drift
  cannot be diagnosed.

### Consequences

Positive: material product failures stay visible. Negative: CER cannot provide
a simple product leaderboard number.

## CER-D06: Reviewed Proposal-Only Target Contract Projection

**Status**: accepted
**Date**: 2026-10-22

### Context

Benchmark findings should become executable product proposals, but an
engineering evaluator must not modify Product authority.

### Decision

Only independently accepted `adopt` or `adapt` decisions can be projected to a
digest-bound `TargetContractDelta`. The projection remains a proposal until the
owning Product / Client contract accepts it.

### Rationale

The framework closes the path from evidence to executable acceptance without
letting the benchmark or evaluator become product truth.

### Alternatives Considered

- Emit prose recommendations only: rejected because implementation can drift
  again.
- Auto-amend active contracts: rejected as an ownership violation.

### Consequences

Positive: accepted findings have Journey, state, acceptance and evidence
targets. Negative: a separate Product acceptance boundary remains mandatory.

## CER-D07: Blind A/B Required For Framework Value

**Status**: accepted
**Date**: 2026-10-22

### Context

Source tests can prove deterministic mechanics but cannot prove CER finds
better product gaps than the current benchmark workflow.

### Decision

Framework incremental value remains `UNPROVEN` until a Quality-owned sealed
A/B compares the current workflow with CER on fresh hidden cases, with
pre-frozen answer keys, exposure burn, hard failures and promotion criteria.

### Rationale

The framework's central value claim must be falsifiable and independent of its
authors.

### Alternatives Considered

- Treat calibration success as value proof: rejected because visible fixtures
  are training inputs.
- Self-score one known comparison: rejected because it cannot establish
  generalization.

### Consequences

Positive: value claims remain honest. Negative: implementation completion and
framework promotion are separate milestones.
