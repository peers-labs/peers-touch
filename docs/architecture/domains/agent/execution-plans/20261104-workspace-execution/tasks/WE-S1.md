# WE-S1：执行落点 proto 合同与生成

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "WE-20261104",
  "taskId": "WE-S1",
  "workstreamId": "WE-CONTRACT",
  "title": "ExecutionTarget/Placement、WorkspaceSandbox 与 Station↔provisioner RPC 的 proto 合同与多端生成",
  "workClass": "infrastructure",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "we-s1-execution-target-contract",
  "journeyId": "we-j01-execution-target-contract",
  "runtimeClass": "source-only",
  "writeSet": ["model/domain/agent", "apps/station/app/subserver/agent/model", "apps/desktop/src/gen"],
  "readSet": ["docs/architecture/domains/agent/workspace-execution"],
  "budgets": { "focusedCheckSeconds": 1800, "functionalRunSeconds": 1800, "cleanupSeconds": 300 },
  "checks": [
    { "id": "we-s1-proto", "command": "./model/build.sh", "verificationClass": "SOURCE_CHECK" },
    { "id": "we-s1-gofmt", "command": "cd apps/station && gofmt -l .", "verificationClass": "SOURCE_CHECK" },
    { "id": "we-s1-desktop-check", "command": "cd apps/desktop && pnpm run check", "verificationClass": "STRUCTURAL_CHECK" }
  ],
  "doneWhen": [
    "新增 model/domain/agent/execution_target.proto：ExecutionTarget(DESKTOP_DEVICE|WORKSPACE_SANDBOX) 与 ExecutionPlacement(target,sandbox_ref,workspace_root,capability_id,binding_id,binding_revision)",
    "新增 model/domain/agent/workspace_sandbox.proto：WorkspaceSandbox/SandboxState 与 provisioner 窄 RPC（Probe/Allocate/Exec/OpenPty/WritePty/ResizePty/ReadPty/SignalPty/Reconcile/Release）、SandboxSecuritySpec/Quota、ExecResult(exit_code,signal,os_errno,bounded out/err,truncated)",
    "terminal_session.proto 增加可选 execution_target 与 sandbox_ref（device 模式 device_id、sandbox 模式 sandbox_ref 互斥），不破坏现有 device 字段",
    "新增 errcode：SANDBOX_UNAVAILABLE / SANDBOX_NOT_READY / SANDBOX_PERMISSION_DENIED / SANDBOX_EXECUTION_TARGET_FORBIDDEN",
    "./model/build.sh 生成 Go/Rust/TS；desktop pnpm run check 通过；无手写并行 DTO",
    "proto 注释明确：同一 turn placement.target 必须一致，WORKSPACE_SANDBOX 时 sandbox_ref/binding 必填"
  ],
  "failureBehavior": [
    "本切片只立合同与生成，不接执行器、不改 dispatch 行为",
    "不新增平行 executor 枚举，复用 orchestration.ExecutorKind",
    "禁止用未校验 string+JSON 作为跨进程执行意图合同"
  ],
  "updatedAt": "2026-11-04T00:00:00.000Z"
}
```

## 完整闭环

执行落点成为显式、跨端一致、可校验的 proto 事实，为 Station 解析与 provisioner 执行铺好唯一合同；尚无行为变化（默认仍全本机）。
