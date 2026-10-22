# R001-02-RELAY: Prove Four, FiveArm And Relay Topology

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "release-0.0.1-mobile-ios-desktop-acceptance-20261017",
  "taskId": "R001-02-RELAY",
  "workstreamId": "R001-RELEASE",
  "title": "Prove exact-source dual-Station and Relay route continuity on Desktop and iOS",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "release-relay-topology",
  "journeyId": "R001-J01",
  "runtimeClass": "service",
  "writeSet": [
    "tooling/acceptance",
    "apps/station/frame/core/plugin/native",
    "apps/desktop/src-tauri/src/application/station_runtime",
    "apps/desktop/src-tauri/src/infrastructure/station_discovery.rs",
    "apps/desktop/src/components/common/StationPicker.tsx",
    "apps/mobile/src/acceptance",
    "apps/mobile/src-tauri/src/runtime",
    "apps/mobile/src/features/station",
    "apps/mobile/src/runtimes/accessRuntime.ts",
    "apps/mobile/src/runtimes/accessRuntime.test.ts",
    "apps/mobile/src/runtimes/stationRuntime.ts",
    "apps/mobile/src/services/mobileCommands.ts",
    "apps/mobile/tests",
    "packages/locales",
    "docs/knowledge"
  ],
  "readSet": [
    "docs/architecture/platform/runtime/node-connectivity",
    "docs/architecture/platform/station/access",
    "tooling/acceptance/environments/station-access-relay-role.yaml",
    "tooling/acceptance/environments/mobile-relay-simulator.yaml"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 14400,
    "cleanupSeconds": 900
  },
  "checks": [
    {
      "id": "release-relay-source",
      "command": "python3 -c 'from tooling.acceptance.gates.station_access.relay_role_security_contract import validate_relay_role_security_contract as validate; validate()' && python3 tooling/scripts/node-connectivity-journey.py --closure ncp-standard-stream --gate NCP-G01 && python3 tooling/scripts/node-connectivity-journey.py --closure ncp-standard-stream --gate NCP-G02 && python3 tooling/scripts/node-connectivity-journey.py --closure ncp-native-cut --gate NCP-G07 && python3 tooling/scripts/node-connectivity-journey.py --closure ncp-native-cut --gate NCP-G08 && git diff --check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "release-relay-desktop-proof",
      "command": "make profile PROFILE=one && PT_ACCEPTANCE_DESKTOP_INPUT_ISOLATION=isolated-gui-session python3 tooling/scripts/acceptance-run.py --runtime-cell desktop-macos-native --gate relay-role-security-contract --gate station-access-desktop-relay-native-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "release-relay-mobile-proof",
      "command": "PATH=\"$PWD/.local/acceptance/python-venv/bin:$PATH\" python3 tooling/scripts/acceptance-run.py --station-profile station-primary=four --station-profile station-secondary=fiveArm --service-profile relay=one --gate station-access-mobile-relay-native-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "release-relay-desktop-proof",
    "scenarioIds": [
      "desktop-direct-relay-continuity",
      "ios-direct-relay-continuity",
      "restart-route-restoration",
      "relay-failure-denial"
    ],
    "maxProvisioningRuns": 2,
    "maxClientLaunches": 4,
    "minWarmReuseRate": 0.5,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": true
  },
  "doneWhen": [
    "profile four attests station-four and profile fiveArm attests station-five-arm at the exact candidate commit",
    "one reviewed Linux/POSIX Relay exposes only its bounded transport role and has no Station business authority",
    "Desktop and iOS independently verify the same Station identity before using Direct or Relay routes",
    "explicit Direct-to-Relay and Relay-to-Direct switching preserves Actor, Session, lifecycle generation and business projections",
    "Desktop native-process restart and iOS WebView restart restore the persisted Relay route without a second Station registry entry",
    "wrong Relay identity, expired or revoked generation, substituted route and unavailable route fail before credentials or business traffic",
    "logs and evidence expose no Station Session credential or business plaintext to Relay",
    "every process, port, simulator, storage root and lease is cleaned or intentionally transferred to the next declared Task"
  ],
  "failureBehavior": [
    "do not weaken signed Station identity, inner TLS/SPKI, route attestation or Access Gate to make Relay pass",
    "a Relay reachability result never implies Federation membership",
    "a product failure is fixed at its owning transport or client layer and rerun from the earliest invalidated scenario",
    "non-blocking wording, hierarchy or route-label observations are recorded for R001-07 without UI redesign"
  ],
  "updatedAt": "2026-10-20T00:00:00.000Z"
}
```

## Current Snapshot

Stable obligation: prove four, fiveArm and one Relay as source-attested
transport resources before any cross-Station business claim.

## Closure

This Task proves transport and identity continuity only. Federation membership,
Chat and Moments remain unproven until their own receiver-visible Tasks.
