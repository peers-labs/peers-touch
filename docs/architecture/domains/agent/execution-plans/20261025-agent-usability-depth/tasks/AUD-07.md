# AUD-07：同一任务的过程呈现与恢复串验

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AUD-20261025",
  "taskId": "AUD-07",
  "workstreamId": "AUD-RECOVERY",
  "title": "把写/命令/web/todo/产物活动统一进 Turn 时间线，并串验审批后续跑、断网、切页、重启恢复",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "aud-j07-process-recovery",
  "closureId": "aud-v05-recovery",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src/store/chat.ts",
    "apps/desktop/src/store/agentTurnRecovery.ts",
    "apps/desktop/src/components/messages/ToolCallCard.tsx",
    "apps/desktop/src/components/portal",
    "apps/desktop/src/services/eventStream.ts",
    "apps/desktop/src/services/desktop_api.ts",
    "packages/locales"
  ],
  "readSet": [
    "apps/station/app/subserver/agent/service/turn_service.go",
    "apps/station/app/subserver/agent/service/external_runtime_reset_service.go",
    "apps/desktop/src-tauri/src/application/desktop_executor_worker",
    "docs/architecture/domains/agent/modern-chat-agent/proposals/20261022-task-depth-product-amendment.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "aud-07-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "aud-07-desktop-tests",
      "command": "cd apps/desktop && pnpm run test -- agent-turn-recovery",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "aud-07-chat-tests",
      "command": "cd apps/desktop && pnpm run test -- chat",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "命令、工具结果、文件变更、todo、web 取证、等待提问、失败/重试在同一 Topic/Turn 时间线以统一活动卡呈现，默认折叠早期活动；不合成 provider 私有思维链",
    "AskUser 回答或工具批准后原 Turn 继续（既有 ToolBatch/decision 链路）经 Journey 验证；过期/拒绝/执行器离线对应三恢复动作（continue-without/reconnect/request-again）真实可用",
    "短断网→重连 after_sequence 回放不重复用户消息与工具副作用；切页→SSE catchup；Desktop 重启→以 Station 真相重建 session/topic/活动/产物，PREPARED 未知副作用步骤显示不可自动重放",
    "排队项（AUD-06）与产物（AUD-04）纳入重启对账：重启后队列位置与产物列表与 Station 一致",
    "lease 过期/queue full/runtime unavailable/reset_required 等错误态均有用户可懂恢复入口与 i18n 文案，无静默吞错",
    "TD-J04 四类恢复 Journey 在 make desktop 当前源码 FUNCTIONAL_PASS；证据绑定当前 commit，未覆盖的 Station 重启检查点语义显式标 UNPROVEN"
  ],
  "failureBehavior": [
    "不自动重放副作用未知的步骤、不自动新建会话、不重复发送用户消息",
    "不新增第二事件总线或本地活动真相；恢复以 Station turn_events 与 receipt 为准",
    "Station 重启的 PREPARED 接管若 Journey 暴露 D19C 缺口，记录为 Station 缺陷任务而不在客户端伪造成功",
    "恢复 UI 修复若需改 Station 语义，超出本任务时回报 DESIGN/PRODUCT amendment"
  ],
  "updatedAt": "2026-10-25T00:00:00.000Z"
}
```

## 完整闭环

零件（SSE 回放、attempts、fenced receipt、审批、错误分类）此前都存在但未作为“同一用户任务”验证。本任务把新活动类型接入统一时间线，并以四条恢复 Journey 证明中断可控、副作用不重放；缺什么补什么，但不新建内核。
