# Peers Touch 文档入口

> `docs/` 的目标不是堆文档，而是让人能快速找到**当前有效口径**。
> 本目录采用“按职责分层、按问题导航”的组织方式。

---

## 1. 先记住这条规则

看文档前，先问自己：你现在要解决的是哪一种问题？

- **系统为什么这么设计**
  - 去看 `architecture/`
- **某个平台内部怎么落地**
  - 去看 `client/desktop/`、`client/mobile/`、`station/`
- **跨端客户端体验怎么保持一致**
  - 去看 `client/common/`、`client/chat/`
- **具体代码怎么写才合规**
  - 去看 `global/coding-guide/`
- **为什么历史上会这样演进**
  - 去看 `context/`

这不是为了分目录而分目录，而是因为不同文档回答的是不同层级的问题。

---

## 2. 为什么这样分层

### 2.1 核心逻辑

谁决定谁的**可能空间**，谁就在上游。

- 如果一份文档先定了“系统允许什么关系、什么边界、什么真源”，那后面的实现只能在它允许的范围内展开。
- 如果一份文档只是在这个边界内说明“某个平台怎么组织”，那它就是下游。
- 如果一份文档只规定“代码具体怎么写”，那它就更下游。

所以这里的上下游不是抽象程度，也不是行政级别，而是**约束方向**。

### 2.2 三层分别回答什么问题

#### 架构层真源

回答：

- 为什么这么设计
- 哪些运行单元存在
- 谁依赖谁
- 谁是 Owner
- 谁是真源
- 哪些调用关系允许，哪些禁止

特点：

- 定义系统边界和关系
- 上游约束平台实现
- 不下沉到具体编码细节

#### 平台层真源

回答：

- 在 Desktop / Mobile / Station 这个平台里，具体怎么落地
- 目录怎么组织
- 入口怎么划分
- 模块怎么拆

特点：

- 只能在架构层给定的边界内设计
- 不能反过来改写系统关系
- 面向该平台的开发者

#### 规范层真源

回答：

- 具体代码应该怎么写
- 命名、错误处理、日志、接口、模块组织怎么统一

特点：

- 约束具体编码动作
- 不能推翻平台层组织
- 不能推翻架构层边界

### 2.3 一句话判断法

- 如果你在回答“**系统允许什么关系**”，这是架构层。
- 如果你在回答“**这个平台怎么实现这些关系**”，这是平台层。
- 如果你在回答“**具体代码怎么写**”，这是规范层。

---

## 3. 文档目录职责

### `architecture/`

放**跨端、跨运行时、跨层边界**的正式架构文档。

适合放这里的问题：

- Station 和 Desktop 谁负责什么
- `desktop-web / desktop-rust / desktop-app / station` 怎么协同
- 存储、i18n、handler 等跨层统一设计

### `client/desktop/`

放 **Desktop 单端内部** 文档。

适合放这里的问题：

- Desktop 的技术栈、目录、模块组织
- Desktop 内部 Provider/Model 架构
- Desktop 平台内部的内核设计

### `client/common/`

放 **Desktop 与 Mobile 共同遵守的客户端通用契约**。

适合放这里的问题：

- 客户端 UX 问题如何从截图/案例沉淀成准则、契约、invariant
- Peers Touch 客户端 UI Identity、模块 UI ID、跨模块 patterns
- 通用表单控件、组合控件、共享交互语义
- 跨端 UI 设计方法论与 AI agent 可执行语言

### `client/chat/`

放 **Desktop 与 Mobile 共同遵守的 Chat / IM 产品体验契约**。

适合放这里的问题：

- Chat 消息结构、边界、操作、状态在双端如何保持一致
- Mobile 与 Desktop 的 IM 体验哪些必须同语义
- 消息气泡、MetaRow、ActionAnchor、Composer 的跨端关系

### `client/mobile/`

放 **Mobile 单端内部** 文档。

### `station/`

放 **Station 单端内部** 文档。

### `global/`

放 **全局原则、编码规范、统一约定**。

### `context/`

放 **历史决策、探索材料、实现报告、演进记录**。

原则：

- 可以解释为什么会变成今天这样
- 但不作为“当前正式架构真源”

### `.ide/`

放 **IDE / AI 工作材料、任务规格、辅助上下文**。

原则：

- 属于工作过程材料
- 不作为正式产品/架构真源
- `docs/ide/task/` 中的任务调查、排障记录、迁移草稿可能随实现演进而过期；引用时必须回到 `architecture/`、`client/desktop/`、`global/coding-guide/` 交叉确认

---

## 4. 当前真源规则

### 4.1 架构层真源

- 项目整体架构：`global/architecture.md`
- 状态机目录（全端 FSM 汇总索引）：`architecture/state-machines/README.md`
- Station 与 Desktop 边界：`architecture/boundaries/station-desktop-scope-boundary.md`
- Desktop 运行时关系：`architecture/runtime/desktop-runtime-architecture.md`
- 统一 Handler 架构：`architecture/runtime/unified-handler-architecture.md`
- 统一存储架构：`architecture/storage/unified-runtime-storage-architecture.md`
- i18n 架构：`architecture/i18n/i18n-architecture.md`
- 通知系统架构：`architecture/notification/notification-architecture.md`
- 实时平面：`architecture/realtime/event-stream.md`
- 语音 / 视频通话架构：`architecture/realtime/voice-video-calls.md`
- 双端社交 Runtime 架构：`architecture/social-runtime/README.md`
- 双端社交/聊天产品闭环执行计划：`architecture/social-runtime/execution-plans/20260604-social-chat-product-closure.md`
- Applet / 小程序运行时架构：`architecture/applet-runtime/README.md`
- A2A 协议集成：`architecture/agent/a2a/`（文档集，入口 `README.md`）
- Agent Canvas 编排架构：`architecture/agent/agent-canvas-orchestration.md`
- Federation 虚拟网络与治理账本：`architecture/federation/README.md`
- 质量保证闭环：`architecture/quality-framework/README.md`
- 产品验收框架：`architecture/acceptance-framework/README.md`
- Human 联邦社交活动层：`architecture/federated-social-activity/README.md`
- Agent LobeHub 蓝本重构：`architecture/agent/agent-lobehub-blueprint.md`
- Atelier 个人 Agent 工作台 × Peers Agent Collaboration：`architecture/atelier/README.md`（文档集，入口 `README.md`；Station projection endpoints 已登记为 `/sub-agent/agent/atelier/workspace/load`、`/sub-agent/agent/atelier/project/create-from-goal`、`/sub-agent/agent/atelier/message/send`、`/sub-agent/agent/atelier/escalation/resolve`、`/sub-agent/agent/atelier/task/set-status`、`/sub-agent/agent/atelier/task/purge`，Desktop applet capabilities / contract permissions 已登记为 `atelier.workspace.load`、`atelier.project.createFromGoal`、`atelier.message.send`、`atelier.escalation.resolve`、`atelier.task.setStatus`、`atelier.task.purge`、`atelier.events.subscribe`，projection event topic 为 `atelier.projection.event`；Artifact/Gate projection mapper 已支持 `artifact.upsert` / `gate.upsert`，真实生产与端到端验证后置；prototype 入口已通过 `runtimeBootstrap` 在 Lynx / Web Host 中走 applet-sdk bridge，在 standalone / unavailable 中回退 mock；runtime manifest 草案位于 `apps/applets/atelier/applet.manifest.json`，真实 bundle integrity 待正式 applet 化补齐）
- 原型统一入口（Prototype Portal + 统一登记 + 确认门）：`architecture/prototypes/README.md`

### 4.2 平台层真源

- 客户端 UX 方法论：`client/common/ux-design-methodology.md`
- 客户端 UI Identity：`client/common/ui-identity/README.md`
- 表单控件 UX 契约：`client/common/form-control-ux-contract.md`
- Desktop 平台总纲：`client/desktop/base.md`
- Desktop 登录态状态机：`client/desktop/identity-lifecycle.md`
- Desktop 页面 / 运行时 / 启动契约：`client/desktop/runtime-projections.md`
- Desktop GlobalContext 内核：`client/desktop/global-context-kernel.md`
- 跨端 Chat UX 契约：`client/chat/chat-ux-contract.md`
- Desktop Chat 布局契约：`client/desktop/chat-layout-contract.md`
- Mobile 平台总纲：`client/mobile/base.md`
- Mobile Chat 布局契约：`client/mobile/chat-layout-contract.md`
- Mobile 表单控件布局契约：`client/mobile/form-control-layout-contract.md`
- Station 平台总纲：`station/base.md`

### 4.3 规范层真源

- 通用规范：`global/coding-guide/common/`
- Desktop 规范：`global/coding-guide/desktop/`
- Mobile 规范：`global/coding-guide/mobile/`
- Station 规范：`global/coding-guide/station/`
- **架构文档标准**：`global/architecture-document-standard.md`
- **Code Review 框架**：`global/code-review-framework.md`

### 4.4 同主题多文档时怎么判断

如果同一个主题出现多份文档，按下面顺序判断：

1. 先看这份文档在回答哪个层级的问题
2. 再看它是不是该层级的正式真源
3. 非真源文档只能：
   - 引用真源
   - 补充实现细节
   - 记录历史演进
4. 非真源文档不能平行定义一套新边界

---

## 5. 按问题找文档

### 我想看项目整体

- `global/project-identity.md`
- `global/architecture.md`
- `global/domain-model.md`

### 我想看 Desktop

- 先看 `client/desktop/base.md`
- 再看 `architecture/runtime/desktop-runtime-architecture.md`（跨进程边界）
- 再看 `client/desktop/runtime-projections.md`（desktop-web 内部 Page / Runtime / Boot 契约）
- 再按主题看：
  - `client/desktop/global-context-kernel.md`
  - `client/desktop/provider-model-target-architecture.md`
- Agent / Tool / MCP / Skill 重构：
  - `architecture/agent/agent-lobehub-blueprint.md`
  - `architecture/agent/execution-plans/20260616-agent-lobehub-rebuild.md`
- 写代码前的规范层：
  - `global/coding-guide/desktop/page-component.md`
  - `global/coding-guide/desktop/store.md`
  - `global/coding-guide/desktop/kernel-events.md`

### 我想看 Station 与 Desktop 谁负责什么

- `architecture/boundaries/station-desktop-scope-boundary.md`

### 我想看 Mobile

- 先看当前平台真源：`client/mobile/base.md`
- 再按主题看：`client/mobile/sync-protocol.md`、`client/mobile/native-dual-platform.md` 等
- 如果要看 Tauri Mobile 方案形成过程，阅读：`context/mobile/tauri-mobile-capability-topology-proposal.md`（过程记录，不是当前真源）
- 如果要看 Tauri Mobile 落地路径，阅读：`client/mobile/execution-plans/20260531-tauri-mobile-mainline-migration.md`

### 我想看 Station

- `station/base.md`
- `station/app-layer.md`
- `station/frame-layer.md`

### 我想看怎么写代码

- `global/coding-guide/common/`
- `global/coding-guide/desktop/`
- `global/coding-guide/mobile/`
- `global/coding-guide/station/`

### 我想看历史决策或研究过程

- `context/`
- `meta/INDEX.md`

### 我想看系统里有哪些状态机

- `architecture/state-machines/README.md`（前后端全端 FSM 汇总，含状态/触发/Owner/设计索引）

### 我想看通知系统

- 先看 `architecture/notification/notification-architecture.md`
- 再看执行计划 `architecture/notification/execution-plans/`

### 我想看联邦 / Federation

- 先看 `architecture/federation/README.md`
- 再看跨站用户目录 `architecture/identity/federation-catalog.md`
- 再看 Actor 身份模型 `architecture/identity/unified-actor-system.md`

---

## 6. 阅读顺序建议

### 新成员

1. `global/project-identity.md`
2. `global/architecture.md`
3. 对应平台 `base.md`
4. 对应平台相关架构文档

### 做架构或迁移

1. `global/architecture.md`
2. `architecture/`
3. 对应平台 `base.md`
4. `context/decisions/` 和相关历史材料

### 做具体编码

1. 对应平台 `base.md`
2. 相关架构真源
3. 对应 `global/coding-guide/`

---

## 7. 目录入口

- 扩展索引：`meta/INDEX.md`
- 术语表：`meta/GLOSSARY.md`
- 文档变更记录：`meta/CHANGELOG.md`
