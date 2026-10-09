---
kind: pitfall
title: Global-idle Plan migration deadlocks active multi-worktree machines
status: active
owns:
  - tooling/scripts/plan/stable-plan-state-migration.mjs
  - tooling/scripts/plan/stable-plan-state-migration.test.mjs
  - tooling/scripts/local-dev/dev-work-schema.mjs
  - tooling/scripts/plan/plan-mount.mjs
referenced-by:
  - docs/architecture/engineering/development-workflow/decisions.md
related:
  - docs/knowledge/invariants/stable-plan-amendments.md
detected: 2026-10-10
---

# Global-idle Plan migration deadlocks active multi-worktree machines

## Failure

A retired Plan schema may remain in one historical or live worktree while
newer worktrees already use the stable Plan schema. If migration requires every
declaration and mount on the machine to be closed, the new readers cannot close
the legacy run they reject, and unrelated valid runs must be disrupted before
new work can declare resources.

## Rule

The explicit migration must lock every affected workspace before both machine
ledgers, validate the complete legacy/stable candidate, migrate declarations,
mounts, snapshots, runs, and mixed indexes in place, and support idempotent
retry after interruption. Normal runtime readers remain stable-schema only.

Never solve this by asking for an IDE reload, clearing unrelated machine state,
hand-editing ledgers, or adding a permanent dual-read compatibility path.

## Proof

`node --test tooling/scripts/plan/stable-plan-state-migration.test.mjs` must
cover live state, mixed indexes, tamper rejection, and interrupted retry.
