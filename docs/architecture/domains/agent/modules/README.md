# Agent 子模块设计索引

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-05 | **Updated**: 2026-10-05
> **Owner**: Peers-Touch Agent Team

---

## 1. Document Scope

本目录保存 Agent 产品/架构拆分期间形成的子模块参考分析、Peers 目标设计与
Acceptance 边界。它们是
[`Agent`](../README.md) 与
[`Modern Chat Agent`](../modern-chat-agent/README.md) 的下游专题，不独立拥有
Station、Desktop 或 Model 的跨模块真源。

缺少 `peers-design.md` 的目录只保留 Acceptance 或专项设计输入，不表示该能力
已经落地。

## 2. 子模块目录

| 子模块 | 参考分析 | Peers 设计 | Acceptance / 专项 |
|---|---|---|---|
| Agent Config | [reference](./agent-config/reference-analysis.md) | [design](./agent-config/peers-design.md) | [acceptance](./agent-config/acceptance.md) |
| Agent Groups | — | — | [acceptance](./agent-groups/acceptance.md) |
| Chat Input | [reference](./chat-input/reference-analysis.md) | [design](./chat-input/peers-design.md) | [acceptance](./chat-input/acceptance.md) |
| Custom Plugins | — | — | [acceptance](./custom-plugins/acceptance.md) |
| Evaluation | — | — | [acceptance](./evaluation/acceptance.md) |
| Follow-up Suggestions | — | [design](./follow-up-suggestions/peers-design.md) | [acceptance](./follow-up-suggestions/acceptance.md) |
| Home Page | — | — | [acceptance](./home-page/acceptance.md) |
| Knowledge / RAG | [reference](./knowledge-rag/reference-analysis.md) | [design](./knowledge-rag/peers-design.md) | [acceptance](./knowledge-rag/acceptance.md) |
| LocalStorage Migration | — | — | [interface](./localstorage-migration/interface-design.md) |
| Markdown Rendering | — | [design](./markdown-rendering/peers-design.md) | [acceptance](./markdown-rendering/acceptance.md) |
| Marketplace | — | — | [acceptance](./marketplace/acceptance.md) |
| MCP Plugin | [reference](./mcp-plugin/reference-analysis.md) | [design](./mcp-plugin/peers-design.md) | [acceptance](./mcp-plugin/acceptance.md) |
| Mentions | — | — | [acceptance](./mentions/acceptance.md) |
| Message Actions | [reference](./message-actions/reference-analysis.md) | [design](./message-actions/peers-design.md) | [acceptance](./message-actions/acceptance.md) |
| Multi Transport | — | — | [design](./multi-transport/design.md) |
| Notebook | — | — | [acceptance](./notebook/acceptance.md) |
| P2 Remaining Batch | — | — | [batch design](./p2-remaining-batch-design.md) |
| Portal Side Panel | [reference](./portal-side-panel/reference-analysis.md) | [design](./portal-side-panel/peers-design.md) | [acceptance](./portal-side-panel/acceptance.md) |
| Provider / Model | [reference](./provider-model/reference-analysis.md) | [design](./provider-model/peers-design.md) | [acceptance](./provider-model/acceptance.md) |
| Session / Topic | [reference](./session-topic/reference-analysis.md) | [design](./session-topic/peers-design.md) | [acceptance](./session-topic/acceptance.md) |
| Streaming Runtime | [reference](./streaming-runtime/reference-analysis.md) | [design](./streaming-runtime/peers-design.md) | [acceptance](./streaming-runtime/acceptance.md) |
| Thread | — | [design](./thread/peers-design.md) | [acceptance](./thread/acceptance.md) |
| Tool Execution | [reference](./tool-execution/reference-analysis.md) | [design](./tool-execution/peers-design.md) | [acceptance](./tool-execution/acceptance.md) |
| Topic Comments | — | — | [acceptance](./topic-comments/acceptance.md) |
| Translation | — | [design](./translation/peers-design.md) | [acceptance](./translation/acceptance.md) |
| User Memory | [reference](./user-memory/reference-analysis.md) | [design](./user-memory/peers-design.md) | [acceptance](./user-memory/acceptance.md) |
| Virtualized Chat List | — | [design](./virtualized-chat-list/peers-design.md) | [acceptance](./virtualized-chat-list/acceptance.md) |

## 3. Source Hierarchy

1. `../README.md`、`../design.md`、`../data-model.md` 与
   `../modern-chat-agent/` 定义当前 Agent owner 和跨运行时边界。
2. 本目录的 `peers-design.md` 只能细化所属子模块，不能重定义上游 owner。
3. `reference-analysis.md` 是外部实现证据，不是 Peers 架构真源。
4. `acceptance.md` 定义期望证明范围；没有当前 Gate evidence 时保持
   `UNPROVEN`。
