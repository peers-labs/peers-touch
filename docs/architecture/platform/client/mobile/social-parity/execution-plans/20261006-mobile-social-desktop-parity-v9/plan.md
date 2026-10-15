# Mobile Social Desktop Parity

> **Plan ID**: MPS-20261006
> **Version ID**: MPS-20261006-v9
> **Created**: 2026-10-06T09:10:00.000Z

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "MPS-20261006",
  "versionId": "MPS-20261006-v9",
  "createdAt": "2026-10-06T09:10:00.000Z",
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/platform/client/mobile/social-parity/product-definition.md",
      "docs/architecture/platform/client/mobile/social-parity/experience-contract.md",
      "docs/architecture/platform/client/mobile/social-parity/product-state-model.md",
      "docs/architecture/platform/client/mobile/social-parity/acceptance-matrix.md",
      "docs/architecture/platform/client/mobile/social-parity/design.md",
      "docs/architecture/platform/client/mobile/social-parity/decisions.md",
      "docs/architecture/platform/client/mobile/social-parity/data-model.md",
      "docs/architecture/platform/client/mobile/social-parity/integration.md",
      "docs/architecture/platform/client/mobile/social-parity/module-layout.md"
    ],
    "decisions": [
      "MPS-D01",
      "MPS-D02",
      "MPS-D03",
      "MPS-D04",
      "MPS-D05",
      "MPS-D06",
      "MPS-D07",
      "MPS-D08",
      "MPS-D09",
      "MPS-D10",
      "MPS-D11",
      "MPS-D12"
    ]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix":"apps/mobile","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop","mode":"shared-read"},
      {"pathPrefix":"apps/station","mode":"shared-read"},
      {"pathPrefix":"docs/architecture/domains/social/core","mode":"shared-read"},
      {"pathPrefix":"docs/architecture/domains/social/core/README.md","mode":"exclusive-write"},
      {"pathPrefix":"docs/architecture/domains/social/core/acceptance-matrix.md","mode":"exclusive-write"},
      {"pathPrefix":"docs/architecture/domains/social/core/experience-contract.md","mode":"exclusive-write"},
      {"pathPrefix":"docs/architecture/domains/social/core/product-definition.md","mode":"exclusive-write"},
      {"pathPrefix":"docs/architecture/domains/social/core/product-state-model.md","mode":"exclusive-write"},
      {"pathPrefix":"docs/architecture/domains/social/cross-station","mode":"shared-read"},
      {"pathPrefix":"docs/architecture/engineering/architecture-governance/architecture-modules.json","mode":"exclusive-write"},
      {"pathPrefix":"docs/architecture/platform/client/mobile","mode":"shared-read"},
      {"pathPrefix":"docs/architecture/platform/client/mobile/README.md","mode":"exclusive-write"},
      {"pathPrefix":"docs/architecture/platform/client/mobile/social-parity/README.md","mode":"exclusive-write"},
      {"pathPrefix":"docs/architecture/platform/client/mobile/social-parity/acceptance-matrix.md","mode":"exclusive-write"},
      {"pathPrefix":"docs/architecture/platform/client/mobile/social-parity/integration.md","mode":"exclusive-write"},
      {"pathPrefix":"docs/architecture/platform/client/mobile/social-parity/module-layout.md","mode":"exclusive-write"},
      {"pathPrefix":"docs/architecture/shared/federation","mode":"shared-read"},
      {"pathPrefix":"docs/architecture/shared/security/secure-content","mode":"shared-read"},
      {"pathPrefix":"docs/client/common/ui-identity/frontend-component-tree-registry.md","mode":"exclusive-write"},
      {"pathPrefix":"docs/README.md","mode":"exclusive-write"},
      {"pathPrefix":"model/domain/social","mode":"shared-read"},
      {"pathPrefix":"packages/locales","mode":"exclusive-write"},
      {"pathPrefix":"tooling/acceptance","mode":"exclusive-write"}
    ],
    "nonGoals": [
      "Change Station Social authority, Audience semantics, Secure Content algorithms, or Federation transport ownership",
      "Add Browser Social, Mobile P2P, direct remote-Station calls, or a second Mobile Social stack",
      "Preserve Web bearer transport, three-Audience subsets, public/private fallback, dual writes, or parallel durable stores",
      "Claim Android or full Mobile parity from an Emulator, iOS-only evidence, static checks, or prototype screenshots",
      "Reset shared or production data, create environments, push, open a pull request, amend checkpoints, or rewrite history"
    ]
  },
  "tasks": [
    {"id":"MPS-01-SOCIAL-ADAPTER","workstreamId":"MPS-FOUNDATION","path":"tasks/MPS-01-SOCIAL-ADAPTER.md","dependsOn":[]},
    {"id":"MPS-02-HOME-EXPLORE","workstreamId":"MPS-EXPERIENCE","path":"tasks/MPS-02-HOME-EXPLORE.md","dependsOn":["MPS-01-SOCIAL-ADAPTER"]},
    {"id":"MPS-03-SEARCH-PROFILE","workstreamId":"MPS-EXPERIENCE","path":"tasks/MPS-03-SEARCH-PROFILE.md","dependsOn":["MPS-01-SOCIAL-ADAPTER"]},
    {"id":"MPS-04-CIRCLES","workstreamId":"MPS-EXPERIENCE","path":"tasks/MPS-04-CIRCLES.md","dependsOn":["MPS-01-SOCIAL-ADAPTER","MPS-03-SEARCH-PROFILE"]},
    {"id":"MPS-05-COMPOSER-PUBLISH","workstreamId":"MPS-EXPERIENCE","path":"tasks/MPS-05-COMPOSER-PUBLISH.md","dependsOn":["MPS-01-SOCIAL-ADAPTER","MPS-03-SEARCH-PROFILE","MPS-04-CIRCLES"]},
    {"id":"MPS-06-THREAD-MEDIA","workstreamId":"MPS-INTERACTION","path":"tasks/MPS-06-THREAD-MEDIA.md","dependsOn":["MPS-02-HOME-EXPLORE","MPS-05-COMPOSER-PUBLISH"]},
    {"id":"MPS-07-REACTION-CONVERGENCE","workstreamId":"MPS-INTERACTION","path":"tasks/MPS-07-REACTION-CONVERGENCE.md","dependsOn":["MPS-06-THREAD-MEDIA"]},
    {"id":"MPS-08A-RECOVERY","workstreamId":"MPS-TRUST","path":"tasks/MPS-08A-RECOVERY.md","dependsOn":["MPS-05-COMPOSER-PUBLISH","MPS-06-THREAD-MEDIA"]},
    {"id":"MPS-08B-REVOCATION","workstreamId":"MPS-TRUST","path":"tasks/MPS-08B-REVOCATION.md","dependsOn":["MPS-03-SEARCH-PROFILE","MPS-06-THREAD-MEDIA","MPS-07-REACTION-CONVERGENCE"]},
    {"id":"MPS-08C-LIFECYCLE","workstreamId":"MPS-TRUST","path":"tasks/MPS-08C-LIFECYCLE.md","dependsOn":["MPS-05-COMPOSER-PUBLISH","MPS-07-REACTION-CONVERGENCE","MPS-08A-RECOVERY","MPS-08B-REVOCATION"]},
    {"id":"MPS-09-IOS-ACCEPTANCE","workstreamId":"MPS-PROOF","path":"tasks/MPS-09-IOS-ACCEPTANCE.md","dependsOn":["MPS-02-HOME-EXPLORE","MPS-03-SEARCH-PROFILE","MPS-04-CIRCLES","MPS-05-COMPOSER-PUBLISH","MPS-06-THREAD-MEDIA","MPS-07-REACTION-CONVERGENCE","MPS-08A-RECOVERY","MPS-08B-REVOCATION","MPS-08C-LIFECYCLE"]},
    {"id":"MPS-10-CROSS-STATION-IOS","workstreamId":"MPS-PROOF","path":"tasks/MPS-10-CROSS-STATION-IOS.md","dependsOn":["MPS-09-IOS-ACCEPTANCE"]},
    {"id":"MPS-11-ANDROID-ACCEPTANCE","workstreamId":"MPS-PROOF","path":"tasks/MPS-11-ANDROID-ACCEPTANCE.md","dependsOn":["MPS-10-CROSS-STATION-IOS"]},
    {"id":"MPS-12-AGGREGATE","workstreamId":"MPS-DELIVERY","path":"tasks/MPS-12-AGGREGATE.md","dependsOn":["MPS-10-CROSS-STATION-IOS","MPS-11-ANDROID-ACCEPTANCE"]}
  ],
  "authorization": {
    "checkpoint": {"localCommit":"allowed","amend":"denied"},
    "delivery": {"push":"denied","pullRequest":"denied"},
    "runtime": {"deployProfiles":["four","fiveArm"],"destructiveResetScopes":[]},
    "history": {"rewrite":"denied"}
  }
}
```

## Acceptance Execution

```json
{"closures":{"mps-social-adapter":["mobile-social-facade-contract"],"mps-home-explore":["mobile-social-feed-native"],"mps-search-profile":["mobile-social-search-profile-native"],"mps-circles":["mobile-social-circles-native"],"mps-composer-publish":["mobile-social-audience-composer-native"],"mps-thread-media":["mobile-social-thread-media-native"],"mps-reaction-convergence":["mobile-social-interaction-convergence-native"],"mps-recovery":["mobile-social-recovery-native"],"mps-revocation":["mobile-social-revocation-native"],"mps-lifecycle":["mobile-social-lifecycle-native"],"mps-ios-acceptance":["mobile-social-ios-native"],"mps-cross-station-ios":["mobile-social-cross-platform"],"mps-android-acceptance":["mobile-social-android-native"],"mps-aggregate":["mobile-social-desktop-parity-aggregate"]},"completion":["mobile-social-facade-contract","mobile-social-feed-native","mobile-social-search-profile-native","mobile-social-circles-native","mobile-social-audience-composer-native","mobile-social-thread-media-native","mobile-social-interaction-convergence-native","mobile-social-recovery-native","mobile-social-revocation-native","mobile-social-lifecycle-native","mobile-social-ios-native","mobile-social-cross-platform","mobile-social-android-native","mobile-social-desktop-parity-aggregate"],"full":["architecture-module-governance","station-api-ownership","proto-build","mobile-native-build","mobile-social-facade-contract","mobile-social-feed-native","mobile-social-search-profile-native","mobile-social-circles-native","mobile-social-audience-composer-native","mobile-social-thread-media-native","mobile-social-interaction-convergence-native","mobile-social-recovery-native","mobile-social-revocation-native","mobile-social-lifecycle-native","mobile-social-ios-native","mobile-social-cross-platform","mobile-social-android-native","mobile-social-desktop-parity-aggregate"]}
```

## Goal

在不复制 Station Social、Secure Content 或 Federation authority 的前提下，让 Mobile
通过一个 Social facade 和一个 Rust adapter 完成 Desktop 当前全部 Social 用户结果，
并以 iOS、USB physical Android、Desktop 和两台 Station 的真实互操作证明语义对称。

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
| Recovery | J06 | D04, D11 | Bob2 historical recovery and key isolation |
| Revocation | J08 | D03-D05, D11 | delete/block invalidation and cache purge |
| Lifecycle | J09 | D02, D04, D05 | background, restart and scope teardown |
| Native proof | J01-J10 | D01, D07 | RC01-RC10 and PA01-PA19 with bounded claims |

## Acceptance Scenario Ownership

| Owner Task / Gate | Runtime cells | Exact scenario ownership |
|---|---|---|
| MPS-09 / `mobile-social-ios-native` | RC01 | iOS same-Station observations required by PA01-PA09, PA14-PA15, PA18-PA19 |
| MPS-10 / `mobile-social-cross-platform` | RC03, RC04, RC08, RC09, RC10 | Desktop/iOS directions, recovery, authorization, outage, replay and invalidation observations |
| MPS-11 / `mobile-social-android-native` | RC02, RC05, RC06, RC07 | physical Android same-Station and all Android interoperation observations |
| MPS-12 / `mobile-social-desktop-parity-aggregate` | RC01-RC10 | unique final oracle for PA01-PA19 and AG01-AG10; missing child remains UNPROVEN |

## Execution DAG

```text
MPS-01
  -> MPS-02
  -> MPS-03 -> MPS-04 -> MPS-05
       MPS-02 + MPS-05 -> MPS-06 -> MPS-07
       MPS-05 + MPS-06 -> MPS-08A
       MPS-03 + MPS-06 + MPS-07 -> MPS-08B
       MPS-05 + MPS-07 + MPS-08A + MPS-08B -> MPS-08C
       MPS-02..08C -> MPS-09 -> MPS-10 -> MPS-11 -> MPS-12
                                            \---------------> MPS-12
```

## Atomic Cutover

- MPS-01 moves authenticated public Social transport behind Rust and proves removal with
  `mps-adapter-old-path-removal`.
- MPS-04 lands Circle management without changing composer behavior. MPS-05 atomically activates all
  eight Audience classes with their public/private publish path and proves subset removal with
  `mps-audience-old-path-removal`.
- MPS-02 and MPS-06 replace page-owned public/private presentation with one composed projection,
  one inline thread, and one temporary media overlay. `mps-feed-old-owner-removal` and
  `mps-detail-old-path-removal` prove the old page owners and normal Detail branch are absent.
- MPS-07, MPS-08A, MPS-08B and MPS-08C independently close interaction convergence, recovery,
  revocation and lifecycle isolation without public fallback or a second durable owner.
- MPS-09 through MPS-12 create exact-source Acceptance. Android unavailability parks MPS-11 and
  therefore MPS-12; it never weakens the iOS-only claim boundary.
- Rollback is only source/deployment version rollback to the preceding checkpoint; no compatibility
  runtime or dual path remains live.

## Execution Preconditions

- Owner has confirmed the Mobile Social prototype and selected a consuming execution workspace.
- Station operations must run `make config` and `make env-check` before using authorized remote
  profiles `four` and `fiveArm`.
- Android uses only a currently USB-authorized physical device. Record `adb devices -l`, serial,
  model and Android version before MPS-11; no Android Emulator substitution is allowed.
- If no authorized physical Android is attached, MPS-11 is parked with RC02/RC05/RC06/RC07
  `BLOCKED/UNPROVEN`; MPS-09 and MPS-10 continue and may establish only iOS closure.
