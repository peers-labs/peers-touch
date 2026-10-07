# SAL-REL-03-ENDPOINT-DISCOVERY - 统一接入发现与 Route Attestation

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SAL-RELAY-20261006",
  "taskId": "SAL-REL-03-ENDPOINT-DISCOVERY",
  "workstreamId": "SAL-RELAY-ACCESS",
  "title": "发布可签名验证的 Station 或 Relay endpoint discovery",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "sal-relay-endpoint-discovery",
  "journeyId": "SAL-J01-J06-J07",
  "runtimeClass": "service",
  "writeSet": [
    "apps/desktop/src/gen/proto/domain/peer/access_endpoint_pb.ts",
    "apps/mobile/src/gen/proto/domain/peer/access_endpoint_pb.ts",
    "apps/station/app/subserver/dashboard",
    "apps/station/frame/touch/model/peer/access_endpoint.pb.go",
    "apps/station/frame/core/plugin/native/subserver/bootstrap",
    "apps/station/frame/core/plugin/native/subserver/relay",
    "apps/station/frame/core/plugin/native/subserver/relay-client",
    "docs/architecture/engineering/api-governance",
    "docs/architecture/station-access-lifecycle",
    "docs/architecture/federation",
    "model/domain/federation",
    "model/domain/peer",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/desktop",
    "apps/mobile",
    "apps/station/frame/core/plugin/native/federation"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 3000,
    "cleanupSeconds": 240
  },
  "checks": [
    {
      "id": "relay-discovery-proto-source",
      "command": "python3 tooling/scripts/acceptance-run.py --gate proto-build --gate station-api-ownership",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "relay-discovery-dashboard-source",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-dashboard-unit --gate station-dashboard-web-check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "relay-discovery-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --gate relay-endpoint-discovery-contract",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "relay-discovery-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate relay-endpoint-discovery-contract",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Station and Relay implement one protobuf endpoint discovery capability",
    "Endpoint role is challenge-bound, signed, versioned, and never inferred from URL shape",
    "Relay returns only current Station-signed route attestations for active generations",
    "Public listing requires Station opt-in and private routes require a Station-signed grant",
    "Station registers the private grant digest before returning a ptc1 or deep-link fragment to the operator",
    "Connection material is redacted from HTTP query, Referer, analytics, errors, and logs",
    "One candidate, multiple candidates, no candidate, expired grant, replay, wrong Relay, and forged Station have typed outcomes",
    "Generated Desktop, Mobile, and Go bindings derive from one Proto source"
  ],
  "failureBehavior": [
    "Do not create separate Station and Relay input protocols",
    "Do not let Relay self-sign a Station route",
    "Do not expose mount inventory as the public directory",
    "Do not add JSON fallback or redirect-based role detection"
  ],
  "updatedAt": "2026-10-07T03:59:38.000Z"
}
```

## Objective

让一个接入地址在凭据提交前可靠回答“直连 Station 还是 Relay，以及可到达哪台
Station”，同时保持 Station identity 和公开性由 Station 自己签名。

## Current Snapshot

- Mobile 只能从请求 origin 读取 Station identity，并要求
  `canonical_origin == requested_origin`。
- Desktop probe 仍依赖未签名 health/bootstrap metadata。
- Relay 当前没有客户端 discovery 或 Station route attestation。
