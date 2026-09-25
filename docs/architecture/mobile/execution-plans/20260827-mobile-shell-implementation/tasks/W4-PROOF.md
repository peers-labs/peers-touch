# W4-PROOF - Durable Command And Draft Recovery Proof

## Task Slice

```json
{
    "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W4-PROOF",
  "workstreamId": "W4",
  "title": "Simulator durable-command and draft recovery proof",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "W4-proof",
  "journeyId": "MS-J04-runtime-proof",
  "runtimeClass": "native-mobile",
  "writeSet": ["apps/mobile/scripts", "apps/mobile/src-tauri/gen/apple/scripts", "apps/mobile/src-tauri/src/messaging", "apps/mobile/src-tauri/src/runtime/reliability", "tooling/acceptance/gates/mobile", "tooling/acceptance/provisioners"],
  "readSet": ["apps/mobile", "apps/station/app/subserver/social", "docs/architecture/mobile", "docs/architecture/messaging-platform"],
  "budgets": {"focusedCheckSeconds": 120, "functionalRunSeconds": 2400, "cleanupSeconds": 180},
  "checks": [
    {"id": "mobile-recovery-proof-structure", "command": "python3 tooling/scripts/acceptance-validate.py --domain mobile", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "mobile-simulator-recovery-runtime", "command": "MOBILE_ACCEPTANCE_RESET=1 python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item mobile-shell-w4-proof --station-profile station=chat-native-disposable --gate mobile-simulator-recovery-e2e", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "mobile-reliability-contract", "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-contract-static", "verificationClass": "ACCEPTANCE_PROOF"},
    {"id": "mobile-simulator-recovery", "command": "MOBILE_ACCEPTANCE_RESET=1 python3 tooling/scripts/acceptance-run.py --station-profile station=chat-native-disposable --gate mobile-simulator-recovery-e2e", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["Two isolated iOS clients bound to one source-attested Station prove one Friend Request ID/hash through dispatch, result lookup, projection checkpoint, receiver readback, and recovery", "Encrypted draft restart and explicit retain/discard behavior pass on the same-Station simulator cell"],
  "failureBehavior": ["Unavailable required simulator, same-Station target, or Fixture resources remain BLOCKED", "Do not claim secure erase, cross-Station or Relay-backed recovery, or broader durable command ownership"],
  "updatedAt": "2026-09-21T06:30:00Z",
  "durableEvidence": [
    {"verificationClass": "ACCEPTANCE_PROOF", "result": "PASS", "ref": "acceptance://mobile-contract-static/20260911T121322623066Z-8f3aef1d19e67fc6ccbf1fe409d7042f"},
    {"verificationClass": "ACCEPTANCE_PROOF", "result": "BLOCKED", "ref": "acceptance://mobile-native-recovery-e2e/20260911T121858889011Z-e7dc01479775a5b3adee374fcda1b45a"}
  ]
}
```

## Objective

Prove W4 restart, recovery, and exact-scope durability on two isolated Mobile
simulator clients bound to one Station.

## Current Snapshot

- The simulator recovery Gate uses `mobile-direct-simulator`, the real command
  ledger, deterministic response-loss Fixture, Station checkpoint readback,
  receiver projection, and encrypted draft store.
- Cross-Station or Relay-backed recovery is deferred from this Plan and remains
  explicitly unproven.
- Physical interruption remains optional diagnostics under MS-D26.
