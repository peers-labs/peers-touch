# 工作区执行落点 — 决策记录（ADR-lite）

> **Status**: accepted（Owner 2026-11-04 确认决策点与跨 OS 取舍）

## WE-D01：sibling 容器，不在 Station 内 DinD

- **Context（verified）**：Station 容器当前无 docker.sock、非特权、只挂数据卷、独立内网。docker.sock 实际等同宿主 root；DefCon 2026 已有对 agent 默认沙箱的逃逸研究。
- **Decision**：沙盒由独立 provisioner 在宿主命名空间创建为 sibling 容器；Station 永不挂 docker.sock、不 privileged、不内嵌 Docker daemon。
- **Rationale**：保持 Station 容器最小权限；把"能建容器"收敛为一个可单独审计、鉴权、配额的窄服务，形成大脑/身体分离。
- **Alternatives rejected**：DinD（要 privileged、嵌套存储与网络、放大逃逸面）；直接挂 sock 进 Station（等于把宿主 root 交给被攻陷的编排进程）。
- **Consequences（+/-）**：+ 隔离清晰、Station 可继续非特权；− 多一个部署单元与运行时依赖。
- **Reversal trigger**：若采用 microVM 控制面（Firecracker/Kata），provisioner 改为对接其 API，但 Station 无特权原则不变。

## WE-D02：持久单元是 workspace，不是 agent、不是每条命令

- **Context**：agent 是轻量配置行且可多工作区；每条命令一容器会丢 shell/服务状态且启动昂贵；"一个 agent 一个常驻容器"会把无关工作区挤在同一安全域。
- **Decision**：`sandbox_ref` = (actor, agent, workspace_root) 的一次分配；容器一次性、可回收/重建，workspace 命名卷持久。
- **Rationale**：隔离以工作区为安全域；持久身份落在卷，便于镜像升级、配额与并发回收。
- **Alternatives rejected**：每命令容器（无法跑长服务/保留 cwd）；每 agent 单容器（粗隔离、并发与回收复杂）。
- **Consequences**：+ 干净隔离/可替换镜像；− 需要卷与容器映射的分配表与回收策略。
- **Review condition**：若出现大量超短命工作区导致冷启动成为瓶颈，再评估 warm pool（仍按 workspace ref）。

## WE-D03：非 root + no-new-priv + 只读 rootfs 是硬前提

- **Context（inference/verified 混合）**：Owner 要求"突破沙盒直接报错即可"。该语义只有在工作负载非特权、且无法提权时才由 OS 强制成立。
- **Decision**：沙盒以非 root 用户运行，开启 `no-new-privileges`，drop capabilities，seccomp 默认，rootfs 只读，仅 `/workspace` 可写。
- **Consequences**：+ 越界自然 EACCES/EPERM，应用层无需伪装；− 某些需要系统依赖安装的任务必须显式装入镜像或走 owner 授权，不允许运行时 apt 提权。

## WE-D04：禁止沙盒→本机回退；落点由 capability 执行面唯一决定

- **Decision**：一个 turn 的执行落点由其绑定 capability 的执行面决定；沙盒 binding 未就绪/失败时 fail-closed，**绝不**改在用户桌面执行。同一 turn 不混用两落点；跨 turn 可切换。
- **Rationale**：任何"沙盒失败偷偷落到本机"都是静默提权/数据越界路径。
- **Consequences**：+ 安全可预期；− 本机专属能力（GUI/本机凭据）与服务端隔离任务必须分 turn，调度需显式表达。

## WE-D05：网络默认隔离，出网走 allowlist 代理

- **Context（verified）**：Station 内网含 Postgres 凭据与多 actor 数据。
- **Decision**：沙盒置于与 Station 内网隔离的网络；默认不可达 DB/内部端口；外网经 egress allowlist 代理。
- **Rationale**：阻断沙盒内恶意依赖（如投毒 npm/pip）对 Station 的横向访问。
- **Consequences**：− 需要声明依赖源 allowlist（私有包源走显式放行）；+ 横向移动面显著收敛。

## WE-D06：跨 OS 用 ExecutorBackend SPI；Linux 为先，异构目标 OS 后置为 REMOTE_CONNECTOR

- **Context**：宿主力差异大；但 agent 的构建/服务目标绝大多数是 Linux，且 mac/Win 已用"Linux VM + OCI"统一了跑 Linux 容器的能力。
- **Decision**：差异收敛到 provisioner 内 `ExecutorBackend`；首期 Linux 生产 OCI（containerd 对齐，实现可先 docker），macOS/Windows dev 经 OrbStack/Docker Desktop/WSL2 跑同一 Linux 沙盒；**以 Windows/macOS 为目标 OS** 的执行体走预留的 `ExecutorKind_REMOTE_CONNECTOR`（专用 runner），列为项目末期任务，本期不实现。
- **Rationale**：不为跨宿主重写 N 套沙盒；不假装 Linux 容器能构建原生 Win/Mac 产物。
- **Alternatives rejected**：在 Station 内自行支持 Windows/macOS 容器（不可移植、Apple 平台还需特定硬件）。
- **Consequences**：+ Linux 体验跨宿主一致、范围可控；− 真正的 mac/iOS/Windows 构建需后期建设专用 runner 池（同 CI 行业做法）。
- **Open（后期）**：remote runner 的注册、凭据、镜像/机型与调度合同，在进入该任务时单独立设计。

## WE-D07：提权线下 owner 授权，不开对话内提权通道

- **Decision**：沙盒内需要更高权限/额外挂载/角色时，产出授权请求工件；owner 带外修改绑定并升 binding revision（重走 readiness），下一条命令直接执行。
- **Rationale**：把"权限授予"留在既有 capability binding/revision/owner 模型内，避免在 agent 对话链路新增可被诱导点击的提权按钮。
- **Consequences**：+ 审计与责任主体清晰；− 首次配置略重，靠合理默认镜像/挂载减少触发。

## WE-D08：Terminal 合同双落点、UI 单面板

- **Decision**：`TerminalSession` 增加 `execution_target` + `sandbox_ref`；device 模式 PTY 归 Desktop worker，sandbox 模式 PTY/ring 归 provisioner；Station 元数据/诚实状态/reconcile 合同不变；UI 同一终端面板仅标注落点。
- **Rationale**：复用 D5 的 viewer 订阅、cursor 回放、UNKNOWN 诚实语义，不造第二套终端。
- **Consequences**：+ 交互一致；− provisioner 需实现与 worker 等价的 PTY/ring/reconcile 能力。
