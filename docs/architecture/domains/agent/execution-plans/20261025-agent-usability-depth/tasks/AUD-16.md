# AUD-16：整体验收与假面清理

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AUD-20261025",
  "taskId": "AUD-16",
  "workstreamId": "AUD-FINAL",
  "title": "TD-J01…J05 普通用户路径整体证明、假 mock/TTS 清理、原型合同与 i18n/台账同步",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "aud-j16-whole-usability",
  "closureId": "aud-whole-agent-usability",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src/services/mock-gateway.ts",
    "apps/desktop/src/components/settings/TTSSettings.tsx",
    "apps/desktop/src/components/chat/TTSControls.tsx",
    "apps/desktop/src/components/messages/AssistantMessage.tsx",
    "apps/desktop/src/services/desktop_api.ts",
    "apps/desktop/src/modules/index.ts",
    "apps/desktop/src/modules/tts",
    "apps/desktop/e2e/tests/agent-usability-journeys.spec.ts",
    "apps/desktop/src-tauri/src/application/tts",
    "apps/desktop/src-tauri/src/interface/tauri_commands/tts.rs",
    "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
    "apps/desktop/src-tauri/src/main.rs",
    "packages/prototypes/desktop",
    "docs/architecture/domains/agent/agent-usability-depth",
    "docs/architecture/engineering/prototypes/desktop-shell",
    "packages/locales"
  ],
  "readSet": [
    "apps/desktop/src/pages/registry.ts",
    "docs/architecture/domains/agent/modern-chat-agent/proposals/20261022-task-depth-product-amendment.md",
    "docs/architecture/engineering/prototypes/desktop-shell/settings-benchmark-disposition.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 3600,
    "functionalRunSeconds": 7200,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "aud-16-desktop-full",
      "command": "cd apps/desktop && pnpm run check && pnpm run test && pnpm run build",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "aud-16-station-tests",
      "command": "cd apps/station && gofmt -l . && go test ./app/subserver/agent/... ./app/subserver/channel/... ./app/subserver/bot/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "aud-16-td-journeys",
      "command": "cd apps/desktop && pnpm exec playwright test -c e2e/playwright.config.ts e2e/tests/agent-usability-journeys.spec.ts",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "TD-J01（调查并交付文档：≥6 续轮依赖链、完整 Skill 资源、真实报告文件与来源）在 make desktop 普通账号、无 Harness 注入工具路径 FUNCTIONAL_PASS",
    "TD-J02（授权任务目录读材料→改文件→真实检查失败→修正→再验证，无关文件不变）FUNCTIONAL_PASS",
    "TD-J03（运行中带附件补充、排队顺序/编辑/取消）FUNCTIONAL_PASS",
    "TD-J04（AskUser/审批后续跑；短断网、切页、Desktop 重启不重复消息/副作用；未知副作用不自动重放）FUNCTIONAL_PASS",
    "TD-J05（长任务产物打开/上传/再次打开迭代；当前 binding 变更不改写历史归因）FUNCTIONAL_PASS",
    "假 mock-gateway.ts 零引用死代码删除；TTS 假能力整条卸载：聊天 mini-player（AssistantMessage 中 TTSControls）、Settings TTSSettings/modules/tts、tauri 命令、http_gateway、main.rs 注册与 desktop_api 包装同批拆除（含 application/tts 空 wav/静态 voices），无死命令窗口；modules/index.ts 的 side-effect import 同步删除",
    "apps/desktop/e2e/tests/agent-usability-journeys.spec.ts 承载 TD-J01…J05 的 tauri-playwright 旅程（make desktop 已启动、Station 与测试账号就绪为前置），不依赖 Harness 注入额外工具",
    "原型 UX 合同（settings-capabilities-coverage、agent-chat-coverage、settings-benchmark-disposition）与本文/真实端差异双向同步；新增文案全部在 packages/locales；无硬编码中英文、无 debug 打印、无伪造遥测",
    "设计文档 status 从 draft 升为 execution-active 并回链本 Plan；README 导航更新；架构模块治理、document-index 检查通过",
    "所有 Journey 证据绑定当前 commit 与 source digest；未运行的正式 Acceptance/Station Suite 显式标 UNPROVEN，不回填"
  ],
  "failureBehavior": [
    "不以 Gate 数量、构建成功或 Harness 注入路径替代 TD Journey；任一 Journey 红则计划保持未完成",
    "不删除仍被引用的 TTS 类型/命令以外的任何能力；清理与消费者拆除同批",
    "不授权 push/PR/远程部署/数据重置；Owner make desktop 亲自验收前不提交 MR",
    "发现属于 Station 侧的新缺口时记录为后续计划输入，不在收尾任务中偷偷扩面"
  ],
  "updatedAt": "2026-10-25T00:00:00.000Z"
}
```

## 完整闭环

前 15 个闭包交付零件，本任务交付“整体 Agent 可用性”这一命题本身：用 AgentBox 对标推导出的五个真实任务旅程（普通路径、无注入）证明连续执行、能力使用、运行中交互、恢复、交付验证；同时完成假面清理与文档/原型同步。单模块全绿不等于整体闭环，本任务是整体故事的唯一验收点。
