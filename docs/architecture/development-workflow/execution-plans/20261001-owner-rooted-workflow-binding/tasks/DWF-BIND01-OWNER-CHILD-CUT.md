# Owner And Child Binding Atomic Cut

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-OWNER-BINDING-HARD-CUT-20261001",
  "taskId": "DWF-BIND01-OWNER-CHILD-CUT",
  "workstreamId": "DWF-BINDING-CORE",
  "title": "Replace peer conversation bindings with one owner-rooted lineage",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "owner-child-binding-cut",
  "journeyId": "DEV-J01",
  "runtimeClass": "source-only",
  "writeSet": [
    "AGENTS.md",
    "docs/architecture/development-workflow",
    "docs/global/workflow.md",
    "docs/knowledge/invariants",
    "tooling/plugins/pt-ew-plugin",
    "tooling/make/local-dev.mk",
    "tooling/scripts/local-dev",
    "tooling/scripts/review/skill-check.sh",
    "tooling/skills/pt-completion-auditor",
    "tooling/skills/pt-context-anchor",
    "tooling/skills/pt-dev-workflow",
    "tooling/skills/pt-github-review",
    "tooling/skills/pt-goal-orchestrator",
    "tooling/skills/pt-trae-host-adapter"
  ],
  "readSet": [
    "docs/architecture/architecture-module-governance/architecture-modules.json",
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
      "command": "node --test --test-name-pattern='owner|child|lineage|stale|cross-worktree|claim' tooling/scripts/local-dev/workflow-*.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "binding-control-plane-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate development-workflow-control-plane",
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
    "CROSS_WORKTREE_WRITE_DENIED remains enforced"
  ],
  "failureBehavior": [
    "Do not add a legacy schema reader, importer, alias, or dual writer",
    "Do not expire OWNER authority by TTL",
    "Do not infer reviewer independence from a different session ID",
    "Do not weaken cross-worktree write denial"
  ],
  "updatedAt": "2026-10-01T09:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: ready after Plan activation.
- Cutover boundary: all consumers move before the old binding module is deleted.
- Non-claim: source checks do not prove installed multi-root bootstrap behavior.
