# LARK-01 · 持久入口与快速 ACK

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "lark-capability-closure-20261015",
  "taskId": "LARK-01",
  "workstreamId": "LARK-CLOSURE",
  "title": "持久入口与快速 ACK",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "lark-01",
  "journeyId": "LARK-J01",
  "runtimeClass": "service",
  "writeSet": [
    "apps/station/app/subserver/channel",
    "apps/station/app/subserver/agent/service",
    "model/domain/channel",
    "tooling/acceptance/domains/channel",
    "tooling/acceptance/gates/channel",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/registry.yaml",
    "docs/architecture/domains/agent/execution-plans/20261015-lark-capability-closure",
    "docs/architecture/domains/agent/execution-plans/20261015-lark-capability-closure/plan.md"
  ],
  "readSet": [
    "docs/architecture/domains/agent/execution-plans/20261015-lark-capability-closure/plan.md",
    "docs/architecture/domains/agent/modern-chat-agent"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "source-01",
      "command": "cd apps/station && go test ./app/subserver/channel/... ./app/subserver/agent/service/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "journey-01",
      "command": "python3 tooling/acceptance/domains/channel/journey.py --journey LARK-J01 --manifest \"$PT_SUITE_RUNTIME_MANIFEST\"",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "proof-01",
      "command": "python3 tooling/scripts/acceptance-run.py --gate lark-01-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "同一事件只映射一次 admission；持久接收后 ACK",
    "符合执行模型的所有权/恢复合同；未运行证据保持 UNPROVEN"
  ],
  "failureBehavior": [
    "停止首次失败动作，保留同一业务 identity，禁止伪造 PASS",
    "缺失平台账户/权限只阻塞依赖任务；不自建环境",
    "功能通过后才进入正式 Acceptance"
  ],
  "updatedAt": "2026-10-15T00:00:00.000Z",
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "journey-01",
    "scenarioIds": [
      "LARK-J01-OUTCOME",
      "LARK-J01-RISK"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 1,
    "minWarmReuseRate": 0.5,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  }
}
```

## 用户结果与风险

- Journey: LARK-J01；能力范围见[完整模型](../../20261015-lark-capability-closure/plan.md)。
- 结果：同一事件只映射一次 admission；持久接收后 ACK。
- 风险：重投及进程重启；两个 scenario ID 分别验证结果与该具体风险，不要求通用五变体。

## 协议与消费者交付

先在 model/domain/channel 定义相关 request/event/resource/receipt/state；以 model/build.sh 生成并接通 Station/插件/Rust/TS 消费者。
媒体引用、actor/binding/tenant/sender、幂等键与 revision 均须有 typed 字段与错误码；不扩充任意 JSON envelope。
涉及向导/管理/卡片 UI 时消费已确认原型；RuntimeDescriptor 持有投影，Page 只渲染，boot/reconcile 使用既有内核。

## 迁移与证据

先验证当前源/产物与真实接收者；原源码不存在时返回 SOURCE_SELECTION_REQUIRED，不跨分支复制。
数据库和协议变更先列全消费者、迁移与回退；不删用户数据。Gate/Journey 目前待业务注入，命令是计划入口，不是假定已有可执行适配器。

## Current Snapshot

- 此文件只定义冻结交付合同；运行状态与证据不写回 Task Slice。
