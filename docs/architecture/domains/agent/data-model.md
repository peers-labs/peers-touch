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

普通 Chat 的模型选择属于 Conversation（产品名 Topic）。覆盖以完整
Provider/Model 对保存；两个空值恢复 Settings 默认继承，字段缺省保持原值。
Conversation 更新使用 `expected_version` 防止丢失并发修改。Agent 的历史
模型字段不参与普通 Chat 默认解析；Profile 文档和扩展仍归 Agent 持有。

### 删除事务

Topic 单删与批量删除共用 Station `conversation/delete-batch` 合同，输入为
会话 ID 与调用方回读的版本。Station 按 ID 排序锁定全部成员，检查 Actor、
版本和活动/排队 Turn 后提交整组 tombstone；任何前置检查失败均不删除成员。

外部运行目录由 ExternalRuntimeService 的持久化 reset fence 管理。整组
fence 在一个事务内准备，再执行目录 cleanup，最后在一个事务内提交 reset
结果与全部 Topic 删除。目录清理不可逆；部分 cleanup 失败时全部 Topic
保留并受 recoverable fence 保护，不能把已清理目录恢复为可运行 binding。
删除重试沿用原 reset fence 和版本；通用启动 reset 恢复器跳过删除 fence，
避免单独提交一个成员而释放整批保护。进程中断后成员继续被 fence 阻止运行，
由原批量删除请求重试提交；当前不承诺后台自动完成整批删除。

Agent 删除复用上述删除 owner，同时检查活动 Evaluation，清理 Agent 的
Topic、capability/knowledge/skill 绑定及 workspace/file 元数据，再删除
Profile 记录。共享 OSS blob 保留在 OSS owner 下，不按 Agent 删除共享内容。其他 Actor
仍持有该 Agent 的 Topic 时拒绝删除。会话创建与新 Turn admission 锁定
Agent，以防与 Agent 删除并发产生孤儿会话。历史 Turn、Message、执行
receipt 和事件保留为审计数据，不作为活动 Topic 展示。共享 Skill、知识
资源和 MCP Server 不随 Agent 删除。

Desktop 仅在 Station 成功后清理对应 Topic、草稿、消息缓存和运行投影。
批量命令失败不做乐观删除，也不回滚整个 store 覆盖无关并发更新。

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

澄清问题复用 ToolCall 的 bounded arguments，答案保存于
`clarification_answer`。现有 `SubmitToolApprovalDecisionRequest.answer` 仅允许
用于 `ask_user`；同一决策的 payload hash 包含答案。空答案、超限答案、
非澄清工具携带答案，以及相同幂等键下的不同答案必须拒绝。
成功执行后答案通过既有 ToolResult/Message 投影进入时间线；重启回读恢复同一
问题、答案及 ToolBatch，不生成替代 Turn。人工等待仍受执行期限和原运行预算约束。

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
