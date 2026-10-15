---
kind: invariant
title: Plan identity survives execution amendments
status: superseded-by:DWF-D42
owns: []
referenced-by:
  - docs/architecture/engineering/development-workflow/decisions.md
related:
  - docs/architecture/engineering/development-workflow/design.md
  - docs/architecture/engineering/development-workflow/data-model.md
detected: 2026-10-06
---

# Plan identity survives execution amendments

> Superseded by DWF-D42. Retained as historical context only. Current Plans are
> explicit frozen inputs; they do not own machine mounts or mutable execution
> state.

## What must hold

A Plan MUST keep one stable `planId` for the lifetime of its accepted North
Star. Authoring MUST produce `northStarApproval=null`; validation may inspect
that candidate, but mount and execution MUST fail until an explicit user
decision is durably bound to the canonical `planId + northStar` digest.

Each success criterion MUST have a stable ID and source references.
`criterionCoverage` MUST map every criterion exactly once to valid Task,
closure, and Gate IDs. Changes to coverage, Gate selection, source scope, write
sets, dependencies, commands, Task decomposition/order, and implementation
paths MUST be recorded as append-only amendments and MUST NOT create a new Plan
version, mount, run, or North Star approval.

`planctl amend` MUST validate the complete candidate package, derive the
affected Task and Gate set, publish an immutable internal snapshot, and
atomically move the Execution Run to that snapshot. Changed completed Tasks and
their transitive dependents return to `pending`; unaffected Task states remain
intact.

Any change to `northStar` MUST make the prior approval stale and return
`NORTH_STAR_APPROVAL_REQUIRED` before execution. After the user explicitly
approves the new digest, publication MUST still record the matching
owner-approved amendment. The response MUST identify the conflict, impacted
goal/acceptance, options and tradeoffs, and a recommendation. Expanding
operation authorization remains separately owner-authorized.

## Why this is non-negotiable

A digest is an integrity fact, not a user-facing plan identity. Treating every
execution correction as a new Plan forces cancellation and remounting, discards
continuity, and transfers routine planning work to the user.

Mutable Plan source without append-only history has the opposite failure: the
reason and prior execution input disappear. Stable identity plus immutable
snapshots preserves both autonomy and auditability.

Machine-local execution state is never a CI dependency. After a run reaches
`completed`, `make plan-seal-completion PLAN=<path>` publishes an immutable
repository `completions/<planDigest>.json` attestation. Explicit-plan CI reads
the validated Plan source plus that exact digest-bound record; a missing or
stale completion record fails closed.

## How to verify

- `node --test tooling/scripts/plan/plan-mount.test.mjs tooling/scripts/plan/planctl.test.mjs`
  and `node --test tooling/scripts/plan/plan-completion.test.mjs`
  passes candidate rejection, explicit approval, stale digest, criterion
  coverage, amendment, task invalidation, and snapshot-history cases.
- `rg -n 'peers-touch-plan-version|versionId[": ]|\.planVersionDigest|planVersionDigest"\s*:|mountPlanVersion\(|\.liveMountsByPlanVersion|liveMountsByPlanVersion\s*:' tooling AGENTS.md docs/global docs/architecture/engineering --glob '!**/execution-plans/**' | rg -v "stable-plan-state-migration|plan-mount-is-run-bound|development-workflow/decisions.md"`
  returns only the DWF-D45 mixed-envelope validator/tests in
  `plan-mount.mjs`, its tests, and migration documentation; no Plan source or
  execution snapshot consumes the legacy identity.
- `make plan-validate PLAN=docs/architecture/platform/client/mobile/execution-plans/20260827-mobile-shell-implementation/plan.md`
  succeeds.

## Crosswalks

- DWF-D42 in `docs/architecture/engineering/development-workflow/decisions.md`.
- DWF-D45 and
  `docs/knowledge/invariants/machine-ledger-workspace-isolation.md` govern
  machine-state adoption without changing stable Plan identity.
- Supersedes `docs/knowledge/invariants/plan-mount-is-run-bound.md`.
