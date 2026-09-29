# SAL-OAUTH-01: Restore Desktop OAuth Bootstrap

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SAL-OAUTH-20260929",
  "taskId": "SAL-OAUTH-01",
  "workstreamId": "SAL-OAUTH-W01",
  "title": "Allow native OAuth loopback startup before actor authentication",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "sal-desktop-oauth-preauth-fix",
  "journeyId": "station-access-desktop-oauth-preauth",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src-tauri/src/application/oauth2/mod.rs",
    "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
    "apps/desktop/src-tauri/src/interface/tauri_commands/oauth2.rs",
    "tooling/acceptance/capabilities/station-access.yaml",
    "tooling/acceptance/environments/station-access-desktop-oauth-native.yaml",
    "tooling/acceptance/features/station-access-authentication.yaml",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/gates/station_access",
    "tooling/acceptance/provisioners/__init__.py",
    "tooling/acceptance/provisioners/station_access_desktop_oauth_native.py",
    "tooling/acceptance/registry.yaml"
  ],
  "readSet": [
    "docs/architecture/station-access-lifecycle/experience-contract.md",
    "docs/architecture/station-access-lifecycle/product-state-model.md",
    "docs/architecture/station-access-lifecycle/design.md",
    "docs/architecture/station-access-lifecycle/decisions.md",
    "docs/client/desktop/identity-lifecycle.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "desktop-oauth-rust-regression",
      "command": "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --bin peers-touch-desktop loopback",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "station-access-domain-structure",
      "command": "make acceptance-validate DOMAIN=station-access",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "station-access-desktop-oauth-layout-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-access-desktop-oauth-layout-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "desktop-dev-launch",
      "command": "make desktop",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "station-access-desktop-oauth-native-e2e",
      "command": "PT_ACCEPTANCE_RUNTIME_CELL=desktop-macos-native python3 tooling/scripts/acceptance-run.py --gate station-access-desktop-oauth-native-e2e --runtime-cell desktop-macos-native",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "desktop-check",
      "command": "python3 tooling/scripts/acceptance-run.py --gate desktop-check",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "secret-scan",
      "command": "gitleaks git --no-banner --log-opts 6aeb1bfc0c9031498d51990280918ff43d1ac399..HEAD",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "Unauthenticated native Desktop GitHub and Google starts return authorization URLs and loopback session IDs",
    "Authenticated connector starts retain canonical actor ownership at the application boundary",
    "The native proof is source-bound and cleanup completes"
  ],
  "failureBehavior": [
    "Do not restore the authenticated-session guard on login bootstrap",
    "Do not treat the browser mock layout Gate as OAuth functional proof",
    "Do not weaken connector owner validation or add a fallback login path"
  ],
  "updatedAt": "2026-09-29T02:30:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: in_progress.
- Root cause: Tauri and HTTP Gateway require an actor before starting the OAuth
  loopback listener, although the login page has no actor yet.
- Next boundary: source checkpoint, exact-source native Gate, then completion
  evidence and ordinary push.
