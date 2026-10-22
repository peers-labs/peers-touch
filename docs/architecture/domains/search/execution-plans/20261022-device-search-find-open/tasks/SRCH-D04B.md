# SRCH-D04B：旧搜索世界直接替换（默认落点 + TS 消费者 + Rust stub 同切）

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SRCH-20261022",
  "taskId": "SRCH-D04B",
  "workstreamId": "LANDING-CUT",
  "title": "Chat 默认落点；旧 TS 消费者拆除与旧 Rust stub/合同/注册在同一替换 commit 删除",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "srch-j04b-chat-default",
  "closureId": "srch-d04b-landing-cut",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src",
    "apps/desktop/src-tauri/src/application/search",
    "apps/desktop/src-tauri/src/interface/tauri_commands/search.rs",
    "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
    "apps/desktop/src-tauri/src/main.rs",
    "packages/locales"
  ],
  "readSet": [
    "docs/architecture/domains/search/integration.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "srch-d04b-desktop-check",
      "command": "pnpm --dir apps/desktop run check && pnpm --dir apps/desktop run test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "srch-d04b-cargo-check",
      "command": "cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "srch-d04b-rust-stub-zero",
      "command": "bash -lc '! rg -n \"fn (help_get|search_sources|search_query|search_ai)\\b|SearchQueryInput|AiSearchInput\" apps/desktop/src-tauri/src'",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "srch-d04b-default-chat-journey",
      "command": "pnpm --dir apps/desktop exec playwright test -c e2e/playwright.config.ts e2e/tests/search-default-landing.spec.ts",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "DEFAULT_READY_PAGE 改为 chat；types/navigation、useHashRouter、useNavigation、identity warm-resume/last-active-page、AppSideNav、useCommandMenuItems、pages/registry、AppletRuntime 深链逐处 inventory 一致：普通启动/登录完成/账号切换落 Chat；无会话、无搜索来源、上次停在搜索均不自动出现搜索首屏",
    "侧栏搜索按钮与命令面板入口只唤起 D04 overlay，不再路由到 search 页；明确对象深链仍打开指定对象",
    "TS 消费者拆除：desktop_api 的 searchSources/searchAi/旧搜索包装、store/search 的 sources/provider 模型、searchRuntime 的 loadSources bootstrap、pages/registry 的 SearchPage 注册、mock-gateway 旧搜索处理、旧 locale 搜索商键；启动期不再发生对 search_sources 的 IPC",
    "同一替换 commit 内删除 native 旧世界：application/search 的 help_get/search_sources/search_query/search_ai 四个 stub 与 SearchQueryInput/AiSearchInput 合同、main.rs invoke_handler 与 http_gateway match 臂注册；tauri_commands/search.rs 只承载 search_suggest/submit/cancel；通用 StubPayload 信封不动",
    "SearchPage.tsx 文件在本任务删除；navigationOwnership 等现有测试更新通过；rust-stub-zero 机械检查通过，TS 与 native 删除后 cargo check、pnpm check/test 同时通过，无死命令窗口",
    "FUNCTIONAL_CHECK 证明：冷启动与 warm-resume 进 Chat；深链对象不受影响；overlay 唤起与本机检索正常",
    "ToolsTab 搜索引擎配置链本任务不动（属于 D06）；其命令与旧搜索 stub 无共享符号，删除互不阻塞"
  ],
  "failureBehavior": [
    "不保留旧命令作为废弃别名、feature flag 或空实现；新 overlay 是唯一搜索入口",
    "TS 拆除与 native 删除必须同一 commit，不接受“TS 先切、命令留待以后”的半成品状态",
    "不用 hash 兼容把 search 留成隐藏兜底页；不可达就是不可达",
    "发现 integration.md §S-01 inventory 之外的恢复路径时先补齐盘点再改",
    "账号切换/锁屏结果遮蔽走既有身份生命周期，本任务不新造状态"
  ],
  "updatedAt": "2026-10-22T15:30:00.000Z"
}
```

## 完整闭环

输入是 D03 新命令与 D04 overlay 均已就绪；输出是旧搜索世界在一次直接替换中消失：默认落点变 Chat，旧 TS 消费者链与旧 Rust stub/合同/注册原子删除，SearchPage 物理移除。完成后代码里只有一条搜索现实（overlay → 新命令 → coordinator），不存在死命令窗口；仅剩的旧公网语义是 ToolsTab 搜索引擎配置链，由 D06 收口。回滚等于 revert 这个替换 commit。
