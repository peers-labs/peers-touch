# WE-S5：workspace 卷与沙盒生命周期

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "WE-20261104",
  "taskId": "WE-S5",
  "workstreamId": "WE-EXEC",
  "title": "持久单元=workspace：命名卷持久、懒启动、空闲 DORMANT、冷启动复用、Reconcile/Release",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "we-s5-workspace-lifecycle",
  "journeyId": "we-j05-workspace-lifecycle",
  "runtimeClass": "service",
  "writeSet": ["apps/workspace-sandbox-provisioner/internal", "apps/station/app/subserver/agent/service/sandbox", "tooling/docker"],
  "readSet": ["docs/architecture/domains/agent/workspace-execution"],
  "budgets": { "focusedCheckSeconds": 3000, "functionalRunSeconds": 2700, "cleanupSeconds": 900 },
  "checks": [
    { "id": "we-s5-gotest", "command": "cd apps/workspace-sandbox-provisioner && go test ./... && cd ../station && go test ./app/subserver/agent/...", "verificationClass": "SOURCE_CHECK" },
    {
      "id": "we-s5-functional",
      "command": "cd apps/workspace-sandbox-provisioner && go test ./... -run 'WorkspaceVolume|Dormant|ColdStart|Reconcile'",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "Allocate 按 (actor,agent,workspace_root) 懒启动：首次调用创建容器并挂载按 sandbox_ref 命名的持久 /workspace 卷",
    "空闲超时容器转 DORMANT（卷保留、进程停）；再次 Exec/OpenPty 冷启动复用同一卷，文件与工作区状态仍在",
    "Release 默认保留卷；删除 workspace（owner 授权）才 deleteVolume；卷/容器映射在 provisioner 与 Station 分配表一致",
    "Reconcile：provisioner 上报 live refs；Station 把无 live proof 的沙盒从 ALLOCATED 降级（容器换代不得显示假活）",
    "每 actor 容器数/CPU/内存/pids 配额生效；超额进入现有排队，不无限起容器",
    "确定性+集成测试：写文件→DORMANT→冷启动后文件仍在；容器重建后内部 pid 变化被如实反映；Release(deleteVolume) 后卷不存在"
  ],
  "failureBehavior": [
    "不把容器当持久身份；持久身份只能是卷+sandbox_ref",
    "不允许 provisioner 清理它不拥有的宿主卷",
    "冷启动失败转 FAILED/fail-closed，不回落本机"
  ],
  "updatedAt": "2026-11-04T00:00:00.000Z"
}
```

## 完整闭环

沙盒成为"可随时丢弃/重建的执行体 + 持久的工作区卷"，具备 Devin DevBox 式状态延续，同时回收/配额/诚实活性都在受控边界内。
