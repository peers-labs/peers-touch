# 工作区执行落点 — 模块布局

> **Status**: accepted（目标态目录归属；具体包名在切片中落地）

## 新增 / 修改归属

```text
model/domain/agent/
  execution_target.proto        [新] ExecutionTarget / ExecutionPlacement
  terminal_session.proto        [改] 增加 execution_target + sandbox_ref
  workspace_sandbox.proto       [新] WorkspaceSandbox / state / Station↔provisioner RPC
  orchestration.proto           [复用] ExecutorKind（不新增枚举）

apps/station/app/subserver/agent/
  service/sandbox/              [新包]
    placement_resolver.go       turn 绑定 -> ExecutionPlacement（含混用拒绝）
    sandbox_allocator.go        分配表 CRUD、幂等、配额、状态机（不持进程）
    sandbox_provisioner_client.go  窄 RPC 客户端（mTLS、短期执行令牌）
    sandbox_dispatch.go         shell/file/terminal 路由到 provisioner；OS 错误映射
    *_test.go
  service/tool_dispatch_service.go  [改] WORKSPACE_SANDBOX 落点分支（闸门不变）
  service/terminal_*.go            [改] 按 execution_target 路由（device | sandbox）
  persistence/agent_workspace_sandbox.go [新] 分配表 GORM 模型 + migration

tooling/docker/（或部署侧 compose）
  compose 增加 workspace-sandbox-provisioner 与 egress proxy（profile 隔离）

apps/workspace-sandbox-provisioner/   [新可执行单元，独立模块/进程]
  cmd/provisionerd/main.go
  internal/
    server/        Station 窄 RPC 服务端（鉴权、配额、白名单）
    backend/       ExecutorBackend SPI
      backend.go            接口 + SecuritySpec
      oci_linux.go          Linux OCI（containerd 对齐；首期可 docker 实现）
      oci_desktop_vm.go     mac/Win 经 Linux VM（后置 dev 任务）
      microvm.go            Firecracker/Kata/gVisor（未来占位，不在首期）
    runtime/       pty、bounded ring、cursor 回放、reconcile（与 worker 语义对齐）
    policy/        镜像白名单/digest、安全模板、配额、egress allowlist

apps/desktop/
  src-tauri/...terminal/      [改] 仅 device 模式；不代理沙盒
  src/.../terminal|toolcard/  [改] 落点只读标注（locales 文案）
```

## 依赖方向（allowed / forbidden）

- `apps/station/.../sandbox` → 只依赖 proto + provisioner RPC client + persistence；**不得** import 容器运行时 SDK 或挂 sock。
- `provisioner` → 容器运行时 + 自身 policy；**不得** import Station 业务库、连业务 DB。
- Desktop worker → 不新增对 provisioner 的依赖。
- proto 为唯一跨进程合同；禁止用 `string + 未校验 JSON` 在 Station↔provisioner 传执行意图。

## 单一真源

- 落点/沙盒分配/授权真源：Station（分配表 + capability binding）。
- 进程/PTY/输出 ring 真源：device 模式=Desktop worker；sandbox 模式=provisioner。
- 隔离原语真源：provisioner 后端（OS/运行时）。
- 不存在第二套 terminal 状态或沙盒分配表。
