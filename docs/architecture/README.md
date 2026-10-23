# Peers-Touch 架构文档

> **Status**: active
> **Version**: v3.0
> **Created**: 2026-10-05 | **Updated**: 2026-10-20
> **Owner**: Architecture Team

---

## 1. Document Scope

本目录定义跨端、跨运行时和跨模块的系统边界、Source of Truth、Owner、
协议、状态机与集成关系。

本目录不定义：

- 单端内部落地，见 `docs/client/` 与 `docs/station/`；
- 具体编码规范，见 `docs/global/coding-guide/`；
- 历史研究和过程记录，见 `docs/context/` 与各模块的历史执行计划。

项目级系统上下文、逻辑分层、运行时拓扑、权威边界和关键动态链路由
[`architecture.md`](./architecture.md) 定义；本文件负责把该架构映射到当前
可发现的正式模块、代码治理范围和图引用。

## 2. 项目架构与模块索引

- [系统上下文](./system-context.svg)
- [逻辑分层架构](./architecture.svg)
- [项目运行时拓扑](./runtime-topology.svg)
- [权威与状态真源](./authority-map.svg)
- [同 Station 业务闭环](./journey-same-station.svg)
- [Direct / Relay 路由汇合](./journey-route-convergence.svg)
- [跨 Station Durable 投递](./journey-cross-station.svg)
- [工程控制面](./engineering-control-plane.svg)
- [架构图反向引用](./references.md)

模块索引由
[`architecture-modules.json`](./engineering/architecture-governance/architecture-modules.json)
生成。Registry 继续作为唯一机器模块清单；本表不建立第二份 module truth。

### Active Module Index

| Module ID | Taxonomy | Owner | Primary architecture | Governed paths |
|---|---|---|---|---:|
| `agent` | domains | Peers-Touch Agent Team | [design.md](./domains/agent/design.md) | [8](./engineering/architecture-governance/architecture-modules.json) |
| `bot` | domains | Peers-Touch Bot Team | [design.md](./domains/bot/design.md) | [6](./engineering/architecture-governance/architecture-modules.json) |
| `chat-storage-governance` | domains | Device Messaging Engine | [design.md](./domains/chat/storage-governance/design.md) | [18](./engineering/architecture-governance/architecture-modules.json) |
| `oauth-login-broker` | domains | Identity and Access | [design.md](./domains/identity/oauth-login-broker/design.md) | [2](./engineering/architecture-governance/architecture-modules.json) |
| `cross-station-social` | domains | Social / Federation | [design.md](./domains/social/cross-station/design.md) | [1](./engineering/architecture-governance/architecture-modules.json) |
| `acceptance` | engineering | Architecture Team | [design.md](./engineering/acceptance/design.md) | [8](./engineering/architecture-governance/architecture-modules.json) |
| `api-ownership` | engineering | Architecture Team | [design.md](./engineering/api-governance/design.md) | [1](./engineering/architecture-governance/architecture-modules.json) |
| `architecture-module-governance` | engineering | Architecture Team | [design.md](./engineering/architecture-governance/design.md) | [20](./engineering/architecture-governance/architecture-modules.json) |
| `development-workflow` | engineering | Platform Team | [design.md](./engineering/development-workflow/design.md) | [34](./engineering/architecture-governance/architecture-modules.json) |
| `local-dev-control-plane` | engineering | Platform Team | [design.md](./engineering/local-dev/design.md) | [26](./engineering/architecture-governance/architecture-modules.json) |
| `x-config` | platform | Client Platform | [design.md](./platform/client/control-plane/design.md) | [11](./engineering/architecture-governance/architecture-modules.json) |
| `cross-client-runtime` | platform | Client Platform Team | [cross-client-runtime.reuse-topology](./platform/client/cross-client-runtime/architecture.svg) | [19](./engineering/architecture-governance/architecture-modules.json) |
| `mobile-social-parity` | platform | Mobile / Social / Client Architecture | [design.md](./platform/client/mobile/social-parity/design.md) | [9](./engineering/architecture-governance/architecture-modules.json) |
| `node-connectivity` | platform | Architecture Team | [design.md](./platform/runtime/node-connectivity/design.md) | [12](./engineering/architecture-governance/architecture-modules.json) |
| `station-access-lifecycle` | platform | Identity and Access | [design.md](./platform/station/access/design.md) | [24](./engineering/architecture-governance/architecture-modules.json) |
| `secure-content` | shared | Architecture Team | [design.md](./shared/security/secure-content/design.md) | [1](./engineering/architecture-governance/architecture-modules.json) |

## 3. 物理目录与所有权

`docs/architecture` 只保留四个一级分类。分类目录用于导航，叶子模块继续拥有自己的
README、设计、决策和机器治理声明。

```text
docs/architecture/
├── README.md      # architecture portal and generated module index
├── architecture.md # project architecture narrative
├── system-context.diagram.json
├── system-context.svg
├── architecture.diagram.json
├── architecture.svg
├── runtime-topology.diagram.json
├── runtime-topology.svg
├── authority-map.diagram.json
├── authority-map.svg
├── journey-*.diagram.json
├── journey-*.svg
├── engineering-control-plane.diagram.json
├── engineering-control-plane.svg
├── references.md  # generated diagram reverse references
├── domains/       # Station business truth and cross-client product contracts
├── platform/      # Client / Station / contract / runtime implementation boundaries
├── shared/        # Narrow cross-domain capabilities without business authority
└── engineering/   # Development, governance, quality, Acceptance, and tooling
```

| 分类 | 入口 | 与代码架构的关系 |
|---|---|---|
| 业务域 | [domains/](./domains/README.md) | 对应 Federation、Notification 等 `apps/station/app/subserver/*` 业务真源、`model/domain/*` 契约与客户端投影 |
| 平台 | [platform/](./platform/README.md) | 对应 Client、Station Frame、共享 contracts 与 runtime foundations |
| 共享能力 | [shared/](./shared/README.md) | 通信、安全、i18n 等不拥有业务状态的窄能力 |
| 工程控制面 | [engineering/](./engineering/README.md) | Workflow、Local Dev、Acceptance、Quality、治理与工具链 |

进入机器治理的 active 模块以
[`architecture-modules.json`](./engineering/architecture-governance/architecture-modules.json)
为准。分类 README 只负责导航，不得取得叶子模块的 capability ownership。

## 4. 文档形态

| 形态 | 用途 | 规则 |
|---|---|---|
| 模块文档集 | active ownership、协议、状态和集成关系 | `README.md` + `design.md` + `decisions.md`，按特征补齐其他文件 |
| 单专题文档 | 尚未扩成独立模块的聚焦架构 | 必须从本索引或所属模块 README 可发现 |
| `execution-plans/` | 历史或当前交付输入 | Frozen Plan Package 原样保留；不得替代当前架构真源 |
| `prototype/` | 可运行产品形态对齐 | 必须登记到 [Prototypes](./engineering/prototypes/README.md) |
| `archive/` / superseded | 历史证据 | 不参与当前 owner、resume 或 readiness 判断 |

## 5. 缺口、草案与历史

- [Federated IM](../context/architecture/chat/federated-im/README.md) 已退出 active
  taxonomy；当前 Chat 真源是 Chat Lifecycle、Messaging Platform 与 API Governance。
- [Federated Social Activity](./domains/social/federation/README.md)、
  [Applet Runtime](./platform/applet-runtime/README.md) 和
  [Atelier](./domains/applets/atelier/README.md) 仍是 draft。
- Note、Applet Catalog 与部分 Station operations 已有代码 owner，但缺少接受后的
  业务/平台架构集；缺口分别记录在最近的分类 README，不由相邻模块代管。
- Frozen Plan Package 内容是历史不可变快照。目录迁移不改写其 source claims、
  Task Slice 或命令；当前导航和 readiness 不从这些旧路径推导。
- [Desktop Shell Prototype](./engineering/prototypes/desktop-shell/README.md)
  只属于 Prototype Registry，不是独立 Desktop 架构模块。

## 6. 维护与验证

新增或调整文档时：

1. 先确认它属于架构层，而不是平台实现、编码规范或历史记录。
2. 更新最近的模块 README；成为当前真源时再更新本索引和 `docs/README.md`。
3. active 模块或 taxonomy index 变化时同步
   `engineering/architecture-governance/architecture-modules.json`。
4. canonical 图使用模块目录内的 `*.diagram.json` 作为视图 spec，由统一 renderer
   生成独立 SVG；Markdown 只嵌入 SVG，不暴露机器元数据或渲染语法。
5. 运行 `node tooling/scripts/architecture/diagram-render.mjs` 生成 SVG，再运行
   `node tooling/scripts/architecture/document-index.mjs` 更新模块索引与反向引用。
   把 SVG 转成 PNG 目检层次、文字和连线路由；两个命令都必须通过 `--check`
   模式验证无漂移。
6. 相对链接必须在仓库内可解析；禁止提交开发者绝对 `file://` 链接。

架构文档格式见
[`architecture-document-standard.md`](../global/architecture-document-standard.md)。
