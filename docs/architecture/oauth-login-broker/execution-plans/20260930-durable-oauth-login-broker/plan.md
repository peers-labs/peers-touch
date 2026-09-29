# Durable OAuth Login Broker

> **Status**: active
> **Branch**: work/station-access-lifecycle
> **Workspace ID**: 95620934d3348d95
> **Initial HEAD**: 45e3751e72648a4679082d5b4370268faf3e8881

## Verified Worktree Binding

- Canonical root: the repository root resolved from `$PWD`.
- Branch: `work/station-access-lifecycle`
- Workspace ID: `95620934d3348d95`
- Initial HEAD: `45e3751e72648a4679082d5b4370268faf3e8881`
- Verification:
  `python3 tooling/scripts/verify-worktree-binding.py --root "$PWD" --branch work/station-access-lifecycle --workspace-id 95620934d3348d95 --head 45e3751e72648a4679082d5b4370268faf3e8881`

## Plan Package

```json
{
  "kind": "peers-touch-plan-package",
  "planId": "OLB-20260930",
  "status": "active",
  "binding": {
    "branch": "work/station-access-lifecycle",
    "workspaceId": "95620934d3348d95",
    "initialHead": "45e3751e72648a4679082d5b4370268faf3e8881"
  },
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/oauth-login-broker/product-definition.md",
      "docs/architecture/oauth-login-broker/experience-contract.md",
      "docs/architecture/oauth-login-broker/product-state-model.md",
      "docs/architecture/oauth-login-broker/acceptance-matrix.md",
      "docs/architecture/oauth-login-broker/design.md",
      "docs/architecture/oauth-login-broker/decisions.md",
      "docs/architecture/oauth-login-broker/data-model.md",
      "docs/architecture/oauth-login-broker/module-layout.md",
      "docs/architecture/oauth-login-broker/integration.md"
    ],
    "decisions": [
      "OLB-D01",
      "OLB-D02",
      "OLB-D03",
      "OLB-D04",
      "OLB-D05",
      "OLB-D06",
      "OLB-D07",
      "OLB-D08",
      "OLB-D09"
    ]
  },
  "scope": {
    "sourceClaims": [
      {
        "pathPrefix": "apps/oauth2-client",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/README.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/architecture-module-governance/architecture-modules.json",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/oauth-login-broker",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/development-workflow",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "docs/architecture/mobile",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "docs/architecture/station-access-lifecycle",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "docs/global/architecture-document-standard.md",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "tooling/acceptance",
        "mode": "exclusive-write"
      }
    ],
    "nonGoals": [
      "Create or mutate the production GitHub repository, GitHub App, Vercel project, or provider applications",
      "Expose a public credential read or refresh endpoint",
      "Implement account linking, account deletion, consent management, or multi-operator RBAC",
      "Replace Station Access Gate or Station session ownership",
      "Persist raw authorization codes or raw OAuth state",
      "Push, open a pull request, merge, release, or rewrite history"
    ]
  },
  "tasks": [
    {
      "id": "OLB-01-DURABLE-CORE",
      "workstreamId": "OLB-SERVICE",
      "path": "tasks/OLB-01-DURABLE-CORE.md",
      "dependsOn": [],
      "status": "in_progress",
      "blocker": null
    },
    {
      "id": "OLB-02-REFRESH-IDEMPOTENCY",
      "workstreamId": "OLB-SERVICE",
      "path": "tasks/OLB-02-REFRESH-IDEMPOTENCY.md",
      "dependsOn": [
        "OLB-01-DURABLE-CORE"
      ],
      "status": "pending",
      "blocker": null
    },
    {
      "id": "OLB-03-KEY-ROTATION",
      "workstreamId": "OLB-SERVICE",
      "path": "tasks/OLB-03-KEY-ROTATION.md",
      "dependsOn": [
        "OLB-02-REFRESH-IDEMPOTENCY"
      ],
      "status": "pending",
      "blocker": null
    },
    {
      "id": "OLB-04-OPERATOR-PROOF",
      "workstreamId": "OLB-SERVICE",
      "path": "tasks/OLB-04-OPERATOR-PROOF.md",
      "dependsOn": [
        "OLB-03-KEY-ROTATION"
      ],
      "status": "pending",
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
      "push": "denied",
      "pullRequest": "denied"
    },
    "runtime": {
      "deployProfiles": [
        "oauth2-client-local"
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
    "olb-durable-login": [],
    "olb-refresh-idempotency": [],
    "olb-key-rotation": [],
    "olb-operator-proof": [
      "oauth-login-broker-contract"
    ]
  },
  "completion": [
    "oauth-login-broker-contract",
    "architecture-module-governance",
    "acceptance-infra-validation"
  ],
  "full": [
    "oauth-login-broker-contract",
    "architecture-module-governance",
    "acceptance-infra-validation"
  ]
}
```

## Goal

Make the Vercel OAuth broker durable across function instances, retain
refreshable provider credentials only as encrypted records in a dedicated
private GitHub repository, and expose a sanitized read-only operator surface.

## Dependency DAG

```text
OLB-01-DURABLE-CORE
  -> OLB-02-REFRESH-IDEMPOTENCY
  -> OLB-03-KEY-ROTATION
  -> OLB-04-OPERATOR-PROOF
```

## Atomic Cutovers

- Replace implicit process-local session ownership with the configured
  `OAuthStore`; Vercel has no memory fallback.
- Change provider exchange from identity-only output to identity plus token set
  in one interface update.
- Commit callback consumption, identity, credential, and audit as one Git tree.
- Add administration only after sanitized projections and authentication exist.

## Completion

- GitHub storage, encryption, PKCE, token refresh, administration, and route
  contracts are implemented and tested.
- The exact-source local HTTP journey and registered Acceptance bundle pass.
- Architecture registry and Plan package validate.
- A local commit is created; no remote delivery or production mutation occurs.

## Non-Claims

- No live provider consent, GitHub App installation, Vercel deployment, or
  production traffic claim.
- No dedicated database, multi-operator authorization, account linking, or
  browser-accessible credential API.
