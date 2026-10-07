# MICU-02 - Mixed Desktop/Mobile Chat Usability

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-infra-chat-usability-20261006",
  "taskId": "MICU-02",
  "workstreamId": "MICU-CHAT",
  "title": "Prove test-account login and same-Station Desktop/Mobile Chat",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "MICU-02-mixed-chat-usability",
  "journeyId": "MICU-J02",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/mobile/src-tauri/src/runtime/oauth",
    "apps/mobile/src-tauri/src/messaging",
    "apps/station/app/subserver/conversation",
    "tooling/acceptance/drivers/native/runtime.py",
    "tooling/acceptance/gates/mobile",
    "tooling/acceptance/gates/chat",
    "tooling/acceptance/provisioners/mobile_simulator.py",
    "tooling/acceptance/tests/test_mobile_simulator_provisioner.py",
    "tooling/acceptance/tests/test_native_runtime_binding.py"
  ],
  "readSet": [
    "apps/desktop/src-tauri/src/application/auth",
    "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
    "apps/desktop/src/acceptance",
    "apps/desktop/src/services",
    "docs/architecture/domains/chat/lifecycle",
    "docs/architecture/platform/client/mobile",
    "docs/knowledge/pitfalls/conversation-production-schema-migration-single-source.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 5400,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "native-runtime-command-contract",
      "command": "python3 -m unittest tooling.acceptance.tests.test_native_runtime_binding",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "mobile-messaging-journey-contract",
      "command": "python3 -m unittest tooling.acceptance.gates.mobile.messaging_journey_test",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "mobile-messaging-rust",
      "command": "cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml messaging::",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "station-conversation-unit",
      "command": "cd apps/station && go test ./app/subserver/conversation/... -count=1",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "mobile-simulator-chat-contacts-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-chat-contacts-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "chat-lifecycle-mixed-client-same-station-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-mixed-client-same-station-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "A Mobile test account enters through the canonical Station Access Gate",
    "The exact-source native Mobile app is installed and visibly running on a booted iOS Simulator",
    "Desktop actor A and Mobile actor B use the same source-attested Station",
    "Desktop and Mobile send and receive Direct and Group messages in both directions",
    "The evidence preserves the Simulator UDID, native bundle identity, logged-in actor, Appium source, and user-visible screenshots",
    "Receipts, typing, attachments, search, and restart readback use canonical Conversation contracts",
    "The shared Native Desktop driver invokes Station commands through the exact Tauri input envelope",
    "No retired friend-chat or group-chat adapter is added"
  ],
  "failureBehavior": [
    "Do not replace native evidence with direct HTTP calls or static checks",
    "Do not claim Mobile usability from a Desktop window or Desktop-only Gate",
    "Do not bypass Station registry commands inside a product Gate",
    "Do not claim cross-Station behavior from the same-Station runtime",
    "Do not weaken Conversation schema or retry semantics to make the Gate pass"
  ],
  "updatedAt": "2026-10-06T09:09:45.000Z"
}
```

## Objective

Close the user-visible Mobile Infra and Chat loop against the same Station and
the same canonical backend contracts already used by Desktop.

## Current Snapshot

- Source baseline: canonical Mobile protobuf and Conversation fixes are rebased
  onto the latest selected source.
- Entry condition: MICU-01 is closed by v1 evidence.
- Named Mobile runtime profiles resolve from the tracked-clean canonical env
  repository at checkpoint `3a1ee6a92`.
- The shared Native Desktop command adapter repair is checkpointed at
  `d8b396dfb`; v15 preserves all registry-mapped regression obligations and
  adds only the Mobile inbox consumer-epoch lifecycle repair admitted by
  MICU-03.
- Version v16 clarifies that the Mobile half of this Journey must run in a
  visible iOS Simulator and retain native screenshot/Appium evidence.
- Version v17 preserves that proof strength while MICU-03 refreshes unrelated
  review-skill metadata required by formal admission.
- Next boundary: rerun exact-source native proof after MICU-03 lands SAL-G05,
  then visibly operate the iOS app for login and bidirectional Chat.
