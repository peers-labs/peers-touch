# Agent Kernel — 产品能力蓝图与深度评审

> **Status**: draft
> **Version**: 2026.06
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `apps/station/app/subserver/agent/` + `model/domain/agent/` + `apps/desktop/`

---

## 1. 一句话结论

Peers-Touch 的 Agent 应该按“用户可感知的 Agent 产品能力”重构，而不是按现有代码或 gdpa-agent-box 的管理台结构重构。

目标态是：

- **交互体验、Agent 组织、Desktop / UI / UX 以 LobeHub / LobeChat 为产品基线**：Agent 是长期队友，有 Profile、有 Topic、有 Memory、有 Skill、有 Knowledge、有 Task，有顺滑的聊天、工具卡片、配置抽屉和跨设备体验。
- **CLI 集成、Skill 包、Bridge Tool、A2A、MCP 后端控制以 gdpa-agent-box 为工程基线**：外部 CLI runtime 以受控 provider 接入，Skill 以 `SKILL.md` / package / progressive disclosure 落地，Tool/MCP/A2A 都有策略、审批、审计和运行事件。
- **最终实现必须是 Peers-Touch 原生能力**：Station 做业务真源，Proto-first 定合同，Desktop 走 PageDescriptor / RuntimeDescriptor / Projection，UI 使用 Peers-Touch 的产品框架、LobeUI 组件和既有视觉语言，不复制 gdpa-agent-box UI，不背历史数据包袱。

---

## 2. 参考源定位

### 2.1 LobeHub / LobeChat 负责回答什么

LobeHub 的强项是“Agent 产品应该长什么样、用户如何感知 Agent 能力”：

- Agent 是持久队友，不是一次性聊天。
- 用户围绕 Agent 组织工作，而不是围绕模型 API 组织工作。
- Agent Profile 一次配置 role、model、skills、knowledge base、memory，然后持续变聪明。
- Memory 是透明、结构化、可编辑的 white-box memory。
- Skill / MCP 对用户表现为可发现、可安装、可启停的能力商店。
- Desktop / Web / Mobile 都是同一套 Agent、Pages、Memory 的延续。
- Task、Page、Agent Group 让 Agent 走出聊天框，变成可以被指派、协作和交付的工作体。

Peers-Touch 应该学习这些**产品能力和交互形态**，不复制它的 Next.js / Electron / Zustand 架构。

### 2.2 gdpa-agent-box 负责回答什么

gdpa-agent-box 的强项是“Agent 能力如何被安全、可观测、可扩展地执行”：

- CLI runtime 接入成熟：Codex、Claude Code、Cursor CLI、Trae / Coco 等可以作为 external dialogue runtime 被统一调度。
- Skill 包形态成熟：`SKILL.md`、技能包、skill projection、Skill Bridge、Skill Curator、`skills_list` / `skill_view` / `skill_manage` / `skill_toggle` 等闭环完整。
- Tool Layer 成熟：Eino `InvokableTool` registry、metadata、category、policy profile、approval、resilient wrapper、bridge endpoint。
- MCP 动态工具接入成熟：MCP server 转成工具、支持动态注册/清理、策略过滤。
- A2A 后端协议设计完整：Agent Card、JSON-RPC、Task 状态机、SSE、resolver、local/remote transport、父子任务追踪。
- CLI Bridge 安全边界有经验：受限 token、allowlist、审批卡、环境变量过滤、workspace projection、bridge skill 生成。

Peers-Touch 应该学习这些**工程机制和安全边界**，但把它们纳入 Peers-Touch 的 Proto、Station、Desktop Runtime、UI 框架。

---

## 3. 全量产品能力清单

下面列的是 Peers-Touch Agent 目标态需要具备的产品能力。每项能力都应在产品上可见、在 Station 中有领域模型、在 TurnTrace 中可审计。

| 能力域 | 用户感知 | 核心设计来源 | Peers-Touch 目标 |
|--------|----------|--------------|------------------|
| Agent Home | 我有哪些 Agent、谁在工作、谁可用 | LobeHub | Agent Center + Agent 状态总览 |
| Agent Profile | 配置 Agent 的身份、模型、技能、记忆、知识、工具、协作权限 | LobeHub + gdpa | Peers 原生 Profile 页面 |
| Topic / Thread | 每个 Agent 有结构化对话历史，可搜索、收藏、归档、恢复 | LobeHub | Thread 一等资源 |
| Chat Interaction | 流式回复、thinking、tool cards、artifact、approval、retry、branch | LobeHub | ConversationFlow + runtime projection |
| Memory | Agent 记住我、可解释地使用记忆、我能编辑/删除/反馈 | LobeHub | White-box Memory + Station 治理 |
| Skill | 给 Agent 装能力包，Agent 可按需读取技能细节 | gdpa-agent-box | SkillPackage + `SKILL.md` + Skill Bridge |
| Tool | Agent 能调用工具，用户能看见、审批、回放 | gdpa-agent-box | Schema-first Tool Registry |
| MCP | 连接外部工具服务、私有 API、本地进程工具 | gdpa-agent-box + LobeHub UX | MCP Server 管理 + Tool projection |
| A2A / Agent Group | Agent 间协作、顺序/并行/辩论、长任务委派 | gdpa-agent-box + LobeHub UX | A2A 协议 + Agent Group UI |
| Task / Schedule | 把工作派给 Agent，异步执行、定时执行、等待验收 | LobeHub + gdpa | Agent Task Board + Scheduler |
| Knowledge / Resource | 给 Agent 绑定文档、知识库、项目资料 | LobeHub + Peers | Knowledge Resource + RAG + Workspace |
| Workspace | Agent 在哪里工作，能看哪些文件，产物放哪里 | gdpa-agent-box | Peers Workspace / Project Workspace |
| CLI Provider | Codex/Claude/Cursor/Trae 类 CLI 作为 provider 接入 | gdpa-agent-box | CLI-wrapped AgentProvider |
| Kernel-native Provider | Peers 自己控制 prompt、tool loop、memory、skill | Peers + Eino | Kernel-native AgentProvider |
| Model Backend | 多模型厂商、本地模型、网关模型统一接入 | LobeHub | ModelBackend 管理 |
| Approval / Safety | 高风险操作要确认，工具和 CLI 都不能绕过 | gdpa-agent-box | Station enforced policy |
| Growth / Diagnostics | Agent 变好、记忆/技能有反馈、失败可归因 | Peers + gdpa | Growth Report + TurnTrace |
| Marketplace / Sharing | 发现、安装、发布 Agent / Skill / MCP | LobeHub | Peers Community / Workspace 内共享 |
| Channel | Agent 可以接入外部聊天渠道 | Peers + gdpa | ChannelBinding + Thread mirror |

---

## 4. 能力对比矩阵

| 功能点 | LobeHub / LobeChat 强在哪里 | gdpa-agent-box 强在哪里 | Peers-Touch 采用策略 | 评审结论 |
|--------|------------------------------|--------------------------|----------------------|----------|
| Agent 产品心智 | Agent 是持久队友，Agent Builder、Agent Marketplace、Agent Groups、Tasks、Pages 形成完整产品心智 | LogicalAgent / ExecutionProfile / DialogueThread 更偏工程抽象 | 产品心智采用 LobeHub，领域模型采用 Peers Proto | LobeHub 更强 |
| Agent Profile | 用户能集中配置 role、model、skills、knowledge、memory | Profile 能表达 runtime、workspace、CLI executor、A2A policy | UI 采用 LobeHub 样式，配置项加入 gdpa 的 runtime/CLI/bridge 能力 | 两者互补 |
| Chat UX | 对话体验成熟，Skill 按钮、工具启停、Agent 切换、Topic 管理清晰 | 运行事件、tool/approval/bridge 证据链更强 | 前端交互用 LobeHub 风格，事件事实源用 Station projection | LobeHub 做 UX，gdpa 做执行 |
| Memory | white-box memory、personal memory、可编辑结构化记忆、用户心智清晰 | memory tool、feedback、GrowthLogger、scope、bridge 审批更强 | Memory 产品按 LobeHub，治理按 Peers/gdpa | LobeHub 主导 |
| Skill | Skills 作为可发现、可安装、可启停的能力，MCP Marketplace 体验好 | `SKILL.md`、package、projection、progressive disclosure、Skill Bridge 明显更深 | Skill 内核采用 gdpa，UI 采用 LobeHub Store | gdpa 主导 |
| Tool | 用户能理解“开启某能力后 Agent 可调用工具” | Eino ToolRegistry、policy、approval、bridge endpoint、category、schema 更完整 | 后端采用 gdpa 模式，前端用 LobeHub 工具卡体验 | gdpa 主导 |
| MCP | MCP Marketplace、Custom MCP、Desktop STDIO 一键配置体验好 | 动态工具注册/清理、策略过滤、bridge 调度、执行审计更完整 | MCP UX 学 LobeHub，执行内核学 gdpa | 后端 gdpa 更强，UX LobeHub 更强 |
| A2A / Multi-Agent | Agent Groups 的顺序/并行/协作产品心智好 | 标准 A2A 协议、Agent Card、Task 状态机、resolver、远程 agent 更完整 | 产品用 Agent Groups，协议用 A2A | gdpa 后端更强 |
| CLI 集成 | 主要是 LobeHub 自身桌面和 MCP STDIO，不是 CLI coding runtime 核心能力 | Codex/Claude/Cursor/Trae runtime、workspace isolation、bridge skill、keep-alive 经验丰富 | 采用 gdpa 的 CLI integration 思路，封成 Peers AgentProvider | gdpa 显著更强 |
| Provider / Model | 多模型 provider 体验成熟，用户配置路径清晰 | runtime profile / executor capability 更强 | ModelBackend UI 学 LobeHub，AgentProvider 控制学 Peers/gdpa | 两层抽象 |
| Task / Schedule | Task 像 Linear/GitHub Issue，可 assign agent、评论、定时、验收 | cron、kanban、coding run、orchestra 后端链路更强 | UI 学 LobeHub，执行闭环结合 Peers 项目能力 | LobeHub 产品更强，gdpa 后端更强 |
| Knowledge | 文件上传、知识库、agent 绑定、topic 引用心智成熟 | Knowledge Pack 插件目录、skill/MCP/prompt hook 更工程化 | Peers 用 Knowledge Resource + Knowledge Pack 双层 | 两者互补 |
| Desktop | Web/Desktop/Mobile 一致体验，桌面端承接 MCP STDIO | Desktop 不是 gdpa 的主要 UX 亮点，但 CLI/workspace 控制强 | Peers Desktop 体验学 LobeHub，Rust 桥和 CLI launcher 学 gdpa | LobeHub UX 更强 |
| Growth / 可观测 | 产品强调 co-evolution，但工程 trace 不一定透明到用户 | GrowthLogger、TurnTrace、memory/skill 事件归因强 | Peers 保留自身 Growth 作为差异化 | Peers 应该自建 |

---

## 5. Peers-Touch 目标信息架构

### 5.1 左侧一级入口

Peers-Touch Desktop 的 Agent 产品不应做成 gdpa-agent-box 管理台，而应是一个“工作台”：

| 入口 | 说明 | 首屏信息 |
|------|------|----------|
| Agents | Agent 列表、状态、最近 Topic、运行中任务 | Agent 卡片、在线/运行状态、能力标签 |
| Chat | 当前 Agent 的 Topic / Conversation | Topic 列表、消息流、输入区 |
| Tasks | 指派给 Agent 的异步任务和定时任务 | Backlog / Running / Review / Done |
| Memory | 用户记忆、Agent 记忆、项目记忆 | 记忆维度、可编辑条目、使用记录 |
| Skills | Skill Store、已安装包、Agent 绑定 | LobeHub 风格商店 + gdpa Skill 包详情 |
| Tools | Tool / MCP / Approval / Audit | 工具目录、MCP server、风险等级 |
| Groups | Agent Group / A2A 协作 | 顺序/并行/辩论编排、成员状态 |
| Providers | AgentProvider / ModelBackend 配置 | Kernel-native、CLI-wrapped、模型后端 |
| Diagnostics | TurnTrace、Growth、失败归因 | 最近运行、失败原因、建议修复 |

### 5.2 Agent Profile 页面

Agent Profile 是核心配置入口，不应拆散到多个系统设置页。

Profile 应包含：

| Tab | 用户问题 | 设计内容 |
|-----|----------|----------|
| Overview | 这个 Agent 是谁，能做什么 | 名称、头像、描述、标签、职责边界、发布状态 |
| Instructions | 它应该如何行动 | System instruction、输出风格、边界、handoff 条件 |
| Model & Provider | 它由谁执行，用哪个模型 | AgentProvider、ModelBackend、model、reasoning、temperature、capability |
| Memory | 它记住什么 | 记忆开关、scope、维度、写入策略、最近使用 |
| Skills | 它拥有哪些能力包 | Skill packages、启停状态、版本、来源、trust |
| Tools | 它能调用哪些工具 | Tool allow/deny、risk、approval policy |
| MCP | 它连接哪些 MCP server | server 状态、tool projection、credential |
| Knowledge | 它引用哪些文档和知识库 | Knowledge Resource、RAG policy、topic attachment |
| Workspace | 它在哪里工作 | workspace、文件授权、CLI cwd、artifact path |
| Collaboration | 它能调用谁，谁能调用它 | A2A card、Agent Group、call policy |
| Channels | 它在哪些渠道可用 | ChannelBinding、响应模式、话题隔离 |
| Growth | 它如何变好 | 记忆反馈、技能建议、失败报告、测试用例 |

### 5.3 Conversation 页面

Conversation 页面应采用 LobeHub 风格的主对话体验，但事实源来自 Peers Runtime Projection。

关键交互：

- 左侧 Topic 列表：搜索、收藏、归档、删除、重命名。
- 顶部 Agent switcher：切换 Agent 时切换到该 Agent 的 Topic 集合。
- 顶部 Provider / model chip：展示当前 Turn 的 effective provider，不允许页面直接改写 Station 真源。
- 输入区能力按钮：Skill、Tool、MCP、Attachment、Memory、Knowledge、Task。
- 消息流：
  - user / assistant / system event 分层显示。
  - thinking 默认折叠。
  - tool call 用卡片显示参数、风险、状态、结果摘要。
  - approval 用明确的确认卡，支持过期、拒绝、重试。
  - artifact 用独立预览区或消息内嵌预览。
  - memory use 用可展开标记展示“本轮用了哪些记忆”。
  - skill use 用可展开标记展示“本轮读取了哪些技能”。
  - CLI-wrapped 的 stdout/stderr 只能作为 raw observation，不作为完整 trace。
- 右侧 Inspector：
  - Run Summary
  - Memory used / written
  - Skills loaded
  - Tools called
  - Provider capability degradation
  - Artifacts
  - Diagnostics

---

## 6. Memory 产品方案

### 6.1 结论

Memory 必须以 LobeHub 的 white-box memory 为产品基线：用户能看到、能编辑、能删除、能反馈、能理解 Agent 为什么记住和为什么使用。

gdpa-agent-box 的 memory tool、feedback、scope、GrowthLogger 值得保留，但它更偏执行和审计。Peers-Touch 的 Memory 应该同时满足：

- LobeHub 式用户心智：透明、结构化、可控、跨对话生效。
- Peers 式治理：Station 真源、proto 合同、版本、权限、审计、回滚。
- gdpa 式工具闭环：Agent 可通过受控工具搜索/写入/反馈记忆，CLI provider 只能通过 Restricted Bridge 写入。

### 6.2 Memory 维度

采用六类产品维度，映射到 Peers 领域模型：

| 维度 | 说明 | 例子 | 默认 scope |
|------|------|------|------------|
| Identity | 人、组织、关系、身份 | “用户是增长团队负责人” | user |
| Preference | 偏好、格式、禁忌、长期指令 | “报告偏好中文、先结论后依据” | user / agent |
| Persona | 用户工作风格、沟通方式 | “喜欢直接、不要营销文案” | user |
| Experience | 从历史任务沉淀的经验 | “上次发布失败是因为 API schema 未同步” | agent / project |
| Context | 正在进行的项目、目标、约束 | “当前在重构 Agent Kernel” | project / thread-derived |
| Activity | 时间性活动和近期行为 | “本周在比较 LobeHub 和 gdpa-agent-box” | thread-derived / user |

Peers 内部可继续保留 `kind` / `layer` / `scope`，但 UI 不要暴露内部术语。用户看到的是“身份、偏好、经验、项目上下文、近期活动”等自然分类。

### 6.3 Memory Scope

| Scope | 说明 | 可见性 | 写入策略 |
|-------|------|--------|----------|
| User Memory | 用户个人长期记忆 | 用户所有 Agent 可用 | 默认需要可解释来源 |
| Agent Memory | 某个 Agent 的长期记忆 | 该 Agent 可用 | Agent 可建议写入 |
| Project Memory | 某个项目/Workspace 的长期记忆 | 绑定项目的 Agent 可用 | 来自项目执行和人工确认 |
| Thread-derived Memory | 从会话中临时抽取 | 当前 Thread 或短期窗口 | 默认不自动长期化 |
| Global Memory | 系统级规则或团队共识 | 全局可用 | 高权限写入 |

### 6.4 用户交互

Memory Center：

- 顶部展示“本周新增、被使用、被反馈、待确认”的记忆概览。
- 按维度和 scope 过滤。
- 每条 memory 显示：
  - 记忆内容
  - 来源 Thread / Turn
  - 最近使用时间
  - confidence / trust
  - 可见范围
  - 编辑、删除、禁用、反馈
- 支持“为什么记住”：展示产生这条记忆的摘要、原始证据链接、提取器版本。
- 支持“为什么使用”：从某次 TurnTrace 跳回这条记忆。

Conversation 中：

- 输入区有 Memory 开关和 Memory preview。
- 回复中出现“Used memory”折叠块。
- Agent 想写入高影响记忆时，显示确认卡。
- 用户说“记住/忘记/不要再这样”时，进入 Memory 操作卡，而不是只在文本里承诺。

Agent Profile 中：

- 可开关 memory recall / memory write。
- 可选择 recall scope。
- 可配置自动写入策略：
  - off
  - suggest only
  - auto-write low-risk
  - require approval

### 6.5 Memory 写入链路

```text
Turn completed
  -> MemoryCandidateExtractor
  -> CandidateClassifier(维度/scope/risk)
  -> Dedup & Conflict Resolver
  -> Policy Check
  -> Approval or Auto Write
  -> MemoryItem(versioned)
  -> Growth event
```

关键规则：

1. 不从 CLI stdout 直接写 memory。CLI-wrapped Provider 必须通过 Station memory bridge tool 写入。
2. Agent 的“我会记住”不等于已写入，必须落到 MemoryItem。
3. Memory 写入必须带 source：
   - `turn_id`
   - `agent_id`
   - `thread_id`
   - `provider_run_id`
   - `extractor_version`
   - `source_quote_hash`
4. 用户可删除或禁用 memory。删除要产生 tombstone，避免被同一内容立即重建。
5. 有冲突的记忆不自动覆盖，进入 conflict review。

### 6.6 Memory 检索链路

```text
Turn start
  -> Build Recall Intent
  -> Scope Policy
  -> Vector + Structured Retrieval
  -> Rank by relevance/trust/recency/source
  -> Budget Pack
  -> MemorySnapshot
  -> Provider Envelope
```

Kernel-native Provider 得到结构化 `MemorySnapshot`；CLI-wrapped Provider 得到 prompt/file 投影，但 snapshot hash 仍由 Station 记录。

### 6.7 Memory 深度评审

P0 风险：

- **如果没有 white-box UI，memory 会变成黑盒污染源**：必须先做 Memory Center 和 Turn 使用证据。
- **如果不区分 scope，Agent 会乱用用户隐私和项目事实**：scope 是 proto 合同，不是 prompt 约定。
- **如果 CLI 可直接写 memory 文件，会绕过治理**：CLI 只能走 bridge。

P1 风险：

- 自动写入过多会降低信任，应默认 `suggest only` 或 `auto-write low-risk`。
- `Activity` 类记忆容易过期，需要 TTL 和自动归档。
- Memory feedback 必须影响 trust，否则“有反馈按钮但无效果”会破坏体验。

---

## 7. Skill 产品方案

### 7.1 结论

Skill 采用 gdpa-agent-box 的方式做内核：`SkillPackage`、`SKILL.md`、progressive disclosure、skill projection、Skill Bridge、Skill Curator。

LobeHub 的 Skill Store / MCP Marketplace 体验值得学习，但 LobeHub 的 Skill 更偏“工具/MCP 能力启停”，不够表达“Agent 如何学习一份可读、可版本化、可投影给 CLI 的技能文档”。Peers-Touch 应该把 Skill 定义为：

> 一组面向 Agent 的可读操作知识、工具说明、脚本、引用资料和 MCP/Tool 绑定，能被 Kernel-native Provider 结构化注入，也能被 CLI-wrapped Provider 物化到其原生 skill root。

### 7.2 Skill 领域对象

| 对象 | 说明 | 必须字段 |
|------|------|----------|
| SkillPackage | 技能包，多个 Skill 的集合 | id、name、source、visibility、version、trust |
| SkillRecord | 单个技能 | identifier、title、summary、entrypoint、tags、risk |
| SkillSource | 来源 | marketplace、git、local、agent-created、system |
| SkillRevision | 版本 | content_hash、created_by、created_at、changelog |
| SkillBinding | Agent 与 skill/package 的绑定 | agent_id、package_id、enabled、policy |
| SkillProjection | 投影到某 provider 的结果 | provider_kind、target_path、hash、status |
| SkillUseEvent | 某轮使用记录 | turn_id、skill_id、viewed、projected、used_by_tool |

### 7.3 Skill 包格式

标准目录：

```text
skill-package/
  package.yaml
  skills/
    <skill-id>/
      SKILL.md
      references/
      scripts/
      assets/
      mcp.json
      tools.yaml
```

`SKILL.md` 是必要入口。原则：

- 第一屏必须说明这个 skill 解决什么问题、何时使用、何时不要使用。
- 复杂材料放 references，不一开始全注入。
- 脚本放 scripts，通过 tool 或 CLI 明确调用。
- MCP 声明只表达依赖，不直接绕过 Station MCP 管理。

### 7.4 Progressive Disclosure

Skill 不应全量塞进 prompt。采用三层披露：

| 层级 | 内容 | 使用场景 |
|------|------|----------|
| Index | identifier、title、summary、tags、when_to_use | 每轮候选匹配 |
| Card | 摘要、风险、依赖、示例 | UI 展示和模型选择 |
| Full | 完整 `SKILL.md` + references | 模型明确需要时用 `skill_view` |

Kernel-native Provider 通过 Station skill service 获取结构化内容；CLI-wrapped Provider 通过 projection 把 selected skills 映射到 `.codex/skills`、`.claude/skills`、`.agents/skills` 或 provider 自己的 skill root。

### 7.5 Skill Store UX

采用 LobeHub 风格的商店体验：

- 顶部搜索。
- Tab：
  - Peers Built-in
  - Workspace
  - Community
  - MCP-backed
  - Local / Git
  - Agent-created
- 每个 Skill card 显示：
  - 名称、摘要、标签
  - 适用 provider
  - 风险等级
  - 最近更新时间
  - 安装量 / 使用量
  - 是否需要 MCP / credentials
- 支持一键安装、启停、加入某 Agent、查看源码、查看使用记录。

### 7.6 Skill Curator

Peers-Touch 应有一个内嵌 Skill Curator，但 UI 不能像管理台。

交互：

- 在 Agent Profile / Skills 右侧打开“能力推荐”面板。
- 用户描述目标：例如“我要让这个 Agent 能维护飞书文档和代码评审”。
- Curator 只拿 Skill Bridge 工具：
  - `skill_package_query`
  - `skills_list`
  - `skill_view`
  - `skill_toggle`
  - `skill_manage`
- Curator 给出推荐清单和理由，用户确认后启用。

### 7.7 Skill 与 Memory 的边界

| 项 | Skill | Memory |
|----|-------|--------|
| 本质 | 可复用能力和操作知识 | 用户/项目/Agent 的长期事实和偏好 |
| 变更方式 | 版本化、review、发布 | 提取、反馈、编辑、删除 |
| 注入方式 | 按任务匹配，逐步读取 | 按语义召回，打包 snapshot |
| CLI 投影 | 可以物化为 `SKILL.md` | 只能投影为 prompt/file snapshot |
| 用户心智 | “给 Agent 装能力” | “Agent 记住了什么” |

### 7.8 Skill 深度评审

P0 风险：

- **不能把 Skill 简化为 Tool 开关**：Skill 是 Agent 可读知识，Tool 是可执行函数，MCP 是外部工具协议。
- **不能无版本写入**：Agent-created Skill 必须进包、带 revision、可回滚。
- **不能把 CLI projection 当事实源**：投影目录只是 provider 输入，不是持久 Skill 源。

P1 风险：

- Skill Store 如果没有 trust/source 展示，用户无法判断安全性。
- `SKILL.md` 内容需要 ContentGuard，避免 prompt injection 和危险命令。
- Skill 匹配要可解释，否则用户不知道为什么 Agent 读了某个 skill。

---

## 8. Desktop / UI / UX 产品方案

### 8.1 结论

Desktop / UI / UX 应学习 LobeHub，不学习 gdpa-agent-box。

gdpa-agent-box 的 UI 更偏“工程控制台 + Coding Agent 管理”，不适合 Peers-Touch 目标态。Peers-Touch 应做成：

- Agent-first workspace
- Chat-first interaction
- Profile-first configuration
- Store-like skill/MCP discovery
- Card-based tool/approval/artifact feedback
- Runtime projection-driven state

### 8.2 Peers-Touch UI 原则

1. 页面只消费 Runtime Projection，不直接维护业务真相。
2. 所有运行态用统一事件投影：
   - message
   - thinking
   - tool call
   - approval
   - memory
   - skill
   - artifact
   - provider status
   - error
3. 配置页看起来是产品 Profile，不是数据库表单。
4. LobeUI 优先，antd fallback。
5. 用户只看到必要控制项，高级 provider/bridge/capability 放到 advanced panel。
6. CLI-wrapped 的不确定性要被 UI 明确表达：例如“部分可控”“内部工具不可见”“usage 不可用”。

### 8.3 关键页面

#### Agent Center

卡片字段：

- Agent avatar / name / short description
- status：idle / running / waiting approval / failed
- capability chips：Memory、Skills、MCP、A2A、CLI、Workspace
- current task / last topic
- quick actions：Chat、Profile、Task、Disable

#### Agent Conversation

布局：

```text
Topic List | Conversation | Inspector
```

输入区能力：

- `+` attachment
- Skill button
- Tool button
- MCP button
- Memory visibility
- model/provider chip
- create task

#### Agent Profile Drawer / Page

常用设置在页面内，敏感/高级设置在抽屉内：

- Provider advanced：
  - control level
  - bridge mode
  - workspace isolation
  - environment policy
  - trace level
- Tool advanced：
  - allow/deny
  - approval
  - timeout
  - risk

#### Tool / Approval Card

卡片状态：

- requested
- waiting approval
- running
- succeeded
- failed
- expired
- canceled

卡片内容：

- tool name
- purpose
- risk
- input summary
- provider source
- result summary
- raw details

#### Memory Drawer

从消息中的 Memory chip 打开：

- 本轮召回记忆
- 本轮新增候选
- 被用户拒绝/编辑的候选
- 召回理由

### 8.4 Desktop Rust 职责

Desktop Rust 不拥有 Agent 业务真相，只负责：

- Station API / stream bridge
- local file picker / attachment bridge
- CLI process launcher
- local MCP STDIO launcher
- OS notification
- credential safe storage bridge
- workspace open-in-editor bridge

### 8.5 UI 深度评审

P0 风险：

- **如果页面直接 fetch 多个领域 API 拼状态，会造成状态撕裂**：必须由 agentRuntime projection 统一管理。
- **如果 CLI provider 不展示能力降级，会误导用户以为可完全审计**：UI 必须显示 control level。
- **如果 Tool/MCP/Skill 混在一个开关里，用户会混淆能力来源**：UI 上可以统一叫 Skill Store，但详情要区分 Skill doc、Tool function、MCP server。

---

## 9. Tool / MCP / A2A 产品与工程对比

### 9.1 Tool

结论：**后端 gdpa-agent-box 更强，前端 LobeHub 更强。**

gdpa-agent-box 值得学习：

- `Registry` + `Meta`。
- category：filesystem、shell、web、memory、skill、mcp。
- policy profile：minimal / standard / full。
- `GlobalAllow` / `GlobalDeny`。
- `NeedsApproval`。
- resilient wrapper。
- External Dialogue Bridge。
- bridge token + approval card。

Peers-Touch 设计：

```text
ToolRegistry
  -> ToolDescriptor(proto)
  -> ToolPolicy
  -> ApprovalPolicy
  -> ToolCall
  -> ToolResult
  -> TurnEvent
```

UI 采用 LobeHub 风格：

- Agent Profile 里启停能力。
- Conversation 中显示工具卡片。
- Chat input 可临时启用/禁用工具。
- Tool Store / MCP Store 用卡片浏览。

硬规则：

- Tool 只能由 Station ToolRegistry 执行。
- CLI provider 不能直接声明自己调用了 Station tool，必须走 Bridge。
- Tool approval 由 Station 判定，provider 传来的 `approved=true` 不可信。

### 9.2 MCP

结论：**MCP 后端控制 gdpa-agent-box 更强；MCP 安装配置 UX LobeHub 更强。**

LobeHub 值得学习：

- Skill Store 中同时出现 built-in、community MCP、自定义 MCP。
- Custom MCP 支持 HTTP endpoint 和 STDIO command。
- Desktop 支持 STDIO，本地命令型 MCP 只在桌面端可用。
- 支持从 JSON config 快速导入。
- 支持配置、测试连接、安装、启用。

gdpa-agent-box 值得学习：

- MCP server 动态注册后投影为 `mcp_{server}_{tool}`。
- 禁用/删除/重连时按前缀清理动态工具。
- MCP 工具默认不进 standard，需要 Agent 显式 allow。
- MCP 工具仍走 ToolRegistry 和 policy。
- 外部 CLI 不能绕过 bridge 调 Station MCP tool。

Peers-Touch 设计：

| 层 | 设计 |
|----|------|
| MCP Server | id、name、transport、config、credential_ref、status、owner |
| MCP Tool Projection | server tool -> ToolDescriptor |
| MCP Policy | per Agent allow、risk、approval、surface |
| MCP Runtime | HTTP in Station；STDIO 由 Desktop Rust launcher 或 Station worker 托管 |
| MCP UI | LobeHub 风格 Skill Store / Custom MCP form |

### 9.3 A2A / Agent Group

结论：**gdpa-agent-box 的 A2A 协议实现更强；LobeHub 的 Agent Group 产品表达更强。**

LobeHub 值得学习：

- Agent Groups 让用户理解多 Agent 协作。
- 顺序、并行、辩论等协作模式有清晰心智。
- Agent 像团队成员，任务可以被拆给不同角色。

gdpa-agent-box 值得学习：

- 标准 A2A Agent Card。
- JSON-RPC 方法。
- Task 状态机。
- SSE 订阅。
- local / remote resolver。
- Agent call policy。
- 父子任务 trace。

Peers-Touch 设计：

| 产品能力 | 工程实现 |
|----------|----------|
| Agent Group | A2A Workflow / GroupRun |
| 成员选择 | Agent Card + capability + policy |
| 顺序协作 | Task dependency |
| 并行协作 | Parallel A2A tasks |
| 辩论/评审 | Multiple child tasks + synthesis turn |
| 继续追问 | A2A contextId / taskId |
| 用户验收 | Task review state |

硬规则：

- Agent Group UI 不直接调用某个 Agent 函数；它创建 A2A task。
- 本地 Agent 也走同一 A2A 语义，最多 transport 优化。
- A2A 的结果是 Artifact / Message / TaskEvent，不是直接拼进父 Agent 文本。

---

## 10. Provider 产品方案

### 10.1 结论

CLI-wrapped Provider 与 Kernel-native Provider 的一致性不能靠“伪装成一样”，只能靠：

- 同一 `AgentRunEnvelope`
- 同一 `AgentProviderEvent`
- 同一 Turn state machine
- 同一 Tool / Approval / Memory / Skill 不变量
- 真实 capability 声明
- UI 显示控制级别和降级

### 10.2 用户看到的 Provider

用户在 Agent Profile 中看到：

| Provider 类型 | 展示名 | 用户理解 |
|---------------|--------|----------|
| Kernel-native | Peers Agent Runtime | Peers 完全控制 Agent 行为 |
| CLI-wrapped | Codex / Claude Code / Cursor / Trae | 使用外部 CLI 执行，Peers 控制外壳和桥接 |

高级信息：

- control level：full / bounded / black-box
- supports Station tool loop
- supports memory bridge
- supports skill projection
- supports workspace isolation
- supports attachments
- supports resume
- supports usage reporting
- supports raw logs

### 10.3 Kernel-native Provider

适用场景：

- 普通助手。
- 需要强工具治理。
- 需要可解释 memory/skill/tool trace。
- 需要 Growth 精确归因。
- 需要 A2A/MCP 全链路可控。

内部实现：

```text
TurnRunner
  -> Prompt Assembly
  -> Eino Agent Loop
  -> ModelBackend
  -> ToolRegistry
  -> Memory / Skill / MCP / A2A tools
  -> TurnTrace
```

### 10.4 CLI-wrapped Provider

适用场景：

- Codex / Claude Code / Cursor / Trae 这类已有强 coding agent 能力的 CLI。
- 需要利用 CLI 内部黑盒能力。
- 用户愿意接受部分不可观测。

控制边界：

| 能力 | Peers 可控程度 |
|------|----------------|
| 启动命令、参数、cwd | 可控 |
| 初始 prompt / instruction bundle | 可控 |
| workspace 文件投影 | 可控 |
| skill projection | 可控 |
| bridge tool allowlist | 可控 |
| stdout/stderr/log parsing | 部分可控 |
| CLI 内部 prompt 改写 | 不可控 |
| CLI 内部 tool loop | 不可控 |
| CLI 内部 memory | 不可信 |
| token usage | 取决于 CLI |
| stop/resume | 取决于 CLI 能力 |

### 10.5 Provider 一致性产品表达

同一 Agent 切换 Provider 时，UI 要显示变化：

| 能力 | Kernel-native | CLI-wrapped |
|------|---------------|-------------|
| Memory 使用证据 | 完整 | 只保证注入 snapshot，内部使用不可知 |
| Tool 调用 | 完整可审计 | 只有 bridge tool 可审计 |
| Skill 使用 | skill_view 可记录 | projection 可记录，CLI 是否阅读不可知 |
| MCP | Station 调用可审计 | bridge 调用可审计 |
| A2A | Task 可审计 | bridge 调用可审计 |
| Growth | 精确归因 | 降级为黑盒评分 + bridge 事件 |
| Security | Station 控 loop | Station 控外壳与 bridge |

### 10.6 Provider 深度评审

P0 风险：

- **不能把 ModelBackend 叫成 AgentProvider**：OpenAI/Claude/Gemini 是模型来源，不是 Agent 编排者。
- **不能把 CLI provider 伪装成 full-control**：这会让 Memory/Tool/Growth 评审全部失真。
- **不能让 CLI 继承宿主全量环境变量**：必须有 env allowlist 和 credential redaction。
- **不能让 CLI 访问通用 Station API token**：只能拿 bridge token。

P1 风险：

- CLI 日志解析应只作为 raw observation。
- CLI provider 的能力矩阵要可测试，不能靠人工填写。
- 对 coding CLI，workspace isolation 是产品信任底线，不应作为可选高级项隐藏。

---

## 11. Knowledge / Resource 产品方案

### 11.1 结论

Knowledge 借鉴 LobeHub 的用户心智：上传文件、创建知识库、绑定给 Agent 或 Topic。

但 Peers-Touch 还需要吸收 gdpa-agent-box 的 Knowledge Pack 思路：知识不只是 RAG 文档，也可以包含 prompt hook、skills、MCP、测试 Agent 和构建流程。

### 11.2 两层模型

| 层 | 用户心智 | 工程对象 |
|----|----------|----------|
| Knowledge Base | 文档集合，可被 Agent 检索 | ResourceCollection + DocumentChunk + RAG index |
| Knowledge Pack | 可交付知识产品，包含文档、Skill、MCP、prompt hook、测试 | KnowledgePackage |

### 11.3 UI

- Knowledge Base：
  - 上传文件
  - 文件解析状态
  - chunk / embedding 状态
  - 绑定 Agent
  - 绑定 Topic
  - 检索测试
- Knowledge Pack：
  - README / index
  - Skills
  - MCP
  - Prompt hooks
  - Test Agent
  - 发布版本

### 11.4 与 Memory 的边界

- Knowledge 是外部资料和可检索文档。
- Memory 是用户/Agent/项目的长期语义沉淀。
- Thread 中引用文件不等于写入 Memory。
- 从 Knowledge 中学到的经验要写 Memory，必须有独立提取和审批。

---

## 12. Task / Schedule 产品方案

### 12.1 结论

Task 采用 LobeHub 的产品心智：像 Linear / GitHub Issue 一样把工作派给 Agent，支持异步、评论、定时、验收。

执行侧结合 Peers 的 Project / Channel / A2A / Scheduler 能力。

### 12.2 Task 状态

```text
Backlog -> In Progress -> Pending Review -> Done
                    |-> Blocked
                    |-> Failed
                    |-> Canceled
```

### 12.3 Task 字段

- title
- description
- assignee_agent_id
- requester
- schedule
- resources
- linked_thread_id
- linked_project_id
- status
- artifacts
- review_result

### 12.4 入口

- 从 Chat message 转 Task。
- 在 Tasks 页面新建。
- 从 Project issue 创建。
- 从 Channel 指令创建。
- 从 Agent Group 创建子任务。

### 12.5 深度评审

P0：

- Task 不是长聊天消息，必须有独立状态和验收。
- 定时任务不能只靠 prompt 约定，必须由 Scheduler 真正触发。
- Task 的 Agent 运行要复用 TurnRunner，不应另起一套执行链路。

---

## 13. Agent Group / A2A 产品方案

### 13.1 用户能力

用户可以：

- 创建一个 Agent Group。
- 选择成员 Agent。
- 选择协作模式：
  - Sequential
  - Parallel
  - Debate
  - Review
  - Supervisor
- 给 Group 一个任务。
- 查看每个 Agent 的状态、输出、阻塞点。
- 让某个 Agent 继续补充。
- 最终由 synthesis Agent 汇总。

### 13.2 工程实现

```text
GroupRun
  -> A2A Task(s)
  -> Child Thread(s)
  -> Artifact(s)
  -> Synthesis Turn
  -> Review
```

每个成员 Agent 必须有 Agent Card：

- name
- description
- skills
- input/output modes
- capabilities
- security
- endpoint

### 13.3 深度评审

P0：

- Agent Group 不能绕过 A2A policy。
- Group 成员的 memory scope 不能互相泄漏。
- 子 Agent 输出要作为 Artifact / Task result 回到父任务，不直接拼 prompt。

---

## 14. 安全、审批与治理

### 14.1 统一 Policy 顺序

```text
Actor permission
  -> Agent policy
  -> RuntimeProfile policy
  -> Surface policy
  -> Provider capability
  -> Tool/MCP/A2A policy
  -> Approval policy
```

deny 优先，approval 不能覆盖 deny。

### 14.2 高风险能力

| 能力 | 风险 | 默认策略 |
|------|------|----------|
| shell | 本机执行 | approval + workspace isolation |
| file_write | 数据破坏 | scoped path + diff preview |
| memory_remove | 长期状态删除 | 用户确认 |
| global_memory_write | 全局污染 | 高权限 |
| MCP write action | 外部系统副作用 | per tool risk |
| A2A remote call | 数据外发 | call policy + target trust |
| CLI provider | 黑盒执行 | env allowlist + workspace isolation |
| credential | 密钥泄漏 | credential_ref，不进 prompt |

### 14.3 CLI Bridge 安全基线

- bridge token 只访问 `/agent/tools/bridge/:name`。
- token 绑定：
  - run_id
  - turn_id
  - agent_id
  - thread_id
  - provider_run_id
  - allowed tools
  - expiry
- CLI 环境变量默认清空，只 allowlist。
- 不注入通用 Station auth。
- 日志脱敏 bridge token、API key、local path。
- workspace diff 进入 TurnTrace。

---

## 15. Growth / Diagnostics 产品方案

### 15.1 用户能力

- 查看 Agent 为什么失败。
- 查看某次运行用了哪些 memory、skills、tools、provider。
- 对 memory / skill / tool result 给反馈。
- 让 Agent 根据失败生成修复建议。
- 将修复建议变成 Skill、Memory、Test 或 Task。

### 15.2 Growth 事件

| 事件 | 来源 |
|------|------|
| memory.created | memory write |
| memory.feedback | 用户反馈或工具反馈 |
| skill.created | skill_manage |
| skill.edited | skill_manage |
| skill.used | skill_view / projection |
| tool.failed | ToolRegistry |
| provider.failed | AgentProvider |
| cli.degraded | CLI-wrapped capability |
| a2a.failed | A2A task |
| mcp.failed | MCP call |
| diagnosis.created | Growth analyzer |

### 15.3 深度评审

P0：

- Growth 不能只分析文本，需要 TurnTrace 结构化事件。
- CLI provider 要单独评分，不能按 Kernel-native 的 trace 完整度计算。
- Growth 建议不能自动改 Skill/Memory，必须走 review 或低风险自动化策略。

---

## 16. Proto / Station / Desktop 落地清单

### 16.1 Proto 包

| proto | 内容 |
|-------|------|
| `agent.proto` | Agent、AgentProfile、AgentStatus |
| `runtime.proto` | RuntimeProfile、Provider snapshot、TurnRunner state |
| `provider.proto` | AgentProvider、ModelBackend、capability、event、result |
| `thread.proto` | Thread、Topic、Message、Turn |
| `tool.proto` | ToolDescriptor、ToolCall、ToolPolicy、Approval |
| `memory.proto` | MemoryItem、MemoryCandidate、MemorySnapshot、feedback |
| `skill.proto` | SkillPackage、SkillRecord、SkillBinding、SkillProjection |
| `mcp.proto` | MCPServer、MCPToolProjection、connection state |
| `a2a.proto` | AgentCard、A2ATask、A2AEvent |
| `task.proto` | AgentTask、Schedule、Review |
| `knowledge.proto` | Resource、KnowledgeBase、KnowledgePack |
| `growth.proto` | TurnTrace、GrowthEvent、Diagnosis |
| `projection.proto` | Desktop runtime projections |

### 16.2 Station 模块

| 模块 | 职责 |
|------|------|
| `domain/agent` | Agent/Profile/Status |
| `domain/runtime` | TurnRunner/Run state |
| `domain/provider` | Kernel-native/CLI-wrapped/ModelBackend |
| `domain/thread` | Topic/Thread/Turn/Event |
| `domain/tool` | Registry/Policy/Approval |
| `domain/memory` | Recall/Write/Governance |
| `domain/skill` | Package/Disclosure/Projection |
| `domain/mcp` | Server/Tool projection/Connection |
| `domain/a2a` | Agent Card/Task/Resolver |
| `domain/task` | Task/Schedule/Review |
| `domain/knowledge` | Resource/RAG/Knowledge Pack |
| `domain/growth` | Trace/Diagnosis/Feedback |
| `domain/projection` | Desktop snapshot/delta |

### 16.3 Desktop Web Runtime

| Runtime slice | 提供页面 |
|---------------|----------|
| `agentRuntime.agents` | Agent Center |
| `agentRuntime.profile` | Agent Profile |
| `agentRuntime.conversation` | Chat |
| `agentRuntime.memory` | Memory Center / Drawer |
| `agentRuntime.skills` | Skill Store / Profile |
| `agentRuntime.tools` | Tool cards / Tool Center |
| `agentRuntime.mcp` | MCP management |
| `agentRuntime.a2a` | Agent Groups |
| `agentRuntime.tasks` | Task board |
| `agentRuntime.diagnostics` | Growth / Trace |

---

## 17. 分阶段建设

### Phase 1: Product Shell + Contracts

目标：

- 新 proto 契约。
- Agent Center / Profile / Conversation skeleton。
- Runtime Projection 合同。
- Provider / Memory / Skill / Tool 的最小资源模型。

验收：

- 能创建 Agent。
- 能创建 Topic。
- 能启动 Kernel-native mock turn。
- UI 状态全部来自 projection。

### Phase 2: Memory + Skill

目标：

- LobeHub-style Memory Center。
- Memory recall/write/snapshot。
- SkillPackage / `SKILL.md` / skill_view。
- Skill Store 初版。

验收：

- 用户能查看、编辑、删除 memory。
- Agent 能读取 skill index 和 skill detail。
- TurnTrace 记录 memory/skill 使用。

### Phase 3: Tool + MCP + Approval

目标：

- ToolRegistry。
- Approval card。
- MCP server CRUD。
- MCP tool projection。

验收：

- Tool call 全流程可见。
- MCP tool 可按 Agent 启用。
- 高风险工具需要审批。

### Phase 4: CLI-wrapped Provider

目标：

- Codex/Claude/Cursor/Trae 类 provider adapter。
- workspace projection。
- skill projection。
- restricted bridge。
- provider capability degradation UI。

验收：

- CLI provider 可跑一个 Turn。
- CLI 只能通过 bridge 调 Station tool。
- UI 明确显示 bounded/black-box 能力。

### Phase 5: A2A / Agent Group / Task

目标：

- A2A Agent Card / Task。
- Agent Group UI。
- Agent Task Board。
- Scheduler。

验收：

- 用户能创建顺序/并行 Agent Group。
- 子 Agent 结果可追踪。
- Task 可从 Chat message 创建并进入 Review。

### Phase 6: Growth / Marketplace / Hardening

目标：

- Growth diagnostics。
- Skill/Agent/MCP marketplace。
- Security hardening。
- Contract tests。

验收：

- 失败 Turn 可自动归因。
- Skill/Memory 建议可 review。
- Provider contract tests 覆盖 Kernel-native 与 CLI-wrapped。

---

## 18. 最终评审结论

### 18.1 必须坚持的方向

1. **产品体验学 LobeHub**：Agent 是持久队友，用户围绕 Agent、Topic、Memory、Skill、Task 工作。
2. **执行内核学 gdpa-agent-box**：CLI、Skill、Tool、MCP、A2A、Bridge 的工程边界要硬。
3. **架构实现用 Peers-Touch**：Proto-first、Station 真源、Desktop Runtime Projection、LobeUI。
4. **Kernel-native 是主线**：Peers 自己基于 Eino 控制 Agent loop。
5. **CLI-wrapped 是 provider，不是主架构**：选择性可控，必须真实声明能力降级。

### 18.2 不能做的事

1. 不能复制 gdpa-agent-box 的 UI/UX。
2. 不能把 LobeHub 的 Skill/MCP 产品心智直接当成 Peers 的后端模型。
3. 不能把 CLI provider 当成 Eino-native 一样可控。
4. 不能把 OpenAI/Claude/Gemini 这类 vendor API 当成 AgentProvider。
5. 不能让 Memory 成为不可见黑盒。
6. 不能让 Tool/MCP/A2A 绕过 Station policy。
7. 不能为了兼容旧数据牺牲目标架构；旧实现阻碍目标态时直接删除或替换。

### 18.3 能力强弱最终判断

| 能力 | 更强参考 | Peers-Touch 最终方案 |
|------|----------|----------------------|
| Memory | LobeHub | LobeHub white-box memory + Peers Station governance |
| Skill | gdpa-agent-box | gdpa `SKILL.md` package/projection/bridge + LobeHub Store UX |
| Desktop / UI / UX | LobeHub | LobeHub interaction pattern + Peers Desktop/LobeUI |
| Tool | gdpa-agent-box | gdpa ToolRegistry/policy/approval + LobeHub tool card UX |
| MCP | 后端 gdpa，UX LobeHub | gdpa dynamic projection + LobeHub install/config flow |
| A2A | gdpa-agent-box | gdpa A2A protocol + LobeHub Agent Group product |
| CLI Integration | gdpa-agent-box | CLI-wrapped AgentProvider + Restricted Bridge |
| Provider / Model | LobeHub UX + Peers/gdpa abstraction | AgentProvider / ModelBackend 两层 |
| Task / Schedule | LobeHub UX + gdpa scheduler | Agent Task Board + TurnRunner/Scheduler |
| Growth | Peers 自建 | TurnTrace + Growth diagnostics |

---

## 19. 外部参考

- [LobeHub Introduction](https://lobehub.com/docs/usage/start)
- [LobeHub Agent](https://lobehub.com/docs/usage/getting-started/agent)
- [LobeHub Memory](https://lobehub.com/docs/usage/getting-started/memory)
- [LobeHub Lobe AI](https://lobehub.com/docs/usage/getting-started/lobe-ai)
- [LobeHub Skill Management](https://lobehub.com/docs/usage/community/skill-management)
- [LobeHub Skills and Tools](https://lobehub.com/docs/usage/community/skills-and-tools)
- [LobeHub Custom MCP](https://lobehub.com/docs/usage/community/custom-mcp)
- [LobeHub Agent Groups](https://lobehub.com/docs/usage/agent/agent-team)
- [LobeHub Task](https://lobehub.com/docs/usage/getting-started/task)
- [LobeHub Pages](https://lobehub.com/docs/usage/getting-started/page)
- [LobeHub Model Providers](https://lobehub.com/docs/usage/providers)
- gdpa-agent-box reference: `docs/architecture/backend/10-tool.md`
- gdpa-agent-box reference: `docs/architecture/backend/12-a2a-protocol.md`
- gdpa-agent-box reference: `docs/architecture/backend/13-unified-agent-architecture.md`
