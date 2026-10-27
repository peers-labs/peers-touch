# AUD-05：完整 Skill 资源包（references / assets / scripts）

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AUD-20261025",
  "taskId": "AUD-05",
  "workstreamId": "AUD-SKILL",
  "title": "Skill 版本化资源：Station 文本资源读取 + CLIENT 只读受管包目录与 skill.resource.read",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "aud-j05-skill-resources",
  "closureId": "aud-v03-skill-resources",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent/skill.proto",
    "model/domain/agent/capability.proto",
    "apps/station/app/subserver/agent/infrastructure/persistence/immutable_content_blob.go",
    "apps/station/app/subserver/agent/infrastructure/persistence/models.go",
    "apps/station/app/subserver/agent/service/immutable_content_service.go",
    "apps/station/app/subserver/agent/service/knowledge_descriptor_service.go",
    "apps/station/app/subserver/agent/service/skill_service.go",
    "apps/station/app/subserver/agent/service/tool_registry_service.go",
    "apps/station/app/subserver/agent/service/skills_guard_service.go",
    "apps/station/app/subserver/agent/handler/skill_handler.go",
    "packages/agent-catalog",
    "apps/desktop/src-tauri/src/application/skills_market",
    "apps/desktop/src-tauri/src/application/desktop_executor_worker/local_executor.rs",
    "apps/desktop/src/components/SkillsTab.tsx",
    "packages/locales"
  ],
  "readSet": [
    "apps/desktop/src-tauri/src/application/skills",
    "apps/station/app/subserver/agent/service/agent_package_service.go",
    "docs/architecture/domains/agent/agent-usability-depth/design.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "aud-05-proto-build",
      "command": "./model/build.sh",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "aud-05-station-tests",
      "command": "cd apps/station && go test ./app/subserver/agent/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "aud-05-rust-tests",
      "command": "cd apps/desktop/src-tauri && cargo test skills_market",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "aud-05-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "skill.proto 的 SkillManifest/版本结构含 resources（path/hash/size/kind/execution_owner）；资源正文为 content-addressed 不可变 blob，复用 agent package 既有不可变内容模式；./model/build.sh 通过",
    "STATION-owner 包：新增 skill_resource_read（或等价工具）只能读取本 Turn 绑定版本内的相对路径，路径穿越被拒绝；skill_view 正文语义不变；skills_guard 对资源文本同口径扫描",
    "CLIENT-owner 包：安装（official envelope/ZIP）时资源物化到应用数据下只读受管包目录（非用户 workspace），随版本更新与清理；能力桥新增 skill.resource.read，路径钉在受管目录、fail-closed；Rust 侧有越权路径单测",
    "脚本执行不新增原语：脚本只能由 AUD-03 shell allowlist 从只读包目录调用，输出落在用户 workspace；包资源不声明执行位信任",
    "SkillsTab/原型 Skills 抽屉的包内文件树与正文阅读消费真实资源；卡片显示版本、资源数与执行 owner；绑定仍来自单一 capability catalog，停用包即时收回可绑定集合",
    "Journey：Agent 按 Skill references 完成连续只读依赖步骤并产出 workspace 文件；删除/停用当前 binding 后历史 Turn attribution 不被改写"
  ],
  "failureBehavior": [
    "不承诺二进制资产与任意脚本解释器；不做 Git 自动摄取/本地 Git reference（本期 nonGoal）",
    "资源读取不得暴露本机绝对路径、不得越出包版本目录；历史版本资源不可变",
    "签名包信任链（ed25519/sha256）不降级；启发式内容扫描不得宣称安全检测",
    "若资源 blob 复用与知识内容模型冲突，回报 DESIGN_AMENDMENT_REQUIRED，不新建第三套内容存储"
  ],
  "updatedAt": "2026-10-25T00:00:00.000Z"
}
```

## 完整闭环

Skill 从“一段 markdown 文本”变为固定版本、可读资源、可按说明完成工作的能力包。资源在执行位置解析（Station 读文本、Desktop 物化只读包），脚本仍走受控命令通道；安全信任、版本归因与单一 catalog 不被削弱。

## v4 修订（Owner 裁决 A）

资源正文进入 Station 通用 content-addressed immutable blob（sha256 身份、去重、actor/域引用治理）；Knowledge 与 Skill 不共享 descriptor 表，只共享底层内容存储。禁止 Skill 私有第三套正文表。
