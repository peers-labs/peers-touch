# W5-PROOF - Social Projection Convergence Proof

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W5-PROOF",
  "workstreamId": "W5",
  "title": "Conversation member and Social authority convergence proof",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "W5-proof",
  "journeyId": "MS-J02..MS-J06-runtime-proof",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "tooling/acceptance/gates/mobile",
    "tooling/acceptance/provisioners"
  ],
  "readSet": [
    "apps/mobile",
    "apps/station/app/subserver/conversation",
    "apps/station/app/subserver/social",
    "docs/architecture/engineering/api-governance",
    "docs/architecture/domains/social/runtime",
    "docs/architecture/platform/client/mobile"
  ],
  "budgets": {
    "focusedCheckSeconds": 120,
    "functionalRunSeconds": 4800,
    "cleanupSeconds": 240
  },
  "checks": [
    {
      "id": "mobile-social-proof-structure",
      "command": "python3 tooling/scripts/acceptance-validate.py --domain mobile",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "mobile-social-runtime",
      "command": "MOBILE_ACCEPTANCE_RESET=1 python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item mobile-shell-w5-proof --station-profile station=chat-native-disposable --gate mobile-simulator-social-convergence-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "mobile-social-contract",
      "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-contract-static",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "mobile-simulator-social-convergence",
      "command": "MOBILE_ACCEPTANCE_RESET=1 python3 tooling/scripts/acceptance-run.py --station-profile station=chat-native-disposable --gate mobile-simulator-social-convergence-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Conversation member update, muted-until, and atomic owner transfer converge with authoritative snapshot readback",
    "Same-Station block, unblock, list, status, and policy enforcement converge",
    "Required two-actor/same-Station simulator convergence is source-bound and cleaned up"
  ],
  "failureBehavior": [
    "Missing Fixture, Station, Appium, or simulator resources remain BLOCKED",
    "Do not replace receiver proof with source or sender-only evidence",
    "Do not expose remote block direction or claim deferred cross-Station behavior"
  ],
  "updatedAt": "2026-09-21T06:30:00.000Z"
}
```

## Objective

Prove the Conversation member consumer cutover and Social relationship
authority on the required simulator environment.

## Current Snapshot

- Existing projection source progress is retained by W5.
- `W5-OWNER` and `W5-SOCIAL` must close before runtime proof begins.
- Runtime resources and exact-source same-Station receiver evidence remain
  unproven. Cross-Station/Relay evidence is deferred from this Plan.
