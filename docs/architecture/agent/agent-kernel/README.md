# Agent Kernel

> **Status**: draft
> **Version**: 2026.06
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `apps/station/app/subserver/agent/` + `model/domain/agent/` + `apps/desktop/`

---

## 1. Document Scope

本文档集定义：

- Peers-Touch 下一代 Agent Kernel 的目标架构
- Agent 在 Model / Station / Desktop Rust / Desktop Web 四层的职责边界
- Logical Agent、Runtime Profile、Provider、Thread、Turn、Tool、Memory、Skill、A2A、MCP、Channel、Growth、Workspace 的领域模型
- 借鉴 gdpa-agent-box 能力后的 Peers-Touch 原生落地方案
- 面向重构的依赖顺序、执行闭环与验收标准

本文档集不定义：

- gdpa-agent-box 的 UI / UX 复制方案；Peers-Touch 继续使用自身 Desktop 架构、LobeUI 与 Runtime Projection 约束
- 存量 Agent 代码或历史数据的保守迁移方案；本设计按当前目标态直接建设，必要时可以删除旧数据和旧实现
- 具体代码实现细节、数据库初始化脚本或 API handler 函数签名
- A2A 协议完整规范；协议集成细节仍以 [../a2a/README.md](../a2a/README.md) 为准

---

## 2. 背景与问题

Peers-Touch 的 Agent 目标不是在既有聊天链路上继续补丁式扩展，而是直接建设一套新的 Agent Kernel。历史代码、历史 API、历史数据都不是约束；如果旧结构阻碍目标架构，应删除或替换。

gdpa-agent-box 是参考源，不是实现源。它的 Logical Agent / Execution Profile / Dialogue Thread / Coding Run、动态工具、MCP、A2A、技能包、工作区隔离、渠道绑定、Coding Agent 与项目执行闭环都值得拆解借鉴，但 Peers-Touch 不修改 gdpa-agent-box，也不复制它的 UI/UX 或 CLI-first provider 路线。

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
| [provider-strategy.md](./provider-strategy.md) | AgentProvider / ModelBackend 两层抽象，以及 Eino-native 与 CLI-wrapped 的行为一致性策略 |
| [integration.md](./integration.md) | 与 Peers-Touch 架构、Agent Box 借鉴点、UI/UX、建设策略的关系 |
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
| Runtime Profile | 运行配置，表达 provider、model、工具策略、能力矩阵、可控性策略 |
| Thread | 多轮上下文，统一承载 Web、Channel、A2A 子任务等会话 |
| Turn | 单轮执行闭环，记录 prompt、tool、provider、memory、skill、final output |
| Tool Bridge | Station 工具注册、策略、审批、审计与 CLI-wrapped Provider 的受控桥 |
| Workspace | 可执行上下文与资源边界，不等同于长期语义 Memory |
| Growth | 自成长度量、归因、诊断、回滚与 dogfood 验证体系 |
