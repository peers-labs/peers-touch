# Agent Kernel 2.0

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `apps/station/app/subserver/agent/` + `model/domain/agent/` + `apps/desktop/`

---

## 1. Document Scope

本文档集定义：

- Peers-Touch 下一代 Agent Kernel 的目标架构
- Agent 在 Model / Station / Desktop Rust / Desktop Web 四层的职责边界
- Logical Agent、Runtime Profile、Thread、Turn、Tool、Memory、Skill、A2A、MCP、Channel、Growth、Workspace 的领域模型
- 借鉴 gdpa-agent-box 能力后的 Peers-Touch 原生落地方案
- 面向重构的依赖顺序、执行闭环与验收标准

本文档集不定义：

- gdpa-agent-box 的 UI / UX 复制方案；Peers-Touch 继续使用自身 Desktop 架构、LobeUI 与 Runtime Projection 约束
- 当前 `agent-self-growth-architecture.md` 的增量修补计划；本设计是无历史包袱的目标态
- 具体代码实现细节、数据库迁移脚本或 API handler 函数签名
- A2A 协议完整规范；协议集成细节仍以 [../a2a/README.md](../a2a/README.md) 为准

---

## 2. 背景与问题

Peers-Touch 当前 Agent 方案已经有有价值的自成长能力：Memory 冻结、Skill 回滚、Growth 归因、Dogfood、自我修正等。但当前 Agent 仍更像一个“增强聊天子服务”，缺少统一运行时资源模型、可组合工具体系、标准 Agent 协作协议、Desktop 投影闭环和可验证执行记录。

gdpa-agent-box 的能力覆盖更完整：Logical Agent / Execution Profile / Dialogue Thread / Coding Run 等资源拆分，动态工具与 MCP，A2A，本地/远程 executor，技能包，工作区隔离，渠道绑定，Coding Agent 与项目执行闭环。这些能力值得借鉴，但不能照搬，因为 Peers-Touch 的架构约束不同：

1. Peers-Touch 必须 Proto-first，跨端契约由 `model/domain/*.proto` 产生。
2. Station 是共享业务真源，Desktop 只做设备能力、本地桥接和体验编排。
3. Desktop 页面必须遵守 PageDescriptor / RuntimeDescriptor，页面是纯渲染器，状态新鲜度由 runtime 投影负责。
4. UI / UX 使用 Peers-Touch 的信息架构、LobeUI 组件和现有应用体验，不采用 Agent Box 的管理台框架。

---

## 3. 设计目标

1. 把 Agent 从“聊天增强服务”重构为 Peers-Touch 的一等业务能力。
2. 用统一资源模型表达“谁在执行、怎么执行、在哪个上下文执行、本轮执行如何闭环”。
3. 用 schema-first tool calling 替代文本标签解析，所有工具调用都有策略、审批、审计和结果事件。
4. 让 Memory、Skill、MCP、A2A、Channel、Scheduler、Growth 成为 Station 下沉的领域能力。
5. 让 Desktop Web 只消费 runtime projection，不直接维护 Agent 业务真相。
6. 保留并强化 Peers-Touch 自成长能力，作为与 Agent Box 相比的核心差异化。
7. 通过分阶段执行计划保证每一阶段都有可运行、可观测、可回滚的交付边界。

---

## 4. 文档导航

| 文档 | 说明 |
|------|------|
| [design.md](./design.md) | 目标架构、核心模块、端到端执行闭环、API 面 |
| [data-model.md](./data-model.md) | Proto-first 数据模型、状态机、持久化边界 |
| [module-layout.md](./module-layout.md) | Station / Model / Desktop Rust / Desktop Web 目录规划 |
| [integration.md](./integration.md) | 与现有 Peers-Touch 架构、Agent Box 借鉴点、UI/UX、迁移策略的关系 |
| [decisions.md](./decisions.md) | 关键设计决策与取舍 |
| [execution-plans/phase-1-contract-and-kernel.md](./execution-plans/phase-1-contract-and-kernel.md) | Phase 1：契约与 Agent Kernel 基座 |
| [execution-plans/phase-2-runtime-tool-memory-skill.md](./execution-plans/phase-2-runtime-tool-memory-skill.md) | Phase 2：运行时、工具、Memory、Skill |
| [execution-plans/phase-3-desktop-projection-ui.md](./execution-plans/phase-3-desktop-projection-ui.md) | Phase 3：Desktop 投影与 Peers-Touch UI |
| [execution-plans/phase-4-a2a-mcp-channel-growth.md](./execution-plans/phase-4-a2a-mcp-channel-growth.md) | Phase 4：A2A、MCP、Channel、Growth |

---

## 5. 术语对照

| 术语 | 含义 |
|------|------|
| Agent Kernel | Station 内的 Agent 领域内核，负责任务执行、资源编排、事件闭环 |
| Logical Agent | 逻辑 Agent 定义，表达身份、职责、策略、默认运行配置 |
| Runtime Profile | 运行配置，表达 provider、model、工具策略、能力矩阵、执行器类型 |
| Thread | 多轮上下文，统一承载 Web、Channel、A2A 子任务等会话 |
| Turn | 单轮执行闭环，记录 prompt、tool、provider、memory、skill、final output |
| Tool Bridge | Station 工具注册、策略、审批、审计与 Desktop/local executor 的受控桥 |
| Workspace | 可执行上下文与资源边界，不等同于长期语义 Memory |
| Growth | 自成长度量、归因、诊断、回滚与 dogfood 验证体系 |
