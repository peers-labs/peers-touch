# MICU-03 - Native Session Class Matrix

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-infra-chat-usability-20261006",
  "taskId": "MICU-03",
  "workstreamId": "MICU-SESSION",
  "title": "Prove cross-class coexistence and same-class takeover",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "MICU-03-session-class-matrix",
  "journeyId": "SAL-J06",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "tooling/acceptance/environments/chat-mixed-native.yaml",
    "tooling/acceptance/gates/chat",
    "tooling/acceptance/gates/mobile",
    "tooling/acceptance/gates/station_access",
    "tooling/acceptance/provisioners/mobile_simulator.py",
    "tooling/acceptance/tests/test_mobile_simulator_provisioner.py",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/registry.yaml",
    "tooling/acceptance/features",
    "tooling/acceptance/capabilities"
  ],
  "readSet": [
    "docs/architecture/platform/station/access",
    "docs/client/desktop/identity-lifecycle.md",
    "docs/client/mobile/lifecycle.md",
    "docs/knowledge/invariants/mobile-session-device-identity.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 7200,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "mixed-client-session-matrix-contract",
      "command": "python3 -m unittest tooling.acceptance.gates.chat.lifecycle_mixed_client_test tooling.acceptance.gates.mobile.simulator_station_lifecycle_e2e_test",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "station-session-class-gate-tests",
      "command": "python3 -m unittest tooling.acceptance.gates.station_access.session_class_e2e_test",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-lifecycle-mixed-client-multi-device-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-mixed-client-multi-device-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "mobile-simulator-station-lifecycle-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-station-lifecycle-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "station-access-session-class-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-access-session-class-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "One Desktop and one Mobile Session for the same actor remain valid together",
    "Two Desktop instances use distinct local storage identities and the newer Session kicks the older Desktop only",
    "Two Mobile simulators use distinct device and storage identities and the newer Session kicks the older Mobile only",
    "The unaffected cross-class Session remains able to read and mutate Station state after each takeover",
    "Every runtime and service attests the exact source commit and cleanup returns resources to baseline"
  ],
  "failureBehavior": [
    "Do not reuse one storage root or device_id to simulate two same-class clients",
    "Do not infer Desktop takeover from Station unit tests",
    "Do not infer Mobile takeover from a single simulator",
    "Do not reset user data without explicit authorization"
  ],
  "updatedAt": "2026-10-06T01:54:03.000Z"
}
```

## Objective

Prove the Session policy from the receiver perspective on four independently
identified native client instances.

## Current Snapshot

- Entry condition: MICU-01 is closed by v1 evidence.
- Existing proof covers Desktop+Mobile coexistence and Mobile takeover, but
  does not yet prove distinct-install dual-Desktop takeover in one matrix.
- Next boundary: add the missing native matrix without weakening existing Gates.
