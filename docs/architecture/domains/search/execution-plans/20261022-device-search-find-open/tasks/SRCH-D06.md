# SRCH-D06：旧搜索路径与搜索商配置 hard cut、零遗留收口

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SRCH-20261022",
  "taskId": "SRCH-D06",
  "workstreamId": "HARD-CUT",
  "title": "删除 ToolsTab 搜索引擎配置整条链，search-scoped 零遗留复核与当前源码 Journey 收口",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "srch-j06-zero-legacy",
  "closureId": "srch-d06-zero-legacy",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop",
    "docs/architecture/domains/search",
    "docs/architecture/engineering/prototypes"
  ],
  "readSet": [
    "apps/station",
    "packages/prototypes"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "srch-d06-journeys-current-source",
      "command": "pnpm --dir apps/desktop exec playwright test -c e2e/playwright.config.ts e2e/tests/search-overlay.spec.ts e2e/tests/search-anchor.spec.ts e2e/tests/search-functions.spec.ts e2e/tests/search-default-landing.spec.ts",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "srch-d06-rust-legacy-zero",
      "command": "bash -lc '! rg -n \"fn (help_get|search_sources|search_query|search_ai)\\b|SearchQueryInput|AiSearchInput|SearchPrimaryInput|tools_search_providers|tools_set_search_primary\" apps/desktop/src-tauri/src'",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "srch-d06-ts-legacy-zero",
      "command": "bash -lc '! rg -n \"getHelp|searchSources|aiSearch|listSearchProviders|setSearchPrimary|search_sources|search_ai|help_get|SearchSourceGroup|DEFAULT_READY_PAGE: Page = .search.\" apps/desktop/src && test ! -e apps/desktop/src/pages/SearchPage.tsx && ! rg -n \"SearchPrimaryInput\" apps/desktop/src'",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "srch-d06-desktop-check",
      "command": "pnpm --dir apps/desktop run check && pnpm --dir apps/desktop run test && pnpm --dir apps/desktop run build",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "srch-d06-tauri-build",
      "command": "source $HOME/.cargo/env && CI=false pnpm --dir apps/desktop run tauri:build",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "搜索商配置链整条删除（D-19）：SettingsPage ToolsTab 搜索引擎卡片、desktop_api 的 listSearchProviders/setSearchPrimary 包装、application/tools 的 tools_search_providers/tools_set_search_primary、tauri_commands/tools 对应命令、http_gateway/main.rs 注册、contracts.rs 与 interface/contracts/mod.rs 双份 SearchPrimaryInput；移除后 ToolsTab 其余工具设置不受影响",
    "零遗留复核通过：D04B 已删除的旧 stub（help_get/search_sources/search_query/search_ai、SearchQueryInput/AiSearchInput）、SearchPage.tsx、旧 TS sources/provider 链与 search 默认页在当前源码机械检查中保持为零；通用 StubPayload 信封与 ToolsTab 非搜索功能不被波及",
    "DEFAULT_READY_PAGE 与全部 resume/hash/identity 恢复路径已在 D04B 落到 chat；本任务用机械检查复核",
    "search 原型总账状态为 confirmed 并标注生产落点；search README 链接本计划；无失效文档引用；station launcher mock 撤除作为后续 Station 计划跟踪项在本计划与 integration 文档标注，不误删 apps/station",
    "Desktop pnpm check/test/build 与 tauri:build 在当前源码通过；四条 exact-source Journey（overlay/anchor/functions/default-landing）在当前 commit 重新运行 FUNCTIONAL_PASS，不继承旧结果",
    "封闭域否定证明：UI、descriptor、command 三层 inventory 无公网/OS 文件/connector 入口；端侧检索路径无 Station transport 依赖；Station launcher mock 已无任何客户端消费者",
    "工作树无无关改动；临时调试产物清理；outcome-comparison 实际结果按证据回填或保持 UNPROVEN"
  ],
  "failureBehavior": [
    "不保留‘暂时 fallback 到 mock/搜索商’的开关或 feature flag；搜索商链删除不延后",
    "不删除 Station launcher mock 服务端代码（本期 non-goal）；仅证明无客户端消费者并登记后续撤除",
    "Journey 失败回到对应 owner Task 修复，不在收口任务旁加兼容层",
    "不把 tauri 构建通过当作 FUNCTIONAL_PASS；旅程必须在真实 Desktop 点击通过"
  ],
  "updatedAt": "2026-10-22T15:30:00.000Z"
}
```

## 完整闭环

输入是 D04B 已直接替换旧搜索世界（stub/SearchPage/TS 消费者归零）、overlay/anchor/functions 全部成为活动入口；本闭包删除最后一段旧公网语义——ToolsTab 搜索引擎配置链，并在当前源码上做零遗留复核与全套 Journey 收口。零遗留检查只针对 search-scoped 符号，不误伤通用 StubPayload 信封；回滚方式是 revert 这个 cut commit（已迁移设备的 FTS 恢复需重跑重建，见 plan Hard Cut 规则）。Station mock 撤除、Mobile 切换、S/F 区与 Ask 在后续计划闭环。
