# WE-S8：[末期] mac/Win dev Linux 沙盒兼容 + REMOTE_CONNECTOR 异构目标 runner

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "WE-20261104",
  "taskId": "WE-S8",
  "workstreamId": "WE-CROSSOS",
  "title": "macOS/Windows dev 经 Linux VM 跑同一 Linux 沙盒；REMOTE_CONNECTOR 接入 Windows/macOS 目标 OS runner",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "we-s8-cross-os-executors",
  "journeyId": "we-j08-cross-os-executors",
  "runtimeClass": "service",
  "writeSet": ["apps/workspace-sandbox-provisioner/internal/backend", "apps/station/app/subserver/agent", "model/domain/agent", "docs/architecture/domains/agent/workspace-execution"],
  "readSet": ["docs/architecture/domains/agent/workspace-execution"],
  "budgets": { "focusedCheckSeconds": 3600, "functionalRunSeconds": 3600, "cleanupSeconds": 1200 },
  "checks": [
    { "id": "we-s8-provisioner", "command": "cd apps/workspace-sandbox-provisioner && gofmt -l . && go test ./...", "verificationClass": "SOURCE_CHECK" },
    { "id": "we-s8-station", "command": "cd apps/station && go test ./app/subserver/agent/...", "verificationClass": "SOURCE_CHECK" },
    {
      "id": "we-s8-functional",
      "command": "cd apps/workspace-sandbox-provisioner && go test ./... -run 'DesktopVm|RemoteConnector|Probe'",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "oci_desktop_vm 后端：macOS 经 OrbStack/Docker Desktop/Lima、Windows 经 Docker Desktop(WSL2) Probe 成功，并跑同一 Linux 镜像 uname/write/grep 闭环；Linux 工作区行为跨宿主一致",
    "无可⽤运行时时 Probe=false 且 station 模式 fail-closed（不回落本机），三平台语义一致",
    "REMOTE_CONNECTOR 子设计立项：定义异构目标 runner（Windows、macOS/Apple 硬件）的注册、身份、凭据、机型/镜像、调度与 capability binding 合同（proto + design 增补，单独评审）",
    "Station 经 ExecutorKind_REMOTE_CONNECTOR 把目标 OS 任务派到注册通过、READY 的专用 runner；落点评注可区分 Linux 沙盒/Win runner/Mac runner",
    "Linux 卷不与 Win/Mac runner 共享工作区存储（权限位/大小写/换行语义隔离）",
    "文档更新跨 OS 矩阵与运维前置（各平台运行时依赖、Apple 硬件 runner 约束）"
  ],
  "failureBehavior": [
    "不在 Linux 容器内假装构建原生 Windows/macOS 产物",
    "不把 Apple 平台 runner 做成 Station 直控宿主；保持 connector/runner 隔离",
    "本任务排在 Linux 主链(S1–S7)稳定之后，不阻塞主链交付"
  ],
  "updatedAt": "2026-11-04T00:00:00.000Z"
}
```

## 完整闭环

跨平台收敛完成：开发机在三大桌面 OS 上都能供给一致的 Linux 沙盒；真正的 Windows/macOS 目标构建通过专用远程 runner 纳入同一套能力/调度/落点合同，执行层各自原生、控制层统一。
