# Canonical Control Plane

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-PEERS-DEV-CANONICAL-20260926",
  "taskId": "DWF-CAN02-CONTROL-PLANE",
  "workstreamId": "DWF-CONTROL-PLANE",
  "title": "Integrate Snapshot, Action Receipt, Completion Review, and Doctor",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "canonical-control-plane",
  "journeyId": "DEV-J01",
  "runtimeClass": "source-only",
  "writeSet": [
    "tooling/make/setup.mk",
    "tooling/plugins",
    "tooling/scripts/agent-integration-audit-test.py",
    "tooling/scripts/agent-integration-audit.py",
    "tooling/scripts/agent-integration-control.py",
    "tooling/scripts/install-agent-integration.sh",
    "tooling/scripts/local-dev",
    "tooling/scripts/plan",
    "tooling/scripts/README.md",
    "tooling/scripts/review/skill-check.sh",
    "tooling/make/local-dev.mk",
    "tooling/skills"
  ],
  "readSet": [
    "apps/dev",
    "docs/architecture/development-workflow"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 60,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "workflow-source-suite",
      "command": "node --test tooling/scripts/local-dev/workflow-*.test.mjs tooling/scripts/local-dev/dev-session.test.mjs tooling/scripts/plan/planctl.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "workflow-doctor-journey",
      "command": "node --test tooling/scripts/local-dev/workflow-doctor.test.mjs tooling/scripts/local-dev/workflow-snapshot.test.mjs tooling/scripts/local-dev/completion-review.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "workflow-control-plane-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-workflow-contract --gate desktop-dev-runtime-isolation-static",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "One read-only Snapshot serves all status consumers",
    "Action Receipts are bounded, redacted, and non-authoritative",
    "Task closure requires a current independent Completion Review",
    "Workflow Doctor verifies the public promises"
  ],
  "failureBehavior": [
    "Do not weaken owner-run functional evidence",
    "Do not remove active-work consistency",
    "Do not allow a post-tool event to create conversation authority"
  ],
  "updatedAt": "2026-09-26T10:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: semantic migration in progress.
- Canonical safety contracts take precedence over the historical source.
- Historical product receipts are not current-source evidence.
