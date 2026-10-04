# Nonblocking Integration Control Actions

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-NONBLOCKING-INTEGRATION-20261004",
  "taskId": "DWF-NBI01-CONTROL-ACTIONS",
  "workstreamId": "DWF-INTEGRATION-CONTROL",
  "title": "Separate projection, hard cut, and retired-projection GC",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "nonblocking-control-actions",
  "journeyId": "DEV-J01",
  "runtimeClass": "source-only",
  "writeSet": [
    "Makefile",
    "docs/architecture/architecture-module-governance/architecture-modules.json",
    "docs/architecture/development-workflow",
    "docs/knowledge/invariants/owner-rooted-workflow-binding.md",
    "tooling/make/setup.mk",
    "tooling/plugins/pt-ew-plugin",
    "tooling/scripts/agent-integration-audit-test.py",
    "tooling/scripts/agent-integration-audit.py",
    "tooling/scripts/agent-integration-control.py",
    "tooling/scripts/install-agent-integration.sh",
    "tooling/scripts/local-dev"
  ],
  "readSet": [
    "tooling/acceptance",
    "tooling/scripts/review"
  ],
  "budgets": {
    "focusedCheckSeconds": 420,
    "functionalRunSeconds": 420,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "integration-control-source",
      "command": "python3 -m unittest tooling/scripts/agent-integration-audit-test.py",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "integration-control-functional",
      "command": "python3 tooling/scripts/agent-integration-audit-test.py -k 'install_with_live_declaration or hard_cut or skills_gc'",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "integration-action-contract",
      "command": "node --test tooling/scripts/local-dev/workflow-action-store.test.mjs tooling/scripts/local-dev/workflow-kernel.test.mjs tooling/scripts/local-dev/workflow-tool-intent.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "integration-control-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-workflow-contract --gate development-workflow-control-plane",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Ordinary skills install succeeds with its exact grant while an unrelated declaration is active",
    "Ordinary skills install preserves legacy conversation and Action Receipt stores",
    "Hard cut and GC use distinct exact OWNER_CONTROL grants",
    "Hard cut and GC reject unrelated live declarations, assignments, actions, and Action Store locks",
    "Hard cut deletes only legacy conversation and workflow-action stores",
    "GC deletes only retired project Skill and plugin projections",
    "No combined install-and-purge path remains"
  ],
  "failureBehavior": [
    "Do not weaken OWNER binding or cross-worktree write enforcement",
    "Do not allow cleanup with a skills projection grant",
    "Do not treat a short machine lock as global-idle proof",
    "Do not delete Plan, Session, Completion Review, lease, or Acceptance stores",
    "Do not modify pre-existing generated capability files"
  ],
  "updatedAt": "2026-10-04T01:50:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: pending.
- Next: implement distinct operation labels and split projection from cleanup.
