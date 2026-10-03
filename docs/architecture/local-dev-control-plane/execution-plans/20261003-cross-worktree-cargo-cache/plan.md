# Cross-Worktree Cargo Compile Cache

> **Status**: active
> **Branch**: peers-dev-workflow
> **Workspace ID**: dbd1913c8dd24d52
> **Initial HEAD**: 37fff063ce260f287a403550cde637918a4cd74a

## Plan Package

```json
{
  "kind": "peers-touch-plan-package",
  "planId": "LDCP-CARGO-CACHE-20261003",
  "status": "active",
  "binding": {
    "branch": "peers-dev-workflow",
    "workspaceId": "dbd1913c8dd24d52",
    "initialHead": "37fff063ce260f287a403550cde637918a4cd74a"
  },
  "workClass": "infrastructure",
  "architecture": {
    "sources": [
      "docs/architecture/architecture-module-governance/README.md",
      "docs/architecture/development-workflow/README.md",
      "docs/architecture/local-dev-control-plane/README.md",
      "docs/architecture/local-dev-control-plane/design.md",
      "docs/architecture/local-dev-control-plane/decisions.md",
      "docs/architecture/local-dev-control-plane/integration.md",
      "docs/architecture/local-dev-control-plane/module-layout.md"
    ],
    "decisions": [
      "AMG-D01",
      "DWF-D21",
      "LDCP-D01",
      "LDCP-D02",
      "LDCP-D19"
    ]
  },
  "scope": {
    "sourceClaims": [
      {
        "pathPrefix": ".cargo",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "Makefile",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/architecture-module-governance/architecture-modules.json",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/local-dev-control-plane",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/make/setup.mk",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/cargo-cache.sh",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/cargo-cache.test.mjs",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/architecture/module-governance.test.mjs",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-github-review/FRESHNESS.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/desktop/src-tauri",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "apps/mobile/src-tauri",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "tooling/make/acceptance.mk",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "tooling/scripts/local-dev/desktop-dev.sh",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "tooling/scripts/local-dev/mobile-ios-sim.sh",
        "mode": "shared-read"
      }
    ],
    "nonGoals": [
      "Share one writable Cargo target directory between worktrees",
      "Delete existing Cargo targets or other build artifacts",
      "Build the Peers-Touch Desktop or Mobile Rust workspace for verification",
      "Change application runtime behavior",
      "Merge histories or rewrite history"
    ]
  },
  "tasks": [
    {
      "id": "LDCP-CARGO-CACHE-01",
      "workstreamId": "LDCP-CARGO-CACHE",
      "path": "tasks/LDCP-CARGO-CACHE-01.md",
      "dependsOn": [],
      "status": "in_progress",
      "blocker": null
    }
  ],
  "exhaustion": null,
  "authorization": {
    "checkpoint": {
      "localCommit": "allowed",
      "amend": "denied"
    },
    "delivery": {
      "push": "allowed",
      "pullRequest": "allowed"
    },
    "runtime": {
      "deployProfiles": [],
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
    "cargo-cache-reuse": [
      "acceptance-infra-validation",
      "acceptance-plan-self",
      "acceptance-runtime-provisioning-self",
      "acceptance-workflow-contract",
      "architecture-module-governance",
      "dev-ui-browser-e2e",
      "machine-dev-registry-self",
      "peers-dev-product"
    ]
  },
  "completion": [
    "acceptance-infra-validation",
    "acceptance-plan-self",
    "acceptance-runtime-provisioning-self",
    "acceptance-workflow-contract",
    "architecture-module-governance",
    "dev-ui-browser-e2e",
    "machine-dev-registry-self",
    "peers-dev-product"
  ],
  "full": [
    "acceptance-infra-validation",
    "acceptance-plan-self",
    "acceptance-runtime-provisioning-self",
    "acceptance-workflow-contract",
    "architecture-module-governance",
    "dev-ui-browser-e2e",
    "machine-dev-registry-self",
    "peers-dev-product"
  ]
}
```

## Goal

Make Rust compiler results reusable across all local worktrees without sharing
Cargo target directories or requiring per-shell environment variables.

## Completion

- Nested Cargo invocations automatically discover the compiler wrapper.
- A missing or disabled cache backend transparently runs the Cargo-provided
  compiler.
- Machine setup installs and configures one bounded shared cache without
  replacing unrelated Cargo configuration.
- Two identical crates in different directories produce a cache hit and
  retain separate target directories.
