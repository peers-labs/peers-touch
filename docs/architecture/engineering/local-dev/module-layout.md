# Local Dev Control Plane - Module Layout

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-09-17 | **Updated**: 2026-10-05
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/`

---

## 1. Directory Tree

```text
tooling/scripts/local-dev/
├── machine-dev-registry.mjs
├── machine-dev-lease.py
├── machine-dev.mjs
├── workflow-snapshot-core.mjs
├── workflow-snapshot.mjs
├── dev-resource-plan.mjs
├── development-close-store.mjs
├── development-close.mjs
├── development-close.test.mjs
├── dev-work-schema.mjs
├── dev-work-ledger.mjs
└── dev-work.mjs

tooling/scripts/plan/
├── plan-mount.mjs
└── plan-mount.test.mjs
```

## 2. File Responsibilities

| Path | Responsibility |
|---|---|
| `tooling/scripts/local-dev/workflow-snapshot-core.mjs` | Read-only redacted join over mounts, runs, topology, registrations, declarations, Sessions, active-work, and leases |
| `tooling/scripts/local-dev/workflow-snapshot.mjs` | One-shot JSON CLI over Workflow Snapshot core |
| `tooling/scripts/local-dev/worktree-create.mjs` | Explicit Agent worktree creation and immutable main-session provenance |
| `tooling/scripts/local-dev/machine-dev-registry.mjs` | Machine registry, profile validation, live lease projection, and committed resource-plan admission authority |
| `tooling/scripts/local-dev/dev-resource-plan.mjs` | DWF-owned ModuleImpact aggregation and planner-claim provenance consumed by Local Dev admission |
| `tooling/scripts/local-dev/development-close-store.mjs` | Digest-protected per-work-item close receipt and new-work admission guard |
| `tooling/scripts/local-dev/development-close.mjs` | Workspace-fenced close coordinator and exact deleted-worktree recovery path |
| `tooling/scripts/local-dev/dev-work-ledger.mjs` | Machine-wide Development intent authority |
| `tooling/scripts/plan/plan-mount.mjs` | Project Ledger Plan mount, snapshot, run, exact-owner cancel/release, orphan recovery, and conflict owner |
| `tooling/scripts/plan/stable-plan-state-migration.mjs` | Explicit global-idle migration for retired version-indexed machine ledgers |
| `tooling/make/local-dev.mk` | Thin `make workflow-snapshot` and runtime entry points |

## 3. Dependency Direction

```text
workflow-snapshot.mjs
  -> workflow-snapshot-core.mjs
  -> tooling/scripts/local-dev machine and work read APIs
  -> tooling/scripts/plan Plan mount/run read APIs
  -> env/peers-touch profile definitions

tooling Local Dev owners
  -> ~/.peers-touch/dev machine state

Development Workflow Plan mount
  -> plan-mount.mjs
  -> ~/.peers-touch/dev/plan-mounts/

Development Workflow close
  -> development-close.mjs
  -> existing Session / active-work / declaration / mount / registry owners
  -> per-work-item DevelopmentCloseReceipt
```

Forbidden dependencies:

- environment repository -> Workflow Snapshot implementation;
- Workflow Snapshot -> registry, mount ledger, work ledger, lease, or profile
  mutation;
- Workflow Snapshot -> raw credential-bearing profile projection;
- Workflow Snapshot -> HTTP server, browser UI, PID, or fixed-port lifecycle;
- Plan discovery -> branch or repository-wide active Plan scans.
