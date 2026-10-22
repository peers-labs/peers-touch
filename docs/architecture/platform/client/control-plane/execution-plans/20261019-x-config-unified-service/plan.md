# X Config Unified Service Cutover

> **Plan ID**: XCFG-UNIFIED-20261019
> **Version ID**: XCFG-UNIFIED-20261019-v1
> **Created**: 2026-10-19T10:47:00.000Z

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "XCFG-UNIFIED-20261019",
  "versionId": "XCFG-UNIFIED-20261019-v1",
  "createdAt": "2026-10-19T10:47:00.000Z",
  "workClass": "refactor",
  "architecture": {
    "sources": [
      "docs/architecture/platform/client/control-plane/README.md",
      "docs/architecture/platform/client/control-plane/product-definition.md",
      "docs/architecture/platform/client/control-plane/experience-contract.md",
      "docs/architecture/platform/client/control-plane/product-state-model.md",
      "docs/architecture/platform/client/control-plane/acceptance-matrix.md",
      "docs/architecture/platform/client/control-plane/design.md",
      "docs/architecture/platform/client/control-plane/decisions.md",
      "docs/architecture/platform/client/control-plane/data-model.md",
      "docs/architecture/platform/client/control-plane/module-layout.md",
      "docs/architecture/platform/client/control-plane/integration.md",
      "docs/architecture/platform/client/control-plane/runtime-verification.md"
    ],
    "decisions": [
      "CCP-D02",
      "CCP-D03",
      "CCP-D04",
      "CCP-D05",
      "CCP-D06",
      "CCP-D09",
      "CCP-D11",
      "XCFG-D01",
      "XCFG-D02"
    ]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": "apps/x-config", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop/src-tauri/src/application/x_config", "mode": "exclusive-write"},
      {"pathPrefix": "apps/mobile/src-tauri/src/runtime/x_config.rs", "mode": "exclusive-write"},
      {"pathPrefix": "apps/oauth2-client", "mode": "exclusive-write"},
      {"pathPrefix": "packages/x-config-core", "mode": "shared-read"},
      {"pathPrefix": "packages/github-repository", "mode": "shared-read"},
      {"pathPrefix": "packages/locales", "mode": "exclusive-write"},
      {"pathPrefix": "packages/prototypes/control/x-config", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/skills/pt-x-config-2-vercel", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture", "mode": "exclusive-write"},
      {"pathPrefix": "docs/knowledge", "mode": "shared-read"}
    ],
    "nonGoals": [
      "Promote X Config to Production",
      "Add multi-operator approval or RBAC",
      "Change snapshot protobuf field numbers or Station Access ownership",
      "Create a second GitHub App, repository, signer service, ledger service or distribution project",
      "Push source, open a pull request or merge"
    ]
  },
  "tasks": [
    {
      "id": "XCFG-U01-SINGLE-SERVICE",
      "workstreamId": "XCFG-SOURCE",
      "path": "tasks/XCFG-U01-SINGLE-SERVICE.md",
      "dependsOn": []
    },
    {
      "id": "XCFG-U02-PREVIEW",
      "workstreamId": "XCFG-PREVIEW",
      "path": "tasks/XCFG-U02-PREVIEW.md",
      "dependsOn": ["XCFG-U01-SINGLE-SERVICE"]
    },
    {
      "id": "XCFG-U03-CLEANUP",
      "workstreamId": "XCFG-CLEANUP",
      "path": "tasks/XCFG-U03-CLEANUP.md",
      "dependsOn": ["XCFG-U02-PREVIEW"]
    }
  ],
  "authorization": {
    "checkpoint": {"localCommit": "allowed", "amend": "denied"},
    "delivery": {"push": "denied", "pullRequest": "denied"},
    "runtime": {"deployProfiles": [], "destructiveResetScopes": []},
    "history": {"rewrite": "denied"}
  }
}
```

## Acceptance Execution

```json
{
  "closures": {
    "x-config-unified-source": [
      "x-config-domain-validation",
      "x-config-snapshot-publication-contract",
      "x-config-admin-api-contract",
      "x-config-console-admin-e2e",
      "x-config-vercel-publication-contract"
    ],
    "x-config-unified-preview": [
      "x-config-operator-login-contract",
      "x-config-vercel-publication-e2e",
      "x-config-production-catalog-e2e"
    ],
    "x-config-unified-cleanup": [
      "x-config-domain-validation"
    ]
  },
  "completion": [
    "x-config-domain-validation",
    "x-config-snapshot-publication-contract",
    "x-config-admin-api-contract",
    "x-config-console-admin-e2e",
    "x-config-operator-login-contract",
    "x-config-vercel-publication-contract",
    "x-config-vercel-publication-e2e",
    "x-config-production-catalog-e2e"
  ],
  "full": [
    "architecture-module-governance",
    "x-config-domain-validation",
    "x-config-snapshot-core-contract",
    "x-config-snapshot-publication-contract",
    "x-config-admin-api-contract",
    "x-config-console-admin-e2e",
    "x-config-operator-login-contract",
    "x-config-desktop-adapter-contract",
    "x-config-mobile-adapter-contract",
    "x-config-vercel-publication-contract",
    "x-config-vercel-publication-e2e",
    "x-config-production-catalog-e2e"
  ]
}
```

## Goal

Replace the independent approval, publisher, ledger, data-repository and
distribution topology with one env-driven X Config service, prove the real
Preview end to end, then remove every obsolete cloud and source resource.

## Dependency DAG

```text
XCFG-U01-SINGLE-SERVICE
  -> XCFG-U02-PREVIEW
  -> XCFG-U03-CLEANUP
```

The source cut is atomic and retains no compatibility path. Cloud cleanup is
admitted only after the unified Preview passes OAuth, persistence, publication,
public readback, and client signature verification.
