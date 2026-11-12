# 工作区执行落点 — 数据模型与协议

> **Status**: accepted（proto 合同为目标态，实施以 WE-20261104 切片落地；先 `./model/build.sh` 再生）

所有跨 Station/执行体语义 proto-first。枚举复用 `orchestration.proto` 已有的 `ExecutorKind`（`WORKSPACE_SANDBOX=2`、`DESKTOP_DEVICE=4`、`REMOTE_CONNECTOR=3`），不新增平行枚举。

## 1. 落点枚举（新增，表达"命令在哪执行"）

```proto
// model/domain/agent/execution_target.proto（新增）
enum ExecutionTarget {
  EXECUTION_TARGET_UNSPECIFIED = 0;
  EXECUTION_TARGET_DESKTOP_DEVICE = 1; // 本机 Rust worker（现状）
  EXECUTION_TARGET_WORKSPACE_SANDBOX = 2; // provisioner 分配的隔离沙盒
}

message ExecutionPlacement {
  ExecutionTarget target = 1;
  // target=WORKSPACE_SANDBOX 时必填：已分配沙盒实例。
  string sandbox_ref = 2;
  // 沙盒/设备内工作根；唯一可写区（沙盒）。
  string workspace_root = 3;
  // 该落点解析自的 capability/binding（审计与 dispatch 归因）。
  string capability_id = 4;
  string binding_id = 5;
  uint64 binding_revision = 6;
}
```

不变量：同一 turn 的所有执行性工具调用 `target` 必须一致；target=WORKSPACE_SANDBOX 时 `sandbox_ref/binding_id` 必填且 binding READY，否则拒绝派发。

## 2. 沙盒分配资源（Station 真源：分配与授权，不持有进程）

```proto
message WorkspaceSandbox {
  string sandbox_ref = 1;            // 全局不透明 id（"wbox-<ULID>"），provisioner 与 Station 共用
  string actor_ptid = 2;
  string agent_id = 3;
  string workspace_root = 4;        // 逻辑工作区身份
  string image_ref = 5;             // 白名单仓库 + digest（不允许可变 tag 直接执行）
  SandboxState state = 6;
  string backend_kind = 7;          // oci_linux | oci_desktop_vm | microvm(后置)
  string volume_ref = 8;            // 持久 workspace 卷
  uint64 revision = 9;              // 绑定/模板变更版本
  google.protobuf.Timestamp created_at = 10;
  google.protobuf.Timestamp last_live_at = 11;
  google.protobuf.Timestamp released_at = 12;
}
enum SandboxState {
  SANDBOX_STATE_UNSPECIFIED = 0;
  SANDBOX_STATE_REQUESTED = 1;
  SANDBOX_STATE_ALLOCATED = 2;      // 容器在跑
  SANDBOX_STATE_DORMANT = 3;        // 容器停、卷保留
  SANDBOX_STATE_FAILED = 4;         // 后端 fail-closed，未运行
  SANDBOX_STATE_RELEASED = 5;       // 终结（卷按策略保留/删除）
}
```

Station 表（建议 `agent_workspace_sandboxes`）只存**分配/状态/授权**，不存命令输出、环境变量密钥。活性来自 provisioner 的 live proof/reconcile（复 D5 语义：worker 换代后未证明存活不得标 ALLOCATED）。

## 3. Station ↔ provisioner 窄 RPC（内网 mTLS，独立服务身份）

```proto
service WorkspaceSandboxProvisioner {
  rpc Probe(ProbeRequest) returns (ProbeResponse);                 // 平台可用性 + 后端 kind
  rpc Allocate(AllocateSandboxRequest) returns (AllocateSandboxResponse);
  rpc Exec(ExecRequest) returns (stream ExecChunk);               // 一次性命令
  rpc OpenPty(OpenPtyRequest) returns (PtyHandle);                // 持久会话
  rpc WritePty(WritePtyRequest) returns (WritePtyResponse);
  rpc ResizePty(ResizePtyRequest) returns (ResizePtyResponse);
  rpc ReadPty(ReadPtyRequest) returns (ReadPtyResponse);          // 按 cursor 回放
  rpc SignalPty(SignalPtyRequest) returns (SignalPtyResponse);
  rpc Reconcile(ReconcileSandboxesRequest) returns (ReconcileSandboxesResponse);
  rpc Release(ReleaseSandboxRequest) returns (ReleaseSandboxResponse);
}

message SandboxSecuritySpec {       // 平台无关安全意图
  bool non_root = 1;
  bool no_new_privileges = 2;
  bool read_only_rootfs = 3;
  repeated string drop_capabilities = 4;
  string seccomp_profile = 5;
  bool isolate_station_network = 6;
  repeated string egress_host_allowlist = 7;
  SandboxQuota quota = 8;           // cpu/mem/pids
  string workspace_mount_target = 9; // 固定为 /workspace
}
```

- Allocate 只接受 provisioner 配置侧的**镜像白名单 + digest** 与固定模板；请求体不能声明特权/额外宿主挂载。
- Exec/OpenPty 必须携带 `sandbox_ref` 与 Station 颁发的短期执行令牌；provisioner 校验 ref 属于该 actor。
- `ExecResult` 带真实 `exit_code`、`signal`、`os_errno`（可空）、bounded stdout/stderr（truncated 标记）。权限失败不转义为成功。

## 4. 工具与 Terminal 合同扩展

- 一次性 shell/file dispatch 元数据增加 `ExecutionPlacement placement`；回执（bounded result/diff/digest/exit code）模型不变，但失败结果新增可选 `os_errno` 与 `sandbox_ref`。
- `model/domain/agent/terminal_session.proto`：
  - `TerminalSession` 增加 `ExecutionTarget execution_target = 14;` 与 `string sandbox_ref = 15;`。
  - device 模式 `device_id` 必填、sandbox 模式 `sandbox_ref` 必填（二者互斥）。
  - Create/Reconcile 扩展到 provisioner 来源；进程/PTY 在 sandbox 模式归 provisioner，Station 仍只存元数据与事件引用、bounded output 字节计数。
- 新增有类型失败码（errcode，不复用通用套餐伪装）：
  - `SANDBOX_UNAVAILABLE`（Probe=false / 无运行时）
  - `SANDBOX_NOT_READY`（binding 未 READY）
  - `SANDBOX_PERMISSION_DENIED`（携带原始 errno/stderr，OS 自然拒绝）
  - `SANDBOX_EXECUTION_TARGET_FORBIDDEN`（试图回落/混用落点）

## 5. 状态机与生命周期

```text
REQUESTED --Allocate ok--> ALLOCATED
ALLOCATED --idle timeout--> DORMANT (volume kept)
DORMANT  --Exec/OpenPty--> ALLOCATED (cold start, new pid)
*        --backend/probe fail--> FAILED (fail-closed, 不回落本机)
ALLOCATED/DORMANT/FAILED --Release(keepVolume)--> RELEASED
```

- 容器重建不改 `sandbox_ref`，但新 pid；TerminalSession 在此情形下先 UNKNOWN 再以 live proof 重建，UI 不显示假 running。
- 删除 workspace（owner 授权）→ Release(deleteVolume)。

## 6. 幂等、顺序与失败

- Allocate 按 `(actor, agent, workspace_root)` 幂等（client 幂等键），并发只产生一个 ref。
- Exec 回执沿用 D4 的 bounded-result digest 归属校验；重放同一幂等键不重复产生副作用。
- provisioner 不可用：turn 终态 failed/fail-closed（可重试，落点不变）；不产生 desktop 执行记录。
- 输出/pty ring 有界；密钥环境变量不落 Station。
