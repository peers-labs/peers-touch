# LARK-20 · 诊断收尾与旧消费者切换

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "lark-capability-closure-20261015",
  "taskId": "LARK-20",
  "workstreamId": "LARK-CLOSURE",
  "title": "诊断收尾与旧消费者切换",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "lark-20",
  "journeyId": "LARK-J20",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/station/app/subserver/channel",
    "apps/station/app/subserver/agent/service",
    "model/domain/channel",
    "tooling/acceptance/domains/channel",
    "tooling/acceptance/gates/channel",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/registry.yaml",
    "docs/architecture/agent/execution-plans/20261015-lark-capability-closure",
    "docs/architecture/agent/execution-plans/20261015-lark-capability-closure.md",
    "apps/desktop/src/components/settings/channels",
    "apps/desktop/src/runtimes/channelRuntime.ts",
    "apps/desktop/src/services/desktop_api.ts",
    "apps/desktop/src/gen/proto/domain/channel",
    "apps/desktop/src-tauri/src/application/channels",
    "apps/desktop/src-tauri/src/contracts.rs",
    "packages/locales"
  ],
  "readSet": [
    "docs/architecture/agent/execution-plans/20261015-lark-capability-closure.md",
    "docs/architecture/agent/modern-chat-agent"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "source-20",
      "command": "pnpm --dir apps/desktop run check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "journey-20",
      "command": "python3 tooling/acceptance/domains/channel/journey.py --journey LARK-J20 --manifest \"$PT_SUITE_RUNTIME_MANIFEST\"",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "proof-20",
      "command": "python3 tooling/scripts/acceptance-run.py --gate lark-20-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "旧消费者全部切换；无假列表/假统计；脱敏导出与资源释放",
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
    "entryCheckId": "journey-20",
    "scenarioIds": [
      "LARK-J20-OUTCOME",
      "LARK-J20-RISK"
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

- Journey: LARK-J20；能力范围见[完整模型](../../20261015-lark-capability-closure.md)。
- 结果：旧消费者全部切换；无假列表/假统计；脱敏导出与资源释放。
- 风险：插件恢复及诊断敏感内容；两个 scenario ID 分别验证结果与该具体风险，不要求通用五变体。

## 协议与消费者交付

先在 model/domain/channel 定义相关 request/event/resource/receipt/state；以 model/build.sh 生成并接通 Station/插件/Rust/TS 消费者。
媒体引用、actor/binding/tenant/sender、幂等键与 revision 均须有 typed 字段与错误码；不扩充任意 JSON envelope。
涉及向导/管理/卡片 UI 时消费已确认原型；RuntimeDescriptor 持有投影，Page 只渲染，boot/reconcile 使用既有内核。

## 迁移与证据

先验证当前源/产物与真实接收者；原源码不存在时返回 SOURCE_SELECTION_REQUIRED，不跨分支复制。
数据库和协议变更先列全消费者、迁移与回退；不删用户数据。Gate/Journey 目前待业务注入，命令是计划入口，不是假定已有可执行适配器。

## Current Snapshot

- 此文件只定义冻结交付合同；运行状态与证据不写回 Task Slice。
