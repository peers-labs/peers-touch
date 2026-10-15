---
kind: invariant
title: Workflow status is read-only and task-local
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

# Workflow status is read-only and task-local

## What must hold

`workflow-snapshot.mjs` reads current Git source and optional task progress for
explicit workspace roots. It writes nothing, repairs nothing, and never selects
a task by branch, mtime, chat, or Plan count.

One corrupt task or unavailable workspace produces a local typed finding. It
cannot hide valid source or other tasks and cannot block ordinary work.
Optional runtime status may be attached by a caller, but the snapshot does not
derive permission, resource ownership, completion, or formal evidence from it.

Context Anchor and Doctor may consume this projection. They must preserve
`none`, `unknown`, `unverified`, and typed failure instead of inventing a
lifecycle or replacing current-source checks.

## Why this is non-negotiable

A status projection that mutates or joins unrelated machine histories becomes
another authority and lets stale records block current work. Task-local,
read-only projection keeps recovery useful without recreating a workflow
control plane.

## How to verify

- `node --test tooling/scripts/local-dev/workflow-snapshot.test.mjs` passes.
- Corrupt task state is isolated to that task.
- An unavailable workspace does not erase other workspace rows.
- Snapshot reads leave Git, task snapshots, registry, leases, and runtime
  processes unchanged.

## Crosswalks

- DWF-D46 removes auxiliary workflow state from ordinary admission.
- LDCP-D19 keeps status as an on-demand CLI projection.
