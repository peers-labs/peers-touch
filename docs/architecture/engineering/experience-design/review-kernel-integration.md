# Experience Design Control Plane - Reasoning Kernel Integration

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-19 | **Updated**: 2026-10-19
> **Owner**: Experience Design

---

This document refines [integration.md](./integration.md) for source-fenced
semantic review and Quality-owned blind validation. The canonical Product,
Prototype, UI Identity and Quality integration remains defined by the parent
control plane.

## 1. Existing Source Mapping

| Source | Retained responsibility | Kernel integration |
|---|---|---|
| `docs/client/common/ux-design-methodology.md` | UX dimensions and case-to-contract discipline | Supplies review lenses; does not become a rule table |
| Product architecture documents | Journey, outcome, trust and recovery truth | Highest-strength contract references |
| Client platform contracts | Desktop/Mobile semantics and adaptation | Platform contract references |
| UI Identity documents | Visual, interaction and accessibility contracts | Contract references and later craft review |
| `pt-product-design-methodology` | Product thesis, Journey, states and acceptance | Produces accepted upstream semantics |
| `pt-prototype-design` | Wireflow, runnable prototype and evidence | Consumes independently accepted ReviewResult |
| `pt-quality-check` | Quality evidence aggregation | Reports binding, findings, review and unproven state |
| `pt-github-review` | Final review judgment | Consumes Kernel output; keeps merge authority |
| `quality/blind-validation/` | Isolated cases, rubric and answer key | Quality-owned calibration and fresh holdout input |

The Kernel adds a shared review procedure between accepted product truth and
Prototype compilation. It does not replace any existing owner.

## 2. Product And Client Integration

For each material UI/UX review, upstream sources must identify:

- the bounded Journey and promised outcome;
- explicit visible states and success/failure meanings;
- trust-sensitive transitions;
- scope consequences and the next required Gate;
- recoverable blockers and state that must survive;
- platform adaptations that preserve shared intent.

Missing semantics remain `UNPROVEN`. The Kernel cannot repair a Product or
Client contract while reviewing its consumer.

When rubric and accepted contract conflict:

1. freeze the report as invalid;
2. cite both sources;
3. route the conflict to the source owners;
4. do not rank a Finding from the conflicting clause.

## 3. Review Integration

The review owner:

1. verifies the source fence;
2. authors facts, contract references and inferences;
3. builds the bounded JourneyStateGraph;
4. records trust and recovery projections where relevant;
5. creates an exhaustive candidate ledger;
6. runs deterministic validation and ranking;
7. freezes the ReviewResult;
8. performs an independent findings-first review.

Deterministic tooling checks shape, references, graph reachability, ordering,
tuple recomputation and hashes. The independent reviewer checks whether the
semantic facts, contracts, inferences and impact classes are truthful.

## 4. Prototype Compiler Integration

Prototype Compiler admission is fail closed:

```text
current exact binding
AND verdict = NO_BLOCKING_FINDING
AND independent review = accepted
AND no review/high-fidelity unproven remains
  -> high-fidelity admission
```

Any other result returns to the owning source:

| Condition | Owner |
|---|---|
| Broken or missing product promise | Product domain |
| Missing trust/scope/next-Gate meaning | Product or Client contract owner |
| Missing visible recovery | Product interaction/state owner |
| Platform semantic drift | Desktop or Mobile Client owner |
| Stale or invalid source binding | Review runner |
| Missing L1-L4 evidence | Prototype/runtime evidence owner |
| Incorrect ranking tuple | Kernel implementation |

Wireflow and high-fidelity artifacts preserve the accepted Journey, state,
action and evidence IDs. A visual redesign cannot silently amend them.

## 5. Evidence Integration

Evidence is layered:

- L1 proves current contracts, source binding, graph and trace.
- L2 proves inspected visual states.
- L3 proves real transitions, retry, cancellation and return.
- L4 proves runtime, accessibility, performance or receiver-visible claims.

The Kernel validates evidence references and records missing cells. Prototype
and runtime owners produce the artifacts. Quality decides whether the selected
proof obligation is satisfied.

Screenshot existence alone does not prove L2. A source test alone does not
prove L3 or L4.

## 6. Calibration Integration

Focused Kernel fixtures use three classes:

- `positive`: a complete result with no blocking false positive;
- `negative`: one intentional schema, graph, recovery or ranking violation;
- `boundary`: a legal edge case such as named-adjacent recovery, a derived
  state at equal distance, or platform-specific return target.

These fixtures prove validator behavior only. They are visible training inputs
and cannot become fresh promotion cases.

The existing EDX-B01 through EDX-B06 package is retained as a frozen baseline
and training set. Its reports may verify that known reasoning failures are now
representable, but its score cannot promote the revised Kernel.

## 7. Quality Holdout Integration

Fresh promotion uses a new sealed package whose hidden challenge classes cover:

- primary visible blocker;
- trust-boundary propagation;
- recovery locality;
- positive-control non-finding;
- evidence boundary;
- cross-platform semantic parity.

Quality:

- atomically seals the run envelope and writes every case digest to Exposure
  Ledger;
- reveals cases to the runner without the answer key;
- freezes a complete report hash before scoring;
- opens the key only in `scoring`;
- atomically retires the run with score and promotion decision;
- appends revocation if later integrity evidence invalidates a promotion.

Kernel code and Skills cannot read or mutate these Quality decisions.

## 8. Skill Integration

Skills remain thin consumers:

- Product Skill cites this module when preparing reviewable Journey, trust and
  recovery semantics.
- Prototype Skill requires a valid admission decision before high fidelity.
- Quality Skill validates source binding, frozen reports, exposure and
  promotion policy.

Skills must not copy the ranking table, redefine holdout states or maintain a
second schema. They invoke ReviewResult commands through the canonical
`experience-design.mjs` CLI.

## 9. Architecture Registry Integration

The architecture module registry governs this document root and
`tooling/scripts/experience-design`. Product, Prototype and Quality Skills are
thin consumers, not additional capability owners.

The module does not publish an Acceptance capability until a formal Feature ->
Capability -> Registry -> Gate trace exists. Focused Node tests are source
checks, not a fabricated formal Gate or fresh-holdout promotion.

## 10. Non-Claims

- Active architecture does not prove the integrated CLI works.
- Passing schema and ranking tests does not prove Agent judgment quality.
- Replaying the old six cases does not prove generalization.
- Prototype evidence does not prove production behavior.
- Fresh holdout promotion does not guarantee that every future UI/UX defect
  will be found.
