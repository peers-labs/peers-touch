# Architecture Module Governance

> **Status**: active
> **Branch**: work/station-access-lifecycle
> **Workspace ID**: 95620934d3348d95
> **Initial HEAD**: 4b96c50cd5177a61fb01d2a901a2541fb727b383

## Plan Package

```json
{
  "kind": "peers-touch-plan-package",
  "planId": "AMG-20260927",
  "status": "active",
  "binding": {
    "branch": "work/station-access-lifecycle",
    "workspaceId": "95620934d3348d95",
    "initialHead": "4b96c50cd5177a61fb01d2a901a2541fb727b383"
  },
  "workClass": "infrastructure",
  "architecture": {
    "sources": [
      "docs/architecture/architecture-module-governance/README.md",
      "docs/architecture/architecture-module-governance/design.md",
      "docs/architecture/architecture-module-governance/decisions.md",
      "docs/architecture/architecture-module-governance/data-model.md",
      "docs/architecture/architecture-module-governance/module-layout.md",
      "docs/architecture/architecture-module-governance/integration.md"
    ],
    "decisions": [
      "AMG-D01",
      "AMG-D02",
      "AMG-D03",
      "AMG-D04",
      "AMG-D05"
    ]
  },
  "scope": {
    "sourceClaims": [
      {
        "pathPrefix": "AGENTS.md",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "apps/desktop/src/services/mock-gateway.ts",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/README.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/global/architecture-document-standard.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/global/coding-guide/common/testing.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/global/coding-guide/desktop/service-api.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/architecture-module-governance",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/station-access-lifecycle",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/boundaries",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/api-ownership/station-api-capabilities.yaml",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "docs/architecture/development-workflow",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "docs/knowledge",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/plugins/pt-ew-plugin",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/architecture",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/plan",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/review",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/local-dev",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/agent-integration-audit.py",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/agent-integration-audit-test.py",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/agent-integration-control.py",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "tooling/skills/pt-architecture-design-methodology",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-plan-and-document",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-github-review",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/make/review.mk",
        "mode": "exclusive-write"
      }
    ],
    "nonGoals": [
      "Change end-user product behavior or runtime protocols",
      "Bulk-backfill every existing architecture module",
      "Keep deleted interface names as a permanent blacklist",
      "Create or acquire a product runtime",
      "Push, open a pull request, merge, or rewrite history"
    ]
  },
  "tasks": [
    {
      "id": "AMG-01-DOCUMENT-CONTRACT",
      "workstreamId": "AMG-DOCUMENTS",
      "path": "tasks/AMG-01-DOCUMENT-CONTRACT.md",
      "dependsOn": [],
      "status": "done",
      "blocker": null
    },
    {
      "id": "AMG-02-MODULE-REGISTRY",
      "workstreamId": "AMG-CONTRACT",
      "path": "tasks/AMG-02-MODULE-REGISTRY.md",
      "dependsOn": [
        "AMG-01-DOCUMENT-CONTRACT"
      ],
      "status": "done",
      "blocker": null
    },
    {
      "id": "AMG-03-ENFORCEMENT",
      "workstreamId": "AMG-ENFORCEMENT",
      "path": "tasks/AMG-03-ENFORCEMENT.md",
      "dependsOn": [
        "AMG-02-MODULE-REGISTRY"
      ],
      "status": "done",
      "blocker": null
    },
    {
      "id": "AMG-04-PROOF",
      "workstreamId": "AMG-PROOF",
      "path": "tasks/AMG-04-PROOF.md",
      "dependsOn": [
        "AMG-03-ENFORCEMENT"
      ],
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
    "amg-document-contract": [],
    "amg-module-registry": [
      "architecture-module-governance"
    ],
    "amg-enforcement": [
      "architecture-module-governance"
    ],
    "amg-proof": [
      "architecture-module-governance",
      "acceptance-plan-self",
      "acceptance-infra-validation",
      "acceptance-workflow-contract",
      "development-workflow-control-plane",
      "peers-dev-product",
      "workspace-plan-generation-self"
    ]
  },
  "completion": [
    "architecture-module-governance",
    "acceptance-plan-self",
    "acceptance-infra-validation",
    "acceptance-workflow-contract",
    "development-workflow-control-plane",
    "peers-dev-product",
    "workspace-plan-generation-self"
  ],
  "full": [
    "architecture-module-governance",
    "acceptance-plan-self",
    "acceptance-infra-validation",
    "acceptance-runtime-provisioning-self",
    "acceptance-workflow-contract",
    "chat-lifecycle-tree-zero-reference-e2e",
    "desktop-release-build",
    "development-workflow-control-plane",
    "mobile-native-build",
    "peers-dev-product",
    "proto-build",
    "station-access-auth-e2e",
    "station-access-capability-contract",
    "station-access-domain-validation",
    "station-access-federation-boundary-e2e",
    "station-access-lifecycle-aggregate-e2e",
    "station-access-scope-isolation-e2e",
    "station-api-ownership",
    "workspace-plan-generation-self"
  ]
}
```

## Goal

把架构模块的内容完整性、正向能力边界和编辑前上下文变成一套共享的机器契约，
并以 Station Access Lifecycle 完成首个存量模块回填。

## Dependency DAG

```text
AMG-01-DOCUMENT-CONTRACT
  -> AMG-02-MODULE-REGISTRY
  -> AMG-03-ENFORCEMENT
  -> AMG-04-PROOF
```

## Atomic Cutovers

- 文档标准更新与 Station Access 目标态清理在同一 Task 完成。
- module registry 与 validator 同时落地，不提交无消费者配置。
- Hook、Plan、Review 共用 parser 后才删除独立判断。
- 正向 Gate 生效后删除基于迁移名称的库存和验证入口。

## Completion And Non-claims

完成要求：

- 4 个 Task 全部 `done`；
- registered 模块的文档、决策、索引和能力引用全部通过；
- PreToolUse、Plan、Review/CI 共享同一 parser；
- Station Access active 文档只包含当前目标接口；
- formal governance Gate 与 workflow contracts 在最终源码通过。

不声明所有存量模块已经登记，也不声明任何产品运行时行为变化。
