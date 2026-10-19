# Experience Reasoning Kernel - Decisions

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-19 | **Updated**: 2026-10-19
> **Owner**: Experience Design

---

## Decision Index

| ID | Decision | Status |
|---|---|---|
| EDX-D01 | Four-layer ownership with Product / Client semantic authority | accepted |
| EDX-D02 | Source-fenced facts, contracts, inferences and unproven points | accepted |
| EDX-D03 | Source-backed JourneyStateGraph | accepted |
| EDX-D04 | Deterministic primary Finding tuple | accepted |
| EDX-D05 | Contract-projected trust boundary review | accepted |
| EDX-D06 | Explicit local recovery contract | accepted |
| EDX-D07 | Findings-only result and independent prototype admission | accepted |
| EDX-D08 | Quality-owned holdout lifecycle and irreversible exposure | accepted |
| EDX-D09 | Minimal validator instead of the legacy control plane | accepted |

---

## EDX-D01: Four-Layer Ownership With Product / Client Semantic Authority

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

## EDX-D02: Source-Fenced Facts, Contracts, Inferences And Unproven Points

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

## EDX-D03: Source-Backed JourneyStateGraph

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

## EDX-D04: Deterministic Primary Finding Tuple

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

## EDX-D05: Contract-Projected Trust Boundary Review

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

## EDX-D06: Explicit Local Recovery Contract

**Status**: accepted
**Date**: 2026-10-19

### Context

The first blind run analyzed a disabled action's post-click path instead of
first detecting that no visible recovery action existed.

### Decision

Every recoverable blocker declares reason, visible entry, locality, preserved
state, return state and semantic return target. Implicit recovery is invalid.

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

## EDX-D07: Findings-Only Result And Independent Prototype Admission

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

## EDX-D08: Quality-Owned Holdout Lifecycle And Irreversible Exposure

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

## EDX-D09: Minimal Validator Instead Of The Legacy Control Plane

**Status**: accepted
**Date**: 2026-10-19

### Context

An earlier worktree contains a broad control plane with Lark-specific fixtures,
Ed25519 review attestations, historical evaluator replay, full grammar binding
and a large evaluator implementation. Those mechanisms do not address the
minimal reasoning gap proven by the blind run.

### Decision

The first implementation contains only closed schema validation, reference
validation, Journey graph checks, tuple recomputation, result validation and
focused fixtures. It reuses the four-layer boundary, Wireflow, findings-only
discipline, three-class calibration and L1-L4 evidence vocabulary.

### Rationale

This is the smallest architecture that directly falsifies the observed
reasoning failures without creating a parallel product or security platform.

### Alternatives Considered

- Port the prior implementation: rejected for excessive scope, unrelated
  complexity and domain-specific baggage.
- Keep the design prose-only: rejected because ranking and reference closure
  need deterministic verification.

### Consequences

Positive: lower maintenance cost and clearer ownership. Negative: semantic
candidate generation remains Agent/reviewer work rather than automatic code
analysis.
