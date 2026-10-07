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
    "apps/station/frame/core/facility/session",
    "tooling/scripts/local-dev/dev-session.mjs",
    "tooling/scripts/local-dev/dev-session-store.mjs",
    "tooling/scripts/local-dev/dev-session.test.mjs","tooling/scripts/plan/planctl.mjs","tooling/scripts/plan/planctl.test.mjs",
    "tooling/skills/pt-github-review/FRESHNESS.md",
    "tooling/acceptance/core/provisioner.py",
    "tooling/acceptance/environments/chat-mixed-native.yaml",
    "tooling/acceptance/gates/chat",
    "tooling/acceptance/gates/mobile",
    "tooling/acceptance/gates/station_access",
    "tooling/acceptance/provisioners/mobile_simulator.py",
    "tooling/acceptance/provisioners/native_desktop_macos.py",
    "tooling/acceptance/provisioners/native_tauri_embedded_webdriver.py",
    "tooling/acceptance/tests/test_mobile_simulator_provisioner.py",
    "tooling/acceptance/tests/test_native_desktop_macos.py",
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
      "id": "station-session-client-class-migration",
      "command": "cd apps/station && go test ./frame/core/facility/session -run TestDBStoreAutoMigrateNormalizesAndDeduplicatesClientClasses -count=1",
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
      "id": "development-workflow-control-plane",
      "command": "python3 tooling/scripts/acceptance-run.py --gate development-workflow-control-plane",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "review-skill-freshness",
      "command": "bash tooling/scripts/review/skill-check.sh",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "native-desktop-macos-window-probe",
      "command": "python3 -m unittest tooling.acceptance.tests.test_native_desktop_macos",
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
    "Both Mobile cells are booted iOS Simulators with the exact-source native app installed and launched",
    "Mobile takeover and cross-class coexistence preserve source-bound Simulator UDIDs, Appium source, screenshots, and receiver readback",
    "Legacy desktop-native and desktop-browser rows migrate to desktop and web before canonical validation",
    "Actor endpoint manifests sort mixed-format device IDs by canonical byte order independently of database collation",
    "Mobile records the Station-issued consumer epoch before claimed-item processing so a failed local commit can retry without stale-epoch fencing",
    "An actor-scoped read cursor is accepted by another active device of the same actor and advances monotonically",
    "The unaffected cross-class Session remains able to read and mutate Station state after each takeover",
    "Native Desktop runtime-cell probing places its window on the primary display and waits a bounded interval for process-owned visibility",
    "SAL-G05 aggregates all three exact-source native branches without replacing receiver proof",
    "Development result sealing consumes the runtime manifest reference registered by the durable Gate manifest even when the child result omits that redundant field","Plan advance and Completion Review derive the same bounded completion-candidate digest",
    "GitHub Review freshness records the reviewed Knowledge index change without changing review behavior or fixtures",
    "Every runtime and service attests the exact source commit and cleanup returns resources to baseline"
  ],
  "failureBehavior": [
    "Do not reuse one storage root or device_id to simulate two same-class clients",
    "Do not delete or reset persisted Session rows to bypass legacy client-class migration",
    "Do not normalize or replace production device IDs to hide database-collation drift",
    "Do not reset the Mobile consumer epoch to zero or special-case DEVICE_INBOX_CONSUMER_FENCED retries",
    "Do not reject an actor-scoped read cursor merely because the reader PTID equals the local companion-device actor",
    "Do not infer Desktop takeover from Station unit tests",
    "Do not infer Mobile takeover from a single simulator",
    "Do not weaken native adapter focus, point-ownership, or process-owned window probes to hide launch races",
    "Do not replace visible iOS Simulator proof with Desktop-only, direct HTTP, or static Mobile evidence",
    "Do not let the SAL-G05 aggregate substitute for any missing native Gate",
    "Do not require business Gate results to duplicate the Gate manifest owner of runtime artifact references",
    "Do not reset user data without explicit authorization"
  ],
  "updatedAt": "2026-10-06T18:18:47.000Z"
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
- Version v14 accepted companion-device actor-scoped read cursors.
- The v14 exact-source closure passed four Gates and cleanup, then exposed that
  Development sealing must consume runtime references from Gate manifests.
- Version v15 added the Development Session evidence consumer and its synthetic
  regression, but formal admission stopped before launching product runtimes
  because the mapped workflow-control-plane Gate was absent.
- Version v16 adds that existing Gate and requires visible, source-bound iOS
  Simulator evidence for every Mobile branch of the closure.
- Version v17 admits the review freshness record without changing the Journey
  or iOS evidence strength.
- The v17 run stopped before any Simulator boot because Native Desktop uses
  deploy profiles `four` and `fiveArm`; v18 adds only those profiles and binds
  Mobile Station URLs/deploy environments plus the authorized actor reset.
- Versions v19-v20 passed the four exact-source Gates with visible dual-iOS
  evidence, then exposed envelope-shape and JSON-serialization drift between
  Completion Review and Plan Advance.
- Version v21 canonicalizes the shared digest in both owners and reruns the
  closure on commit `37d3259e9` before advancing to MICU-02.
- Version v32 migrates legacy `desktop-browser` rows that blocked `four` startup.
- Version v33 keeps the four-Gate closure unchanged and repairs the macOS runtime-cell
  visibility race with primary-display placement and a bounded process-window retry.
