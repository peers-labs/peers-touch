# Agent Kernel — Provider 抽象与一致性策略

> **Status**: draft
> **Version**: 2026.06
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `apps/station/app/subserver/agent/domain/provider/`

---

## 1. 核心澄清

`Vendor API Provider` 不应该与 `Eino-native Provider` 并列。Eino-native 本身底层也会使用 OpenAI、Anthropic、Gemini、Ollama、OpenAI-compatible gateway 等厂商或模型服务。

正确分层是：

```text
AgentProvider
  ├── Kernel-native Provider     # Peers 控制 Agent loop，通常用 Eino 实现
  │     └── ModelBackend         # OpenAI / Anthropic / Gemini / Ollama / custom gateway
  └── CLI-wrapped Provider       # 外部 CLI 控制内部 Agent loop，Peers 只控制外壳
        └── CLI internal model   # 可能由 CLI 自己连接 vendor/model，Peers 不假设可控
```

因此本文使用两个概念：

| 概念 | 回答什么问题 | 例子 |
|------|--------------|------|
| `AgentProvider` | 一次 Agent Turn 由谁编排、如何执行、能观测到什么 | Kernel-native、CLI-wrapped |
| `ModelBackend` | 模型 token 从哪里来，支持哪些模型 API 能力 | OpenAI-compatible、Anthropic、Gemini、Ollama、LLM Gateway |

用户在 UI 里看到的是 Provider，但技术上必须清楚：Eino-native 的 provider 能力来自 `AgentProvider + ModelBackend` 的组合；CLI-wrapped 的 provider 能力来自 CLI 暴露的外壳能力，内部模型不作为 Peers 可控事实。

---

## 2. 设计目标

1. Eino-native 与 CLI-wrapped 在 Agent Kernel 边界上使用同一套 Turn 合同。
2. 不要求两者内部行为一致；只要求输入、输出、权限、事件、审计、错误、终态在边界上一致。
3. Eino-native 保持完全可控主线：prompt、tool loop、memory、skill、MCP、A2A、Growth 都由 Station 编排。
4. CLI-wrapped 作为选择性可控 Provider：只能声明自己真实支持的能力，不能伪装成 full-control。
5. Model vendor 差异下沉到 `ModelBackend`，不污染 AgentProvider 抽象。

---

## 3. 两层抽象

### 3.1 AgentProvider

`AgentProvider` 是 Agent Kernel 面向 TurnRunner 的执行合同。

```go
type AgentProvider interface {
    Descriptor(ctx context.Context) AgentProviderDescriptor
    Prepare(ctx context.Context, envelope AgentRunEnvelope) (*PreparedAgentRun, error)
    Execute(ctx context.Context, run *PreparedAgentRun, sink AgentProviderEventSink) (*AgentProviderResult, error)
    Stop(ctx context.Context, runID string) error
    Resume(ctx context.Context, req AgentProviderResumeRequest, sink AgentProviderEventSink) (*AgentProviderResult, error)
}
```

`AgentProviderKind`：

- `kernel_native`
- `cli_wrapped`

`AgentProviderControlLevel`：

- `full_control`：Kernel 控制 prompt、history、tool loop、tool result、retry、trace。
- `bounded_control`：Kernel 控制启动输入、workspace、bridge、停止、部分事件，但不控制内部推理 loop。
- `black_box`：Kernel 只能提交任务、观察输出、停止进程或会话。

### 3.2 ModelBackend

`ModelBackend` 是 Kernel-native Provider 内部使用的模型后端。

```go
type ModelBackend interface {
    Descriptor(ctx context.Context) ModelBackendDescriptor
    Invoke(ctx context.Context, req ModelInvokeRequest, sink ModelEventSink) (*ModelResult, error)
}
```

`ModelBackendKind`：

- `openai_compatible`
- `anthropic`
- `gemini`
- `ollama`
- `custom_gateway`

ModelBackend 只描述模型 API 能力：

- streaming
- tool calling
- structured output
- image/audio input
- reasoning output
- prompt cache
- usage reporting
- context window

它不拥有 Agent memory、skill、MCP、A2A、tool approval、Growth；这些属于 AgentProvider / TurnRunner 层。

---

## 4. 行为一致性靠什么保证

Eino-native 和 CLI-wrapped 的内部机制不可能完全一致，尤其 CLI 内部是黑盒。因此一致性不是“内部过程相同”，而是“边界合同相同 + 能力声明真实 + 不变量由 Station 强制”。

### 4.1 统一输入：AgentRunEnvelope

所有 AgentProvider 都接收同一个 `AgentRunEnvelope`：

```go
type AgentRunEnvelope struct {
    RunID              string
    AgentID            string
    ThreadID           string
    TurnID             string
    RuntimeSnapshot    RuntimeProfileSnapshot
    Identity           AgentIdentityBlock
    UserInput          UserInput
    ThreadWindow       []ConversationMessage
    MemorySnapshot     MemorySnapshotBlock
    SkillIndex         SkillIndexBlock
    WorkspaceContext   WorkspaceContextBlock
    ToolCatalog        []ToolDescriptor
    ToolPolicy         ToolPolicySnapshot
    ApprovalPolicy     ApprovalPolicySnapshot
    OutputContract     OutputContract
    Budget             RunBudget
    TraceMode          TraceMode
}
```

Eino-native 直接消费结构化字段。CLI-wrapped 不能直接理解所有字段时，由 adapter 投影成：

- system prompt / instruction bundle
- workspace 文件
- tool bridge inventory
- environment variables
- CLI args
- sidecar metadata

但源头仍是同一个 envelope。

### 4.2 统一输出：AgentProviderEvent

所有 AgentProvider 都必须输出统一事件：

| 事件 | Eino-native | CLI-wrapped |
|------|-------------|-------------|
| `run_started` | Kernel 发出 | Host wrapper 发出 |
| `assistant_delta` | Model stream | stdout/log/parser |
| `tool_call_requested` | Eino tool call | 只允许来自 Restricted Bridge |
| `tool_result_observed` | ToolRegistry result | Bridge result |
| `approval_required` | ToolPolicy 触发 | Bridge 触发 |
| `artifact_created` | Kernel 或 tool 产物 | CLI 输出文件 / patch / log |
| `usage_reported` | ModelBackend usage | CLI 支持时才有 |
| `run_completed` | Kernel 判定 | wrapper exit + result parser |
| `run_failed` | Kernel / ModelBackend 错误 | wrapper / exit / timeout |
| `raw_observation` | 可选调试事件 | CLI stdout/stderr/log 摘要 |

UI、TurnTrace、Growth 只消费统一事件，不消费 provider 私有日志作为事实源。

### 4.3 Station 强制的不变量

不变量由 Station 强制，不交给 Provider 自觉遵守：

1. **Tool 不变量**：Station tool 只能由 ToolRegistry 执行；CLI 只能通过 Restricted Bridge 请求。
2. **Approval 不变量**：高风险 tool 必须进入 Station approval，CLI 传入的 `approved=true` 不可信。
3. **Memory 不变量**：Memory 写入必须走 Station memory tool 或 Station API，CLI 本地文件不能直接变成 Memory。
4. **Skill 不变量**：Skill 创建/修改必须走 Skill service 和 guard。
5. **Trace 不变量**：TurnTrace 只能记录 Station 真实观察到的事件；CLI 内部事件只能作为 raw observation。
6. **Policy 不变量**：Provider capability 只能缩小可用能力，不能绕过 Agent policy。
7. **Final 不变量**：Turn 终态由 TurnRunner 结合 ProviderResult、exit status、required artifact、policy violation 判定。

### 4.4 能力降级规则

同一 Agent 配置在不同 Provider 下执行时，TurnRunner 按 capability 自动降级：

| 能力 | Kernel-native | CLI-wrapped |
|------|---------------|-------------|
| Tool loop | Station 完整控制 | 仅 Bridge 工具可控；CLI 内部工具不可见 |
| Memory recall | Prompt 结构化注入 | 投影为 prompt 或文件 |
| Memory write | ToolRegistry 精确记录 | 只能通过 Bridge 写入 |
| Skill use | Index + skill_view 可追踪 | 投影为文件/说明；内部阅读不可完全追踪 |
| MCP | Station tool 调用可追踪 | 只能通过 Bridge 调用 MCP tool |
| A2A | Station task 可追踪 | 只能通过 Bridge 调用 A2A tool |
| Growth | full trace | black-box trace + bridge trace |
| Retry | Kernel 可重放 tool loop | 只能重跑 CLI 或 resume |

行为一致性来自这些明确降级，而不是假装 CLI 与 Eino 等价。

---

## 5. Kernel-native Provider

Kernel-native Provider 是默认主线，使用 Eino 编排 Agent loop。

```text
TurnRunner
  -> PromptAssembly
  -> KernelNativeProvider
      -> Eino Agent / ToolCallingModel
          -> ModelBackend(OpenAI / Anthropic / Gemini / Ollama / Gateway)
      -> ToolRegistry
  -> TurnTrace / Growth
```

特性：

- Agent loop 由 Peers 控制。
- Tool calling 由 Station schema-first registry 控制。
- Memory、Skill、MCP、A2A 都是 Station 工具或服务。
- TurnTrace 能记录完整 tool/provider/memory/skill 证据。
- Growth 可做精确归因。

注意：OpenAI、Anthropic、Gemini 等 vendor 是 `ModelBackend`，不是与 Eino-native 并列的 AgentProvider。

---

## 6. CLI-wrapped Provider

CLI-wrapped Provider 是外部 CLI 包装。

```text
TurnRunner
  -> AgentRunEnvelope
  -> CLIWrappedProvider
      -> Desktop Rust launcher / Station process adapter
      -> CLI process
      -> optional Restricted Bridge -> ToolRegistry
  -> ProviderResult / RawObservation / BridgeTrace
```

CLI-wrapped Provider 可以控制：

- CLI 启动命令、工作目录、环境变量、参数。
- 初始 prompt、上下文文件、workspace 投影。
- Restricted Bridge 是否开启、暴露哪些 Station tools。
- stdout/stderr/log 的解析。
- stop / timeout / resume token。

CLI-wrapped Provider 不能假设控制：

- CLI 内部 prompt 改写。
- CLI 内部 tool loop。
- CLI 内部 memory、planning、subagent。
- CLI 内部是否访问 shell、文件、网络。
- CLI token usage、reasoning、错误分类是否完整准确。

---

## 7. Restricted Bridge

CLI-wrapped Provider 默认是 `No Bridge`。需要调用 Station tool 时必须显式开启 `Restricted Bridge`。

Bridge token 必须绑定：

- `agent_id`
- `thread_id`
- `turn_id`
- `provider_run_id`
- `allowed_tool_names`
- `expires_at`

Bridge 请求规则：

1. 请求体不能覆盖 token claims。
2. 不在 allowlist 的 tool 直接 denied。
3. approval tool 返回 `approval_required`，等待 Station UI。
4. tool result 作为 `tool_result_observed` 回到 ProviderEvent。
5. 所有 Bridge 调用进入 ToolCall 和 TurnTrace。

这样 CLI 只能通过 Station 认可的窄门访问业务能力。

---

## 8. 一致性测试

Provider 接入必须通过同一组 contract tests：

| 测试 | 要求 |
|------|------|
| Envelope acceptance | Provider 能接收标准 AgentRunEnvelope |
| Event normalization | Provider 输出标准 AgentProviderEvent |
| Tool denial | 未授权 tool 必须被拒绝 |
| Approval path | 高风险 tool 必须进入 Station approval |
| Memory write path | Memory 只能通过 Station tool 写入 |
| Stop semantics | Stop 后 Turn 进入 cancelled 或 failed，不能悬挂 |
| Final result | completed 必须有 final output 或 required artifact |
| Trace honesty | CLI-wrapped 不得声明 full trace |

这组测试比“内部行为一致”更实际，也更可验证。

---

## 9. UI 表达

Desktop UI 只展示 Provider，不展示内部执行分层：

- Provider 类型：Kernel-native / CLI-wrapped。
- Model backend：OpenAI-compatible / Anthropic / Gemini / Ollama / custom gateway，仅在 Kernel-native 下展示。
- 可控性：完全可控 / 边界可控 / 黑盒。
- 能力矩阵：Tool calling、MCP、A2A、Memory、Skill、Workspace、Resume、Usage、Trace。
- 风险提示：CLI-wrapped 的内部行为不可完全审计。
- Bridge 开关：默认关闭，按工具类别显式打开。

这样既满足“大家都是 Provider”的产品心智，又保留工程上必须区分的控制边界。
