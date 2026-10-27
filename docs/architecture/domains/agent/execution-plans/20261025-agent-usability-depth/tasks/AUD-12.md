# AUD-12：Memory 配置诚实化与条目编辑

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AUD-20261025",
  "taskId": "AUD-12",
  "workstreamId": "AUD-SUPPLY",
  "title": "Memory 配置节透传 Station 真实 embedding/status，删除假 PG test；Browse 支持真实编辑删除",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "aud-j12-memory-honesty",
  "closureId": "aud-v08-memory-honesty",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src/components/settings/MemorySettingsTab.tsx",
    "apps/desktop/src/components/settings/MemorySettingsSection.tsx",
    "apps/desktop/src-tauri/src/application/system/mod.rs",
    "apps/desktop/src-tauri/src/interface/tauri_commands/system.rs",
    "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
    "apps/desktop/src-tauri/src/main.rs",
    "apps/desktop/src/services/desktop_api.ts",
    "apps/desktop/src/store/memory.ts",
    "apps/desktop/src/services/memory-service.ts",
    "packages/locales"
  ],
  "readSet": [
    "apps/station/app/subserver/agent/handler/memory_handler.go",
    "apps/station/app/subserver/agent/service/memory_service.go",
    "apps/desktop/src-tauri/src/interface/tauri_commands/memory.rs",
    "docs/architecture/domains/agent/agent-usability-depth/design.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "aud-12-rust-check",
      "command": "cd apps/desktop/src-tauri && cargo check",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "aud-12-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "aud-12-memory-test",
      "command": "cd apps/desktop && pnpm run test -- memory",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "删除 system 域假 PG 连通与假 embedding 列表（application/system/mod.rs 的 config_test_postgres 恒成功、embedding_models_list 合成桩，及 tauri_commands/system.rs、http_gateway、main.rs 注册与 desktop_api 包装的同一链路）：配置节改透传 Station /agent/memory/embedding-status 与 stats；Station 不可用时显示不可用而非绿灯；真实 memory 命令面（tauri_commands/memory.rs、application/memory）不得删除",
    "DSN/backend 类配置不提供“假测试成功”；该类配置如 Station 无写 API 则不在客户端暴露编辑控件（只读状态），无控件剧场；Rust 删除与 TS 消费者拆除在同一 cut，无死命令窗口",
    "Browse tab 行操作接真实 update/delete（Station 端点已存在）：编辑为结构化表单、删除二次确认；操作后列表、检索结果与 events tab 如实变化",
    "记忆条目显示来源/scope/归因（既有字段）；consolidation 区域不存在开关（后端无此能力），不给假入口",
    "Persona/events/stats 既有真实投影不回退；全部新文案走 i18n",
    "Journey：查看真实 embedding 状态→编辑一条记忆→检索确认变化→删除→事件流记录；断 Station 显示不可用，在 make desktop 通过"
  ],
  "failureBehavior": [
    "不实现 consolidation（nonGoal）；不新增本地记忆存储与 Station 竞争",
    "删除操作不做硬删外的批量动作；Station 的快照/事件历史不因 UI 删除被破坏",
    "若 Station embedding-status 字段不足以驱动 UI，只展示有权威字段，不补合成状态",
    "Rust 命令删除须与 TS 消费者同批，无死命令窗口"
  ],
  "updatedAt": "2026-10-25T00:00:00.000Z"
}
```

## 完整闭环

记忆数据本身早已由 Station 真实承载，缺口只在配置假灯与条目管理动作。本任务移除“恒成功”的测试面，让状态与 Station 一致，并把 MCA-B09 要求的可编辑/可删除落到真实 API；无后端能力的 consolidation 不给控件。
