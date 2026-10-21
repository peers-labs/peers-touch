# CCP-01-CONNECTION-MATERIAL - Authenticated Public Endpoint Material

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CCP-COMPLETE-20261018",
  "taskId": "CCP-01-CONNECTION-MATERIAL",
  "workstreamId": "CCP-TRUST",
  "title": "Generate and verify public Relay and Direct Station connection material without changing Station binding ownership",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "ccp-connection-material",
  "journeyId": "CCP-J02-CCP-J06",
  "runtimeClass": "source-only",
  "writeSet": [
    "model/domain/peer",
    "apps/station/frame/touch/model/peer",
    "packages/station-trust",
    "apps/desktop/src/gen/proto/domain/peer",
    "apps/mobile/src-tauri",
    "tooling/acceptance",
    "docs/architecture/platform/runtime/node-connectivity"
  ],
  "readSet": [
    "apps/station/frame/core/plugin/native/subserver/bootstrap",
    "apps/desktop/src-tauri/src/infrastructure/station_discovery.rs",
    "docs/architecture/platform/station/access"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 60,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "ccp-connection-model",
      "command": "./model/build.sh && cargo test --manifest-path packages/station-trust/Cargo.toml public_connection_material --locked",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccp-connection-owner-scan",
      "command": "node tooling/scripts/architecture/module-governance.mjs validate && rg -n 'PublicEndpointConnectionMaterial|SignedPublicStationAdvertisement' model/domain/peer packages/station-trust apps/station/frame/touch/model/peer",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "One generated peer contract defines canonical origin, expected role and identity, endpoint-scoped TLS trust, lifetime, and Station-root public consent",
    "Go and Rust verify identical exact bytes, domains, bounds, expiry, identity, SPKI, role, and consent semantics",
    "Public material contains no invitation, grant, credential, Session, private key, or business payload",
    "Bare production HTTP is rejected before dialing and imported CA or SPKI never becomes a global trust root",
    "Station Access remains the only owner that can verify a live route and commit a Station binding"
  ],
  "failureBehavior": [
    "Do not hand-edit generated bindings or create parallel DTOs",
    "Do not accept identity returned only by the same unauthenticated HTTP response",
    "Do not weaken existing Station root, Node authorization, route, challenge, or TLS verification"
  ],
  "updatedAt": "2026-10-18T13:54:42.000Z"
}
```

## Objective

Close the reusable bootstrap trust prerequisite before any catalog advertises
IP, self-signed, or authenticated HTTP discovery.

## Current Snapshot

- Signed Station/Node/route verification already exists in Go and Rust.
- Desktop rejects remote HTTP; Mobile permits it only in Debug/Acceptance.
- Public connection material and owner-signed publication consent do not exist.
- No runtime or native-client proof is claimed by this source closure.
