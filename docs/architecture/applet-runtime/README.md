# Applet Runtime Architecture

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-05-19 | **Updated**: 2026-05-19
> **Owner**: Architecture Team
> **Module**: `apps/desktop/src/applet/`, `apps/mobile/`, `packages/applet-sdk/`, `packages/applets/`

---

## 1. Document Scope

本文档定义：

- Peers-Touch Applet / 小程序运行时的长期架构方向
- Desktop、Android、iOS 三端的容器分工
- Applet 前端代码如何做到一套源码跨端运行
- Host、Runtime、Bridge、Capability Gateway、Applet SDK 的职责边界
- Manifest、Bundle、Bridge、权限、生命周期的统一口径

本文档不定义：

- 某个具体 Applet 的业务领域建模
- Lynx 官方引擎内部实现细节
- Station 业务 API 的领域模型
- Desktop / Mobile 单端编码规范正文
- applet 市场、审核、计费、运营策略

---

## 2. 背景与问题

当前仓库中 Applet 相关材料分散在 Desktop 编码指南、Mobile 容器说明和历史任务记录里，缺少一个跨端架构真源。

已确认的问题：

- Desktop 历史实现曾出现 `iframe + postMessage` 路线，和目标 Lynx Runtime 不一致。
- Mobile 文档已经确认 LynxView 方向，但缺少与 Desktop 的统一运行时契约。
- Applet 前端需要同时运行在 Desktop 和 Mobile，不能绑定 React DOM、Browser DOM、iframe、Web-only SDK。
- Bridge、权限、配置、网络、存储必须由 Host 执行强制治理，不能依赖 Applet 自律。
- Applet 工程需要独立开发和分发，但不能形成绕过主系统架构的“小应用后门”。

因此需要把 Applet Runtime 提升为架构层真源，明确长期方案和阶段性执行边界。

---

## 3. 设计目标

1. **一套 Applet 前端源码跨端运行**：Applet UI 使用 ReactLynx / Lynx 元素，不使用 React DOM 作为跨端基础。
2. **真 Lynx Runtime 托管**：Desktop 使用 Lynx for Web 的 `<lynx-view>`，Mobile 使用原生 `LynxView`。
3. **Host 管理生命周期**：Applet 不能自建浏览器上下文、不能自行持有敏感 Host 能力。
4. **能力调用统一进 Gateway**：Storage、Network、Config、Notification 等能力全部走 Host Capability Gateway。
5. **权限默认拒绝**：Manifest 声明是能力上限，Host 运行时按 applet id、session、method 做强校验。
6. **端侧差异对 Applet 透明**：Desktop / Android / iOS 的 Bridge 注入方式不同，但 SDK 暴露同一套接口。
7. **无历史包袱**：新架构不保留 iframe runtime、`window.parent.postMessage`、React DOM bundle 作为正式 Applet 路线。

---

## 4. 文档导航

| 文档 | 说明 |
|------|------|
| [design.md](./design.md) | 总体架构、核心原则、端侧分工、调用链 |
| [decisions.md](./decisions.md) | 技术选型和关键取舍，包含缺点与替代方案 |
| [module-layout.md](./module-layout.md) | Host、SDK、Applet 工程、Mobile 宿主的目录与职责 |
| [data-model.md](./data-model.md) | Manifest、Bundle、Bridge、Capability、生命周期协议 |
| [integration.md](./integration.md) | 与现有 Desktop/Mobile/my-peers-applets 的映射和迁移策略 |

---

## 5. Source Relationship

本模块是 Applet Runtime 的架构层真源。下游文档必须在本文允许的边界内展开：

- Desktop 平台落地：`docs/client/desktop/`
- Mobile 平台落地：`docs/client/mobile/`
- 编码规范：`docs/global/coding-guide/`
- Applet 业务仓约束：`my-peers-applets/AGENTS.md` 与该仓 `docs/`
