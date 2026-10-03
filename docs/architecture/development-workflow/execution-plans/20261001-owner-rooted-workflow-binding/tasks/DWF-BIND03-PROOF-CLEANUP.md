# Binding Hard-Cut Proof And Cleanup

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-OWNER-BINDING-HARD-CUT-20261001",
  "taskId": "DWF-BIND03-PROOF-CLEANUP",
  "workstreamId": "DWF-BINDING-DELIVERY",
  "title": "Prove the complete binding cut and close source workflow state",
  "workClass": "infrastructure",
  "completionClass": "acceptance-aggregate",
  "executionMode": "fix",
  "closureId": "binding-hard-cut-proof",
  "journeyId": "DEV-J04",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/development-workflow/execution-plans/20261001-owner-rooted-workflow-binding",
    "tooling/acceptance/gates/dev",
    "tooling/scripts/agent-integration-audit-test.py",
    "tooling/scripts/agent-integration-control.py",
    "tooling/scripts/local-dev/workflow-binding-store.mjs",
    "tooling/scripts/local-dev/workflow-binding-store.test.mjs",
    "docs/architecture/development-workflow/design.md",
    "docs/architecture/development-workflow/data-model.md",
    "docs/architecture/development-workflow/host-neutral-agent-integration.md",
    "docs/architecture/development-workflow/integration.md",
    "docs/knowledge/invariants/owner-rooted-workflow-binding.md",
    "tooling/skills/pt-github-review"
  ],
  "readSet": [
    "AGENTS.md",
    "docs/architecture/development-workflow",
    "docs/global/workflow.md",
    "docs/knowledge/invariants",
    "tooling/make/setup.mk",
    "tooling/plugins/pt-ew-plugin",
    "tooling/scripts/agent-integration-audit-test.py",
    "tooling/scripts/agent-integration-audit.py",
    "tooling/scripts/agent-integration-control.py",
    "tooling/scripts/local-dev",
    "tooling/scripts/review/skill-check.sh",
    "tooling/skills/pt-completion-auditor",
    "tooling/skills/pt-context-anchor",
    "tooling/skills/pt-dev-workflow",
    "tooling/skills/pt-github-review",
    "tooling/skills/pt-goal-orchestrator",
    "tooling/skills/pt-trae-host-adapter"
  ],
  "budgets": {
    "focusedCheckSeconds": 420,
    "functionalRunSeconds": 420,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "binding-complete-source",
      "command": "node --test tooling/scripts/local-dev/workflow-*.test.mjs tooling/plugins/pt-ew-plugin/scripts/hook-entry.test.mjs && python3 -m unittest tooling/scripts/agent-integration-audit-test.py",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "binding-zero-legacy",
      "command": "tooling/scripts/review/skill-check.sh",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "binding-completion-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-infra-validation --gate acceptance-plan-self --gate acceptance-runtime-provisioning-self --gate development-workflow-control-plane --gate acceptance-workflow-contract --gate peers-dev-product --gate peers-dev-ui-browser-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "All DWF-D33 Acceptance cells have current exact-source evidence",
    "Tree-wide search finds no runtime import or test dependency on workflow-conversation-binding.mjs",
    "No generic host identity alias or ICUBE fallback remains",
    "No worktree-wide active-binding fallback remains in Completion Review",
    "Architecture, operating guide, Skills, source, tests, and Gate registration agree",
    "Development declaration and active-work state are released after closure"
  ],
  "failureBehavior": [
    "Do not count historical completed Plan references as live runtime compatibility",
    "Do not claim real shared-workspace rollout from temporary fixture proof",
    "Do not modify sibling worktrees, push, open a pull request, merge, or rewrite history"
  ],
  "updatedAt": "2026-10-01T18:49:30.000Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "checkpoint cc9342d9a290e24f82ec386328b3632f9d24c2a3"
    },
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "acceptance://dbd1913c8dd24d52/acceptance-run/20261001T183202781664Z-20fbbfa2f01d82dd4b6be0722b6ba342"
    },
    {
      "verificationClass": "STRUCTURAL_CHECK",
      "result": "PASS",
      "ref": "acceptance://dbd1913c8dd24d52/acceptance-gap-detect/20261001T184844618530Z-6dbbadae02f6127d3d2c81fcfb10bae4"
    },
    {
      "verificationClass": "STRUCTURAL_CHECK",
      "result": "PASS",
      "ref": "acceptance://dbd1913c8dd24d52/code-structure-review/20261001T183124324278Z-29c5b60b58be75a08cf475d80e2a9e40"
    },
    {
      "verificationClass": "STRUCTURAL_CHECK",
      "result": "PASS",
      "ref": "acceptance://dbd1913c8dd24d52/quality-evidence/20261001T184855017976Z-0018b334dfdb723291a5ee5184052543"
    }
  ]
}
```

## Current Snapshot

- State: delivery-ready on exact clean checkpoint `cc9342d9a`; seven-Gate
  Acceptance, 55-path Gap Detector, code-structure review, and quality evidence
  are current and passing.
- The storage contract lists the per-binding compact-lineage path and the
  assignment-claim path used by the implementation.
- Completion requires one fresh Plan-scoped independent review receipt.
- Actual shared-workspace bootstrap installation is not claimed by this Task.
