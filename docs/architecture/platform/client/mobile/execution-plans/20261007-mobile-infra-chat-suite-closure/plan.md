# Mobile Infra Chat Suite Closure - Plan Package

> **Plan ID**: mobile-infra-chat-suite-closure-20261007
> **Created**: 2026-10-07T08:40:00.000Z

## Plan

```json
{"kind":"peers-touch-plan","planId":"mobile-infra-chat-suite-closure-20261007","createdAt":"2026-10-07T08:40:00.000Z","northStar":{"objective":"Close the Mobile and Desktop Session-class proof gap with one exact-source reusable Suite Runtime, real product UI actions, receiver-visible evidence, and terminal cleanup.","successCriteria":[{"id":"MICU-SUITE-NS-01","statement":"One shared Suite Runtime proves same-Station Chat, Desktop-Mobile coexistence, Desktop takeover, and Mobile takeover without per-Scenario provisioning.","sourceRefs":["SAL-J06","SAL-C07","D-21"]},{"id":"MICU-SUITE-NS-02","statement":"The final report binds current-source formal proof and all owned simulators, clients, leases, processes, and declarations return to baseline.","sourceRefs":["MS-J03","SAL-G05","DWF-D42"]}]},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/platform/client/mobile/product-definition.md","docs/architecture/platform/client/mobile/experience-contract.md","docs/architecture/platform/client/mobile/acceptance-matrix.md","docs/architecture/platform/client/mobile/design.md","docs/architecture/platform/station/access/product-definition.md","docs/architecture/platform/station/access/experience-contract.md","docs/architecture/platform/station/access/acceptance-matrix.md","docs/architecture/platform/station/access/design.md","docs/architecture/engineering/acceptance/decisions.md","docs/knowledge/invariants/acceptance-suite-runtime-reuse.md"],"decisions":["MS-D06","MS-D07","MS-D17","MS-D27","SAL-D07","D-21","DWF-D42"]},"scope":{"sourceClaims":[{"pathPrefix":"apps/desktop","mode":"shared-read"},{"pathPrefix":"apps/mobile","mode":"shared-read"},{"pathPrefix":"apps/station","mode":"shared-read"},{"pathPrefix":"docs/architecture/engineering/acceptance","mode":"shared-read"},{"pathPrefix":"docs/architecture/platform/client/mobile/acceptance-matrix.md","mode":"shared-read"},{"pathPrefix":"docs/architecture/platform/client/mobile/design.md","mode":"shared-read"},{"pathPrefix":"docs/architecture/platform/client/mobile/experience-contract.md","mode":"shared-read"},{"pathPrefix":"docs/architecture/platform/client/mobile/product-definition.md","mode":"shared-read"},{"pathPrefix":"docs/architecture/platform/client/mobile/execution-plans/20261007-mobile-infra-chat-suite-closure","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/platform/station/access","mode":"shared-read"},{"pathPrefix":"docs/knowledge/invariants/acceptance-suite-runtime-reuse.md","mode":"shared-read"},{"pathPrefix":"packages/messaging-core","mode":"shared-read"},{"pathPrefix":"reports/mobile-infra-chat-usable","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-pipeline-audit-test.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-pipeline-audit.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-plan-test.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-plan.py","mode":"exclusive-write"}],"nonGoals":["Change Station Session policy, Conversation authority, or product transport contracts","Claim cross-Station Chat, Relay, Android, physical-device, Agent, or Moments readiness","Use Harness or API observations as substitutes for required UI actions or receiver-visible evidence","Modify frozen v33 evidence or relabel its four independent Gate runs as one Suite","Use the fiveArm Station, physical Android device, or foreign Appium lease","Push, create a pull request, or rewrite history"]},"tasks":[{"id":"MICU-03-SUITE-CLOSE","workstreamId":"MICU-SESSION","path":"tasks/MICU-03-SUITE-CLOSE.md","dependsOn":[]}],"authorization":{"checkpoint":{"localCommit":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["chat-native-disposable","chat-native-disposable-station","chat-native-four","chat-mixed-native"],"destructiveResetScopes":["chat-mixed-native-actors"]},"history":{"rewrite":"denied"}},"amendments":[{"id":"amendment-20261007084825536-2212e7172d3461c89c49745529336f30","createdAt":"2026-10-07T08:48:25.536Z","actor":"acceptance@test.invalid","reason":"Canonical Suite auditor rejects the current stable Plan heading","changes":["Add exact Acceptance pipeline auditor paths and its synthetic regression to the current Task"],"impact":{"taskIds":["MICU-03-SUITE-CLOSE"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"a4c9590138a7063b281403768169eeed7778c936f88183464143bfc79af793b3","toContentDigest":"98c855d7f728bfe482da8847ce67da7b0cb21c9cafdd5a9328c4a119328dd093"},{"id":"amendment-20261007091259509-24118991550c9b8093dcc8fb675157e2","createdAt":"2026-10-07T09:12:59.509Z","actor":"acceptance@test.invalid","reason":"Development closure loses mounted initialHead when the current Plan path is explicit","changes":["Resolve an explicit Plan path through the live workspace mount before requiring repository completion"],"impact":{"taskIds":["MICU-03-SUITE-CLOSE"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"98c855d7f728bfe482da8847ce67da7b0cb21c9cafdd5a9328c4a119328dd093","toContentDigest":"1aee10a263c47dd54902df7400b5902d6c86c3d012117b490d4188cef51752c5"}],"northStarApproval":{"northStarDigest":"d35dcb72fb2996a4bd217aea022493d3eb8c0d66eb1d6f5c76c096c3cb1e1970","approvedBy":"user","approvedAt":"2026-10-07T08:37:52.470Z","decisionRef":"trae-chat:6ac3c21a832b0391483ad1b0:20261007:adjust-and-complete"},"criterionCoverage":[{"criterionId":"MICU-SUITE-NS-01","taskIds":["MICU-03-SUITE-CLOSE"],"closureIds":["MICU-03-session-class-suite"],"gateIds":["station-access-session-class-suite-e2e"]},{"criterionId":"MICU-SUITE-NS-02","taskIds":["MICU-03-SUITE-CLOSE"],"closureIds":["MICU-03-session-class-suite"],"gateIds":["station-access-session-class-suite-e2e"]}]}
```

## Acceptance Execution

```json
{"closures":{"MICU-03-session-class-suite":["station-access-session-class-suite-e2e"]},"completion":["station-access-session-class-suite-e2e"],"full":["station-access-session-class-suite-e2e"]}
```

## Goal

Replace the invalid four-run MICU-03 Suite claim with one business-owned,
source-bound runtime lifecycle. The Suite provisions and logs in once, then
runs same-Station Chat, cross-class coexistence, Desktop takeover, and Mobile
takeover in order. Every Scenario records a real Desktop UI send, a
receiver-visible Desktop or Mobile observation, supporting Station/client
state, and final cleanup.

## Preserved Boundaries

- Station remains the Session authority and retains one slot per canonical
  client class.
- Conversation remains the only Chat business API owner.
- Acceptance Core remains domain-neutral; the Suite owner lives under Station
  Access business Gates.
- The two replacement clients are explicit Suite resources, not hidden
  per-Scenario provisioning.
- Old independent Gates remain valid regressions but no longer satisfy the
  Suite Runtime claim.
