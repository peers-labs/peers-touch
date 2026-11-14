# 工作区执行落点（本机 / Station 沙盒）架构

> **Status**: accepted（Owner 2026-11-04 口头确认设计取向与三个决策点；实施承接：WE-20261104）
> **Owner**: Peers-Touch Agent Team
> **Last updated**: 2026-11-04

本模块定义 Agent 的命令执行（一次性 shell/file 与持久 TerminalSession）落在**哪里**、被什么边界隔离、以及如何被授权与如实回传失败。它不重新定义工作台的任务/产物/记忆合同（见 [`../task-workbench/`](../task-workbench/)），只定义"执行面"。

## 解决的问题

当前执行只有一种落点：进程/PTY 由 Desktop Rust worker 在用户本机持有（`ExecutorKind_DESKTOP_DEVICE`），Station 只存元数据，且 Station-hosted 编排明确不能跑本地 CLI。这无法支持无人值守/跨设备/服务端隔离任务。目标是新增**第二种落点**：Station 把命令派发到**已分配给该 agent 工作区的隔离沙盒**，同时保持本机模式不变。

Owner 确认的核心原则：**Station 模式只开放给已分配沙盒；试图突破沙盒的动作不做特权处理，直接执行、由操作系统自然报错（EACCES/EPERM/ENOENT/exit≠0），需要提权的动作线下由相应 owner 授权后再跑。**

## 文档集

| 文档 | 内容 |
|---|---|
| [design.md](./design.md) | 执行落点拓扑、信任边界、sibling 容器（非 DinD）、provisioner 侧车、ExecutorBackend SPI、工作区卷与生命周期、质量门 |
| [decisions.md](./decisions.md) | ADR：sibling 非 DinD、持久单元=workspace、禁止沙盒→本机回退、网络隔离、跨 OS 矩阵与 REMOTE_CONNECTOR 后置、非 root 硬前提 |
| [data-model.md](./data-model.md) | proto 合同：`execution_target`、`sandbox_ref`、沙盒分配资源/租约、后端 SPI 消息、TerminalSession 落点扩展、失败语义 |
| [integration.md](./integration.md) | 与 capability authority / readiness→dispatch 闸门、compose 部署、Desktop 本机模式、Terminal/Browser 设备资源的集成 |
| [module-layout.md](./module-layout.md) | provisioner 侧车、Station 执行器、proto、Desktop 的目录归属 |

## 上游与下游

- 上游：[`../task-workbench/design.md`](../task-workbench/design.md)（任务/工具调度/dispatch）、`model/domain/agent/orchestration.proto`（`ExecutorKind` 已预留 `WORKSPACE_SANDBOX=2`、`REMOTE_CONNECTOR=3`）、[`../task-workbench/`](../task-workbench/) 的 D4（文件/shell）与 D5（TerminalSession）。
- 下游：WE-20261104 执行计划；Station provisioner 部署（compose/k8s）；Desktop 终端面板落点标注。

## 范围与非范围（摘要）

- **在范围**：Linux 生产侧 OCI 沙盒执行器（sibling 容器 + 独立 provisioner）、统一执行落点合同、workspace 卷与生命周期、安全模板、失败如实回传、Terminal 双落点；macOS/Windows dev 经标准 Linux VM（OrbStack/Docker Desktop/WSL2）跑同一 Linux 沙盒。
- **非范围（后置）**：以 Windows/macOS 为**目标 OS** 的执行体走 `REMOTE_CONNECTOR`（专用 runner），列为项目末期任务；microVM（Firecracker/Kata/gVisor）作为可插拔强隔离后端，不在首期；不做 Station 宿主直跑、不做 DinD、不挂 docker.sock 进 Station。
