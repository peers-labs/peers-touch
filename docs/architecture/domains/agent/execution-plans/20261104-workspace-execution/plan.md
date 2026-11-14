# 工作区执行落点（本机 / Station 沙盒）实施计划

> **Plan ID**: WE-20261104
> **Version ID**: workspace-execution-20261104-v1
> **Created**: 2026-11-04T00:00:00.000Z
> **Owner**: Peers-Touch Agent Team

本计划只冻结实施模型，不表示实现已完成，也不授权 push、PR、发布、远程部署、数据重置或历史改写。允许本地 checkpoint commit。Owner 已于 2026-11-04 确认架构源（`docs/architecture/domains/agent/workspace-execution/`）、Linux 优先、sibling 容器 + 独立 provisioner、禁止沙盒→本机回退、非 root 硬前提、以及 Windows/macOS **目标 OS** 执行体后置（REMOTE_CONNECTOR）。未逐条裁决的实施细节采用架构源推荐默认值；实施中变更须新版本。

## 目标与完成口径

完成后必须同时成立：

1. Agent 的 shell/file 一次性命令与持久 TerminalSession 有两个明确执行落点：本机 `DESKTOP_DEVICE`（现状不变）与 Station `WORKSPACE_SANDBOX`（新）；落点由 turn 绑定 capability 的执行面唯一决定，同一 turn 不混用（WE-S1/S2）。
2. Station 模式只把命令派发到**已分配给该 agent 工作区的隔离沙盒**；Station 自身无 docker.sock、非特权、不 DinD；能建容器的只有独立 `workspace-sandbox-provisioner`（WE-S3）。
3. provisioner 经 `ExecutorBackend` SPI 屏蔽宿主 OS 差异；首期 Linux OCI（containerd 对齐，实现可先 docker），固定安全模板（非 root、no-new-priv、drop caps、seccomp、只读 rootfs、仅 /workspace 可写、网络隔离+egress allowlist、配额）、镜像白名单+digest（WE-S3/S4）。
4. 沙盒内越界动作不做特权处理，OS 自然报错（EACCES/EPERM/ENOENT/exit≠0）并如实映射为有类型结果；需要提权走线下 owner 改绑定（revision+readiness），无对话内提权通道（WE-S4）。
5. provisioner 不可用或 binding 未 READY 时 station 模式 fail-closed，**绝不回落到本机**（WE-S2/S4，确定性门）。
6. 持久单元是 workspace：容器一次性、workspace 卷持久；懒启动、空闲 DORMANT、冷启动复用卷、reconcile 诚实（换代无 live proof 即 UNKNOWN）、Release 决定卷去留（WE-S5）。
7. TerminalSession 双落点同构：sandbox 模式 PTY/ring/cursor 归 provisioner，Station 仍只存元数据与诚实状态；Desktop 同一面板只标注落点（WE-S6）。
8. 受控部署 exact-source Native Journey 证明：沙盒内真实失败→反馈修复→复测通过；越界得 OS 原生拒绝；容器重建后工作区仍在、Terminal 诚实；隔离门（非 root/只读 rootfs/Station 内网不可达/跨沙盒不可达）与不回落门全绿（WE-S7）。
9. Windows/macOS 作为**目标 OS** 的执行体通过 `REMOTE_CONNECTOR` 专用 runner 后置实现；mac/Win dev 上经 Linux VM 跑同一 Linux 沙盒作为末期兼容任务，不在 Linux 主链交付口径内冒充（WE-S8）。
10. 每个切片都是 proto → Station/provisioner → Desktop（如需）→ 旧路径裁决的纵向闭包，当日可构建可验证，未完成能力 fail-closed，禁止 mock 沙盒/伪造隔离证据。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "WE-20261104",
  "versionId": "workspace-execution-20261104-v1",
  "createdAt": "2026-11-04T00:00:00.000Z",
  "workClass": "infrastructure",
  "architecture": {
    "sources": [
      "docs/architecture/domains/agent/workspace-execution/README.md",
      "docs/architecture/domains/agent/workspace-execution/design.md",
      "docs/architecture/domains/agent/workspace-execution/decisions.md",
      "docs/architecture/domains/agent/workspace-execution/data-model.md",
      "docs/architecture/domains/agent/workspace-execution/integration.md",
      "docs/architecture/domains/agent/workspace-execution/module-layout.md",
      "docs/architecture/domains/agent/task-workbench/design.md"
    ],
    "decisions": ["WE-D01", "WE-D02", "WE-D03", "WE-D04", "WE-D05", "WE-D06", "WE-D07", "WE-D08"]
  },
  "scope": {
    "sourceClaims": [
      { "pathPrefix": "model/domain/agent", "mode": "exclusive-write" },
      { "pathPrefix": "apps/station/app/subserver/agent", "mode": "exclusive-write" },
      { "pathPrefix": "apps/workspace-sandbox-provisioner", "mode": "exclusive-write" },
      { "pathPrefix": "apps/desktop", "mode": "exclusive-write" },
      { "pathPrefix": "packages/locales", "mode": "exclusive-write" },
      { "pathPrefix": "tooling/docker", "mode": "exclusive-write" },
      { "pathPrefix": "tooling/acceptance/reports", "mode": "exclusive-write" },
      { "pathPrefix": "docs/architecture/domains/agent", "mode": "exclusive-write" },
      { "pathPrefix": "apps/station", "mode": "shared-read" },
      { "pathPrefix": "docs", "mode": "shared-read" },
      { "pathPrefix": "tooling", "mode": "shared-read" }
    ],
    "nonGoals": [
      "Station 进程内直跑 CLI、DinD、或把宿主 docker.sock 挂进 Station",
      "Firecracker/Kata/gVisor microVM 后端（SPI 预留，首期不实现）",
      "以 Windows/macOS 为目标 OS 的构建执行体（WE-S8 经 REMOTE_CONNECTOR 后置）",
      "对话链路内的提权允许/允许 sudo 通道",
      "改动本机 Desktop 能力合同与 BrowserSession(D6) 合同",
      "生产部署、生产数据迁移/重置、push、Pull Request 与历史改写"
    ]
  },
  "tasks": [
    { "id": "WE-S1", "workstreamId": "WE-CONTRACT", "path": "tasks/WE-S1.md", "dependsOn": [] },
    { "id": "WE-S2", "workstreamId": "WE-STATION", "path": "tasks/WE-S2.md", "dependsOn": ["WE-S1"] },
    { "id": "WE-S3", "workstreamId": "WE-PROVISIONER", "path": "tasks/WE-S3.md", "dependsOn": ["WE-S1"] },
    { "id": "WE-S4", "workstreamId": "WE-EXEC", "path": "tasks/WE-S4.md", "dependsOn": ["WE-S2", "WE-S3"] },
    { "id": "WE-S5", "workstreamId": "WE-EXEC", "path": "tasks/WE-S5.md", "dependsOn": ["WE-S3", "WE-S4"] },
    { "id": "WE-S6", "workstreamId": "WE-EXEC", "path": "tasks/WE-S6.md", "dependsOn": ["WE-S4", "WE-S5"] },
    { "id": "WE-S7", "workstreamId": "WE-VERIFY", "path": "tasks/WE-S7.md", "dependsOn": ["WE-S4", "WE-S5", "WE-S6"] },
    { "id": "WE-S8", "workstreamId": "WE-CROSSOS", "path": "tasks/WE-S8.md", "dependsOn": ["WE-S7"] }
  ],
  "authorization": {
    "checkpoint": { "localCommit": "allowed", "amend": "allowed" },
    "delivery": { "push": "denied", "pullRequest": "denied" },
    "runtime": { "deployProfiles": [], "destructiveResetScopes": [] },
    "history": { "rewrite": "denied" }
  }
}
```

## 任务索引与依赖 DAG

| Task | 标题 | 依赖 |
|---|---|---|
| WE-S1 | 执行落点 proto 合同与生成 | — |
| WE-S2 | Station 落点解析、沙盒分配表与 fail-closed | WE-S1 |
| WE-S3 | provisioner 侧车：SPI、policy、Linux OCI allocate/release | WE-S1 |
| WE-S4 | 沙盒一次性 Exec 接通：shell/file、OS 错误映射、隔离/不回落门 | WE-S2, WE-S3 |
| WE-S5 | workspace 卷与生命周期：懒启动/DORMANT/冷启动/reconcile/release | WE-S3, WE-S4 |
| WE-S6 | TerminalSession 沙盒落点（PTY/ring）+ Desktop 落点标注 | WE-S4, WE-S5 |
| WE-S7 | 受控部署 exact-source 沙盒 Native Journey + compose 集成 | WE-S4, WE-S5, WE-S6 |
| WE-S8 | [末期] mac/Win dev Linux 沙盒兼容 + REMOTE_CONNECTOR Win/Mac 目标 runner | WE-S7 |

```text
S1 ──┬─ S2 ─────────────┐
     └─ S3 ── S4 ── S5 ─┼─ S6 ── S7 ── S8(后置)
                         └─────────────┘
```

## 非目标

- 不在 Station 进程直跑 CLI、不做 DinD、不挂 docker.sock 进 Station。
- 首期不实现 Firecracker/Kata/gVisor microVM 后端（接口预留）。
- 不实现以 Windows/macOS 为目标 OS 的构建执行体（WE-S8 单独立项）。
- 不改本机 Desktop 模式的能力合同、BrowserSession（D6）合同。
- 不在对话链路提供"提权允许/允许 sudo"。

## Acceptance Execution

本期为 DEVELOPMENT_ITERATION 收口：各 Task 以聚焦源码检查与受控 Station cell（含 provisioner sidecar、egress 代理、隔离网络）当前源码 Journey 的 FUNCTIONAL_CHECK 证明；隔离/非 root/网络不可达以真实容器的确定性集成测试 + native journey 双重举证，禁止 mock backend 宣称隔离。未运行 Gate 保持 UNPROVEN，不自动回填；不替代正式 Acceptance / Station Suite。

```json
{
  "closures": {
    "we-s1-execution-target-contract": [],
    "we-s2-placement-allocator": [],
    "we-s3-provisioner-spi-oci": [],
    "we-s4-sandbox-exec": [],
    "we-s5-workspace-lifecycle": [],
    "we-s6-sandbox-terminal": [],
    "we-s7-sandbox-native-journey": [],
    "we-s8-cross-os-executors": []
  },
  "completion": [],
  "full": []
}
```

## 审批边界

Owner 2026-11-04 批准架构源、Linux 优先范围、sibling 容器 + 独立 provisioner、非 root/网络隔离硬前提、禁止沙盒→本机回退，以及把 Windows/macOS 目标 runner 后置（WE-S8）。该批准不授权 push、PR、发布、生产远程部署、数据重置或历史改写；microVM 后端与 REMOTE_CONNECTOR 异构 runner 的具体合同在进入对应切片前须另有评审与授权。
