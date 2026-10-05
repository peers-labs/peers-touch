# Truthful Task Closure

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-TRUSTED-AUTONOMOUS-DEVELOPMENT-20260920",
  "taskId": "DWF-H01-CLOSURE-TRUTH",
  "workstreamId": "DWF-TRUTH",
  "title": "Require successful Session evidence for Task closure and add the activation owner",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "dwf-truthful-task-closure",
  "journeyId": "DWF-J24-truthful-task-closure",
  "runtimeClass": "source-only",
  "writeSet": [
    "Makefile",
    "docs/architecture/development-workflow",
    "docs/knowledge",
    "tooling/make/local-dev.mk",
    "tooling/scripts/local-dev",
    "tooling/scripts/plan"
  ],
  "readSet": [
    "tooling/scripts/local-dev/dev-session-store.mjs"
  ],
  "budgets": {
    "focusedCheckSeconds": 120,
    "functionalRunSeconds": 180,
    "cleanupSeconds": 15
  },
  "checks": [
    {
      "id": "planctl-syntax",
      "command": "node --check tooling/scripts/plan/planctl.mjs",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "session-syntax",
      "command": "node --check tooling/scripts/local-dev/dev-session.mjs",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "planctl-node",
      "command": "node --test tooling/scripts/plan/planctl.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "session-node",
      "command": "node --test tooling/scripts/local-dev/dev-session.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "A prepared Plan is activated only through planctl",
    "Every tracked done transition requires an existing matching Session",
    "CANCELLED cannot satisfy Task completion",
    "Session identity and terminal state are revalidated inside the Plan lock",
    "Plan lock recovery is owner-safe",
    "A no-Gate functional Task executes and seals its declared FUNCTIONAL_CHECK commands without invoking broad Acceptance"
  ],
  "failureBehavior": [
    "Do not retain NONE or missing-Session compatibility",
    "Do not infer completion from Task snapshot text",
    "Return a typed error without changing the manifest"
  ],
  "updatedAt": "2026-09-20T05:15:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- `planctl activate` now owns prepared-to-active mutation.
- Session-less and cancelled completion paths are removed.
- The no-Gate functional owner path runs Task-declared checks so H01 closes without
  misclassifying its checks as broad Acceptance.
