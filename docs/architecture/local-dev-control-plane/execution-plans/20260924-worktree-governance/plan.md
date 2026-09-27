# Peers Dev Worktree Governance

> **Status**: completed
> **Branch**: peers-touch-git
> **Workspace ID**: 5f50d8bb381b0123
> **Initial HEAD**: 4ccf88b4c2d5f9c25f940fe5aa658e8390777026

## Plan Package

```json
{
  "kind": "peers-touch-plan-package",
  "planId": "DEV-UI-WORKTREE-GOVERNANCE-20260924",
  "status": "completed",
  "binding": {
    "branch": "peers-touch-git",
    "workspaceId": "5f50d8bb381b0123",
    "initialHead": "4ccf88b4c2d5f9c25f940fe5aa658e8390777026"
  },
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/local-dev-control-plane/product-definition.md",
      "docs/architecture/local-dev-control-plane/experience-contract.md",
      "docs/architecture/local-dev-control-plane/product-state-model.md",
      "docs/architecture/local-dev-control-plane/acceptance-matrix.md",
      "docs/architecture/local-dev-control-plane/design.md",
      "docs/architecture/local-dev-control-plane/data-model.md",
      "docs/architecture/local-dev-control-plane/decisions.md",
      "docs/architecture/local-dev-control-plane/integration.md",
      "docs/architecture/local-dev-control-plane/module-layout.md"
    ],
    "decisions": [
      "LDCP-D08",
      "LDCP-D12",
      "LDCP-D14",
      "LDCP-D15",
      "LDCP-D16"
    ]
  },
  "scope": {
    "sourceClaims": [
      {
        "pathPrefix": "apps/dev",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/developer-toolchain",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/development-workflow",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "docs/architecture/local-dev-control-plane",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/client/common/ui-identity",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "docs/knowledge/invariants/worktree-observation-is-diagnostic.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/devctl",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/make/local-dev.mk",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/local-dev",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/plan",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-github-review/FRESHNESS.md",
        "mode": "exclusive-write"
      }
    ],
    "nonGoals": [
      "Rebind a browser-selected worktree to an Agent conversation or Plan",
      "Fetch remotes or claim remote master freshness",
      "Delete Git branches or use force removal",
      "Delete Acceptance Evidence or product data",
      "Add batch removal or bypass controls",
      "Treat observation freshness as activity or authorization"
    ]
  },
  "tasks": [
    {
      "id": "DUI-WORKTREE-GOVERNANCE",
      "workstreamId": "DUI-GOVERNANCE",
      "path": "tasks/DUI-WORKTREE-GOVERNANCE.md",
      "dependsOn": [],
      "status": "done",
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
        "dev-ui-local"
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
    "dev-ui-worktree-governance": [
      "dev-ui-browser-e2e",
      "acceptance-workflow-contract",
      "acceptance-runtime-provisioning-self",
      "development-workflow-control-plane"
    ]
  },
  "completion": [
    "dev-ui-browser-e2e",
    "acceptance-workflow-contract",
    "acceptance-runtime-provisioning-self",
    "development-workflow-control-plane"
  ],
  "full": [
    "dev-ui-browser-e2e",
    "acceptance-workflow-contract",
    "acceptance-runtime-provisioning-self",
    "development-workflow-control-plane",
    "acceptance-plan-self",
    "acceptance-infra-validation"
  ]
}
```

## Goal

Turn Peers Dev into a usable worktree governance surface: users can select,
filter and sort all worktrees, inspect provenance-bearing lifecycle, storage
and master-distance metrics, and retire only an inactive linked worktree
through a guarded, non-force, branch-preserving command.

## Completion

- The primary list is usable without a 2070px horizontal scan.
- Worktree selection is browser-local and cannot change workflow identity.
- Metrics expose provenance, timestamps and typed unavailable states.
- Retirement safety is independently enforced by `devctl`, not inferred by the
  browser.
- All protected, active, dirty and unmerged cases fail closed.
- Real desktop and narrow browser Journeys pass against exact source.
- The branch and Acceptance Evidence survive successful worktree removal.
