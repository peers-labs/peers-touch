# Applet Runtime Architecture

> **Status**: draft
> **Version**: v1.3
> **Created**: 2026-05-19 | **Updated**: 2026-06-17
> **Owner**: Architecture Team
> **Module**: `apps/applets/`, `apps/desktop/src/applet/`, `apps/mobile/`, `packages/applet-sdk/`, `packages/applet-contract/`

---

## 1. Document Scope

本文档定义：

- Peers-Touch Applet / 小程序运行时的长期架构方向
- Desktop、Android、iOS、HarmonyOS reserved、Web 的容器分工
- HarmonyOS 与 Web Host 的预留边界
- Applet 前端代码如何做到一套源码跨端运行
- Host、Runtime、Bridge、Capability Gateway、Applet SDK 的职责边界
- Manifest、Bundle、Bridge、权限、生命周期的统一口径
- 参考微信小程序 SDK 后，Peers-Touch 应暴露的 SDK 能力分层
- 官方 applet 作为独立产品单元时的目录、服务、注入、部署和验收契约

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
6. **端侧差异对 Applet 透明**：Desktop / Android / iOS / HarmonyOS reserved / Web 的 Bridge 注入方式不同，但 SDK 暴露同一套接口。
7. **无历史包袱**：新架构不保留 iframe runtime、`window.parent.postMessage`、React DOM bundle 作为正式 Applet 路线。

---

## 4. 文档架构

不要按文件名或创建时间阅读本目录。Applet Runtime 文档分成 5 层：

1. **入口与目标层**：定义目标、边界、不能做什么。
2. **验收与验证层**：定义什么叫设计通过、什么叫运行通过。
3. **领域设计层**：定义 SDK、Runtime、Service、Contract、目录布局。
4. **执行计划层**：定义 AI 可以照着做的任务顺序、写入范围、命令和失败用例。
5. **参考与历史评估层**：提供研究背景，不是执行真源。

当文档冲突时，优先级如下：

```text
README
  → complex-applet-acceptance
  → development-runtime-readiness-report
  → complex implementation plan
  → sdk/runtime/service/data/module/integration design
  → decisions
  → study / assessment documents
```

如果低优先级文档仍保留旧 MVP 口径，以高优先级文档为准，并修正低优先级文档。

## 5. AI Read Order

When creating, modifying, implementing, or validating official applets under `apps/applets/`, AI agents must use the project skill [`official-applet-development`](../../../tooling/skills/official-applet-development/SKILL.md) before editing.

AI 执行复杂 applet 开发任务时必须按这个顺序读：

1. [README.md](./README.md)
2. [official-applet-architecture-contract.md](./official-applet-architecture-contract.md)
3. [complex-applet-acceptance.md](./complex-applet-acceptance.md)
4. [development-runtime-readiness-report.md](./development-runtime-readiness-report.md)
5. 按目标选择任务级执行计划：
   - 官方 Note applet 验证： [execution-plans/2026-06-17-note-official-applet-implementation-plan.md](./execution-plans/2026-06-17-note-official-applet-implementation-plan.md)
   - 通用复杂 applet 能力： [execution-plans/2026-06-06-complex-applet-implementation-plan.md](./execution-plans/2026-06-06-complex-applet-implementation-plan.md)
6. 按任务选择领域设计：
   - Contract / schema： [data-model.md](./data-model.md), [module-layout.md](./module-layout.md)
   - SDK： [sdk-architecture.md](./sdk-architecture.md)
   - Desktop / Mobile / Web runtime： [runtime-architecture.md](./runtime-architecture.md), [integration.md](./integration.md)
   - Gateway / Station / audit： [service-architecture.md](./service-architecture.md)
   - Design test： [design-validation-matrix.md](./design-validation-matrix.md)

AI 不得只读 `execution-plans/2026-06-06-applet-runtime-formalization.md` 后开始写代码。该文件是总体 phase 计划，不是任务级执行源。

## 6. 文档导航

### 6.1 入口与验收

| 文档 | 说明 |
|------|------|
| [official-applet-architecture-contract.md](./official-applet-architecture-contract.md) | 官方 applet 产品单元契约：`apps/applets`、DDD service、manifest、Host 注入、Station bundled / standalone 部署 |
| [note-applet-validation-design.md](./note-applet-validation-design.md) | Note 作为首个官方 applet 的验证设计：前端、service、service binding、Desktop/Mobile 注入和真实 gate |
| [complex-applet-acceptance.md](./complex-applet-acceptance.md) | 复杂 applet 验收画像：skills、agent/AI、streaming、tasks、service binding、audit 的首批硬门槛 |
| [development-runtime-readiness-report.md](./development-runtime-readiness-report.md) | Peers-Touch 小程序开发与运行能力是否成立的 readiness gate 和 evidence 要求 |
| [design-validation-matrix.md](./design-validation-matrix.md) | 用微信小程序成熟能力域 + Peers-Touch 特有能力逐项沙盘验证设计是否完整 |

### 6.2 领域设计

| 文档 | 说明 |
|------|------|
| [design.md](./design.md) | 总体架构、核心原则、端侧分工、调用链 |
| [sdk-architecture.md](./sdk-architecture.md) | SDK 分层、接口面、复杂 applet 首批能力 |
| [runtime-architecture.md](./runtime-architecture.md) | Desktop、Mobile、HarmonyOS 预留、Web 的运行时容器、生命周期和 Bridge 架构 |
| [service-architecture.md](./service-architecture.md) | Host Gateway、Station applet store、权限、审计、分发、治理服务架构 |
| [data-model.md](./data-model.md) | Manifest、Bundle、Bridge、Capability、生命周期协议 |
| [module-layout.md](./module-layout.md) | Host、SDK、Applet 工程、Mobile 宿主的目录与职责 |
| [integration.md](./integration.md) | Desktop、Mobile、Web、conforming applet package 的集成路径 |
| [decisions.md](./decisions.md) | 技术选型和关键取舍，包含缺点与替代方案 |

### 6.3 执行计划

| 文档 | 说明 |
|------|------|
| [execution-plans/2026-06-17-note-official-applet-implementation-plan.md](./execution-plans/2026-06-17-note-official-applet-implementation-plan.md) | **任务级执行源**：Note 官方 applet，覆盖 `apps/applets/note`、Note service、SDK/Gateway 增强、Desktop 注入、真实证据 |
| [execution-plans/note-official-applet-progress.md](./execution-plans/note-official-applet-progress.md) | Note 官方 applet 持久进度：记录当前 workstream、已跑命令、证据文件和下一步 |
| [execution-plans/2026-06-06-complex-applet-implementation-plan.md](./execution-plans/2026-06-06-complex-applet-implementation-plan.md) | **任务级执行源**：C0/S1/G2/D3/T4/A5，写入范围、命令、pass/fail、AI prompt |
| [execution-plans/2026-06-06-applet-runtime-formalization.md](./execution-plans/2026-06-06-applet-runtime-formalization.md) | 总体 phase 计划，必须服从复杂 applet 任务级计划 |

### 6.4 参考与历史评估

| 文档 | 说明 |
|------|------|
| [wechat-miniprogram-sdk-study.md](./wechat-miniprogram-sdk-study.md) | 微信小程序 SDK / 基础库公开源码与类型定义研究，以及 Peers-Touch 借鉴方案 |
| [applet-development-pipeline-assessment.md](./applet-development-pipeline-assessment.md) | 历史评估材料；不能覆盖 complex acceptance 和 readiness gates |

---

## 7. Source Relationship

本模块是 Applet Runtime 的架构层真源。下游文档必须在本文允许的边界内展开：

- Desktop 平台落地：`docs/client/desktop/`
- Mobile 平台落地：`docs/client/mobile/`
- 编码规范：`docs/global/coding-guide/`
- Applet package producer 不定义 Peers-Touch Host 架构；Peers-Touch 只接受符合 `applet-contract` 的 package
