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
    "apps/station/app/subserver/agent/service/externalruntime",
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
    "tooling/scripts/deploy",
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
      "command": "cd apps/station && go test -race -count=1 ./frame/core/plugin/native/subserver/relay/... && cd ../.. && python3 -m unittest tooling.scripts.deploy.test_source_sync",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "relay-role-windows-compile",
      "command": "cd apps/station && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go test -c ./app/subserver/agent/service/externalruntime -o /tmp/peers-touch-externalruntime.test.exe",
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
    "Role route inventory and secret-redaction tests pass",
    "The reviewed sixwin profile can deploy isolated exact-source Station and Relay Windows services with SQLite, persistent logs, health, status, and stop ownership"
  ],
  "failureBehavior": [
    "Do not create a separate Relay repository, binary fork, or business handler copy",
    "Do not use a denylist that exposes newly added Station handlers by default",
    "Do not allow production plaintext or insecure TLS verification",
    "Do not log credentials, grants, payloads, or high-cardinality route identifiers"
  ],
  "updatedAt": "2026-10-06T09:59:30.000Z"
}
```

## Objective

先把 Relay 变成可审计的最小公网运行单元，再允许任何 enrollment 或客户端接入。

## Current Snapshot

- Source checkpoint `e7c3ecf74` 已建立显式 role allowlist、生产安全启动校验，
  dedicated operator auth、secret redaction 与零 debug egress。
- `relay-role-security-contract` 已在 exact-source checkpoint `0c04bb2a1`
  的 sixwin Windows-native Station/Relay 上达到 `PASS/DONE/PROVEN`。
- v2 首次 exact-source sixwin 构建在 Windows process completion 判断处失败；
  v3 将 `externalruntime` 纳入 Task 写集并要求交叉编译通过后再部署。
- v3 已在 sixwin 完成隔离 Station/Relay 启动、TLS 1.3、ACL 和最小路由验证；
  v4 补齐首批 5 个 Gate 后，Development runner 又发现当前 source impact 要求
  16 个额外 Gate。v5 只修复该 formal Gate inventory。
- sixwin 部署实现必须保留 remote-platform 传播、隔离 checkout/runtime、
  SQLite 配置、TLS/key provisioning 与持久进程 owner。
