# MCA-A08 - Final Proof Set And Ledger Closure

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-A08",
  "workstreamId": "MCA-A08",
  "title": "Prove final exact source and close the parity ledger",
  "workClass": "product-behavior",
  "completionClass": "acceptance-aggregate",
  "executionMode": "build",
  "closureId": "V2-acceptance",
  "journeyId": "V2-acceptance",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/agent/lobehub-parity-mindmap.source.md",
    "docs/architecture/agent/execution-plans/20260917-modern-chat-agent-v2-alignment/plan.md",
    "docs/architecture/agent/execution-plans/20260917-modern-chat-agent-v2-alignment/tasks/MCA-A08.md"
  ],
  "readSet": [
    "apps/desktop",
    "apps/mobile",
    "apps/station/app/subserver/agent",
    "model/domain/agent",
    "packages/agent-catalog",
    "packages/locales",
    "packages/messaging-core",
    "tooling/acceptance",
    "tooling/scripts/acceptance-prove.py",
    "tooling/scripts/check-agent-v2-locales.mjs"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 21600,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "agent-domain-structure",
      "command": "make acceptance-validate DOMAIN=agent && node tooling/scripts/plan/planctl.mjs validate --plan docs/architecture/agent/execution-plans/20260917-modern-chat-agent-v2-alignment/plan.md",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "mcp-scenario-control",
      "command": "cd apps/station && go test ./app/subserver/agent/service -run '^TestCapabilityAcceptanceScenarioJ04AndJ05HookOwnership$' -count=1",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "agent-v2-final-proof",
      "command": "bash tooling/scripts/agent-v2-final-proof.sh",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "All seven Agent V2 parity Gates pass through separate runner and validator processes on the final exact source",
    "The immutable proof-set, D11, locales, hard rules, and all registry-required regression Gates validate",
    "The mind-map P3, E1, X3, and mapped V2 overlay rows cite current immutable proof",
    "Quality, completion, and PR review report no unowned required scope or false proof claim"
  ],
  "failureBehavior": [
    "Keep every missing or failed Gate explicitly UNPROVEN",
    "Return every source or proof-tool defect to a bounded functional remediation Task",
    "Do not update parity status from source, development, stale, or candidate evidence",
    "Do not close the Plan or Goal while any required CI or review remains blocking"
  ],
  "updatedAt": "2026-09-24T20:38:00Z",
  "durableEvidence": []
}
```

## Objective

Deploy the final checkpoint, rerun all required formal and regression evidence,
publish the seven-envelope proof-set, update the parity ledger, and complete PR
delivery.

## Current Snapshot

- All Journey-specific candidate Tasks must close first.
- X3 is functionally complete but must be re-proven on final source.
- No aggregate completion claim exists for the final source.
