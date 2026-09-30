# Desktop OAuth Pre-Authentication Regression

> **Status**: active
> **Branch**: master
> **Workspace ID**: 872e6a11e6df33b5
> **Initial HEAD**: 6aeb1bfc0c9031498d51990280918ff43d1ac399

## Plan Package

```json
{
  "kind": "peers-touch-plan-package",
  "planId": "SAL-OAUTH-20260929",
  "status": "active",
  "binding": {
    "branch": "master",
    "workspaceId": "872e6a11e6df33b5",
    "initialHead": "6aeb1bfc0c9031498d51990280918ff43d1ac399"
  },
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/station-access-lifecycle/experience-contract.md",
      "docs/architecture/station-access-lifecycle/product-state-model.md",
      "docs/architecture/station-access-lifecycle/design.md",
      "docs/architecture/station-access-lifecycle/decisions.md",
      "docs/client/desktop/identity-lifecycle.md",
      "docs/client/common/ui-identity/modules/auth/desktop.md"
    ],
    "decisions": [
      "SAL-D01",
      "SAL-D03",
      "SAL-D06"
    ]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix":"apps/station/frame/touch/actor_handler.go","mode":"exclusive-write"},
      {"pathPrefix":"apps/station/frame/touch/actor_handler_test.go","mode":"exclusive-write"},
      {"pathPrefix":"apps/station/frame/touch/oauth_handler.go","mode":"exclusive-write"},
      {"pathPrefix":"apps/station/frame/touch/auth/oauth_bridge.go","mode":"exclusive-write"},
      {"pathPrefix":"apps/station/frame/touch/auth/oauth_bridge_test.go","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/src-tauri/src/application/auth/service.rs","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/src-tauri/src/application/oauth2/mod.rs","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/src-tauri/src/application/profile/mod.rs","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/src-tauri/src/infrastructure/auth_identity/mod.rs","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/src-tauri/src/interface/http_gateway/mod.rs","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/src-tauri/src/interface/tauri_commands/oauth2.rs","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/src-tauri/src/main.rs","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/src/acceptance/station_access/harness.ts","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/src/components/chat/FindPeopleModal.tsx","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/src/components/chat/findPeopleIdentity.ts","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/src/components/chat/findPeopleIdentity.test.ts","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/src/components/settings/AccountTab.tsx","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/src/components/settings/accountIdentityPresentation.ts","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/src/components/settings/accountIdentityPresentation.test.ts","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/src/pages/login","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/src/services/desktop_api.ts","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/src/store/oauth2.ts","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/src/index.css","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/index.html","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop/vite.config.ts","mode":"exclusive-write"},
      {"pathPrefix":"tooling/devctl/desktop.mjs","mode":"exclusive-write"},
      {"pathPrefix":"tooling/devctl/test/desktop.test.mjs","mode":"exclusive-write"},
      {"pathPrefix":"docs/knowledge/invariants/desktop-vite-entry-readiness.md","mode":"exclusive-write"},
      {"pathPrefix":"docs/knowledge/README.md","mode":"exclusive-write"},
      {"pathPrefix":"docs/client/common/ui-identity/modules/auth/desktop.md","mode":"exclusive-write"},
      {"pathPrefix":"docs/architecture/desktop/prototype/README.md","mode":"exclusive-write"},
      {"pathPrefix":"packages/prototypes/desktop/shell","mode":"exclusive-write"},
      {"pathPrefix":"packages/locales/en/auth.json","mode":"exclusive-write"},
      {"pathPrefix":"packages/locales/en/chat.json","mode":"exclusive-write"},
      {"pathPrefix":"packages/locales/en/oauth.json","mode":"exclusive-write"},
      {"pathPrefix":"packages/locales/en/provider.json","mode":"exclusive-write"},
      {"pathPrefix":"packages/locales/zh-CN/auth.json","mode":"exclusive-write"},
      {"pathPrefix":"packages/locales/zh-CN/chat.json","mode":"exclusive-write"},
      {"pathPrefix":"packages/locales/zh-CN/oauth.json","mode":"exclusive-write"},
      {"pathPrefix":"packages/locales/zh-CN/provider.json","mode":"exclusive-write"},
      {"pathPrefix":"docs/architecture/station-access-lifecycle/README.md","mode":"exclusive-write"},
      {"pathPrefix":"docs/architecture/station-access-lifecycle/execution-plans/20260929-desktop-oauth-preauth","mode":"exclusive-write"},
      {"pathPrefix":"tooling/acceptance/capabilities/station-access.yaml","mode":"exclusive-write"},
      {"pathPrefix":"tooling/acceptance/environments/station-access-desktop-oauth-native.yaml","mode":"exclusive-write"},
      {"pathPrefix":"tooling/acceptance/features/station-access-authentication.yaml","mode":"exclusive-write"},
      {"pathPrefix":"tooling/acceptance/gates.yaml","mode":"exclusive-write"},
      {"pathPrefix":"tooling/acceptance/gates/station_access","mode":"exclusive-write"},
      {"pathPrefix":"tooling/acceptance/provisioners/__init__.py","mode":"exclusive-write"},
      {"pathPrefix":"tooling/acceptance/provisioners/station_access_desktop_oauth_native.py","mode":"exclusive-write"},
      {"pathPrefix":"tooling/acceptance/registry.yaml","mode":"exclusive-write"}, {"pathPrefix":"tooling/acceptance/core/launch_context.py","mode":"exclusive-write"}, {"pathPrefix":"tooling/acceptance/core/_gate_bootstrap.py","mode":"exclusive-write"}, {"pathPrefix":"tooling/acceptance/tests/test_launch_context.py","mode":"exclusive-write"}, {"pathPrefix":"tooling/acceptance/requirements.txt","mode":"exclusive-write"}, {"pathPrefix":"tooling/scripts/acceptance-gap-detect.py","mode":"exclusive-write"}, {"pathPrefix":"tooling/scripts/acceptance-gap-detect-test.py","mode":"exclusive-write"}, {"pathPrefix":"tooling/skills/pt-acceptance-gap-detector","mode":"exclusive-write"},
      {"pathPrefix":"docs/architecture/station-access-lifecycle/experience-contract.md","mode":"shared-read"},
      {"pathPrefix":"docs/architecture/station-access-lifecycle/product-state-model.md","mode":"shared-read"},
      {"pathPrefix":"docs/architecture/station-access-lifecycle/design.md","mode":"shared-read"},
      {"pathPrefix":"docs/architecture/station-access-lifecycle/decisions.md","mode":"shared-read"},
      {"pathPrefix":"docs/client/desktop/identity-lifecycle.md","mode":"shared-read"},
      {"pathPrefix":"apps/desktop/src/store/accountIdentity.ts","mode":"shared-read"},
      {"pathPrefix":"docs/client/common/ui-identity/README.md","mode":"shared-read"},
      {"pathPrefix":"docs/client/common/ui-identity/foundations.md","mode":"shared-read"},
      {"pathPrefix":"docs/client/common/ui-identity/tokens.md","mode":"shared-read"},
      {"pathPrefix":"docs/client/common/ui-identity/layout.md","mode":"shared-read"},
      {"pathPrefix":"docs/client/common/ui-identity/components.md","mode":"shared-read"}
    ],
    "nonGoals": [
      "Complete an external GitHub or Google authorization grant with a real user account",
      "Change provider credentials, callback endpoints, or the Station OAuth bridge wire schema",
      "Change Mobile OAuth behavior",
      "Change the Desktop auth card or OAuth action dimensions",
      "Use browser mocks as native OAuth functional proof"
    ]
  },
  "tasks": [
    {
      "id": "SAL-OAUTH-01",
      "workstreamId": "SAL-OAUTH-W01",
      "path": "tasks/SAL-OAUTH-01.md",
      "dependsOn": [],
      "status": "in_progress",
      "blocker": null
    }
  ],
  "exhaustion": null,
  "authorization": {
    "checkpoint": {
      "localCommit": "allowed",
      "amend": "allowed"
    },
    "delivery": {
      "push": "allowed",
      "pullRequest": "denied"
    },
    "runtime": {
      "deployProfiles": [
        "corpstable"
      ],
      "destructiveResetScopes": []
    },
    "history": {
      "rewrite": "denied"
    }
  }
}
```

## Acceptance Execution
```json
{
  "closures": {
    "sal-desktop-oauth-preauth-fix": [
      "station-access-desktop-oauth-native-e2e"
    ]
  },
  "completion": [
    "station-access-desktop-oauth-layout-e2e",
    "station-access-desktop-oauth-native-e2e",
    "desktop-check",
    "machine-dev-registry-self"
  ],
  "full": [
    "acceptance-infra-validation",
    "acceptance-plan-self",
    "acceptance-runtime-provisioning-self",
    "acceptance-workflow-contract",
    "agent-marketplace-catalog-e2e",
    "agent-native-connector-lifecycle-e2e",
    "agent-native-knowledge-binding-e2e",
    "agent-quick-completion-e2e",
    "agent-stream-resilience-e2e",
    "agent-v2-connector-invocation-e2e",
    "chat-contact-message-resilience-e2e",
    "chat-desktop-gateway-e2e",
    "chat-friend-request-gateway-e2e",
    "chat-lifecycle-call-resolution-e2e",
    "chat-lifecycle-direct-e2e",
    "chat-lifecycle-mixed-client-cross-station-e2e",
    "chat-lifecycle-mixed-client-group-mls-e2e",
    "chat-lifecycle-mixed-client-multi-device-e2e",
    "chat-lifecycle-mixed-client-same-station-e2e",
    "chat-lifecycle-onboarding-e2e",
    "chat-lifecycle-tree-zero-reference-e2e",
    "chat-native-current-profile-two-client-e2e",
    "chat-native-group-mls-e2e",
    "chat-native-interactions-e2e",
    "chat-native-multi-device-e2e",
    "chat-native-recovery-e2e",
    "chat-native-two-client-e2e",
    "chat-native-visible-static",
    "chat-storage-desktop-batch-clear-e2e",
    "chat-storage-mobile-batch-clear-e2e",
    "chat-storage-zero-legacy-e2e",
    "desktop-release-build",
    "federation-desktop-gateway-smoke",
    "federation-three-node-e2e",
    "messaging-platform-contract",
    "mobile-hard-cut-static",
    "mobile-ios-simulator-layout-accessibility-e2e",
    "mobile-native-build",
    "mobile-simulator-platform-e2e",
    "mobile-simulator-station-lifecycle-e2e",
    "proto-build",
    "station-agent-unit",
    "station-access-auth-e2e",
    "station-access-capability-contract",
    "station-access-desktop-oauth-layout-e2e",
    "station-access-desktop-oauth-native-e2e",
    "station-access-domain-validation",
    "station-access-federation-boundary-e2e",
    "station-access-lifecycle-aggregate-e2e",
    "station-access-scope-isolation-e2e",
    "station-api-ownership",
    "station-federation-unit",
    "station-messaging-unit",
    "desktop-check",
    "machine-dev-registry-self"
  ]
}
```

## Goal
Restore GitHub and Google login from the unauthenticated Desktop Access Gate
without weakening authenticated connector ownership, keep the complete OAuth
progress and recovery flow inside the fixed-size provider action, and preserve
one canonical post-login identity across shell, Account, and search surfaces.

## Traceability
- The Desktop identity lifecycle defines OAuth bridge login as an authenticated
  edge that begins from the account gate.
- `save_oauth_callback` already distinguishes login bootstrap (`None`) from an
  authenticated connector owner (`Some(ptid)`).
- Commit `80f796894` incorrectly required an existing window session before
  `oauth2_start_loopback`, making the login entrypoint unreachable.
- Runtime reproduction on `corpstable` proved the provider callback reaches
  Desktop, but `POST /actor/oauth-bridge` returns 404 because the existing
  `OAuthLogin` handler is absent from `GetActorHandlers`.
- Desktop currently converts that Station bridge failure into a completed
  loopback result, then fails later while restoring the missing Station
  session. Bridge failures must remain terminal callback failures.
- After route registration, the live bridge exposed that OAuth account
  bootstrap generated a 64-character hex password while Actor signup permits
  at most 20 characters. The internal password generator must satisfy the same
  validation contract as every other account creation path.
- The Desktop bridge sends `application/protobuf`; the Station OAuth handler
  must use the canonical protobuf-or-JSON request binder instead of the generic
  Hertz binder.
- Native proof must complete the production OAuth store and identity-runtime
  transition, not merely persist a backend session while the visible Desktop
  remains on the Access Gate.
- OAuth provider identity already carries `provider` and `avatar_url`; Station
  Actor Profile is the canonical post-login profile and must bootstrap missing
  avatar data without overwriting a user-managed profile.
- Desktop auth payloads and Account rendering must preserve the concrete local
  account provider (`github`, `google`, or local password) instead of reducing
  every OAuth login to the generic string `oauth`.
- Find People Federation and Station scopes may share the same operator name;
  their labels and hover descriptions must expose the scope type.

## Execution DAG
```text
SAL-OAUTH-01
```

## Atomic Cutover
- Tauri and HTTP Gateway resolve an actor only when one already exists.
- The application loopback owner is optional and validated when present.
- The callback uses no owner for login bootstrap and the current actor for an
  authenticated connector flow.
- OAuth login backfills only missing canonical Station profile data from the
  verified provider identity; subsequent user-managed profile values remain
  authoritative.
- The existing Station OAuth bridge is registered as the public
  `POST /actor/oauth-bridge` endpoint and preserves its signature, actor,
  access-gate, token, and session behavior.
- A login callback is successful only after Desktop persists a non-empty
  Station session and access token; bridge failures remain failed callbacks.
- OAuth opening, waiting, cancellation, initialization, success, and retry are
  rendered inside the original fixed-size provider action.
- The auth card and provider action keep identical geometry across OAuth states;
  no detached OAuth result panel participates in layout.
- Session and Account projections expose the concrete sign-in provider.
- Find People scope chips remain distinct when Federation and Station have the
  same configured name, with localized hover explanations.
- No compatibility command, fallback login, or duplicate OAuth path is added.

## Completion
- Rust regression tests cover login and connector owner modes.
- Station registration tests prove the exact public POST OAuth bridge route.
- GitHub and Google return `auth_url` and `session_id` in a source-bound native
  Tauri window before password authentication.
- Deterministic native callback proof reaches Station session restoration and
  an authenticated Desktop identity instead of stopping at browser launch.
- Native OAuth proof verifies that the Station profile, shell avatar, Account
  avatar, canonical PTID, and concrete provider agree after login.
- Desktop UI checks verify typed Federation/Station scope labels and tooltips.
- Wide and narrow layout evidence proves stable card and provider-action
  geometry across idle, waiting, cancelled, initialization, success, and
  failure/retry states.
- The canonical Desktop prototype exposes the same fixed-size inline OAuth
  state model.
- Current-source completion evidence covers layout, native OAuth, Desktop checks, machine registry, explicit `6aeb1bfc0c9031498d51990280918ff43d1ac399..HEAD` changed-file inventory, quality evidence, and runtime cleanup.
- Task and Plan remain open pending a fresh independent Completion Review.

## Non-Claims
- The plan does not claim completion of a real third-party authorization grant.
- The plan does not claim Linux, Windows, Mobile, or physical-device OAuth proof.
