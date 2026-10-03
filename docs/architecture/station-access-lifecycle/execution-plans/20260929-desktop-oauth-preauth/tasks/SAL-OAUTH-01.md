# SAL-OAUTH-01: Restore Desktop OAuth Bootstrap

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SAL-OAUTH-20260929",
  "taskId": "SAL-OAUTH-01",
  "workstreamId": "SAL-OAUTH-W01",
  "title": "Restore OAuth bootstrap with fixed-size inline progress",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "sal-desktop-oauth-preauth-fix",
  "journeyId": "station-access-desktop-oauth-preauth",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/station/frame/touch/actor_handler.go",
    "apps/station/frame/touch/actor_handler_test.go",
    "apps/station/frame/touch/oauth_handler.go",
    "apps/station/frame/touch/auth/oauth_bridge.go",
    "apps/station/frame/touch/auth/oauth_bridge_test.go",
    "apps/desktop/src-tauri/src/application/auth/service.rs",
    "apps/desktop/src-tauri/src/application/oauth2/mod.rs",
    "apps/desktop/src-tauri/src/application/profile/mod.rs",
    "apps/desktop/src-tauri/src/infrastructure/auth_identity/mod.rs",
    "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
    "apps/desktop/src-tauri/src/interface/tauri_commands/oauth2.rs",
    "apps/desktop/src-tauri/src/main.rs",
    "apps/desktop/src/acceptance/station_access/harness.ts",
    "apps/desktop/src/components/chat/FindPeopleModal.tsx",
    "apps/desktop/src/components/chat/findPeopleIdentity.ts",
    "apps/desktop/src/components/chat/findPeopleIdentity.test.ts",
    "apps/desktop/src/components/settings/AccountTab.tsx",
    "apps/desktop/src/components/settings/accountIdentityPresentation.ts",
    "apps/desktop/src/components/settings/accountIdentityPresentation.test.ts",
    "apps/desktop/src/pages/login",
    "apps/desktop/src/services/desktop_api.ts",
    "apps/desktop/src/store/oauth2.ts",
    "apps/desktop/src/index.css",
    "apps/desktop/index.html",
    "apps/desktop/vite.config.ts",
    "packages/locales/en/auth.json",
    "packages/locales/en/chat.json",
    "packages/locales/en/oauth.json",
    "packages/locales/en/provider.json",
    "packages/locales/zh-CN/auth.json",
    "packages/locales/zh-CN/chat.json",
    "packages/locales/zh-CN/oauth.json",
    "packages/locales/zh-CN/provider.json",
    "packages/prototypes/desktop/shell",
    "docs/client/common/ui-identity/modules/auth/desktop.md",
    "docs/architecture/desktop/prototype/README.md",
    "tooling/devctl/desktop.mjs",
    "tooling/devctl/test/desktop.test.mjs",
    "docs/knowledge/invariants/desktop-vite-entry-readiness.md",
    "docs/knowledge/README.md",
    "tooling/acceptance/capabilities/station-access.yaml",
    "tooling/acceptance/environments/station-access-desktop-oauth-native.yaml",
    "tooling/acceptance/features/station-access-authentication.yaml",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/gates/station_access",
    "tooling/acceptance/provisioners/__init__.py",
    "tooling/acceptance/provisioners/station_access_desktop_oauth_native.py",
    "tooling/acceptance/registry.yaml",
    "tooling/acceptance/core/launch_context.py", "tooling/acceptance/core/_gate_bootstrap.py", "tooling/acceptance/tests/test_launch_context.py",
    "tooling/acceptance/requirements.txt", "tooling/scripts/acceptance-gap-detect.py", "tooling/scripts/acceptance-gap-detect-test.py", "tooling/skills/pt-acceptance-gap-detector"
  ],
  "readSet": [
    "docs/architecture/station-access-lifecycle/experience-contract.md",
    "docs/architecture/station-access-lifecycle/product-state-model.md",
    "docs/architecture/station-access-lifecycle/design.md",
    "docs/architecture/station-access-lifecycle/decisions.md",
    "docs/client/desktop/identity-lifecycle.md",
    "apps/desktop/src/store/accountIdentity.ts",
    "docs/client/common/ui-identity/README.md",
    "docs/client/common/ui-identity/foundations.md",
    "docs/client/common/ui-identity/tokens.md",
    "docs/client/common/ui-identity/layout.md",
    "docs/client/common/ui-identity/components.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "station-oauth-route-regression",
      "command": "go test ./apps/station/frame/touch ./apps/station/frame/touch/auth -run 'Test(GetActorHandlersRegistersOAuthBridge|OAuthBridgeRequestAcceptsProtobuf|GenerateOAuthPasswordPassesActorValidation|OAuthProfileBootstrap)' -count=1",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "desktop-oauth-rust-regression",
      "command": "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --bin peers-touch-desktop loopback",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "desktop-oauth-identity-projection-regression",
      "command": "pnpm --dir apps/desktop exec vitest run src/components/settings/accountIdentityPresentation.test.ts src/components/chat/findPeopleIdentity.test.ts && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --bin peers-touch-desktop application::",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "desktop-oauth-gate-regression",
      "command": "python3 -m unittest tooling.acceptance.gates.station_access.desktop_oauth_native_e2e_test",
      "verificationClass": "STRUCTURAL_CHECK"
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
      "id": "desktop-vite-readiness",
      "command": "node --test tooling/devctl/test/desktop.test.mjs",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "desktop-auth-prototype-build",
      "command": "pnpm --dir packages/prototypes/desktop/shell build",
      "verificationClass": "UX_REVIEW"
    },
    {
      "id": "machine-dev-registry-self",
      "command": "python3 tooling/scripts/acceptance-run.py --gate machine-dev-registry-self",
      "verificationClass": "STRUCTURAL_CHECK"
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
    "Station exposes the existing signed OAuth bridge as POST /actor/oauth-bridge",
    "OAuth callback success persists a non-empty Station session and restores an authenticated Desktop identity",
    "Station bridge errors produce a failed callback state rather than a false completed state",
    "Authenticated connector starts retain canonical actor ownership at the application boundary",
    "OAuth opening, waiting, cancellation, initialization, success, and failure/retry remain inside the original fixed-size provider action",
    "The auth card and provider action keep identical geometry across OAuth states with no detached result panel",
    "The canonical Desktop prototype exposes the same inline OAuth state model",
    "The native proof is source-bound and cleanup completes",
    "OAuth avatar bootstrap produces one Station-owned avatar across shell and Account without overwriting an existing Station avatar",
    "Account shows the concrete sign-in provider and canonical PTID",
    "Find People distinguishes Federation and Station scopes by text and tooltip even when both names are local"
  ],
  "failureBehavior": [
    "Do not restore the authenticated-session guard on login bootstrap",
    "Do not report a successful OAuth callback before Station session creation succeeds",
    "Do not treat the browser mock layout Gate as OAuth functional proof",
    "Do not weaken connector owner validation or add a fallback login path",
    "Do not resize the auth card or provider action when OAuth state changes",
    "Do not reintroduce a detached OAuth progress or recovery panel",
    "Do not make Desktop local account metadata a competing public-profile source",
    "Do not overwrite an existing user-managed Station avatar during OAuth login"
  ],
  "updatedAt": "2026-09-29T15:31:00.000Z",
  "durableEvidence": [{"verificationClass":"SOURCE_CHECK","result":"PASS","ref":"command://python-unittest/desktop-oauth-layout-evidence-trust/PASS@current-source"},{"verificationClass":"FUNCTIONAL_CHECK","result":"PASS","ref":"evidence://station-access-desktop-oauth-layout-e2e/latest@current-source"},{"verificationClass":"STRUCTURAL_CHECK","result":"PASS","ref":"evidence://desktop-check/latest@current-source"},{"verificationClass":"STRUCTURAL_CHECK","result":"PASS","ref":"evidence://machine-dev-registry-self/latest@current-source"},{"verificationClass":"ACCEPTANCE_PROOF","result":"PASS","ref":"evidence://station-access-desktop-oauth-native-e2e/latest@current-source"},{"verificationClass":"STRUCTURAL_CHECK","result":"PASS","ref":"evidence://acceptance-gap-detect/latest@current-source#changedPaths"},{"verificationClass":"STRUCTURAL_CHECK","result":"PASS","ref":"evidence://quality-evidence/latest@current-source"}]
}
```

## Current Snapshot

- State: in_progress.
- Root cause: Tauri and HTTP Gateway require an actor before starting the OAuth
  loopback listener, although the login page has no actor yet.
- Runtime amendment: normal `make desktop` must wait for a dependency canary
  and the transformed module graph, then require the WebView's React mount
  signal instead of trusting only ports and HTTP probes.
- Product amendment: OAuth progress and recovery move into the fixed-size
  provider action; the canonical Desktop prototype must match.
- Runtime defect amendment: register the existing Station OAuth bridge route,
  propagate bridge failures through the Desktop loopback state, and prove the
  callback restores an authenticated identity.
- Product correction implemented: Station Profile owns the OAuth avatar,
  Desktop preserves provider and PTID, and search scopes expose their type.
- Current-source remediation covers focused regression, layout, Desktop checks, machine registry, native OAuth, explicit Session/run Gap Detector inputs, complete changed-file inventory, and quality evidence; the layout Gate trust defect is fixed without weakening checks.
- Review state: pending a fresh independent Completion Review; Task and Plan remain open until that review returns a current PASS receipt.
