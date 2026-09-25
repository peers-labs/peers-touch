# W3-PROOF - Lifecycle Runtime And Navigation Proof

## Task Slice

```json
{
    "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W3-PROOF",
  "workstreamId": "W3",
  "title": "Lifecycle, runtime graph, navigation, and layout runtime proof",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "W3-proof",
  "journeyId": "MS-J02..MS-J07-runtime-proof",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/station/app/tests/access_gate_identity_migration_test.go",
    "apps/station/frame/touch/model/db/access_gate_identity_migration.go",
    "apps/station/frame/touch/model/db/automigrate.go",
    "apps/station/frame/touch/model/db/automigrate_identity_test.go",
    "apps/mobile/src/acceptance",
    "apps/mobile/package.json",
    "apps/mobile/src/main.tsx",
    "apps/mobile/src/app/lifecycle/MobileLifecycleKernel.ts",
    "apps/mobile/src/runtimes/nativeLifecycleBridge.ts",
    "apps/mobile/src/runtimes/nativeLifecycleBridge.test.ts",
    "apps/mobile/src/runtimes/mobileNativeEventBridge.ts",
    "apps/mobile/src/runtimes/mobileNativeEventBridge.test.ts",
    "apps/mobile/src/runtimes/socialProjectionRuntime.test.ts",
    "apps/mobile/src/runtimes/runtimeRegistry.ts",
    "apps/mobile/src/runtimes/runtimeRegistry.test.ts",
    "apps/mobile/src/styles.css",
    "apps/mobile/src-tauri/Cargo.lock",
    "apps/mobile/src-tauri/capabilities/default.json",
    "apps/mobile/src-tauri/src/commands",
    "apps/mobile/src-tauri/src/runtime/oauth",
    "apps/mobile/src-tauri/plugins/platform-permissions",
    "pnpm-lock.yaml",
    "tooling/acceptance/environments/mobile-native.yaml",
    "tooling/acceptance/gates/mobile",
    "tooling/acceptance/environments/mobile-simulator.yaml",
    "tooling/acceptance/environments/mobile-station-lifecycle-simulator.yaml",
    "tooling/acceptance/provisioners",
    "packages/prototypes/mobile/chat/src/mobilePrototype.css"
  ],
  "readSet": ["apps/mobile", "apps/station", "docs/architecture/frontend-runtime", "docs/architecture/mobile", "docs/client/mobile"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 9600, "cleanupSeconds": 240},
  "checks": [
    {"id": "mobile-lifecycle-proof-structure", "command": "python3 tooling/scripts/acceptance-validate.py --domain mobile", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "mobile-lifecycle-proof-contract", "command": "pnpm --dir apps/mobile exec vitest run src/acceptance/registry.test.ts && python3 -m unittest tooling.acceptance.gates.mobile.simulator_e2e_test tooling.acceptance.gates.mobile.simulator_lifecycle_e2e_test tooling.acceptance.gates.mobile.simulator_station_lifecycle_e2e_test && (cd apps/station/frame && go test ./touch/model/db) && (cd apps/station/app && go test ./tests -run '^TestAccessGate.*Migration')", "verificationClass": "SOURCE_CHECK"},
    {"id": "mobile-lifecycle-runtime", "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item mobile-shell-w3-proof --gate mobile-simulator-station-lifecycle-e2e", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "mobile-lifecycle-contract", "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-contract-static", "verificationClass": "ACCEPTANCE_PROOF"},
    {"id": "mobile-simulator-runtime-lifecycle", "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-runtime-lifecycle-e2e", "verificationClass": "ACCEPTANCE_PROOF"},
    {"id": "mobile-simulator-station-lifecycle", "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-station-lifecycle-e2e", "verificationClass": "ACCEPTANCE_PROOF"},
    {"id": "mobile-ios-layout-accessibility", "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-ios-simulator-layout-accessibility-e2e", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["Required dual-iOS Simulator runtime and Station lifecycle evidence is source-bound and clean", "Pinned layout/accessibility cells pass", "Focus, no-leak, takeover-revocation, and secure-store failure behavior pass in their required simulator scenarios"],
  "failureBehavior": ["Missing required iOS Simulator or Station resources remain BLOCKED", "Optional Android or physical diagnostics cannot replace required iOS Simulator evidence", "A Gate/doneWhen semantic mismatch returns DESIGN_AMENDMENT_REQUIRED"],
  "updatedAt": "2026-09-21T00:00:00Z",
  "durableEvidence": [
    {"verificationClass": "ACCEPTANCE_PROOF", "result": "PASS", "ref": "acceptance://mobile-contract-static/20260919T112614584868Z-40db60f7ab77989a5760426d92c7e30a"},
    {"verificationClass": "FUNCTIONAL_CHECK", "result": "PASS", "ref": "acceptance://mobile-simulator-station-lifecycle-e2e/20260911T035616890352Z-60057e97ce9dd6c0cd61fe00a972859c"},
    {"verificationClass": "ACCEPTANCE_PROOF", "result": "PASS", "ref": "acceptance://mobile-simulator-station-lifecycle-e2e/20260911T035616890352Z-60057e97ce9dd6c0cd61fe00a972859c"},
    {"verificationClass": "ACCEPTANCE_PROOF", "result": "PASS", "ref": "acceptance://mobile-simulator-runtime-lifecycle-e2e/20260919T113311359546Z-221ed5ae6e252f4b695f56f5e9ae438a"},
    {"verificationClass": "ACCEPTANCE_PROOF", "result": "PASS", "ref": "acceptance://mobile-ios-simulator-layout-accessibility-e2e/20260919T113119567649Z-9c16b179e4edb57cc3cd0a6019d3b0a9"},
    {"verificationClass": "ACCEPTANCE_PROOF", "result": "BLOCKED", "ref": "docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation/archive/legacy-plan.md#L3041"}
  ]
}
```

## Objective

Prove the W3 source closure on declared simulator Mobile cells.

## Current Snapshot

- Historical exact-source dual-platform runtime lifecycle evidence passes at
  `acceptance://mobile-simulator-runtime-lifecycle-e2e/20260919T113311359546Z-221ed5ae6e252f4b695f56f5e9ae438a`.
- Exact-source iPhone SE and iPhone 15 Pro Max layout/accessibility evidence
  passes at
  `acceptance://mobile-ios-simulator-layout-accessibility-e2e/20260919T113119567649Z-9c16b179e4edb57cc3cd0a6019d3b0a9`.
- The app-installed, generation-fenced native event bridge now survives
  runtime graph replacement and only releases listeners on `app-unmount`.
- Debug session `mobile-lifecycle-restart-deadlock` is closed: its
  instrumentation, Debug Server, record, log, and environment file were
  removed after the exact-source post-fix pass.
- `mobile-contract-static` passes at
  `acceptance://mobile-contract-static/20260919T112614584868Z-40db60f7ab77989a5760426d92c7e30a`.
- Current-source Station lifecycle proof has two disposable deployment
  definitions available, but the `mobile-station-lifecycle-alice` destructive
  reset still requires an authorized `MOBILE_ACCEPTANCE_RESET=1` scope.
- The accepted repair is an Acceptance-build-only native fault control consumed
  through the production logout/purge and lifecycle transition owners. Release
  builds must not expose the control.
- MS-D26 requires two isolated iOS Simulator clients where takeover or
  independent-session behavior is asserted. Android and physical execution are
  optional diagnostics and cannot replace the required iOS evidence.
