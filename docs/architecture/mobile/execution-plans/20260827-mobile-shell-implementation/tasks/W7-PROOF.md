# W7-PROOF - Simulator Lifecycle And Platform Proof

## Task Slice

```json
{
    "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W7-PROOF",
  "workstreamId": "W7",
  "title": "Simulator lifecycle and platform proof",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "W7-proof",
  "journeyId": "MS-J02..MS-J07-platform-proof",
  "runtimeClass": "native-mobile",
  "writeSet": ["tooling/acceptance/gates/mobile", "tooling/acceptance/provisioners"],
  "readSet": ["apps/mobile", "docs/architecture/mobile", "docs/client/mobile"],
  "budgets": {"focusedCheckSeconds": 120, "functionalRunSeconds": 2400, "cleanupSeconds": 180},
  "checks": [
    {"id": "mobile-platform-proof-structure", "command": "python3 tooling/scripts/acceptance-validate.py --domain mobile", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "mobile-platform-runtime", "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item mobile-shell-w7-proof --gate mobile-simulator-platform-e2e", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "mobile-platform-contract", "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-contract-static", "verificationClass": "ACCEPTANCE_PROOF"},
    {"id": "mobile-simulator-platform", "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-platform-e2e", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["Required iOS Simulator permission, network, lifecycle, accessibility, and cleanup evidence passes", "The runtime Gate invokes only production platform ports and records source-bound native/WebView evidence", "W7 source evidence for push, scheduled-work, and picker terminal-state contracts remains valid at the same source identity"],
  "failureBehavior": ["Unavailable required iOS Simulator resources remain BLOCKED", "Do not relabel source-only callback tests as OS delivery evidence", "Optional Android, physical provider, scheduler, picker, and hardware behavior cannot block this Task"],
  "updatedAt": "2026-09-21T00:00:00Z",
  "durableEvidence": [
    {"verificationClass": "ACCEPTANCE_PROOF", "result": "NOT_RUN", "ref": "docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation/archive/legacy-plan.md#L3049"}
  ]
}
```

## Objective

Prove W7 platform behavior on the required iOS Simulator cells.

## Current Snapshot

- Dependency-ready native source work is recorded by W7.
- Push registration, scheduled completion, and picker terminal-state matrices
  remain owned and proven by W7's native source checks; this Task proves their
  installed simulator platform boundary without claiming live OS/provider
  delivery.
- Android and physical platform evidence remain optional diagnostics under
  MS-D26.
