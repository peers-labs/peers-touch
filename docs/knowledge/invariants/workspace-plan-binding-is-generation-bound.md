---
kind: invariant
title: Workspace Plan binding is immutable within one generation
status: active
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
detected: 2026-09-26
---

# Workspace Plan binding is generation-bound

## What must hold

One repository or PR may contain multiple Plan Packages. Each workspace resolves
exactly one current `planId + planPath + generation` binding from
`~/.peers-touch/dev/workspaces/<workspaceId>/workflow/plan-binding.json`.
Branch scans, directory order, Plan status, declarations, active-work, and
synchronized foreign Plans must not select or replace that binding.

Within a generation, the same tuple is idempotent and every different tuple
fails with `WORKSPACE_PLAN_REBIND_DENIED`. The binding owner may explicitly
advance `N -> N+1` only when the current Plan is completed and the workspace
has no live declaration, active-work projection, or runtime lease. Advancement
uses generation compare-and-swap and retains immutable generation history.

Agents must not create a worktree merely to bypass binding or lifecycle state.
A new worktree requires the user's explicit isolation or concurrency decision.

The tracked Plan keeps only immutable `branch`, `workspaceId`, and
`initialHead`. Advancing source identity stays outside `plan.md`: Git owns the
physical HEAD, the active declaration owns mutation `sourceHead`, the
Development Session owns its clean checkpoint, and active-work owns the resume
projection.

## Why this is non-negotiable

Worktree-scoped binding prevents synchronized foreign Plans from stealing
execution ownership. Generation advancement separately prevents that safeguard
from making a stable canonical owner worktree single-use.

The quiescence fence matters: replacing the current pointer while an old
declaration, active-work record, or lease is live would let two Plan
generations claim one workspace.

## How to verify

- `node --test tooling/scripts/plan/workspace-plan-binding.test.mjs` passes.
- A different Plan cannot replace an unfinished generation.
- A completed and quiescent generation advances exactly once under concurrent
  requests.
- Every generation record is owner-controlled, digest-verified, and immutable.
- A legacy binding resolves as generation 1 and migrates only on explicit
  advance.
- `node --test tooling/scripts/local-dev/dev-work.test.mjs` passes.
- `python3 -m unittest tooling.acceptance.tests.test_execution_plan` passes.
- `rg -n '"expectedHead"|\\*\\*Expected HEAD\\*\\*' --glob plan.md docs`
  returns no matches.
- Local execution never discovers a Plan by branch, status, timestamp, or
  directory order.

## Crosswalks

- DWF-D18 and DWF-D31 in
  `docs/architecture/development-workflow/decisions.md`.
- DWF-D19 in `docs/architecture/development-workflow/decisions.md`.
- LDCP-D14 in `docs/architecture/local-dev-control-plane/decisions.md`.
