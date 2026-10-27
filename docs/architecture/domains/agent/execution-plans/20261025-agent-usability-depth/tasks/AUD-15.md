# AUD-15：Agent 身份一致性与 AgentGrowth 挂载

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AUD-20261025",
  "taskId": "AUD-15",
  "workstreamId": "AUD-SUPPLY",
  "title": "Cron/Bots/Lark 绑定同源 Station roster；AgentGrowthTab 改接触发调度后挂载；Growth 临时 JSON 补 proto",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "aud-j15-identity-consistency",
  "closureId": "aud-v14-identity-consistency",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src/components/settings/AgentGrowthTab.tsx",
    "apps/desktop/src/components/settings/CronJobsSettings.tsx",
    "apps/desktop/src/components/settings/BotsSettings.tsx",
    "apps/desktop/src/components/settings/channels",
    "apps/desktop/src/services/agent-growth-service.ts",
    "apps/desktop/src/services/desktop_api.ts",
    "apps/desktop/src/modules/index.ts",
    "apps/desktop/src/modules/agentGrowth.ts",
    "apps/desktop/src-tauri/src/application/agent_scheduler/mod.rs",
    "apps/desktop/src-tauri/src/interface/tauri_commands/agent_growth.rs",
    "apps/desktop/src-tauri/src/interface/tauri_commands/agent_scheduler.rs",
    "apps/desktop/src-tauri/src/main.rs",
    "apps/station/app/subserver/agent/handler/growth_handler.go",
    "model/domain/agent/home.proto",
    "packages/locales"
  ],
  "readSet": [
    "apps/desktop/src/services/desktop_api.ts",
    "apps/station/app/subserver/agent/service/scheduler_service.go",
    "docs/architecture/domains/agent/agent-usability-depth/design.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "aud-15-proto-build",
      "command": "./model/build.sh",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "aud-15-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "aud-15-roster-functional",
      "command": "cd apps/desktop && pnpm run test -- agent-roster",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "机械核对+测试钉住：Cron、Bots、Lark automation 三处 Agent 选择器只消费 Station agents roster（listAgents 真相），不存在任何硬编码名单或面局部列表；绑定 id 跨面一致",
    "AgentGrowthTab 的调度器启停控件从内存 scheduler 改接 AUD-09 持久调度 API（或在持久 API 未覆盖的系统任务上显式禁用并说明），记忆/技能/trust 投影保持既有真实 growth API；随后在 Settings 挂载该 Tab，挂载后无第二调度控制面冲突",
    "growth_handler 中被本任务触及的临时 JSON 契约（至少 scheduler/quick-completion 相关）补 proto-first 类型并切 handler；未触及的 TODO 不伪装已闭合，在结果中列明",
    "Agent Profile Extensions（Skills/MCP）只来自 capability binding snapshot；stale snapshot 禁用能力动作但不阻断普通对话（既有行为回归通过）",
    "命令面板 /help /tools /skills /clear 与动态 token 行为不回归；slash 显示版本化 snapshot",
    "Journey：同一 Agent 在 Cron/Bots/Lark 三处绑定一致；在 Growth Tab 启停调度与 Scheduled Tasks 状态互为一致；make desktop 通过"
  ],
  "failureBehavior": [
    "不创建第二 roster store；原型 agentRoster 是原型层概念，不移植为生产本地真相",
    "AgentGrowthTab 未完成调度改接前保持不挂载，禁止半成品入口",
    "proto 补全只覆盖触面条目，不借机构造 Evaluation/市场入口（nonGoal）",
    "依赖 AUD-09；持久调度未就绪时本任务不做兼容假调度"
  ],
  "updatedAt": "2026-10-25T00:00:00.000Z"
}
```

## 完整闭环

设置深化阶段曾发现并修复“多处各有一份 Agent 名单”的整体断点（原型 plan §6.3）。本任务在生产端钉死同一规则：roster、capability、调度控制各只有一个 Station 真相，并让建成未挂的 Growth 面板在真实电源接通后才出现。
