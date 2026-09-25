# W6B-PROOF - Moments Runtime Proof

## Task Slice

```json
{
    "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W6B-PROOF",
  "workstreamId": "W6B",
  "title": "Moments simulator multi-actor proof",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "W6B-proof",
  "journeyId": "MS-J05-runtime-proof",
  "runtimeClass": "native-mobile",
  "writeSet": ["tooling/acceptance/gates/mobile", "tooling/acceptance/provisioners"],
  "readSet": ["apps/mobile", "apps/station/app/subserver/social", "docs/architecture/mobile", "docs/architecture/social-runtime"],
  "budgets": {"focusedCheckSeconds": 120, "functionalRunSeconds": 2400, "cleanupSeconds": 180},
  "checks": [
    {"id": "mobile-moments-proof-structure", "command": "python3 tooling/scripts/acceptance-validate.py --domain mobile", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "mobile-moments-runtime", "command": "MOBILE_ACCEPTANCE_RESET=1 python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item mobile-shell-w6b-proof --station-profile station=chat-native-disposable --gate mobile-simulator-moments-e2e", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "mobile-moments-contract", "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-contract-static", "verificationClass": "ACCEPTANCE_PROOF"},
    {"id": "mobile-simulator-moments", "command": "MOBILE_ACCEPTANCE_RESET=1 python3 tooling/scripts/acceptance-run.py --station-profile station=chat-native-disposable --gate mobile-simulator-moments-e2e", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["Required simulator feed, publish, reaction, comment, reply, rollback, and draft recovery pass", "Filtered-empty, hidden, deleted, and unavailable policy outcomes remain distinguishable", "Simulator picker selection, cancellation, permission-required, interruption, encrypted upload, and staged-handle cleanup pass on iOS Simulator", "Receiver readback and bounded presentation evidence are source-bound"],
  "failureBehavior": ["Unavailable required simulator, same-Station target, or Fixture resources remain BLOCKED", "Do not infer policy, encryption, picker, or receiver behavior from source checks", "Do not claim deferred cross-Station or Relay-backed behavior"],
  "updatedAt": "2026-09-21T00:00:00Z",
  "durableEvidence": [
    {"verificationClass": "ACCEPTANCE_PROOF", "result": "NOT_RUN", "ref": "docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation/archive/legacy-plan.md#L3046"}
  ]
}
```

## Objective

Prove W6B Moments behavior on the required two-simulator Mobile cell.

## Current Snapshot

- Focused source corrections are recorded by W6B.
- Simulator multi-actor receiver evidence remains unproven until the new Gate
  passes.
