# TW-D6：BrowserSession、页面观察、操作与人工接管

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "TW-20261102",
  "taskId": "TW-D6",
  "workstreamId": "TW-DEVICE",
  "title": "设备 attachment 形态的真实 BrowserSession：tab/快照代际、操作回执、接管租约与断连 inspect",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "tw-j06-browser-takeover",
  "closureId": "tw-d6-browser-session",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent",
    "apps/station/app/subserver/agent",
    "apps/desktop",
    "packages/locales"
  ],
  "readSet": [
    "docs/architecture/domains/agent/task-workbench"
  ],
  "budgets": {
    "focusedCheckSeconds": 3000,
    "functionalRunSeconds": 4200,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "tw-d6-station-tests",
      "command": "cd apps/station && gofmt -l . && go test ./app/subserver/agent/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "tw-d6-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "tw-d6-rust-tests",
      "command": "cd apps/desktop/src-tauri && cargo test browser",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "proto 定义 BrowserSession/tab/control lease/element snapshot 合同：绑定 task/turn/device/account，tab 显式标识，snapshot ref 绑定 tab+generation，导航/新快照后旧 ref 失效",
    "选定生产可用 browser host（内置受控 Playwright/CDP bridge 或经验证的 MCP host），经现有 worker/CapabilityOperation 接入；MCP 配置不被当作 session/page/account 就绪证据",
    "v1 只广告并实现已验证操作：tabs open/list/close、navigate、snapshot/observe、click/fill/submit、reload/back/forward、screenshot、人工接管/归还；操作有请求关联、超时与结果/截图/下载引用回任务",
    "人工接管取得控制租约并暂停 Agent 点击/输入；归还后 Agent 必须重新 snapshot/observe，不沿用旧 element ref",
    "页面文本、DOM、console 一律作为 untrusted data，不能成为指令、密钥或权限；账号/页面变化或控制移交使旧操作前置条件失效",
    "断连/超时后先 inspect 当前 tab 与结果再决定是否重试 mutation，不重复提交或点击",
    "HTML Artifact 预览与外部 Browser 分开；Computer Use 不在本切片广告",
    "exact-source Native Journey：打开网页→搜索/读取→填表→人工接管改变账号状态→归还→Agent 重新 snapshot→完成操作→截图回任务"
  ],
  "failureBehavior": [
    "验收用 tauri-plugin-playwright 不自动等同生产 browser host；未验证的 network profiling、下载管理器、多 frame 不广告",
    "不新建前端直连浏览器服务，不让两个执行方同时持有同一账号操作权",
    "不把粘贴网页正文、原型模拟或 HTML 预览计作 Browser Use 能力",
    "mutation 结果未回读不标记成功；浏览器读取与发布是不同授权",
    "所有用户可见文案进 packages/locales；禁止 mock 与伪造成功"
  ],
  "updatedAt": "2026-11-02T00:00:00.000Z"
}
```

## 完整闭环

Browser 成为绑定任务与设备租约的真实能力：Agent 自己观察和操作页面，每一步有 tab/代际/回执；用户可随时接管，归还后 Agent 重新观察再继续；断线先核对再重试，页面数据永远是不可信数据而不是指令。
