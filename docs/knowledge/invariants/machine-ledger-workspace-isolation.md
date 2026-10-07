---
kind: invariant
title: Machine ledgers coordinate without owning workspaces
status: active
owns:
  - tooling/scripts/local-dev/dev-work-ledger.mjs
  - tooling/scripts/local-dev/dev-work-schema.mjs
  - tooling/scripts/plan/plan-mount.mjs
  - tooling/scripts/plan/stable-plan-state-migration.mjs
referenced-by:
  - docs/knowledge/invariants/dev-resource-declaration-before-write.md
  - docs/knowledge/invariants/stable-plan-amendments.md
related:
  - docs/architecture/engineering/development-workflow/decisions.md
detected: 2026-10-07
---

# Machine ledgers coordinate without owning workspaces

## What must hold

Machine-wide work and Plan-mount ledgers MUST provide one atomic conflict view,
but MUST NOT make an unrelated workspace's liveness a lifecycle or schema
migration lock. A writer may mutate only records and indexes owned by its
selected workspace. Foreign legacy records remain strictly validated,
unchanged coordination inputs until their own workspace adopts the current
schema.

Actual same-branch, same-workspace, exclusive runtime, workspace mount, and
stable Plan identity conflicts MUST still fail closed. Short machine locks and
compare-and-swap replacement protect file atomicity; they MUST NOT be treated as
resource occupancy.

Adoption may rename a selected live declaration field and recompute its digest,
but MUST preserve its lifecycle state and all ownership fields. A legacy
PlanMount is close-only under stable tooling: normal execution MUST NOT consume
or trust its retired snapshot, while only explicitly authorized exact-owner
`owner-unmount` may remove its legacy indexes. Legacy and stable Plan indexes
MUST be disjoint and their union MUST equal the live workspace index.

## Why this is non-negotiable

The global ledger exists so independent worktrees can see overlapping intent.
If any active declaration blocks a schema change for every workspace, the
projection becomes a global lifecycle owner and unrelated work can deadlock
all future declarations even when Profile, Station, slot, source, and Plan
claims are disjoint.

Blindly ignoring old records is equally unsafe because it can double-allocate
resources. Record-level schema discrimination and a bounded mixed mount-index
envelope preserve visibility while each workspace migrates its own state.
Stale writers are fenced by schema validation and CAS and cannot overwrite a
newer ledger.

## How to verify

- `node --test tooling/scripts/plan/stable-plan-state-migration.test.mjs`
  passes foreign-live, selected live-declaration preservation, interruption,
  tamper, preservation, and stale writer cases.
- `node --test tooling/scripts/local-dev/dev-work.test.mjs` passes mixed
  declaration coordination and resource-conflict cases.
- `node --test tooling/scripts/plan/plan-mount.test.mjs` passes mixed-index
  preservation, disjointness, close-only legacy release, and cross-schema
  stable Plan conflict cases.
- `rg -n "requires all Development Runs|global-idle hard cut" tooling/scripts/plan docs/architecture/engineering/development-workflow`
  returns no active migration contract.

## Crosswalks

- DWF-D11 owns machine-wide resource-intent visibility.
- DWF-D44 owns workspace-scoped schema adoption and mixed-envelope removal.
