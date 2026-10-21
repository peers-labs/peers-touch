# X Config Canonical Cutover And Vercel Preview

> **Plan ID**: XCFG-CUTOVER-20261019
> **Version ID**: XCFG-CUTOVER-20261019-v1
> **Created**: 2026-10-19T07:07:32.000Z

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "XCFG-CUTOVER-20261019",
  "versionId": "XCFG-CUTOVER-20261019-v1",
  "createdAt": "2026-10-19T07:07:32.000Z",
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
      "CCP-D01",
      "CCP-D02",
      "CCP-D03",
      "CCP-D04",
      "CCP-D05",
      "CCP-D06",
      "CCP-D09",
      "CCP-D10",
      "CCP-D11",
      "CCP-D12",
      "CCP-D13",
      "XCFG-D01"
    ]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": "apps/client-control", "mode": "exclusive-write"},
      {"pathPrefix": "apps/x-config", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop", "mode": "exclusive-write"},
      {"pathPrefix": "apps/mobile", "mode": "exclusive-write"},
      {"pathPrefix": "apps/oauth2-client", "mode": "exclusive-write"},
      {"pathPrefix": "apps/station/frame/touch/model", "mode": "exclusive-write"},
      {"pathPrefix": "model/domain/client_control", "mode": "exclusive-write"},
      {"pathPrefix": "model/domain/x_config", "mode": "exclusive-write"},
      {"pathPrefix": "packages/client-control-core", "mode": "exclusive-write"},
      {"pathPrefix": "packages/x-config-core", "mode": "exclusive-write"},
      {"pathPrefix": "packages/github-repository", "mode": "shared-read"},
      {"pathPrefix": "packages/locales", "mode": "shared-read"},
      {"pathPrefix": "packages/prototypes/control/client-control", "mode": "exclusive-write"},
      {"pathPrefix": "packages/prototypes/control/x-config", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/skills/pt-client-control-2-vercel", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/skills/pt-x-config-2-vercel", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture", "mode": "exclusive-write"},
      {"pathPrefix": "docs/client", "mode": "exclusive-write"},
      {"pathPrefix": "docs/global", "mode": "shared-read"},
      {"pathPrefix": "docs/knowledge", "mode": "shared-read"},
      {"pathPrefix": "AGENTS.md", "mode": "exclusive-write"},
      {"pathPrefix": "go.work", "mode": "exclusive-write"},
      {"pathPrefix": "pnpm-workspace.yaml", "mode": "exclusive-write"},
      {"pathPrefix": "pnpm-lock.yaml", "mode": "exclusive-write"}
    ],
    "nonGoals": [
      "Change X Config product capabilities, ownership, trust boundaries, snapshot fields or Station Access behavior",
      "Preserve a Client Control alias, dual-read cache, signature compatibility shim, old environment prefix or parallel cloud project family",
      "Rewrite the frozen CCP-COMPLETE-20261018-v1 Plan Version or relabel historical evidence",
      "Fabricate a publishable Direct Station entry or weaken canonical public HTTPS and owner-consent validation",
      "Promote either Vercel project to Production, push source, open a pull request or merge",
      "Reset stable data, rotate Station identities, delete unrelated cloud projects or purchase a paid hosting plan"
    ]
  },
  "tasks": [
    {
      "id": "XCFG-01-CANONICAL-CUT",
      "workstreamId": "XCFG-SOURCE",
      "path": "tasks/XCFG-01-CANONICAL-CUT.md",
      "dependsOn": []
    },
    {
      "id": "XCFG-02-VERCEL-PREVIEWS",
      "workstreamId": "XCFG-HOSTING",
      "path": "tasks/XCFG-02-VERCEL-PREVIEWS.md",
      "dependsOn": ["XCFG-01-CANONICAL-CUT"]
    },
    {
      "id": "XCFG-03-CLOSURE",
      "workstreamId": "XCFG-PROOF",
      "path": "tasks/XCFG-03-CLOSURE.md",
      "dependsOn": ["XCFG-02-VERCEL-PREVIEWS"]
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
    "x-config-canonical-cut": [
      "x-config-domain-validation",
      "x-config-snapshot-core-contract",
      "x-config-operator-login-contract",
      "x-config-admin-api-contract",
      "x-config-desktop-adapter-contract",
      "x-config-mobile-adapter-contract",
      "x-config-vercel-publication-contract"
    ],
    "x-config-vercel-previews": [
      "x-config-console-admin-e2e",
      "x-config-vercel-publication-e2e"
    ],
    "x-config-cutover-closure": [
      "x-config-api-aggregate-e2e"
    ]
  },
  "completion": [
    "x-config-domain-validation",
    "x-config-snapshot-core-contract",
    "x-config-operator-login-contract",
    "x-config-admin-api-contract",
    "x-config-console-admin-e2e",
    "x-config-desktop-adapter-contract",
    "x-config-mobile-adapter-contract",
    "x-config-vercel-publication-contract",
    "x-config-vercel-publication-e2e",
    "x-config-api-aggregate-e2e"
  ],
  "full": [
    "architecture-module-governance",
    "proto-build",
    "oauth-login-broker-contract",
    "station-access-capability-contract",
    "x-config-domain-validation",
    "x-config-snapshot-core-contract",
    "x-config-operator-login-contract",
    "x-config-admin-api-contract",
    "x-config-console-admin-e2e",
    "x-config-desktop-adapter-contract",
    "x-config-mobile-adapter-contract",
    "x-config-vercel-publication-contract",
    "x-config-vercel-publication-e2e",
    "x-config-api-aggregate-e2e"
  ]
}
```

## Goal

Replace the active Client Control identity with one canonical X Config module
across contracts, source, clients, evidence and deployment automation, then
publish exact-source Vercel Previews without retaining compatibility aliases or
promoting Production.

## Dependency DAG

```text
XCFG-01-CANONICAL-CUT
  -> XCFG-02-VERCEL-PREVIEWS
  -> XCFG-03-CLOSURE
```

The source cut is atomic. Its rollback is a VCS revert of the complete cut
commit. Vercel project rename is admitted only after both old projects are
confirmed empty; Preview rollback restores project settings or removes only
task-owned unaliased deployments. Production aliases are not mutated.
