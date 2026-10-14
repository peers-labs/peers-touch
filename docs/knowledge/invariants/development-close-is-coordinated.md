---
kind: invariant
title: Development close is one coordinated transaction
status: superseded-by:DWF-D42
owns: []
referenced-by:
  - docs/architecture/engineering/development-workflow/decisions.md
related:
  - docs/knowledge/invariants/dev-resource-declaration-before-write.md
  - docs/knowledge/invariants/plan-mount-is-run-bound.md
  - docs/knowledge/invariants/workspace-active-work-is-local.md
detected: 2026-10-05
---

# Development close is one coordinated transaction

> Superseded by DWF-D42. Retained as historical context only. Closing a task
> may summarize that task's own operations and release resources it actually
> owns; there is no workspace-wide close transaction or admission guard.

## What must hold

`dev-close` is the only normal intake-to-close coordinator. It closes one exact
`workspaceId + workItemId` in this order:

```text
runtime leases -> Session archive -> active-work -> declaration
               -> PlanMount -> optional environment unregister
```

Each state remains owned by its existing command/store. The coordinator holds
the workspace lifecycle fence, invokes those owners, and persists an
idempotent `DevelopmentCloseReceipt` after every successful stage.

New declaration and PlanMount admission rejects an unfinished close receipt.
`completed` and `cancelled` require their matching run/session semantics.
`owner-abandon` is an explicit Owner decision; it may archive a non-terminal
Session but must not relabel it as successful. Deleted-worktree mount recovery
requires the exact `workspaceId + mountId + mountedBy` identity.

Environment registration is retained after normal completion. It is
unregistered only for an explicitly authorized worktree removal and only after
declaration, active-work, PlanMount, and leases are absent.

## Why this is non-negotiable

Independent release commands permit partial cleanup: a declaration can be
released while active-work or PlanMount still blocks the next task, and a
deleted worktree cannot run root-derived cleanup. Treating any one release as
completion hides the remaining owner and recreates permanent workspace locks.

A durable, resumable close receipt makes interruption visible and lets the
workflow finish cleanup without asking the user to repair internal state by
hand.

## How to verify

- `node --test tooling/scripts/local-dev/development-close.test.mjs` passes.
- `node --test tooling/scripts/plan/plan-mount.test.mjs
  tooling/scripts/plan/planctl.test.mjs` passes.
- Wrong PlanMount owner and mismatched orphan selectors fail closed.
- Retrying after an interrupted close reuses the same receipt and reaches
  `CLOSED`.
- `dev-start` and `plan-mount` reject a `CLOSING` or `BLOCKED` receipt.
- `env-unregister` rejects any live PlanMount.
- `pt-completion-auditor` accepts `close-ready` only from the exact closed
  receipt with no pending resource.

## Crosswalks

- DWF-D41 defines coordinated Development close and admission reconciliation.
- DWF-D38 defines PlanMount ownership and exact orphan recovery.
- LDCP-D08 defines explicit environment registration lifecycle.
