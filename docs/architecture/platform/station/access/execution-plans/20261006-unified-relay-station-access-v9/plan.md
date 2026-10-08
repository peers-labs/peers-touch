# Unified Relay or Station Access

> **Plan ID**: SAL-RELAY-20261006
> **Created**: 2026-10-08T14:28:33.000Z

## Plan

```json
{
  "kind": "peers-touch-plan",
  "planId": "SAL-RELAY-20261006",
  "createdAt": "2026-10-08T14:28:33.000Z",
  "northStar": {"objective":"Deliver one identity-bound Station access lifecycle through a minimal Linux Relay without introducing a second business authority or server-host contract.","successCriteria":[{"id":"SAL-REL-NS-01","statement":"Direct and Relay routes converge on one signed Station identity, Access Gate, Session, and business runtime.","sourceRefs":["SAL-D07","SAL-D08","SAL-D09"]},{"id":"SAL-REL-NS-02","statement":"Relay remains a deny-by-default opaque transport whose service-host implementation, deployment, and evidence are Linux/POSIX-only.","sourceRefs":["SAL-D11","SAL-D13"]},{"id":"SAL-REL-NS-03","statement":"Installed macOS, Windows Desktop, and Mobile clients prove route continuity through the canonical Linux Relay.","sourceRefs":["SAL-D06","SAL-D13"]}]},
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/platform/station/access/product-definition.md",
      "docs/architecture/platform/station/access/experience-contract.md",
      "docs/architecture/platform/station/access/product-state-model.md",
      "docs/architecture/platform/station/access/acceptance-matrix.md",
      "docs/architecture/platform/station/access/design.md",
      "docs/architecture/platform/station/access/decisions.md",
      "docs/architecture/platform/station/access/data-model.md",
      "docs/architecture/platform/station/access/module-layout.md",
      "docs/architecture/platform/station/access/integration.md",
      "docs/architecture/domains/federation/design.md",
      "docs/architecture/domains/federation/decisions.md",
      "docs/architecture/domains/federation/data-model.md",
      "docs/architecture/domains/federation/module-layout.md",
      "docs/architecture/domains/federation/integration.md"
    ],
    "decisions": [
      "SAL-D07",
      "SAL-D08",
      "SAL-D09",
      "SAL-D10",
      "SAL-D11",
      "SAL-D13",
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
        "pathPrefix": "docs/architecture/engineering/architecture-governance/architecture-modules.json",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/platform/station/access",
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
      "Build, deploy, or accept Windows as a Relay service host",
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
      "localCommit": "allowed"
    },
    "delivery": {
      "push": "denied",
      "pullRequest": "denied"
    },
    "runtime": {
      "deployProfiles": [
        "one",
        "sixwin",
        "three"
      ],
      "destructiveResetScopes": []
    },
    "history": {
      "rewrite": "denied"
    }
  },
  "amendments": [],
  "northStarApproval": {"northStarDigest":"d6e82949067dbabc509fea2c5cd1760a0c604116238df26515e241ce7e29094e","approvedBy":"user","approvedAt":"2026-10-08T14:28:33.000Z","decisionRef":"USER-DECISION-20261008-LINUX-ONLY-RELAY-HOST"},
  "criterionCoverage": [{"criterionId":"SAL-REL-NS-01","taskIds":["SAL-REL-02-STATION-ENROLLMENT","SAL-REL-03-ENDPOINT-DISCOVERY","SAL-REL-04-OPAQUE-TUNNEL","SAL-REL-05-DESKTOP-BINDING","SAL-REL-06-MOBILE-BINDING"],"closureIds":["sal-relay-station-enrollment","sal-relay-endpoint-discovery","sal-relay-opaque-tunnel","sal-relay-desktop-binding","sal-relay-mobile-binding"],"gateIds":["relay-station-enrollment-e2e","relay-endpoint-discovery-contract","station-dashboard-unit","station-dashboard-web-check","relay-opaque-tunnel-e2e","station-access-desktop-relay-native-e2e","station-access-desktop-relay-windows-e2e","station-access-mobile-relay-native-e2e"]},{"criterionId":"SAL-REL-NS-02","taskIds":["SAL-REL-01-ROLE-SECURITY","SAL-REL-07-NATIVE-ACCEPTANCE"],"closureIds":["sal-relay-role-security","sal-relay-native-acceptance"],"gateIds":["relay-role-security-contract","station-access-relay-security-e2e","unified-relay-station-access-aggregate-e2e"]},{"criterionId":"SAL-REL-NS-03","taskIds":["SAL-REL-05-DESKTOP-BINDING","SAL-REL-06-MOBILE-BINDING","SAL-REL-07-NATIVE-ACCEPTANCE"],"closureIds":["sal-relay-desktop-binding","sal-relay-mobile-binding","sal-relay-native-acceptance"],"gateIds":["station-access-desktop-relay-native-e2e","station-access-desktop-relay-windows-e2e","station-access-mobile-relay-native-e2e","station-access-relay-security-e2e","unified-relay-station-access-aggregate-e2e"]}]
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
本 Plan 记录 Owner 于 2026-10-08 作出的 Linux-only Relay host 决策。其余 Task 仍需按已挂载 Development Run 与资源声明执行；不得把 `sixwin` profile 用作 Station 或 Relay 服务宿主。

## Execution Preconditions

- Relay service host 仅允许使用 `one` profile 的 Linux/POSIX runtime，canonical endpoint 为 `10.37.118.48`；公网与内网模拟均复用该服务端合同。
- `three` 只用于双 Station journey 所需的辅助 Station。
- `sixwin` 仅授权 Windows Desktop runtime cell 作为客户端连接 `one` 上的 Linux
  Relay；不得在本 Plan 中选择、部署、启动、停止或证明 Windows backend service。
- 所有 Relay TLS/signing/operator key、PostgreSQL/数据卷、日志、进程监管与配额
  证据均来自 Linux runtime；不得增加 Windows Relay adapter 或兼容分支。
- v3-v5 的 Windows Relay 构建与运行记录只作为 frozen 历史保留，不进入 v9
  source scope、Gate 或完成条件；v6 补充 SAL-REL-03 的 Dashboard operator 和完整
  生成绑定写集；v7 补齐对应 formal Gate。
- v8 仅补齐 SAL-REL-04 原子 hard cut 已确认的 Actor resolver、Key Exchange、Actor Identity、bootstrap 与文档消费者写集，不改变协议、Journey、DAG、Gate 或授权语义。
- v9 接受 SAL-D13，删除 Windows Relay 宿主实现、profile 和证明，并将现有 Relay Gate 改绑 `one` 上的 Linux runtime；Windows Desktop 客户端 proof 保留。
