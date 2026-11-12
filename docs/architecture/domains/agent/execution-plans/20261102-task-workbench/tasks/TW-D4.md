# TW-D4：真实文件、一次性命令、Diff 与代码任务

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "TW-20261102",
  "taskId": "TW-D4",
  "workstreamId": "TW-DEVICE",
  "title": "授权工作根内 filesystem/shell 合同复核扩展、真实字节 Diff 与检查结果回任务/成果链",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "tw-j04-file-command-diff",
  "closureId": "tw-d4-files-commands-diff",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent",
    "apps/station/app/subserver/agent",
    "apps/desktop",
    "packages/locales"
  ],
  "readSet": [
    "docs/architecture/domains/agent/task-workbench",
    "docs/architecture/domains/agent/agent-usability-depth"
  ],
  "budgets": {
    "focusedCheckSeconds": 2700,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "tw-d4-station-tests",
      "command": "cd apps/station && gofmt -l . && go test ./app/subserver/agent/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "tw-d4-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "tw-d4-rust-tests",
      "command": "cd apps/desktop/src-tauri && cargo test desktop_executor_worker",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "tw-d4-desktop-tests",
      "command": "cd apps/desktop && pnpm run test -- chat.recoveredToolProjection toolRuntime chatArtifacts",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "filesystem.read/list/write/edit 与 shell.execute 在现有 CapabilityOperation/lease/fenced executor/resource grant/receipt ledger 下复核并补齐合同：参数、cwd、allowed roots、输出上限、幂等 key、side-effect receipt、unknown outcome",
    "写/编辑默认逐次审批，回执含真实 before/after 字节摘要与变更文件清单；越界写与未授权命令被拒绝并有类型化错误",
    "Diff 基于真实 before/after 字节生成并与 TurnArtifact/TaskArtifact 版本关联；消息中的代码块只作展示，不是成果真源",
    "一次性命令是有界同步操作：回显 cwd/命令，结果含有界输出、exit code、耗时与失败原因；命令成功、检查通过、用户接受是分开的事实并分别呈现",
    "失败重试先 inspect 真实状态；未知副作用的写/命令禁止盲重放，按恢复合同进入待核对",
    "Agent 可根据检查失败继续修改并复测，最终结果、Diff 与检查绑定到同一任务/成果版本",
    "exact-source Native Journey：隔离工作根内修改文件→Diff→运行命令失败→修复→复测通过→打开产物版本"
  ],
  "failureBehavior": [
    "不开放无边界 shell、出根写、PDF/二进制读取或未声明网络工具",
    "不把一次性 shell 升级为持久终端（TerminalSession 属于 TW-D5）",
    "exit code 0、工具自报成功或模型自述均不标记任务完成",
    "不放宽既有 fenced 参数上限与 workspace 沙箱；本机绝对路径不写入共享业务状态",
    "所有用户可见文案进 packages/locales；禁止 mock 与伪造成功"
  ],
  "updatedAt": "2026-11-02T00:00:00.000Z"
}
```

## 完整闭环

在授权工作根内，Agent 的每次读写与命令都是可审批、可追溯、可恢复的真实操作：改动呈现为真实字节 Diff，命令呈现为有界输出与退出码，检查失败驱动修复复测；所有事实回流到同一任务的成果版本，而不是用“命令完成”冒充任务完成。
