# TW-D2：输入队列、审批、草稿和后台介入

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "TW-20261102",
  "taskId": "TW-D2",
  "workstreamId": "TW-INBOX",
  "title": "delivery 回执语义、持久队列项、任务级草稿与审批/AskUser 身份绑定",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "tw-j02-queue-approval-draft",
  "closureId": "tw-d2-inbox-intervention",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent",
    "apps/station/app/subserver/agent",
    "apps/desktop",
    "packages/locales"
  ],
  "readSet": [
    "docs/architecture/domains/agent/task-workbench",
    "docs/architecture/domains/agent/modern-chat-agent"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 3000,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "tw-d2-station-tests",
      "command": "cd apps/station && gofmt -l . && go test ./app/subserver/agent/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "tw-d2-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "tw-d2-desktop-tests",
      "command": "cd apps/desktop && pnpm run test -- chat.turnQueueBinding chat.admissionRecovery chat.stopOperationFifo agentDraft",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "执行中发送输入返回明确 delivery 结果：started、amended、queued、rejected；amended 只发生在 Station 尚未发出不可逆 provider/tool 请求前，发出后只能排队为下一轮，UI 文案如实区分",
    "队列项持久保存完整 request payload、payload hash、client idempotency key、资料/附件引用与 selected capability snapshot；FIFO 自动消费，容量、取消幂等与 Station 重启后 queue list/after_sequence 对账有 Station 并发测试",
    "队列可查看位置、取消与取回编辑；不做前端拖拽假排序；pending 取消后重发是正式语义",
    "审批/AskUser 绑定 turn/attempt/tool call/decision revision；处理后原 Turn 继续或终止；旧审批、旧 epoch 请求不能批准新请求，冲突返回可回读状态",
    "任务级草稿（文本、附件、选区引用）沿既有缓存 Owner 持久化，键绑定 task/conversation/artifact；切任务、关页面、刷新后草稿、附件、待批与队列不丢；未发送输入不调用模型",
    "后台批准/提问只定位并打开所属任务的对应 request，不抢当前阅读与输入焦点",
    "exact-source Native Journey：运行中补充（amended 与 queued 两种现场）、排队取消、旧审批过期、切走后回来处理审批"
  ],
  "failureBehavior": [
    "不对已发出的普通 Direct Model HTTP 请求做伪注入；external runtime steer 只有证据门后才广告",
    "不在客户端维护第二套队列或审批状态；排队消息服务端不可编辑（取消+重发）",
    "不做跨会话记住自动批准；写/命令维持逐次审批",
    "失败、未知副作用或撤权暂停后续 admission，成功终止才按序消费下一项",
    "所有用户可见文案进 packages/locales；禁止 mock 与伪造成功"
  ],
  "updatedAt": "2026-11-02T00:00:00.000Z"
}
```

## 完整闭环

Agent 执行中用户仍可表达：安全时并入当前轮，否则确定地排队到下一轮，每条输入都有回执；队列、草稿与待批在 Station 持久、可取消可恢复；审批和澄清是同一任务中带身份与有效期的显式动作，旧请求不能授权新执行。
