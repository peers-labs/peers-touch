# AUD-02：STATION-owner 新工具（web_fetch / todo）

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AUD-20261025",
  "taskId": "AUD-02",
  "workstreamId": "AUD-EXEC",
  "title": "注册真实 web_fetch 与 todo_write/update STATION 工具并进入环境段、命令快照与活动卡",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "aud-j02-station-tools",
  "closureId": "aud-v02-station-tools",
  "runtimeClass": "service",
  "writeSet": [
    "apps/station/app/subserver/agent/service/tool_registry_service.go",
    "apps/station/app/subserver/agent/service/prompt_assembly_service.go",
    "apps/station/app/subserver/agent/service/web_fetch_tool.go",
    "apps/station/app/subserver/agent/service/todo_tool.go",
    "apps/desktop/src/components/messages/ToolCallCard.tsx",
    "packages/locales"
  ],
  "readSet": [
    "apps/station/app/subserver/agent/service/mcp_runtime.go",
    "apps/station/app/subserver/agent/service/capability_authority_service.go",
    "docs/architecture/domains/agent/agent-usability-depth/design.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "aud-02-station-tests",
      "command": "cd apps/station && go test ./app/subserver/agent/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "aud-02-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "aud-02-tool-card-test",
      "command": "cd apps/desktop && pnpm run test -- tool-call-card",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "web_fetch 为 STATION-owner 内置工具：URL 抓取经与 MCP HTTP transport 同一套 SSRF/私网/link-local/metadata 拦截与超时/体积限制；失败有类型化错误码，不返回伪造内容",
    "todo_write/todo_update 为 STATION-owner 工具：Agent 可创建/勾选/罗列任务项，状态经既有 turn 事件词表作为 progress 活动下发，并随 Turn 持久（Turn 结束可回读），不新建进程内状态",
    "两工具进入 capability manifest、command snapshot（/tools 可见）、prompt assembly 环境段（可用能力+阻塞条件），风险分级：web_fetch/todo 读类为 L0，todo 写为 L1 自动（仅任务清单语义）",
    "ToolCallCard 渲染 web_fetch 结果卡（URL/状态/摘要）与 todo 进度卡（条目/状态），参数与结果走 redacted_arguments 既有投影；所有文案为 i18n key",
    "单测覆盖 SSRF 拒绝面（内网 IP、重定向到内网）、todo 持久回读、未授权 Agent 不可见两工具；绑定/停用即时影响 snapshot"
  ],
  "failureBehavior": [
    "不引入第二个 HTTP client 或绕过 MCP 既有 SSRF 规则的网络出口",
    "不提供任意 header/凭证透传、不开放本机地址、不缓存为可跨 Agent 的内容",
    "todo 不是独立产品面/数据库新域：复用 turn 事件持久，删除会话不留下独立待办表",
    "不把 CLIENT-owner 工具混入本任务（文件/命令在 AUD-03）"
  ],
  "updatedAt": "2026-10-25T00:00:00.000Z"
}
```

## 完整闭环

模型首次进入任务即可知道并使用两类真实能力：联网取证（受站内网络安全策略约束）与任务自检清单。能力由 Station 执行并落 Turn 证据，桌面只做投影。完成后 Station 工具表与 `/tools`、审批策略一致，无“可见但执行是占位文本”的工具。
