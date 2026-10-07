# SAL-REL-04-OPAQUE-TUNNEL - 有界端到端加密 Relay 数据面

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SAL-RELAY-20261006",
  "taskId": "SAL-REL-04-OPAQUE-TUNNEL",
  "workstreamId": "SAL-RELAY-TRANSPORT",
  "title": "用端到端 TLS opaque tunnel 替换透明任意 HTTP 转发",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "sal-relay-opaque-tunnel",
  "journeyId": "SAL-J06-J07-J09",
  "runtimeClass": "service",
  "writeSet": [
    "apps/station/app/subserver/actor_identity",
    "apps/station/app/subserver/federation",
    "apps/station/app/subserver/key_exchange",
    "apps/station/frame/core/federation",
    "apps/station/frame/core/plugin/native/federation",
    "apps/station/frame/core/plugin/native/subserver/bootstrap",
    "apps/station/frame/core/plugin/native/subserver/relay",
    "apps/station/frame/core/plugin/native/subserver/relay-client",
    "apps/station/frame/touch",
    "docs/architecture/engineering/api-governance",
    "docs/architecture/domains/federation",
    "docs/global/coding-guide/station",
    "docs/knowledge",
    "model/domain/federation",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/desktop",
    "apps/mobile",
    "docs/architecture/station-access-lifecycle",
    "model/domain/peer"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 5400,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "relay-tunnel-source",
      "command": "cd apps/station && go test -race -count=1 ./frame/core/federation/... ./frame/core/plugin/native/federation/... ./frame/core/plugin/native/subserver/relay/... ./frame/core/plugin/native/subserver/relay-client/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "relay-tunnel-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --gate relay-opaque-tunnel-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "relay-tunnel-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate relay-opaque-tunnel-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Client-to-Station inner TLS 1.3 verifies the SPKI bound by Station route attestation",
    "Relay exposes one WSS binary tunnel endpoint and rejects text, compression, redirect, and protocol downgrade",
    "Relay cannot observe HTTP method, path, Authorization, Access Gate input, or business payload",
    "Tunnel framing enforces handshake, idle, request, frame, response, byte, rate, and concurrency limits",
    "Cancellation and disconnect release Relay queue, Station dispatcher, and pending requests",
    "Federation Station-to-Station calls use a typed capability manifest over scoped peer tunnels",
    "Arbitrary ANY forward, relay-client-token, and target authorization header passthrough are deleted",
    "Healthy long-lived streams are not removed by mount age"
  ],
  "failureBehavior": [
    "Never silently truncate an oversized request or response",
    "Never fall back to plaintext or transparent HTTP forwarding",
    "Never let Relay authorize a Station business capability",
    "Never use unbounded ReadAll, queue growth, or goroutine fan-out"
  ],
  "updatedAt": "2026-10-06T06:16:09.000Z"
}
```

## Objective

让 Relay 只承担有界字节转发和可用性职责，所有 Access/Session/业务内容都在目标
Station 内解密和授权；同时收口现有 Station-to-Station 任意 HTTP 代理。

## Current Snapshot

- `/relay/forward/{station}/{path}` 接受 ANY 并复制 headers/body。
- relay-client dispatcher 恢复目标 `Authorization` 后调用本地 HTTP。
- request 超限会被截断后继续处理，response 无硬上限。
- `MaxClients/BandwidthLimit` 不参与数据面执行。
