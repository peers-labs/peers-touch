# SAL-REL-05-DESKTOP-BINDING - Desktop 统一 Station Binding

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SAL-RELAY-20261006",
  "taskId": "SAL-REL-05-DESKTOP-BINDING",
  "workstreamId": "SAL-RELAY-CLIENTS",
  "title": "Desktop 自动识别 Station 或 Relay 并以 Station identity 管理 route",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "sal-relay-desktop-binding",
  "journeyId": "SAL-J01-J02-J03-J06-J07-J09",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop",
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
      "id": "desktop-relay-source",
      "command": "pnpm --dir apps/desktop check && cd apps/desktop/src-tauri && cargo test station_binding && cargo test station_registry && cargo test station_transport",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "desktop-relay-ux",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-access-desktop-relay-native-e2e",
      "verificationClass": "UX_REVIEW"
    },
    {
      "id": "desktop-relay-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-access-desktop-relay-native-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "desktop-relay-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-access-desktop-relay-native-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "desktop-windows-client-via-linux-relay-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-access-desktop-relay-windows-e2e --runtime-cell desktop-windows-native",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "The existing Station input accepts direct Station, Relay, and private connection material",
    "Desktop verifies signed endpoint role and Station identity before credential submission",
    "Registry identity is station_peer_id and one binding stores direct and Relay route candidates",
    "One Relay candidate auto-selects while multiple candidates show an explicit Station chooser",
    "UI presents Home Station identity plus Direct or Via Relay without Relay admin concepts",
    "Same-Station route switching preserves Session and business scope while fencing stale transport results",
    "Switching between Direct and Via Relay requires explicit confirmation because network privacy changes",
    "A different Station identity requires confirmation and full scope teardown",
    "Installed macOS Desktop and the authorized sixwin Windows Desktop runtime exercise the same discovery schema, persistence migration, and route recovery against the Linux Relay on one"
  ],
  "failureBehavior": [
    "Do not keep a URL-keyed identity owner or add a separate Relay registry",
    "Do not trust unsigned health or bootstrap metadata as identity",
    "Do not expose Relay credential, invite, mount, or internal route ID",
    "Do not waive installed-app proof with web-only evidence"
  ],
  "updatedAt": "2026-10-08T14:28:33.000Z"
}
```

## Objective

把 Desktop 当前 URL-keyed Station picker 与未签名 probe 硬切为一个
station-keyed、route-aware、安全可恢复的接入生命周期。

## Current Snapshot

- `StationRegistry` 以 URL 去重并保存 `active_url`。
- probe 只调用 `/sub-oss/healthz` 和 `/sub-bootstrap/info`。
- 多个 Desktop runtime 与持久化路径直接使用 `station_url`，需逐 owner 区分
  identity scope 与 transport endpoint。
- `sixwin` 是 Owner 授权的 Windows Desktop runtime host，不是 Station/Relay
  backend profile；其 Relay journey 必须连接 `one` 上的 Linux Relay。
