# Agent Kernel — 设计决策

> **Status**: draft
> **Version**: 2026.06
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `apps/station/app/subserver/agent/`

---

## 决策索引

| ID | 决策 | 状态 |
|----|------|------|
| D-01 | Agent Kernel 真源放在 Station | accepted |
| D-02 | Proto-first 定义 Agent 合同 | accepted |
| D-03 | 采用 Agent / RuntimeProfile / Thread / Turn 拆分 | accepted |
| D-04 | 用 schema-first tool calling 替代文本标签解析 | accepted |
| D-05 | Desktop 使用 Peers-Touch Runtime Projection，不复制 thirdparty UI | accepted |
| D-06 | Memory、Skill、Workspace、Thread/Turn 分离建模 | accepted |
| D-07 | A2A 与 MCP 都进入 Station，但职责分离 | accepted |
| D-08 | Growth 是执行闭环的一部分 | accepted |
| D-09 | AgentProvider 与 ModelBackend 分层，CLI-wrapped 只做边界一致 | accepted |

---

## D-01: Agent Kernel 真源放在 Station

**Status**: accepted
**Date**: 2026-06-06

### Context

Agent 能力涉及跨端状态、工具权限、Memory/Skill、Channel 绑定、A2A/MCP、审计与长期成长。如果真源放在 Desktop，会导致 Mobile、Station 自动任务、Channel 入站消息无法共享同一状态。

### Decision

Agent Kernel 的业务真源全部放在 Station。Desktop Rust 只承担设备桥和本地 CLI Provider launcher，Desktop Web 只承担 projection 与体验。

### Rationale

这符合 Peers-Touch “Station 负责共享业务能力与系统事实，Desktop 负责设备交互体验与本地执行编排”的架构边界。

### Alternatives Considered

- **参考系统式本地全栈管理台**：能力完整但违背 Peers-Touch 三层架构。
- **Desktop-only Agent**：实现快，但跨端、Channel、Scheduler 和 Growth 都会产生第二套真源。

---

## D-02: Proto-first 定义 Agent 合同

**Status**: accepted
**Date**: 2026-06-06

### Context

Agent 需要跨 Go、Rust、TypeScript、未来 Mobile 多端传输。手写模型会快速产生字段漂移和兼容问题。

### Decision

新增 `model/domain/agent/*.proto`，所有 Agent 跨层对象、状态枚举、请求响应与事件结构从 proto 开始。

### Rationale

Proto-first 是 Peers-Touch 铁律，能保证 Station、Desktop Rust、Desktop Web 和 Mobile 后续接入共享同一合同。

### Alternatives Considered

- **Go struct + TS type 手写同步**：开发初期省事，但长期不可维护。
- **HTTP JSON schema 单独维护**：仍然形成第二套合同。

---

## D-03: 采用 Agent / RuntimeProfile / Thread / Turn 拆分

**Status**: accepted
**Date**: 2026-06-06

### Context

当前 Agent 容易把身份、模型、工具、会话、运行记录混在一起，导致切模型、复用上下文、Channel 接入、Coding 扩展都变复杂。

### Decision

使用四层资源模型：

- `Agent`：谁在执行。
- `RuntimeProfile`：怎么执行。
- `AgentThread`：这次交互属于哪个上下文。
- `AgentTurn`：本轮执行如何闭环。

### Rationale

这借鉴参考系统的资源分离，但按 Peers-Touch proto 和 Station DDD 重新建模。它能支持多个 runtime profile、不同 surface 的 Thread、可追溯 TurnTrace。

### Alternatives Considered

- **继续扩展 Conversation/Turn**：短期改动少，但无法容纳 MCP/A2A/Channel/Growth 等能力。
- **一个 Agent 一个固定 runtime**：简单，但无法支持不同模型、不同工具策略和不同 Provider 可控性。

---

## D-04: 用 schema-first tool calling 替代文本标签解析

**Status**: accepted
**Date**: 2026-06-06

### Context

文本标签工具调用不可验证、难审批、难审计，也无法稳定适配 MCP 和 provider native tool calling。

### Decision

Agent Kernel 的工具层统一使用 `ToolDescriptor + JSON schema + ToolCall state`。Provider adapter 负责把 descriptor 转成对应 Provider 可接受的 tool calling 或 bridge 格式。

### Rationale

schema-first 是安全、审计、MCP、A2A、Desktop approval 的基础。

### Alternatives Considered

- **保留 `<tool_call>` 解析**：实现简单，但会阻碍 MCP 和审批体系。
- **每种工具自己定义自由文本协议**：不可治理，不可测试。

---

## D-05: Desktop 使用 Peers-Touch Runtime Projection，不复制 thirdparty UI

**Status**: accepted
**Date**: 2026-06-06

### Context

用户明确要求 UI、UX 框架使用 Peers-Touch，不用 thirdparty。Peers-Touch Desktop 也已有 PageDescriptor / RuntimeDescriptor 约束。

### Decision

Agent Desktop 页面必须通过 `agentRuntime` 投影消费数据。页面是纯渲染器，使用 LobeUI first、antd fallback，不复制 thirdparty 的管理台页面结构。

### Rationale

这能保持 Peers-Touch 体验一致，也能避免 Desktop 页面直接维护业务状态。

### Alternatives Considered

- **嵌入 thirdparty Web 管理台**：最快看到能力，但架构和体验都不一致。
- **每个页面 mount-time fetch**：短期容易写，长期状态新鲜度不可控。

---

## D-06: Memory、Skill、Workspace、Thread/Turn 分离建模

**Status**: accepted
**Date**: 2026-06-06

### Context

Agent 能力容易把“记住了什么、在哪儿工作、当前跑到哪一步、学会了什么操作”混为一谈。

### Decision

- Memory 负责长期语义知识。
- Skill 负责可复用操作知识。
- Workspace 负责可执行资源边界。
- Thread/Turn 负责过程状态。

### Rationale

边界清晰后，Growth 才能准确归因，Desktop 才能正确展示，未来 Coding / Channel 才不会互相污染。

### Alternatives Considered

- **全部放进 Memory**：恢复简单但会污染长期知识。
- **全部放进 Workspace 文件**：利于本地 CLI 工程能力，但不利于跨端和审计。

---

## D-07: A2A 与 MCP 都进入 Station，但职责分离

**Status**: accepted
**Date**: 2026-06-06

### Context

A2A 和 MCP 都是 Agent 扩展能力，但角色不同：A2A 是 Agent-to-Agent，MCP 是 Agent-to-Tool/Resource。

### Decision

Station 同时拥有 A2A 与 MCP：

- A2A 管 Agent Card、resolver、Task 状态、调用策略。
- MCP 管 server 连接、capability refresh、tool projection。

### Rationale

Station 是跨端真源；A2A/MCP 的权限、审计、状态都必须跨端一致。

### Alternatives Considered

- **Desktop 直接连接 MCP/A2A**：设备态方便，但权限和审计分裂。
- **只支持 MCP，不做 A2A**：能扩工具，但不能做 Agent 协作。

---

## D-08: Growth 是执行闭环的一部分

**Status**: accepted
**Date**: 2026-06-06

### Context

Peers-Touch 当前最有价值的差异化是自成长。如果 Growth 只是后台统计，无法驱动 Memory/Skill 修正。

### Decision

每个 Turn 生成 TurnTrace 和 GrowthEvent。GrowthReport 从真实 trace 汇总，并输出可执行 CorrectionProposal。

### Rationale

这样自成长能形成“观察、积累、应用、评估、修正”的闭环，而不是 UI 报表。

### Alternatives Considered

- **只统计成功率和反馈率**：信息不足，无法精准回滚。
- **只靠用户手工管理 Memory/Skill**：可控但不具备自成长能力。

---

## D-09: AgentProvider 与 ModelBackend 分层，CLI-wrapped 只做边界一致

**Status**: accepted
**Date**: 2026-06-06

### Context

参考系统把 Trae CLI、Cursor CLI、Claude CLI、Codex CLI 等包装成可运行能力。Peers-Touch 不采用 CLI-first 路线，但这些 CLI 的工程能力仍有价值。问题是 CLI 内部行为是黑盒，不能像 Kernel-native/Eino 编排一样控制 prompt、tool loop、planning、memory 和 trace。同时，OpenAI、Anthropic、Gemini、Ollama 等厂商 API 并不是与 Eino 并列的 Provider；Eino 底层本来就会使用这些模型后端。

### Decision

Agent Kernel 使用两层抽象：

- `AgentProvider`：一次 Agent Turn 的编排后端，分为 `kernel_native` 和 `cli_wrapped`。
- `ModelBackend`：Kernel-native 内部使用的模型后端，例如 OpenAI-compatible、Anthropic、Gemini、Ollama、自定义网关。

所有 AgentProvider 都通过 descriptor 暴露 capability 和 control policy。TurnRunner 只能按 capability/control policy 分支，不能按 CLI 名称写业务逻辑。ModelBackend 只表达模型 API 能力，不拥有 Agent tool、memory、skill、MCP、A2A 和 Growth。

### Rationale

这样产品心智上“大家都是 Provider”，但工程上不会把 vendor API 和 Agent 编排混为一层。Kernel-native/Eino 仍是默认主线，CLI-wrapped 只在适合场景作为可选 AgentProvider，并通过 Restricted Bridge 受控访问 Station tool。两者的一致性来自统一 `AgentRunEnvelope`、统一 `AgentProviderEvent`、Station 强制不变量和 contract tests，而不是内部行为完全一致。

### Alternatives Considered

- **把 CLI 独立建成执行体系**：容易复制参考系统路线，导致 Provider 和 CLI 运行两套概念。
- **完全不接 CLI**：控制性最高，但放弃 Trae/Cursor/Claude/Codex CLI 已有工程能力。
- **把 CLI 当完全可信 Provider**：实现便利，但审计、权限和 Growth 归因都会失真。
- **把 Vendor API 与 Eino-native 并列**：概念不准确，因为 Eino-native 底层本来就使用 vendor/model backend。
