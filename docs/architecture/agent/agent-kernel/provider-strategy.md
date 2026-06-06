# Agent Kernel — Provider 策略

> **Status**: draft
> **Version**: 2026.06
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `apps/station/app/subserver/agent/domain/provider/`

---

## 1. 设计立场

Peers-Touch 的 Agent 不走 Agent Box 的 CLI-first 路线。Trae CLI、Cursor CLI、Claude CLI、Codex CLI 这类能力可以作为参考和可选 Provider 形态接入，但它们不是 Agent Kernel 的中心。

目标抽象是：

> 对 Agent Kernel 来说，Eino-native、厂商 API、CLI-wrapped 都是 Provider；区别只在能力矩阵、可控程度、观测粒度和降级策略。

因此不把 CLI 单独建成“特殊 Agent 运行体系”，也不让 UI 或业务逻辑按 CLI 名称分支。所有差异必须收敛到 `ProviderDescriptor`、`ProviderCapabilitySet`、`ProviderControlPolicy` 和 `ProviderAdapter`。

---

## 2. Provider 分类

| 类型 | 例子 | 可控性 | 适合场景 |
|------|------|--------|----------|
| Eino-native Provider | Peers 自建 Eino ReAct / ToolCallingModel runtime | 高可控 | 默认主线、需要精确工具/记忆/技能/审计/Growth 的任务 |
| Vendor API Provider | OpenAI-compatible、Anthropic、Gemini、Ollama 等 API | 中高可控 | 标准聊天、原生 tool calling、多模态、低本地依赖 |
| CLI-wrapped Provider | Trae CLI、Cursor CLI、Claude CLI、Codex CLI | 选择性可控 | 代码、本地工程、厂商 CLI 已经封装好复杂能力的场景 |

关键原则：

1. Eino-native 是 Peers-Touch Agent 的默认可控主线。
2. Vendor API 是标准模型能力接入层。
3. CLI-wrapped 是黑盒能力包装，不假装拥有内部控制权。
4. 三者在 Agent Profile、Thread、Turn、UI 上都是 Provider，只通过 capability 展示差异。

---

## 3. 统一 Provider 合同

```go
type Provider interface {
    Descriptor(ctx context.Context) ProviderDescriptor
    Prepare(ctx context.Context, req ProviderPrepareRequest) (*ProviderPreparedRun, error)
    Execute(ctx context.Context, run *ProviderPreparedRun, sink ProviderEventSink) (*ProviderResult, error)
    Stop(ctx context.Context, runID string) error
    Resume(ctx context.Context, req ProviderResumeRequest, sink ProviderEventSink) (*ProviderResult, error)
}

type ProviderDescriptor struct {
    ID           string
    Kind         ProviderKind
    DisplayName  string
    Capabilities ProviderCapabilitySet
    Control      ProviderControlPolicy
}
```

`ProviderKind`：

- `eino_native`
- `vendor_api`
- `cli_wrapped`

`ProviderCapabilitySet`：

- `streaming`
- `native_tool_calling`
- `structured_output`
- `tool_result_injection`
- `system_prompt_control`
- `message_history_control`
- `context_window_control`
- `attachment_control`
- `stop`
- `resume`
- `usage_reporting`
- `event_trace`
- `workspace_access`
- `model_switch`

`ProviderControlPolicy`：

- `full_control`：Agent Kernel 能控制 prompt、history、tool loop、tool result、retry、trace。
- `partial_control`：Agent Kernel 能控制启动输入和部分环境，但内部 tool loop / planning / memory 行为不可完全干预。
- `black_box_control`：Agent Kernel 只能提供任务输入、读取输出、停止进程或会话，内部行为不做假设。

---

## 4. Eino-native Provider

Eino-native 是 Agent Kernel 的核心路线。

可控能力：

- Prompt assembly 完全由 Peers 控制。
- Tool calling 使用 Station `ToolDescriptor` 和 JSON schema。
- Tool policy、approval、MCP、A2A、Memory、Skill 都在 Station 统一闭环。
- Provider call、tool call、memory hit、skill hit 可完整进入 TurnTrace。
- Growth 可以做精确归因。

执行策略：

1. TurnRunner 组装 prompt。
2. ProviderAdapter 将 ToolDescriptor 转为 Eino tool。
3. Eino ReAct / ToolCallingModel 执行推理。
4. 工具调用回到 Station ToolRegistry。
5. TurnRunner 持久化每个事件。

默认要求：

- 新的通用 Agent 能力优先落在 Eino-native。
- 需要可解释、可审计、可成长的任务默认使用 Eino-native。
- CLI provider 缺少的控制能力，不应反向降低 Eino-native 的设计标准。

---

## 5. Vendor API Provider

Vendor API Provider 面向厂商模型能力。

可控能力：

- 通常可控 system prompt、message history、model params、streaming。
- 如果厂商支持 native tool calling，则可以接入 Station ToolRegistry。
- 如果厂商只支持文本生成，则只能作为 no-tool 或 limited-tool provider。
- usage、reasoning、tool event 的可见度取决于厂商 API。

策略：

- 将厂商差异封装在 `provider/vendorapi/`。
- 对 Agent Kernel 暴露统一 `ProviderEvent`。
- 不在业务代码里判断 OpenAI / Anthropic / Gemini 字符串。
- 厂商不支持的 capability 必须在 descriptor 中显式为 false。

---

## 6. CLI-wrapped Provider

CLI-wrapped Provider 是“厂商或工具已经封装好的黑盒能力”，例如 Trae CLI、Cursor CLI、Claude CLI、Codex CLI。

### 6.1 能力边界

CLI-wrapped Provider 可以控制：

- 启动命令、工作目录、环境变量、模型参数中 CLI 暴露的部分。
- 初始 prompt、附件、上下文文件或 workspace。
- stdout/stderr/event log 的解析。
- stop / kill / timeout。
- 如果 CLI 明确支持 resume，则可控制 resume token / session id。

CLI-wrapped Provider 不能假设控制：

- CLI 内部 prompt 改写。
- CLI 内部 tool loop。
- CLI 内部 memory 或 planning。
- CLI 内部对子代理、shell、文件、网络的真实调用策略。
- CLI 对输出格式、token usage、错误分类的完整透明度。

### 6.2 接入原则

1. CLI 是 Provider，不是 Agent Kernel 的执行核心。
2. CLI provider 的 descriptor 必须标记 `Control=partial_control` 或 `black_box_control`。
3. CLI provider 不允许直接获得 Station 通用 token。
4. CLI provider 若要调用 Station tool，必须走受限 Tool Bridge，且 Bridge token 绑定 agent、thread、turn、allowed tools。
5. CLI provider 的工具能力默认少给，按 Agent Profile 显式开放。
6. CLI provider 的输出事件只作为观察，不作为完整内部 trace。
7. CLI provider 的 Growth 归因粒度按“Provider run + bridge tool calls + visible artifacts”计算，不伪造内部 tool trace。

### 6.3 Tool Bridge 策略

CLI provider 有两种模式：

| 模式 | 说明 | 适用 |
|------|------|------|
| No Bridge | 只给 prompt / workspace / env，不给 Station 工具 | 黑盒代码任务、只需最终产物 |
| Restricted Bridge | 通过一次性 token 暴露允许的 Station tools | 需要 Memory、Skill、A2A、MCP、Channel 受控访问 |

Restricted Bridge 必须满足：

- token 绑定 `agent_id`、`thread_id`、`turn_id`、`provider_run_id`。
- token 带 allowlist，不能由 CLI 自己请求扩大权限。
- approval 工具仍回 Station 审批队列。
- bridge request body 不能覆盖 token claims。
- 过期、重复、越权都记录为 ToolCall failed/denied。

### 6.4 事件与观测

CLI provider 的事件分三层：

| 事件层 | 来源 | 可信度 | 用途 |
|--------|------|--------|------|
| Host events | Station / Desktop Rust 启停、超时、退出码 | 高 | Turn 状态 |
| Bridge events | CLI 通过受限 bridge 调 Station tool | 高 | ToolTrace / Growth |
| Parsed CLI events | stdout/stderr/log 解析 | 中低 | UI 展示、辅助诊断 |

Growth 不应把 Parsed CLI events 当成完整事实，只能作为辅助证据。

---

## 7. Provider 选择策略

Agent Profile 中的 Provider 选择应呈现统一体验：

| 任务类型 | 推荐 Provider |
|----------|---------------|
| 普通对话、社交协作、可审计工具调用 | Eino-native |
| 多模态、厂商模型特性、低本地依赖 | Vendor API |
| 代码修改、厂商 CLI 已有深度工程能力 | CLI-wrapped |
| 高风险工具、需要强审批和精确归因 | Eino-native |
| 需要本地 IDE/CLI 生态能力 | CLI-wrapped + Restricted Bridge |

Provider 自动选择可以做，但必须可解释：

- 为什么选择该 Provider。
- 该 Provider 不支持哪些能力。
- 本轮工具、Memory、Skill、Growth 归因会受到什么影响。

---

## 8. UI 表达

Desktop UI 不展示独立运行体系概念，只展示 Provider：

- Provider 类型：Eino-native / Vendor API / CLI-wrapped。
- 可控性标签：完全可控 / 部分可控 / 黑盒。
- 能力矩阵：Tool calling、MCP、A2A、Memory、Skill、Workspace、Resume、Usage。
- 风险提示：CLI provider 的内部行为不可完全审计。
- Bridge 开关：默认关闭，按工具类别显式打开。

这能让用户理解“都是 provider，但可信和可控程度不同”。

---

## 9. 验收标准

1. Agent Profile 中 Eino-native、Vendor API、CLI-wrapped 都通过同一个 Provider 配置模型表达。
2. TurnRunner 不按 provider 名称写业务分支，只按 capability/control policy 分支。
3. CLI provider 不获得 Station 通用 token。
4. CLI provider 无 bridge 时不能调用 Station tools。
5. CLI provider 有 bridge 时，所有 bridge calls 都写入 ToolCall 和 TurnTrace。
6. GrowthReport 明确区分 full trace 与 black-box trace。
