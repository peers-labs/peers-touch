---
kind: invariant
title: Workflow status is one read-only cross-owner projection
status: active
owns:
  - tooling/scripts/local-dev/workflow-snapshot.mjs
  - tooling/skills/pt-context-anchor/
referenced-by:
  - docs/architecture/engineering/development-workflow/decisions.md
related:
  - docs/architecture/engineering/development-workflow/design.md
  - docs/architecture/engineering/development-workflow/data-model.md
detected: 2026-09-20
---

# Workflow status is one read-only cross-owner projection

## What must hold

Plan, Session, declaration, Git, workspace active-work, runtime, and rollout
remain independent owners. `workflow-snapshot.mjs` is the only component that
joins them into one consistency result:
`HEALTHY | BLOCKED | DRIFT | SUSPENDED`.
The same read derives the Plan Run decision:
`CONTINUE | HARD_BLOCK | COMPLETE`.

The snapshot persists nothing and never repairs an owner. Workflow Doctor and
Context Anchor consume its verdict and typed findings instead of rebuilding their own
precedence rules. `CONTINUE` keeps owner repair, Task handoff, review, Anchor,
and context boundaries inside the authorized Run. Rollout drift remains visible
but cannot block business work.

The compact Anchor projection owns one `currentObservation` only. It identifies
the current Task and distinguishes `measured`, `not-started`, `none`, and
`unavailable`; it never aliases a transient just-closed Task observation as the
current Task. The transient `closureObservation` represents at most the one
Task closed by the current `planctl advance` call, never a Plan-wide or
all-Task aggregate.

Explicit absence is not unknown data. Render no entity as `none`, no current
Session as `not-started`, absent optional telemetry as `not-observed`, no active
run as `inactive`, a verified blocker as `blocked`, and absent scheduler output
as `not-scheduled`. Reserve `UNKNOWN` for incomplete or contradictory source
data such as a non-monotonic or compacted-away observation.

## Why this is non-negotiable

Displaying individually valid records as one healthy workflow hides stale
Task, Session, declaration, or Git relationships. Letting each UI or Skill
reimplement the join creates conflicting health results and turns projections
into accidental state owners.

## How to verify

- `node --test tooling/scripts/local-dev/workflow-snapshot.test.mjs` passes.
- `node --test tooling/scripts/local-dev/workflow-snapshot.test.mjs` passes.
- `make workflow-snapshot` reports typed owner/field findings.
- The Anchor projection reports current Task timing only under
  `currentObservation`; a current Task without a Session reports
  `not-started` with `NOT_RUN` evidence, and no current Task reports `none`.
- Active Plans report `CONTINUE`, fixed-point blocked or identity-invalid Plans
  report `HARD_BLOCK`, and terminal Plans report `COMPLETE`.
- `rg -n "resolveDeclarationPlan" tooling/scripts tooling/skills` returns no matches.
- Snapshot reads leave Git and machine owner records unchanged.

## Crosswalks

- DWF-D24 defines the shared consistency projection.
- `workspace-active-work-is-local.md` defines the active-work owner boundary.
