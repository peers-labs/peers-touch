# Phase 4 — A2A, MCP, Channel, Growth Completion

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `apps/station/app/subserver/agent/`

---

## 1. 目标

把 Agent Kernel 从单 Agent 对话扩展到生态能力：MCP 动态工具、A2A 协作、Friend/Group/Channel 绑定、Growth report 与 correction proposal。

---

## 2. 交付范围

1. MCP server CRUD、连接管理、capability refresh、tool projection。
2. MCP 工具进入 ToolRegistry、ToolPolicy、TurnTrace。
3. A2A Agent Card、Task 状态机、本地 resolver、HTTP transport。
4. `a2a_list_agents`、`a2a_call_agent` 工具。
5. Channel binding：friend、group、external social channel 映射到 AgentThread。
6. Response mode：mention-only、always、ai-decide。
7. Growth metrics、diagnostic、correction proposal。
8. Scheduler jobs：background review、dogfood、knowledge salvage。

---

## 3. 不做什么

- 不实现完整 Coding Agent。
- 不引入 Agent Box remote sharing UI。
- 不做复杂 workspace rootfs/proot 隔离。
- 不把 MCP 工具默认开放给所有 Agent。

---

## 4. 验收标准

1. Agent profile 可选择 MCP server，未选择时工具不可见。
2. MCP tool call 在 TurnTrace 中有完整审计。
3. 本地 A2A 调用能创建 A2ATask 并回填父 Turn。
4. Channel 入站消息能创建或复用 AgentThread。
5. GrowthReport 能基于真实 TurnTrace 输出至少三类指标。
6. CorrectionProposal 能触发 freeze memory、disable skill 或 tighten tool policy。
7. Station `go test ./...` 至少覆盖新增 domain/service 关键路径。

---

## 5. 风险

| 风险 | 处理 |
|------|------|
| MCP server 不稳定拖垮 Turn | 单工具超时、健康状态、profile 显式启用 |
| A2A 递归调用失控 | depth limit、per-agent policy、budget |
| Channel 消息污染普通 Thread | surface + channel target 结构化记录 |
| Growth 建议不可执行 | proposal 必须绑定具体 Memory/Skill/Policy 操作 |
