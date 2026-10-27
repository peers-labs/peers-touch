# AUD-08：Knowledge 设置面与检索诚实化

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AUD-20261025",
  "taskId": "AUD-08",
  "workstreamId": "AUD-SUPPLY",
  "title": "Settings→AI→Knowledge 真实面：Station descriptor CRUD、条目树阅读、检索状态诚实显示",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "aud-j08-knowledge-settings",
  "closureId": "aud-v07-knowledge-settings",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent/capability.proto",
    "apps/station/app/subserver/agent/handler/knowledge_descriptor_handler.go",
    "apps/station/app/subserver/agent/service/knowledge_descriptor_service.go",
    "apps/desktop/src-tauri/src/application/capability_authority.rs",
    "apps/desktop/src-tauri/src/interface/tauri_commands/capability_authority.rs",
    "apps/desktop/src/modules/knowledge.ts",
    "apps/desktop/src/components/settings/KnowledgeSettings.tsx",
    "apps/desktop/src/pages/SettingsPage.tsx",
    "apps/desktop/src/modules/index.ts",
    "apps/desktop/src/services/knowledge-service.ts",
    "packages/locales",
    "docs/architecture/engineering/prototypes/desktop-shell/settings-capabilities-coverage.md"
  ],
  "readSet": [
    "apps/station/app/subserver/agent/service/knowledge_descriptor_service.go",
    "apps/station/app/subserver/agent/service/knowledge_retrieval_service.go",
    "apps/desktop/src-tauri/src/interface/tauri_commands/capability_authority.rs",
    "packages/prototypes/desktop/shell/src/KnowledgeSettings.tsx"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "aud-08-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "aud-08-desktop-build",
      "command": "cd apps/desktop && pnpm run build",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "aud-08-knowledge-test",
      "command": "cd apps/desktop && pnpm run test -- knowledge-settings",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "Settings AI 组新增 Knowledge section 并注册进真实 module registry；形态对齐原型 KNO 合同：封面卡片网格（本地派生图形封面）、详情条目树+正文阅读器、建包表单；list/create/detail/reader 状态互斥不叠加",
    "所有数据经既有 Station descriptor API（create/list/update/tombstone，inline station_content 不可变修订），无本地假仓、无 Git URL 假意图字段、无假 clone 反馈",
    "检索状态诚实显示：embedding provider 为 local hash 时标注 local hash retrieval（64 维词袋、查询时切块），不显示向量数/索引百分比等无权威数值；tombstone 后不可检索",
    "知识绑定 Agent 后提问真实进入 prompt assembly 的 <knowledge_context>，消息归因显示知识来源；未授权知识不进入上下文（Station 能力门禁既有）",
    "原型合同与 coverage 台账同步：真实端 Knowledge 面为 confirmed，原型“不投递给 Agent”的边界仅限原型层",
    "Journey：建知识→阅读条目→绑定→提问命中并归因→停用/tombstone→不再检索，在 make desktop 通过"
  ],
  "failureBehavior": [
    "不做 Git 自动摄取/本地引用、eval sets、持久向量升级（nonGoal；方案 B 需新 Plan 版本）",
    "client_resource_ref 不可读时如实报错，不假装可检索",
    "不复制 Skill/MCP 的目录存储：descriptor Station 唯一真相，React 仅投影",
    "封面不得引用外部图片 URL"
  ],
  "updatedAt": "2026-10-25T00:00:00.000Z"
}
```

## 完整闭环

Station 的知识 descriptor/检索能力此前没有任何 UI 消费方。本任务让用户在 Settings 供给知识、在 Agent 提问中看到真实命中与归因、在移除后确认失效；检索深度不夸大（诚实标注 hash retrieval），为未来向量升级留下明确边界而非假状态。

## v4 修订（Owner 裁决 A）

新增 Station Knowledge 正文读取契约：按 `resource_id + revision` 读取不可变 Station content，校验 actor、availability 与 tombstone；descriptor 响应继续不内联正文。Desktop 仅通过 Rust/Station API 投影正文，不保存本地假仓。
