# MCA-A01 - Alignment Acceptance And Ledger Closure

## Task Slice

```json
{
  "schemaVersion": 1,
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-A01",
  "workstreamId": "MCA-A01",
  "title": "Aggregate Acceptance and parity-ledger closure",
  "workClass": "product-behavior",
  "completionClass": "acceptance-aggregate",
  "executionMode": "build",
  "closureId": "V2-acceptance",
  "journeyId": "V2-J01..V2-J06,X3-P4-3",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/agent",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/desktop",
    "apps/station/app/subserver/agent",
    "model/domain/agent",
    "packages/locales"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 7200,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "agent-domain-structure",
      "command": "make acceptance-validate DOMAIN=agent && make plan-validate PLAN=docs/architecture/agent/execution-plans/20260917-modern-chat-agent-v2-alignment/plan.md",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "alignment-acceptance",
      "command": "make acceptance-run",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "All seven formal Gates pass on the final exact source with required receiver, Station, lineage, replay, cleanup, and source-identity artifacts",
    "The mind-map P3, E1, X3, and mapped V2 overlay rows cite current source and immutable Acceptance evidence",
    "The SVG and all current navigation/status sources agree with the parseable mind map",
    "Completion and quality audits report no unowned required scope or false proof claim"
  ],
  "failureBehavior": [
    "Keep every missing or failed Gate explicitly UNPROVEN",
    "Do not change a brain-map node to aligned from source or development evidence alone",
    "Return implementation defects to their owning Journey and rerun only affected proof before the aggregate"
  ],
  "updatedAt": "2026-09-16T16:36:26Z",
  "durableEvidence": []
}
```

## Objective

Promote the completed functional Journeys to formal proof and make the
execution plan, Acceptance registry, mind map, SVG, and navigation agree.

## Current Snapshot

- Six V2 product Gates are registered but remain `UNPROVEN`.
- The X3 catalog Gate must be implemented and registered by MCA-X3.
- No aggregate completion claim exists for the current exact source.
