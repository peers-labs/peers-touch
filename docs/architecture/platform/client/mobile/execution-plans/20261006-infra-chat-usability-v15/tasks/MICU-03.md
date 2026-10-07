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
    "apps/mobile/src-tauri/src/messaging",
    "packages/messaging-core/src/inbox",
    "apps/mobile/src/acceptance",
    "apps/station/app/subserver/actor_identity/infrastructure/persistence",
    "tooling/scripts/local-dev/dev-session.mjs",
    "tooling/scripts/local-dev/dev-session.test.mjs",
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
      "id": "mobile-inbox-consumer-epoch-fencing",
      "command": "cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml messaging::engine::tests::consumer_epoch_observer_updates_runtime_epoch",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "companion-device-read-cursor",
      "command": "cargo test --manifest-path packages/messaging-core/Cargo.toml decodes_same_actor_companion_read_cursor",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "development-runtime-manifest-owner",
      "command": "node --test --test-name-pattern='functional result accepts the Gate-owned runtime manifest reference' tooling/scripts/local-dev/dev-session.test.mjs",
      "verificationClass": "STRUCTURAL_CHECK"
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
    "Mobile records the Station-issued consumer epoch before claimed-item processing so a failed local commit can retry without stale-epoch fencing",
    "An actor-scoped read cursor is accepted by another active device of the same actor and advances monotonically",
    "The unaffected cross-class Session remains able to read and mutate Station state after each takeover",
    "SAL-G05 aggregates all three exact-source native branches without replacing receiver proof",
    "Development result sealing consumes the runtime manifest reference registered by the durable Gate manifest even when the child result omits that redundant field",
    "Every runtime and service attests the exact source commit and cleanup returns resources to baseline"
  ],
  "failureBehavior": [
    "Do not reuse one storage root or device_id to simulate two same-class clients",
    "Do not normalize or replace production device IDs to hide database-collation drift",
    "Do not reset the Mobile consumer epoch to zero or special-case DEVICE_INBOX_CONSUMER_FENCED retries",
    "Do not reject an actor-scoped read cursor merely because the reader PTID equals the local companion-device actor",
    "Do not infer Desktop takeover from Station unit tests",
    "Do not infer Mobile takeover from a single simulator",
    "Do not let the SAL-G05 aggregate substitute for any missing native Gate",
    "Do not require business Gate results to duplicate the Gate manifest owner of runtime artifact references",
    "Do not reset user data without explicit authorization"
  ],
  "updatedAt": "2026-10-06T08:36:06.000Z"
}
```

## Objective

Prove the Session policy from the receiver perspective on independently
identified Desktop and Mobile client instances, then bind the three native
branches into one current-source SAL-G05 aggregate.

## Current Snapshot

- MICU-01 is closed; SAL-G05 business injection is structurally valid.
- The four-Gate closure covers Desktop takeover, cross-class coexistence,
  Mobile takeover, and their exact-source aggregate.
- Versions v9-v10 closed profile authority, lifecycle scope, child capability,
  and same-Station topology defects.
- Version v11 made endpoint ordering independent of PostgreSQL collation.
- Version v12 aligned Mobile consumer-epoch fencing with Queue Drain.
- Version v13 admitted the existing Mobile Messaging regression Gates.
- Version v14 accepted companion-device actor-scoped read cursors.
- The v14 exact-source closure produced four current-source PASS results
  with completed cleanup, then failed only while sealing the Development
  result because two runtime Gates correctly relied on the Gate manifest
  to own their runtime manifest references.
- Version v15 adds the Development Session evidence consumer and a
  synthetic regression without changing business injection.
- Next boundary: seal the existing failure shape through the Gate-owned
  runtime manifest contract, then rerun the exact-source closure.
