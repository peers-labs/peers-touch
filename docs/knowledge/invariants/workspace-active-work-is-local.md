---
kind: invariant
title: Active work state belongs to the consuming workspace
status: active
owns:
  - AGENTS.md
  - apps/dev/
  - tooling/make/local-dev.mk
  - tooling/scripts/lib/machine-dev-paths.mjs
  - tooling/scripts/local-dev/active-work-store.mjs
  - tooling/scripts/local-dev/active-work.mjs
  - tooling/skills/pt-context-anchor/
  - tooling/skills/pt-dev-workflow/
  - tooling/skills/pt-plan-and-document/
referenced-by:
  - docs/architecture/development-workflow/decisions.md
related:
  - docs/architecture/development-workflow/design.md
  - docs/architecture/development-workflow/data-model.md
detected: 2026-09-19
---

# Active work state belongs to the consuming workspace

## What must hold

`peers-dev-workflow` owns the canonical implementation and rollout contract. It
does not own the mutable runtime state of worktrees that consume that
implementation.

Each consuming worktree derives its own `workspaceId` from its canonical root
and is the sole writer of:

```text
~/.peers-touch/dev/workspaces/<workspaceId>/workflow/active-work.json
```

The record is a closed, revisioned, digest-protected projection derived from
the immutable Plan binding, current Plan/Task, active declaration, Development
Session and Git HEAD. Callers cannot submit arbitrary progress JSON.

Project memory, chat Context Anchors and Peers Dev are read-only projections.
They may enumerate workspace records, but no operation may rewrite a shared
cross-workspace `active_work` table or another workspace's record.

## Why this is non-negotiable

One shared Markdown table makes every concurrent Goal a writer of the same
document. A stale read followed by a whole-table write can erase another
worktree's progress even when source and runtime claims do not overlap.

Making the workflow source repository the runtime owner has the same defect in
another form: distributed tools would report back to one mutable central
record instead of preserving worktree isolation.

## How to verify

- `node --test tooling/scripts/lib/machine-dev-paths.test.mjs tooling/scripts/local-dev/active-work-store.test.mjs`
  passes.
- Two different canonical roots derive different workspace state paths.
- Revision/CAS, digest, lock ownership, file permissions and malformed-record
  isolation tests pass.
- `rg -n 'project_memory\\.md.*active_work|active_work.*project_memory\\.md' AGENTS.md tooling/skills docs/global/workflow.md`
  finds no normal runtime writer contract.
- Peers Dev reads `active-work.json` records through
  `readAllActiveWorkRecords`; it never writes them.
- Rollout checks execute the installed implementation from at least two
  consuming worktrees and confirm disjoint record paths.

## Crosswalks

- DWF-D18: immutable workspace Plan binding.
- DWF-D19: advancing source identity stays outside tracked Plan content.
- DWF-D22: workflow source distribution is separate from runtime-state
  ownership.
