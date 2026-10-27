# AUD-04：真实 Turn 文件产物

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AUD-20261025",
  "taskId": "AUD-04",
  "workstreamId": "AUD-ARTIFACT",
  "title": "workspace 文件成为版本化 TurnArtifact：本机打开/再编辑/上传 Station 跨设备获取",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "aud-j04-turn-artifact",
  "closureId": "aud-v06-turn-artifacts",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent/agent.proto",
    "apps/station/app/subserver/agent/infrastructure/persistence",
    "apps/station/app/subserver/agent/handler/turn_handler.go",
    "apps/station/app/subserver/agent/handler/workspace_oss_handler.go",
    "apps/station/app/subserver/agent/agent.go",
    "apps/station/app/subserver/agent/service/workspace_oss_service.go",
    "apps/desktop/src-tauri/src/application/desktop_executor_worker/local_executor.rs",
    "apps/desktop/src/store/chat.ts",
    "apps/desktop/src/store/chatArtifacts.ts",
    "apps/desktop/src/store/chatArtifacts.test.ts",
    "apps/desktop/src/components/portal",
    "packages/locales"
  ],
  "readSet": [
    "apps/station/app/subserver/oss",
    "apps/desktop/src-tauri/src/application/desktop_executor_worker/resource_registry.rs",
    "docs/architecture/domains/agent/agent-usability-depth/design.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "aud-04-proto-build",
      "command": "./model/build.sh",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "aud-04-station-tests",
      "command": "cd apps/station && go test ./app/subserver/agent/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "aud-04-artifact-tests",
      "command": "cd apps/desktop && pnpm run test -- chat-artifacts",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "aud-04-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "agent.proto 定义 TurnArtifact（turn/agent/tool_call、kind=file、name/size/hash、locator=client_local_ref|station_object_ref、created_at）与 list/get 契约；生成走 build.sh",
    "Station 新表持久化产物元数据（迁移、GORM、归属校验）；CLIENT receipt 入库时从 artifacts 段提取；blob 只复用 OSS subserver 既有对象能力，不复活 workspace DB 模拟文件",
    "workspace_oss_service/handler 二选一收口：正式注册 upload/download 路由并接到 OSS，或删除死代码；禁止长期半成品并存（本任务采用正式接线）",
    "Rust 写/编辑执行后在 receipt 登记产物（opaque_ref 映射本机文件、hash/size）；上传走既有 OSS 客户端并把 station_object_ref 回写产物",
    "PortalPanel 从代码块提取切换为 Station 产物列表 + 本机 locator：原设备可打开/在系统文件管理器定位/再编辑；其他设备仅见 Station 副本可下载，仅本机持有文件显示“在原设备打开或先上传”，无假下载",
    "store/chat.ts 的 extractMessageArtifacts 降级为消息内代码块展示，不再写入产物集合",
    "Journey：生成报告文件→打开核对→上传→其他设备/重启后再次打开并继续修改；产物来源 Turn/工具可回溯；删除当前 Skill binding 不改写历史产物来源"
  ],
  "failureBehavior": [
    "文本建议、模型终止、进程退出、未审批工具均不得产生产物记录",
    "无 Station 副本时绝不伪造跨设备可下载；上传失败保留本机产物并显式失败状态",
    "产物读取经资源库授权与 opaque_ref，不向 Station 发送用户绝对路径（既有 No User-Home Paths 规则）",
    "不新建第二套文件存储；workspace DB 行模拟不得作为产物 authority"
  ],
  "updatedAt": "2026-10-25T00:00:00.000Z"
}
```

## 完整闭环

Agent 工作的交付物第一次成为可再次打开、可迭代、可跨设备的真实对象，而不是聊天里的代码块。元数据权威在 Station、本机文件权威在 Desktop、blob 在既有 OSS；后续 Turn 引用同一 hash 文件继续修改，历史产物来源不可变。
