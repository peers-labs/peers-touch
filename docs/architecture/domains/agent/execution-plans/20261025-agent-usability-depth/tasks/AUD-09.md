# AUD-09：Station 持久调度与本地假 Cron 硬切换

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AUD-20261025",
  "taskId": "AUD-09",
  "workstreamId": "AUD-SCHED",
  "title": "ScheduledJob 持久调度（cron/interval/once、专属会话、run history）并删除 Rust 假 cron",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "aud-j09-scheduled-jobs",
  "closureId": "aud-v11-scheduled-jobs",
  "runtimeClass": "service",
  "writeSet": [
    "model/domain/agent/agent.proto",
    "apps/station/app/subserver/agent/infrastructure/persistence/migrations",
    "apps/station/app/subserver/agent/infrastructure/persistence/scheduled_job.go",
    "apps/station/app/subserver/agent/service/scheduled_job_service.go",
    "apps/station/app/subserver/agent/service/channel_turn_executor.go",
    "apps/station/app/subserver/agent/handler/scheduler_handler.go",
    "apps/station/app/subserver/agent/agent.go",
    "apps/desktop/src-tauri/src/interface/tauri_commands/cron.rs",
    "apps/desktop/src-tauri/src/application/cron",
    "apps/desktop/src-tauri/src/application/agent_scheduler/mod.rs",
    "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
    "apps/desktop/src-tauri/src/main.rs",
    "apps/desktop/src/services/desktop_api.ts",
    "apps/desktop/src/components/settings/CronJobsSettings.tsx",
    "apps/desktop/src/components/CronJobDrawer.tsx",
    "packages/locales"
  ],
  "readSet": [
    "apps/station/app/subserver/channel/service/automation.go",
    "apps/station/app/subserver/agent/service/scheduler_service.go",
    "packages/prototypes/desktop/shell/src/ScheduledTasks.tsx",
    "docs/architecture/domains/agent/agent-usability-depth/design.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "aud-09-proto-build",
      "command": "./model/build.sh",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "aud-09-station-tests",
      "command": "cd apps/station && go test ./app/subserver/agent/...",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "aud-09-rust-check",
      "command": "cd apps/desktop/src-tauri && cargo check",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "aud-09-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "agent.proto 定义 ScheduledJob（kind=cron|interval|once、expression、tz、agent 绑定、model/effort/timeout override、delete_after_run、enabled、next_due_at）与 ScheduledJobRun、CRUD/list-runs 契约，./model/build.sh 通过",
    "Station 新表 + sweep worker（参照 channel automation 的 next_due_at 到期幂等扫描）注册进 agent.go worker 组；每次触发经同一 turn admission 以 scheduled_by 归因发起 Turn，不绕过预算/能力策略；重启任务不丢；既有内存 scheduler_service 保留给 silent_review/dogfood 系统任务且不进用户面，用户可见调度仅 ScheduledJob 一个来源",
    "每个 job 创建时绑定专属 Conversation（一一对应），run 记录关联 turn_id，history 可跳到该 Turn 与其产物；删除 job 不删历史会话；一次性任务触发后退役（enabled=false/expired 态）",
    "Desktop 离线时：STATION-owner 能力任务正常执行；需要 CLIENT 工具的任务如实记录执行器离线失败/待重试，不伪造成功",
    "Rust cron 命令原子切到 Station 透传（经 application/agent_scheduler 与新 /agent/scheduled-job/* 端点）：删除 application/cron OnceLock 假仓、合成 runId/runs 与 parse_schedule 原样回显；main.rs generate_handler 与 http_gateway 注册、desktop_api 六个 cron_* invoke 同批改拆，无死命令窗口、中间提交可编译",
    "CronJobsSettings 与 CronJobDrawer（NL 解析真正落点在 Drawer）接真实 API；自然语言解析移植原型本地规则解析器（中英、无新依赖）；shell/workflow 两种执行类型删除；Lark 投递绑定在渠道 delivery 未就绪前隐藏不做假",
    "Journey：创建 interval/cron/once 三类任务→触发→history→暂停→删除；override 生效；Station 重启存活；make desktop 通过"
  ],
  "failureBehavior": [
    "既有内存 scheduler_service 的 silent_review/dogfood 系统任务保持内部实现且不进任何用户界面；冻结裁决为不迁移，用户可见调度仅 ScheduledJob，禁止两套用户可见调度并存",
    "不做服务端任意 shell；调度只能发起 Agent Turn",
    "调度不持有 provider 密钥副本；沿用 Station credential vault",
    "时间/tz 计算必须有单测（夏令时边界可 defer 但 once/cron 下次触发要确定性）"
  ],
  "updatedAt": "2026-10-25T00:00:00.000Z"
}
```

## 完整闭环

定时任务从“重启即丢的本地假动作”变为 Station 持久、可审计、以普通 Turn 语义运行的真实调度；配置、触发、历史、产物都在同一真相链。本地假实现原子删除，不保留兼容窗口。
