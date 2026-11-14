# Agent 设计决策

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-10-02 | **Updated**: 2026-10-03
> **Owner**: Peers-Touch Agent Team

---

## 决策索引

| ID | 决策 | 状态 |
|---|---|---|
| MCA-D14 | Home 工作状态由 Station 投影 | accepted |
| MCA-D15 | 使用统一能力清单与 Agent 绑定 | accepted |
| MCA-D16 | Station 管理能力操作，客户端执行本机 MCP | superseded by MCA-D16A |
| MCA-D16A | MCP 配置归 Station，执行服从显式运行位置 | accepted |
| MCA-D17 | Connector 资源与 Agent 工具清单分离 | accepted |
| MCA-D18 | Evaluation 使用 Station 聚合 | accepted |
| MCA-D20 | 使用发布者签名 catalog 与权威读回 | accepted |
| MCA-D22 | 使用 Station-owned 能力场景控制面 | accepted |
| MCA-D23 | 单一场景控制面覆盖 ToolCall、MCP 与 Connector | accepted |
| WE-D01 | Station 沙盒用 sibling 容器，禁止 DinD/挂 docker.sock | accepted |
| WE-D02 | 沙盒持久单元是 workspace（容器一次性、卷持久） | accepted |
| WE-D03 | 沙盒非 root + no-new-priv + 只读 rootfs 为硬前提 | accepted |
| WE-D04 | 禁止沙盒→本机回落；落点由 capability 执行面唯一决定 | accepted |
| WE-D05 | 沙盒网络默认隔离，出网走 allowlist 代理 | accepted |
| WE-D06 | 跨 OS 收敛到 ExecutorBackend SPI；Win/mac 目标 runner 后置 REMOTE_CONNECTOR | accepted |
| WE-D07 | 提权走线下 owner 授权，无对话内提权通道 | accepted |
| WE-D08 | TerminalSession 双落点同构、Desktop 单面板标注 | accepted |

## MCA-D14: Home 工作状态由 Station 投影

**Status**: accepted
**Date**: 2026-08-17

### Context

Agent readiness、会话和任务若由页面分别推导会产生互相矛盾的状态。

### Decision

Home 使用 Station-owned work projection，客户端只消费并呈现该投影。

### Rationale

单一业务真源允许多客户端与重启恢复得到一致结果。

### Alternatives Considered

由各页面独立拼装状态；该方案因无法保证 freshness 与一致性而拒绝。

### Consequences

Station 必须提供稳定身份和可重放投影，客户端不得持有替代权威状态。

## MCA-D15: 使用统一能力清单与 Agent 绑定

**Status**: accepted
**Date**: 2026-08-17

### Context

Builtin tool、Skill、MCP、Connector 与本机能力曾使用不同标识和 readiness 路径。

### Decision

所有能力通过版本化 manifest、Agent binding 和 readiness snapshot 接入。

### Rationale

统一合同使能力选择、降级、撤权和审计可以使用同一身份模型。

### Alternatives Considered

保留每类能力的私有绑定模型；该方案会持续制造分叉和重复治理。

### Consequences

能力不可绕过 binding/readiness 直接进入 Turn。

## MCA-D16: Station 管理能力操作，客户端执行本机 MCP

**Status**: superseded by MCA-D16A
**Date**: 2026-08-17

### Context

Desktop 拥有本机 MCP 进程与 secret，但客户端私有状态无法提供权威重放和恢复。

### Decision

Station 创建和推进 ToolCall；Desktop 在能力会话内执行 MCP 并回传 fenced receipt。

### Rationale

该边界同时保留本机资源所有权与 Station 业务权威。

### Alternatives Considered

全部由 Desktop 编排或把本机 secret 移交 Station；两者分别破坏恢复和安全边界。

### Consequences

执行回执必须具备 actor、device、attempt 和 ToolCall lineage。

## MCA-D16A: MCP 配置归 Station，执行服从显式运行位置

**Status**: accepted
**Date**: 2026-10-03

### Context

MCP 是 Agent 能力，不等同于 Desktop 设备能力。现有实现把统一
`mcp.invoke` manifest 固定为客户端执行，导致 Station 上运行的 Agent 调用
Station-local stdio MCP 时必须绕行 Desktop，也无法在 Desktop 离线时继续。

### Decision

Station 持有 actor-scoped MCP Server 配置目录、不可变 revision、tool
manifest、Agent binding、readiness、ToolCall、幂等 mutation command 和
audit 真源。每个 Server 显式声明 `STATION` 或 `CLIENT_CAPABILITY`
execution owner；`stdio`、`http`、`sse` 只描述 transport，不决定 owner。

- `STATION` Server 在 Station 运行时启动本地 stdio 进程或访问 Station
  可达的 HTTP/SSE endpoint，复用 Station ToolCall claim、receipt 和
  continuation。
- `CLIENT_CAPABILITY` Server 在 Desktop Rust 运行时启动本地 stdio
  进程或访问 Desktop 可达的 HTTP/SSE endpoint，复用现有 capability
  session、fencing 和 receipt。
- secret material 和进程状态留在执行位置；Station 配置只持有 secret
  reference 和脱敏投影。
- 每个已发现 MCP tool 发布独立、版本化 manifest，并在 Turn admission
  前固定 execution owner；模型参数和客户端不得改写 owner。

### Rationale

这使 Agent 在 Station 就近执行可共享的 MCP，同时保留 Desktop 设备资源的
本地安全边界，并让两种执行路径共享同一治理、审计和恢复协议。

### Alternatives Considered

- 所有 MCP 固定在 Desktop：拒绝，因为 Station Agent 会产生
  Station → Desktop → Station 的反向依赖，且 Desktop 离线即失效。
- 所有 MCP 固定在 Station：拒绝，因为设备文件、桌面凭证和用户本机进程不应
  搬到远端 Station。
- 根据 transport 或 ToolCall 参数临时选择 owner：拒绝，因为会绕过 manifest
  binding/readiness，并使同一调用的审计身份不稳定。

### Consequences

- Desktop MCP store 不再是目录/config 真源，只保留
  `CLIENT_CAPABILITY` secret material 与运行时进程状态。
- Station 增加 MCP Server 配置、tool discovery 和 Station executor。
- 旧 `local_mcp` 通用 manifest/guidance 必须删除，不能与逐 Server/Tool
  manifest 并存。
- Station-local stdio 的命令与文件路径相对 Station 运行环境解释；Desktop
  路径绝不透传。

## MCA-D17: Connector 资源与 Agent 工具清单分离

**Status**: accepted
**Date**: 2026-08-17

### Context

OAuth 连接、资源发现、工具同步、Agent 绑定与调用是不同生命周期。

### Decision

Connector owner 管理授权资源，Agent 只消费由其同步出的工具 manifest。

### Rationale

分离后可独立撤权、刷新和审计，而无需向 Agent 暴露 OAuth secret。

### Alternatives Considered

把 Connector 配置直接作为 Agent 工具；该方案混淆权限与执行状态。

### Consequences

Connector 失效必须使相关能力 readiness 失效并阻止新调用。

## MCA-D18: Evaluation 使用 Station 聚合

**Status**: accepted
**Date**: 2026-08-17

### Context

客户端直接运行 Evaluation 会绕过权威 Turn、数据集和结果生命周期。

### Decision

Evaluation run/result 由 Station 聚合，并复用 canonical Turn kernel。

### Rationale

统一 Turn 路径可以保留输入、模型、能力和结果的可追踪身份。

### Alternatives Considered

保留 Desktop `quickCompletion` 作为 Evaluation owner；该方案无法提供共享真源。

### Consequences

客户端只负责创建请求、观察进度和展示结果。

## MCA-D20: 使用发布者签名 catalog 与权威读回

**Status**: accepted
**Date**: 2026-09-17

### Context

Agent、Skill 与 MCP 发现需要可信来源，任意 URL JSON 无法证明发布者和安装状态。

### Decision

使用发布者签名的 catalog snapshot，并从目标 authority 读回安装与撤权状态。

### Rationale

签名验证建立来源信任，权威读回证明实际状态而不是页面乐观结果。

### Alternatives Considered

托管商业 Marketplace 或继续接受任意 JSON；均超出当前信任和产品边界。

### Consequences

Catalog transport 不得替代签名信任，安装证明必须来自目标 authority。

## MCA-D22: 使用 Station-owned 能力场景控制面

**Status**: accepted
**Date**: 2026-09-18

### Context

部分能力失败与竞态无法通过公开产品输入确定性触发。

### Decision

建立受限、run-scoped、非生产可用的 Station-owned Acceptance 场景控制面。

### Rationale

单一控制面能在不创建第二业务真源的前提下产生可复验失败证据。

### Alternatives Considered

在客户端加入 mock 分支或依赖随机故障；两者都不能形成可信正式证据。

### Consequences

场景必须绑定 run/actor、显式清理，并在生产配置中 fail closed。

## MCA-D23: 单一场景控制面覆盖 ToolCall、MCP 与 Connector

**Status**: accepted
**Date**: 2026-09-19

### Context

ToolCall、MCP 和 Connector 的错误、取消与竞态需要一致的执行身份和证据语义。

### Decision

扩展 MCA-D22 的同一控制面覆盖这些能力操作，不新增平行场景 authority。

### Rationale

共享 run、barrier、receipt 和 cleanup 合同可避免不同 Gate 形成相互冲突的真源。

### Alternatives Considered

为每类能力建立独立测试控制器；该方案会重复生命周期并削弱证据可比性。

### Consequences

所有场景必须证明零执行或一次执行边界，并保留完整 ToolCall lineage。

---

> 以下 WE-* 决策的完整论证（含证据分级、拓扑与跨 OS 矩阵）见
> [workspace-execution/decisions.md](./workspace-execution/decisions.md)。

## WE-D01: Station 沙盒用 sibling 容器，禁止 DinD/挂 docker.sock

**Status**: accepted
**Date**: 2026-11-04

### Context

Station 容器当前无 docker.sock、非特权、只挂数据卷；docker.sock 实际等同宿主 root。

### Decision

沙盒由独立 workspace-sandbox-provisioner 在宿主命名空间创建为 sibling 容器；Station 永不挂 sock、不 privileged、不 DinD。

### Rationale

把"能建容器"收敛为可独立审计/鉴权/配额的窄服务，形成大脑/身体分离，保持 Station 最小权限。

### Alternatives Considered

DinD（privileged、嵌套存储网络、放大逃逸面）；把 sock 直接挂进 Station（等于交宿主 root）。

### Consequences

隔离清晰但新增一个部署单元；切换 microVM 控制面时 Station 无特权原则不变。

## WE-D02: 沙盒持久单元是 workspace

**Status**: accepted
**Date**: 2026-11-04

### Context

agent 是轻量配置行且可多工作区；每命令一容器丢状态，每 agent 单容器隔离过粗。

### Decision

sandbox_ref = (actor, agent, workspace_root) 的分配；容器一次性、可回收/重建，workspace 命名卷持久。

### Rationale

以工作区为安全域；持久身份落卷，便于镜像升级、配额与并发回收。

### Alternatives Considered

每命令容器（无法跑长服务/保 cwd）；每 agent 常驻单容器（粗隔离、回收复杂）。

### Consequences

需要分配表与卷回收策略；冷启动成本由懒启动/warm pool 缓解。

## WE-D03: 沙盒非 root + no-new-priv + 只读 rootfs 为硬前提

**Status**: accepted
**Date**: 2026-11-04

### Context

"突破沙盒自然报错"只有在工作负载非特权且无法提权时才由 OS 强制成立。

### Decision

沙盒以非 root 运行，开启 no-new-privileges、drop caps、seccomp、只读 rootfs，仅 /workspace 可写。

### Rationale

越界自然 EACCES/EPERM，应用层无需伪装拒绝。

### Alternatives Considered

以 root 跑再靠应用层判断（提权后不报 EACCES，语义不成立）。

### Consequences

系统依赖需入镜像或走 owner 授权，不允许运行时提权安装。

## WE-D04: 禁止沙盒→本机回落

**Status**: accepted
**Date**: 2026-11-04

### Context

沙盒失败偷偷改在用户桌面执行是静默提权/数据越界路径。

### Decision

落点由 turn 绑定 capability 执行面唯一决定；同一 turn 不混用；binding 未就绪/失败一律 fail-closed。

### Rationale

执行边界必须可预期、可审计。

### Alternatives Considered

失败自动回退 desktop（可用性换安全，拒绝）。

### Consequences

本机专属能力与服务端隔离任务须分 turn，调度需显式表达。

## WE-D05: 沙盒网络默认隔离，出网走 allowlist 代理

**Status**: accepted
**Date**: 2026-11-04

### Context

Station 内网含 Postgres 凭据与多 actor 数据。

### Decision

沙盒与 Station 内网隔离，默认不可达 DB/内部端口，外网经 egress allowlist 代理。

### Rationale

阻断沙盒内恶意依赖对 Station 的横向访问。

### Alternatives Considered

共享默认 bridge（横向可达，拒绝）。

### Consequences

需声明依赖源 allowlist；私有包源显式放行。

## WE-D06: 跨 OS 收敛到 ExecutorBackend SPI；Win/mac 目标 runner 后置

**Status**: accepted
**Date**: 2026-11-04

### Context

宿主平台差异大，但构建/服务目标绝大多数是 Linux，mac/Win 已用 Linux VM+OCI 统一跑 Linux 容器。

### Decision

差异收敛到 provisioner 后端 SPI；首期 Linux OCI，mac/Win dev 经 OrbStack/Docker Desktop/WSL2；以 Win/macOS 为目标 OS 的执行体走 REMOTE_CONNECTOR 专用 runner，列项目末期。

### Rationale

不为跨宿主重写多套沙盒，也不假装 Linux 容器能构建原生 Win/mac 产物。

### Alternatives Considered

在 Station 内自支持 Windows/macOS 容器（不可移植、需 Apple 硬件）。

### Consequences

Linux 跨宿主一致；原生 mac/iOS/Windows 构建后期建专用 runner 池。

## WE-D07: 提权走线下 owner 授权

**Status**: accepted
**Date**: 2026-11-04

### Context

对话内提权按钮易被模型/提示诱导，且绕过既有绑定模型。

### Decision

需要更高权限/挂载/角色时产出授权请求工件；owner 带外改绑定并升 revision、重走 readiness 后下一条命令直接执行。

### Rationale

把权限授予留在 capability binding/revision/owner 模型内，责任可审计。

### Alternatives Considered

对话内"允许 sudo"（拒绝）。

### Consequences

首次配置略重，靠合理默认镜像/挂载减少触发。

## WE-D08: TerminalSession 双落点同构、Desktop 单面板

**Status**: accepted
**Date**: 2026-11-04

### Context

D5 已有设备 TerminalSession 的 viewer/cursor/UNKNOWN 诚实语义。

### Decision

TerminalSession 增加 execution_target+sandbox_ref；PTY/ring 在 sandbox 模式归 provisioner；Station 元数据/状态合同不变；Desktop 同一面板只标注落点。

### Rationale

复用成熟合同，不造第二套终端。

### Alternatives Considered

为沙盒另建一套终端状态/UI（拒绝）。

### Consequences

provisioner 需实现与 worker 等价的 PTY/ring/reconcile 能力。
