# Phase 2 — Runtime, Tool, Memory, Skill

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `apps/station/app/subserver/agent/`

---

## 1. 目标

把 Agent Kernel 从“能记录 Turn”推进到“能真实执行 Turn”：实现 builtin provider runtime、schema-first tool calling、Memory snapshot、Skill index 和 Growth trace 输入。

---

## 2. 交付范围

1. `RuntimeRegistry` 与 `builtin_provider_runtime`。
2. `TurnRunner` 状态机：queued、preparing、running、waiting_approval、completed、failed、cancelled。
3. Provider adapter：支持 native tool calling 的 OpenAI-compatible 协议。
4. Tool registry：descriptor、schema、policy、approval、audit。
5. Builtin tools：memory、skill、scheduler 最小集。
6. Memory：item、retrieval、snapshot、feedback、freeze/rollback 基础。
7. Skill：package、record、index、view、guard、versioning 基础。
8. Prompt assembly：identity、runtime、memory、skill、tool、thread history。
9. TurnTrace：prompt hash、tool call、provider call、memory/skill hit。

---

## 3. 不做什么

- 不做 MCP 动态工具。
- 不做 A2A 远程调用。
- 不做 Coding Agent。
- 不做复杂 workspace isolation。

---

## 4. 验收标准

1. 一个真实 provider Turn 能完成流式输出。
2. 工具调用来自 provider native tool call，不再解析 `<tool_call>` 文本。
3. 工具 allow/deny 能阻断未授权工具。
4. 需要审批的工具进入 `waiting_approval`，用户确认后继续执行。
5. TurnTrace 能定位本轮使用的 MemorySnapshot 和 Skill index。
6. Memory feedback 能更新 trust score 并写入 GrowthEvent。

---

## 5. 风险

| 风险 | 处理 |
|------|------|
| provider tool call 格式差异 | provider adapter 只输出统一 ToolCall |
| 旧文本工具调用依赖未清理 | 新 runtime 不兼容旧 tag，旧入口保留到迁移完成 |
| Memory/Skill 迁移影响旧数据 | Phase 2 只新增新表和兼容读，不原地破坏 |
