# Development Standard Cut

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-TRUSTED-AUTONOMOUS-DEVELOPMENT-20260920",
  "taskId": "DWF-H05-STANDARD-CUT",
  "workstreamId": "DWF-STANDARD",
  "title": "Make one concise development standard the human entry point",
  "workClass": "documentation",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "dwf-standard-cut",
  "journeyId": "DWF-J24-development-standard",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/global/workflow.md",
    "docs/architecture/development-workflow",
    "docs/knowledge",
    "tooling/skills"
  ],
  "readSet": [
    "AGENTS.md",
    "Makefile",
    "tooling/make"
  ],
  "budgets": {
    "focusedCheckSeconds": 120,
    "functionalRunSeconds": 120,
    "cleanupSeconds": 15
  },
  "checks": [
    {
      "id": "standard-skill-contract",
      "command": "tooling/scripts/review/skill-check.sh",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "docs/global/workflow.md is the single human-facing development standard",
    "Small, standard and large work use one flow with different artifact depth",
    "Implementation documents no longer duplicate the human operating procedure",
    "Skills reference machine decisions instead of restating divergent workflow logic",
    "No versioned workflow name or compatibility path remains"
  ],
  "failureBehavior": [
    "Do not move architecture or schema detail into the standard",
    "Do not create a second workflow guide",
    "Do not keep contradictory Skill copies in the same source tree"
  ],
  "updatedAt": "2026-09-20T04:55:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- `docs/global/workflow.md` is the single human-facing end-to-end standard and
  defines one flow with small, standard, and large artifact depths.
- Architecture documents identify themselves as machine ownership/schema/
  integration contracts.
- Workflow Skills reference the global standard and retain only their
  owner-specific routing, scheduling, policy, persistence, or projection
  behavior.
- `development-standard-is-single-source.md` records the durable no-duplication
  invariant.
- `tooling/scripts/review/skill-check.sh`: PASS.
