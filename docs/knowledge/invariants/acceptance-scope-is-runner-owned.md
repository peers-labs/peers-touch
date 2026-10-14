---
kind: invariant
title: Acceptance scope belongs to the runner that executes it
status: active
owns:
  - tooling/scripts/acceptance-run.py
  - tooling/scripts/acceptance-gap-detect.py
  - tooling/scripts/review/
  - tooling/make/acceptance.mk
  - tooling/make/review.mk
referenced-by:
  - docs/architecture/engineering/development-workflow/decisions.md
related:
  - docs/architecture/engineering/development-workflow/design.md
  - docs/architecture/engineering/acceptance/design.md
detected: 2026-10-14
---

# Acceptance scope belongs to the runner that executes it

## What must hold

The Acceptance runner resolves its explicit Gate, Plan, completion, or full
selection before creating a run. An empty or invalid selection fails before
Gate execution. The Gap Detector resolves changed paths plus its explicit or
canonical Plan and run inputs directly.

No separate Acceptance Admission state, adapter, Development Session, task
record, or Hook receipt may select or authorize the scope. Functional
readiness remains a workflow ordering rule and must not be manufactured by
formal proof.

## Why this is non-negotiable

A generic admission wrapper duplicates the actual runner's selection logic and
can validate a synthetic scope before the runner has resolved the real Plan.
Keeping scope ownership at the execution owner removes that split without
weakening Gate assertions, current-source evidence, or runtime admission.

## How to verify

- `python3 tooling/scripts/acceptance-run-test.py` passes.
- `python3 tooling/scripts/acceptance-gap-detect-test.py` passes.
- `rg -n 'acceptance[_-]admission|require_acceptance_admission' tooling`
  finds no live implementation or import.
- Broad Acceptance with no executable selected Gate fails before a run begins.

## Crosswalks

- DWF-D42 removes auxiliary workflow state from ordinary and formal admission.
- Acceptance Infra still owns Gate execution and evidence semantics.
