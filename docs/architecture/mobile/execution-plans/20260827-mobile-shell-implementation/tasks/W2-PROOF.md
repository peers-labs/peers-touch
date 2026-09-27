# W2-PROOF - Access Gate And OAuth Runtime Proof

## Task Slice

```json
{
    "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W2-PROOF",
  "workstreamId": "W2",
  "title": "Access Gate and OAuth simulator proof",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "W2-proof",
  "journeyId": "MS-J01-runtime-proof",
  "runtimeClass": "native-mobile",
  "writeSet": ["tooling/acceptance/gates/mobile", "tooling/scripts/local-dev/dev-session.mjs", "tooling/scripts/local-dev/dev-session.test.mjs", "docs/architecture/mobile/native-oauth-proof"],
  "readSet": ["apps/mobile", "apps/station/frame/touch/accessgate", "docs/architecture/access-gates", "docs/architecture/development-workflow", "docs/architecture/mobile", "docs/client/mobile"],
  "budgets": {"focusedCheckSeconds": 120, "functionalRunSeconds": 4200, "cleanupSeconds": 180},
  "checks": [
    {"id": "mobile-access-proof-structure", "command": "python3 tooling/scripts/acceptance-validate.py --domain mobile", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "mobile-access-runtime", "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item mobile-shell-w2-proof --gate mobile-simulator-access-e2e", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "mobile-access-contract", "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-contract-static", "verificationClass": "ACCEPTANCE_PROOF"},
    {"id": "mobile-simulator-access", "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-access-e2e", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["Generic and OAuth access actions complete through schema-bound Station finalization", "Web code cannot observe or attach bearer credentials", "Required iOS Simulator callback, restart, replay, mismatch, and fail-closed behavior passes"],
  "failureBehavior": ["Unavailable required iOS Simulator resources remain BLOCKED", "Android, live provider, and physical-device diagnostics are optional and cannot replace required iOS Simulator evidence"],
  "updatedAt": "2026-09-21T00:00:00Z",
  "durableEvidence": [
    {"verificationClass": "FUNCTIONAL_CHECK", "result": "PASS", "ref": "docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation/archive/legacy-plan.md#L3040"},
    {"verificationClass": "ACCEPTANCE_PROOF", "result": "PASS", "ref": "docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation/archive/legacy-plan.md#L3040"}
  ]
}
```

## Objective

Prove the completed W2 source contract on the required simulator cells.

## Current Snapshot

- Exact-source simulator and Auth visual evidence exists.
- Appium and the local simulator toolchain are available and exercised by the
  current W3 runtime proof.
- MS-D26 makes source-bound iOS Simulator the completion authority. Android,
  live-provider, and physical-device runs remain optional diagnostics.
