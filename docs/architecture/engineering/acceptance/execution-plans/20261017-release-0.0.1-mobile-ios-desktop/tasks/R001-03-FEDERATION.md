# R001-03-FEDERATION: Prove The Two-Station Federation Lifecycle

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "release-0.0.1-mobile-ios-desktop-acceptance-20261017",
  "taskId": "R001-03-FEDERATION",
  "workstreamId": "R001-RELEASE",
  "title": "Create, join, use, leave, rejoin and archive one real Federation across four and fiveArm",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "release-federation",
  "journeyId": "R001-J02",
  "runtimeClass": "service",
  "writeSet": [
    "tooling/acceptance/features/federation-full-lifecycle.yaml",
    "tooling/acceptance/capabilities/federation.yaml",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/registry.yaml",
    "tooling/acceptance/gates/federation",
    "tooling/acceptance/environments",
    "apps/station/app/subserver/federation",
    "apps/station/app/subserver/dashboard/infrastructure/oss_repo.go",
    "apps/station/app/subserver/dashboard/infrastructure/oss_repo_test.go",
    "apps/station/frame/core/federation",
    "apps/station/frame/core/plugin/native/subserver/bootstrap",
    "apps/station/frame/touch/model/peer",
    "model/domain/peer/station_identity.proto",
    "apps/desktop/src-tauri/src/acceptance/federation_fixture.rs",
    "apps/desktop/src-tauri/src/application/auth/service.rs",
    "apps/desktop/src-tauri/src/application/applets/mod.rs",
    "apps/desktop/src-tauri/src/application/profile/mod.rs",
    "apps/desktop/src-tauri/src/application/provider/station_api.rs",
    "apps/desktop/src-tauri/src/application/skills_market/mod.rs",
    "apps/desktop/src-tauri/src/application/station_runtime/client.rs",
    "apps/desktop/src-tauri/src/interface/tauri_commands/notification.rs",
    "apps/desktop/src-tauri/src/secure_content/adapter.rs",
    "apps/desktop/src/acceptance/moments/harness.ts",
    "apps/desktop/src/components/settings/FederationTab.tsx",
    "apps/desktop/src/components/chat/FindPeopleModal.tsx",
    "apps/desktop/src/store/federation.ts",
    "apps/mobile/src/pages/ContactsPage.tsx",
    "apps/mobile/src/pages/settings",
    "packages/locales",
    "docs/knowledge"
  ],
  "readSet": [
    "docs/architecture/domains/federation",
    "docs/architecture/platform/station/access",
    "tooling/acceptance/features/desktop-federation-surfaces.yaml",
    "tooling/acceptance/features/station-access-federation-boundary.yaml",
    "tooling/acceptance/environments/cross-station-social-native.yaml"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 10800,
    "cleanupSeconds": 900
  },
  "checks": [
    {
      "id": "release-federation-source",
      "command": "./model/build.sh && cd apps/station && go test ./app/subserver/federation/... ./frame/core/federation/... ./frame/core/plugin/native/subserver/bootstrap/... ./frame/touch/... && cd ../.. && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --features acceptance-webdriver && pnpm --dir apps/desktop run check && pnpm --dir apps/mobile run check && PATH=\"$PWD/.local/acceptance/python-venv/bin:$PATH\" python3 -m unittest tooling.acceptance.gates.federation.two_station_lifecycle_e2e_test tooling.acceptance.tests.test_provisioning_model tooling.acceptance.tests.test_provisioning_owners && PT_ACCEPTANCE_ARTIFACT_ROOT=/tmp/peers-touch-acceptance-release-0.0.1 make acceptance-validate DOMAIN=federation",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "release-federation-context-functional",
      "command": "make profile PROFILE=four && PATH=\"$PWD/.local/acceptance/python-venv/bin:$PATH\" PT_ACCEPTANCE_ARTIFACT_ROOT=/tmp/peers-touch-acceptance-release-0.0.1 python3 tooling/scripts/acceptance-run.py --runtime-cell desktop-macos-native --gate station-access-federation-boundary-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "release-federation-lifecycle-functional",
      "command": "make profile PROFILE=four && SOCIAL_CROSS_STATION_ACCEPTANCE_RESET=1 PT_ACCEPTANCE_ARTIFACT_ROOT=/tmp/peers-touch-acceptance-release-0.0.1 python3 tooling/scripts/acceptance-run.py --runtime-cell desktop-macos-native --station-profile station-four=four --station-profile station-five-arm=fiveArm --gate federation-two-station-lifecycle-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "release-federation-proof",
      "command": "PT_ACCEPTANCE_ARTIFACT_ROOT=/tmp/peers-touch-acceptance-release-0.0.1 python3 tooling/scripts/acceptance-run.py --gate station-federation-unit && make profile PROFILE=four && PATH=\"$PWD/.local/acceptance/python-venv/bin:$PATH\" PT_ACCEPTANCE_ARTIFACT_ROOT=/tmp/peers-touch-acceptance-release-0.0.1 python3 tooling/scripts/acceptance-run.py --runtime-cell desktop-macos-native --gate station-access-federation-boundary-e2e && SOCIAL_CROSS_STATION_ACCEPTANCE_RESET=1 PT_ACCEPTANCE_ARTIFACT_ROOT=/tmp/peers-touch-acceptance-release-0.0.1 python3 tooling/scripts/acceptance-run.py --runtime-cell desktop-macos-native --station-profile station-four=four --station-profile station-five-arm=fiveArm --gate federation-two-station-lifecycle-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "release-federation-lifecycle-functional",
    "scenarioIds": [
      "create-join-context",
      "leave-context-removal",
      "rejoin-restart-context",
      "archive-context-removal"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 3,
    "minWarmReuseRate": 0.75,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": true
  },
  "doneWhen": [
    "profile four creates one Federation and profile fiveArm joins through the sequencer proposal and canonical ledger path",
    "both Stations converge Federation ID, member role, sequencer and ledger head",
    "both Native Desktop clients render the same explicit active Federation context without exposing governance controls",
    "duplicate join is idempotent and invalid identity or endpoint input fails closed",
    "the non-owner leaves through the sequencer, the left context disappears, and a later rejoin extends rather than replaces local ledger history",
    "Native process restart restores the same active Federation context",
    "the sequencer cannot leave without handover and only the creator on the sequencer Station can archive",
    "archive converges to both Stations and removes the ordinary-client active context",
    "one exact-source Gate emits Native UI evidence and deterministic cleanup"
  ],
  "failureBehavior": [
    "do not use Relay reachability, a client cache or notification event as Federation truth",
    "do not restore ordinary-client create, join, leave, archive or member-administration controls",
    "do not preserve historical profile addresses, friend-chat routes or compatibility parsing",
    "a lifecycle defect is fixed at Federation governance, ledger sync or client projection ownership",
    "visual polish and wording observations that do not block the lifecycle are deferred to R001-07"
  ],
  "updatedAt": "2026-10-16T21:00:00.000Z"
}
```

## Current Snapshot

Stable obligation: close one real two-Station Federation lifecycle from create
through authoritative leave, rejoin, archive and cleanup.

## Closure

This Task proves Station-owned governance and ordinary-client context
consumption. Chat and Moments payload behavior remain separate.
