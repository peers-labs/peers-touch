# SAL-REL-01-ROLE-SECURITY - Relay 最小角色与安全基线

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SAL-RELAY-20261006",
  "taskId": "SAL-REL-01-ROLE-SECURITY",
  "workstreamId": "SAL-RELAY-FOUNDATION",
  "title": "建立 Relay 最小运行角色、强制安全配置与无未声明出站基线",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "sal-relay-role-security",
  "journeyId": "SAL-J08-ROLE",
  "runtimeClass": "service",
  "writeSet": [
    "apps/station/app/conf",
    "apps/station/app/main.go",
    "apps/station/app/subserver/events/bus.go",
    "apps/station/frame/peers.go",
    "apps/station/frame/core/federation",
    "apps/station/frame/core/plugin/native/node",
    "apps/station/frame/core/plugin/native/subserver/relay",
    "apps/station/frame/core/runtime/role",
    "docs/architecture/architecture-module-governance/architecture-modules.json",
    "docs/architecture/engineering/api-governance",
    "docs/architecture/federation",
    "docs/knowledge",
    "tooling/acceptance",
    "tooling/docker",
    "tooling/scripts/local-dev"
  ],
  "readSet": [
    "apps/station/app/subserver/federation",
    "apps/station/frame/core/plugin/native/subserver/relay-client",
    "docs/architecture/station-access-lifecycle",
    "model/domain/federation"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "relay-role-source",
      "command": "cd apps/station && go test -race -count=1 ./frame/core/plugin/native/subserver/relay/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "relay-role-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --gate relay-role-security-contract",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "relay-role-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate relay-role-security-contract",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Relay and Station are explicit runtime roles assembled from one repository and binary",
    "Relay role exposes only health, signed discovery, operator admin, mount, tunnel, and metrics",
    "Production Relay fails startup without TLS, signing key, operator policy, and quotas",
    "Relay admin rejects Station app JWTs and requires dedicated audience and scope",
    "Hardcoded 192.0.2.12 debug egress and every undeclared outbound endpoint are removed",
    "Role route inventory and secret-redaction tests pass"
  ],
  "failureBehavior": [
    "Do not create a separate Relay repository, binary fork, or business handler copy",
    "Do not use a denylist that exposes newly added Station handlers by default",
    "Do not allow production plaintext or insecure TLS verification",
    "Do not log credentials, grants, payloads, or high-cardinality route identifiers"
  ],
  "updatedAt": "2026-10-06T06:36:41.000Z"
}
```

## Objective

先把 Relay 变成可审计的最小公网运行单元，再允许任何 enrollment 或客户端接入。

## Current Snapshot

- Relay compose 使用 Station image，但没有明确 role allowlist。
- `app/main.go`、`frame/peers.go` 与 native plugin injection 当前无条件装配业务面。
- stream TLS 为空时回退明文，relay-client 默认 `use-tls: false`。
- 两处 Station 源码仍向 `http://192.0.2.12:7784/event` 发送 debug 数据。
