# LARK-00 · 确认源码、产品合同与能力清单

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "lark-capability-closure-20261015",
  "taskId": "LARK-00",
  "workstreamId": "LARK-CLOSURE",
  "title": "确认源码、产品合同与能力清单",
  "workClass": "documentation",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "lark-00",
  "journeyId": "LARK-J00",
  "runtimeClass": "source-only",
  "writeSet": [
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
      "id": "source-00",
      "command": "make plan-validate PLAN=docs/architecture/domains/agent/execution-plans/20261015-lark-capability-closure/plan.md",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "源码根、产品/原型来源、逐扩展能力清单、真实资源授权均已核实",
    "符合执行模型的所有权/恢复合同；未运行证据保持 UNPROVEN"
  ],
  "failureBehavior": [
    "停止首次失败动作，保留同一业务 identity，禁止伪造 PASS",
    "缺失平台账户/权限只阻塞依赖任务；不自建环境",
    "功能通过后才进入正式 Acceptance"
  ],
  "updatedAt": "2026-10-15T00:00:00.000Z"
}
```

## 用户结果与风险

- Journey: LARK-J00；能力范围见[完整模型](../../20261015-lark-capability-closure/plan.md)。
- 结果：源码根、产品/原型来源、逐扩展能力清单、真实资源授权均已核实。
- 风险：SOURCE_SELECTION_REQUIRED；两个 scenario ID 分别验证结果与该具体风险，不要求通用五变体。

## 协议与消费者交付

核实唯一源码根、可用产品/原型合同、能力动作清单、Gate 注入路径；不切换 worktree、不恢复用户删除文件。

## 迁移与证据

先验证当前源/产物与真实接收者；原源码不存在时返回 SOURCE_SELECTION_REQUIRED，不跨分支复制。
数据库和协议变更先列全消费者、迁移与回退；不删用户数据。Gate/Journey 目前待业务注入，命令是计划入口，不是假定已有可执行适配器。

## Current Snapshot

- 此文件只定义冻结交付合同；运行状态与证据不写回 Task Slice。
