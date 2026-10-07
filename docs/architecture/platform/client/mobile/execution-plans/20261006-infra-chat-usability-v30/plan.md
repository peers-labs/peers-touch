# Mobile Infra/Chat Usability Continuation - Plan Package

> **Plan ID**: mobile-infra-chat-usability-20261006
> **Version ID**: mobile-infra-chat-usability-20261006-v30
> **Created**: 2026-10-06T16:01:00.000Z
> **Supersedes**: `20261006-infra-chat-usability-v29`

## Plan Version

```json
{"kind":"peers-touch-plan-version","planId":"mobile-infra-chat-usability-20261006","versionId":"mobile-infra-chat-usability-20261006-v30","createdAt":"2026-10-06T16:01:00.000Z","workClass":"product-behavior","architecture":{"sources":["docs/architecture/platform/client/mobile/product-definition.md","docs/architecture/platform/client/mobile/experience-contract.md","docs/architecture/platform/client/mobile/acceptance-matrix.md","docs/architecture/platform/client/mobile/design.md","docs/architecture/platform/client/mobile/decisions.md","docs/architecture/platform/station/access/product-definition.md","docs/architecture/platform/station/access/experience-contract.md","docs/architecture/platform/station/access/acceptance-matrix.md","docs/architecture/platform/station/access/design.md","docs/architecture/platform/station/access/decisions.md","docs/architecture/domains/chat/lifecycle","docs/client/desktop/identity-lifecycle.md","docs/client/mobile/lifecycle.md"],"decisions":["MS-D06","MS-D07","MS-D09","MS-D10","MS-D17","MS-D26","MS-D27","SAL-D01","SAL-D02","SAL-D03","SAL-D06","SAL-D07"]},"scope":{"sourceClaims":[{"pathPrefix":"apps/station/app/subserver/actor_identity/infrastructure/persistence","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/conversation","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/application/auth","mode":"shared-read"},{"pathPrefix":"apps/desktop/src-tauri/src/interface/http_gateway/mod.rs","mode":"shared-read"},{"pathPrefix":"apps/desktop/src/acceptance","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/services","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src/pages/ChatPage.tsx","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src/features/chat/chatSelectors.test.ts","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src/features/group/groupStore.ts","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src/features/group/groupStore.test.ts","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src-tauri/src/runtime/oauth","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src-tauri/src/messaging","mode":"exclusive-write"},{"pathPrefix":"packages/messaging-core/src/inbox","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src/acceptance","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/local-dev/dev-session.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/local-dev/dev-session.test.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/plan/planctl.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/plan/planctl.test.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/skills/pt-github-review/FRESHNESS.md","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/core/_gate_bootstrap.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/core/provisioner.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/drivers/native/runtime.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/environments/chat-mixed-native.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/fixtures/chat_native_actors.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/fixtures/chat_native_reset.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates/chat","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates/mobile","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates/station_access","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/provisioners/mobile_simulator.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/provisioners/native_tauri_embedded_webdriver.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/tests/test_launch_context.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/tests/test_mobile_simulator_provisioner.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/tests/test_native_runtime_binding.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/tests/test_provisioner_runtime.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/registry.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/reports","mode":"shared-read"},{"pathPrefix":"tooling/acceptance/features","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/capabilities","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/domains/chat/lifecycle","mode":"shared-read"},{"pathPrefix":"docs/architecture/platform/station/access","mode":"shared-read"},{"pathPrefix":"docs/architecture/platform/client/mobile","mode":"shared-read"},{"pathPrefix":"docs/client/desktop/identity-lifecycle.md","mode":"shared-read"},{"pathPrefix":"docs/client/mobile/lifecycle.md","mode":"shared-read"},{"pathPrefix":"docs/knowledge","mode":"exclusive-write"},{"pathPrefix":"reports/mobile-infra-chat-usable","mode":"exclusive-write"}],"nonGoals":["Reopen or weaken the completed MICU-01 Session class authority","Claim Agent or Moments readiness","Claim cross-Station or Relay-backed Mobile Chat","Claim Android, physical-device, or live third-party OAuth behavior","Change Conversation authority or introduce compatibility routes","Allow more than one active Session for one actor and canonical client class","Use device_id, window labels, runtime labels, or OS models as Session concurrency classes","Push a branch or create a pull request"]},"tasks":[{"id":"MICU-02","workstreamId":"MICU-CHAT","path":"tasks/MICU-02.md","dependsOn":[]},{"id":"MICU-03","workstreamId":"MICU-SESSION","path":"tasks/MICU-03.md","dependsOn":[]},{"id":"MICU-04","workstreamId":"MICU-RELEASE","path":"tasks/MICU-04.md","dependsOn":["MICU-02","MICU-03"]}],"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["three","station-three","four","fiveArm","chat-native-disposable","chat-native-disposable-station","chat-native-four","mobile-direct-simulator","chat-mixed-native","mobile-station-lifecycle-simulator","station-access-native","native-tauri-current-profile"],"destructiveResetScopes":["mobile-social-simulator-actors","chat-mixed-native-actors"]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{"closures":{"MICU-02-mixed-chat-usability":["mobile-simulator-chat-contacts-e2e","chat-lifecycle-mixed-client-same-station-e2e"],"MICU-03-session-class-matrix":["chat-native-multi-device-e2e","chat-lifecycle-mixed-client-multi-device-e2e","mobile-simulator-station-lifecycle-e2e","station-access-session-class-e2e"],"MICU-04-usability-report":[]},"completion":["development-workflow-control-plane","architecture-module-governance","mobile-contract-static","station-messaging-unit","messaging-platform-contract","chat-lifecycle-rich-voice-e2e","chat-storage-accounting-e2e","chat-storage-contract","chat-storage-redaction-recovery-e2e","mobile-hard-cut-static","mobile-simulator-chat-contacts-e2e","chat-lifecycle-mixed-client-same-station-e2e","chat-native-multi-device-e2e","chat-lifecycle-mixed-client-multi-device-e2e","mobile-simulator-station-lifecycle-e2e","station-access-session-class-e2e","proto-build","station-api-ownership","station-access-capability-contract","station-access-desktop-oauth-native-e2e","station-access-auth-e2e","station-access-scope-isolation-e2e","station-access-federation-boundary-e2e","desktop-release-build","mobile-native-build","station-access-lifecycle-aggregate-e2e","station-access-domain-validation","acceptance-infra-validation","acceptance-plan-self","acceptance-runtime-provisioning-self","acceptance-workflow-contract","chat-lifecycle-call-resolution-e2e","chat-lifecycle-mixed-client-cross-station-e2e","chat-lifecycle-mixed-client-group-mls-e2e","mobile-ios-simulator-layout-accessibility-e2e","mobile-simulator-access-e2e","mobile-simulator-runtime-lifecycle-e2e","chat-lifecycle-direct-e2e","chat-native-current-profile-two-client-e2e","chat-native-submitted-command-recovery-e2e","chat-native-two-client-e2e","chat-native-visible-static","desktop-check","chat-lifecycle-tree-zero-reference-e2e","chat-storage-cache-clear-e2e","chat-storage-retention-e2e","chat-storage-delete-reclaim-e2e","chat-storage-dead-contract-zero-e2e","chat-storage-desktop-batch-clear-e2e","chat-storage-mobile-batch-clear-e2e","chat-storage-zero-legacy-e2e","mobile-simulator-social-convergence-e2e","mobile-simulator-recovery-e2e","mobile-simulator-recovery-ui-e2e","mobile-simulator-moments-e2e","chat-lifecycle-interactions-group-e2e","chat-lifecycle-onboarding-e2e","chat-native-group-mls-e2e","chat-native-interactions-e2e","chat-native-recovery-e2e","chat-native-typing-e2e"],"full":["development-workflow-control-plane","architecture-module-governance","mobile-contract-static","station-messaging-unit","messaging-platform-contract","chat-lifecycle-rich-voice-e2e","chat-storage-accounting-e2e","chat-storage-contract","chat-storage-redaction-recovery-e2e","mobile-hard-cut-static","mobile-simulator-chat-contacts-e2e","chat-lifecycle-mixed-client-same-station-e2e","chat-native-multi-device-e2e","chat-lifecycle-mixed-client-multi-device-e2e","mobile-simulator-station-lifecycle-e2e","station-access-session-class-e2e","proto-build","station-api-ownership","station-access-capability-contract","station-access-desktop-oauth-native-e2e","station-access-auth-e2e","station-access-scope-isolation-e2e","station-access-federation-boundary-e2e","desktop-release-build","mobile-native-build","station-access-lifecycle-aggregate-e2e","station-access-domain-validation","acceptance-infra-validation","acceptance-plan-self","acceptance-runtime-provisioning-self","acceptance-workflow-contract","chat-lifecycle-call-resolution-e2e","chat-lifecycle-mixed-client-cross-station-e2e","chat-lifecycle-mixed-client-group-mls-e2e","mobile-ios-simulator-layout-accessibility-e2e","mobile-simulator-access-e2e","mobile-simulator-runtime-lifecycle-e2e","chat-lifecycle-direct-e2e","chat-native-current-profile-two-client-e2e","chat-native-submitted-command-recovery-e2e","chat-native-two-client-e2e","chat-native-visible-static","desktop-check","chat-lifecycle-tree-zero-reference-e2e","chat-storage-cache-clear-e2e","chat-storage-retention-e2e","chat-storage-delete-reclaim-e2e","chat-storage-dead-contract-zero-e2e","chat-storage-desktop-batch-clear-e2e","chat-storage-mobile-batch-clear-e2e","chat-storage-zero-legacy-e2e","mobile-simulator-social-convergence-e2e","mobile-simulator-recovery-e2e","mobile-simulator-recovery-ui-e2e","mobile-simulator-moments-e2e","chat-lifecycle-interactions-group-e2e","chat-lifecycle-onboarding-e2e","chat-native-group-mls-e2e","chat-native-interactions-e2e","chat-native-recovery-e2e","chat-native-typing-e2e"]}
```

## Continuation Boundary

Version v30 preserves v29 and adds only three registry-required Chat storage
regression Gates. Journeys, closures, runtime topology, authorization, and
claim boundaries remain unchanged.

The v1 successor handoff exposed invalid comma-delimited values in the
single-valued `journeyId` field of MICU-02 and MICU-04. Version v2 corrected
those boundaries but retained `executionMode=fix` after all source changes had
already landed. Version v3 corrected the execution mode. Version v4 reconciled
the reviewed disposable runtime topology and exposed one source defect: named
Mobile profiles still read obsolete local caches. Commit `3a1ee6a92` repairs
that authority boundary by resolving tracked-clean environment-repository
profiles. Formal admission then identified ten existing Gates invalidated by
the common provisioner path. Version v5 added those Gates to the impact set.
Version v6 admitted the shared Native Desktop driver after an exact-source run
proved Mobile Chat/Contacts and exposed its stale Tauri input envelope. Version
v7 added the six existing Gates mapped to the repaired shared driver. Formal
admission then exposed the pending SAL-G05 Gate and its missing Desktop
same-class proof dependency. Version v8 orders the existing
`chat-native-multi-device-e2e` proof before the new Station Access aggregate.
Implementing that business injection caused formal admission to expose eleven
existing Station Access contract, native, build, aggregate, and domain Gates
mapped to the edited paths. Version v9 adds only those regression obligations.
Its exact-source owner run then exposed two source defects before product
proof: Native Desktop Station bindings still read worktree-local profile caches
instead of the reviewed environment repository, and the Mobile lifecycle scope
action split the canonical projection by omitting `group` while the
parent/child runtime contract split it in the opposite direction by omitting
`deviceId`. Version v10 declares the source paths required for those root fixes
and the nine existing registry-mapped regression Gates selected by the
canonical planner; product Journeys and claim boundaries remain unchanged.
The v10 exact-source runs then closed the child capability and same-Station
topology gaps and exposed one persistence-ordering defect: PostgreSQL collation
ordered a Desktop `0...` device ID before a Mobile `-...` device ID while the
Actor Identity endpoint-manifest validator requires canonical byte order.
Version v11 adds only the Actor Identity persistence owner and focused
regression for that canonical ordering; the Journey, Gate closure, and
non-claims remain unchanged.
The v11 exact-source run passed Desktop takeover, Mobile takeover, canonical
endpoint proof, and reached post-revoke Mobile delivery. A failed claimed-item
commit then left Mobile on its pre-claim consumer epoch, so the next reconcile
was correctly rejected by Station as `DEVICE_INBOX_CONSUMER_FENCED`. Desktop
already advances its runtime epoch from the shared Queue Drain observer before
item processing. Version v12 adds only the Mobile Messaging owner and focused
regression needed to enforce the same fencing lifecycle; product Journeys,
Gate closure, and non-claims remain unchanged.
The v12 source fix passed focused verification and both Stations attested the
checkpoint. Formal run admission then selected five existing registry Gates
for the Mobile Messaging owner that were absent from the Plan inventory:
`chat-lifecycle-rich-voice-e2e`, `chat-storage-accounting-e2e`,
`chat-storage-contract`, `chat-storage-redaction-recovery-e2e`, and
`mobile-hard-cut-static`. Version v13 adds only those regression obligations to
the completion and full Gate sets; the current MICU-03 four-Gate closure,
Journey, implementation, authorization, and non-claims remain unchanged.
The v13 exact-source run passed both same-class takeover Gates and crossed the
consumer-epoch failure point. It then exposed a Portable Messaging Core
validation defect: actor-scoped read cursors from one device were rejected by
another device of the same actor, contradicting the accepted Desktop/Mobile
companion convergence contract. Version v14 adds only the shared inbox decoder
owner and focused regression for same-actor companion read cursors; the
Journey, Gate closure, authorization, and non-claims remain unchanged.

The v14 exact-source Development closure passed all four required Gates
and their cleanup contracts, then exposed a framework ownership defect:
the Session packager read the runtime manifest reference from a redundant
business result field instead of the durable Gate manifest that registers
that artifact. Version v15 adds only the Development Session owner and its
synthetic regression. Product Journey, Gate closure, authorization, and
non-claims remain unchanged.

The v15 source and infrastructure checks passed, and both Stations attested the
checkpoint. Formal admission then correctly stopped before launching any
product runtime because the edited Development Session path maps to the
existing `development-workflow-control-plane` Gate, which v15 omitted from its
formal inventory. Version v16 adds that Gate and makes the existing iOS
Simulator proof boundary explicit: Mobile usability requires booted Simulator
cells, the installed native app, visible login and Chat interaction, and
source-bound screenshot/Appium evidence. Desktop-only or source-only evidence
cannot substitute for those Mobile outcomes.

The v16 workflow-control-plane Gate passed its Node regression suite, then
stopped on the review-skill freshness contract before any product runtime was
launched. The upstream change is one Knowledge index link and does not alter
review behavior or fixtures. Version v17 admits only the freshness review
record under MICU-03; product scope, four-Gate closure, runtime topology,
authorization, and visible iOS proof remain unchanged.

Versions v18-v19 added the exact Station profiles and dual-iOS runtime profile
required by the unchanged MICU-03 closure.

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
MICU-02 + MICU-03 --> MICU-04
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
