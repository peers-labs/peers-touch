---
kind: invariant
title: Plan mounts bind frozen versions to execution worktrees
status: superseded-by:docs/knowledge/invariants/stable-plan-amendments.md
owns:
  - AGENTS.md
  - tooling/acceptance/core/execution_plan.py
  - tooling/scripts/local-dev/dev-work-ledger.mjs
  - tooling/scripts/plan/
  - tooling/skills/pt-dev-workflow/
  - tooling/skills/pt-plan-and-document/
referenced-by:
  - docs/architecture/engineering/development-workflow/decisions.md
related:
  - docs/architecture/engineering/development-workflow/design.md
  - docs/architecture/engineering/development-workflow/data-model.md
detected: 2026-10-04
---

# Plan mounts bind frozen versions to execution worktrees

This invariant is retained as historical context. Its frozen-version rule is
superseded by `stable-plan-amendments.md`; the explicit worktree occupancy and
owner-controlled release rules remain in force there.

## What must hold

A frozen PlanVersion contains no worktree identity or mutable lifecycle. An
explicit owner action creates one Project Ledger PlanMount from its exact
digest to one `workspaceId`. Execution copies that version and the mount's
`executionBinding` into an immutable ExecutionPlanSnapshot.

A worktree has at most one live mount. It remains occupied until the run is
completed, cancelled, or explicitly unmounted by the owner. Agents may execute
the snapshot but may not amend the PlanVersion, switch its workspace, or
unmount it.

Repository scans, branch names, active-work, Sessions, declarations, and
runtime leases cannot select or replace a mount. Mount has no TTL. Runtime
leases remain temporary physical resource ownership; locks remain short atomic
write exclusion.

## Why this is non-negotiable

Project design and execution placement have different lifecycles. Joining them
makes authoring worktrees permanent execution owners and prevents a long-lived
worktree from running later Plans without binding mutation.

The immutable snapshot also prevents an executing Agent from changing scope,
authorization, or the Task graph after admission.

## How to verify

- `node --test tooling/scripts/plan/plan-mount.test.mjs` passes.
- A Plan authored in one worktree can be mounted in another without editing the
  Plan Version.
- Concurrent mounts cannot assign two live Plans to one workspace.
- Snapshot digest changes when any Plan or Task source changes.
- A declaration, Session, or active-work record cannot create or replace a
  mount.
- Normal release requires completed/cancelled run state; unfinished unmount
  requires explicit owner authorization.
- No workspace-plan-binding or generation-advance implementation remains.

## Crosswalks

- DWF-D38 in `docs/architecture/engineering/development-workflow/decisions.md`.
- LDCP-D19 in `docs/architecture/engineering/local-dev/decisions.md`.
