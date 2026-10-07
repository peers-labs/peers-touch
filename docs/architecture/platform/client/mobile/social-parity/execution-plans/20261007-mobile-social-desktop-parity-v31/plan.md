# Mobile Social Desktop Parity

> **Plan ID**: MPS-20261006
> **Created**: 2026-10-07T02:56:05.000Z

## Plan

```json
{"kind":"peers-touch-plan","planId":"MPS-20261006","createdAt":"2026-10-07T02:56:05.000Z","northStar":{"objective":"Deliver one canonical Mobile Social facade and Native adapter with receiver-visible semantic parity across iOS, physical Android, Desktop, and two Stations, without duplicating Station Social, Secure Content, or Federation authority.","successCriteria":[{"id":"MPS-NS-01","statement":"iOS RC01 proves complete same-Station Mobile Social behavior on isolated native Simulators.","sourceRefs":["MSP-J01-J09-IOS","RC01","PA01-PA09","PA14-PA15","PA18-PA19"]},{"id":"MPS-NS-02","statement":"Physical Android RC02 proves the same canonical Social behavior, Peers branding, lifecycle, accessibility, and bounded-list outcomes without an Emulator substitute.","sourceRefs":["MSP-J01-J05-J09-ANDROID","RC02","PA01-PA09","PA14-PA15","PA18-PA19"]},{"id":"MPS-NS-03","statement":"Desktop and iOS prove bidirectional cross-Station convergence, authorization, outage, recovery, replay, and invalidation for RC03, RC04, RC08, RC09, and RC10.","sourceRefs":["MSP-J07-J08-J10-CROSS-STATION-IOS","RC03","RC04","RC08","RC09","RC10"]},{"id":"MPS-NS-04","statement":"Desktop, iOS, and the USB-authorized physical Android device prove all RC05, RC06, and RC07 interoperability directions on exact source.","sourceRefs":["MSP-J05-J10-ANDROID-INTEROP","RC05","RC06","RC07"]},{"id":"MPS-NS-05","statement":"The final aggregate emits SOCIAL_MOBILE_DESKTOP_PARITY_PROVEN only when RC01-RC10, PA01-PA19, AG01-AG10, exact-source identity, and cleanup all pass.","sourceRefs":["MSP-J01-J10-AGGREGATE","RC01-RC10","PA01-PA19","AG01-AG10"]}]},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/platform/client/mobile/social-parity/product-definition.md","docs/architecture/platform/client/mobile/social-parity/experience-contract.md","docs/architecture/platform/client/mobile/social-parity/product-state-model.md","docs/architecture/platform/client/mobile/social-parity/acceptance-matrix.md","docs/architecture/platform/client/mobile/social-parity/design.md","docs/architecture/platform/client/mobile/social-parity/decisions.md","docs/architecture/platform/client/mobile/social-parity/data-model.md","docs/architecture/platform/client/mobile/social-parity/integration.md","docs/architecture/platform/client/mobile/social-parity/module-layout.md","docs/architecture/platform/client/mobile/social-parity/prototype/README.md"],"decisions":["MPS-D01","MPS-D02","MPS-D03","MPS-D04","MPS-D05","MPS-D06","MPS-D07","MPS-D08","MPS-D09","MPS-D10","MPS-D11","MPS-D12","MPS-D13"]},"scope":{"sourceClaims":[{"pathPrefix":"apps/mobile","mode":"exclusive-write"},{"pathPrefix":"apps/desktop","mode":"shared-read"},{"pathPrefix":"apps/station","mode":"shared-read"},{"pathPrefix":"docs/architecture/domains/social/core","mode":"shared-read"},{"pathPrefix":"docs/architecture/domains/social/core/README.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/domains/social/core/acceptance-matrix.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/domains/social/core/experience-contract.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/domains/social/core/product-definition.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/domains/social/core/product-state-model.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/domains/social/cross-station","mode":"shared-read"},{"pathPrefix":"docs/architecture/engineering/architecture-governance/architecture-modules.json","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/platform/client/mobile","mode":"shared-read"},{"pathPrefix":"docs/architecture/platform/client/mobile/README.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/platform/client/mobile/social-parity/README.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/platform/client/mobile/social-parity/acceptance-matrix.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/platform/client/mobile/social-parity/integration.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/platform/client/mobile/social-parity/module-layout.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/platform/client/mobile/social-parity/prototype","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/shared/federation","mode":"shared-read"},{"pathPrefix":"docs/architecture/shared/security/secure-content","mode":"shared-read"},{"pathPrefix":"docs/client/common/ui-identity/frontend-component-tree-registry.md","mode":"exclusive-write"},{"pathPrefix":"docs/README.md","mode":"exclusive-write"},{"pathPrefix":"model/domain/social","mode":"shared-read"},{"pathPrefix":"packages/locales","mode":"exclusive-write"},{"pathPrefix":"packages/prototypes/mobile/chat","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-gap-detect.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-gap-detect-test.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/architecture/module-governance.test.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/local-dev/completion-review.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/local-dev/dev-session.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/local-dev/dev-session.test.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/plan/planctl.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/plan/planctl.test.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/generate-mobile-brand-assets.py","mode":"exclusive-write"}],"nonGoals":["Change Station Social authority, Audience semantics, Secure Content algorithms, or Federation transport ownership","Add Browser Social, Mobile P2P, direct remote-Station calls, or a second Mobile Social stack","Preserve Web bearer transport, three-Audience subsets, public/private fallback, dual writes, or parallel durable stores","Claim Android or full Mobile parity from an Emulator, iOS-only evidence, static checks, or prototype screenshots","Reset shared or production data, create environments, push, open a pull request, amend checkpoints, or rewrite history"]},"tasks":[{"id":"MPS-11A-ANDROID-SAME-STATION","workstreamId":"MPS-PROOF","path":"tasks/MPS-11A-ANDROID-SAME-STATION.md","dependsOn":[]},{"id":"MPS-09-IOS-ACCEPTANCE","workstreamId":"MPS-MOBILE-SOCIAL","path":"tasks/MPS-09-IOS-ACCEPTANCE.md","dependsOn":[]},{"id":"MPS-10-CROSS-STATION-IOS","workstreamId":"MPS-PROOF","path":"tasks/MPS-10-CROSS-STATION-IOS.md","dependsOn":["MPS-09-IOS-ACCEPTANCE"]},{"id":"MPS-11B-ANDROID-INTEROP","workstreamId":"MPS-PROOF","path":"tasks/MPS-11B-ANDROID-INTEROP.md","dependsOn":["MPS-11A-ANDROID-SAME-STATION","MPS-10-CROSS-STATION-IOS"]},{"id":"MPS-12-AGGREGATE","workstreamId":"MPS-DELIVERY","path":"tasks/MPS-12-AGGREGATE.md","dependsOn":["MPS-10-CROSS-STATION-IOS","MPS-11B-ANDROID-INTEROP"]}],"authorization":{"checkpoint":{"localCommit":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["fiveArm","three","two"],"destructiveResetScopes":[]},"history":{"rewrite":"denied"}},"amendments":[{"id":"amendment-20261007100619394-7665ae93da24297cbea97f1a2e4f31e5","createdAt":"2026-10-07T10:06:19.394Z","actor":"acceptance@test.invalid","reason":"owner-approved composer layout sync","changes":["add prototype write set and bottom-anchored compact composer criterion"],"impact":{"taskIds":["MPS-11A-ANDROID-SAME-STATION"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"2db582a2ada8dcafd95485d8425b4895948d2c5a0b0b4369322c59bda50b2d77","toContentDigest":"09c71f40bee39283191c7faec519f725a985f07bc914f6f687035241ad8d2c3d"},{"id":"amendment-20261007102145534-9eed5187dd3bc8ec6b21426da1c362eb","createdAt":"2026-10-07T10:21:45.534Z","actor":"acceptance@test.invalid","reason":"prototype evidence documentation scope omitted","changes":["add the Mobile Social prototype evidence directory to MPS-11A and Plan exclusive write scope"],"impact":{"taskIds":["MPS-09-IOS-ACCEPTANCE","MPS-10-CROSS-STATION-IOS","MPS-11A-ANDROID-SAME-STATION","MPS-11B-ANDROID-INTEROP","MPS-12-AGGREGATE"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"09c71f40bee39283191c7faec519f725a985f07bc914f6f687035241ad8d2c3d","toContentDigest":"c089f9c1b42b8fb90c298656c1f66aa8444c797b6d852419077d8011ab5d4a8e"},{"id":"amendment-20261007104212412-f4f58015190ccd3b9f37fd35f5ea9526","createdAt":"2026-10-07T10:42:12.412Z","actor":"acceptance@test.invalid","reason":"development runner lost mounted Plan completion binding","changes":["add dev-session owner and test files to MPS-11A write scope"],"impact":{"taskIds":["MPS-09-IOS-ACCEPTANCE","MPS-10-CROSS-STATION-IOS","MPS-11A-ANDROID-SAME-STATION","MPS-11B-ANDROID-INTEROP","MPS-12-AGGREGATE"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"c089f9c1b42b8fb90c298656c1f66aa8444c797b6d852419077d8011ab5d4a8e","toContentDigest":"2c02d23f4a30016ba8d0784c60d05702607d2c4bd2945f65a2bfe9d070c56d17"}],"northStarApproval":{"northStarDigest":"04381a218004031025c292336fe32ab6b6c23db6f5d80a66d444064ee4952c59","approvedBy":"user","approvedAt":"2026-10-07T10:01:53.274Z","decisionRef":"USER-APPROVED-MPS-V31-20261007"},"criterionCoverage":[{"criterionId":"MPS-NS-01","taskIds":["MPS-09-IOS-ACCEPTANCE"],"closureIds":["mps-ios-acceptance"],"gateIds":["mobile-social-ios-native"]},{"criterionId":"MPS-NS-02","taskIds":["MPS-11A-ANDROID-SAME-STATION"],"closureIds":["mps-android-same-station"],"gateIds":["mobile-social-android-native"]},{"criterionId":"MPS-NS-03","taskIds":["MPS-10-CROSS-STATION-IOS"],"closureIds":["mps-cross-station-ios"],"gateIds":["mobile-social-cross-platform"]},{"criterionId":"MPS-NS-04","taskIds":["MPS-11B-ANDROID-INTEROP"],"closureIds":["mps-android-interoperability"],"gateIds":["mobile-social-android-interoperability"]},{"criterionId":"MPS-NS-05","taskIds":["MPS-11A-ANDROID-SAME-STATION","MPS-09-IOS-ACCEPTANCE","MPS-10-CROSS-STATION-IOS","MPS-11B-ANDROID-INTEROP","MPS-12-AGGREGATE"],"closureIds":["mps-android-same-station","mps-ios-acceptance","mps-cross-station-ios","mps-android-interoperability","mps-aggregate"],"gateIds":["mobile-social-android-native","mobile-social-ios-native","mobile-social-cross-platform","mobile-social-android-interoperability","mobile-social-desktop-parity-aggregate"]}]}
```

## Acceptance Execution

```json
{"closures":{"mps-android-same-station":["mobile-social-android-native"],"mps-ios-acceptance":["mobile-social-ios-native"],"mps-cross-station-ios":["mobile-social-cross-platform"],"mps-android-interoperability":["mobile-social-android-interoperability"],"mps-aggregate":["mobile-social-desktop-parity-aggregate"]},"completion":["mobile-social-android-native","mobile-social-ios-native","mobile-social-cross-platform","mobile-social-android-interoperability","mobile-social-desktop-parity-aggregate"],"full":["acceptance-infra-validation","acceptance-plan-self","acceptance-runtime-provisioning-self","acceptance-workflow-contract","development-workflow-control-plane","architecture-module-governance","chat-lifecycle-tree-zero-reference-e2e","chat-lifecycle-mixed-client-same-station-e2e","chat-lifecycle-mixed-client-cross-station-e2e","chat-lifecycle-mixed-client-multi-device-e2e","chat-lifecycle-call-resolution-e2e","chat-lifecycle-mixed-client-group-mls-e2e","chat-storage-cache-clear-e2e","chat-storage-dead-contract-zero-e2e","chat-storage-delete-reclaim-e2e","chat-storage-desktop-batch-clear-e2e","chat-storage-mobile-batch-clear-e2e","chat-storage-retention-e2e","chat-storage-zero-legacy-e2e","federation-three-node-e2e","mobile-contract-static","mobile-hard-cut-static","mobile-identity-contract","mobile-ios-simulator-layout-accessibility-e2e","mobile-native-build","mobile-simulator-access-e2e","mobile-simulator-chat-contacts-e2e","mobile-simulator-moments-e2e","mobile-simulator-platform-e2e","mobile-simulator-recovery-e2e","mobile-simulator-recovery-ui-e2e","mobile-simulator-runtime-lifecycle-e2e","mobile-simulator-social-convergence-e2e","mobile-simulator-station-lifecycle-e2e","mobile-social-facade-contract","mobile-social-feed-native","mobile-social-search-profile-native","mobile-social-circles-native","mobile-social-audience-composer-native","mobile-social-thread-media-native","mobile-social-interaction-convergence-native","mobile-social-recovery-native","mobile-social-revocation-native","mobile-social-lifecycle-native","mobile-social-android-native","mobile-social-ios-native","mobile-social-cross-platform","mobile-social-android-interoperability","mobile-social-desktop-parity-aggregate","proto-build","station-access-federation-boundary-e2e","station-api-ownership","station-federation-unit"]}
```

## Goal

在不复制 Station Social、Secure Content 或 Federation authority 的前提下，让 Mobile
通过一个 Social facade 和一个 Rust adapter 完成 Desktop 当前全部 Social 用户结果，
以确认原型和 Peers 品牌为唯一可见产品基准，并以 iOS、USB physical Android、
Desktop 和两台 Station 的真实互操作证明语义对称。

## Traceability

| Closure | Product source | Architecture source | Required result |
|---|---|---|---|
| Adapter/facade | J01, J04, J05, J09 | D02-D05, D09, D11 | one typed Native boundary and one scoped projection |
| Home/Explore | J01, J05 | D05, D06, D12 | composed feed, sort, anchors and seven-kind rendering |
| Search/Profile | J02, J08 | D03, D06 | local/remote identity and relationship results |
| Circles | J03 | D03, D06 | Circle name, description, member and delete lifecycle |
| Audience/Publish | J04 | D03-D05, D09, D12 | atomic eight-Audience selector and capability-gated publish |
| Thread/Media | J05 | D05, D06, D11 | inline thread and temporary verified media overlay |
| Reactions | J05, J07 | D03-D05, D08 | five reactions, unknown outcome and remote convergence |
| Recovery | J06 | D04, D11, D13 | Bob2 historical recovery through Native-only secret entry and key isolation |
| Revocation | J08 | D03-D05, D11 | delete/block invalidation and cache purge |
| Lifecycle | J09 | D02, D04, D05 | background, restart and scope teardown |
| Native proof | J01-J10 | D01, D07 | RC01-RC10 and PA01-PA19 with bounded claims |

## Acceptance Scenario Ownership

| Owner Task / Gate | Runtime cells | Exact scenario ownership |
|---|---|---|
| MPS-11A / `mobile-social-android-native` | RC02 | physical Android same-Station observations required by PA01-PA09, PA14-PA15, PA18-PA19 |
| MPS-09 / `mobile-social-ios-native` | RC01 | iOS same-Station observations required by PA01-PA09, PA14-PA15, PA18-PA19 |
| MPS-10 / `mobile-social-cross-platform` | RC03, RC04, RC08, RC09, RC10 | Desktop/iOS directions, recovery, authorization, outage, replay and invalidation observations |
| MPS-11B / `mobile-social-android-interoperability` | RC05, RC06, RC07 | Desktop/Android and iOS/Android interoperation observations |
| MPS-12 / `mobile-social-desktop-parity-aggregate` | RC01-RC10 | unique final oracle for PA01-PA19 and AG01-AG10; missing child remains UNPROVEN |

## Execution DAG

```text
MPS-11A ----------------------\
                               -> MPS-11B -> MPS-12
MPS-09 -> MPS-10 ------------/
```

## Atomic Cutover

- MPS-01 through MPS-03 remain accepted source baselines from the superseded v20 run.
- MPS-11A owns the v30 product correction: production follows the confirmed Mobile Social
  prototype, and Android launcher resources use one Peers adaptive-icon source of truth.
- v31 changes only the frozen full-proof Gate inventory by adding `mobile-identity-contract`
  and `mobile-simulator-runtime-lifecycle-e2e`; product, architecture, Task, dependency,
  authorization and runtime semantics remain identical to v30.
- The five mixed-client candidate Gates selected by `tooling/acceptance/provisioners/__init__.py`
  are explicit full-proof obligations instead of undeclared Plan drift.
- MPS-04, MPS-05 and MPS-06 are accepted source baselines from the cancelled v21 run at checkpoints
  `5f6c74af3`, `53cbd6a9a` and `f2645c5b9`; later versions do not repeat their source ownership.
- The current execution baseline additionally contains the accepted PR #121 cross-Station Social
  authority at merge checkpoint `3342b08f8`.
- MPS-07 is an accepted source baseline from the cancelled v23 run at checkpoint `f81b32fd5`; v24
  starts at the first unfinished closure and does not repeat Reaction convergence ownership.
- v24 adds accepted MPS-D13 and the Native secure-input plugin, Cargo/registration roots and
  phrase-bearing Web/Tauri/Acceptance deletion inventory to MPS-08A.
- v25 preserves every product, architecture and proof contract from v24 and adds only the
  architecture-governance registry expectation test exposed by the same-cut plugin registration.
- v26 preserves every product, architecture and proof contract from v25 and adds only the
  existing Mobile Rust Station transport owner to MPS-08B so author delete can use the canonical
  Social delete route before converging the same ordered revocation path.
- MPS-08A is an accepted source baseline at checkpoint `5ac64c6b4`; v27 removes that completed
  closure from the remaining DAG and corrects only the MPS-08B Cargo check invocation.
- MPS-08B is an accepted source baseline at checkpoint `0ff3a0fa0`; v28 removes that completed
  closure from the remaining DAG and adds only the production registry and canonical mutation
  admission regressions required by MPS-08C Completion Review.
- MPS-08C is an accepted source baseline at checkpoint `dcfe62695`; v29 removes that completed
  closure from the remaining DAG. The reusable iOS Journey adapter and non-destructive fixture
  changes at `94895fb53` and `02075d6bf` remain source baselines, while iOS runtime proof remains
  pending.
- v29 splits the prior MPS-11 into independent physical Android same-Station proof and downstream
  Android interoperability proof. This permits RC02 to run first without weakening RC05-RC07 or
  the final aggregate.
- MPS-09 through MPS-12 create the remaining exact-source Acceptance. Android unavailability parks
  MPS-11A and MPS-11B; it never converts source or iOS evidence into Android proof.
- Rollback is only source/deployment version rollback to the preceding checkpoint; no compatibility
  runtime or dual path remains live.

## Execution Preconditions

- Owner has confirmed the Mobile Social prototype and selected a consuming execution workspace.
- Station operations must run `make config` and `make env-check` before using authorized remote
  profiles. Prefer `fiveArm`; use `three`, then `two`, only when the preferred profile is actively
  claimed or fails the environment check.
- Android uses only a currently USB-authorized physical device. Record `adb devices -l`, serial,
  model, Android version, API level, ABI and `ro.kernel.qemu` before MPS-11A; no Android Emulator
  substitution is allowed.
- If no authorized physical Android is attached, MPS-11A and MPS-11B remain
  `BLOCKED/UNPROVEN`; MPS-09 and MPS-10 remain independently executable after the owner resumes
  iOS work.
