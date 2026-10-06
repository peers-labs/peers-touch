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
    "apps/mobile/src/pages/ChatPage.tsx",
    "apps/mobile/src/features/chat/chatSelectors.test.ts",
    "apps/mobile/src-tauri/src/runtime/oauth",
    "apps/mobile/src-tauri/src/messaging",
    "apps/station/app/subserver/conversation",
    "tooling/acceptance/core/_gate_bootstrap.py",
    "tooling/acceptance/drivers/native/runtime.py",
    "tooling/acceptance/fixtures/chat_native_actors.py",
    "tooling/acceptance/fixtures/chat_native_reset.py",
    "tooling/acceptance/gates/mobile",
    "tooling/acceptance/gates/chat",
    "tooling/acceptance/provisioners/mobile_simulator.py",
    "tooling/acceptance/tests/test_launch_context.py",
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
      "id": "mobile-chat-federation-fixture-contract",
      "command": "python3 -m unittest tooling.acceptance.gates.chat.chat_native_reset_test tooling.acceptance.tests.test_mobile_simulator_provisioner",
      "verificationClass": "STRUCTURAL_CHECK"
    },
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
      "id": "mobile-chat-render-contract",
      "command": "pnpm --filter @peers-touch/app-mobile exec vitest run src/features/chat/chatSelectors.test.ts",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "mobile-chat-visual-gate-contract",
      "command": "python3 -m unittest tooling.acceptance.gates.mobile.simulator_social_e2e_test",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "isolated-gate-package-path-contract",
      "command": "python3 -m unittest tooling.acceptance.tests.test_launch_context.LaunchContextProcessTests.test_bootstrap_prefers_macos_framework_user_scheme_without_preferred_scheme tooling.acceptance.tests.test_launch_context.LaunchContextProcessTests.test_bootstrap_rejects_user_site_outside_default_user_base tooling.acceptance.tests.test_launch_context.LaunchContextProcessTests.test_bootstrap_ignores_absent_system_root_without_package_paths tooling.acceptance.tests.test_launch_context.LaunchContextProcessTests.test_bootstrap_loads_system_site_inside_interpreter_data_root tooling.acceptance.tests.test_launch_context.LaunchContextProcessTests.test_bootstrap_rejects_system_site_outside_interpreter_data_root",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "station-receipt-transaction-contention-contract",
      "command": "cd apps/station/app && go test ./subserver/conversation/infrastructure/delivery -run 'TestReceiptRecorder(TransactionRetriesPostgresContention|LocksEventBeforeEndpointCommitment)' -count=1",
      "verificationClass": "FUNCTIONAL_CHECK"
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
    "The same-Station Mobile Fixture persists its derived Federation and active Station membership without pre-creating a friendship",
    "The exact-source native Mobile app is installed and visibly running on a booted iOS Simulator",
    "After friendship convergence, the Fixture waits for recovery.snapshot.writeAdmission.open before creating the Direct conversation",
    "Desktop actor A and Mobile actor B use the same source-attested Station",
    "Desktop and Mobile send and receive Direct and Group messages in both directions",
    "Both iOS clients render the interactive Chat surface and never expose data-testid=chat-render-error",
    "The Gate fails when Appium page source contains the Chat render-error boundary even if backend messaging assertions pass",
    "The evidence preserves the Simulator UDID, native bundle identity, logged-in actor, Appium source, and user-visible screenshots",
    "Receipts, typing, attachments, search, and restart readback use canonical Conversation contracts",
    "The shared Native Desktop driver invokes Station commands through the exact Tauri input envelope",
    "No retired friend-chat or group-chat adapter is added"
  ],
  "failureBehavior": [
    "Do not replace native evidence with direct HTTP calls or static checks",
    "Do not claim Mobile usability from a Desktop window or Desktop-only Gate",
    "Do not convert backend or harness success into PASS while either iOS client renders the Chat error boundary",
    "Do not bypass Station registry commands inside a product Gate",
    "Do not claim cross-Station behavior from the same-Station runtime",
    "Do not weaken Conversation schema or retry semantics to make the Gate pass"
  ],
  "updatedAt": "2026-10-06T15:32:00.000Z"
}
```

## Objective

Close the user-visible Mobile Infra and Chat loop against the same Station and
the same canonical backend contracts already used by Desktop.

## Current Snapshot

- Entry condition: MICU-01 is closed by v1 evidence.
- Named Mobile runtime profiles resolve from the tracked-clean canonical env
  repository at checkpoint `3a1ee6a92`.
- The shared Native Desktop command adapter repair is checkpointed at
  `d8b396dfb`; v15 preserves all registry-mapped regression obligations and
  adds only the Mobile inbox consumer-epoch lifecycle repair admitted by
  MICU-03.
- Version v23 preserves the concrete Mobile Chat Fixture repair required by
  the real iOS failure: the derived Federation context must exist before
  federated-handle resolution, while the Journey still creates and accepts the
  friendship through production actions. It also declares the six
  registry-required Chat regression Gates without weakening the visible iOS
  Simulator and Appium proof.
- Version v26 preserves that proof strength and adds the missing effective
  recovery-admission wait from v24 and repairs the isolated Gate launcher for
  Xcode Python installations whose absent data root has no usable system
  package paths. Existing paths remain root-contained and fail-closed.
- Version v28 reopens the visible Mobile Chat proof after both final iOS
  captures exposed `chat-render-error`. It adds the product render surface and
  the visual Gate assertion to the owning write set; harness-only messaging
  success can no longer satisfy the Journey.
- Next boundary: rerun exact-source native proof and visibly operate both iOS
  apps for login and bidirectional Chat.

## Interaction Contract

```yaml
surface: mobile.chat.page
scenario: exact-source-chat-renders-after-login

given:
  - the exact-source native app is installed on each declared iOS Simulator
  - the Mobile actor completed the canonical Station Access Gate
  - the Chat Fixture completed friendship and Conversation admission

when:
  - the driver opens the Chat tab
  - the driver captures Appium page source and a visible screenshot

then:
  - the interactive Chat surface is visible
  - Direct and Group journeys remain operable from the rendered surface
  - screenshot and page source belong to the same source-bound client

visual_invariants:
  - Chat content occupies the Mobile page below the shell navigation
  - the user-visible state is a Chat list, conversation, or defined empty state

forbidden:
  - data-testid=chat-render-error
  - Chat could not be displayed.
  - a PASS derived only from backend or harness assertions

evidence:
  - Appium interaction trace
  - page-source assertions
  - source-bound before/after screenshots
```

Prototype sync classification: `Implementation bug`. The confirmed Mobile
prototype and product contract already require a usable Chat surface, so they
must not be changed to match the failing implementation.
