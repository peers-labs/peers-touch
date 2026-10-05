# CCU-03 Direct 与富媒体跨端硬切

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CCU-20260922",
  "taskId": "CCU-03-direct-cutover",
  "workstreamId": "CCU-W03",
  "title": "Direct、文本与富媒体跨端硬切",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ccu-direct-cutover",
  "journeyId": "CCU-J01",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/desktop",
    "apps/mobile",
    "apps/station/app/subserver/conversation",
    "docs/architecture/mobile/prototype",
    "model/domain/chat",
    "packages/client-chat-core",
    "packages/messaging-core",
    "packages/prototypes/mobile/chat",
    "tooling/acceptance/gates/chat"
  ],
  "readSet": [
    "docs/architecture/chat-lifecycle",
    "docs/architecture/messaging-platform",
    "docs/client/chat"
  ],
  "budgets": {
    "focusedCheckSeconds": 3600,
    "functionalRunSeconds": 7200,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "ccu-03-client-checks",
      "command": "cd apps/desktop && pnpm run check && pnpm run build && cd ../.. && pnpm mobile:check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccu-03-direct-functional",
      "command": "cd apps/desktop && pnpm run test",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "ccu-03-direct-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-native-visible-static",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Desktop 与 Mobile 双向打开或复用同一 Direct，并共享 Conversation 与 Message identity",
    "文本、图片、文件与语音附件全部通过 canonical Messaging runtime 和 projection",
    "发送、重试、接收、readback 与附件恢复不再经过 Friend-specific adapter 或 route",
    "失去最后消费者的 Direct legacy Proto、生成物、route、store、fixture 和测试在本 closure 删除",
    "Desktop 与 Mobile source check 通过，Direct focused functional evidence 当前有效"
  ],
  "failureBehavior": [
    "任一客户端仍使用 Friend legacy owner、fallback、双写或兼容映射时保持未完成",
    "源检查或单端结果不声明 mixed-client product PROVEN"
  ],
  "updatedAt": "2026-09-22T15:35:00Z",
  "durableEvidence": []
}
```

## 范围

落地 `CCU-J01` 与 `CCU-J04`。该 closure 同时切换 Desktop、Mobile、native
adapter 和 UI consumer，并删除因 Direct 与富媒体切换而失去最后消费者的遗产路径。

## 依赖

- CCU-02-desktop-runtime

## Claim Boundary

本 Task 关闭 Direct/富媒体实现与 hard-cut，不把静态 Gate 或单端 focused check
升级为 mixed-client `PROVEN`。同 Station 与跨 Station 的正式 receiver proof 由
CCU-06 在同一 exact source 上完成。

## Current Snapshot

- State: pending.
- 已存在大量 canonical Direct、attachment 和 voice-note 基础实现；当前只视为
  feasibility，必须按本 closure 的完整 write set 重新审计和验证。
