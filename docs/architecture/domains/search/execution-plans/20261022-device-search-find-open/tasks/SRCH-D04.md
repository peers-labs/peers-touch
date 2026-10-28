# SRCH-D04：生产 Search overlay 接入真实命令

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SRCH-20261022",
  "taskId": "SRCH-D04",
  "workstreamId": "OVERLAY",
  "title": "按 confirmed 原型在生产 Shell 落地 singleton overlay 与查询投影，接 search_suggest/submit/cancel",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "srch-j04-overlay",
  "closureId": "srch-d04-overlay",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src",
    "packages/locales"
  ],
  "readSet": [
    "packages/prototypes/desktop/shell/src/search",
    "docs/client/common/ui-identity",
    "docs/client/desktop/runtime-projections.md",
    "docs/architecture/domains/search/prototype/README.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "srch-d04-desktop-check",
      "command": "pnpm --dir apps/desktop run check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "srch-d04-desktop-unit",
      "command": "pnpm --dir apps/desktop run test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "srch-d04-overlay-journey",
      "command": "pnpm --dir apps/desktop exec playwright test -c e2e/playwright.config.ts e2e/tests/search-overlay.spec.ts",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "srch-d04-ux-review",
      "command": "manual UX review against docs/client/common/ui-identity with captured screenshots",
      "verificationClass": "UX_REVIEW"
    }
  ],
  "doneWhen": [
    "生产 Shell 持有 singleton overlay：⌘K 唤起、Esc 关闭还焦触发点；overlay 按需挂载，页面零 mount fetch；查询状态属于 app-scope runtime/projection，符合 runtime-projections 的 Page/Runtime/Boot 合同",
    "renderer 通过生成的 search proto TS DTO 调用 search_suggest/search_submit/search_cancel；不写第二套查询/融合引擎；建议未提交不外发（设备侧无网络调用）",
    "信息结构复用 confirmed 原型：最近、本机建议、提交后分组结果、kind chips（仅提交后出现）、coverage/partial、空/加载/失败/取消态；视觉走 UI Identity token 与 LobeUI/antd，不复制原型私有 CSS",
    "键盘 ↑↓（aria-activedescendant 归属）、Enter、Esc、IME composition、长中英混合截断、窄宽度均有真实走查；全部文案走 packages/locales 新 search 命名空间",
    "FUNCTIONAL_CHECK 前置条件在 spec README 写明：make desktop 已启动、tauri-playwright socket、Station:18080 与测试账号、命名空间中文跨会话语料；旅程证明 ⌘K→中文词→分组结果→打开会话（anchor 高亮由 D04C 接续，本任务只要求打开正确会话）",
    "旧 SearchPage 路由与搜索商界面此时仍可存在，但 ⌘K/搜索按钮唤起的是新 overlay；不修改 DEFAULT_READY_PAGE（属于 D04B）",
    "断网/Station 不可达时本机检索正常，结果不伪造 S/F 来源"
  ],
  "failureBehavior": [
    "不把 Search 做成持久路由页或 mount 时 fetch 的页面",
    "不为掩盖加载做布局跳动；结果/空/骨架共享稳定高度",
    "原型的演示视角切换器不进入生产",
    "不在本任务删除旧 TS 消费者或 Rust 命令（分别归 D04B/D06），避免半成品中间态",
    "消息滚动高亮不在本任务自造；点击结果只导航到会话，anchor 由 D04C 完成"
  ],
  "updatedAt": "2026-10-22T15:30:00.000Z"
}
```

## 完整闭环

输入是 confirmed 原型与 D03 新命令；输出是真实可用的全局检索覆盖层，但刻意不接管默认落点、不拆旧页面、不做消息内高亮——这三件事分别是 D04B 与 D04C 的独立闭包，使本任务停在"overlay 自身端到端可用"这一可验收边界上。
