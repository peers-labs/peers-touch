# Agent 数据模型

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-02 | **Updated**: 2026-10-02
> **Owner**: Peers-Touch Agent Team

---

## 1. 权威实体

| 实体 | 权威 owner | 稳定身份 |
|---|---|---|
| Agent | Station Agent subserver | `agent_id` |
| Conversation | Station Agent subserver | `conversation_id` |
| Turn | Station Agent subserver | `turn_id` |
| Message | Station Agent subserver | `message_id` |
| Capability Binding | Station Agent subserver | Agent + capability identity |
| ToolCall | Station Agent subserver | `tool_call_id` + attempt |
| MCP Process | Desktop Tauri | capability session + process identity |

完整字段与 proto 定义以 `model/domain/agent/` 为唯一跨层合同真源；本文不复制
字段级 schema。

## 2. Turn 状态

```text
admitted
  -> running
  -> waiting_for_tool
  -> continuing
  -> completed

admitted|running|waiting_for_tool|continuing
  -> cancelled|failed
```

终态不可回退。重试创建受 fencing 约束的新 attempt，但不允许重复提交已认可的
side effect。

## 3. ToolCall 状态

```text
prepared -> dispatched -> succeeded
                     \-> failed
                     \-> cancelled
```

Station 持有 ToolCall 状态与 lineage。Desktop 只在有效 capability session
内执行本机 MCP，并返回包含 attempt 与执行结果的 receipt。重复 receipt 必须
幂等，过期或错误 fence 必须拒绝。

## 4. 能力绑定

`AgentCapabilityBinding` 表达 Agent 对版本化能力的选择；
`CapabilityReadinessSnapshot` 表达当前 actor/device/runtime 是否可执行。

Turn admission 同时要求：

- binding 存在且未撤销；
- manifest identity 与版本匹配；
- actor/device capability session 有效；
- readiness 为 ready；
- 所需本机 executor 与 secret 仍在其 owner 边界内。

## 5. 持久化与恢复

Station 持久化 Agent、Conversation、Turn、Message、Binding 和 ToolCall
权威记录。Desktop 可缓存投影，但重启后必须按稳定 ID 从 Station 重建。

最小可用 Journey 的恢复判定要求：

- 同一 Agent ID；
- 同一 Conversation ID；
- 同一最终 Assistant message ID；
- 相同内容 hash；
- 同一 MCP binding 可重新建立 readiness。

## 6. 类型映射

| 层 | 表示 |
|---|---|
| Model | `model/domain/agent/*.proto` |
| Station | 生成类型 + Agent domain/service/persistence |
| Desktop Rust | Tauri application/gateway DTO |
| Desktop TypeScript | Agent store/runtime projection |
| Acceptance | 只读 receiver 与 Station readback evidence |

任何层都不得以私有同名结构替代共享 proto 或 Station 权威身份。
