# Mobile Infra/Chat Usability Continuation - Plan Package

> **Plan ID**: mobile-infra-chat-usability-20261006
> **Version ID**: mobile-infra-chat-usability-20261006-v2
> **Created**: 2026-10-06T01:54:03.000Z
> **Supersedes**: `20261006-infra-chat-usability` after MICU-01 completion

## Plan Version

```json
{"kind":"peers-touch-plan-version","planId":"mobile-infra-chat-usability-20261006","versionId":"mobile-infra-chat-usability-20261006-v2","createdAt":"2026-10-06T01:54:03.000Z","workClass":"product-behavior","architecture":{"sources":["docs/architecture/platform/client/mobile/product-definition.md","docs/architecture/platform/client/mobile/experience-contract.md","docs/architecture/platform/client/mobile/acceptance-matrix.md","docs/architecture/platform/client/mobile/design.md","docs/architecture/platform/client/mobile/decisions.md","docs/architecture/platform/station/access/product-definition.md","docs/architecture/platform/station/access/experience-contract.md","docs/architecture/platform/station/access/acceptance-matrix.md","docs/architecture/platform/station/access/design.md","docs/architecture/platform/station/access/decisions.md","docs/architecture/domains/chat/lifecycle","docs/client/desktop/identity-lifecycle.md","docs/client/mobile/lifecycle.md"],"decisions":["MS-D06","MS-D07","MS-D09","MS-D10","MS-D17","MS-D26","MS-D27","SAL-D01","SAL-D02","SAL-D03","SAL-D06","SAL-D07"]},"scope":{"sourceClaims":[{"pathPrefix":"apps/station/app/subserver/conversation","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/application/auth","mode":"shared-read"},{"pathPrefix":"apps/desktop/src-tauri/src/interface/http_gateway/mod.rs","mode":"shared-read"},{"pathPrefix":"apps/desktop/src/acceptance","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/services","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src-tauri/src/runtime/oauth","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src-tauri/src/messaging","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/environments/chat-mixed-native.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates/chat","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates/mobile","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates/station_access","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/provisioners/mobile_simulator.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/tests/test_mobile_simulator_provisioner.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/registry.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/reports","mode":"shared-read"},{"pathPrefix":"tooling/acceptance/features","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/capabilities","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/domains/chat/lifecycle","mode":"shared-read"},{"pathPrefix":"docs/architecture/platform/station/access","mode":"shared-read"},{"pathPrefix":"docs/architecture/platform/client/mobile","mode":"shared-read"},{"pathPrefix":"docs/client/desktop/identity-lifecycle.md","mode":"shared-read"},{"pathPrefix":"docs/client/mobile/lifecycle.md","mode":"shared-read"},{"pathPrefix":"docs/knowledge","mode":"exclusive-write"},{"pathPrefix":"reports/mobile-infra-chat-usable","mode":"exclusive-write"}],"nonGoals":["Reopen or weaken the completed MICU-01 Session class authority","Claim Agent or Moments readiness","Claim cross-Station or Relay-backed Mobile Chat","Claim Android, physical-device, or live third-party OAuth behavior","Change Conversation authority or introduce compatibility routes","Allow more than one active Session for one actor and canonical client class","Use device_id, window labels, runtime labels, or OS models as Session concurrency classes","Push a branch or create a pull request"]},"tasks":[{"id":"MICU-02","workstreamId":"MICU-CHAT","path":"tasks/MICU-02.md","dependsOn":[]},{"id":"MICU-03","workstreamId":"MICU-SESSION","path":"tasks/MICU-03.md","dependsOn":[]},{"id":"MICU-04","workstreamId":"MICU-RELEASE","path":"tasks/MICU-04.md","dependsOn":["MICU-02","MICU-03"]}],"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["three","station-three","chat-native-disposable-station","mobile-direct-simulator","chat-mixed-native","station-access-native"],"destructiveResetScopes":[]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{"closures":{"MICU-02-mixed-chat-usability":["mobile-simulator-chat-contacts-e2e","chat-lifecycle-mixed-client-same-station-e2e"],"MICU-03-session-class-matrix":["chat-lifecycle-mixed-client-multi-device-e2e","mobile-simulator-station-lifecycle-e2e","station-access-session-class-e2e"],"MICU-04-usability-report":[]},"completion":["architecture-module-governance","mobile-contract-static","station-messaging-unit","messaging-platform-contract","mobile-simulator-chat-contacts-e2e","chat-lifecycle-mixed-client-same-station-e2e","chat-lifecycle-mixed-client-multi-device-e2e","mobile-simulator-station-lifecycle-e2e","station-access-session-class-e2e"],"full":["architecture-module-governance","mobile-contract-static","station-messaging-unit","messaging-platform-contract","mobile-simulator-chat-contacts-e2e","chat-lifecycle-mixed-client-same-station-e2e","chat-lifecycle-mixed-client-multi-device-e2e","mobile-simulator-station-lifecycle-e2e","station-access-session-class-e2e"]}
```

## Continuation Boundary

Version v1 closed MICU-01 at source
`8d13b382fe27afb9e4acd218866f8bc50a94f2d8` with Completion Review
`review-b3b7a272566a8665da07975f10a503be`. This version carries no mutable
MICU-01 lifecycle and does not reopen its implementation.

The v1 successor handoff exposed invalid comma-delimited values in the
single-valued `journeyId` field of MICU-02 and MICU-04. Version v2 preserves
their accepted outcomes and proof obligations under stable plan-local
functional boundaries `MICU-J02` and `MICU-J04`.

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

## Completion

- Exact-source Station deployment, Desktop binary, and Mobile simulator share
  one commit identity.
- Required mixed-client Chat and Session-class Journeys pass with receiver-side
  readback.
- The final report lists passed, failed, blocked, deferred, and unproven scope
  without claiming Agent, Moments, cross-Station, Android, physical OAuth, or
  physical-device readiness.
- Owned runtimes and declarations are closed; no push or PR is created.
