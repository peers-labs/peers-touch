# Peers-Touch 架构文档

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-10-05 | **Updated**: 2026-10-06
> **Owner**: Architecture Team

---

## 1. Document Scope

本目录定义跨端、跨运行时和跨模块的系统边界、Source of Truth、Owner、
协议、状态机与集成关系。

本目录不定义：

- 单端内部落地，见 `docs/client/` 与 `docs/station/`；
- 具体编码规范，见 `docs/global/coding-guide/`；
- 历史研究和过程记录，见 `docs/context/` 与各模块的历史执行计划。

项目级三层架构由
[`docs/global/architecture.md`](../global/architecture.md) 定义；本文件负责把
该架构映射到当前可发现的正式模块和专题文档。

## 2. 当前代码架构映射

```text
Client
  apps/desktop
  apps/mobile
      |
      | generated contracts / Station APIs
      v
Model
  model/domain
      |
      v
Station
  apps/station/app    business/domain owners
  apps/station/frame  framework/transport/infrastructure
```

| 代码边界 | 架构入口 | 说明 |
|---|---|---|
| 全局 Client / Model / Station | [全局架构](../global/architecture.md) | 项目级 Source of Truth 与依赖方向 |
| Station 与客户端 | [Station/Desktop 边界](./platform/station-desktop-boundary.md) · [Station Access](./platform/station/access/README.md) | 共享业务真源、设备侧编排和接入生命周期 |
| Desktop 本地运行时 | [Runtime](./platform/client/desktop/runtime.md) · [Frontend Runtime](./platform/client/frontend-runtime/README.md) | Tauri、embedded renderer、本地 BFF 与前端投影 |
| Mobile | [Mobile](./platform/client/mobile/README.md) | Tauri Mobile、Rust capability kernel 与 native plugins |
| 公共 API / Proto | [API Ownership](./engineering/api-governance/README.md) · [Model](../global/domain-model.md) | Resource owner、公开路由与跨端契约 |

## 3. 物理目录与所有权

`docs/architecture` 只保留四个一级分类。分类目录用于导航，叶子模块继续拥有自己的
README、设计、决策和机器治理声明。

```text
docs/architecture/
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
4. 相对链接必须在仓库内可解析；禁止提交开发者绝对 `file://` 链接。
5. 标题锚点必须指向当前文件中的真实 heading。

架构文档格式见
[`architecture-document-standard.md`](../global/architecture-document-standard.md)。
