# Development Workflow Control Plane - Module Layout

> **Status**: active
> **Created**: 2026-09-16 | **Updated**: 2026-10-01
> **Owner**: Platform Team

---

## 1. Target Directory Tree

This is the accepted DWF-D38 target. PlanMount owns tracked execution placement;
standalone work does not create Plan package or machine-local tracked state.
The superseded workspace-binding path is deleted, and target paths are not by
themselves implementation readiness claims.

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
├── planctl.mjs
├── planctl.test.mjs
├── plan-mount.mjs
└── plan-mount.test.mjs

tooling/scripts/local-dev/
├── dev-work-schema.mjs
├── dev-work-ledger.mjs
├── dev-work.mjs
├── dev-work.test.mjs
├── dev-resource-plan.mjs
├── dev-resource-plan.test.mjs
├── dev-session-schema.mjs
├── dev-session-store.mjs
├── dev-session.mjs
├── dev-session.test.mjs
├── completion-review.mjs
├── completion-review.test.mjs
├── workflow-action-store.mjs
├── workflow-action-store.test.mjs
├── workflow-anchor.mjs
├── workflow-binding-projection.mjs
├── workflow-binding-projection.test.mjs
├── workflow-binding-store.mjs
├── workflow-binding-store.test.mjs
├── workflow-binding.mjs
├── workflow-doctor.mjs
├── workflow-host-adapters.mjs
├── workflow-kernel.mjs
├── workflow-snapshot-core.mjs
├── workflow-snapshot.mjs
├── workflow-state-inspector.mjs
├── workflow-tool-intent.mjs
└── workflow-*.test.mjs

tooling/plugins/pt-ew-plugin/
├── .codex-plugin/plugin.json
├── hooks.json
└── scripts/
    ├── hook-entry.mjs
    └── hook-entry.test.mjs

tooling/scripts/
├── agent-integration-control.py
├── agent-integration-audit.py
├── agent-integration-audit-test.py
├── install-agent-integration.sh
├── skill-overlay-control.py
└── skill-overlay-control-test.py

~/.peers-touch/dev/
├── work.json
├── work.lock
├── plan-mounts/
│   ├── ledger.json
│   ├── ledger.lock
│   └── mounts/<mountId>.json
├── skill-overlays/
│   ├── registry.json
│   ├── registry.lock
│   └── store/<name>/<digest>/
│       ├── overlay.json
│       └── SKILL.md
└── workspaces/<workspaceId>/workflow/
    ├── active-work.json
    ├── active-work.lock
    ├── agent-integration.json
    ├── <workItemId>/
    │   ├── execution-plan-snapshot.json
    │   ├── execution-run.json
    │   ├── session.json
    │   ├── events.ndjson
    │   ├── resource-plan.json
    │   ├── session.lock
    │   ├── checks/
    │   └── artifacts/

~/.peers-touch/dev/bindings/
├── owners/<host>/<rootChatHash>/
│   ├── owner-binding.json
│   ├── anchor-receipt.json
│   ├── assignments/<assignmentId>.json
│   └── releases/<anchorDigest>.json
└── children/<rootBindingDigest>/<host>/<executionSessionHash>/
    ├── child-binding.json
    └── terminal.json
```

## 2. File Responsibilities

Responsibilities below describe the NBI02 PlanMount cutover result.

| Path | Responsibility |
|---|---|
| `README.md` | Module scope, verified problem and navigation |
| `design.md` | Ownership, boundaries, data flow, resume and cutover contracts |
| `decisions.md` | DWF-D01..DWF-D39 ADR-lite decisions |
| `data-model.md` | Closed schemas and state transition guards |
| `integration.md` | Skill, Make, Acceptance, Quality and migration mapping |
| `execution-plans/*/plan.md` | Frozen Plan Version and Acceptance contract |
| `execution-plans/*/tasks/*.md` | One immutable Task Slice specification |
| `execution-plans/*/archive/*` | Historical input excluded from all live parsing |
| `plan-package.mjs` | Structured Markdown parser, schema validation, DAG, bounds, and Task-closure progress projection |
| `planctl.mjs` | `validate/current/next/status/activate/advance/reopen/invalidate-source` CLI |
| `planctl.test.mjs` | Package, DAG, bounds and CLI regression coverage |
| `plan-mount.mjs` | Project Ledger mount/unmount owner, immutable snapshot creation, live-worktree exclusion, and direct resolution |
| `plan-mount.test.mjs` | Authoring/execution separation, idempotence, mount conflict, explicit unmount, snapshot, tamper, and concurrency regressions |
| `dev-work-schema.mjs` | Resource declaration closed schema and digest |
| `dev-work-ledger.mjs` | Machine-wide declaration lock, conflict and lifecycle |
| `dev-work.mjs` | Resource declaration CLI |
| `dev-resource-plan.mjs` | Standard ModuleImpact validation, target dependency closure, peak-capacity planning, concrete resource selection, declaration update, fencing, and Runtime Owner result receipt |
| `dev-resource-plan.test.mjs` | Single/multi-module, reuse/build/restart, capacity parking, all-or-none reservation, replacement, idempotency, and fencing regressions |
| `active-work-store.mjs` | Consuming-workspace active-work schema, revision/CAS, digest, lock and atomic storage |
| `active-work.mjs` | Owner-derived active-work sync/status/close CLI |
| `dev-session-schema.mjs` | Session, verification, failure and transition schemas |
| `dev-session-store.mjs` | Atomic bounded event journal, multi-transition result commit, replay and snapshot materialization |
| `dev-session.mjs` | Session `start/status/transition/functional-result` CLI |
| `dev-session.test.mjs` | State, identity, guard, clock and symlink regressions |
| `completion-review.mjs` | Repository-native current-source review request, reviewer capability, assessment proof, receipt, and freshness owner |
| `workflow-action-store.mjs` | Bounded redacted Action Receipt chain and activity reduction |
| `workflow-host-adapters.mjs` | TRAE/Cursor/Codex event normalization and native response rendering; no cross-host identity aliases |
| `workflow-binding-projection.mjs` | Pure host-specific root/execution identity projection plus role, lineage and subject/tool/target roots |
| `workflow-binding-store.mjs` | Atomic OWNER binding, child assignment/claim/lease/terminal lifecycle, Anchor receipt and OWNER release |
| `workflow-binding.mjs` | OWNER-authorized child assignment, terminalization, status, and hard-cut reset CLI |
| `workflow-tool-intent.mjs` | Structured shell/tool intent parsing without regex command admission |
| `workflow-anchor.mjs` | Deterministic Context Anchor rendering and response/transcript verification |
| `workflow-state-inspector.mjs` | Read-only mount, snapshot, run, declaration, active-work, Session, Git and terminal-state validation |
| `workflow-kernel.mjs` | Host-neutral binding, subject-root, owner-state, source-scope, Stop and release policy |
| `workflow-snapshot-core.mjs` | Canonical read-only owner join consumed by workflow projections |
| `workflow-snapshot.mjs` | Thin CLI over Workflow Snapshot core |
| `workflow-doctor.mjs` | Executable truth matrix for public workflow promises |
| `tooling/plugins/pt-ew-plugin/` | Thin stdin/stdout adapter into the host-neutral Workflow Kernel |
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
| `tooling/scripts/install-agent-integration.sh` | Non-interactive dispatch for projection, hard-cut, and retired-projection GC |
| `tooling/scripts/agent-integration-audit.py` | Fail-closed source, participating-root Hook, recursive catalog, binding-store, receipt, and projection audit |
| `tooling/scripts/agent-integration-control.py` | Work-ledger-locked projection plus separately authorized global-idle hard-cut and retired-projection GC owners |
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
  -> repository frozen Plan Version files

plan-mount.mjs
  -> plan-package.mjs
  -> machine-dev-paths.mjs
  -> project mount ledger
  -> immutable ExecutionPlanSnapshot + mutable ExecutionRun

dev-session.mjs
  -> dev-session-store.mjs
  -> dev-session-schema.mjs
  -> plan-package.mjs
  -> machine-dev-paths.mjs

dev-work.mjs
  -> dev-work-ledger.mjs
  -> dev-work-schema.mjs
  -> plan-mount.mjs
  -> machine-dev-paths.mjs

Module Skills
  -> standard ModuleImpact
  -> dev-resource-plan.mjs
       -> target dependency graph + Runtime Owner inventory
       -> dev-work-ledger.mjs atomic concrete claims
       -> machine-local fenced PlanResourcePlan receipt
  -> Local Dev / Acceptance Suite Runtime physical owner

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

pt-ew-plugin
  -> host payload adapter
  -> host-specific root-chat / execution-session identity
  -> canonical BindingProjection
  -> ToolIntent AST + subject/tool/target roots
  -> workflow-kernel.mjs
       -> Plan mount / run / declaration / active-work / Session owner reads
       -> machine-rendered Anchor + atomic release receipt

Workflow Snapshot
  -> mount / snapshot / run / declaration / active-work / Session / Git owner reads
  -> Completion Review delegated receipt + bounded Action Receipt reduction
  -> CLI / Context Anchor / Workflow Doctor

Acceptance execution_plan.py
  -> current workspace PlanMount
  -> immutable ExecutionPlanSnapshot
  -> ExecutionRun current Task status
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
- canonical agent integration -> user Overlay registry or installed copies;
- IDE plugin or hook -> Plan, Task, Session, declaration, active-work, or
  evidence mutation;
- tool `cwd`, target, or internal execution `session_id` -> OWNER execution-root rebinding;
- unassigned child session -> WORKER/REVIEWER claim;
- completion review -> worktree-wide unreleased binding enumeration;
- current binding reader -> legacy conversation/action store;
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
