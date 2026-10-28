---
kind: pitfall
title: Active Acceptance docs must not promote draft proposals
status: active
owns:
  - docs/architecture/engineering/acceptance/
  - tooling/acceptance/README.md
  - tooling/acceptance/templates/
  - tooling/scripts/acceptance-docs-test.py
referenced-by:
  - invariants/acceptance-scope-is-runner-owned.md
related:
  - docs/architecture/engineering/acceptance/README.md
  - docs/architecture/engineering/acceptance/proposals/execution-model/README.md
detected: 2026-10-26
---

# Active Acceptance docs must not promote draft proposals

## Symptom

The active Acceptance entry linked an execution-model revision as if it were
current guidance, although every decision in it was still `draft`, cited a
stale PR, and had only partially landed. The operational guide simultaneously
mandated "exactly one active formal execution plan", conflicting with the
current workflow where Plans are optional. The module layout listed
`[ACCEPTED TARGET]` and `[PROPOSED]` paths that did not exist in the tree next
to implemented files, and an active contract was still labelled experimental.
Readers (human or Agent) could not tell what was implemented, proposed, or
historical.

## Root cause

There was no machine-checked boundary between current-state documentation,
non-normative proposals, and implementation diaries. Active docs were edited
incrementally during framework development, so proposed targets and expired
workstream notes aged in place while proposals lost their authority marking
once linked from an active index.

## Mitigation

### What was done in code

- Rewrote `docs/architecture/engineering/acceptance/README.md` as a short
  current-authority entry with explicit Current / Proposed / Historical
  sections, the proof boundary, and optional-Plan policy.
- Rewrote `tooling/acceptance/README.md` as a current operational guide and
  removed the mandatory-plan rule and product-specific implementation diary.
- Marked every file under `proposals/execution-model/` with
  `Authority: non-normative` and added a landed/proposed/historical
  disposition matrix in the proposal index.
- Relabelled implemented D-19 Core modules as current, removed nonexistent
  proposed paths from `module-layout.md`, and changed `execution-budget.md`
  to active status.
- Added `tooling/acceptance/templates/gate-execution-summary.md`, a human
  summary that defaults to `UNPROVEN` and can never hand-declare `PROVEN`.

### What guards against regression

- `python3 tooling/scripts/acceptance-docs-test.py` — deterministic
  structural checks, run ahead of `acceptance-validate.py --infra` inside the
  `acceptance-infra-validation` Gate.

## How to detect a recurrence

- `python3 tooling/scripts/acceptance-docs-test.py` — must exit zero.
- `rg -n "proposals/execution-model" docs/architecture/engineering/acceptance/README.md`
  — hits are allowed only inside the non-normative/proposal section, never in
  the Current Documents list.
- `rg -n "ACCEPTED TARGET|PROPOSED|accepted target|\\[NEW\\]" docs/architecture/engineering/acceptance/module-layout.md`
  — must return zero hits; current docs inventory implemented paths only.

## Crosswalks

- Invariant `invariants/acceptance-scope-is-runner-owned.md` keeps scope
  authority in the Runner instead of reintroducing mandatory plan gates.
