# SAL-REL-02-STATION-ENROLLMENT - Station 注册、轮换与撤销

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SAL-RELAY-20261006",
  "taskId": "SAL-REL-02-STATION-ENROLLMENT",
  "workstreamId": "SAL-RELAY-FOUNDATION",
  "title": "以 Station host-key proof 建立可轮换、可撤销的 Relay mount",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "sal-relay-station-enrollment",
  "journeyId": "SAL-J08",
  "runtimeClass": "service",
  "writeSet": [
    "apps/station/app/conf",
    "apps/station/frame/core/plugin/native/subserver/relay",
    "apps/station/frame/core/plugin/native/subserver/relay-client",
    "docs/architecture/engineering/api-governance",
    "docs/architecture/domains/federation",
    "docs/knowledge",
    "model/domain/federation",
    "tooling/acceptance",
    "tooling/docker",
    "tooling/scripts/local-dev"
  ],
  "readSet": [
    "apps/station/frame/core/plugin/native/subserver/bootstrap",
    "docs/architecture/platform/station/access",
    "model/domain/peer"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "relay-enrollment-source",
      "command": "cd apps/station && go test -race -count=1 ./frame/core/plugin/native/subserver/relay/... ./frame/core/plugin/native/subserver/relay-client/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "relay-enrollment-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --gate relay-station-enrollment-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "relay-enrollment-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate relay-station-enrollment-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Relay derives station_peer_id from a verified Station host public key and challenge signature",
    "Invite plaintext is returned once, only a digest is persisted, and concurrent consume has one winner",
    "Mount credentials use a Relay-specific asymmetric issuer with audience, scopes, jti, expiry, and generation",
    "Credential rotation proves the current Station key and generation",
    "Revoke atomically invalidates generation, closes streams, and rejects refresh and reconnect",
    "Expired cached credentials enter enrollment-required and can recover with a new invite",
    "Relay-client readiness reflects a verified active mount rather than goroutine startup"
  ],
  "failureBehavior": [
    "Never accept X-Station-Peer-ID, label, or invite knowledge as Station identity proof",
    "Never persist or list invite plaintext",
    "Never recreate a revoked mount during handshake",
    "Never share Station application JWT secrets with Relay credentials"
  ],
  "updatedAt": "2026-10-06T05:56:57.000Z"
}
```

## Objective

把当前“invite + header + bearer token”原型替换为绑定 Station host identity 的完整
operator lifecycle，并让撤销在数据库、credential 和 active stream 上同时生效。

## Current Snapshot

- registration 可从 `X-Station-Peer-ID` 接受身份。
- invite 明文持久化并由 list API 返回。
- mount delete 不撤销 token，handshake 可重建被删除 mount。
- 非空缓存 token 被视为可用，过期后缺少重新 enrollment 路径。
