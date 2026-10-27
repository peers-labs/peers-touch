# AUD-13：MCP 编辑重发现与双 owner 端到端收口

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AUD-20261025",
  "taskId": "AUD-13",
  "workstreamId": "AUD-SUPPLY",
  "title": "MCP 编辑触发 revision/工具重发现，零工具不可绑定，STATION/CLIENT 双 owner 端到端 Journey",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "aud-j13-mcp-dual-owner",
  "closureId": "aud-v09-mcp-closure",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src/components/MCPTab.tsx",
    "apps/desktop/src/services/mcp-service.ts",
    "apps/desktop/src/store/mcp.ts",
    "apps/desktop/src-tauri/src/application/mcp",
    "apps/station/app/subserver/agent/service/mcp_server_service.go",
    "packages/locales"
  ],
  "readSet": [
    "apps/station/app/subserver/agent/service/mcp_runtime.go",
    "apps/desktop/src-tauri/src/application/mcp/station_projection.rs",
    "apps/desktop/src/store/agentCapabilities.ts",
    "packages/prototypes/desktop/shell/src/Settings.tsx"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "aud-13-station-tests",
      "command": "cd apps/station && go test ./app/subserver/agent/... -run Mcp",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "aud-13-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "aud-13-mcp-functional",
      "command": "cd apps/desktop && pnpm run test -- mcp",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "编辑 server 配置保存即 revision bump 并触发工具重发现：STATION owner 由 Station refresh（stdio/http/sse 真实握手），CLIENT owner 由 Rust 本地 probe；旧工具清单在新清单到达前不作为可绑定集合",
    "零工具/探测失败/server 离线的 server 在 Agent Profile 绑定选择器中不可选（readiness 强制，而非仅 UI 隐藏）；恢复后经重新 refresh 才可绑定",
    "Form/JSON 双态在真实端齐平：JSON 批量导入真解析、非法输入报错；密文（args/env/headers）编辑后不回显旧值，client 密文仅本地加密投影",
    "STATION owner：绑定后模型工具调用经 Station mcp_runtime 真实执行并在 ToolCallCard 回执；CLIENT owner：经能力桥 pull/receipt 在桌面执行（SSRF/路径沙箱/8MB frame 不回退）",
    "SSRF/私网/link-local/metadata 拒绝、stdio 禁 shell 拼接等负面对照保留或补齐自动化；统计只显示本地可派生 Servers/Enabled/Tools 或 Station 权威值，无 Connected 百分比假遥测",
    "Journey：新增（stdio 与 http 各一）→refresh→工具出现→绑定→真实调用→编辑配置工具重置→失败 server 不可绑定，两类 owner 各一条 make desktop FUNCTIONAL_PASS"
  ],
  "failureBehavior": [
    "不引入第三种执行 owner；transport 不推断执行位置（owner 显式声明）",
    "CLIENT owner 的 refresh 失败不得在 Station 侧伪造工具；反之亦然",
    "探测不得执行写工具或产生副作用（initialize/tools-list 语义）",
    "真实 MCP server 外部资源缺失时用本机受控 fixture server（Station/Rust 各自测试设施），不在前端 mock"
  ],
  "updatedAt": "2026-10-25T00:00:00.000Z"
}
```

## 完整闭环

MCP 双运行时底座已真实，本任务只闭合三个产品缺口：编辑后的工具真相、不可绑定门槛、两条 owner 链路的真实 Journey。任何状态都来自握手/回执权威，没有“Test 恒成功”或假统计。
