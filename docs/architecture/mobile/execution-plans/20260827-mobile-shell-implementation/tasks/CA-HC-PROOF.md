# CA-HC-PROOF - Same-Station Conversation Authority Runtime Proof

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "CA-HC-PROOF",
  "workstreamId": "CA-HC",
  "title": "Same-Station Conversation Authority runtime and completion proof",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "CA-HC-proof",
  "journeyId": "CA-W6..CA-W7",
  "runtimeClass": "service",
  "writeSet": [
    "docs/architecture/api-ownership",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/mobile",
    "apps/station",
    "packages/messaging-core",
    "docs/architecture/messaging-platform",
    "docs/architecture/mobile"
  ],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 7200,
    "cleanupSeconds": 240
  },
  "checks": [
    {
      "id": "conversation-authority-proof-structure",
      "command": "python3 tooling/scripts/acceptance-validate.py --domain mobile",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "conversation-authority-runtime",
      "command": "MOBILE_ACCEPTANCE_RESET=1 python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item mobile-shell-ca-hc-proof --station-profile station=chat-native-disposable --gate mobile-simulator-social-convergence-e2e --gate mobile-simulator-chat-contacts-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "conversation-authority-simulator-proof",
      "command": "MOBILE_ACCEPTANCE_RESET=1 python3 tooling/scripts/acceptance-run.py --station-profile station=chat-native-disposable --gate mobile-simulator-social-convergence-e2e --gate mobile-simulator-chat-contacts-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "CA-W6 exact-source same-Station receiver and contention evidence passes",
    "CA-W7 completion, documentation, knowledge, and zero-reference audit passes"
  ],
  "failureBehavior": [
    "Missing same-Station owner deployment or runtime resources remain BLOCKED",
    "Do not infer cross-Station or Relay-backed Conversation completion from same-Station evidence"
  ],
  "updatedAt": "2026-09-21T06:30:00.000Z"
}
```

## Objective

Prove the integrated Conversation authority on the current same-Station Mobile
scope before any Mobile receiver closure consumes it.

## Current Snapshot

- CA-W0 through CA-W5 source integration is preserved in CA-HC.
- CA-W6 same-Station runtime Acceptance and CA-W7 completion remain unproven.
- The obsolete unconditional W5 stop was removed from the simulator
  provisioner and Gate; formal Plan Package dependencies now own readiness.
- Native scenario diagnostics now identify `W5-OWNER`, not already-complete
  `W5`, as the remaining product-contract root.
- The current proof binds Alice and Bob to one source-attested disposable
  Station through `mobile-direct-simulator`.
- Cross-Station and Relay-backed Conversation evidence is deferred from this
  Plan and remains unproven.
- Exact-source deployment still requires a reviewed checkpoint. The local
  worktree remains a mixed multi-workstream tree and this run is explicitly
  no-commit, so no bulk checkpoint was created.
- The Android SDK and emulator are discoverable and pass the W3 simulator
  lifecycle Gate. Physical clients are optional diagnostics under MS-D26.

## Concurrency Decision

- Execution is serial. The Mobile social simulator provisioner and Gate share
  one obsolete W5 dependency guard, so implementation and focused regression
  checks must land as one coupled change before runtime provisioning.
- The integrator owns `tooling/acceptance`, this Task snapshot, runtime
  provisioning, evidence reconciliation, and manifest transitions.
- Simulator Social and Chat/Contacts runs may proceed only after the direct
  environment cutover and exact-source runtime preflight.

## Runtime Attempt 2026-09-16

- Historical `mobile-simulator-social-convergence-e2e` and
  `mobile-simulator-chat-contacts-e2e` runs reached the former cross-Station
  provisioning path and returned `BLOCKED/UNPROVEN`; cleanup passed for both.
- First run `20260916T152924551579Z-23245f80859bd561986b7def97ef5079`
  exposed the missing strict known-hosts configuration for `relay-1`.
- After repairing that local configuration, run
  `20260916T153424618578Z-609bee9d0cce60ac1ac6ef45804e2c31`
  exposed the live Relay/deployment checkout commit mismatch at
  `service-attestation:relay`.
- The historical simulator Gates did not reach `FIXTURE_READY` or execute
  product journeys. MS-D27 replaces that obsolete topology for the current
  Plan without claiming the deferred cross-Station scope.

## Verification Snapshot

- Mobile simulator Gate/provisioner and native preflight regressions: 173 tests
  PASS.
- Mobile Acceptance Domain structural validation: PASS for all six
  capabilities.
- Simulator product Gates: historical cross-Station run BLOCKED during source
  attestation. CA-W6/CA-W7 remain UNPROVEN until the same-Station simulator run
  passes.
