# X Config Home Operator State Cutover

> **Plan ID**: x-config-home-operator-state-20261020
> **Version ID**: x-config-home-operator-state-20261020-v1
> **Created**: 2026-10-20T14:05:27.000Z
> **Owner**: Client Platform

## North Star

X Config keeps the mature OAuth Broker protocol unchanged while the Home
runtime completes operator login, session readback, CSRF, replay denial, and
revocation from one local durable transaction store. GitHub remains the sole
catalog and signed-publication truth and is no longer an online X Config
session database.

## Source Contract

The accepted model comes from:

- CCP-J01 sign-in and inspection;
- OLB-D18 audience-bound one-time operator handoff;
- XCFG-D03 Home-local operator state and Git-backed publication separation;
- the Home placement declared by the env repository.

The cut preserves the existing site, audience, callback, assertion, allowlist,
cookie, CSRF, and one-hour session contracts. It changes persistence ownership
and X Config placement only.

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "x-config-home-operator-state-20261020",
  "versionId": "x-config-home-operator-state-20261020-v1",
  "createdAt": "2026-10-20T14:05:27.000Z",
  "workClass": "refactor",
  "architecture": {
    "sources": [
      "docs/architecture/domains/identity/oauth-login-broker/operator-login.md",
      "docs/architecture/domains/identity/oauth-login-broker/decisions.md",
      "docs/architecture/platform/client/control-plane/README.md",
      "docs/architecture/platform/client/control-plane/design.md",
      "docs/architecture/platform/client/control-plane/decisions.md",
      "docs/architecture/platform/client/control-plane/data-model.md",
      "docs/architecture/platform/client/control-plane/integration.md",
      "docs/architecture/platform/client/control-plane/runtime-verification.md"
    ],
    "decisions": [
      "OLB-D18",
      "XCFG-D03"
    ]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": "apps/x-config", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/platform/client/control-plane", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/architecture-governance/architecture-modules.json", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/skills/pt-x-config-2-vercel", "mode": "exclusive-write"},
      {"pathPrefix": "packages/github-repository", "mode": "shared-read"},
      {"pathPrefix": "packages/x-config-core", "mode": "shared-read"},
      {"pathPrefix": "apps/oauth2-client", "mode": "shared-read"}
    ],
    "nonGoals": [
      "Change OAuth Broker provider callback, state, PKCE, token exchange, identity normalization or handoff wire contract",
      "Change the OAuth Broker OAuthStore adapter in this Plan",
      "Move catalog, publication sequence, metadata or exact snapshot bytes out of GitHub",
      "Add multi-instance X Config, a remote operator database or multi-operator RBAC",
      "Change Desktop or Mobile snapshot semantics",
      "Restore an older operator database over newer Home state",
      "Push origin/GitHub, open a pull request or merge"
    ]
  },
  "tasks": [
    {"id": "XHOS-01", "workstreamId": "XHOS", "path": "tasks/XHOS-01.md", "dependsOn": []},
    {"id": "XHOS-02", "workstreamId": "XHOS", "path": "tasks/XHOS-02.md", "dependsOn": ["XHOS-01"]}
  ],
  "authorization": {
    "checkpoint": {"localCommit": "allowed", "amend": "allowed"},
    "delivery": {"push": "denied", "pullRequest": "denied"},
    "runtime": {
      "deployProfiles": ["x-config-home-preview"],
      "destructiveResetScopes": ["vercel:project:peers-x-config"]
    },
    "history": {"rewrite": "denied"}
  }
}
```

## External Environment Binding

The deployment source lives in the separate local env repository under
`peers-touch-infra/x-config-preview/`. XHOS-02 owns one independently
checkpointed env delta limited to:

- replacing `X_CONFIG_STORAGE_DRIVER` with explicit catalog and operator
  storage drivers;
- declaring the SQLite path and writable state mount;
- preserving the current callback, owned Broker redeem origin, edge, port,
  health, GitHub publication, and secret values;
- recording exact application and env commits in the Home release.

The env checkpoint must be clean and reviewable before deployment. This Plan
does not authorize unrelated env changes or printing git-crypt values.

## Dependency DAG

```text
XHOS-01 local operator-state cutover
  -> bounded env checkpoint
  -> XHOS-02 exact-source Home deployment, real OAuth proof and Vercel cleanup
```

## Atomic Cutovers

1. Operator state changes from GitHub records to one Home SQLite database in a
   single source cut. The runtime has no dual-read, dual-write, migration
   fallback, or production memory adapter.
2. Catalog and publication code retain the existing GitHub repository and
   paths, except `x-config/admin-auth/**` becomes inactive.
3. Login completion changes from separate attempt consumption and session
   commits to one local transaction after successful Broker redemption.
4. Vercel Function wrappers, their shared bridge, `vercel.json`, and the X
   Config Vercel deployment skill are deleted before source completion. The
   external Vercel project is deleted only after the exact Home release passes
   the real Journey.

Rollback before external cleanup uses VCS revert plus the preceding committed
Home env revision. After Vercel cleanup, rollback remains a versioned Home
release; no parallel Vercel runtime or Git-backed operator path is retained.

## Acceptance Execution

```json
{
  "closures": {
    "XHOS-operator-state": [
      "x-config-operator-login-contract"
    ],
    "XHOS-home-closure": [
      "x-config-home-operator-login-e2e",
      "x-config-home-publication-e2e"
    ]
  },
  "completion": [
    "x-config-operator-login-contract",
    "x-config-home-operator-login-e2e",
    "x-config-home-publication-e2e"
  ],
  "full": []
}
```

## Completion

- Provider login still enters only through `peers-touch-oauth`.
- X Config operator login, session readback, CSRF, replay denial, logout, and
  restart continuity use the Home database and perform no X Config auth Git
  mutation.
- Catalog save, publication CAS, signed-byte persistence, and public readback
  remain Git-backed and byte-identical.
- The deployed release binds exact application and env commits, exposes only
  the owned Home origin, and retains no active raw Vercel hostname dependency.
- After current-source proof, the Vercel X Config project and source adapters
  are absent; the OAuth Broker project and shared GitHub repository remain.
- OAuth Broker storage optimization, native Desktop/Mobile UI, Production
  promotion, push, PR, and merge remain explicit non-claims.
