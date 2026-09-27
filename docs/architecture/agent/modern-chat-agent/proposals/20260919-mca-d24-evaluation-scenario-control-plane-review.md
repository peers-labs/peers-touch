# MCA-D24 Evaluation Scenario Control Plane Review

> **Status**: review-complete
> **Created**: 2026-09-19 | **Updated**: 2026-09-21
> **Owner**: Peers-Touch Agent Team

---

Review:

`docs/architecture/agent/modern-chat-agent/proposals/20260919-mca-d24-evaluation-scenario-control-plane.md`

against:

- `product-definition.md`
- `experience-contract.md`
- `product-state-model.md`
- `design.md`
- `decisions.md`
- `data-model.md`
- `integration.md`
- MCA-D21 runtime-truthful formal evidence
- MCA-D22 capability scenario control plane
- accepted MCA-D23 capability operation scenario control plane
- `tooling/acceptance/matrices/agent-v2-runtime-matrix.yaml`
- `tasks/MCA-A07.md`

## Verified Trigger

- J06 requires 57 independent executions: 28 Desktop, 28 Browser, and one
  Mobile contract tuple.
- The three pre-scheduling rejection cells cannot truthfully use
  `station_turn` or require TurnTrace/metrics evidence because their accepted
  oracle requires zero Evaluation Turn creation.
- The current runner executes one composite Native Journey and leaves
  `cell-results` empty.
- Current tests manufacture 57 passing cell records rather than execute them.
- The current structural suite also fails because the candidate writer omits
  the mixed-row `contract-evidence` role.
- No Station runtime controller exists for the R-08/R-09/R-10 commit barriers,
  cancellation-ACK deadline, or evaluator-unavailable precondition.
- MCA-A07's write set excludes the Model and Station owners required to add
  those contracts and barriers.

## Required Review

1. J06 extends the single MCA-D22 scenario authority and does not add an
   Evaluation-only fixture service.
2. If the internal service/contract is generalized, all J02 callers are
   migrated in one hard cut with no parallel legacy authority.
3. Station Evaluation Service and repository remain the sole owners of runs,
   attempts, results, events, cancellation, retry children, and metrics.
4. The controller can only select reviewed tuples, allowlisted barriers,
   prescribed duplicate deliveries, and named clock milestones.
5. The controller cannot accept arbitrary state, SQL, methods, timestamps,
   expected values, or product result payloads.
6. `R-08` proves duplicate scheduler delivery around scheduler claim and Turn
   creation with one attempt, Turn, and result.
7. `R-09` proves cancel-first and completion-first CAS orderings, plus the
   bounded missing-ACK `CANCEL_ACK_TIMEOUT` branch.
8. `R-10` proves duplicate retry delivery around parent terminal commit and
   child creation while parent metrics/revision remain immutable.
9. `ERR-E01` through `ERR-E05` originate from canonical Evaluation services
   with exact typed semantics and zero forbidden side effects.
10. `AS-14` performs an actual Station restart and durable readback, not only a
    page or Desktop restart.
11. Desktop and Browser use their actual receiver surfaces over distinct fresh
    Station Evaluation lineages.
12. `AS-15-V2-E01` runs independently and emits contract-only evidence.
13. `cell-results` is derived from executed tuples; a synthetic tuple-key loop
    is explicitly rejected.
14. Every tuple has unique scenario, benchmark/dataset, run, attempt, result,
    Turn, scheduler-claim, and retry-child identities as applicable.
15. Setup/barrier/clock/cleanup output contains no assertion, expected value,
    evidence role, candidate artifact, or verdict.
16. Production cannot enable scenario control through product input or stored
    configuration.
17. Cleanup is idempotent, mandatory, and proves no active fixture work
    remains.
18. The candidate remains `CANDIDATE`; only MCA-A08 may promote `PROVEN`.
19. Acceptance requires exactly 57 reviewed tuples with no scope reduction.
20. After approval, the Plan must be amended before implementation to include
    Model, Station, receiver adapters, Mobile, and provisioning ownership.
21. Turn-backed cells use `station_turn`; `ERR-E01`, `ERR-E02`, and `ERR-E05`
    use `station_control_plane` and omit inapplicable Turn/runtime-event/metrics
    roles without weakening their receiver, Station, timing, side-effect, or
    replay evidence.

## Required Verdict

Return one:

```text
APPROVE MCA-D24
```

or:

```text
REQUEST CHANGES MCA-D24: <blocking findings>
```

## Verdict

```text
APPROVE MCA-D24
```

The Owner delegated full approval and execution authority on 2026-09-19. The
review found no second Evaluation authority, direct product-state mutation,
production failpoint, synthetic tuple result, or weakened runtime scope.

The v1.1 evidence-profile correction was re-reviewed on 2026-09-21 and remains
approved. It preserves the 57-tuple set while removing an impossible evidence
requirement from the three zero-Turn rejection cells.
