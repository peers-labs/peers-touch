---
kind: invariant
title: Functional readiness precedes broad Acceptance
status: active
owns:
  - tooling/scripts/acceptance-run.py
  - tooling/scripts/acceptance-gap-detect.py
  - tooling/scripts/plan/acceptance-admission.mjs
  - tooling/scripts/review/
  - tooling/make/acceptance.mk
  - tooling/make/review.mk
referenced-by:
  - docs/architecture/engineering/development-workflow/decisions.md
related:
  - docs/architecture/engineering/development-workflow/design.md
  - docs/architecture/engineering/acceptance/design.md
detected: 2026-09-20
---

# Functional readiness precedes broad Acceptance

## What must hold

Completion/full Acceptance and generated-plan execution require an explicit
matching Development Session in `ACCEPTANCE_RUNNING`. Gap Detector requires
that Session in `ACCEPTANCE_PASS | DELIVERY_READY`.

Admission runs before Evidence Store creation and before any Gate starts.
Missing, mismatched, cancelled, pre-functional, or Gate-less current Sessions
fail closed. Explicit single-Gate diagnostics remain available but cannot claim
broad readiness.

An `acceptance-aggregate` Task must have a transitive functional predecessor.
Formal proof never creates or substitutes `FUNCTIONAL_CHECK/PASS`.

## Why this is non-negotiable

Broad Acceptance before the real Journey works spends resources on an
unusable product frontier and can publish misleading evidence. Session-backed
admission preserves the distinction between development checks and formal
proof.

## How to verify

- `node --test tooling/scripts/plan/acceptance-admission.test.mjs` passes.
- `python3 -m unittest tooling/scripts/plan/acceptance_admission_test.py`
  passes.
- `python3 tooling/scripts/acceptance-run.py --completion` fails with
  `ACCEPTANCE_SESSION_REQUIRED` before Gate output.
- `python3 tooling/scripts/acceptance-gap-detect.py` fails with
  `ACCEPTANCE_SESSION_REQUIRED` before Evidence Store access.
- `node --test tooling/scripts/plan/planctl.test.mjs` covers the aggregate
  functional-predecessor constraint.

## Crosswalks

- DWF-D24 defines the functional fence.
- Development Session owns the functional and Acceptance frontier states.
