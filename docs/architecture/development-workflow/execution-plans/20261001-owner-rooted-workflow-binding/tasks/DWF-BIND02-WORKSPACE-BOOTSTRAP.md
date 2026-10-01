# TRAE Multi-Root Workspace Bootstrap

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-OWNER-BINDING-HARD-CUT-20261001",
  "taskId": "DWF-BIND02-WORKSPACE-BOOTSTRAP",
  "workstreamId": "DWF-BINDING-BOOTSTRAP",
  "title": "Install one canonical TRAE bootstrap for a multi-root workspace",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "multi-root-workspace-bootstrap",
  "journeyId": "DEV-J01",
  "runtimeClass": "source-only",
  "writeSet": [
    "AGENTS.md",
    "docs/architecture/development-workflow",
    "docs/global/workflow.md",
    "docs/knowledge/invariants",
    "tooling/make/setup.mk",
    "tooling/plugins/pt-ew-plugin",
    "tooling/scripts/agent-integration-audit-test.py",
    "tooling/scripts/agent-integration-audit.py",
    "tooling/scripts/agent-integration-control.py",
    "tooling/scripts/install-agent-integration.sh"
  ],
  "readSet": [
    "tooling/scripts/local-dev"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 300,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "bootstrap-source-suite",
      "command": "python3 -m unittest tooling/scripts/agent-integration-audit-test.py",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "bootstrap-functional-journey",
      "command": "python3 tooling/scripts/agent-integration-audit-test.py -k workspace_bootstrap",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "bootstrap-contract-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-workflow-contract",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "A multi-root descriptor has exactly one managed TRAE bootstrap",
    "Bootstrap location and folder order cannot select execution authority",
    "Explicit New Task root or one-root mutation evidence selects the owner worktree",
    "Active-editor mismatch fails WORKTREE_SELECTION_REQUIRED instead of binding the wrong root",
    "Subagent and compact lifecycle hooks are installed and audited",
    "Hard-cut reset refuses live work and deletes only legacy conversation and Action Receipt stores",
    "Temporary-workspace callback proof passes without modifying sibling worktrees"
  ],
  "failureBehavior": [
    "Do not write the shared workspace descriptor or sibling worktree during this source Plan",
    "Do not preserve per-worktree managed TRAE hooks",
    "Do not purge Plan, Session, Review, lease, or Acceptance stores",
    "Do not treat bootstrap installationRoot as execution authority"
  ],
  "updatedAt": "2026-10-01T09:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: pending on the owner/child core cut.
- Rollout proof uses temporary workspace roots and a synthetic descriptor.
- Real shared-workspace installation remains a separately declared operation.
