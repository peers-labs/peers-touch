# AUD-01：Provider 预算真相与连续执行

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AUD-20261025",
  "taskId": "AUD-01",
  "workstreamId": "AUD-BUDGET",
  "title": "分离正常续跑、瞬时重试与辅助模型调用的 Provider 预算，消除长依赖链误杀",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "aud-j01-continuation-chain",
  "closureId": "aud-v01-continuation-budget",
  "runtimeClass": "service",
  "writeSet": [
    "apps/station/app/subserver/agent/service/runtime_admission_service.go",
    "apps/station/app/subserver/agent/service/turn_service.go",
    "apps/station/app/subserver/agent/service/turn_runtime_budget_test.go",
    "apps/desktop/src/services/desktop_api.ts",
    "apps/desktop/src/services/errorMappings/chatErrorMapping.ts",
    "packages/locales"
  ],
  "readSet": [
    "apps/station/app/subserver/agent/errcode",
    "docs/architecture/domains/agent/agent-usability-depth/design.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "aud-01-station-gofmt",
      "command": "cd apps/station && gofmt -l app/subserver/agent/service",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "aud-01-agent-tests",
      "command": "cd apps/station && go test ./app/subserver/agent/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "aud-01-continuation-budget-test",
      "command": "cd apps/station && go test ./app/subserver/agent/service -run 'ProviderContinuationBudget'",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "turn_attempt/预算记录区分 provider_continuation_count、provider_retry_count、auxiliary_call_count 三类计数并持久在既有 turn trace 字段中，不新增第二预算存储",
    "reserveProviderAttempt 拆为续跑预留与重试预留：续跑预算来自 runtime profile（与 max_agent_steps 同量级），瞬时失败重试保持 MaxAttempts=3；follow-up/review/compression 走 auxiliary 计数，不吞续跑预算",
    "续跑预算耗尽返回独立错误码（与 TOOL_LOOP_BUDGET_EXHAUSTED、瞬时重试耗尽三者可区分），桌面 errorMappings 有可懂 locale key 文案",
    "新增单测构造至少 6 次 tool-result→model 正常续轮链可完成；瞬时故障仍只重试 3 次后如实失败；max_tool_calls/五分钟时限/循环检测不回退",
    "max_agent_steps、并发工具一次返回多调用、压缩后续跑的计数语义均有测试钉住，不通过把 3 改成大数字实现"
  ],
  "failureBehavior": [
    "不得重置持久计数、不得为绕过预算新建请求路径或第二 provider 调用入口",
    "预算改动不得影响 admission 幂等、payload hash 重放与 conversation 行锁",
    "Station 重启后计数从既有 attempt 记录恢复，不依赖进程内状态",
    "若发现预算语义与 MCA 已接受决策冲突，停止并回报 DESIGN_AMENDMENT_REQUIRED，不擅自改产品语义"
  ],
  "updatedAt": "2026-10-25T00:00:00.000Z"
}
```

## 完整闭环

输入是已接受的 MCA Turn/admission 合同与设计 V01；输出是 Station 侧预算语义的单一真相。普通依赖链不再被失败重试预算误杀，失控循环仍被步数/工具数/时限兜住，三类预算在 trace 与错误码上可区分。本任务不改 UI 工作流、不新增 provider，桌面侧仅消费新错误码；无第二调用路径并存。
