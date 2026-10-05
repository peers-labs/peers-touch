# Workflow Snapshot

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-TRUSTED-AUTONOMOUS-DEVELOPMENT-20260920",
  "taskId": "DWF-H02-WORKFLOW-SNAPSHOT",
  "workstreamId": "DWF-OBSERVABILITY",
  "title": "Derive one read-only workflow snapshot for CLI, Peers Dev and Context Anchor",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "dwf-workflow-snapshot",
  "journeyId": "DWF-J24-workflow-observability",
  "runtimeClass": "source-only",
  "writeSet": [
    "Makefile",
    "apps/dev",
    "docs/architecture/development-workflow",
    "docs/knowledge",
    "tooling/make/local-dev.mk",
    "tooling/scripts/local-dev",
    "tooling/skills/pt-context-anchor"
  ],
  "readSet": [
    "tooling/scripts/plan",
    "tooling/scripts/lib/machine-dev-paths.mjs"
  ],
  "budgets": {
    "focusedCheckSeconds": 180,
    "functionalRunSeconds": 240,
    "cleanupSeconds": 15
  },
  "checks": [
    {
      "id": "workflow-snapshot-syntax",
      "command": "node --check tooling/scripts/local-dev/git-workspace.mjs && node --check tooling/scripts/local-dev/workflow-snapshot.mjs && node --check apps/dev/server/status.mjs && node --check apps/dev/server/index.mjs",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "workflow-snapshot-node",
      "command": "node --test tooling/scripts/local-dev/workflow-snapshot.test.mjs apps/dev/server/status.test.mjs apps/dev/server/index.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "One pure snapshot validates Plan, Session, declaration, Git, active-work, runtime and rollout relationships",
    "The snapshot returns HEALTHY, BLOCKED, DRIFT, or SUSPENDED with typed findings",
    "Peers Dev and Context Anchor consume the same projection semantics",
    "An incompatible or stale Peers Dev source is never silently reused",
    "Snapshot reads do not mutate owner state"
  ],
  "failureBehavior": [
    "Do not create a second persistent state store",
    "Do not let Peers Dev or Context Anchor repair owner state",
    "Do not hide missing or contradictory owner inputs"
  ],
  "updatedAt": "2026-09-20T05:30:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- The canonical read-only snapshot now joins every workflow owner and emits
  typed consistency findings.
- Peers Dev projects the canonical verdict, and server reuse now requires an
  exact workspace/branch/HEAD/content-digest match.
- Context Anchor now consumes `make workflow-snapshot` instead of recomputing
  cross-owner consistency.
