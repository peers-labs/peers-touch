# Unified Relay or Station Access

> **Plan ID**: SAL-RELAY-20261006
> **Version ID**: SAL-RELAY-20261006-v8
> **Created**: 2026-10-07T05:58:54.000Z

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "SAL-RELAY-20261006",
  "versionId": "SAL-RELAY-20261006-v8",
  "createdAt": "2026-10-07T05:58:54.000Z",
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
        "pathPrefix": "apps/station/app/subserver/agent/service/externalruntime",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/station/app/subserver/events/bus.go",
        "mode": "exclusive-write"
      },
      {"pathPrefix": "apps/station/app/subserver/dashboard", "mode": "exclusive-write"},
      {"pathPrefix": "apps/station/frame/touch/model/peer/access_endpoint.pb.go", "mode": "exclusive-write"},
      {
        "pathPrefix": "apps/station/frame/peers.go",
        "mode": "exclusive-write"
      },
      {"pathPrefix": "apps/station/app/subserver/federation", "mode": "exclusive-write"},
      {"pathPrefix": "apps/station/app/subserver/actor_identity", "mode": "exclusive-write"},
      {"pathPrefix": "apps/station/app/subserver/key_exchange", "mode": "exclusive-write"},
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
      {"pathPrefix": "apps/station/frame/core/plugin/native/subserver/bootstrap", "mode": "exclusive-write"},
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
      {"pathPrefix": "apps/station/frame/touch", "mode": "exclusive-write"},
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
        "pathPrefix": "docs/architecture/domains/federation",
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
      {"pathPrefix": "docs/global/coding-guide/station", "mode": "exclusive-write"},
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
      },
      {
        "pathPrefix": "tooling/scripts/deploy",
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
        "sixwin",
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
{"closures":{"sal-relay-role-security":["relay-role-security-contract"],"sal-relay-station-enrollment":["relay-station-enrollment-e2e"],"sal-relay-endpoint-discovery":["relay-endpoint-discovery-contract","station-dashboard-unit","station-dashboard-web-check"],"sal-relay-opaque-tunnel":["relay-opaque-tunnel-e2e"],"sal-relay-desktop-binding":["station-access-desktop-relay-native-e2e","station-access-desktop-relay-windows-e2e"],"sal-relay-mobile-binding":["station-access-mobile-relay-native-e2e"],"sal-relay-native-acceptance":["station-access-relay-security-e2e","unified-relay-station-access-aggregate-e2e"]},"completion":["relay-role-security-contract","chat-lifecycle-tree-zero-reference-e2e","station-agent-unit","agent-v2-external-runtime-e2e","agent-v2-kernel-foundation-e2e","agent-core-lifecycle-native-e2e","relay-station-enrollment-e2e","relay-endpoint-discovery-contract","station-dashboard-unit","station-dashboard-web-check","relay-opaque-tunnel-e2e","station-access-desktop-relay-native-e2e","station-access-desktop-relay-windows-e2e","station-access-mobile-relay-native-e2e","station-access-relay-security-e2e","unified-relay-station-access-aggregate-e2e","acceptance-infra-validation","acceptance-plan-self","acceptance-runtime-provisioning-self","acceptance-workflow-contract","chat-lifecycle-call-resolution-e2e","chat-lifecycle-mixed-client-cross-station-e2e","chat-lifecycle-mixed-client-group-mls-e2e","chat-lifecycle-mixed-client-multi-device-e2e","chat-lifecycle-mixed-client-same-station-e2e","mobile-ios-simulator-layout-accessibility-e2e","mobile-simulator-station-lifecycle-e2e","station-access-capability-contract","station-access-desktop-oauth-native-e2e","station-access-domain-validation","station-access-federation-boundary-e2e","station-access-lifecycle-aggregate-e2e"],"full":["architecture-module-governance","station-api-ownership","proto-build","station-federation-unit","station-dashboard-unit","station-dashboard-web-check","chat-lifecycle-tree-zero-reference-e2e","station-agent-unit","agent-v2-external-runtime-e2e","agent-v2-kernel-foundation-e2e","agent-core-lifecycle-native-e2e","desktop-check","desktop-release-build","mobile-native-build","station-access-auth-e2e","station-access-scope-isolation-e2e","relay-role-security-contract","relay-station-enrollment-e2e","relay-endpoint-discovery-contract","relay-opaque-tunnel-e2e","station-access-desktop-relay-native-e2e","station-access-desktop-relay-windows-e2e","station-access-mobile-relay-native-e2e","station-access-relay-security-e2e","unified-relay-station-access-aggregate-e2e","acceptance-infra-validation","acceptance-plan-self","acceptance-runtime-provisioning-self","acceptance-workflow-contract","chat-lifecycle-call-resolution-e2e","chat-lifecycle-mixed-client-cross-station-e2e","chat-lifecycle-mixed-client-group-mls-e2e","chat-lifecycle-mixed-client-multi-device-e2e","chat-lifecycle-mixed-client-same-station-e2e","mobile-ios-simulator-layout-accessibility-e2e","mobile-simulator-station-lifecycle-e2e","station-access-capability-contract","station-access-desktop-oauth-native-e2e","station-access-domain-validation","station-access-federation-boundary-e2e","station-access-lifecycle-aggregate-e2e"]}
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

本 Plan Version 未挂载；开始实现需 Owner 显式批准并选择 execution worktree，批准前不得执行 Task、部署 profile、创建运行资源或生成完成证据。
## Execution Preconditions

- Owner 已明确授权补全 `sixwin` profile，并在 `10.36.3.187` 上创建隔离的
  `sixwin-station` 与 `sixwin-relay` Windows-native deploy 定义；外部 `env`
  仓库改动必须只落在 `peers-touch/sixwin/**`，且不得提交密钥。
- sixwin Station 与 Relay 使用独立 checkout、runtime、SQLite 数据库、端口、
  TLS 1.3 证书和 signing/operator key；不得触碰既有 `C:\peers-touch`。
- 最终双 Station 验收复用 `sixwin` 与 `three`；`one` 已被其他工作占用，本 Plan Version 不授权选择、部署、重启或测试 `one`。
- sixwin 首次 exact-source 构建暴露的 Windows `externalruntime` 编译问题属于 Task 1；v3 将该既有路径纳入写集。
- v3-v5 补齐 Windows source scope 与 formal Gate inventory；v6 补充 SAL-REL-03 的 Dashboard operator 和完整生成绑定写集；v7 仅补齐该 Dashboard source impact 要求的 `station-dashboard-unit` 与 `station-dashboard-web-check` formal Gate。
- v8 仅补齐 SAL-REL-04 原子 hard cut 已确认的 Actor resolver、Key Exchange、Actor Identity、bootstrap 与文档消费者写集，不改变协议、Journey、DAG、Gate 或授权语义。
