# Mobile Infra/Chat Usability Continuation - Plan Package

> **Plan ID**: mobile-infra-chat-usability-20261006
> **Version ID**: mobile-infra-chat-usability-20261006-v7
> **Created**: 2026-10-06T03:14:17.000Z
> **Supersedes**: `20261006-infra-chat-usability-v6` after registry impact reconciliation

## Plan Version

```json
{"kind":"peers-touch-plan-version","planId":"mobile-infra-chat-usability-20261006","versionId":"mobile-infra-chat-usability-20261006-v7","createdAt":"2026-10-06T03:14:17.000Z","workClass":"product-behavior","architecture":{"sources":["docs/architecture/platform/client/mobile/product-definition.md","docs/architecture/platform/client/mobile/experience-contract.md","docs/architecture/platform/client/mobile/acceptance-matrix.md","docs/architecture/platform/client/mobile/design.md","docs/architecture/platform/client/mobile/decisions.md","docs/architecture/platform/station/access/product-definition.md","docs/architecture/platform/station/access/experience-contract.md","docs/architecture/platform/station/access/acceptance-matrix.md","docs/architecture/platform/station/access/design.md","docs/architecture/platform/station/access/decisions.md","docs/architecture/domains/chat/lifecycle","docs/client/desktop/identity-lifecycle.md","docs/client/mobile/lifecycle.md"],"decisions":["MS-D06","MS-D07","MS-D09","MS-D10","MS-D17","MS-D26","MS-D27","SAL-D01","SAL-D02","SAL-D03","SAL-D06","SAL-D07"]},"scope":{"sourceClaims":[{"pathPrefix":"apps/station/app/subserver/conversation","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/application/auth","mode":"shared-read"},{"pathPrefix":"apps/desktop/src-tauri/src/interface/http_gateway/mod.rs","mode":"shared-read"},{"pathPrefix":"apps/desktop/src/acceptance","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/services","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src-tauri/src/runtime/oauth","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src-tauri/src/messaging","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/drivers/native/runtime.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/environments/chat-mixed-native.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates/chat","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates/mobile","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates/station_access","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/provisioners/mobile_simulator.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/tests/test_mobile_simulator_provisioner.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/tests/test_native_runtime_binding.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/registry.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/reports","mode":"shared-read"},{"pathPrefix":"tooling/acceptance/features","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/capabilities","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/domains/chat/lifecycle","mode":"shared-read"},{"pathPrefix":"docs/architecture/platform/station/access","mode":"shared-read"},{"pathPrefix":"docs/architecture/platform/client/mobile","mode":"shared-read"},{"pathPrefix":"docs/client/desktop/identity-lifecycle.md","mode":"shared-read"},{"pathPrefix":"docs/client/mobile/lifecycle.md","mode":"shared-read"},{"pathPrefix":"docs/knowledge","mode":"exclusive-write"},{"pathPrefix":"reports/mobile-infra-chat-usable","mode":"exclusive-write"}],"nonGoals":["Reopen or weaken the completed MICU-01 Session class authority","Claim Agent or Moments readiness","Claim cross-Station or Relay-backed Mobile Chat","Claim Android, physical-device, or live third-party OAuth behavior","Change Conversation authority or introduce compatibility routes","Allow more than one active Session for one actor and canonical client class","Use device_id, window labels, runtime labels, or OS models as Session concurrency classes","Push a branch or create a pull request"]},"tasks":[{"id":"MICU-02","workstreamId":"MICU-CHAT","path":"tasks/MICU-02.md","dependsOn":[]},{"id":"MICU-03","workstreamId":"MICU-SESSION","path":"tasks/MICU-03.md","dependsOn":[]},{"id":"MICU-04","workstreamId":"MICU-RELEASE","path":"tasks/MICU-04.md","dependsOn":["MICU-02","MICU-03"]}],"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["three","station-three","chat-native-disposable","chat-native-disposable-station","chat-native-four","mobile-direct-simulator","chat-mixed-native","station-access-native"],"destructiveResetScopes":["mobile-social-simulator-actors","chat-mixed-native-actors"]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{"closures":{"MICU-02-mixed-chat-usability":["mobile-simulator-chat-contacts-e2e","chat-lifecycle-mixed-client-same-station-e2e"],"MICU-03-session-class-matrix":["chat-lifecycle-mixed-client-multi-device-e2e","mobile-simulator-station-lifecycle-e2e","station-access-session-class-e2e"],"MICU-04-usability-report":[]},"completion":["architecture-module-governance","mobile-contract-static","station-messaging-unit","messaging-platform-contract","mobile-simulator-chat-contacts-e2e","chat-lifecycle-mixed-client-same-station-e2e","chat-lifecycle-mixed-client-multi-device-e2e","mobile-simulator-station-lifecycle-e2e","station-access-session-class-e2e","acceptance-infra-validation","acceptance-plan-self","acceptance-runtime-provisioning-self","acceptance-workflow-contract","chat-lifecycle-call-resolution-e2e","chat-lifecycle-mixed-client-cross-station-e2e","chat-lifecycle-mixed-client-group-mls-e2e","mobile-ios-simulator-layout-accessibility-e2e","mobile-simulator-access-e2e","mobile-simulator-runtime-lifecycle-e2e","chat-lifecycle-direct-e2e","chat-native-current-profile-two-client-e2e","chat-native-submitted-command-recovery-e2e","chat-native-two-client-e2e","chat-native-visible-static","desktop-check"],"full":["architecture-module-governance","mobile-contract-static","station-messaging-unit","messaging-platform-contract","mobile-simulator-chat-contacts-e2e","chat-lifecycle-mixed-client-same-station-e2e","chat-lifecycle-mixed-client-multi-device-e2e","mobile-simulator-station-lifecycle-e2e","station-access-session-class-e2e","acceptance-infra-validation","acceptance-plan-self","acceptance-runtime-provisioning-self","acceptance-workflow-contract","chat-lifecycle-call-resolution-e2e","chat-lifecycle-mixed-client-cross-station-e2e","chat-lifecycle-mixed-client-group-mls-e2e","mobile-ios-simulator-layout-accessibility-e2e","mobile-simulator-access-e2e","mobile-simulator-runtime-lifecycle-e2e","chat-lifecycle-direct-e2e","chat-native-current-profile-two-client-e2e","chat-native-submitted-command-recovery-e2e","chat-native-two-client-e2e","chat-native-visible-static","desktop-check"]}
```

## Continuation Boundary

Version v1 closed MICU-01 at source
`8d13b382fe27afb9e4acd218866f8bc50a94f2d8` with Completion Review
`review-b3b7a272566a8665da07975f10a503be`. This version carries no mutable
MICU-01 lifecycle and does not reopen its implementation.

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
proved Mobile Chat/Contacts and exposed its stale Tauri input envelope. The
driver repair at `d8b396dfb` then caused admission to identify six additional
existing Gates mapped to that shared path. Version v7 adds those Gates only as
completion/full regression obligations; product closures, Journeys, and claim
boundaries remain unchanged.

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
| Desktop class takeover | SAL-J06, SAL-C07 | SAL-D07 | Session class matrix |
| Mobile class takeover | SAL-J06, SAL-C07 | SAL-D07 | Session class matrix + Mobile lifecycle |

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

## Completion

- Exact-source Station deployment, Desktop binary, and Mobile simulator share
  one commit identity.
- Required mixed-client Chat and Session-class Journeys pass with receiver-side
  readback.
- Registry-mapped Gates affected by the common Mobile provisioner and Native
  Desktop driver repairs are explicit regression obligations, not expanded
  product claims.
- The final report lists passed, failed, blocked, deferred, and unproven scope
  without claiming Agent, Moments, cross-Station, Android, physical OAuth, or
  physical-device readiness.
- Owned runtimes and declarations are closed; no push or PR is created.
