# MICU-03-SUITE-CLOSE: Session Class Suite And Delivery

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-infra-chat-suite-closure-20261007",
  "taskId": "MICU-03-SUITE-CLOSE",
  "workstreamId": "MICU-SESSION",
  "title": "Implement and prove one reusable Mobile and Desktop Session-class Suite",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "MICU-03-session-class-suite",
  "journeyId": "SAL-J06",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "docs/architecture/platform/client/mobile/execution-plans/20261007-mobile-infra-chat-suite-closure",
    "reports/mobile-infra-chat-usable",
    "tooling/acceptance/capabilities/station-access.yaml",
    "tooling/acceptance/environments/chat-mixed-native.yaml",
    "tooling/acceptance/features/station-access-session-class.yaml",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/gates/chat",
    "tooling/acceptance/gates/mobile/simulator_harness_contract.py",
    "tooling/acceptance/gates/mobile/simulator_runtime_binding.py",
    "tooling/acceptance/gates/station_access",
    "tooling/acceptance/provisioners/mobile_simulator.py",
    "tooling/acceptance/registry.yaml",
    "tooling/acceptance/tests/test_mobile_simulator_provisioner.py",
    "tooling/scripts/acceptance-pipeline-audit-test.py",
    "tooling/scripts/acceptance-pipeline-audit.py"
  ],
  "readSet": [
    "apps/desktop",
    "apps/mobile",
    "apps/station",
    "docs/architecture/engineering/acceptance",
    "docs/architecture/platform/client/mobile/acceptance-matrix.md",
    "docs/architecture/platform/client/mobile/design.md",
    "docs/architecture/platform/client/mobile/experience-contract.md",
    "docs/architecture/platform/client/mobile/product-definition.md",
    "docs/architecture/platform/station/access",
    "docs/knowledge/invariants/acceptance-suite-runtime-reuse.md",
    "packages/messaging-core",
    "tooling/acceptance/core"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 7200,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "session-class-suite-source",
      "command": "python3 -m unittest tooling.acceptance.gates.chat.lifecycle_mixed_client_test tooling.acceptance.gates.station_access.session_class_suite_e2e_test tooling.acceptance.tests.test_mobile_simulator_provisioner tooling.acceptance.tests.test_suite_runtime && python3 tooling/scripts/acceptance-pipeline-audit-test.py",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "session-class-suite-structure",
      "command": "python3 tooling/scripts/acceptance-pipeline-audit.py --plan docs/architecture/platform/client/mobile/execution-plans/20261007-mobile-infra-chat-suite-closure/plan.md --tasks MICU-03-SUITE-CLOSE",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "session-class-suite-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate station-access-session-class-suite-e2e --station-profile station-primary=chat-native-disposable --station-profile station-secondary=chat-native-four",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "station-access-session-class-suite-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-access-session-class-suite-e2e --station-profile station-primary=chat-native-disposable --station-profile station-secondary=chat-native-four",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "session-class-suite-functional",
    "scenarioIds": [
      "same-station-chat",
      "cross-class-coexistence",
      "desktop-takeover",
      "mobile-takeover"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 5,
    "minWarmReuseRate": 0.75,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": true
  },
  "doneWhen": [
    "one exact-source Suite provisions two Stations, Alice and Bob, three isolated Desktop profiles, two isolated iOS Simulator cells, and one Fixture Epoch",
    "same-Station Chat uses a real Desktop composer send and both Desktop and Mobile receiver readback",
    "Desktop Bob and Mobile Bob remain authenticated together with distinct device and storage identities",
    "a replacement Desktop Bob revokes only the predecessor Desktop while Mobile Bob remains able to receive Station-backed Chat",
    "a replacement Mobile Bob revokes only the predecessor Mobile while replacement Desktop Bob remains able to receive Station-backed Chat",
    "every Scenario records UI action, receiver-visible assertion, supporting observation, and Scenario end after evidence capture",
    "the Suite Runtime report passes replay validation and ends with cleanup-complete",
    "formal Acceptance publishes current-source PROVEN evidence and the final report records exact run identities and explicit non-claims",
    "owned simulators, Appium sessions, Desktop processes, ports, storage, profile leases, deployment leases, and the Development declaration return to baseline"
  ],
  "failureBehavior": [
    "do not provision, build, deploy, register accounts, launch ordinary clients, or log in after the first Scenario starts",
    "only the two declared same-class replacement clients may launch after Scenario execution begins",
    "Harness and API observations remain supporting evidence and cannot replace a UI action or receiver-visible artifact",
    "partial Scenario results must not be published as Suite proof",
    "do not mutate frozen v33 evidence, steal foreign resources, push, open a pull request, or rewrite history"
  ],
  "updatedAt": "2026-10-07T08:40:00.000Z"
}
```

## Current Snapshot

- The current-source same-Station development Journey has already passed with
  exact-source Desktop, iOS Simulator, and dual Station evidence.
- The v33 MICU-03 four-Gate aggregate remains immutable product evidence, but
  it has no `runtimeReuse` contract and cannot prove one shared lifecycle.
- This Task adds the missing business Suite owner and reruns both development
  and formal proof on the resulting exact source.
- Existing Stations and build artifacts are reused; no fiveArm, physical
  Android, or foreign Appium resource is in scope.
