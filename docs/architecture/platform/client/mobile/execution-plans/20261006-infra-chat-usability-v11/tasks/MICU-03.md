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
    "apps/mobile/src/acceptance",
    "apps/station/app/subserver/actor_identity/infrastructure/persistence",
    "tooling/acceptance/core/provisioner.py",
    "tooling/acceptance/environments/chat-mixed-native.yaml",
    "tooling/acceptance/gates/chat",
    "tooling/acceptance/gates/mobile",
    "tooling/acceptance/gates/station_access",
    "tooling/acceptance/provisioners/mobile_simulator.py",
    "tooling/acceptance/provisioners/native_tauri_embedded_webdriver.py",
    "tooling/acceptance/tests/test_mobile_simulator_provisioner.py",
    "tooling/acceptance/tests/test_provisioner_runtime.py",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/registry.yaml",
    "tooling/acceptance/features",
    "tooling/acceptance/capabilities"
  ],
  "readSet": [
    "docs/architecture/platform/station/access",
    "docs/client/desktop/identity-lifecycle.md",
    "docs/client/mobile/lifecycle.md",
    "docs/knowledge/invariants/actor-identity-boundary.md",
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
      "id": "actor-endpoint-manifest-ordering",
      "command": "cd apps/station && go test ./app/subserver/actor_identity/infrastructure/persistence -run TestBuildLocalEndpointManifestUsesCanonicalDeviceOrdering -count=1",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-native-multi-device-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-native-multi-device-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
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
    "Actor endpoint manifests sort mixed-format device IDs by canonical byte order independently of database collation",
    "The unaffected cross-class Session remains able to read and mutate Station state after each takeover",
    "SAL-G05 aggregates all three exact-source native branches without replacing receiver proof",
    "Every runtime and service attests the exact source commit and cleanup returns resources to baseline"
  ],
  "failureBehavior": [
    "Do not reuse one storage root or device_id to simulate two same-class clients",
    "Do not normalize or replace production device IDs to hide database-collation drift",
    "Do not infer Desktop takeover from Station unit tests",
    "Do not infer Mobile takeover from a single simulator",
    "Do not let the SAL-G05 aggregate substitute for any missing native Gate",
    "Do not reset user data without explicit authorization"
  ],
  "updatedAt": "2026-10-06T06:10:30.000Z"
}
```

## Objective

Prove the Session policy from the receiver perspective on independently
identified Desktop and Mobile client instances, then bind the three native
branches into one current-source SAL-G05 aggregate.

## Current Snapshot

- Entry condition: MICU-01 is closed by v1 source evidence.
- `chat-native-multi-device-e2e` already proves distinct-install Desktop
  takeover; `chat-lifecycle-mixed-client-multi-device-e2e` proves cross-class
  coexistence; `mobile-simulator-station-lifecycle-e2e` proves Mobile takeover.
- SAL-G05 business injection is authored and structurally validated.
- The v9 exact-source owner run exposed the canonical profile-authority and
  closed Mobile lifecycle-scope defects before product proof.
- Version v10 closed the profile, lifecycle-scope, child capability, and
  same-Station topology defects. Its exact-source Gate exposed PostgreSQL
  collation ordering `0...` before `-...` while the canonical manifest
  validator compares device IDs by Go byte order.
- Version v11 adds the Actor Identity persistence owner and its focused
  regression without changing the Journey, closure, or claim boundary.
- Next boundary: sort endpoint-manifest devices canonically after persistence
  readback, then execute all four exact-source Gates in dependency order.
