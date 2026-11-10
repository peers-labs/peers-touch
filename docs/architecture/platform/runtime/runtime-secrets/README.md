# Runtime Secrets Provisioning

> **Status**: active
> **Version**: v0.1
> **Created**: 2026-11-06 | **Updated**: 2026-11-06
> **Owner**: Platform Team
> **Module**: `tooling/scripts/deploy/`, `tooling/docker/`, env repo `peers-touch/<profile>/`

---

## 1. Document Scope

本文档集定义 Station / Relay **部署期运行时密钥**的配给（provisioning）契约：密钥如何
按角色分类、权威源在哪、如何随 `make station` / `make relay` 幂等且保密地到达目标主机，
以及缺失时如何在产生副作用之前 fail-closed。

本文档定义：

- 运行时密钥的两类模型（主机本地生成类 vs 外部/共享类）与判定标准；
- 每类密钥的权威源（authority）、静态存储与传输边界；
- per-profile / per-role 的 secret 声明、解析、预检与远端对账（reconcile）流程；
- 部署链路（deploy pipeline）、compose、entrypoint 的 fail-closed 职责；
- 密钥不进源码仓、不进 argv/日志/证据的保密不变量。

本文档不定义：

- 运行时凭据"属于谁、信任边界是什么"（见
  [Service Coordination §4 Credential Ownership](../service-coordination.md)）；本模块只回答
  "值如何从权威源到主机、谁负责对账"；
- profile / slot / lease / 主机注册等 Local Dev 控制面模型，见
  [Local Dev Control Plane](../../../engineering/local-dev/README.md) 与
  [Local Dev Environment](../../../../global/local-dev-environment.md)；
- OAuth broker 自身的密钥体系与 Vercel 发布，见
  [OAuth Login Broker](../../../domains/identity/oauth-login-broker/README.md)；
- 具体业务密钥（LiveKit、Agent provider 等）的消费逻辑，本模块只承接其配给机制；
- Relay 运行时 TLS/CA/operator key 的本机生成实现细节（既有
  `posix_relay_runtime.py` 机制保持不变）。

## 2. Current Problem

研发期 `make station` / `make relay` 目前只完成"同步代码 → 构建 → 用远端持久 env 重启 compose"，
**从不对运行时密钥做对账或下发**。后果（已由真机事故证实）：

- `PEERS_OAUTH_BRIDGE_SECRET` 这类**值的权威在外部系统**的共享密钥没有任何到达路径；
  远端 env 缺该键、compose 又用静默空默认（`${VAR:-}`），部署显示成功，首个用户登录才
  fail-closed。
- 旧扁平 profile（如 `four`）多个 compose project 共用一个全局 `$HOME/peers-touch/station.env`，
  存在跨项目互相覆盖的面；per-role 的 git-crypt `runtime.env` 契约只在 `corpdebug`/`home`
  等新契约 profile 上存在。
- 现有约定把 `runtime.env` 一律视为"一次性主机本地装备、deploy 只读"，对主机本地生成类密钥
  正确，对外部/共享类密钥不成立——后者必须随部署与外部权威保持一致。

根因不是某次配置遗漏，而是**架构上缺少"部署期密钥配给与分类"这一层**。

## 3. Design Goals

1. `make station` / `make relay` 在一个已评审 profile 上**部署即能用**：该角色必需的外部/共享
   密钥随部署自动、保密到达，缺失在构建/重启前阻断。
2. 密钥分两类，权威不同、生命周期不同：主机本地生成类不外传、不覆盖；外部/共享类以加密 profile
   为权威、每次部署幂等对账。
3. 复用既有件：per-role git-crypt `runtime.env`、`PT_DEPLOY_RUNTIME_KIND/PATH`、
   compose project 命名空间；不新增第二套 secret 体系。
4. 密钥值永不进入产品源码仓、argv、日志、证据或聊天；只经 SSH stdin 传输，远端 0600 落盘。
5. 拓扑（host/角色/端口/命令）仍是评审 deploy 定义的唯一权威；secret 层只能注入运行时 env，
   无权重定向部署目标。
6. 缺失/错误密钥必须 fail-closed 且可读（报键名与配对命令），不允许"静默空值 + 延迟到首个请求"。
7. 机制通用：首期承接 Station OAuth bridge 与 Relay 共享密钥，LiveKit 等后续仅靠声明接入，零机制改动。

## 4. Document Navigation

| Document | Purpose |
|---|---|
| [design.md](./design.md) | 密钥分类、权威源、信任边界、系统架构与对账契约 |
| [decisions.md](./decisions.md) | 分类模型、复用 git-crypt、幂等 upsert、fail-closed 等决策 |
| [data-model.md](./data-model.md) | 密钥清单、secret manifest、runtime.env 结构与对账记录 |
| [module-layout.md](./module-layout.md) | deploy/compose/profile 各文件职责与依赖方向 |
| [integration.md](./integration.md) | 对 deploy、compose、entrypoint、oauth providers、env 仓的改动面与迁移 |

## 5. Related Sources

- [Service Coordination](../service-coordination.md)（运行时凭据所有权）
- [Local Dev Control Plane](../../../engineering/local-dev/README.md)
- [OAuth Login Broker integration](../../../domains/identity/oauth-login-broker/integration.md)
- X Config runtime env 先例：
  [Client Control Plane §5/§7](../../client/control-plane/module-layout.md)
- env 仓库 `peers-touch/corpdebug/{station,relay}/runtime.env.example`（per-role 契约先例）
