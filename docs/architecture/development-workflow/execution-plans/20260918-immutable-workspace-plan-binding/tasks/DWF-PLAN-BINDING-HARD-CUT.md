# Workspace Plan Binding Hard Cut

## Task Slice

```json
{
  "schemaVersion": 1,
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
    "apps/dev",
    "AGENTS.md",
    "docs/architecture/agent/execution-plans/20260917-modern-chat-agent-v2-alignment/plan.md",
    "docs/architecture/acceptance-framework/decisions.md",
    "docs/architecture/chat-lifecycle/execution-plans/20260916-chat-lifecycle-product-closure/plan.md",
    "docs/architecture/developer-toolchain",
    "docs/architecture/development-workflow",
    "docs/architecture/local-dev-control-plane",
    "docs/global/local-dev-environment.md",
    "docs/knowledge",
    "Makefile",
    "tooling/acceptance",
    "tooling/devctl",
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
      "command": "node --test tooling/scripts/plan/planctl.test.mjs tooling/scripts/local-dev/dev-work.test.mjs tooling/scripts/local-dev/dev-session.test.mjs apps/dev/server/status.test.mjs",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "execution-plan-python",
      "command": "python3 -m unittest tooling.acceptance.tests.test_execution_plan",
      "verificationClass": "FUNCTIONAL_CHECK"
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
    "Foreign synchronized Plans are ignored",
    "Rebind and missing-binding paths fail closed",
    "CI requires an explicit Plan input"
  ],
  "failureBehavior": [
    "Do not fall back to branch or repository scans",
    "Do not add an unbind or rebind compatibility path",
    "Return typed binding errors without changing the binding"
  ],
  "updatedAt": "2026-09-18T02:02:15.000Z",
  "durableEvidence": [
    {
      "verificationClass": "STRUCTURAL_CHECK",
      "result": "PASS",
      "ref": "Plan, binding, declaration, Session and Peers Dev Node suites (166/166)"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "execution-plan Python suite (11/11), same-branch two-worktree isolation and explicit CI input"
    },
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "acceptance-workflow-contract run 20260918T020021966818Z-0e2bc0b6b20a576ec4a070698b2d1757"
    },
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "acceptance-plan-self, acceptance-infra-validation and acceptance-runtime-provisioning-self runs completed on the same source"
    }
  ]
}
```

## Current Snapshot

- State: verified; ready for atomic Plan completion
- Accepted owner correction: repository/PR may contain multiple Plans, while
  each workspace binds one Plan and cannot switch that binding.
- Source closure: Plan Packages retain immutable `initialHead`; declarations,
  Sessions and `active_work` own advancing source identity.
- Consumer closure: Acceptance, Development declarations/Sessions and Peers
  Dev resolve only the immutable workspace binding.
- Formal proof: all four completion Gates passed before Plan closure; a final
  exact-source rerun follows the metadata transition.
