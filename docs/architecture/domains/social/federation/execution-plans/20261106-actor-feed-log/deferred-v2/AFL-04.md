# AFL-04 · 设备子链与 actor checkpoint 确定性合流

> **STATUS: DEFERRED to v2（r4，2026-11-07，AD-08）**——v1 为单设备合同（每 actor
> 首建设备一条链，第二设备公开写 typed 拒绝）。本任务移出 v1 tasks/closures/criteria，
> 设计保留备查；v2 启动时随架构 v0.4 §6.2 重新冻结，不构成 v1 完成判定项。

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AFL-20261106",
  "taskId": "AFL-04",
  "workstreamId": "MULTI-DEVICE",
  "title": "CHECKPOINT 合同 + 顺序向量合流 + 设备撤销",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "afl-j04-multidevice",
  "closureId": "afl-04-multi-device-checkpoint",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/social/feed_log.proto",
    "apps/station/app/subserver/social/feed",
    "apps/desktop/src"
  ],
  "readSet": [
    "packages/secure-content-core/src/recovery.rs",
    "apps/station/app/subserver/actor_identity/domain/device.go",
    "apps/station/app/subserver/social/feed"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "afl04-go",
      "command": "cd apps/station/app && go test ./subserver/social/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl04-desktop",
      "command": "pnpm --dir apps/desktop run check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl04-journey",
      "command": "cd apps/station/app && go test ./subserver/social/... -run MultiDeviceCheckpointJourney",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "feed_log.proto 扩展 CHECKPOINT 与 03/07 串行集成分支不冲突（本任务在 03B 后执行）",
    "两设备离线并发→checkpoint 合流不丢不重、两站顺序一致；篡改时钟不改序；并发 UPDATE/TOMBSTONE 时 tombstone 终态",
    "撤销设备在新 checkpoint 后失效；reaction 跨设备按 actor 折叠；主身份离线不阻断既有设备发帖"
  ],
  "failureBehavior": [
    "不做 Mobile 多设备 UI"
  ],
  "updatedAt": "2026-11-06T13:30:00.000Z"
}
```

## 完整闭环

多设备纵向闭环。为避免对新生 feed_log.proto/verifier 的不兼容并发扩展，按 03B→04→07→05 串行集成（F-04 修正）。
