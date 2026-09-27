# W6C-PROOF - Profile And Settings Runtime Proof

## Task Slice

```json
{
    "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W6C-PROOF",
  "workstreamId": "W6C",
  "title": "Profile and Settings simulator proof",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "W6C-proof",
  "journeyId": "MS-J06-runtime-proof",
  "runtimeClass": "native-mobile",
  "writeSet": ["tooling/acceptance/gates/mobile", "tooling/acceptance/provisioners"],
  "readSet": ["apps/mobile", "apps/station", "docs/architecture/api-ownership", "docs/architecture/mobile", "docs/architecture/social-runtime"],
  "budgets": {"focusedCheckSeconds": 120, "functionalRunSeconds": 1800, "cleanupSeconds": 180},
  "checks": [
    {"id": "mobile-settings-proof-structure", "command": "python3 tooling/scripts/acceptance-validate.py --domain mobile", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "mobile-settings-runtime", "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item mobile-shell-w6c-proof --gate mobile-simulator-settings-e2e", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "mobile-settings-contract", "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-contract-static", "verificationClass": "ACCEPTANCE_PROOF"},
    {"id": "mobile-simulator-settings", "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-settings-e2e", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["Simulator Profile/privacy, aggregate Notification preference, blocked-user, and device settings ownership, persistence, conflict, and readback pass", "Second-simulator behavior proves Profile and Notification revisions while device-only values remain local", "Lost-response reconciliation never reports a divergent owner snapshot as saved", "Station change and logout preserve exact scope"],
  "failureBehavior": ["Unavailable required simulator, Station, or Fixture resources remain BLOCKED", "Do not promote explicit unavailable states or local defaults into fabricated Station support"],
  "updatedAt": "2026-09-20T01:30:00Z",
  "durableEvidence": [
    {"verificationClass": "ACCEPTANCE_PROOF", "result": "NOT_RUN", "ref": "docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation/archive/legacy-plan.md#L3047"}
  ]
}
```

## Objective

Prove profile and settings ownership and conflict behavior on the required
simulator clients.

## Current Snapshot

- Source-side profile and settings progress is recorded by W6C.
- Simulator Profile/Notification CAS and device-local separation evidence
  remains unproven until the new Gate passes.
