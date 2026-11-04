# WE-S6：TerminalSession 沙盒落点与 Desktop 落点标注

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "WE-20261104",
  "taskId": "WE-S6",
  "workstreamId": "WE-EXEC",
  "title": "provisioner PTY/ring/cursor/reconcile + Station terminal 双落点路由 + Desktop 只读落点标注",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "we-s6-sandbox-terminal",
  "journeyId": "we-j06-sandbox-terminal",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/workspace-sandbox-provisioner/internal/runtime", "apps/station/app/subserver/agent/service", "apps/desktop/src", "packages/locales"],
  "readSet": ["docs/architecture/domains/agent/workspace-execution"],
  "budgets": { "focusedCheckSeconds": 3000, "functionalRunSeconds": 2700, "cleanupSeconds": 600 },
  "checks": [
    { "id": "we-s6-gotest", "command": "cd apps/station && go test ./app/subserver/agent/...", "verificationClass": "SOURCE_CHECK" },
    { "id": "we-s6-desktop-check", "command": "cd apps/desktop && pnpm run check", "verificationClass": "STRUCTURAL_CHECK" },
    {
      "id": "we-s6-functional",
      "command": "cd apps/station && go test ./app/subserver/agent/... -run 'Terminal.*Sandbox|ExecutionTarget'",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "provisioner 实现 OpenPty/WritePty/ResizePty/ReadPty(cursor)/SignalPty + bounded ring，语义与 Desktop worker D5 等价；Station 不存无限输出/密钥环境变量",
    "Station terminal create/write/read/kill/remove/reconcile 按 execution_target 路由：device→Rust worker，sandbox→provisioner；元数据/状态/字节计数合同一致",
    "TerminalSession 持久 execution_target+sandbox_ref；device_id 与 sandbox_ref 互斥；换代无 live proof 一律 UNKNOWN",
    "Desktop 终端面板/工具卡片显示只读落点标注（本机 / 沙盒 ref 短码+后端），同一面板承载两落点，不新增第二套终端 UI；文案进 packages/locales",
    "Desktop 不代理沙盒执行；沙盒模式仅作为 stream/事件展示端",
    "确定性测试覆盖：两落点路由正确、互斥校验、cursor 回放、UNKNOWN 诚实、locale parity"
  ],
  "failureBehavior": [
    "不复制第二套 terminal 状态表或 ring 协议",
    "不允许 UI 从 session id 推断沙盒进程存活",
    "device 模式行为与 D5 完全保持，不回归"
  ],
  "updatedAt": "2026-11-04T00:00:00.000Z"
}
```

## 完整闭环

持久终端在本机与 Station 沙盒两种落点下行为同构、状态诚实，用户在同一面板清晰看到命令实际跑在哪；为"沙盒起长服务→上报 URL→后续验证"铺好终端基础。
