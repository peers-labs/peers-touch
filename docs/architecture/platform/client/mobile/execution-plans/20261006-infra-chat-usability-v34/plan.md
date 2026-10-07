# Mobile Infra/Chat Usability Continuation - Plan Package

> **Plan ID**: mobile-infra-chat-usability-20261006
> **Version ID**: mobile-infra-chat-usability-20261006-v34
> **Created**: 2026-10-06T20:00:50.000Z
> **Supersedes**: `20261006-infra-chat-usability-v33`

## Plan Version

```json
{"kind":"peers-touch-plan-version","planId":"mobile-infra-chat-usability-20261006","versionId":"mobile-infra-chat-usability-20261006-v34","createdAt":"2026-10-06T20:00:50.000Z","workClass":"product-behavior","architecture":{"sources":["docs/architecture/platform/client/mobile/product-definition.md","docs/architecture/platform/client/mobile/experience-contract.md","docs/architecture/platform/client/mobile/acceptance-matrix.md","docs/architecture/platform/client/mobile/design.md","docs/architecture/platform/client/mobile/decisions.md","docs/architecture/platform/station/access/product-definition.md","docs/architecture/platform/station/access/experience-contract.md","docs/architecture/platform/station/access/acceptance-matrix.md","docs/architecture/platform/station/access/design.md","docs/architecture/platform/station/access/decisions.md","docs/architecture/domains/chat/lifecycle","docs/client/desktop/identity-lifecycle.md","docs/client/mobile/lifecycle.md"],"decisions":["MS-D06","MS-D07","MS-D09","MS-D10","MS-D17","MS-D26","MS-D27","SAL-D01","SAL-D02","SAL-D03","SAL-D06","SAL-D07"]},"scope":{"sourceClaims":[{"pathPrefix":"apps/station/app/subserver/actor_identity/infrastructure/persistence","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/core/facility/session","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/conversation","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/application/auth","mode":"shared-read"},{"pathPrefix":"apps/desktop/src-tauri/src/interface/http_gateway/mod.rs","mode":"shared-read"},{"pathPrefix":"apps/desktop/src/acceptance","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/services","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/components/chat/ChatDetailPanel.tsx","mode":"shared-read"},{"pathPrefix":"apps/mobile/src/pages/ChatPage.tsx","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src/features/chat/chatSelectors.test.ts","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src/features/group/groupStore.ts","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src/features/group/groupStore.test.ts","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src-tauri/src/runtime/oauth","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src-tauri/src/messaging","mode":"exclusive-write"},{"pathPrefix":"packages/messaging-core/src/inbox","mode":"exclusive-write"},{"pathPrefix":"packages/messaging-core/src/recovery","mode":"shared-read"},{"pathPrefix":"apps/mobile/src/acceptance","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/local-dev/dev-session.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/local-dev/dev-session-store.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/local-dev/dev-session.test.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/plan/planctl.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/plan/planctl.test.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/skills/pt-github-review/FRESHNESS.md","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/core/_gate_bootstrap.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/core/provisioner.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/drivers/native/runtime.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/environments/chat-mixed-native.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/fixtures/chat_native_actors.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/fixtures/chat_native_reset.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates/chat","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates/mobile","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates/station_access","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/provisioners/mobile_simulator.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/provisioners/native_desktop_macos.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/provisioners/native_tauri_embedded_webdriver.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/tests/test_launch_context.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/tests/test_mobile_simulator_provisioner.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/tests/test_native_desktop_macos.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/tests/test_native_runtime_binding.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/tests/test_provisioner_runtime.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/registry.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/reports","mode":"shared-read"},{"pathPrefix":"tooling/acceptance/features","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/capabilities","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/domains/chat/lifecycle","mode":"shared-read"},{"pathPrefix":"docs/architecture/platform/station/access","mode":"shared-read"},{"pathPrefix":"docs/architecture/platform/client/mobile","mode":"shared-read"},{"pathPrefix":"docs/client/desktop/identity-lifecycle.md","mode":"shared-read"},{"pathPrefix":"docs/client/mobile/lifecycle.md","mode":"shared-read"},{"pathPrefix":"docs/knowledge","mode":"exclusive-write"},{"pathPrefix":"reports/mobile-infra-chat-usable","mode":"exclusive-write"}],"nonGoals":["Reopen or weaken the completed MICU-01 Session class authority","Claim Agent or Moments readiness","Claim cross-Station or Relay-backed Mobile Chat","Claim Android, physical-device, or live third-party OAuth behavior","Change Conversation authority or introduce compatibility routes","Allow more than one active Session for one actor and canonical client class","Use device_id, window labels, runtime labels, or OS models as Session concurrency classes","Push a branch or create a pull request"]},"tasks":[{"id":"MICU-04","workstreamId":"MICU-RELEASE","path":"tasks/MICU-04.md","dependsOn":[]}],"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["three","station-three","four","fiveArm","chat-native-disposable","chat-native-disposable-station","chat-native-four","mobile-direct-simulator","chat-mixed-native","mobile-station-lifecycle-simulator","station-access-native","native-tauri-current-profile"],"destructiveResetScopes":["mobile-social-simulator-actors","chat-mixed-native-actors"]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{"closures":{"MICU-04-usability-report":[]},"completion":["development-workflow-control-plane","architecture-module-governance","mobile-contract-static","station-messaging-unit","messaging-platform-contract","chat-lifecycle-rich-voice-e2e","chat-storage-accounting-e2e","chat-storage-contract","chat-storage-redaction-recovery-e2e","mobile-hard-cut-static","mobile-simulator-chat-contacts-e2e","chat-lifecycle-mixed-client-same-station-e2e","chat-native-multi-device-e2e","chat-lifecycle-mixed-client-multi-device-e2e","mobile-simulator-station-lifecycle-e2e","station-access-session-class-e2e","proto-build","station-api-ownership","station-access-capability-contract","station-access-desktop-oauth-native-e2e","station-access-auth-e2e","station-access-scope-isolation-e2e","station-access-federation-boundary-e2e","desktop-release-build","mobile-native-build","station-access-lifecycle-aggregate-e2e","station-access-domain-validation","acceptance-infra-validation","acceptance-plan-self","acceptance-runtime-provisioning-self","acceptance-workflow-contract","chat-lifecycle-call-resolution-e2e","chat-lifecycle-mixed-client-cross-station-e2e","chat-lifecycle-mixed-client-group-mls-e2e","mobile-ios-simulator-layout-accessibility-e2e","mobile-simulator-access-e2e","mobile-simulator-runtime-lifecycle-e2e","chat-lifecycle-direct-e2e","chat-native-current-profile-two-client-e2e","chat-native-submitted-command-recovery-e2e","chat-native-two-client-e2e","chat-native-visible-static","desktop-check","chat-lifecycle-tree-zero-reference-e2e","chat-storage-cache-clear-e2e","chat-storage-retention-e2e","chat-storage-delete-reclaim-e2e","chat-storage-dead-contract-zero-e2e","chat-storage-desktop-batch-clear-e2e","chat-storage-mobile-batch-clear-e2e","chat-storage-zero-legacy-e2e","mobile-simulator-social-convergence-e2e","mobile-simulator-recovery-e2e","mobile-simulator-recovery-ui-e2e","mobile-simulator-moments-e2e","chat-lifecycle-interactions-group-e2e","chat-lifecycle-onboarding-e2e","chat-native-group-mls-e2e","chat-native-interactions-e2e","chat-native-recovery-e2e","chat-native-typing-e2e"],"full":["development-workflow-control-plane","architecture-module-governance","mobile-contract-static","station-messaging-unit","messaging-platform-contract","chat-lifecycle-rich-voice-e2e","chat-storage-accounting-e2e","chat-storage-contract","chat-storage-redaction-recovery-e2e","mobile-hard-cut-static","mobile-simulator-chat-contacts-e2e","chat-lifecycle-mixed-client-same-station-e2e","chat-native-multi-device-e2e","chat-lifecycle-mixed-client-multi-device-e2e","mobile-simulator-station-lifecycle-e2e","station-access-session-class-e2e","proto-build","station-api-ownership","station-access-capability-contract","station-access-desktop-oauth-native-e2e","station-access-auth-e2e","station-access-scope-isolation-e2e","station-access-federation-boundary-e2e","desktop-release-build","mobile-native-build","station-access-lifecycle-aggregate-e2e","station-access-domain-validation","acceptance-infra-validation","acceptance-plan-self","acceptance-runtime-provisioning-self","acceptance-workflow-contract","chat-lifecycle-call-resolution-e2e","chat-lifecycle-mixed-client-cross-station-e2e","chat-lifecycle-mixed-client-group-mls-e2e","mobile-ios-simulator-layout-accessibility-e2e","mobile-simulator-access-e2e","mobile-simulator-runtime-lifecycle-e2e","chat-lifecycle-direct-e2e","chat-native-current-profile-two-client-e2e","chat-native-submitted-command-recovery-e2e","chat-native-two-client-e2e","chat-native-visible-static","desktop-check","chat-lifecycle-tree-zero-reference-e2e","chat-storage-cache-clear-e2e","chat-storage-retention-e2e","chat-storage-delete-reclaim-e2e","chat-storage-dead-contract-zero-e2e","chat-storage-desktop-batch-clear-e2e","chat-storage-mobile-batch-clear-e2e","chat-storage-zero-legacy-e2e","mobile-simulator-social-convergence-e2e","mobile-simulator-recovery-e2e","mobile-simulator-recovery-ui-e2e","mobile-simulator-moments-e2e","chat-lifecycle-interactions-group-e2e","chat-lifecycle-onboarding-e2e","chat-native-group-mls-e2e","chat-native-interactions-e2e","chat-native-recovery-e2e","chat-native-typing-e2e"]}
```

## Continuation Boundary

Version v34 is the residual close Plan after v33 formally proved and closed
MICU-02 and MICU-03. Their immutable 2/2 and 4/4 PROVEN aggregates remain
inputs to MICU-04; this successor does not relabel or rerun them. The v33
MICU-04 focused check exposed two stale assertions in the existing Chat
business Gate: recovery projection ownership moved to `messaging-core`, and
Desktop group membership submission moved to `messagingCommands`. Version v34
adds only that Gate contract file to the remaining source Task. Product,
architecture, runtime, proof strength, authorization, and non-claims remain
unchanged.

Earlier amendment history remains frozen in v33 and its predecessors.

## Goal

Make the stable Desktop Infra and Chat outcomes usable on Mobile against the
same source-attested Station, while preserving the completed canonical Session
class authority.

## Product Scope

- Test-account login through the canonical Station identity and Access Gate path.
- Desktop actor A and Mobile actor B exchange Direct and Group messages both ways.
- One actor may remain logged in on one Desktop and one Mobile simultaneously.
- A second Desktop replaces the first Desktop Session without revoking Mobile.
- A second Mobile replaces the first Mobile Session without revoking Desktop.
- Restart readback and Conversation authority remain Station-backed.

Agent and Moments are excluded because their product work is still in progress.
Registry-mapped Desktop, cross-Station, Call, layout, and infrastructure Gates
are regression obligations only and do not expand this product claim.

## Architecture Traceability

| Outcome | Product source | Architecture source | Proof |
|---|---|---|---|
| Mobile test-account login | MS-J01, MS-PA02 | MS-D06, MS-D10, SAL-D03 | Mobile Station lifecycle |
| Desktop/Mobile Chat | MS-J03, MS-PA06, MS-PA09 | MS-D07, MS-D17, MS-D27 | Same-Station mixed client |
| Cross-class coexistence | SAL-J06, SAL-C07 | SAL-D07 | Mixed multi-device |
| Desktop class takeover | SAL-J06, SAL-C07 | SAL-D07 | Native Desktop multi-device |
| Mobile class takeover | SAL-J06, SAL-C07 | SAL-D07 | Mobile Station lifecycle |
| Session-class proof aggregation | SAL-G05 | D-20 | Station Access aggregate |

## Execution DAG

```text
MICU-04
```

## Preserved Cutovers

- `SessionRecord.device_type` remains the single persisted canonical
  client-class slot (`desktop | mobile | web`).
- Password Access Gate, OAuth acknowledgement, and session takeover revoke only
  the same actor and same canonical class.
- Desktop submits `desktop`; Mobile submits `mobile`.
- `device_id` remains the exact installation and Messaging identity.
- Mobile Conversation stays on canonical `/conversation/*` contracts; no
  `/friend-chat/*` or `/group-chat/*` adapter is added.
- Native Acceptance invokes Desktop commands through their exact Tauri
  argument envelope; Gates do not bypass Station registry commands.
- Plan advance and Completion Review hash the same bounded candidate envelope;
  neither may hash mutable Run fields outside that contract.

## Completion

- Exact-source Station deployment, Desktop binary, and Mobile simulator share
  one commit identity.
- At least one visible iOS Simulator is booted with the exact-source Mobile app
  installed and launched; two isolated Simulator cells are used whenever the
  Journey requires independent Mobile Sessions.
- Source-bound runtime evidence records Simulator UDIDs, Mobile bundle identity,
  test-account login, visible screenshots/Appium source, and cleanup.
- Required mixed-client Chat and Session-class Journeys pass with receiver-side
  readback.
- Desktop-only Gates, direct Station HTTP calls, and static Mobile checks cannot
  satisfy a Mobile Journey.
- The final report lists passed, failed, blocked, deferred, and unproven scope
  without claiming Agent, Moments, cross-Station, Android, physical OAuth, or
  physical-device readiness.
- Owned runtimes and declarations are closed; no push or PR is created.
