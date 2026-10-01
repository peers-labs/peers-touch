# OAuth Live Login Integration

> **Status**: active
> **Branch**: work/station-access-lifecycle
> **Workspace ID**: 95620934d3348d95
> **Initial HEAD**: b99b5368376d7191edb07112d9b2d716ce5f630e

## Verified Worktree Binding

- Canonical root: the repository worktree identified by workspace ID
  `95620934d3348d95`.
- Branch: `work/station-access-lifecycle`.
- Workspace ID: `95620934d3348d95`.
- Initial HEAD: `b99b5368376d7191edb07112d9b2d716ce5f630e`.

## Plan Package

```json
{"kind":"peers-touch-plan-package","planId":"OLB-LIVE-20261001","status":"active","binding":{"branch":"work/station-access-lifecycle","workspaceId":"95620934d3348d95","initialHead":"b99b5368376d7191edb07112d9b2d716ce5f630e"},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/oauth-login-broker/product-definition.md","docs/architecture/oauth-login-broker/experience-contract.md","docs/architecture/oauth-login-broker/product-state-model.md","docs/architecture/oauth-login-broker/acceptance-matrix.md","docs/architecture/oauth-login-broker/design.md","docs/architecture/oauth-login-broker/decisions.md","docs/architecture/oauth-login-broker/data-model.md","docs/architecture/oauth-login-broker/integration.md","docs/architecture/station-access-lifecycle/README.md"],"decisions":["OLB-D01","OLB-D02","OLB-D03","OLB-D04","OLB-D05","OLB-D06","OLB-D07","OLB-D08","OLB-D09","OLB-D10","OLB-D11","OLB-D12","OLB-D13","OLB-D14","OLB-D15","OLB-D16","OLB-D17","SAL-D01","SAL-D02","SAL-D03","SAL-D04","SAL-D05","SAL-D06"]},"scope":{"sourceClaims":[{"pathPrefix":"apps/oauth2-client","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/kernel/identityRuntime.ts","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/pages/login","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/services/desktop_api.ts","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/store/oauth2.ts","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/store/session.ts","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/build.rs","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/application/auth","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/application/oauth2","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/contracts.rs","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/infrastructure/auth_identity/mod.rs","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/interface/contracts/mod.rs","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/interface/http_gateway/mod.rs","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/interface/tauri_commands/oauth2.rs","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/main.rs","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/model/mod.rs","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/oauth","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/core/auth/oauth2.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/actor_handler.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/actor_router.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/auth","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/oauth_handler.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/model/db/oauth2_state.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/model/db/automigrate.go","mode":"exclusive-write"},{"pathPrefix":"model/domain/oauth/oauth.proto","mode":"exclusive-write"},{"pathPrefix":"model/domain/oauth/broker_bridge.proto","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/model/oauth.pb.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/model/oauthbridge","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/gen/proto/domain/oauth/oauth_pb.ts","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/gen/proto/domain/oauth/broker_bridge_pb.ts","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src/gen/proto/domain/oauth","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/oauth-login-broker","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/acceptance-framework/coverage-report.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/architecture-module-governance/architecture-modules.json","mode":"exclusive-write"},{"pathPrefix":"docs/global/coding-guide/desktop/service-api.md","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance","mode":"exclusive-write"},{"pathPrefix":"tooling/docker/compose.yml","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/station-access-lifecycle","mode":"shared-read"},{"pathPrefix":"docs/client/desktop","mode":"shared-read"},{"pathPrefix":"docs/knowledge","mode":"shared-read"}],"nonGoals":["Mutate the production OAuth deployment, production credential repository, or production provider applications","Merge or modify peers-touch-git","Push, open a pull request, release, or rewrite history","Replace the Station native mobile OAuth attempt protocol"]},"tasks":[{"id":"OLB-LIVE-01","workstreamId":"OLB-LIVE","path":"tasks/OLB-LIVE-01.md","dependsOn":[],"status":"in_progress","blocker":null},{"id":"OLB-LIVE-04","workstreamId":"OLB-LIVE","path":"tasks/OLB-LIVE-04.md","dependsOn":["OLB-LIVE-01"],"status":"pending","blocker":null}],"exhaustion":null,"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["oauth2-client-local","oauth2-client-test"],"destructiveResetScopes":[]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{
  "closures": {
    "olb-live-native-handoff": [],
    "olb-live-proof": [
      "acceptance-infra-validation",
      "acceptance-plan-self",
      "acceptance-runtime-provisioning-self",
      "acceptance-workflow-contract",
      "agent-marketplace-catalog-e2e",
      "agent-native-connector-lifecycle-e2e",
      "agent-native-knowledge-binding-e2e",
      "agent-quick-completion-e2e",
      "agent-stream-resilience-e2e",
      "agent-v2-kernel-foundation-e2e",
      "agent-v2-connector-invocation-e2e",
      "chat-desktop-gateway-e2e",
      "chat-lifecycle-direct-e2e",
      "chat-lifecycle-onboarding-e2e",
      "chat-lifecycle-tree-zero-reference-e2e",
      "chat-native-current-profile-two-client-e2e",
      "chat-native-group-mls-e2e",
      "chat-native-interactions-e2e",
      "chat-native-multi-device-e2e",
      "chat-native-recovery-e2e",
      "chat-native-two-client-e2e",
      "chat-native-visible-static",
      "desktop-check",
      "federation-three-node-e2e",
      "messaging-platform-contract",
      "mobile-contract-static",
      "mobile-identity-contract",
      "mobile-simulator-access-e2e",
      "oauth-login-broker-handoff-contract",
      "oauth-login-broker-provider-identity",
      "oauth-login-broker-durable-login",
      "oauth-login-broker-refresh-idempotency",
      "oauth-login-broker-key-rotation",
      "oauth-login-broker-operator",
      "oauth-login-broker-architecture",
      "oauth-login-broker-contract",
      "proto-build",
      "station-access-auth-e2e",
      "station-access-capability-contract",
      "station-access-federation-boundary-e2e",
      "station-access-scope-isolation-e2e",
      "station-agent-unit",
      "station-api-ownership",
      "station-federation-unit",
      "station-messaging-unit"
    ]
  },
  "completion": [
    "acceptance-infra-validation",
    "acceptance-plan-self",
    "acceptance-runtime-provisioning-self",
    "acceptance-workflow-contract",
    "agent-marketplace-catalog-e2e",
    "agent-native-connector-lifecycle-e2e",
    "agent-native-knowledge-binding-e2e",
    "agent-quick-completion-e2e",
    "agent-stream-resilience-e2e",
    "agent-v2-kernel-foundation-e2e",
    "agent-v2-connector-invocation-e2e",
    "chat-desktop-gateway-e2e",
    "chat-lifecycle-direct-e2e",
    "chat-lifecycle-onboarding-e2e",
    "chat-lifecycle-tree-zero-reference-e2e",
    "chat-native-current-profile-two-client-e2e",
    "chat-native-group-mls-e2e",
    "chat-native-interactions-e2e",
    "chat-native-multi-device-e2e",
    "chat-native-recovery-e2e",
    "chat-native-two-client-e2e",
    "chat-native-visible-static",
    "desktop-check",
    "federation-three-node-e2e",
    "messaging-platform-contract",
    "mobile-contract-static",
    "mobile-identity-contract",
    "mobile-simulator-access-e2e",
    "oauth-login-broker-handoff-contract",
    "oauth-login-broker-provider-identity",
    "oauth-login-broker-durable-login",
    "oauth-login-broker-refresh-idempotency",
    "oauth-login-broker-key-rotation",
    "oauth-login-broker-operator",
    "oauth-login-broker-architecture",
    "oauth-login-broker-contract",
    "proto-build",
    "station-access-auth-e2e",
    "station-access-capability-contract",
    "station-access-federation-boundary-e2e",
    "station-access-scope-isolation-e2e",
    "station-agent-unit",
    "station-api-ownership",
    "station-federation-unit",
    "station-messaging-unit"
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
    "agent-v2-kernel-foundation-e2e",
    "agent-v2-connector-invocation-e2e",
    "chat-desktop-gateway-e2e",
    "chat-lifecycle-direct-e2e",
    "chat-lifecycle-onboarding-e2e",
    "chat-lifecycle-tree-zero-reference-e2e",
    "chat-native-current-profile-two-client-e2e",
    "chat-native-group-mls-e2e",
    "chat-native-interactions-e2e",
    "chat-native-multi-device-e2e",
    "chat-native-recovery-e2e",
    "chat-native-two-client-e2e",
    "chat-native-visible-static",
    "desktop-check",
    "federation-three-node-e2e",
    "messaging-platform-contract",
    "mobile-contract-static",
    "mobile-identity-contract",
    "mobile-simulator-access-e2e",
    "oauth-login-broker-handoff-contract",
    "oauth-login-broker-provider-identity",
    "oauth-login-broker-durable-login",
    "oauth-login-broker-refresh-idempotency",
    "oauth-login-broker-key-rotation",
    "oauth-login-broker-operator",
    "oauth-login-broker-architecture",
    "oauth-login-broker-contract",
    "proto-build",
    "station-access-auth-e2e",
    "station-access-capability-contract",
    "station-access-federation-boundary-e2e",
    "station-access-scope-isolation-e2e",
    "station-agent-unit",
    "station-api-ownership",
    "station-federation-unit",
    "station-messaging-unit"
  ]
}
```

## Goal

Make the standalone OAuth Login Broker usable for a real native Desktop account
login before provisioning an isolated live test environment.

## Dependency DAG

```text
OLB-LIVE-01
  -> OLB-LIVE-02
  -> OLB-LIVE-03
       \        /
        -> OLB-LIVE-04
```

## Atomic Cutovers

- Account login becomes a distinct unauthenticated intent; connector linking
  remains authenticated.
- Native callback uses only the explicit loopback template; the old ambiguous
  callback path is removed from account login.
- Broker and Station use one protobuf-backed `bridge_version=v1` signature.
- Station verification and Access Gate evaluation complete before Desktop
  receives an inactive candidate credential.
- Desktop persists the candidate credential before Station acknowledgement;
  acknowledgement alone activates and replaces sessions.
- Provider denial and missing-email identity become typed supported outcomes.
- Refresh claims commit before provider token rotation; uncertain operations
  never call the provider twice.

## Environment Handoff

The sibling `env` repository owns the human-authorized `oauth2-client-test`
definition and its isolated external resources. Production resources remain
untouched.

## Completion

- Both Task closures are `done`.
- Focused Go, Rust, TypeScript, proto, architecture, and Acceptance checks pass.
- Exact-source local Desktop-to-Station functional evidence is
  `FUNCTIONAL_PASS`.
- The isolated live-environment inputs and expected probes are documented for
  the target-bound environment Plan.

## Non-Claims

- No production mutation.
- No live provider, GitHub App, private data repository, or Vercel proof until
  the separate environment Plan runs.
- No commit, push, pull request, merge, release, or history rewrite.
