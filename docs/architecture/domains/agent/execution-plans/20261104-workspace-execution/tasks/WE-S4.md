# WE-S4：沙盒一次性 Exec 接通与隔离/不回落门

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "WE-20261104",
  "taskId": "WE-S4",
  "workstreamId": "WE-EXEC",
  "title": "shell/file 在 WORKSPACE_SANDBOX 落点执行：真实退出码/OS errno、bounded 回执、隔离与不回落门",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "we-s4-sandbox-exec",
  "journeyId": "we-j04-sandbox-exec",
  "runtimeClass": "service",
  "writeSet": ["apps/station/app/subserver/agent/service/sandbox", "apps/workspace-sandbox-provisioner/internal"],
  "readSet": ["docs/architecture/domains/agent/workspace-execution"],
  "budgets": { "focusedCheckSeconds": 3000, "functionalRunSeconds": 2700, "cleanupSeconds": 600 },
  "checks": [
    { "id": "we-s4-gotest", "command": "cd apps/station && go test ./app/subserver/agent/... && cd ../workspace-sandbox-provisioner && go test ./...", "verificationClass": "SOURCE_CHECK" },
    { "id": "we-s4-isolation", "command": "cd apps/workspace-sandbox-provisioner && go test ./internal/... -run Isolation", "verificationClass": "FUNCTIONAL_CHECK" },
    {
      "id": "we-s4-functional",
      "command": "cd apps/workspace-sandbox-provisioner && go test ./internal/... -run 'Exec|Isolation|Egress|NoFallback'",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "provisioner 实现 Exec（流式 stdout/stderr、真实 exit_code/signal/os_errno、bounded+truncated、超时/取消）",
    "Station sandbox_dispatch 把 shell/file 工具在 WORKSPACE_SANDBOX 落点派发到 provisioner；回执沿用 D4 bounded-result/digest/diff 归属校验",
    "越界（写只读 rootfs、访问未挂载宿主路径、需要提权）返回真实非零退出+原始 errno/stderr，映射 SANDBOX_PERMISSION_DENIED，绝不伪成功、无应用层提权",
    "网络隔离确定性门：沙盒内访问 Station Postgres/内部端口被拒；跨沙盒互访被拒；外网仅经 allowlist 代理",
    "不回落确定性门：provisioner Probe=false / binding 未 READY 时 turn fail-closed，审计与 DB 中无 desktop 落点执行记录",
    "非 root 门：沙盒内 id -u 非 0；no-new-priv 下提权失败；file/edit 的 before/after sha 与 unified diff 事实与 device 模式一致"
  ],
  "failureBehavior": [
    "不实现持久 PTY（S6）与卷回收策略（S5）",
    "不放宽网络默认以换取测试方便",
    "禁止用 mock backend 的退出码宣称隔离/OS 语义成立（必须真实容器）"
  ],
  "updatedAt": "2026-11-04T00:00:00.000Z"
}
```

## 完整闭环

Agent 在已分配沙盒里真实执行命令并拿回 OS 级事实；越界自然失败、网络隔离、且任何失败都不会悄悄跑到用户桌面——"沙盒即边界"首次端到端成立。
