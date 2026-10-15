# Local Dev Control Plane - Module Layout

> **Status**: active
> **Version**: v1.3
> **Updated**: 2026-10-14
> **Owner**: Platform Team

## Directory Tree

```text
tooling/scripts/local-dev/
├── machine-dev-registry.mjs
├── machine-dev-lease.py
├── machine-dev.mjs
├── workflow-snapshot.mjs
├── workflow-doctor.mjs
├── worktree-observation-store.mjs
├── task-progress-store.mjs
├── dev-work.mjs
├── development-close.mjs
└── development-flow-residue.mjs

tooling/scripts/plan/
├── plan-package.mjs
└── planctl.mjs
```

## Responsibilities

- `machine-dev-registry.mjs`: authoritative workspace binding, Profile,
  capability, current-source, target, and lease admission.
- `machine-dev-lease.py`: OS-held resource exclusivity and bounded child
  lifetime.
- `machine-dev.mjs`: runtime command composition.
- `workflow-snapshot.mjs`: one-shot read-only projection of current source,
  optional task records, and supplied runtime status.
- `workflow-doctor.mjs`: independent source and optional integration
  diagnostics.
- `task-progress-store.mjs`: one task-local atomic snapshot with checksum,
  corruption isolation, source invalidation, and revision/CAS.
- `dev-work.mjs`: optional task-progress CLI.
- `development-close.mjs`: close one explicitly selected task and settle only
  its owned resources.
- `development-flow-residue.mjs`: executable negative inventory for retired
  workflow authority modules and entrypoints.
- `planctl.mjs`: direct `validate`, `inspect`, and `task` reads for one explicit
  frozen Plan Version.

## Dependency Direction

```text
runtime command
  -> machine-dev.mjs
  -> machine-dev-registry.mjs + machine-dev-lease.py

optional task recovery
  -> dev-work.mjs
  -> task-progress-store.mjs
  -> .dev-workflow/tasks/<taskId>/

explicit Plan read
  -> planctl.mjs
  -> plan-package.mjs
```

Local Dev never reads optional task progress, Hook state, host identity, or a
formal Plan to grant or deny runtime operations. Snapshot and Doctor never
repair source, task, registry, or lease state.
