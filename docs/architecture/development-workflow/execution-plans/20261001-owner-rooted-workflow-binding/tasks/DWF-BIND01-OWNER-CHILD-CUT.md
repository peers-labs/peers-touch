# Owner Binding And Workspace Bootstrap Atomic Cut

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-OWNER-BINDING-HARD-CUT-20261001",
  "taskId": "DWF-BIND01-OWNER-CHILD-CUT",
  "workstreamId": "DWF-BINDING-CORE",
  "title": "Implement owner-rooted bindings and one multi-root workspace bootstrap",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "owner-child-binding-cut",
  "journeyId": "DEV-J01",
  "runtimeClass": "source-only",
  "writeSet": [
    "AGENTS.md",
    "docs/architecture/architecture-module-governance/architecture-modules.json",
    "docs/architecture/development-workflow",
    "docs/global/workflow.md",
    "docs/knowledge/invariants",
    "docs/knowledge/pitfalls/acceptance-shared-validator-variant-assumptions.md",
    "tooling/make/setup.mk",
    "tooling/plugins/pt-ew-plugin",
    "tooling/make/local-dev.mk",
    "tooling/scripts/agent-integration-audit-test.py",
    "tooling/scripts/agent-integration-audit.py",
    "tooling/scripts/agent-integration-control.py",
    "tooling/scripts/acceptance-gap-detect-test.py",
    "tooling/scripts/acceptance-gap-detect.py",
    "tooling/scripts/install-agent-integration.sh",
    "tooling/scripts/local-dev",
    "tooling/scripts/review/skill-check.sh",
    "tooling/skills/pt-acceptance-gap-detector",
    "tooling/skills/pt-completion-auditor",
    "tooling/skills/pt-context-anchor",
    "tooling/skills/pt-dev-workflow",
    "tooling/skills/pt-github-review",
    "tooling/skills/pt-goal-orchestrator",
    "tooling/skills/pt-trae-host-adapter"
  ],
  "readSet": [
    "tooling/scripts/plan"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 300,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "binding-source-suite",
      "command": "node --test tooling/scripts/local-dev/workflow-*.test.mjs tooling/plugins/pt-ew-plugin/scripts/hook-entry.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "binding-functional-journey",
      "command": "node --test --test-name-pattern='owner|child|lineage|stale|cross-worktree|claim|multi-root' tooling/scripts/local-dev/workflow-*.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "bootstrap-source-suite",
      "command": "python3 -m unittest tooling/scripts/agent-integration-audit-test.py && python3 tooling/scripts/acceptance-gap-detect-test.py",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "bootstrap-functional-journey",
      "command": "python3 tooling/scripts/agent-integration-audit-test.py -k workspace_bootstrap",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "binding-control-plane-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-infra-validation --gate acceptance-plan-self --gate acceptance-runtime-provisioning-self --gate development-workflow-control-plane --gate acceptance-workflow-contract",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "TRAE OWNER identity uses chat_session_id and never session_id",
    "OWNER, WORKER, and REVIEWER bindings preserve exact root and parent lineage",
    "Expired or terminal children do not participate in current claims",
    "Completion Review resolves its current OWNER and assigned REVIEWER without worktree-wide enumeration",
    "Status, handoff, Stop, worker result, and final claims use one BindingProjection",
    "workflow-conversation-binding.mjs and all live imports are deleted",
    "CROSS_WORKTREE_WRITE_DENIED remains enforced",
    "A multi-root descriptor has exactly one managed TRAE bootstrap",
    "Bootstrap location and folder order cannot select execution authority",
    "Explicit New Task root or one-root mutation evidence selects the owner worktree",
    "Active-editor mismatch fails WORKTREE_SELECTION_REQUIRED instead of binding the wrong root",
    "Subagent and compact lifecycle hooks are installed and audited",
    "Hard-cut reset refuses live work and deletes only legacy conversation and Action Receipt stores",
    "Temporary-workspace callback proof passes without modifying sibling worktrees"
  ],
  "failureBehavior": [
    "Do not add a legacy schema reader, importer, alias, or dual writer",
    "Do not expire OWNER authority by TTL",
    "Do not infer reviewer independence from a different session ID",
    "Do not weaken cross-worktree write denial",
    "Do not write the shared workspace descriptor or sibling worktree during this source Plan",
    "Do not preserve per-worktree managed TRAE hooks",
    "Do not purge Plan, Session, Review, lease, or Acceptance stores",
    "Do not treat bootstrap installationRoot as execution authority"
  ],
  "updatedAt": "2026-10-01T10:30:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: implementation and source checks in progress.
- Amendment: core binding and bootstrap are one atomic closure because the new
  binding is required to perform its own independent Completion Review.
- Rollout proof uses temporary workspace roots; the real shared workspace
  remains a separately declared operation.
