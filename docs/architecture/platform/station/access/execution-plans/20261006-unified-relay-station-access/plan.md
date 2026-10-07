# Unified Relay or Station Access

> **Plan ID**: SAL-RELAY-20261006
> **Version ID**: SAL-RELAY-20261006-v1
> **Created**: 2026-10-06T06:36:41.000Z

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "SAL-RELAY-20261006",
  "versionId": "SAL-RELAY-20261006-v1",
  "createdAt": "2026-10-06T06:36:41.000Z",
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/station-access-lifecycle/product-definition.md",
      "docs/architecture/station-access-lifecycle/experience-contract.md",
      "docs/architecture/station-access-lifecycle/product-state-model.md",
      "docs/architecture/station-access-lifecycle/acceptance-matrix.md",
      "docs/architecture/station-access-lifecycle/design.md",
      "docs/architecture/station-access-lifecycle/decisions.md",
      "docs/architecture/station-access-lifecycle/data-model.md",
      "docs/architecture/station-access-lifecycle/module-layout.md",
      "docs/architecture/station-access-lifecycle/integration.md",
      "docs/architecture/federation/design.md",
      "docs/architecture/federation/decisions.md",
      "docs/architecture/federation/data-model.md",
      "docs/architecture/federation/module-layout.md",
      "docs/architecture/federation/integration.md"
    ],
    "decisions": [
      "SAL-D07",
      "SAL-D08",
      "SAL-D09",
      "SAL-D10",
      "SAL-D11",
      "D-12",
      "D-13",
      "D-14",
      "D-15",
      "D-16"
    ]
  },
  "scope": {
    "sourceClaims": [
      {
        "pathPrefix": "apps/desktop",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/mobile",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/station/app/conf",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/station/app/main.go",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/station/app/subserver/events/bus.go",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/station/frame/peers.go",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/station/app/subserver/federation",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/station/frame/core/federation",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/station/frame/core/plugin/native/federation",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/station/frame/core/plugin/native/node",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/station/frame/core/plugin/native/subserver/bootstrap",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/station/frame/core/plugin/native/subserver/relay",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/station/frame/core/plugin/native/subserver/relay-client",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/station/frame/core/runtime/role",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/engineering/api-governance",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/architecture-module-governance/architecture-modules.json",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/station-access-lifecycle",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/federation",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/knowledge",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/README.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "model/domain/federation",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "model/domain/peer",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "packages/locales",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/docker",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/local-dev",
        "mode": "exclusive-write"
      }
    ],
    "nonGoals": [
      "Create a separate Relay repository, client registry, session store, or business API",
      "Move Station Access Gate, Session, Federation Ledger, or domain authority into Relay",
      "Expose Relay invite, mount, credential, certificate, or quota controls to ordinary clients",
      "Retain transparent relay forward or client-token as a compatibility fallback",
      "Design Browser client support, a generic VPN, or a service mesh",
      "Reset production or shared user data",
      "Push, open a pull request, merge histories, amend checkpoints, or rewrite history"
    ]
  },
  "tasks": [
    {
      "id": "SAL-REL-01-ROLE-SECURITY",
      "workstreamId": "SAL-RELAY-FOUNDATION",
      "path": "tasks/SAL-REL-01-ROLE-SECURITY.md",
      "dependsOn": []
    },
    {
      "id": "SAL-REL-02-STATION-ENROLLMENT",
      "workstreamId": "SAL-RELAY-FOUNDATION",
      "path": "tasks/SAL-REL-02-STATION-ENROLLMENT.md",
      "dependsOn": [
        "SAL-REL-01-ROLE-SECURITY"
      ]
    },
    {
      "id": "SAL-REL-03-ENDPOINT-DISCOVERY",
      "workstreamId": "SAL-RELAY-ACCESS",
      "path": "tasks/SAL-REL-03-ENDPOINT-DISCOVERY.md",
      "dependsOn": [
        "SAL-REL-02-STATION-ENROLLMENT"
      ]
    },
    {
      "id": "SAL-REL-04-OPAQUE-TUNNEL",
      "workstreamId": "SAL-RELAY-TRANSPORT",
      "path": "tasks/SAL-REL-04-OPAQUE-TUNNEL.md",
      "dependsOn": [
        "SAL-REL-02-STATION-ENROLLMENT",
        "SAL-REL-03-ENDPOINT-DISCOVERY"
      ]
    },
    {
      "id": "SAL-REL-05-DESKTOP-BINDING",
      "workstreamId": "SAL-RELAY-CLIENTS",
      "path": "tasks/SAL-REL-05-DESKTOP-BINDING.md",
      "dependsOn": [
        "SAL-REL-04-OPAQUE-TUNNEL"
      ]
    },
    {
      "id": "SAL-REL-06-MOBILE-BINDING",
      "workstreamId": "SAL-RELAY-CLIENTS",
      "path": "tasks/SAL-REL-06-MOBILE-BINDING.md",
      "dependsOn": [
        "SAL-REL-04-OPAQUE-TUNNEL"
      ]
    },
    {
      "id": "SAL-REL-07-NATIVE-ACCEPTANCE",
      "workstreamId": "SAL-RELAY-DELIVERY",
      "path": "tasks/SAL-REL-07-NATIVE-ACCEPTANCE.md",
      "dependsOn": [
        "SAL-REL-05-DESKTOP-BINDING",
        "SAL-REL-06-MOBILE-BINDING"
      ]
    }
  ],
  "authorization": {
    "checkpoint": {
      "localCommit": "allowed",
      "amend": "denied"
    },
    "delivery": {
      "push": "denied",
      "pullRequest": "denied"
    },
    "runtime": {
      "deployProfiles": [
        "one",
        "two",
        "three"
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
{"closures":{"sal-relay-role-security":["relay-role-security-contract"],"sal-relay-station-enrollment":["relay-station-enrollment-e2e"],"sal-relay-endpoint-discovery":["relay-endpoint-discovery-contract"],"sal-relay-opaque-tunnel":["relay-opaque-tunnel-e2e"],"sal-relay-desktop-binding":["station-access-desktop-relay-native-e2e","station-access-desktop-relay-windows-e2e"],"sal-relay-mobile-binding":["station-access-mobile-relay-native-e2e"],"sal-relay-native-acceptance":["station-access-relay-security-e2e","unified-relay-station-access-aggregate-e2e"]},"completion":["relay-role-security-contract","relay-station-enrollment-e2e","relay-endpoint-discovery-contract","relay-opaque-tunnel-e2e","station-access-desktop-relay-native-e2e","station-access-desktop-relay-windows-e2e","station-access-mobile-relay-native-e2e","station-access-relay-security-e2e","unified-relay-station-access-aggregate-e2e"],"full":["architecture-module-governance","station-api-ownership","proto-build","station-federation-unit","desktop-check","desktop-release-build","mobile-native-build","station-access-auth-e2e","station-access-scope-isolation-e2e","relay-role-security-contract","relay-station-enrollment-e2e","relay-endpoint-discovery-contract","relay-opaque-tunnel-e2e","station-access-desktop-relay-native-e2e","station-access-desktop-relay-windows-e2e","station-access-mobile-relay-native-e2e","station-access-relay-security-e2e","unified-relay-station-access-aggregate-e2e"]}
```

## Goal

让 Desktop 与 Mobile 的同一个接入输入安全识别直连 Station 或 Relay，最终固定同一
Home Station identity、复用同一 Access Gate 和业务 runtime；同时把现有 Relay
原型收口为最小、可撤销、有界且不读取业务明文的 transport。

## Execution DAG

```text
SAL-REL-01-ROLE-SECURITY
  -> SAL-REL-02-STATION-ENROLLMENT
  -> SAL-REL-03-ENDPOINT-DISCOVERY
  -> SAL-REL-04-OPAQUE-TUNNEL
      -> SAL-REL-05-DESKTOP-BINDING
      -> SAL-REL-06-MOBILE-BINDING
          -> SAL-REL-07-NATIVE-ACCEPTANCE
```

Desktop 与 Mobile 只在共同的 protocol、enrollment 和 tunnel 完成后并行。

## Atomic Cutover

- 安全基线先删除未声明 debug egress，并建立 Relay role/TLS/operator auth。
- 新 enrollment ready 后一次性停用 header identity、明文 invite 和共享 JWT。
- opaque tunnel 与 typed peer transport ready 后，同 closure 删除 ANY forward、
  client-token 和 authorization header passthrough。
- 客户端 route-aware binding ready 后，不保留 URL-keyed identity 或 Relay registry。
- 最终只在同一精确源码通过原生双端与攻击面 Acceptance 后关闭计划。

## Review Boundary

本 Plan Version 未挂载。开始实现需要 Owner 显式批准并选择 execution worktree；
批准前不得执行 Task、部署 profile、创建运行资源或生成完成证据。

## Execution Preconditions

- 现有 `one/two/three` profile 可提供多 Station 与共享 Relay 拓扑，但当前示例
  endpoint 为 HTTP；生产 TLS proof 需要单独批准对应外部 `env` 仓库配置变更，
  本 Plan 的 source claims 不授权跨仓写入。
- `peers-relay` 当前没有 active profile registration。执行前必须由 Owner 明确选择
  profile 并完成既有授权流程；不得由 Agent 创建、复制或猜测 profile。
- `sixwin` 已由 Owner 明确授权为 Windows Desktop runtime host；当前 env source
  只有 host inventory，并非 Station/Relay deploy profile。后端继续使用
  `one/two/three`，不得为 sixwin 伪造 Station endpoint。
