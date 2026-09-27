# CCU-05 Continuity 与 Call Resolution

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CCU-20260922",
  "taskId": "CCU-05-continuity-call",
  "workstreamId": "CCU-W05",
  "title": "多设备消息连续性与来电仲裁闭环",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ccu-continuity-call",
  "journeyId": "CCU-J05-J07-J08",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "model/domain/federation",
    "model/domain/realtime",
    "apps/station/app/subserver/events",
    "apps/station/app/subserver/federation",
    "apps/station/app/subserver/actor_identity",
    "apps/station/frame/core/facility/session",
    "apps/station/frame/core/federation",
    "apps/desktop/src/kernel/events",
    "apps/desktop/src/messaging",
    "apps/desktop/src/modules/p2p",
    "apps/desktop/src/services",
    "apps/desktop/src-tauri/src/messaging",
    "apps/desktop/src-tauri/src/interface/tauri_commands/account.rs",
    "apps/desktop/src-tauri/src/interface/tauri_commands/realtime.rs",
    "apps/mobile/src/features/call",
    "apps/mobile/src/runtimes",
    "apps/mobile/src/services",
    "apps/mobile/src-tauri/src/messaging",
    "apps/mobile/src-tauri/src/runtime/station_transport",
    "docs/architecture/acceptance-framework",
    "docs/architecture/development-workflow",
    "packages/messaging-core",
    "tooling/acceptance/capabilities",
    "tooling/acceptance/core",
    "tooling/acceptance/domains",
    "tooling/acceptance/environments",
    "tooling/acceptance/features",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/gates/chat",
    "tooling/acceptance/provisioners",
    "tooling/acceptance/registry.yaml",
    "tooling/acceptance/tests",
    "tooling/scripts/local-dev",
    "docs/architecture/api-ownership"
  ],
  "readSet": [
    "docs/architecture/chat-lifecycle",
    "docs/architecture/realtime"
  ],
  "budgets": {
    "focusedCheckSeconds": 3600,
    "functionalRunSeconds": 10800,
    "cleanupSeconds": 900
  },
  "checks": [
    {
      "id": "ccu-05-continuity-source",
      "command": "cd apps/station && go test ./app/subserver/events/... ./app/subserver/federation/... ./app/subserver/actor_identity/... ./frame/core/federation/... ./frame/core/facility/session/... && cd ../desktop && pnpm run check && cd ../.. && pnpm mobile:check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccu-05-continuity-functional",
      "command": "python3 -m tooling.acceptance.gates.chat.lifecycle_call_resolution",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "ccu-05-multi-device-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-mixed-client-multi-device-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "ccu-05-call-resolution-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-call-resolution-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "sender companion、actor read cursor、offline/reconnect/restart 与 revoke 在 Desktop/Mobile 间单调收敛",
    "Callee Home Station 使用 durable CAS 对每个 call_id 执行 first-terminal-action-wins",
    "winner 进入 active_here，loser 进入 handled_elsewhere 并释放 ring、timer 与临时媒体资源",
    "duplicate、partition、Station restart/failover、NO_ANSWER、TTL 与 winner media failure 按 CCU-D06 fail closed",
    "CHAT-G18 与 CHAT-G19 使用 current exact-source mixed-client evidence 通过"
  ],
  "failureBehavior": [
    "内存锁、单客户端状态或双 Desktop 结果不得替代 durable CAS 与 Desktop/Mobile receiver proof",
    "任一 identity scope 泄漏、read cursor 回退或第二媒体会话都保持未完成"
  ],
  "updatedAt": "2026-09-23T22:20:00Z",
  "durableEvidence": []
}
```

## 范围

落地 `CCU-J05`、`CCU-J07` 与 `CCU-J08`，把消息连续性和同一 actor 的 call
resolution 放在一个跨设备结果中验证。

## 依赖

- CCU-04-group-interaction-cutover

## Current Snapshot

- State: pending and UNPROVEN.
- 当前 `call_resolution.go` 与客户端状态机只构成实现基础；在 durable CAS、
  重启/failover、TTL 和真实 Desktop/Mobile receiver proof 完成前不得关闭。
