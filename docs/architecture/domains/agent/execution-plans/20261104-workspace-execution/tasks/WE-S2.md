# WE-S2：Station 落点解析、沙盒分配表与 fail-closed

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "WE-20261104",
  "taskId": "WE-S2",
  "workstreamId": "WE-STATION",
  "title": "Placement 解析、WorkspaceSandbox 分配表/状态机/配额/幂等，未接执行器前一律 fail-closed",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "we-s2-placement-allocator",
  "journeyId": "we-j02-placement-allocator",
  "runtimeClass": "service",
  "writeSet": ["apps/station/app/subserver/agent/service/sandbox", "apps/station/app/subserver/agent/persistence", "apps/station/app/subserver/agent/service/tool_dispatch_service.go"],
  "readSet": ["docs/architecture/domains/agent/workspace-execution", "model/domain/agent"],
  "budgets": { "focusedCheckSeconds": 2400, "functionalRunSeconds": 1800, "cleanupSeconds": 300 },
  "checks": [
    { "id": "we-s2-gotest", "command": "cd apps/station && gofmt -l . && go test ./app/subserver/agent/...", "verificationClass": "SOURCE_CHECK" },
    {
      "id": "we-s2-functional",
      "command": "cd apps/station && go test ./app/subserver/agent/service/sandbox -run 'Placement|Allocator|FailClosed'",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "placement_resolver：由 turn 绑定 capability 执行面得 ExecutionPlacement；filesystem.*/shell.allowlist→DESKTOP_DEVICE，workspace.sandbox.*→WORKSPACE_SANDBOX；同一 turn 两类并存返回 SANDBOX_EXECUTION_TARGET_FORBIDDEN",
    "WORKSPACE_SANDBOX 落点要求 sandbox_ref+binding READY，否则 SANDBOX_NOT_READY；复用现有 capability readiness/lease/fencing 闸门，不另造授权",
    "新增 agent_workspace_sandboxes 分配表与 sandbox_allocator：按 (actor,agent,workspace_root) 幂等 Allocate；REQUESTED/ALLOCATED/DORMANT/FAILED/RELEASED 状态机；每 actor 容器/CPU/内存配额",
    "provisioner client 在此切片为不可用占位：Probe=false 时所有 WORKSPACE_SANDBOX turn fail-closed（确定性单测断言不产生 desktop 执行记录）",
    "tool_dispatch 增加 WORKSPACE_SANDBOX 分支骨架但不触达真实执行（本切片无 provisioner）；默认路径与现有 device 行为零变化",
    "Go 单测覆盖：混用落点拒绝、未就绪拒绝、幂等只产生一个 ref、配额超额排队/拒绝、fail-closed 不回落"
  ],
  "failureBehavior": [
    "本切片不引入容器运行时依赖、不挂 sock",
    "Station 不得在此切片执行任何命令",
    "不允许在 Probe 失败时静默改走 desktop"
  ],
  "updatedAt": "2026-11-04T00:00:00.000Z"
}
```

## 完整闭环

Station 能权威判定一条命令该在哪执行、管理沙盒分配与配额，并在执行器缺失时干净 fail-closed；本机路径完全不变。
