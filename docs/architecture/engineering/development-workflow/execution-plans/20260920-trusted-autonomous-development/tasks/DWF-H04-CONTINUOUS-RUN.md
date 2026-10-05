# Continuous Run Decision

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-TRUSTED-AUTONOMOUS-DEVELOPMENT-20260920",
  "taskId": "DWF-H04-CONTINUOUS-RUN",
  "workstreamId": "DWF-CONTINUATION",
  "title": "Make continuation a machine-derived decision and remove rollout handoffs",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "dwf-continuous-run",
  "journeyId": "DWF-J24-continuous-plan-run",
  "runtimeClass": "source-only",
  "writeSet": [
    "AGENTS.md",
    "docs/architecture/development-workflow",
    "docs/knowledge",
    "tooling/make",
    "tooling/scripts/local-dev",
    "tooling/scripts/skill-rollout-audit.py",
    "tooling/scripts/skill-rollout-audit-test.py",
    "tooling/scripts/skill-rollout-control.py",
    "tooling/skills"
  ],
  "readSet": [
    "tooling/scripts/plan",
    "apps/dev"
  ],
  "budgets": {
    "focusedCheckSeconds": 240,
    "functionalRunSeconds": 300,
    "cleanupSeconds": 15
  },
  "checks": [
    {
      "id": "continuation-and-rollout-syntax",
      "command": "node --check tooling/scripts/local-dev/workflow-snapshot.mjs && python3 tooling/scripts/skill-rollout-control.py --help >/dev/null",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "continuation-and-rollout",
      "command": "node --test tooling/scripts/local-dev/workflow-snapshot.test.mjs && python3 -m unittest tooling/scripts/skill-rollout-audit-test.py && tooling/scripts/review/skill-check.sh",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "The workflow snapshot returns CONTINUE, HARD_BLOCK, or COMPLETE",
    "CONTINUE remains valid across Task closure, review, Anchor and context boundaries",
    "Only a typed hard boundary permits user escalation",
    "Skill rollout is out-of-band catalog distribution and never blocks a business Plan",
    "No process restart acknowledgement or raw host session marker remains"
  ],
  "failureBehavior": [
    "Do not add another scheduler or persistent queue",
    "Do not treat Context Anchor as an execution owner",
    "Do not retain the restart ACK path as compatibility behavior"
  ],
  "updatedAt": "2026-09-20T04:55:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- Workflow Snapshot derives `CONTINUE | HARD_BLOCK | COMPLETE` from the same
  read-only owner join as its consistency verdict.
- Active Plan owner repair, Task handoff, review, Anchor, and context boundaries
  preserve `CONTINUE`; fixed-point blocked/non-running Plans and critical
  identity failure return `HARD_BLOCK`; valid terminal Plans return `COMPLETE`.
- Skill rollout is an out-of-band `INSTALLED` catalog observation. Business
  declarations, host session identity, process restart, and acknowledgement do
  not participate.
- Mechanical Plan amendment: `AGENTS.md` moved from shared-read to H04
  exclusive-write so the retired rollout handoff could be deleted completely.
