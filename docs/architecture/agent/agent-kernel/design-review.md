# Agent Kernel — 设计清单与深度评审

> **Status**: draft
> **Version**: 2026.06
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `apps/station/app/subserver/agent/` + `model/domain/agent/` + `apps/desktop/`

---

## 1. 评审结论

当前 Agent Kernel 方向是对的：Station 真源、Proto-first、Kernel-native/Eino 主线、CLI-wrapped 边界可控、Desktop Runtime Projection、schema-first tools、Memory/Skill/Growth 闭环，这些原则能支撑 Peers-Touch 自己的 Agent 架构，而不是复制参考系统。

但在进入实现前，必须补齐五类关键设计：

1. **Provider 边界合同还需要更硬**：`AgentRunEnvelope`、`AgentProviderEvent`、`ProviderResult`、artifact、错误码、幂等语义必须从说明变成 proto 合同。
2. **Capability 模型存在重复与合成风险**：`CapabilitySet`、`AgentProviderCapabilitySet`、`ModelBackendCapabilitySet` 需要明确谁是事实源、谁是派生值。
3. **CLI-wrapped 安全边界还不够完整**：Restricted Bridge 只是入口，还需要环境变量、文件系统、网络、凭证、日志脱敏和工作区授权边界。
4. **Turn 事件一致性需要事务设计**：事件顺序、断线恢复、重复提交、approval 后继续执行、stop/resume 的状态转移必须可验证。
5. **Desktop projection 合同需要落细**：页面不能直接 fetch 的原则已经明确，但 projection snapshot、增量事件、reconcile、过期处理还没有完整定义。

因此，建议在写业务代码前追加两个设计补丁：

- `provider-contract.md`：定义 AgentProvider / ModelBackend 的 proto 合同、事件、错误、capability 合成与 contract tests。
- `security-and-execution-closure.md`：定义 CLI bridge 威胁模型、Turn event 事务、approval/stop/resume 幂等、projection reconcile。

---

## 2. 整体设计清单

### 2.1 顶层架构设计

| 设计项 | 当前定义位置 | 设计内容 | 评审状态 |
|--------|--------------|----------|----------|
| 三层职责 | [design.md](./design.md) / [integration.md](./integration.md) | Model 定合同，Station 做业务真源，Desktop 做体验和设备桥 | 方向正确 |
| Agent Kernel 定位 | [README.md](./README.md) | 当前目标架构，不是旧 Agent 兼容层 | 正确 |
| 参考系统边界 | [integration.md](./integration.md) | gdpa-agent-box 只作为参考，不修改、不复制 UI/UX | 正确 |
| 无历史包袱 | [README.md](./README.md) | 旧代码、旧 API、旧数据可删除或替换 | 正确 |
| 分阶段建设 | [execution-plans/](./execution-plans/) | Contract、Runtime/Tool/Memory/Skill、Desktop、A2A/MCP/Channel/Growth | 需要拆小 Phase 4 |

### 2.2 Model / Proto 设计

| 设计项 | 当前定义位置 | 设计内容 | 评审状态 |
|--------|--------------|----------|----------|
| Proto 包规划 | [data-model.md](./data-model.md) | `model/domain/agent/*.proto` 分文件 | 正确 |
| Agent | [data-model.md](./data-model.md) | 身份、状态、owner、默认 runtime profile | 需要补权限与审计字段 |
| RuntimeProfile | [data-model.md](./data-model.md) | Provider、tool/memory/skill/workspace policy | 需要明确 snapshot 粒度 |
| AgentProviderConfig | [data-model.md](./data-model.md) | AgentProvider 类型、能力、控制策略 | 需要补 descriptor 与 registry proto |
| ModelBackendConfig | [data-model.md](./data-model.md) | 模型后端、模型 ID、模型能力 | 正确 |
| Thread / Turn | [data-model.md](./data-model.md) | 上下文与单轮执行 | 需要补 event oneof |
| TurnEvent | [data-model.md](./data-model.md) | sequence + `payload_json` | 高风险，需改 oneof |
| Tool / ToolCall | [data-model.md](./data-model.md) | schema-first tool 与调用状态 | 需要补 schema version / result artifact |
| Memory / Snapshot | [data-model.md](./data-model.md) | 长期记忆与冻结快照 | 需要补 scope 权限 |
| SkillPackage / SkillRecord | [data-model.md](./data-model.md) | 技能包和技能记录 | 需要补签名/来源信任 |
| MCP / A2A / Growth | [data-model.md](./data-model.md) | server、task、trace、report | 方向正确，细节待拆 |

### 2.3 Station 模块设计

| 模块 | 当前定义位置 | 职责 | 评审状态 |
|------|--------------|------|----------|
| `handler` | [module-layout.md](./module-layout.md) | HTTP / stream 边界 | 正确 |
| `application` | [module-layout.md](./module-layout.md) | use case、事务、跨域编排 | 正确 |
| `domain/runtime` | [module-layout.md](./module-layout.md) | RuntimeProfile、TurnRunner、运行状态 | 需要补状态机图 |
| `domain/provider` | [module-layout.md](./module-layout.md) | AgentProvider / ModelBackend / CLI bridge policy | 核心，需单独合同文档 |
| `domain/thread` | [module-layout.md](./module-layout.md) | Thread、Turn、Event、Replay | 需要补事件事务 |
| `domain/prompt` | [module-layout.md](./module-layout.md) | prompt 分层、hash、budget | 需要补 token budget 算法 |
| `domain/tool` | [module-layout.md](./module-layout.md) | registry、policy、approval、dispatch | 需要补 policy resolution |
| `domain/memory` | [module-layout.md](./module-layout.md) | retrieval、snapshot、feedback、rollback | 需要补 privacy/governance |
| `domain/skill` | [module-layout.md](./module-layout.md) | package、guard、versioning、disclosure | 需要补 source trust |
| `domain/mcp` | [module-layout.md](./module-layout.md) | MCP 连接、capability、tool projection | 正确 |
| `domain/a2a` | [module-layout.md](./module-layout.md) | Agent Card、Task、resolver、policy | 正确 |
| `domain/channel` | [module-layout.md](./module-layout.md) | friend/group/channel binding | 需要补消息去重 |
| `domain/growth` | [module-layout.md](./module-layout.md) | trace、metrics、diagnostic、dogfood | 需要补 black-box scoring |
| `domain/workspace` | [module-layout.md](./module-layout.md) | context reference、path grant、coding run | 当前偏薄 |

### 2.4 Provider 设计

| 设计项 | 当前定义位置 | 内容 | 评审状态 |
|--------|--------------|------|----------|
| 两层抽象 | [provider-strategy.md](./provider-strategy.md) | AgentProvider 负责编排，ModelBackend 负责模型来源 | 正确 |
| Kernel-native | [provider-strategy.md](./provider-strategy.md) | Peers/Eino 控制 Agent loop | 正确 |
| ModelBackend | [provider-strategy.md](./provider-strategy.md) | OpenAI/Anthropic/Gemini/Ollama/gateway | 正确 |
| CLI-wrapped | [provider-strategy.md](./provider-strategy.md) | CLI 控制内部 loop，Peers 控制外壳 | 正确 |
| 行为一致性 | [provider-strategy.md](./provider-strategy.md) | envelope、event、不变量、降级、contract tests | 方向正确，需 proto 化 |
| Restricted Bridge | [provider-strategy.md](./provider-strategy.md) | CLI 通过窄 token 调 Station tool | 需要威胁模型 |
| Trace honesty | [provider-strategy.md](./provider-strategy.md) | CLI 不得声明 full trace | 正确 |

### 2.5 Tool / MCP / A2A 设计

| 设计项 | 当前定义位置 | 内容 | 评审状态 |
|--------|--------------|------|----------|
| Schema-first Tool | [design.md](./design.md) | ToolDescriptor + JSON schema + ToolCall state | 正确 |
| Tool Policy | [design.md](./design.md) | allow/deny、risk、approval | 需要 resolution order |
| Tool Approval | [design.md](./design.md) | approval_required 和 UI 卡片 | 需要幂等与过期策略 |
| MCP Projection | [design.md](./design.md) | MCP tool 投影为 ToolDescriptor | 正确 |
| A2A Resolver | [design.md](./design.md) | Agent Card、Task、resolver、policy | 正确 |
| Bridge Tools | [provider-strategy.md](./provider-strategy.md) | CLI 受限调用 Station tool | 需要安全设计 |

### 2.6 Memory / Skill / Growth 设计

| 设计项 | 当前定义位置 | 内容 | 评审状态 |
|--------|--------------|------|----------|
| Memory scope/layer | [design.md](./design.md) | global/user/agent/thread-derived + identity/preference/experience/fact/warning | 正确 |
| Memory snapshot | [design.md](./design.md) | Turn 开始冻结 | 正确 |
| Memory rollback | [design.md](./design.md) | snapshot 或 item version 回退 | 需要权限模型 |
| SkillPackage | [design.md](./design.md) | package/source/version/visibility | 正确 |
| Progressive disclosure | [design.md](./design.md) | index + skill_view | 正确 |
| Skill guard | [design.md](./design.md) | 注入/泄密/危险命令扫描 | 需要规则归属 |
| TurnTrace | [design.md](./design.md) | prompt/tool/provider/memory/skill/growth event | 正确 |
| GrowthReport | [design.md](./design.md) | metrics + correction proposal | 需要黑盒 provider 评分规则 |

### 2.7 Desktop / UI / UX 设计

| 设计项 | 当前定义位置 | 内容 | 评审状态 |
|--------|--------------|------|----------|
| Desktop Rust | [integration.md](./integration.md) | Station API gateway、stream bridge、device bridge、CLI launcher | 正确 |
| Desktop Web | [integration.md](./integration.md) | agentRuntime projection、纯页面渲染 | 正确 |
| Agent Center | [integration.md](./integration.md) | Agent 列表和状态 | 正确 |
| Agent Chat | [integration.md](./integration.md) | ConversationFlow、tool card、approval | 需要 event reconcile |
| Agent Profile | [integration.md](./integration.md) | identity/runtime/tools/memory/skill/channel/growth | 正确 |
| Agent Assets | [integration.md](./integration.md) | Memory/Skill/MCP/A2A 管理 | 正确 |
| Provider UI | [provider-strategy.md](./provider-strategy.md) | Provider 类型、ModelBackend、可控性、风险、Bridge | 正确 |

### 2.8 执行计划设计

| Phase | 当前定义位置 | 内容 | 评审状态 |
|-------|--------------|------|----------|
| Phase 1 | [phase-1-contract-and-kernel.md](./execution-plans/phase-1-contract-and-kernel.md) | proto、目录、Agent/RuntimeProfile/Provider/Thread/Turn、event stream | 正确 |
| Phase 2 | [phase-2-runtime-tool-memory-skill.md](./execution-plans/phase-2-runtime-tool-memory-skill.md) | Kernel-native、ModelBackend、tool、memory、skill、trace | 正确 |
| Phase 3 | [phase-3-desktop-projection-ui.md](./execution-plans/phase-3-desktop-projection-ui.md) | Desktop Rust/Web projection 和 UI | 正确 |
| Phase 4 | [phase-4-a2a-mcp-channel-growth.md](./execution-plans/phase-4-a2a-mcp-channel-growth.md) | A2A、MCP、Channel、Growth、CLI-wrapped 样板 | 过大，建议拆分 |

---

## 3. 深度评审：P0 必须修正

### P0-1: Provider 合同必须 proto 化，不能只停留在 Go interface

当前 [provider-strategy.md](./provider-strategy.md) 已经提出 `AgentRunEnvelope` 和 `AgentProviderEvent`，这是正确方向。但这些现在仍是文档里的 Go-like interface，不足以约束 Desktop Rust、Station stream、CLI bridge 和 UI projection。

风险：

- Kernel-native 和 CLI-wrapped 各自解释 envelope，边界一致性会退化成口头约定。
- CLI adapter 可能漏投 Memory/Skill/ToolPolicy，导致同一 Agent 在不同 Provider 下行为差异不可解释。
- UI 无法稳定消费 provider event。

建议：

- 新增 `provider.proto` 或扩展 `runtime.proto`，定义 `AgentRunEnvelope`、`AgentProviderEvent`、`AgentProviderResult`、`ProviderError`。
- `TurnEvent.payload_json` 在实现前改成 `oneof payload`，至少覆盖 provider/tool/approval/artifact/growth/error。
- Contract tests 以 proto fixture 驱动，而不是直接测 Go struct。

### P0-2: Capability 三层模型需要合成规则

当前存在：

- `CapabilitySet`
- `AgentProviderCapabilitySet`
- `ModelBackendCapabilitySet`

这三者都合理，但缺少明确合成公式。

风险：

- UI 可能展示 ModelBackend 支持 tool calling，但 AgentProvider 是 CLI-wrapped，实际 Station tool loop 不可控。
- TurnRunner 可能误用 backend capability 绕过 provider control policy。
- Profile 保存的 capability snapshot 与 registry descriptor 漂移。

建议：

- 定义 `EffectiveCapabilitySet = AgentPolicy ∩ RuntimeProfilePolicy ∩ AgentProviderCapability ∩ ModelBackendCapability ∩ SurfaceCapability`。
- Registry descriptor 是事实源；Profile 内保存的是 snapshot，用于历史 Turn 重放。
- UI 展示同时显示 raw capability 与 effective capability。
- CLI-wrapped 的 `station_tool_loop=false`，即使 CLI 内部支持自己的 tool，也不能等同 Station tool loop。

### P0-3: CLI-wrapped Restricted Bridge 需要完整威胁模型

当前 Bridge token 绑定 turn/provider_run/allowlist 是必要但不充分。

风险：

- CLI 进程读取宿主环境变量或本地 token 后绕过 bridge。
- CLI 输出日志泄露 bridge token、用户路径、模型凭证。
- CLI 通过 workspace 文件写入诱导后续 Kernel-native Provider 执行恶意 skill/prompt。
- CLI 通过网络访问 Station 普通 API，而不是 bridge API。

建议：

- 明确 CLI 启动环境 allowlist，默认清理 Station auth、provider keys、proxy secret、SSH agent、系统 credential helper。
- Bridge token 只允许访问 `/agent/tools/bridge/:name` 这一类窄端点。
- Bridge token 不进入 prompt，只进入环境或 sidecar 文件，并要求日志脱敏。
- Workspace 写入的文件不能自动升级为 Skill/Memory；必须通过 Station tool 和 guard。
- CLI Provider 运行前后做 workspace diff 摘要，供 TurnTrace 记录。

### P0-4: TurnEvent 事务与重放语义必须先定

当前设计强调 TurnEvent，但还没有定义事件写入事务和断线恢复。

风险：

- provider stream 已输出，DB 事件未写入，Desktop 刷新后状态丢失。
- approval 后重复点击导致 tool 重复执行。
- stop 与 tool result 竞态，Turn 进入不一致状态。
- Desktop stream 断线后 replay 重复渲染或漏事件。

建议：

- TurnEvent 必须 `(turn_id, sequence)` 唯一，并有 monotonic sequence allocator。
- 所有外部副作用前先写 intent event，例如 `tool_call_requested`，完成后写 terminal event。
- ToolCall、Approval、ProviderRun 都需要 idempotency key。
- Stream API 支持 `after_sequence`。
- Turn terminal state 只能由 TurnRunner 单点写入。

### P0-5: Desktop projection 需要 snapshot + delta + reconcile 合同

当前原则是页面不 mount-time fetch，由 `agentRuntime` 管 projection。这是对的，但缺少 projection 协议。

风险：

- Agent Chat、Tools、Growth 多页面看到的审批状态不一致。
- 长时间断线后只靠 stream delta 无法恢复。
- 页面刷新后 running turn 卡死。

建议：

- 每个 projection 定义 `snapshot_version` 和 `last_event_sequence`。
- `agentRuntime` 启动先拉 snapshot，再订阅 stream。
- stream 断线后用 `after_sequence` 续订；失败则重新拉 snapshot。
- Projection 必须有 stale/refreshing/error 状态，页面只渲染这些状态，不自行补 fetch。

---

## 4. 深度评审：P1 应优先补齐

### P1-1: Policy resolution order 需要固定

Tool policy、Provider capability、Agent policy、Channel policy、User permission、Approval policy 同时存在，必须明确顺序。

建议顺序：

```text
Actor permission
  -> Agent policy
  -> RuntimeProfile policy
  -> Surface/Channel policy
  -> Provider effective capability
  -> Tool risk policy
  -> Approval policy
```

任何 deny 优先，approval 不能覆盖 deny。

### P1-2: Memory scope 权限需要补齐

Memory 分 global/user/agent/thread-derived 是对的，但缺权限边界。

建议：

- `global` 写入需要高权限或系统任务。
- `user` 记忆应绑定 actor，并支持用户查看/删除。
- `agent` 记忆默认只对该 Agent 可见。
- `thread-derived` 默认不进入长期召回，必须 promotion。

### P1-3: Skill source trust 需要一等建模

Skill 可能来自 AI 创建、本地导入、Git、市场、系统内置。不同来源信任等级不同。

建议 SkillPackage 加：

- `source_trust_level`
- `signature`
- `review_status`
- `last_guard_result`
- `allowed_tool_categories`

### P1-4: Growth 对黑盒 Provider 的评分必须独立

Kernel-native 有 full trace，CLI-wrapped 只有 bridge trace + artifact + raw observation。如果混用同一个 score，会误判。

建议：

- `GrowthTraceMode = full | bounded | black_box`
- full trace 才能做 memory/skill 精准归因。
- black-box trace 只做 run-level 成功率、artifact 质量、用户反馈、bridge tool 归因。

### P1-5: Phase 4 太大，需要拆分

Phase 4 同时包含 A2A、MCP、Channel、Growth、CLI-wrapped 样板，风险过高。

建议拆为：

1. Phase 4A：MCP dynamic tools。
2. Phase 4B：A2A local + remote resolver。
3. Phase 4C：Channel binding。
4. Phase 4D：Growth diagnostics。
5. Phase 4E：CLI-wrapped Provider 样板。

### P1-6: Workspace / CodingRun 还不足以指导实现

当前 workspace 只定义 context reference 和 local path grant，CodingRun 只是预留。

建议：

- 单独写 `workspace-design.md`。
- 区分 Prompt context、Workspace source、Runtime workdir、Artifact output。
- CodingRun 暂不进入主线，避免过早拉大范围。

---

## 5. 深度评审：P2 可延后但要记录

### P2-1: API 路径只是草案，需要按 proto service 反推

当前 [design.md](./design.md) 中 API 面是 HTTP 表。实现前应从 proto service 定义反推 HTTP 映射，不要手写散装 API。

### P2-2: A2A 与 MCP 的错误分类要统一

A2A task failed、MCP server unavailable、tool timeout、approval expired 都应进入统一 `AgentErrorCode`。

### P2-3: ModelBackend registry 需要模型发现策略

OpenAI-compatible、Ollama、custom gateway 是否支持 model list、tool calling、context window，需要探测和缓存。

### P2-4: UI 的 Provider 风险提示要产品化

CLI-wrapped 的“黑盒/边界可控”不能只在技术文档里出现，UI 保存 Profile 时应明确提示能力降级。

### P2-5: Dogfood 场景应覆盖 Provider 差异

同一任务分别跑 Kernel-native 和 CLI-wrapped，验证 envelope、bridge、artifact、final state 是否一致。

---

## 6. 推荐修正顺序

1. **先修 Provider 合同**：补 `AgentRunEnvelope`、`AgentProviderEvent`、`ProviderResult`、`ProviderError` 的 proto 定义。
2. **再修 Capability 合成**：删掉含糊 capability，明确 effective capability 的计算规则。
3. **再修 TurnEvent**：从 `payload_json` 过渡到 `oneof payload`，补 sequence/replay/idempotency。
4. **再修 CLI Security**：写 bridge 威胁模型、env allowlist、token 脱敏、workspace diff。
5. **再修 Desktop Projection**：定义 snapshot/delta/reconcile 合同。
6. **最后拆 Phase 4**：把 MCP/A2A/Channel/Growth/CLI 样板拆开验收。

---

## 7. 通过标准

进入实现前，至少满足：

1. Provider contract 有 proto，不只在 Go interface 文档中。
2. Effective capability 能从 profile 和 registry descriptor 确定性算出。
3. 任意 ToolCall 都有幂等 key、approval 状态和审计记录。
4. CLI-wrapped 无 bridge 时无法调用任何 Station tool。
5. Desktop 刷新后能通过 snapshot + event sequence 恢复任意 running Turn。
6. Growth 能明确区分 full trace 和 black-box trace。
