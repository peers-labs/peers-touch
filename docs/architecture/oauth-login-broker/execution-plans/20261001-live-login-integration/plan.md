# OAuth2 Client Live API And Repository Acceptance

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
{"kind":"peers-touch-plan-package","planId":"OLB-LIVE-20261001","status":"active","binding":{"branch":"work/station-access-lifecycle","workspaceId":"95620934d3348d95","initialHead":"b99b5368376d7191edb07112d9b2d716ce5f630e"},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/oauth-login-broker/product-definition.md","docs/architecture/oauth-login-broker/experience-contract.md","docs/architecture/oauth-login-broker/product-state-model.md","docs/architecture/oauth-login-broker/acceptance-matrix.md","docs/architecture/oauth-login-broker/design.md","docs/architecture/oauth-login-broker/decisions.md","docs/architecture/oauth-login-broker/data-model.md","docs/architecture/oauth-login-broker/integration.md","docs/architecture/station-access-lifecycle/README.md"],"decisions":["OLB-D01","OLB-D02","OLB-D03","OLB-D04","OLB-D05","OLB-D06","OLB-D07","OLB-D08","OLB-D09","OLB-D10","OLB-D11","OLB-D12","OLB-D13","OLB-D14","OLB-D15","OLB-D16","OLB-D17","SAL-D01","SAL-D02","SAL-D03","SAL-D04","SAL-D05","SAL-D06"]},"scope":{"sourceClaims":[{"pathPrefix":"apps/oauth2-client","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/kernel/identityRuntime.ts","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/pages/login","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/services/desktop_api.ts","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/store/oauth2.ts","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/store/session.ts","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/build.rs","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/application/auth","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/application/oauth2","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/contracts.rs","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/infrastructure/auth_identity/mod.rs","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/interface/contracts/mod.rs","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/interface/http_gateway/mod.rs","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/interface/tauri_commands/oauth2.rs","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/main.rs","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/model/mod.rs","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver/oauth","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/core/auth/oauth2.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/actor_handler.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/actor_router.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/auth","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/oauth_handler.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/model/db/oauth2_state.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/model/db/automigrate.go","mode":"exclusive-write"},{"pathPrefix":"model/domain/oauth/oauth.proto","mode":"exclusive-write"},{"pathPrefix":"model/domain/oauth/broker_bridge.proto","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/model/oauth.pb.go","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch/model/oauthbridge","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/gen/proto/domain/oauth/oauth_pb.ts","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/gen/proto/domain/oauth/broker_bridge_pb.ts","mode":"exclusive-write"},{"pathPrefix":"apps/mobile/src/gen/proto/domain/oauth","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/oauth-login-broker","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/acceptance-framework/coverage-report.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/architecture-module-governance/architecture-modules.json","mode":"exclusive-write"},{"pathPrefix":"docs/global/coding-guide/desktop/service-api.md","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance","mode":"exclusive-write"},{"pathPrefix":"tooling/docker/compose.yml","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/station-access-lifecycle","mode":"shared-read"},{"pathPrefix":"docs/client/desktop","mode":"shared-read"},{"pathPrefix":"docs/knowledge","mode":"shared-read"}],"nonGoals":["Mutate the production OAuth deployment, production credential repository, or production provider applications","Merge or modify peers-touch-git","Push, open a pull request, release, or rewrite history","Replace the Station native mobile OAuth attempt protocol","Run Desktop, Station, native, or broader Peers-Touch Acceptance"]},"tasks":[{"id":"OLB-LIVE-01","workstreamId":"OLB-LIVE","path":"tasks/OLB-LIVE-01.md","dependsOn":[],"status":"in_progress","blocker":null},{"id":"OLB-LIVE-04","workstreamId":"OLB-LIVE","path":"tasks/OLB-LIVE-04.md","dependsOn":["OLB-LIVE-01"],"status":"pending","blocker":null}],"exhaustion":null,"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["oauth2-client-local"],"destructiveResetScopes":[]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{
  "closures": {
    "olb-live-native-handoff": [

    ],
    "olb-live-proof": [
      "oauth-login-broker-durable-login",
      "oauth-login-broker-refresh-idempotency",
      "oauth-login-broker-key-rotation",
      "oauth-login-broker-operator",
      "oauth2-client-live-api-repository",
      "oauth-login-broker-architecture",
      "oauth-login-broker-contract"
    ]
  },
  "completion": [
    "oauth-login-broker-durable-login",
    "oauth-login-broker-refresh-idempotency",
    "oauth-login-broker-key-rotation",
    "oauth-login-broker-operator",
    "oauth2-client-live-api-repository",
    "oauth-login-broker-architecture",
    "oauth-login-broker-contract"
  ],
  "full": [
    "oauth-login-broker-durable-login",
    "oauth-login-broker-refresh-idempotency",
    "oauth-login-broker-key-rotation",
    "oauth-login-broker-operator",
    "oauth2-client-live-api-repository",
    "oauth-login-broker-architecture",
    "oauth-login-broker-contract"
  ]
}
```

## Goal

Prove that the standalone OAuth2 client implements the accepted API contract
and durably stores encrypted broker records in an isolated private GitHub
repository.

## Dependency DAG

```text
OLB-LIVE-01
  -> OLB-LIVE-04
```

## Atomic Cutovers

- Authorization-code callbacks use state and PKCE and reject replay.
- Provider identity and credential records commit atomically before redirect.
- Operator readback is authenticated, read-only, and token-free.
- Every durable record remains an authenticated encrypted envelope in the
  private GitHub repository.
- Refresh claims commit before provider token rotation; uncertain operations
  never call the provider twice.

## Environment Handoff

The sibling `env` repository owns the human-authorized `oauth2-client-test`
definition and its isolated external resources. Production resources remain
untouched.

## Completion

- Both Task closures are `done`.
- All `apps/oauth2-client` race-enabled tests pass.
- The durability, refresh-idempotency, key-rotation, and operator Gates are
  `DONE/PROVEN`.
- Live GitHub and Google authorization callbacks return normalized identity
  data.
- GitHub repository readback confirms encrypted transaction, identity,
  credential, refresh-operation, and audit records without plaintext secrets.

## Non-Claims

- No production mutation.
- No Desktop, Station, native, or broader Peers-Touch Acceptance claim.
- No Vercel deployment, production-scale, or production-traffic claim.
- No push, pull request, merge, release, or history rewrite.
