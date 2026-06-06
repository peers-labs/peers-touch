# Agent Kernel — 集成设计

> **Status**: draft
> **Version**: 2026.06
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `apps/station/app/subserver/agent/` + `apps/desktop/`

---

## 1. 与 Peers-Touch 架构的关系

### 1.1 Client → Model → Station

Agent Kernel 严格落在 Peers-Touch 三层架构里：

| 层 | Agent 责任 |
|----|------------|
| Model | proto 合同、枚举、请求响应、事件结构 |
| Station | Agent 业务真源、执行状态、Memory/Skill/MCP/A2A/Channel/Growth |
| Client | Desktop/Mobile 体验与设备能力桥接 |

任何跨端可见状态都不能只存在 Desktop。

### 1.2 Station / Desktop 边界

| 能力 | Station | Desktop Rust | Desktop Web |
|------|---------|--------------|-------------|
| Agent profile | 真源 | 透传 | 表单与展示 |
| Runtime profile | 真源 | 本地 CLI Provider 可用性补充 | 配置 UI |
| Thread / Turn | 真源 | stream bridge | conversation projection |
| Tool policy | 真源 | 不判断 | 审批交互 |
| Memory / Skill | 真源 | 不持久化 | 管理 UI |
| MCP / A2A | 真源 | 仅本地网络/设备辅助 | 管理 UI |
| Channel binding | 真源 | 不持久化 | 配置 UI |
| Local path grant | 记录引用摘要 | 设备授权真源 | 选择交互 |
| CLI Provider process | run 记录真源 | 启停进程 | 状态展示 |
| Growth report | 真源 | 不参与 | 可视化与修正操作 |

---

## 2. 从 gdpa-agent-box 借鉴什么

| Agent Box 能力 | Peers-Touch 借鉴方式 | 不照搬内容 |
|----------------|----------------------|------------|
| LogicalAgent / ExecutionProfile / Thread / Run | 转为 Agent / RuntimeProfile / AgentThread / AgentTurn proto-first 模型 | 不复制 SQLite store type 和 Web 管理台结构 |
| RuntimeRegistry 与 CapabilitySet | 作为 Station runtime descriptor 与能力矩阵 | 不按 CLI 或厂商字符串散落判断 |
| Eino/native tool calling | 引入 schema-first ToolDescriptor 和 provider adapter | 不继续文本 tag tool parsing |
| CLI provider 包装 | 参考其把 Trae/Cursor/Claude/Codex CLI 封装成可选能力的思路 | 不采用 CLI-first 路线，不假装控制黑盒内部行为 |
| MCP 动态工具 | Station 统一管理 MCP server 并投影为 ToolDescriptor | 不默认给所有 Agent 暴露 MCP |
| A2A resolver | Peers Station 生成 Agent Card、Task 状态和本地/远程 resolver | 不复制参考系统的 remote sharing UI |
| Skill package | SkillPackage + progressive disclosure + guard + versioning | 不复制技能市场页面和包管理体验 |
| Workspace isolation | 采用“Station 记录策略、Desktop 执行设备能力”的边界 | 第一阶段不引入完整 proot/rootfs 复杂度 |
| Channel-bound runtime | Friend/Group/Channel 入站统一进入 AgentThread | 不复制 Lark 卡片运行时 UI |
| CodingRun overlay | 为未来 Coding Agent 设计 CodingRun，连接任务和执行记录 | 不复制 Dashboard/Coding Agent 页面结构 |
| Growth/Telemetry | 结合 Peers 自成长，形成 TurnTrace + GrowthReport | 不只做遥测统计 |

---

## 3. 与当前 Agent 代码的替换关系

当前 `apps/station/app/subserver/agent/` 的代码不是兼容约束。重构时可以直接替换目录结构、删除旧表和旧 API，只保留仍有价值的领域思想：

| 当前服务 | 目标模块 | 处理策略 |
|----------|----------|----------|
| `TurnService` | `domain/runtime/turn_runner.go` + `application/turn_app.go` | 重写状态机、prompt、tool、provider、growth |
| `PromptAssemblyService` | `domain/prompt/` | 保留分层思想，补 hash 与 profile snapshot |
| `MemoryService` | `domain/memory/` | 保留 freeze/rollback 思想，按 proto-first 重建 |
| `SkillService` | `domain/skill/` | 保留 guard/disclosure，升级 SkillPackage |
| `ToolRegistryService` | `domain/tool/` | 替换文本 tag 解析为 schema-first |
| `ReviewService` | `domain/growth/` + `domain/scheduler/` | review 成为 scheduler job |
| `CompressionService` | `domain/prompt/` + `domain/thread/` | 归入 replay/window 策略 |
| `ProviderService` | `infrastructure/provider/` | 只做 provider adapter |
| `DelegationService` | `domain/a2a/` | 转成 A2A resolver/task |
| `GrowthMetricsService` | `domain/growth/` | 以 TurnTrace 为输入 |
| `DogfoodService` | `domain/growth/dogfood.go` | 作为可调度验证场景 |

重构不是“在旧 service 上继续加功能”，而是先落新 contract 和 kernel，再把有价值的实现片段按新边界搬入或重写。

---

## 4. Provider 集成

Provider 统一进入 Agent Profile，不再区分“模型 provider”和“CLI 运行体系”两套概念。

| Provider 类型 | Station | Desktop Rust | UI |
|---------------|---------|--------------|----|
| Eino-native | 完全控制 prompt、tool loop、trace、growth | 无特殊要求 | 标记为完全可控 |
| Vendor API | 控制 API request、tool calling、streaming，能力取决于厂商 | 无特殊要求 | 显示厂商能力矩阵 |
| CLI-wrapped | 控制启动、输入、环境、bridge、停止；不控制内部行为 | 启动/停止 CLI 进程，回传事件 | 标记为部分可控或黑盒 |

CLI-wrapped Provider 默认不拥有 Station tool 权限。只有 Agent Profile 显式开启 Restricted Bridge 后，Station 才发放绑定 `agent_id/thread_id/turn_id/provider_run_id` 的一次性 bridge token。

---

## 5. Desktop UI / UX 方案

### 4.1 信息架构

Peers-Touch Desktop 侧建议把 Agent 作为工作台能力，而不是 Agent Box 式全屏管理台。

一级入口：

- `Agent Center`：Agent 列表、状态、最近运行、创建入口。
- `Agent Chat`：当前 Agent 的对话与运行态。
- `Agent Profile`：身份、运行配置、工具策略、Memory/Skill scope。
- `Agent Assets`：Memory、Skill、MCP、A2A 的分组管理。
- `Agent Growth`：质量趋势、诊断、修正建议、dogfood 结果。

### 4.2 页面与 Runtime Projection

| 页面 | Projection owner | 页面职责 |
|------|------------------|----------|
| AgentCenterPage | `agentRuntime.agentList` | 列表、筛选、创建入口 |
| AgentChatPage | `agentRuntime.threadDetail` | 消息流、工具卡、审批、停止/重试 |
| AgentProfilePage | `agentRuntime.agentProfile` | 编辑 Agent 与 RuntimeProfile |
| AgentMemoryPage | `agentRuntime.memory` | 检索、冻结、回滚、删除 |
| AgentSkillPage | `agentRuntime.skill` | 包选择、skill 查看、禁用、回滚 |
| AgentToolsPage | `agentRuntime.tools` | tool policy、approval queue |
| AgentMCPPage | `agentRuntime.mcp` | MCP server 连接与工具预览 |
| AgentA2APage | `agentRuntime.a2a` | 可调用 Agent、策略、调用历史 |
| AgentGrowthPage | `agentRuntime.growth` | 指标、诊断、修正建议 |

页面禁止 mount-time fetch；数据由 RuntimeDescriptor 初始化、订阅和刷新。

### 4.3 组件原则

- 使用 LobeUI first，antd fallback。
- 工具审批用卡片，但卡片只承载单个审批对象，不把整个页面做成卡片套卡片。
- Tool / Memory / Skill / MCP 等管理界面以表格、抽屉、分段控件、状态标签为主，避免营销式 hero。
- Chat 运行态要把“模型文本、工具调用、审批等待、错误恢复、Growth 归因”按时间线展示。
- Agent Profile 编辑采用分区表单：Identity、Runtime、Tools、Memory、Skill、Channel、Growth。

### 4.4 关键交互

| 场景 | UX 设计 |
|------|---------|
| 创建 Agent | 先填身份与职责，再选择 runtime profile，最后配置工具与知识资产 |
| 执行 Turn | 输入区提交后立即创建 user event，assistant 区展示 running 状态 |
| 工具审批 | ConversationFlow 内出现审批卡，同时 Tools 页聚合待处理 |
| Memory 归因 | Turn detail 显示本轮使用的 memory，并能反馈 helpful/unhelpful |
| Skill 调用 | Tool/Skill event 可展开查看命中的 skill index 和 full skill |
| Growth 下降 | Growth 页给出“原因证据 + 建议动作 + 回滚按钮” |
| Channel 绑定 | 在 Profile 的 Channel 分区配置 friend/group/channel routing |

---

## 6. Mobile 兼容

本设计不要求第一阶段实现 Mobile UI，但 proto 和 Station API 必须避免 Desktop-only 假设：

- `AgentSurface` 预留 `mobile_chat`。
- Tool approval projection 不依赖 Desktop window 能力。
- Local path grant 是 Desktop-only capability，Mobile runtime profile 应显式不支持。
- Memory / Skill / Growth projection 可被 Mobile 只读消费。

---

## 7. 风险与约束

| 风险 | 影响 | 缓解 |
|------|------|------|
| 一次性重构范围过大 | 长期不可合并 | 按 execution plans 分阶段，每阶段有可验收边界 |
| proto 设计过早僵化 | 后续调整成本高 | 当前字段只覆盖核心闭环，扩展用 reserved 和新 message |
| Desktop 绕过 runtime projection | 状态不一致 | Agent 页面必须注册 RuntimeDescriptor |
| Tool approval 安全薄弱 | 高风险操作被模型直接执行 | policy + approval + audit 三层强制 |
| MCP/A2A 引入外部不稳定性 | Turn 失败率升高 | 健康检查、超时、隔离、按 Agent 显式启用 |
| Growth 只变成报表 | 不能自成长 | 修正建议必须能回到 Memory/Skill policy 操作 |

---

## 8. 验收口径

目标架构不是以“页面能聊天”为验收，而以以下闭环验收：

1. 新建 Agent 后，profile、runtime、tool policy 均来自 proto contract。
2. 执行一个 Turn 后，可以看到完整 TurnEvent、ToolCall、Trace、final response。
3. 工具调用必须走 schema-first 和 policy，不存在文本 tag 解析。
4. Memory snapshot 与 Skill index 可在 TurnTrace 中定位。
5. Desktop 刷新后能从 projection 恢复运行历史和审批状态。
6. Growth report 能根据 TurnTrace 给出至少一个可执行修正建议。
