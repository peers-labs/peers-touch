# Development Workflow Control Plane - Module Layout

> **Status**: accepted
> **Version**: v1.2
> **Created**: 2026-09-16 | **Updated**: 2026-09-16
> **Owner**: Platform Team

---

## 1. Directory Tree

```text
docs/architecture/development-workflow/
├── README.md
├── design.md
├── decisions.md
├── data-model.md
├── integration.md
├── module-layout.md
└── execution-plans/
    └── <date>-<slug>/
        ├── plan.md
        ├── tasks/
        │   └── <task-id>.md
        └── archive/
            └── <historical-input>.md

tooling/scripts/plan/
├── plan-package.mjs
├── plan-migration.mjs
├── planctl.mjs
└── planctl.test.mjs

tooling/scripts/local-dev/
├── dev-work-schema.mjs
├── dev-work-ledger.mjs
├── dev-work.mjs
├── dev-work.test.mjs
├── dev-session-schema.mjs
├── dev-session-store.mjs
├── dev-session.mjs
└── dev-session.test.mjs

~/.peers-touch/dev/
├── work.json
├── work.lock
└── workspaces/<workspaceId>/workflow/
    ├── <workItemId>/
    │   ├── session.json
    │   ├── events.ndjson
    │   ├── session.lock
    │   ├── checks/
    │   └── artifacts/
    └── plan-migration/
        ├── migration.json
        ├── migration.json.reviewed
        ├── migration.lock
        └── migration.lock.recovery
```

## 2. File Responsibilities

| Path | Responsibility |
|---|---|
| `README.md` | Module scope, verified problem and navigation |
| `design.md` | Ownership, boundaries, data flow, resume and cutover contracts |
| `decisions.md` | DWF-D01..DWF-D14 ADR-lite decisions |
| `data-model.md` | Closed schemas and state transition guards |
| `integration.md` | Skill, Make, Acceptance, Quality and migration mapping |
| `execution-plans/*/plan.md` | Stable Plan Package manifest and Acceptance contract |
| `execution-plans/*/tasks/*.md` | One independently resumable Task Slice |
| `execution-plans/*/archive/*` | Historical input excluded from all live parsing |
| `plan-package.mjs` | Structured Markdown parser, schema validation, DAG and bounds |
| `plan-migration.mjs` | Locked, journaled migration with global path-role exclusion, atomic exchange/no-replace writes, takeover and recovery |
| `planctl.mjs` | `validate/current/next/status/advance/migrate` CLI |
| `planctl.test.mjs` | Package, DAG, bounds and CLI regression coverage |
| `dev-work-schema.mjs` | Resource declaration closed schema and digest |
| `dev-work-ledger.mjs` | Machine-wide declaration lock, conflict and lifecycle |
| `dev-work.mjs` | Resource declaration CLI |
| `dev-session-schema.mjs` | Session, verification, failure and transition schemas |
| `dev-session-store.mjs` | Atomic bounded event journal, replay and snapshot materialization |
| `dev-session.mjs` | Session `start/status/transition` CLI |
| `dev-session.test.mjs` | State, identity, guard, clock and symlink regressions |
| `tooling/scripts/acceptance-run.py` | Shared Journey/provisioning execution with explicit non-publishing development and formal Acceptance policies |
| `session.json` | Replayable current Development transition projection |
| `events.ndjson` | Bounded transition transaction journal |
| `migration.json` | Reviewed crosswalk/reference inventory, source identity, registry-backed `active_work` observation, prepared replacements and recovery state |
| `migration.json.reviewed` | Exact B4-reviewed PREPARED journal snapshot retained for commit/recovery lineage checks |
| `migration.lock` | Owner-token plan migration exclusion |
| `migration.lock.recovery` | Exclusive abandoned-lock recovery claim |
| `checks/` | Structured check records |
| `artifacts/` | Bounded transient diagnostics |

Development-policy artifacts use the current Session's `artifacts/` directory
and never enter the Acceptance Evidence Store namespace. Formal Acceptance
continues to use its own immutable run layout and latest pointers.

## 3. Dependency Direction

```text
planctl.mjs
  -> plan-package.mjs
  -> repository Plan Package files

dev-session.mjs
  -> dev-session-store.mjs
  -> dev-session-schema.mjs
  -> plan-package.mjs
  -> machine-dev-paths.mjs

dev-work.mjs
  -> dev-work-ledger.mjs
  -> dev-work-schema.mjs
  -> machine-dev-paths.mjs

Acceptance execution_plan.py
  -> Plan Package manifest contract
  -> current Task status
```

Forbidden dependencies:

- plan parser -> machine Session store;
- Task Slice -> `events.ndjson`;
- Session store -> Acceptance Evidence Store;
- archive parser -> current plan/task status;
- Skills -> private parsing logic that bypasses `planctl`.

## 4. Shared-File Ownership

During implementation:

- the integrator exclusively owns manifest, active pointer, Make targets,
  shared parser interfaces and final reconciliation;
- plan tooling and Session tooling may be implemented in parallel only after
  their schemas are frozen;
- Mobile pilot migration starts only after both validators pass;
- generated artifacts, commits, deployments and Acceptance runs remain serial.
