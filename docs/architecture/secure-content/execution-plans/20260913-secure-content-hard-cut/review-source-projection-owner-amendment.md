# Source Projection Owner Amendment Review

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-26 | **Updated**: 2026-09-26
> **Owner**: Architecture Team

## Review Scope

Review the mechanical source-owner correction in:

- `tasks/W12A.md`
- `../20260913-secure-content-work-items.yaml`
- `tooling/development/secure_content/source_projection.py`
- `tooling/development/secure_content/test_source_projection.py`

## Accepted Sources

- `plan.md`: W12A owns source invalidation repair and W12D owns schema
  activation.
- `review-w12d-source-owner-amendment.md`: activation aggregate task and
  workstream identity are W12D.
- Activation evidence remains under the historical `W12A/activation` path.

## Required Checks

1. W12A declares the two projection files before mutation.
2. Projection admission requires W12D task and workstream identity.
3. The evidence path and W12A-FOUR/W12A-FIVEARM child identities remain
   unchanged.
4. Obsolete W12A aggregate identity is rejected.
5. Plan and work-item validation pass.
6. No product Journey or formal Acceptance claim is added.

## Validation

- `make plan-validate PLAN=docs/architecture/secure-content/execution-plans/20260913-secure-content-hard-cut/plan.md`
- `python3 -m unittest tooling.development.secure_content.test_source_projection tooling.development.secure_content.test_work_item`
- `git diff --check`

## Reviewer Output

Return `PASS`, `CONDITIONAL_PASS`, or `HOLD`, followed by source-backed
findings ordered by severity.

## Review Result

**Verdict**: PASS

No findings. W12A has exact write ownership for the projection validator and
its regression test; authorization and product semantics are unchanged. The
hard cut requires W12D aggregate ownership while retaining the W12A evidence
path and W12A-FOUR/W12A-FIVEARM child identities.

Implementation review initially required independent negative coverage for
`task_id` and `workstream_id` plus a representative W12D aggregate fixture.
Both findings were resolved; final re-review verdict: **PASS**.

A second W7 admission replay exposed immutable legacy W12A aggregates in the
same evidence root. The follow-up review passed after legacy records were
excluded only after integrity validation, mixed identities remained rejected,
and lifecycle validation continued to prevent older-source fallback.
