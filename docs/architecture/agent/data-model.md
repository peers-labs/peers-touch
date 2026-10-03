# Agent 数据模型

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-10-02 | **Updated**: 2026-10-03
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
| MCP Server | Station Agent subserver | actor + `server_id` + revision |
| MCP Tool Manifest | Station Agent subserver | Server revision + tool schema digest |
| MCP Runtime Secret | Declared execution owner | `secret_ref` |
| MCP Process | Declared execution owner | Server revision + runtime epoch |

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

Station 持有 ToolCall 状态与 lineage。`STATION` ToolCall 由 Station executor
在本地记录 effect/receipt 后继续；`CLIENT_CAPABILITY` ToolCall 仅在有效
capability session 内由 Desktop 执行，并返回包含 attempt 与执行结果的
receipt。重复 receipt 必须幂等，过期或错误 fence 必须拒绝。

## 4. MCP Server 与 Tool Manifest

`McpServer` 至少包含 `server_id`、`ptid`、名称、transport、execution owner、
脱敏 transport 配置、secret refs、enabled、revision、runtime status 与
discovered tool snapshots。`stdio`、`http`、`sse` 不隐含执行位置。

每个 discovered tool 发布独立 `CapabilityManifest`：

```text
mcp server revision + tool name + input schema
  -> immutable MCP tool manifest version
  -> AgentCapabilityBinding
  -> CapabilityReadinessSnapshot
  -> ToolCall.execution_owner
```

ToolCall admission 后不得因 Server 更新、设备上线或模型参数改变 owner。Server
更新发布新 manifest version；旧 readiness snapshot 只能完成已提交调用，不能
接收新调用。

## 5. 能力绑定

`AgentCapabilityBinding` 表达 Agent 对版本化能力的选择；
`CapabilityReadinessSnapshot` 表达当前 actor/device/runtime 是否可执行。

Turn admission 同时要求：

- binding 存在且未撤销；
- manifest identity 与版本匹配；
- `CLIENT_CAPABILITY` 需要 actor/device capability session 有效；
- `STATION` 需要 Station MCP runtime readiness 有效；
- readiness 为 ready；
- 所需 executor 与 secret reference 在声明的 owner 边界内可解析。

## 6. 持久化与恢复

Station 持久化 Agent、Conversation、Turn、Message、MCP Server、
Tool Manifest、Binding 和 ToolCall 权威记录。Desktop 可缓存投影，但重启后
必须按稳定 ID 从 Station 重建；Desktop 本地只恢复 secret refs 对应的密文和
`CLIENT_CAPABILITY` runtime state。

最小可用 Journey 的恢复判定要求：

- 同一 Agent ID；
- 同一 Conversation ID；
- 同一最终 Assistant message ID；
- 相同内容 hash；
- 同一 MCP Server/Tool binding 可按 owner 重新建立 readiness；
- Station-local MCP 不依赖 Desktop capability session。

## 7. 类型映射

| 层 | 表示 |
|---|---|
| Model | `model/domain/agent/*.proto` |
| Station | 生成类型 + Agent domain/service/persistence |
| Desktop Rust | Tauri application/gateway DTO |
| Desktop TypeScript | Agent store/runtime projection |
| Acceptance | 只读 receiver 与 Station readback evidence |

任何层都不得以私有同名结构替代共享 proto 或 Station 权威身份。
