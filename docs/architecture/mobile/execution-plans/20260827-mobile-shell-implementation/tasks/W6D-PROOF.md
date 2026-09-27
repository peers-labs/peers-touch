# W6D-PROOF - Recovery And Degraded-State Runtime Proof

## Task Slice

```json
{
    "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W6D-PROOF",
  "workstreamId": "W6D",
  "title": "Recovery and degraded-state simulator proof",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "W6D-proof",
  "journeyId": "MS-J07-runtime-proof",
  "runtimeClass": "native-mobile",
  "writeSet": ["tooling/acceptance/gates/mobile", "tooling/acceptance/provisioners"],
  "readSet": ["apps/mobile", "apps/station", "docs/architecture/mobile", "docs/client/mobile", "packages/prototypes/mobile/chat"],
  "budgets": {"focusedCheckSeconds": 120, "functionalRunSeconds": 1800, "cleanupSeconds": 180},
  "checks": [
    {"id": "mobile-recovery-ui-proof-structure", "command": "python3 tooling/scripts/acceptance-validate.py --domain mobile", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "mobile-recovery-ui-runtime", "command": "MOBILE_ACCEPTANCE_RESET=1 python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item mobile-shell-w6d-proof --station-profile station=chat-native-disposable --gate mobile-simulator-recovery-ui-e2e", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "mobile-recovery-ui-contract", "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-contract-static", "verificationClass": "ACCEPTANCE_PROOF"},
    {"id": "mobile-simulator-recovery-ui", "command": "MOBILE_ACCEPTANCE_RESET=1 python3 tooling/scripts/acceptance-run.py --station-profile station=chat-native-disposable --gate mobile-simulator-recovery-ui-e2e", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["Simulator recovery states render through the one recovery host from production-owned triggers", "Focus, action, and cleanup evidence passes"],
  "failureBehavior": ["Unavailable required simulator, same-Station target, or Fixture resources remain BLOCKED", "Do not use Acceptance injection to fabricate production results", "Do not claim deferred cross-Station or Relay-backed behavior"],
  "updatedAt": "2026-09-21T06:30:00Z",
  "durableEvidence": [
    {"verificationClass": "ACCEPTANCE_PROOF", "result": "BLOCKED", "ref": "acceptance://mobile-native-recovery-ui-e2e/20260911T121856462246Z-4ca3c0e41645f54919932f2f0d240a58"}
  ]
}
```

## Objective

Prove visible recovery behavior and action routing on required same-Station
simulator clients.

## Current Snapshot

- The source-side recovery host and stable selectors exist.
- The simulator Gate remains unproven until its production trigger and visible
  evidence pass.
