# Source-aware Station startup sync

> **Status**: active
> **Branch**: peers-touch-git
> **Workspace ID**: 5f50d8bb381b0123
> **Initial HEAD**: 63289d4d3b1aebe6fe2ec8372e682ae0253b2f4a

## Plan Package

```json
{
  "kind": "peers-touch-plan-package",
  "planId": "LDCP-STATION-SYNC-20260928",
  "status": "active",
  "binding": {
    "branch": "peers-touch-git",
    "workspaceId": "5f50d8bb381b0123",
    "initialHead": "63289d4d3b1aebe6fe2ec8372e682ae0253b2f4a"
  },
  "workClass": "infrastructure",
  "architecture": {
    "sources": [
      "docs/architecture/local-dev-control-plane/README.md",
      "docs/architecture/local-dev-control-plane/decisions.md",
      "docs/architecture/local-dev-control-plane/integration.md",
      "docs/global/local-dev-environment.md"
    ],
    "decisions": [
      "LDCP-D08",
      "LDCP-D15",
      "LDCP-D16"
    ]
  },
  "scope": {
    "sourceClaims": [
      {
        "pathPrefix": "apps/station/app/subserver/app_meta",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "docs/architecture/local-dev-control-plane",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/global/local-dev-environment.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance/gates.yaml",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance/registry.yaml",
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
        "pathPrefix": "tooling/scripts/local-dev/machine-dev-registry.mjs",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/local-dev/machine-dev.mjs",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/local-dev/machine-dev.test.mjs",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-local-dev-env/SKILL.md",
        "mode": "exclusive-write"
      }
    ],
    "nonGoals": [
      "Change Station product behavior or persistence",
      "Deploy, reset, or migrate a Station runtime",
      "Modify Chat storage governance semantics",
      "Push branches or open a pull request",
      "Rewrite Git history"
    ]
  },
  "tasks": [
    {
      "id": "LDCP-STATION-SYNC-01",
      "workstreamId": "LDCP-STATION-SYNC",
      "path": "tasks/LDCP-STATION-SYNC-01.md",
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
      "push": "denied",
      "pullRequest": "denied"
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
    "ldcp-station-source-aware-sync": [
      "machine-dev-registry-self"
    ]
  },
  "completion": [
    "machine-dev-registry-self"
  ],
  "full": [
    "machine-dev-registry-self",
    "acceptance-plan-self",
    "acceptance-infra-validation"
  ]
}
```

## Goal

Integrate commit `9e4c0627b` into the current `peers-touch-git` head while
preserving newer target-branch Profile override and Chat Acceptance registry
changes.

## Completion

- Explicit Profile selection registers a fresh worktree with an available slot.
- A healthy remote Station is reused only when its live build commit matches
  the current Git HEAD.
- Stale or unavailable build identity enters the exact-source deployment path.
- Typed downstream deployment failures remain visible.
- Target-only changes in the four overlapping files remain intact.
