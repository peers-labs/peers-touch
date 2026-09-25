# Workspace Plan Binding Hard Cut

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-IMMUTABLE-PLAN-BINDING-20260918",
  "taskId": "DWF-PLAN-BINDING-HARD-CUT",
  "workstreamId": "DWF-PLAN-BINDING",
  "title": "Hard-cut Plan discovery and source identity to their owners",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "immutable-workspace-plan-binding",
  "journeyId": "DWF-J18-immutable-plan-binding",
  "runtimeClass": "source-only",
  "writeSet": [
    ".gitignore",
    "AGENTS.md",
    "apps/dev",
    "docs/architecture/acceptance-framework/decisions.md",
    "docs/architecture/developer-toolchain",
    "docs/architecture",
    "docs/global/workflow.md",
    "docs/architecture/local-dev-control-plane",
    "docs/global/local-dev-environment.md",
    "docs/knowledge",
    "Makefile",
    "tooling/acceptance",
    "tooling/make",
    "tooling/scripts",
    "tooling/skills"
  ],
  "readSet": [],
  "budgets": {
    "focusedCheckSeconds": 120,
    "functionalRunSeconds": 300,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "workspace-plan-binding-node",
      "command": "node --test tooling/scripts/plan/workspace-plan-binding.test.mjs",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "advancing-head-ownership-node",
      "command": "node --test tooling/scripts/lib/machine-dev-paths.test.mjs tooling/scripts/local-dev/active-work-store.test.mjs tooling/scripts/local-dev/dev-work.test.mjs tooling/scripts/local-dev/dev-session.test.mjs tooling/scripts/plan/planctl.test.mjs apps/dev/server/status.test.mjs",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "execution-plan-python",
      "command": "python3 -m unittest tooling.acceptance.tests.test_execution_plan",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "skill-rollout-python",
      "command": "python3 -m unittest tooling/scripts/skill-rollout-audit-test.py",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "skill-overlay-python",
      "command": "python3 -m unittest tooling/scripts/skill-overlay-control-test.py",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "skill-governance",
      "command": "tooling/scripts/review/skill-check.sh",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "development-workflow-gate",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-workflow-contract",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Each workspace resolves only its immutable Plan binding",
    "Plan Packages retain immutable initial HEAD without owning advancing source identity",
    "Declaration and Session checks bind current source to the live Git HEAD",
    "Each workspace owns one atomic active-work record under its machine workflow root",
    "No runtime writer rewrites a shared project_memory active_work table",
    "Peers Dev and Context Anchor aggregate workspace records read-only",
    "peers-dev-workflow distributes implementation but owns no consuming worktree runtime state",
    "Rollout tests prove two consuming worktrees derive disjoint active-work paths",
    "Goal scheduling, Plan Run continuation, runtime verification and Skill rollout are host-neutral",
    "User-specific interaction policy is installed through a machine-local digest-verified Overlay and cannot change project execution semantics",
    "User and formal Plan authorization is reused without repeat confirmation",
    "Foreign synchronized Plans are ignored",
    "Rebind and missing-binding paths fail closed",
    "CI requires an explicit Plan input"
  ],
  "failureBehavior": [
    "Do not fall back to branch or repository scans",
    "Do not add an unbind or rebind compatibility path",
    "Return typed binding errors without changing the binding"
  ],
  "updatedAt": "2026-09-21T07:52:00.000Z",
  "durableEvidence": [
    {
      "verificationClass": "STRUCTURAL_CHECK",
      "result": "PASS",
      "ref": "active-work/Peers Dev 20/20; Development declaration 19/19; Session 34/34; PlanCTL/binding 117/117; Peers Dev server 16/16"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "Acceptance runner 78/78; execution Plan adapter 12/12; worktree binding 18/18; rollout 19/19"
    },
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "pre-final acceptance-workflow-contract run 20260919T084143787015Z-8e4bf6a5251004060e181f26c528f1e6"
    },
    {
      "verificationClass": "STRUCTURAL_CHECK",
      "result": "PASS",
      "ref": "skill-check and source rollout audit PASS; final source-bound results remain in their Session and Evidence Store owners"
    },
    {
      "verificationClass": "STRUCTURAL_CHECK",
      "result": "PASS",
      "ref": "user Skill Overlay control 9/9; real install, resolve, disable and enable lifecycle PASS"
    }
  ]
}
```

## Current Snapshot

- State: implementing the accepted machine-local user Overlay amendment.
- Accepted owner correction: repository/PR may contain multiple Plans, while
  each workspace binds one Plan and cannot switch that binding.
- Source implementation: unversioned Plan/Task/rollout contracts, immutable Plan
  binding, workspace-owned active-work,
  continuous Plan Run, host-neutral scheduler/adapters, owner-run functional
  result commit, and rollout audit are integrated.
- Verification: focused suites and the preliminary workflow Gate pass; the
  final exact-worktree Gate result is reported at handoff without rewriting
  source after proof.
- Owner correction: mutable tracked-work continuation is workspace-owned machine
  state. `project_memory.md`, Peers Dev and Context Anchor are read-only
  projections and never rewrite another workspace's record.
- Source/runtime boundary: `peers-dev-workflow` versions and distributes the
  implementation. The installed copy executes in each consuming worktree and
  derives that worktree's machine-state path; the source repository is not a
  central runtime-state owner.
- Authorization boundary: an exact user or accepted Plan grant executes
  directly across Task/Goal/context boundaries; only out-of-envelope actions
  or actual external permission failures may trigger an authorization question.
- Overlay boundary: canonical `pt-ew` hosts optional interaction policy from a
  digest-verified machine-local registry; English coaching no longer exists in
  shared project Skill policy.
- Focused verification: Overlay 9/9, rollout 19/19, workspace binding 6/6,
  Development control-plane Node 194/194 and execution-plan adapter 12/12.
- Exact-source Development and formal Acceptance results remain outside this
  tracked snapshot and are not back-written after the checkpoint.

## Concurrency Decision

- Mode: hybrid.
- Integrator-owned serial write set: Plan/Task, `AGENTS.md`, architecture and
  knowledge contracts, machine path/store/CLI, Make targets, Peers Dev
  aggregation, shared Skills, rollout scripts and final Gates.
- Parallel lanes: read-only source semantic inventory and read-only legacy
  `active_work` reference audit.
- Reason: the replacement store defines interfaces consumed by every writer and
  projection; parallel writers would recreate the ownership conflict this Task
  removes.
