# SAL-REL-06-MOBILE-BINDING - Mobile 统一 Station Binding

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SAL-RELAY-20261006",
  "taskId": "SAL-REL-06-MOBILE-BINDING",
  "workstreamId": "SAL-RELAY-CLIENTS",
  "title": "Mobile 自动识别 Station 或 Relay 并扩展 station-keyed route binding",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "sal-relay-mobile-binding",
  "journeyId": "SAL-J01-J02-J03-J06-J07-J09",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/mobile",
    "docs/architecture/platform/station/access",
    "docs/knowledge",
    "packages/locales",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/station/frame/core/plugin/native/subserver/bootstrap",
    "apps/station/frame/core/plugin/native/subserver/relay",
    "docs/architecture/domains/federation",
    "model/domain/federation",
    "model/domain/peer"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 5400,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "mobile-relay-source",
      "command": "pnpm --dir apps/mobile test -- --run && cd apps/mobile/src-tauri && cargo test station",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mobile-relay-ux",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-access-mobile-relay-native-e2e",
      "verificationClass": "UX_REVIEW"
    },
    {
      "id": "mobile-relay-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-access-mobile-relay-native-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "mobile-relay-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-access-mobile-relay-native-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "The existing Mobile Station input accepts direct Station, Relay, and private connection material",
    "Mobile verifies signed endpoint role, route attestation, inner TLS SPKI, and final Station identity",
    "The current stationPeerId-keyed registry stores multiple route candidates and active route revision",
    "Relay origin no longer conflicts with Station canonical_origin because route and identity checks are distinct",
    "Same-Station route switching preserves Session and all business runtimes",
    "Switching between Direct and Via Relay requires explicit confirmation because network privacy changes",
    "Different Station identity performs the existing full scope teardown",
    "iOS Simulator proves selection, login, restart, explicit direct-to-Relay switching, revoke, and recovery"
  ],
  "failureBehavior": [
    "Do not weaken existing Station signature, challenge, expiry, capability, or PeerID checks",
    "Do not make Relay origin the Actor or Station identity",
    "Do not add a second auth/session/runtime path for Relay",
    "Do not accept an expired attestation or revoked generation from persisted state"
  ],
  "updatedAt": "2026-10-06T06:10:33.000Z"
}
```

## Objective

在保留 Mobile 已有 `station_peer_id` registry 和签名 identity 校验的前提下，把
单一 direct URL 扩展为多个可信 route，并保持全功能 runtime 连续。

## Current Snapshot

- Mobile registry 已以 `stationPeerId` 为主键，是正确扩展点。
- 当前 identity verifier 强制 `canonical_origin == requested_origin`，因此不能经
  Relay 验证目标 Station。
- Session 和多个业务 runtime 仍直接持有 `stationUrl`，需迁移为 active route
  projection。
