# TW-D5：TerminalSession 长进程

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "TW-20261102",
  "taskId": "TW-D5",
  "workstreamId": "TW-DEVICE",
  "title": "设备持有的持久 TerminalSession：PTY worker、viewer 订阅、cursor 回放与诚实生命周期",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "tw-j05-terminal-session",
  "closureId": "tw-d5-terminal-session",
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
    "focusedCheckSeconds": 2700,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "tw-d5-station-tests",
      "command": "cd apps/station && gofmt -l . && go test ./app/subserver/agent/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "tw-d5-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "tw-d5-rust-tests",
      "command": "cd apps/desktop/src-tauri && cargo test terminal",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "tw-d5-desktop-tests",
      "command": "cd apps/desktop && pnpm run test -- chat.terminalArtifactReconcile",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "proto 定义设备 TerminalSession 资源合同：session id、task/turn/device 绑定、pid/status/exit code、output cursor、bounded output、control lease",
    "Rust worker 持有 PTY/process，实现 create/attach/write/resize/kill/remove 与按 cursor 的输出回放；Tauri channel/WebSocket 只传输订阅数据，不在 Page 持进程",
    "Station 持久化 session 元数据与事件引用、授权绑定；不保存敏感环境变量与无限输出，大输出沿有界 chunk/Blob 处理",
    "工作面标签是 viewer：关闭标签或切换任务只取消订阅，不杀进程；重开附加到同一 session 并从 cursor 回看",
    "worker/app 重启后不推断旧进程存活：未证明的 session 显示 unknown/dead，可清理或重启，不显示假 running",
    "服务启动后可把本地 URL 作为资源发送到 Preview/Browser；命令、输出、退出码进入任务执行/检查记录",
    "exact-source Native Journey：启动长服务→关闭标签→重连看到同一进程与历史输出→从日志打开 URL→kill→exit code 回读"
  ],
  "failureBehavior": [
    "第一周不实现跨 app/系统重启持久 daemon；该能力后续另立，状态必须诚实",
    "不把 shell.execute 包装成会话，也不把 viewer 关闭解释为进程结束",
    "不在 Station/日志中保存环境变量密钥或无界输出；会话输出不携带凭据",
    "无持久 daemon 证明时不得从 session id 或缓存推断进程存活",
    "所有用户可见文案进 packages/locales；禁止 mock 与伪造成功"
  ],
  "updatedAt": "2026-11-02T00:00:00.000Z"
}
```

## 完整闭环

Terminal 成为任务可打开的设备资源：进程由 Rust worker 持有，UI 只是可随时关闭/重连的观察者，输出可回溯、退出可回读、生命周期状态在 worker 换代后保持诚实；Agent 启动的服务可以直接跳到 Preview/Browser 验证。
