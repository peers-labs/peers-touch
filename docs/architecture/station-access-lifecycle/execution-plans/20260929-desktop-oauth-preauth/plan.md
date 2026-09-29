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
      "docs/client/desktop/identity-lifecycle.md"
    ],
    "decisions": [
      "SAL-D01",
      "SAL-D03",
      "SAL-D06"
    ]
  },
  "scope": {
    "sourceClaims": [
      {
        "pathPrefix": "apps/desktop/src-tauri/src/application/oauth2/mod.rs",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/desktop/src-tauri/src/interface/tauri_commands/oauth2.rs",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/station-access-lifecycle/README.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/station-access-lifecycle/execution-plans/20260929-desktop-oauth-preauth",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance/capabilities/station-access.yaml",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance/environments/station-access-desktop-oauth-native.yaml",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance/features/station-access-authentication.yaml",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance/gates.yaml",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance/gates/station_access",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance/provisioners/__init__.py",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance/provisioners/station_access_desktop_oauth_native.py",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance/registry.yaml",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/station-access-lifecycle/experience-contract.md",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "docs/architecture/station-access-lifecycle/product-state-model.md",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "docs/architecture/station-access-lifecycle/design.md",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "docs/architecture/station-access-lifecycle/decisions.md",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "docs/client/desktop/identity-lifecycle.md",
        "mode": "shared-read"
      }
    ],
    "nonGoals": [
      "Complete an external GitHub or Google authorization grant with a real user account",
      "Change provider credentials, callback endpoints, or Station OAuth bridge semantics",
      "Change Mobile OAuth behavior",
      "Redesign the Desktop login layout",
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
      "station-access-capability-contract",
      "station-access-desktop-oauth-layout-e2e",
      "station-access-desktop-oauth-native-e2e",
      "desktop-check"
    ]
  },
  "completion": [
    "station-access-capability-contract",
    "station-access-desktop-oauth-layout-e2e",
    "station-access-desktop-oauth-native-e2e",
    "desktop-check"
  ],
  "full": [
    "acceptance-infra-validation",
    "acceptance-plan-self",
    "acceptance-runtime-provisioning-self",
    "acceptance-workflow-contract",
    "chat-desktop-gateway-e2e",
    "chat-lifecycle-call-resolution-e2e",
    "chat-lifecycle-mixed-client-cross-station-e2e",
    "chat-lifecycle-mixed-client-group-mls-e2e",
    "chat-lifecycle-mixed-client-multi-device-e2e",
    "chat-lifecycle-mixed-client-same-station-e2e",
    "chat-lifecycle-tree-zero-reference-e2e",
    "desktop-release-build",
    "messaging-platform-contract",
    "mobile-ios-simulator-layout-accessibility-e2e",
    "mobile-native-build",
    "mobile-simulator-station-lifecycle-e2e",
    "proto-build",
    "station-access-auth-e2e",
    "station-access-capability-contract",
    "station-access-desktop-oauth-layout-e2e",
    "station-access-desktop-oauth-native-e2e",
    "station-access-domain-validation",
    "station-access-federation-boundary-e2e",
    "station-access-lifecycle-aggregate-e2e",
    "station-access-scope-isolation-e2e",
    "station-api-ownership",
    "desktop-check"
  ]
}
```

## Goal

Restore GitHub and Google login from the unauthenticated Desktop Access Gate
without weakening authenticated connector ownership.

## Traceability

- The Desktop identity lifecycle defines OAuth bridge login as an authenticated
  edge that begins from the account gate.
- `save_oauth_callback` already distinguishes login bootstrap (`None`) from an
  authenticated connector owner (`Some(ptid)`).
- Commit `80f796894` incorrectly required an existing window session before
  `oauth2_start_loopback`, making the login entrypoint unreachable.

## Execution DAG

```text
SAL-OAUTH-01
```

## Atomic Cutover

- Tauri and HTTP Gateway resolve an actor only when one already exists.
- The application loopback owner is optional and validated when present.
- The callback uses no owner for login bootstrap and the current actor for an
  authenticated connector flow.
- No compatibility command, fallback login, or duplicate OAuth path is added.

## Completion

- Rust regression tests cover login and connector owner modes.
- GitHub and Google return `auth_url` and `session_id` in a source-bound native
  Tauri window before password authentication.
- Existing wide/narrow layout evidence remains valid.
- `make desktop` starts the exact checkpoint source.
- Secret scanning passes and the native Gate releases its runtime resources.

## Non-Claims

- The plan does not claim completion of a real third-party authorization grant.
- The plan does not claim Linux, Windows, Mobile, or physical-device OAuth proof.
