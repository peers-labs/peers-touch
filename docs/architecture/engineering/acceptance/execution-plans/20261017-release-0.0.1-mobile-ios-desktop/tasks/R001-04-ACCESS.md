# R001-04-ACCESS: Prove Login, Session, Shell And Settings

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "release-0.0.1-mobile-ios-desktop-acceptance-20261017",
  "taskId": "R001-04-ACCESS",
  "workstreamId": "R001-RELEASE",
  "title": "Prove Desktop and iOS entry, session, shell, settings and recovery journeys",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "release-access-shell",
  "journeyId": "R001-J03",
  "runtimeClass": "service",
  "writeSet": [
    "tooling/acceptance/gates/station_access",
    "tooling/acceptance/gates/mobile",
    "tooling/acceptance/gates/desktop",
    "tooling/acceptance/environments",
    "tooling/acceptance/provisioners/mobile_simulator.py",
    "tooling/acceptance/tests/test_mobile_simulator_provisioner.py",
    "apps/desktop/src/pages/login",
    "apps/desktop/src/components/common/StationPicker.tsx",
    "apps/desktop/src/components/settings",
    "apps/desktop/src/kernel",
    "apps/desktop/src/runtimes",
    "apps/desktop/src-tauri/src/application",
    "apps/mobile/src/features/auth",
    "apps/mobile/src/features/station",
    "apps/mobile/src/components",
    "apps/mobile/src/pages/settings",
    "apps/mobile/src/runtimes",
    "apps/mobile/src-tauri/src/commands",
    "apps/mobile/src-tauri/src/messaging",
    "apps/mobile/src-tauri/src/runtime",
    "packages/locales",
    "docs/knowledge"
  ],
  "readSet": [
    "docs/architecture/platform/station/access",
    "docs/architecture/platform/client/mobile",
    "docs/client/desktop",
    "docs/client/mobile",
    "tooling/acceptance/gates/mobile/whole_product_surface_inventory.json"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 14400,
    "cleanupSeconds": 900
  },
  "checks": [
    {
      "id": "release-access-source",
      "command": "pnpm --dir apps/desktop run check && pnpm --dir apps/mobile run check && python3 -c 'from tooling.acceptance.gates.station_access.capability_contract import validate_station_access_capability_contract as validate; validate()' && python3 -c 'from tooling.acceptance.gates.mobile.contract_static import MobileContractStaticGate; MobileContractStaticGate().run()' && python3 -c 'from tooling.acceptance.gates.mobile.identity_contract import validate_identity_contract as validate; validate()'",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "station-access-native-proof",
      "command": "PATH=\"$PWD/.local/acceptance/python-venv/bin:$PATH\" CHAT_ACCEPTANCE_RESET=1 CHAT_ACCEPTANCE_RESET_ENVIRONMENTS=station-four PT_ACCEPTANCE_ARTIFACT_ROOT=/tmp/peers-touch-acceptance-release-0.0.1 PT_ACCEPTANCE_DESKTOP_INPUT_ISOLATION=isolated-gui-session node tooling/scripts/local-dev/machine-dev.mjs lease --resource-kind station.reset --resource-id station-access-reset-actors --reset-scope station-access-reset-actors --budget-seconds 6000 -- python3 tooling/scripts/acceptance-run.py --runtime-cell desktop-macos-native --station-profile station=four --gate station-access-auth-e2e --gate station-access-scope-isolation-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "desktop-access-proof",
      "command": "PATH=\"$PWD/.local/acceptance/python-venv/bin:$PATH\" PT_ACCEPTANCE_ARTIFACT_ROOT=/tmp/peers-touch-acceptance-release-0.0.1 PT_ACCEPTANCE_DESKTOP_INPUT_ISOLATION=isolated-gui-session python3 tooling/scripts/acceptance-run.py --runtime-cell desktop-macos-native --gate station-access-desktop-oauth-native-e2e --gate desktop-shell-tray-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "mobile-unbound-access-proof",
      "command": "PATH=\"$PWD/.local/acceptance/python-venv/bin:$PATH\" PT_ACCEPTANCE_ARTIFACT_ROOT=/tmp/peers-touch-acceptance-release-0.0.1 python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-access-e2e --gate mobile-simulator-runtime-lifecycle-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "mobile-station-access-proof",
      "command": "PATH=\"$PWD/.local/acceptance/python-venv/bin:$PATH\" CHAT_ACCEPTANCE_RESET=1 CHAT_ACCEPTANCE_RESET_ENVIRONMENTS=station-four,station-five-arm PT_ACCEPTANCE_ARTIFACT_ROOT=/tmp/peers-touch-acceptance-release-0.0.1 node tooling/scripts/local-dev/machine-dev.mjs lease --resource-kind station.reset --resource-id mobile-station-lifecycle-alice --reset-scope mobile-station-lifecycle-alice --budget-seconds 6000 -- python3 tooling/scripts/acceptance-run.py --station-profile station-primary=four --station-profile station-secondary=fiveArm --gate mobile-simulator-station-lifecycle-e2e --gate mobile-simulator-settings-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "session-class-suite-functional",
      "command": "PATH=\"$PWD/.local/acceptance/python-venv/bin:$PATH\" CHAT_ACCEPTANCE_RESET=1 CHAT_ACCEPTANCE_RESET_ENVIRONMENTS=station-four,station-five-arm PT_ACCEPTANCE_ARTIFACT_ROOT=/tmp/peers-touch-acceptance-release-0.0.1 PT_ACCEPTANCE_DESKTOP_INPUT_ISOLATION=isolated-gui-session node tooling/scripts/local-dev/machine-dev.mjs lease --resource-kind station.reset --resource-id chat-mixed-native-actors --reset-scope chat-mixed-native-actors --budget-seconds 6000 -- python3 tooling/scripts/acceptance-run.py --runtime-cell desktop-macos-native --station-profile station-primary=four --station-profile station-secondary=fiveArm --gate station-access-session-class-suite-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "session-class-suite-functional",
    "scenarioIds": [
      "same-station-chat",
      "cross-class-coexistence",
      "desktop-takeover",
      "mobile-takeover"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 5,
    "minWarmReuseRate": 0.75,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": true
  },
  "doneWhen": [
    "Desktop and iOS verify Station identity before login and reach the authenticated shell through the canonical Access Gate",
    "the release candidate proves the supported login choices, invalid login, cancellation, pending, expiry and retry without a direct-login fallback",
    "valid Session restore, same-class takeover, cross-class coexistence, revocation, logout and Station switch preserve scope isolation",
    "Desktop close-to-tray and restore preserve the active user state without a second runtime owner",
    "iOS cold start, suspend, resume, WebView restart and route restoration preserve lifecycle generation and visible state",
    "Profile/account preferences converge while device-only preferences remain local; restart readback is correct",
    "all visible Settings sections have a reachable back path, truthful save/conflict/failure feedback and no redundant global save authority",
    "English and Chinese user-facing states expose no raw PTID, internal command ID, untranslated key or secret",
    "all test-created sessions, client storage, simulator state, processes and leases are released"
  ],
  "failureBehavior": [
    "credential, identity, actor, Station or generation mismatch fails closed and never enters the shell",
    "a hidden action, occluded primary control, unbounded loading state or unrecoverable settings failure is a release defect and is fixed now",
    "a merely suboptimal hierarchy, label, step count or visual treatment with a working path is recorded for R001-07 only",
    "live provider authorization is not fabricated; deterministic broker proof remains distinct from optional external-provider diagnostics"
  ],
  "updatedAt": "2026-10-17T11:45:11.000Z"
}
```

## Current Snapshot

Stable obligation: prove daily entry, identity, Session, shell and settings
behavior on macOS Desktop and iOS Simulator.

## Closure

This Task proves the release entry and daily account-management foundation. It
does not claim Chat or Moments payload convergence.
