---
kind: invariant
title: Workspace Plan binding is immutable
status: superseded-by:docs/knowledge/invariants/plan-mount-is-run-bound.md
owns:
  - AGENTS.md
  - tooling/acceptance/core/execution_plan.py
  - tooling/scripts/execution-plan.py
  - tooling/scripts/local-dev/dev-work-ledger.mjs
  - tooling/scripts/plan/workspace-plan-binding.mjs
  - tooling/skills/pt-dev-workflow/
  - tooling/skills/pt-plan-and-document/
referenced-by:
  - docs/architecture/development-workflow/decisions.md
related:
  - docs/architecture/development-workflow/design.md
  - docs/architecture/development-workflow/data-model.md
detected: 2026-09-18
---

# Workspace Plan binding is immutable

## What must hold

One repository or PR MAY contain multiple active Plan Packages. Each workspace
MUST resolve exactly one explicitly created `planId + planPath` binding from
`~/.peers-touch/dev/workspaces/<workspaceId>/workflow/plan-binding.json`.
Branch scans, directory order, Plan status, declarations, `active_work`, and
synchronized foreign Plans MUST NOT select or replace that binding.

The same binding request is idempotent. A different tuple MUST fail with
`WORKSPACE_PLAN_REBIND_DENIED`. There is no unbind/rebind path; another Plan
requires another worktree.

The tracked Plan keeps only immutable `branch`, `workspaceId`, and
`initialHead`. Advancing source identity MUST stay outside `plan.md`: Git owns
the physical HEAD, the active declaration owns mutation `sourceHead`, the
Development Session owns its clean checkpoint, and `active_work.expected_head`
owns the resume projection.

## Why this is non-negotiable

Parallel worktrees commonly synchronize commits into one PR. Repository
contents therefore describe shared source history, not the current execution
owner. Branch-wide Plan discovery can attach Agent work to Chat or stop both
with a false multiple-active-plan conflict.

Mutable declarations and `active_work` are projections. Letting either choose a
Plan would allow expiry, synchronization, or a stale row to change workspace
ownership without changing the worktree identity.

## How to verify

- `node --test tooling/scripts/plan/workspace-plan-binding.test.mjs` passes.
- `node --test tooling/scripts/local-dev/dev-work.test.mjs` passes.
- `python3 -m unittest tooling.acceptance.tests.test_execution_plan` passes.
- `rg -n '"expectedHead"|\\*\\*Expected HEAD\\*\\*' --glob plan.md docs`
  returns no matches.
- `rg -n "glob\\(|MULTIPLE_ACTIVE_PLANS|MULTIPLE_ACTIVE_EXECUTION_PLANS" tooling/acceptance/core/execution_plan.py` returns no matches.
- `python3 tooling/scripts/execution-plan.py --ci` fails with
  `EXECUTION_PLAN_INPUT_REQUIRED` when no explicit Plan is supplied.

## Crosswalks

- DWF-D18 in `docs/architecture/development-workflow/decisions.md`.
- DWF-D19 in `docs/architecture/development-workflow/decisions.md`.
- LDCP-D14 in `docs/architecture/local-dev-control-plane/decisions.md`.
