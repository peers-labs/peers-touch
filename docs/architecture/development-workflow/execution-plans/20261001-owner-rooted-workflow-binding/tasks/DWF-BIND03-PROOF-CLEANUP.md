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
    "tooling/acceptance/gates/dev"
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
      "command": "python3 tooling/scripts/acceptance-run.py --gate development-workflow-control-plane --gate acceptance-workflow-contract --gate peers-dev-product --gate peers-dev-ui-browser-e2e",
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
  "updatedAt": "2026-10-01T09:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: pending on the atomic binding/bootstrap closure.
- Completion requires independent review and zero live legacy runtime imports.
- Actual shared-workspace bootstrap installation is not claimed by this Task.
