# Development Workflow Control Plane - Module Layout

> **Status**: accepted
> **Created**: 2026-09-16 | **Updated**: 2026-09-21
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
├── planctl.test.mjs
├── workspace-plan-binding.mjs
└── workspace-plan-binding.test.mjs

tooling/scripts/
├── plan_lifecycle_source.py
└── plan_lifecycle_source_test.py

tooling/scripts/local-dev/
├── dev-work-schema.mjs
├── dev-work-ledger.mjs
├── dev-work.mjs
├── dev-work.test.mjs
├── dev-session-schema.mjs
├── dev-session-store.mjs
├── dev-session.mjs
└── dev-session.test.mjs

tooling/scripts/
├── skill-overlay-control.py
└── skill-overlay-control-test.py

~/.peers-touch/dev/
├── work.json
├── work.lock
├── skill-overlays/
│   ├── registry.json
│   ├── registry.lock
│   └── store/<name>/<digest>/
│       ├── overlay.json
│       └── SKILL.md
└── workspaces/<workspaceId>/workflow/
    ├── plan-binding.json
    ├── active-work.json
    ├── active-work.lock
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
| `decisions.md` | DWF-D01..DWF-D27 ADR-lite decisions |
| `data-model.md` | Closed schemas and state transition guards |
| `integration.md` | Skill, Make, Acceptance, Quality and migration mapping |
| `execution-plans/*/plan.md` | Stable Plan Package manifest and Acceptance contract |
| `execution-plans/*/tasks/*.md` | One independently resumable Task Slice |
| `execution-plans/*/archive/*` | Historical input excluded from all live parsing |
| `plan-package.mjs` | Structured Markdown parser, schema validation, DAG, bounds, and Task-closure progress projection |
| `plan-migration.mjs` | Locked, journaled migration with global path-role exclusion, atomic exchange/no-replace writes, takeover and recovery |
| `planctl.mjs` | `validate/current/next/status/activate/advance/invalidate-source/migrate` CLI with owner-safe Plan mutation locks and transient closure observation output |
| `planctl.test.mjs` | Package, DAG, bounds, activation, source invalidation, truthful Session closure and lock recovery coverage |
| `tooling/scripts/plan_lifecycle_source.py` | Strict frozen-runtime/current-control Plan lifecycle validator |
| `tooling/scripts/plan_lifecycle_source_test.py` | Positive and fail-closed lifecycle source projection coverage |
| `acceptance-admission.mjs` | Bound Plan/current Task/Session readiness guard before broad Acceptance |
| `acceptance_admission.py` | Shared Python adapter for Acceptance runner and Gap Detector admission |
| `workspace-plan-binding.mjs` | One-time immutable workspace-to-Plan binding and direct resolution |
| `workspace-plan-binding.test.mjs` | Same-branch isolation, idempotence, rebind denial and missing-bound-Plan regressions |
| `dev-work-schema.mjs` | Resource declaration closed schema and digest |
| `dev-work-ledger.mjs` | Machine-wide declaration lock, conflict and lifecycle |
| `dev-work.mjs` | Resource declaration CLI |
| `active-work-store.mjs` | Consuming-workspace active-work schema, revision/CAS, digest, lock and atomic storage |
| `active-work.mjs` | Owner-derived active-work sync/status/close CLI |
| `git-workspace.mjs` | Stable Git/worktree content identity and dirty-workspace digest |
| `workflow-snapshot.mjs` | Pure cross-owner consistency projection, typed verdict, and optional compact Anchor projection |
| `workflow-snapshot.test.mjs` | HEALTHY/BLOCKED/DRIFT/SUSPENDED and owner-join regressions |
| `dev-session-schema.mjs` | Session, verification, failure and transition schemas |
| `dev-session-store.mjs` | Atomic bounded event journal, terminal archive, owner repair, non-mutating projection reads, multi-transition result commit, snapshot materialization, and pure timing aggregation |
| `dev-session.mjs` | Session `start/status/archive/transition/functional-result` CLI |
| `dev-session.test.mjs` | State, identity, guard, clock and symlink regressions |
| `tooling/scripts/acceptance-run.py` | Shared Journey/provisioning execution with explicit non-publishing development and formal Acceptance policies |
| `session.json` | Replayable current Development transition projection |
| `active-work.json` | One consuming workspace's resumable locator projection; never shared across workspace IDs |
| `events.ndjson` | Bounded transition transaction journal |
| `migration.json` | Reviewed crosswalk/reference inventory, source identity, registry-backed `active_work` observation, prepared replacements and recovery state |
| `migration.json.reviewed` | Exact B4-reviewed PREPARED journal snapshot retained for commit/recovery lineage checks |
| `migration.lock` | Owner-token plan migration exclusion |
| `migration.lock.recovery` | Exclusive abandoned-lock recovery claim |
| `checks/` | Structured check records |
| `artifacts/` | Bounded transient diagnostics |
| `tooling/skills/pt-goal-orchestrator/` | Host-neutral Goal scheduling contract, template, and review rubric |
| `tooling/skills/pt-dev-runtime-handoff/` | Project runtime, Journey, Session result, and cleanup owner |
| `tooling/skills/pt-{trae,cursor,codex}-host-adapter/` | Optional host tool transports with no project-state authority |
| `tooling/scripts/install-project-skills.sh` | Non-interactive per-host canonical `pt-*` projection and legacy Skill retirement |
| `tooling/scripts/skill-rollout-audit.py` | Fail-closed single/fleet worktree source, registry matcher, recursive catalog, workflow identity, receipt, and host-projection audit |
| `tooling/scripts/skill-rollout-control.py` | Out-of-band host projection installer, path-containment guard, and atomic catalog observation receipt |
| `tooling/scripts/skill-overlay-control.py` | Machine-local user Overlay install/list/enable/disable/uninstall/resolve owner with immutable-copy and digest validation |
| `tooling/scripts/skill-overlay-control-test.py` | Overlay lifecycle, ordering, collision, symlink, registry, and tamper regression coverage |
| `tooling/skills/pt-ew/` | Shared Overlay host and mandatory delegation boundary to `pt-god-view` |
| `skill-overlays/registry.json` | User-owned Overlay enablement and deterministic resolution source |
| `skill-overlays/store/<name>/<digest>/` | Immutable installed Overlay copy; never a canonical project Skill projection |

Development-policy artifacts use the current Session's `artifacts/` directory
and never enter the Acceptance Evidence Store namespace. Formal Acceptance
continues to use its own immutable run layout and latest pointers.

## 3. Dependency Direction

```text
planctl.mjs
  -> plan-package.mjs
  -> repository Plan Package files

workspace-plan-binding.mjs
  -> plan-package.mjs
  -> machine-dev-paths.mjs
  -> machine-local immutable plan-binding.json

dev-session.mjs
  -> dev-session-store.mjs
  -> dev-session-schema.mjs
  -> plan-package.mjs
  -> machine-dev-paths.mjs

dev-work.mjs
  -> dev-work-ledger.mjs
  -> dev-work-schema.mjs
  -> workspace-plan-binding.mjs
  -> machine-dev-paths.mjs

pt-dev-workflow
  -> pt-goal-orchestrator
  -> pt-execution-plan-guardian
  -> pt-dev-runtime-handoff
       -> repository-native driver
  -> admitted Host Capability Request
       -> detected pt-*-host-adapter when needed

pt-ew
  -> skill-overlay-control.py resolve
  -> digest-verified installed SKILL.md
  -> pt-god-view

Acceptance execution_plan.py
  -> immutable workspace Plan binding
  -> bound Plan Package manifest contract
  -> current Task status
```

Forbidden dependencies:

- plan parser -> machine Session store;
- Plan discovery -> branch/repository active-Plan scan;
- Task Slice -> `events.ndjson`;
- Session store -> Acceptance Evidence Store;
- Host adapter -> Plan, Task, Session, workspace active-work, or evidence mutation;
- Host-specific scheduler -> project work graph or progress semantics;
- user Overlay -> Plan, Task, Session, authorization, execution, evidence, or
  Acceptance mutation;
- canonical Skill rollout -> user Overlay registry or installed copies;
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
