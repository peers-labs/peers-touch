# DWF-P1: Progress-Bearing Continuation Contract

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-PROGRESS-20260917",
  "taskId": "DWF-P1",
  "workstreamId": "DWF-PROGRESS",
  "title": "Progress-bearing continuation contract",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "dwf-progress-contract",
  "journeyId": "DWF-J01-progress-bearing-resume",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/development-workflow",
    "tooling/scripts/plan",
    "tooling/scripts/review",
    "tooling/skills"
  ],
  "readSet": [
    "docs/architecture/local-dev-control-plane"
  ],
  "budgets": {
    "focusedCheckSeconds": 120,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "dwf-plan-tests",
      "command": "node --test tooling/scripts/plan/planctl.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "dwf-skill-contract",
      "command": "bash tooling/scripts/review/skill-check.sh",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "planctl status derives completed and total Task closures",
    "the next Progress Slice exposes its exact delta and unlock effect",
    "Context Anchor no longer emits a free-text administrative next action",
    "Dev Workflow continues until Task closure or a hard boundary"
  ],
  "failureBehavior": [
    "reject progress not derived from Plan Package lifecycle",
    "reject a successful zero-delta continuation",
    "preserve Context Anchor as a read-only projection"
  ],
  "updatedAt": "2026-09-17T03:28:00.000Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "node --test tooling/scripts/plan/planctl.test.mjs (105/105)"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "bash tooling/scripts/review/skill-check.sh"
    }
  ]
}
```

## Objective

Make one Task closure the deterministic progress and continuation boundary for
Plan status, Goal scheduling, Dev Workflow execution, and Context Anchor
projection.

## Current Snapshot

- Architecture decisions are accepted.
- `planctl status.progress` projects the exact Task-closure delta.
- Context Anchor, Goal, Guardian, planning, and Dev Workflow contracts are aligned.
- Plan tests pass 105/105 and `skill-check` passes.
