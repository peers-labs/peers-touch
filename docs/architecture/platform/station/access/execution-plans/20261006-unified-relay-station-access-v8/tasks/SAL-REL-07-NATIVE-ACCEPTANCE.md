# SAL-REL-07-NATIVE-ACCEPTANCE - 双端安全聚合验收与硬切

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SAL-RELAY-20261006",
  "taskId": "SAL-REL-07-NATIVE-ACCEPTANCE",
  "workstreamId": "SAL-RELAY-DELIVERY",
  "title": "以两台 Station、一个 Relay 和双端原生客户端证明完整接入生命周期",
  "workClass": "product-behavior",
  "completionClass": "acceptance-aggregate",
  "executionMode": "fix",
  "closureId": "sal-relay-native-acceptance",
  "journeyId": "SAL-J01-J09-AGGREGATE",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/engineering/api-governance",
    "docs/architecture/architecture-module-governance/architecture-modules.json",
    "docs/architecture/station-access-lifecycle",
    "docs/architecture/domains/federation",
    "docs/knowledge",
    "docs/README.md",
    "tooling/acceptance",
    "tooling/docker",
    "tooling/scripts/local-dev"
  ],
  "readSet": [
    "apps/desktop",
    "apps/mobile",
    "apps/station/app/conf",
    "apps/station/app/subserver/events/bus.go",
    "apps/station/app/subserver/federation",
    "apps/station/frame/core/federation",
    "apps/station/frame/core/plugin/native/federation",
    "apps/station/frame/core/plugin/native/subserver/bootstrap",
    "apps/station/frame/core/plugin/native/subserver/relay",
    "apps/station/frame/core/plugin/native/subserver/relay-client",
    "model/domain/federation",
    "model/domain/peer",
    "packages/locales"
  ],
  "budgets": {
    "focusedCheckSeconds": 3600,
    "functionalRunSeconds": 14400,
    "cleanupSeconds": 900
  },
  "checks": [
    {
      "id": "relay-complete-source",
      "command": "node tooling/scripts/architecture/module-governance.mjs validate --repo-root . && python3 tooling/scripts/acceptance-run.py --gate station-api-ownership --gate proto-build --gate station-federation-unit --gate desktop-check --gate mobile-native-build",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "relay-security-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-access-relay-security-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "relay-access-aggregate-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate unified-relay-station-access-aggregate-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "All Plan completion Gates pass against one exact source digest",
    "Two Stations and one Relay prove enrollment, rotation, revoke, reconnect, restart, and overload",
    "Installed macOS and sixwin Windows Desktop plus iOS Simulator complete direct and Relay login with the same Station identity",
    "Both clients preserve actor, session, conversation, social, and local scope across same-Station route switches",
    "Representative cross-Station Chat and Social operations pass through typed opaque transport",
    "Attack tests reject forged identity, invite replay, wrong route, stale generation, bad SPKI, oversize, and quota abuse",
    "Relay observer evidence contains no client Station Session credential or business plaintext",
    "Transparent forward, client-token, plaintext invite, debug egress, and duplicate URL identity paths are absent",
    "All runtime resources and leases are released and the final worktree is clean"
  ],
  "failureBehavior": [
    "Do not waive native, security, restart, revoke, or overload proof with unit tests",
    "Do not reuse evidence from a different source digest or worktree",
    "Do not reset shared or production data",
    "Do not leave Relay, Station, Desktop, Simulator, packet capture, or lease resources running"
  ],
  "updatedAt": "2026-10-06T06:20:25.000Z"
}
```

## Objective

冻结精确源码后，以真实产品路径证明统一接入、安全边界和无烟囱硬切，并完成资源
清理。该 Task 只聚合证据；失败返回对应 owner Task 修复。

## Current Snapshot

- 现有跨 Station evidence 只旁路证明 Relay 可传输部分业务。
- 尚无 dedicated client-via-Relay、PoP enrollment、revoke、rotation、opaque
  plaintext inspection、overload 或双端 route continuity 证据。
