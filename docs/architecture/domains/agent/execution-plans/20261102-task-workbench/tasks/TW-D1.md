# TW-D1：任务、Turn 与事件主链

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "TW-20261102",
  "taskId": "TW-D1",
  "workstreamId": "TW-CHAIN",
  "title": "canonical TaskRun↔Conversation↔Turn 合同显式化，durable 事件 watermark replay/live 主链与生产工作面接通",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "tw-j01-task-continuity",
  "closureId": "tw-d1-task-turn-event-chain",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent/agent.proto",
    "model/domain/agent/orchestration.proto",
    "model/domain/agent/turn_stream.proto",
    "apps/station/app/subserver/agent/service/chat_task_service.go",
    "apps/station/app/subserver/agent/service/turn_service.go",
    "apps/station/app/subserver/agent/service/turn_admission_service.go",
    "apps/station/app/subserver/agent/service/event_stream_service.go",
    "apps/station/app/subserver/agent/service/task_event_writer.go",
    "apps/station/app/subserver/agent/handler/turn_handler.go",
    "apps/station/app/subserver/agent/handler/event_stream_handler.go",
    "apps/station/app/subserver/agent/infrastructure/persistence",
    "apps/desktop/src-tauri/src/application/agent_turn",
    "apps/desktop/src-tauri/src/application/agent_event_stream.rs",
    "apps/desktop/src-tauri/src/application/agent_orchestration",
    "apps/desktop/src/services/desktop_api.ts",
    "apps/desktop/src/runtimes/chatRuntime.ts",
    "apps/desktop/src/store/chat.ts",
    "apps/desktop/src/store/agentTurnRecovery.ts",
    "apps/desktop/src/store/chatTurnIdentity.ts",
    "apps/desktop/src/components/agent/workbench",
    "packages/locales",
    "docs/architecture/domains/agent"
  ],
  "readSet": [
    "docs/architecture/domains/agent/task-workbench",
    "docs/architecture/domains/agent/modern-chat-agent",
    "docs/architecture/domains/agent/provider-runtime-strategy.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "tw-d1-proto",
      "command": "./model/build.sh",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "tw-d1-station-tests",
      "command": "cd apps/station && gofmt -l . && go test ./app/subserver/agent/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "tw-d1-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "tw-d1-desktop-tests",
      "command": "cd apps/desktop && pnpm run test -- chat agentTurnRecovery chatTurnIdentity",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "proto-first：canonical 任务/会话归属（Conversation 唯一 task 归属 + TaskRun canonical conversation 引用）、任务目标/标签、terminal vs live 事件类型与 cursor 合同在 model/domain/agent 声明并经 ./model/build.sh 生成；无手写并行 DTO",
    "任务草稿可先于发送存在且不触发模型；首次发送以稳定 client idempotency key 在同一事务原子创建/关联 TaskRun、canonical Conversation 与首个 Turn；重复点击/重放只产生一个 Turn，相同 key 不同输入被拒绝",
    "消息、Turn 状态、失败/取消终态只由 durable TaskEvent / Turn terminal event 经 watermark replay 后订阅 live 重建；text delta/progress 仅 live，不持久化为业务终态；Desktop 移除以本地 optimistic 状态恢复终态的路径",
    "Desktop 刷新与切任务再回来后消息不重复、状态不回退；断线缺口以 after_event_seq/after cursor 对账，事件按 task/turn/attempt 身份去重",
    "Stop 只作用于指定任务活动轮并暂停后续队列；UI 显示停止请求中直到 Station 回读真实终态（completed/failed/cancelled/interrupted），不把本地点击显示为已停止",
    "生产 AgentWorkbench 工作面消费真实任务/会话/轮状态；原型 fixture、simulation、localStorage 业务状态不进入生产",
    "exact-source Native Journey（make desktop，无 Harness 注入）：新建任务真实模型往返、重复发送幂等、刷新恢复、Stop 终态回读、跨任务切换"
  ],
  "failureBehavior": [
    "不宣称 live steer；活动轮输入的 amendment/queue 语义属于 TW-D2",
    "不接入外部双向 runtime，不新增 Browser/Terminal/Artifact 版本承诺",
    "中断的非幂等 LLM turn 不重放，沿用既有步边界 interrupted 合同由用户重发",
    "不在 Rust/React 维护第二套任务或会话业务状态，不用 UI/本地缓存决定终态",
    "R01 手工 AgentTask/任务卡统一只在全部消费者迁移后原子切换；不删除仍有真实消费者的协作/调度路径",
    "所有用户可见文案进 packages/locales；禁止 debug 打印、mock API 与伪造成功"
  ],
  "updatedAt": "2026-11-02T00:00:00.000Z"
}
```

## 完整闭环

用户在生产 Desktop Agent 中把目标发给一个角色：第一次发送原子建立任务与连续对话，真实模型流式返回；重复点击不产生第二个 Turn；刷新、切走再回来，消息与终态由 Station 持久事件重建且不重复不回退；Stop 以回读终态为准。工作面呈现的是 Station 事实，不是原型模拟或本地乐观状态。
