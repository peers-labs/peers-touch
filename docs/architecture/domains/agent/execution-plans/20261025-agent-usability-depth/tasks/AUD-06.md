# AUD-06：运行中队列产品面

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AUD-20261025",
  "taskId": "AUD-06",
  "workstreamId": "AUD-QUEUE",
  "title": "运行中发送进入持久 FIFO：TurnQueueTray 挂载、草稿确认释放、取消与取回编辑、重启对账",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "aud-j06-running-queue",
  "closureId": "aud-v04-turn-queue",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent/agent.proto",
    "apps/station/app/subserver/agent/infrastructure/persistence/turn_queue.go",
    "apps/station/app/subserver/agent/service/turn_admission_service.go",
    "apps/desktop/src/components/chat/TurnQueueTray.tsx",
    "apps/desktop/src/components/ChatInput.tsx",
    "apps/desktop/src/store/chat.ts",
    "apps/desktop/src/store/streaming/handler.ts",
    "apps/desktop/src/services/agent-service.ts",
    "apps/desktop/src/components/agent/workbench",
    "apps/desktop/src/components/agent/workbench/workbench.contract.test.ts",
    "apps/desktop/src/services/desktop_api.ts",
    "packages/locales"
  ],
  "readSet": [
    "apps/station/app/subserver/agent/service/turn_admission_service.go",
    "apps/station/app/subserver/agent/service/turn_service.go",
    "apps/desktop/src/services/openAgentChatSession.ts",
    "docs/architecture/domains/agent/agent-usability-depth/design.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "aud-06-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "aud-06-desktop-tests",
      "command": "cd apps/desktop && pnpm run test -- chat",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "aud-06-queue-test",
      "command": "cd apps/desktop && pnpm run test -- turn-queue",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "streaming 中发送不再被前端禁止：消息携带 client idempotency key 进入 admission；仅在 STARTED/QUEUED 确认（X-Agent-Turn-ID/queued 事件顺序核对）后释放并清空草稿，失败保留草稿",
    "TurnQueueTray 在工作台挂载（workbench 契约测试由排除改为断言其存在与状态），仅展示当前 Conversation 排队项：位置、状态、绑定能力快照；queued 气泡与 tray 双向定位",
    "pending 排队项可取消（调用 queue cancel 并消费取消事件）；“取消并取回编辑”=取消后用原文本+附件恢复草稿，以新幂等键重发；无服务端排队编辑原语不假造",
    "admission preflight 取消/QueueFull/能力不支持有明确原因文案；断线重连以 queue list + after_sequence 对账，不重复生成用户消息",
    "附件草稿随排队项保留（admission 已存 payload hash）；FIFO 完成后 worker 自动开始下一项不在客户端伪造",
    "TD-J03 同类 Journey：运行中发送带附件后续要求→核对顺序→修改/取消排队项→当前运行与其他排队项不受影响，在 make desktop 通过"
  ],
  "failureBehavior": [
    "Direct Model 仅排队语义；external runtime 的实时引导（live steering）本期不做，不支持时显示排队而非伪装已送入会话",
    "不在客户端实现本地队列/调度；Station DB FIFO 是唯一队列真相",
    "排队项不可跨 Topic；取消仅限 pending，running turn 走既有 cancel 语义",
    "若 QUEUED 帧与 turn id 头顺序无法保证草稿安全，停止并回报产品语义缺口，不采用乐观清空"
  ],
  "updatedAt": "2026-10-25T00:00:00.000Z"
}
```

## 完整闭环

用户在 Agent 工作时可以持续表达意图：输入有持久队列承接、顺序可见可撤销，而不是被禁用的发送框或“先停再说”。全部队列状态以 Station admission 为准，客户端只做确认释放与对账，重启/断线不重不丢。

## v4 修订（Owner 裁决 A）

queue entry/API 必须持久 capability snapshot 身份与安全展示摘要；Desktop operation 以 conversation + client idempotency/stream identity 支持多实例，运行中发送不得覆盖当前流。pending 取消不新增编辑原语；客户端以后续 queue list 与 after_sequence/SSE 对账为准。
