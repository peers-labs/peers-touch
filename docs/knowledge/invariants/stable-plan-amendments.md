---
kind: invariant
title: Plan identity survives execution amendments
status: active
owns:
  - AGENTS.md
  - tooling/acceptance/core/execution_plan.py
  - tooling/scripts/local-dev/
  - tooling/scripts/plan/
  - tooling/skills/pt-dev-workflow/
  - tooling/skills/pt-execution-plan-guardian/
  - tooling/skills/pt-plan-and-document/
referenced-by:
  - docs/architecture/engineering/development-workflow/decisions.md
related:
  - docs/architecture/engineering/development-workflow/design.md
  - docs/architecture/engineering/development-workflow/data-model.md
detected: 2026-10-06
---

# Plan identity survives execution amendments

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
  returns no live contract references.
- `make plan-validate PLAN=docs/architecture/platform/client/mobile/execution-plans/20260827-mobile-shell-implementation/plan.md`
  succeeds.

## Crosswalks

- DWF-D42 in `docs/architecture/engineering/development-workflow/decisions.md`.
- Supersedes `docs/knowledge/invariants/plan-mount-is-run-bound.md`.
