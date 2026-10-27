# Agent 可用性深度：整体实现设计

> **Status**: execution-active（2026-10-27）— V01–V14 已在分支 `feat/paos-active-cancellation`
> 实现并通过当前源码的 Station Go / Desktop vitest 门禁（HEAD `cd021fcfb`）；
> 冻结 Plan Version 为
> [execution-plans/20261025-agent-usability-depth/plan.md](../execution-plans/20261025-agent-usability-depth/plan.md)（AUD-20261025 / agent-usability-depth-20261025-v4），
> 逐条证据与 UNPROVEN 项见
> [outcome-comparison.md](../execution-plans/20261025-agent-usability-depth/outcome-comparison.md)。
> 未逐条裁决的 §10 问题采用 Plan「默认裁决」推荐值。
> **Created**: 2026-10-25
> **Owner**: Peers-Touch Agent Team
> **上游提案**: [modern-chat-agent/proposals/20261022-task-depth-product-amendment.md](../modern-chat-agent/proposals/20261022-task-depth-product-amendment.md)（TD-C01…TD-C06，draft）
> **UX 合同（已冻结的原型层）**:
> [engineering/prototypes/desktop-shell/settings-benchmark-disposition.md](../../../engineering/prototypes/desktop-shell/settings-benchmark-disposition.md)、
> [settings-capabilities-coverage.md](../../../engineering/prototypes/desktop-shell/settings-capabilities-coverage.md)、
> [agent-chat-coverage.md](../../../engineering/prototypes/desktop-shell/agent-chat-coverage.md)
> TD-J01…J05 原生 Journey 仍为 UNPROVEN（需 Owner 在 GTK/WebKit 环境 `make desktop` 验收），
> 源码门禁通过不替代 Journey 证据。

---

## 1. 目标与证据边界

### 1.1 北极星（待 Owner 确认）

一个普通用户在 Desktop 的 Agent 工作面，不需要 Harness、不需要手动配置底层
executor，就能交付一个**需要连续调用能力的真实任务**：运行中可补充要求、回答
提问、批准操作、检查过程、从中断恢复，并拿到可再次打开、可迭代的真实产物。
能力供给面（Providers / Skills / MCP / Knowledge / Memory / Channels /
Scheduled Tasks）的每一项配置都在同一条 Station 真相链上真实生效，而不是
"入口存在、配置保存、正文可读"的剧场。

本文把"整体 agent 能力达到参考客户端实例 #6 的可用性水平"翻译为
十四条可验证的垂直闭环（§5，通用闭环模型见 §4），并明确排除团队/企业级
功能（§6）。

### 1.2 证据基线（2026-10-25 核查）

- Peers 源码：rebase 后分支 `feat/paos-active-cancellation`，HEAD `f5fac8ce1`，
  工作树含已验证的 Settings 原型深化（未提交，四套门禁全绿）。
- 参考客户端：实例 #6（`self-build c5c0913`，`127.0.0.1:8436`），其
  Settings 全盘台账见 settings-benchmark-disposition.md；其任务执行深度
  取证见 TD 修订案 §2（基线 commit 46cc0784）。
- 本文事实来自对 Station Go、Desktop Rust、Desktop React、model/domain
  proto 的逐文件 Read 核查（file:line 证据见 §2）。未运行同模型对照实测；
  首字延迟、任务完成率无数值结论，不编造。

### 1.3 与既有架构的关系

- Modern Chat Agent（MCA）已接受的架构**全部保留为底座**：Station 拥有
  Agent/Conversation/Turn/Context/Provider 真相；Direct Model 与 stateful
  external runtime 双适配器（MCA-D29）；Capability authority 单一清单
  （manifest/binding/readiness/command-snapshot）；MCP 双执行 owner
  （MCA-D16A）；Turn admission FIFO 与幂等；ToolCall receipt 与 fenced
  execution（MCA-D19 系列）；不可变 Turn attribution。
- 本设计**不新建第二套内核、第二套 truth 或第二套编排**，只在既有 owner 上
  补齐断点：执行能力面、队列产品面、产物面、设置面真实化。
- 多 Agent 协作仍归 Atelier/Canvas，本轮只证明单 Agent 真正能完成工作。

---

## 2. 现状基线（三层事实，2026-10-25）

### 2.1 Station（Go，`apps/station/app/subserver/agent/`）——底座已深

已实现且非桩：Provider 真实 LLM 调用（OpenAI/Anthropic/Ollama/CLI，含
thinking mode、SSE、错误分类）；Agent 定义与包导入导出（GORM、版本/幂等
receipt、official signed envelope）；Turn SSE（事件落库后下发、心跳、回放）；
Turn admission DB FIFO（幂等键、容量、版本 CAS、取消）；取消/工具审批
（`tool_approval_required` + `/agent/tool/decision` + 过期）与 `ask_user`
ToolBatch；Memory（pgvector+tsvector 混合检索、事件归因、persona、快照、
reembed）；MCP Station-local 真实 JSON-RPC（stdio/http/sse、禁 shell 拼接、
SSRF 限制），CLIENT owner 经能力桥；Knowledge descriptor + 不可变内联内容
+ 查询时检索；Skill CRUD/版本/正则安全闸；external runtime session/epoch/
reset（环境变量门控）；follow-up、silent review、Evaluation worker；
Lark 渠道**端到端真实**（插件进程 + DurableBridge + automation 持久调度 +
投递状态机 + requester OAuth 工具）。

已确认断点（证据）：

1. **正常续跑与失败重试共用请求预算**：默认 `MaxAttempts: 3`
   （`service/runtime_admission_service.go:728`），每次真实 provider dispatch
   前 `reserveProviderAttempt` 计数，工具结果后的正常续跑同样消耗——需要
   第四次模型请求的依赖链被预算拒绝（TD-C01）。
2. **默认本机工具无写/执行闭环**：Station 注册的 desktop-local 工具仅
   file read / workspace list / 剪贴板读写下发占位；Rust 白名单只有
   `filesystem.read/list`、`clipboard.read/write`、`shell.execute`，
   且 shell 仅允许 `pwd`、`list_dir`
   （`src-tauri/src/application/tools/mod.rs:114` 与
   `desktop_executor_worker/local_executor.rs` 白名单）。无写文件、无编辑、
   无真实命令（TD-C02）。
3. **Skill 只是 manifest 文本**：`skill_view` 返回 content
   （`handler/skill_handler.go:73-76`），`model/domain/agent/skill.proto`
   无 resources/scripts/assets 字段（TD-C03）。
4. **队列无产品面**：Station DB FIFO、queued 事件、cancel API 都在；
   Desktop `TurnQueueTray.tsx` 已实现但生产工作台**未挂载**（仅自身定义与
   排除契约测试引用），composer 在 `isStreaming` 时禁止发送
   （`components/ChatInput.tsx:582-588`）（TD-C04）。
5. **过程/恢复链零件齐备未串验**：SSE `after_sequence` 回放、turn attempts、
   PREPARED 接管（MCA-D19C）、桌面 fenced receipt、unknown-side-effect
   恢复三动作已在 ToolCallCard 实现；断网/重启 Journey 未作为同一用户任务
   验证（TD-C05）。
6. **产物只有正文提取**：`store/chat.ts:817` 代码块提取；Workspace 文件是
   DB 行模拟，OSS presign service/handler 写好但**未在 agent.go 注册路由**；
   服务端无消息产物端点（TD-C06）。
7. **Skill 包无资源面**：agent package envelope 可携带 knowledge 资源，
   但 Skill 本体无版本化资源读取工具。
8. **Knowledge 是"RAG 形"**：默认 64 维 token-hash 词袋
   （`knowledge_retrieval_service.go:25,46`），查询时切块，无持久向量/ANN/
   文件摄取；`client_resource_ref` 不可检索。
9. **Memory 无 consolidation**：全 agent 目录无 `consolidat` 命中；
   CompressionService 只是会话窗口摘要。
10. **Scheduler 是内存 interval**：`scheduler_service.go` 的 jobs 为进程内
    切片、非 cron、重启丢失、默认不自启；真正持久的周期触发目前只存在于
    channel automation（`subserver/channel/service/automation.go`，
    DB `next_due_at` 扫描）。
11. **Bot↔Agent 零绑定**：`model/domain/bot/bot.proto` 无 agent 字段，
    bot subserver 无 agent 业务代码；bot 能以 actor 身份发言，入站消息
    不触发 turn。
12. **Growth 系列 11+ 端点使用临时 JSON 契约**（growth_handler TODO），
    proto-first 在该面未闭合。

### 2.2 Desktop Rust（`apps/desktop/src-tauri/`）

- 能力执行 worker 是**生产自启真实组件**：500ms pull、ed25519 签名租约、
  PREPARED 先落账后副作用、fencing token/sequence、receipt ledger
  Immediate 事务 CAS 保证 exactly-once、recovery proof、opaque ref 资源库。
- MCP client-owner 侧真实（stdio/http/sse、加密 SQLite 密文、SSRF/路径沙箱、
  8MB frame）；skills_market 真实（内置签名信封验签、ZIP 解析、GitHub raw
  源校验；包内容扫描为关键字启发式）。
- 假数据面（生产 Agent 数据路径之外）：`cron.rs` 进程内假 CRUD/假 run；
  TTS 空 wav；memory configuration 的 PG test 恒成功；`skills_get_builtin`
  合成桩。

### 2.3 Desktop React（`apps/desktop/src`）

- `services/desktop_api.ts` 是唯一 Tauri 网关（约 300+ 方法），生产路径
  **无 mock**（`mock-gateway.ts` 零引用死代码）。
- 工作台三栏（Agent / Topic / Conversation）真实：Turn SSE 投影、
  ToolCallCard 审批/澄清/恢复、slash 命令注册表（/help /tools /skills
  /clear）+ Station command-snapshot 动态 token、Provider 错误分类
  （超时/限流/模型不可用/队列满/lease 过期等均有专门映射与测试）。
- 设置面真实度：Providers/CliProvider（双适配器、check、discover）、MCP
  （编辑/test/JSON 批量导入）、Skills+Discover（签名目录安装）、Memory
  browse/search/persona/events、Lark channels（provisioning/routes/
  automations/health/activity，深于原型）、Bots、My Files、Cron **表单**
  （抽屉达到 CRN 合同但接 Rust 假 cron）。
- 缺口：**Knowledge 设置面不存在**（Station descriptor API 无 UI 消费方）；
  Memory configuration 假面；TurnQueueTray/AgentGrowthTab/
  AgentConnectorsPanel 建成未挂；Settings 内无 Station 管理节（仅登录引导）；
  产物面板为本地代码块提取。

### 2.4 原型（`packages/prototypes/desktop/shell`）

Settings 深化已冻结 UX 合同并 60 交互 / 11 闭环 / 四视口几何全绿：
统一 roster 身份（agentRoster）、catalog 单一 owner（capabilityStore）、
Skills 包网格/五来源/复制编辑、MCP Form/JSON 双态与诚实 Test、Knowledge
卡片网格/条目树/建包（明示不投递）、Memory 诚实 retrieval 卡、Cron 右侧
抽屉与本地 NL 解析、Lark managed 建连/Event triggers/Topics 只读投影、
Bots 绑定名册 Agent。**原型只承担合同，不承担真实结果**；真实化按本文落地。

---

## 3. 设计原则

1. **闭环优先于入口**：每个能力必须满足同一七步链
   配置（Station 真相）→ 就绪广告 → Agent 绑定 → Turn 中被消费 →
   活动/结果可见 → 证据与归因持久 → 中断可恢复。链条任一步缺失，
   该能力在 IA 中不得出现"可用"态（显式 Unavailable/Unverified 除外）。
2. **既有 owner 优先，禁止第二真相**：Station 管配置/调度/产物元数据；
   Desktop Rust 是 CLIENT 执行 owner 与传输；React 只做投影。新增存储一律
   先 proto。本地假实现到期按原子 cutover 删除，不双写、不留 flag。
3. **诚实优于完整**：没有权威的状态显示 Unknown/Unavailable，绝不合成
   成功、遥测与日志。原型的诚实处置（reject 假 Stats/Diagnostics/Test）
   在真实端因权威存在而**改变裁决**：Station 有真实投递/事件数据的面
   （Lark diagnostics、provider check、MCP refresh），展示真实数据。
4. **能力随执行位置降级**：CLIENT-owner 工具/MCP 在无在线桌面执行器时
   从 command snapshot 与首次任务说明中移除或显式标注阻塞；普通文本对话
   永不被阻断（MCA 既定原则）。
5. **最小授权默认**：读类自动；写/命令类进入任务默认经审批，作用域限制在
   该 Agent 的 workspace 根；拒绝出根、网络、任意 shell。
6. **Proto-first**：调度任务、Turn 产物、Skill 资源、Bot 绑定均先改
   `model/domain/agent/*.proto`（bot 绑定在 bot/channel 域），生成走
   `./model/build.sh`，禁止手改生成文件。
7. **企业/团队功能不搭车**：§6 排除项不得以"顺手对齐"进入实施。

---

## 4. 通用架构：一条能力链，两个执行 owner

```
┌─────────────────────────── Desktop React ───────────────────────────┐
│ Workbench(Chat)  Settings(能力供给)  QueueTray  ArtifactPanel        │
│        │ desktop_api（唯一 Tauri 网关，无 mock）                     │
├─────────────────────────── Desktop Rust ────────────────────────────┤
│ station transport(签名/HTTP/SSE)  │ CLIENT executor owner           │
│   lease/pull/receipt fenced worker│ filesystem / clipboard / shell  │
│   client MCP client               │ mcp.tool.* / connector.resource │
├────────────────────────────── Station ──────────────────────────────┤
│ Agent/Conversation/Turn 真相 · Admission FIFO · Provider dispatch    │
│ Capability authority(manifest/binding/readiness/snapshot)            │
│ STATION executor owner: memory / knowledge / session_search /        │
│   skill_view / ask_user / MCP-station / lark requester               │
│ Scheduler(durable) · TurnArtifact metadata · Lark bridge · Bot 绑定  │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.1 七步闭环（每能力的验收口径）

1. **配置**：proto 消息 + Station 持久化（密文分离，如 MCP secrets）。
2. **就绪广告**：readiness/manifest 真实探测（进程握手、模型 discover、
   租约在线），失败有原因码。
3. **绑定**：仅 enabled 且 readiness 允许的实体可进 Agent Profile
   （绑定真相 `AgentCapabilityBinding`）。
4. **消费**：Turn 的 prompt assembly / tool registry 实际读到该能力；
   command snapshot 版本化，历史 Turn 不被当前配置改写。
5. **可见**：活动经统一 SSE 事件词表落到 ToolCallCard / QueueTray /
   ArtifactPanel，不合成 provider 流。
6. **证据**：receipt/attribution/artifact metadata 落库，不可变。
7. **恢复**：取消、断流、重启、未知副作用各有显式状态与动作，不自动重放。

### 4.2 执行 owner 与审批分级

| 级别 | 工具 | 默认策略 | 执行位置 |
|---|---|---|---|
| L0 只读 | filesystem.read/list、clipboard.read、session_search、memory_search、skill_view/resource_read、web_fetch（新增，Station 出网）、MCP 只读工具（按 manifest 标注） | 自动 | STATION 或 CLIENT |
| L1 受限写 | filesystem.write/edit（workspace 根内）、clipboard.write、memory_add/replace/remove（既有）、skill_manage（既有）、todo_write/update（新增，任务清单） | 逐次审批（文件/剪贴板类） | CLIENT（文件类）/STATION（记忆/todo 类） |
| L2 命令 | shell.execute 受控 allowlist（只读类如 find/grep/rg/cat 可降 L0；构建类 make/pnpm/go/cargo、git 只读子命令为 L2；具体清单 §10 Q2 确认） | 逐次审批，参数回显 | CLIENT |
| L3 拒绝 | 出根路径、任意外壳、未声明的直连网络工具、未声明 MCP 工具 | 不广告 | — |

风险分级由 Station 在 tool call 产出时计算（ToolCall 上已有
`risk_class`/`approval_policy` 快照字段），Rust 侧 fail-closed 再校验；
两边拒绝面一致。MCP 工具按 server manifest 的只读/写标注映射 L0/L1，
标注缺失按 L1。`web_fetch` 的出网限制复用 MCP HTTP transport 的
SSRF/私网拦截规则，不新开网络策略口子。

### 4.3 任务工作目录

复用既有 per-agent 本地 workspace（`agent_workspace` 清理逻辑已按
agent_id 扫描 workspace/tasks 目录）：`filesystem.*` 默认根 =
该 Agent 的 workspace 目录；`allowed_roots` 需显式授权（沿用现有
canonicalize 沙箱）。产物、脚本、素材都在该根内闭环；出根即 L3。

---

## 5. 垂直闭环设计（14 条）

> 每条给：闭环叙述 / 当前断点 / 改动面（proto·Station·Rust·React）/
> 关键 Journey。不写代码；冻结 Plan 时再拆任务。
>
> 编号说明：**V01–V06 与 TD 修订案的 TD-C01–TD-C06 一一对应**
> （V01 预算/连续执行、V02 能力与环境、V03 完整 Skill、V04 运行中交互、
> V05 过程与恢复、V06 交付与验证）；**V07–V14 是能力供给面垂直**
> （Knowledge/Memory/MCP/Providers/Cron/Lark/Bot/身份一致性），
> 对应 Settings 台账真实化与渠道闭环。

### 5.1 V01 预算真相与连续执行

- **闭环**：一次任务中"正常续跑（tool-result→model）"、"瞬时失败重试"、
  "辅助模型调用（follow-up/review/compression）"使用**独立计数器**；
  长依赖链不因 3 次 dispatch 上限被误杀，真正的失控循环仍被 step/循环
  检测兜住。
- **断点**：§2.1-1。
- **改动**：
  - Station：turn_attempt 持久化上区分 `provider_continuation_count`、
    `provider_retry_count`、`auxiliary_call_count`；`reserveProviderAttempt`
    拆为 reserve*Continue / reserve*Retry（预算来自 runtime profile：
    continuation 沿用 max_agent_steps 量级，retry 保持 3）；预算耗尽错误
    分类可区分（既有 TOOL_LOOP_BUDGET_EXHAUSTED 之外新增 continuation
    exhausted 码）；续跑预算在压缩/辅助调用后不被意外吞掉。
  - 无 proto 结构性变化（计数进入既有 turn trace/metadata）。
  - React：新错误码进入既有错误分类映射（desktop_api errorMappings），
    用户看到"任务步数预算用尽"的可懂文案而非通用失败。
- **Journey**：构造需 ≥6 次正常续轮的只读依赖链（TD-J01 同口径），
  Go 级与真实 Journey 均通过；瞬时故障重试 3 次后如实失败。

### 5.2 V02 本地执行能力面（写/编辑/受控命令）

- **闭环**：首次进入任务，系统提示与 `/tools` 明确列出环境能力；
  模型对 workspace 内文件可发起 read/write/edit，对受控命令发起执行；
  每张工具卡显示权威、作用域、风险、目标、参数；用户批准后桌面 executor
  真实执行并回传含文件变更摘要（path/before-after hash/大小）的 receipt；
  拒绝/过期/执行器离线有显式状态，绝不静默成功。
- **断点**：§2.1-2。
- **改动**：
  - proto：tool 契约补 `filesystem.write`、`filesystem.edit`（参数 schema、
    路径约束、内容/补丁上限），`shell.execute` 的 operation 枚举扩为
    allowlist 驱动（清单 Station 下发，Rust 拒绝执行清单外命令）。
  - Station：tool registry 注册新工具为 CLIENT owner（沿用现有
    pull/receipt 通道与 tool name→capability id 映射）；新增两个
    STATION-owner 内置工具：`web_fetch`（URL 抓取，复用 MCP HTTP transport
    的 SSRF/私网拦截）与 `todo_write/update`（Agent 维护的任务清单，
    状态作为 progress 事件下发并随 Turn 持久，供长任务自检）；governance
    风险分级与审批模板；snapshot/广告随执行器租约在线状态；prompt assembly
    的环境段（可用能力 + workspace 路径 + 阻塞条件）。
  - Rust：local_executor 白名单加入两项文件工具与 shell allowlist；
    路径沙箱复用 resolve_guarded_path；写操作返回变更摘要（path、
    before/after hash、size）；fenced executor 的 64KB 参数上限对文件
    内容是否够用做评估（超限走分块/资源协议，列入 Plan 任务）。
  - React：ToolCallCard 审批流已具备（approve/deny/risk/receipt/恢复
    三动作），补 write/edit/命令三种参数渲染（diff 预览、命令+工作目录）、
    web_fetch 结果卡与 todo 进度卡。
- **审批语义（无现成持久面，不虚构）**：现状只有逐次 ToolCall 决策
  （`tool_approval_required` → `/agent/tool/decision`；ToolCall 记录上
  仅有本次调用的 `approval_policy` 快照），不存在"记住自动批准"的
  Agent 级持久偏好。默认逐次审批；若要"本次会话对该 Agent 的同类 L1 操作
  自动批准"，是**新增小合同**（conversation-scope policy，proto 加字段、
  Station 记忆、Turn 结束失效），列入 Plan 任务且默认关闭，不做跨会话
  静默放行。
- **Journey**：TD-J02（读材料→改文件→真实检查→读失败→修正→再验证，
  无关文件不动）；另含 web_fetch 取证与 todo 清单驱动的长任务旅程。
- **不做**：进程 status/kill、PDF/二进制解析（defer，见 §6）；
  任意 shell 永不开放。

### 5.3 V03 完整 Skill 包（resources / references / scripts）

- **闭环**：Skill 是固定版本的内容+资源包。资源在**执行位置**解析：
  STATION-owner 包的 references/templates/assets（文本类）由模型经新增
  `skill_resource_read` 工具按相对路径读取（钉在该 Turn 绑定的版本）；
  含脚本、需要在命令中执行的包为 CLIENT-owner，安装时把资源物化到应用
  数据下**只读受管包目录**（非用户 workspace），V02 的 shell allowlist
  可从该只读目录调用脚本，输出仍是 workspace 内的普通产物；不在 Station
  侧执行任何脚本，也不引入第二种执行原语。删除/停用当前 binding 不改写
  历史 Turn 归因（既有 attribution 原则）。
- **断点**：§2.1-3、§2.1-7。
- **改动**：
  - proto：`SkillManifest`/版本存储增加 resources（path/hash/size/kind/
    execution_owner），资源正文走 content-addressed blob（复用 agent
    package/知识内容的不可变内容模式）；包安装（official envelope / ZIP）
    携带资源；CLIENT-owner 包的本地资源读取经能力桥（新增
    `skill.resource.read` capability op，路径钉在受管包目录，fail-closed
    防穿越）。
  - Station：skill_service 落资源与版本；skills_guard 对资源文本同样
    扫描（脚本可执行性不承诺为安全检测，执行权在 V02 allowlist+审批）。
  - Rust：skills_market ZIP 安装已解析多文件，扩展为资源随包物化到受管
    只读目录并随版本更新/清理；本地资源读取走资源库 opaque_ref 同款沙箱。
  - React：SkillsTab/原型 Skills 抽屉的"包内文件树/正文查看"合同真实化；
    skill 卡显示版本、资源数与执行 owner；Agent Profile 绑定维持单一
    catalog。
- **Journey**：TD-J01 中"按需读取完整 Skill 资源→按说明连续完成任务"。
- **边界**：二进制资产与任意脚本解释器不承诺；Git 本地 reference 是否
  保留按 Q5 一并裁决；越界需求重新立项。

### 5.4 V04 持久队列与运行中交互

- **闭环**：运行中发送不被禁止：消息带幂等键进入 admission（队列以
  Conversation 为界，行锁保证同会话 FIFO，不跨 Topic 插队）；收到
  STARTED/QUEUED 确认后草稿才释放；QueueTray 显示**当前会话**排队项
  （位置、状态、绑定能力快照）；排队项可取消（pending）、可"取消并
  取回编辑"（服务端无排队编辑原语，语义＝cancel + 本地恢复草稿，新幂等
  键重发）；FIFO 消费，当前 Turn 完成后队列第一项由既有 queue worker
  自动开始；执行器/能力不支持时入队前或入队后给明确原因。
- **断点**：§2.1-4。
- **改动**：
  - Station：队列 API/事件齐备，仅补两处产品语义：①QUEUED 确认帧即
    draught 消费权威（核对现有 X-Agent-Turn-ID 头与 queued 事件顺序）；
    ②排队项被 admission preflight 取消时事件含原因。500ms 轮询不换
    （可接受；如 Journey 暴露延迟再评估 event bus 唤醒）。
  - React：挂载 TurnQueueTray（撤销契约测试中的排除断言，改挂新契约）；
    ChatInput 在 streaming 时允许发送→走队列；queued 消息气泡与 tray
    双向定位；取消/取回编辑；断线重连后以 queue list + after_sequence
    对账。附件草稿随排队项保留（admission 已存 payload hash）。
  - **实时引导（live steering）不做假**：Direct Model 只排队；external
    runtime 仅在 adapter 明确广告 input 能力且确认会话接收时才允许
    "送入当前会话"（依赖 D29 扩展，列 defer，不支持时显示排队语义）。
- **Journey**：TD-J03（运行中带附件补充、核对顺序、修改/取消排队项）。

### 5.5 V05 同一任务的过程与恢复

- **闭环**：命令、工具结果、文件变更、等待提问、失败与重试在同一
  Topic/Turn 链上以统一活动卡呈现，默认折叠早期活动；断网→重连回放、
  切页→SSE catchup、Desktop 重启→以 Station 真相重建；副作用未知的
  PREPARED 步骤显示"不可自动重放"，提供既有三动作（continue without /
  reconnect executor / request again）；Station 重启区分可恢复检查点与
  未知状态，不自动新建会话、不重复用户消息。
- **断点**：§2.1-5。
- **改动**：以串验和补缺为主，不新建内核：
  - React：chat store 的恢复路径（agentTurnRecovery、streamReplay、
    lease expired/queue full 错误映射）跑全四个恢复 Journey；文件变更
    活动卡依赖 V02 receipt 的变更摘要；V04 队列纳入重启对账。
  - Station：核对 PREPARED 接管（D19C）在 turn queue worker 下的
    实际行为并补 Journey 证据。
- **Journey**：TD-J04（回答 AskUser/批准后续跑；短断网、切页、重启；
  Station 重启检查点语义）。

### 5.6 V06 真实文件产物

- **闭环**：模型用 V02 工具在 workspace 生成的每个文件成为 Turn 产物：
  产物面板列出真实文件（名称/大小/hash/由哪个工具/哪个 Turn）；
  在持有该文件的设备上可本机打开、在系统文件管理器中定位；后续 Turn
  可引用同一文件继续修改；需要跨设备保留时上传 Station（复用 OSS 既有
  上传面），上传后产物标注 Station 副本并可在任意设备下载；其他设备查看
  仅本机持有的产物时显示"在原设备打开或先上传"，不提供假下载；
  文本建议/模型终止/进程退出不充当产物。
- **断点**：§2.1-6。
- **改动**：
  - proto：新增 `TurnArtifact`（turn/agent/tool_call、kind=file、
    name/size/hash、locator=client_local_ref|station_object_ref、
    created_at）与 list/get 契约。
  - Station：新表 `agent_turn_artifacts`（元数据；blob 复用 OSS subserver
    既有对象能力，不复活 workspace DB 模拟文件；未注册的 workspace OSS
    presign 死代码经评估后删除或正式接线，二选一，不留半成品）；
    receipt 入库时从 CLIENT receipt 的 artifacts 段提取元数据。
  - Rust：fenced receipt 增加产物描述（写/编辑工具执行后登记，opaque_ref
    映射本机文件）；按需上传走既有 OSS 客户端；产物预览读取经资源库
    授权。
  - React：ArtifactPanel 从"代码块提取"切换为"Station 产物列表 + 本地
    locator 打开/上传"；本地代码块提取降级为消息内展示，不再冒充实物。
- **Journey**：TD-J05（生成真实报告文件→打开核对→上传→再次打开迭代；
  删除 binding 不改写历史产物来源）。

### 5.7 V07 Knowledge 设置面与检索诚实化

- **闭环**：Settings → AI → Knowledge 可查看 Station descriptor 清单
  （来源、绑定状态、内容修订、可检索状态）；新建 = 真实写入 Station
  （inline station_content ≤48KB 的不可变修订，API 已存在）；内置/包
  携带知识可阅读条目树与正文；retrieval 状态（embedding provider、
  是否建索引）真实显示；知识经授权后真实进入 prompt assembly
  （`<knowledge_context>` 已接线）。
- **断点**：React 无 UI；检索为 hash 词袋（§2.1-8）。
- **改动**：
  - React：新增 Knowledge settings module（注册进 modules/registry），
    形态按原型 KNO-B01/B03/B05 合同（卡片网格、详情条目树、建包表单）；
    **Git URL 在真实端不做"记录意图"假动作**——知识摄取的真实路径是
    agent package envelope / ZIP（已有签名安装链），Git 自动摄取列入
    §10 Q5；不 clone 就不放该字段。
  - Station（按 Q5 裁决二选一）：
    - 方案 A（本轮）：保持 inline 内容 + 查询时切块，UI 如实显示
      "local hash retrieval"；
    - 方案 B（升级）：复用 memory 的 embedding provider 与 pgvector
      设施，知识内容持久向量化 + FTS（新表/索引），删除 64 维 hash
      fallback 或仅作为无 embedding 时的显式降级；文件摄取仍限包通道。
- **Journey**：建知识→绑定 Agent→提问命中并显示知识归因→tombstone
  后不再检索。

### 5.8 V08 Memory 配置诚实化与 consolidation 边界

- **闭环**：Memory browse/search/persona/events 已真实；配置节显示
  Station 真实 `/memory/embedding-status`、pgvector 健康与统计（stats
  端点已存在），DSN Test 假成功删除；无 consolidation 后端则该区域
  不出现（或以 Unavailable 文案说明，不给开关）。
- **改动**：React 替换 MemorySettingsTab 假读写；Rust 假 PG test 命令
  改为透传 Station 状态或删除；consolidation 维持 defer（reopening：
  Station 立项跨条记忆合并/周期提炼）。Browse 行动作接真实
  update/delete API（Station 端点已存在，MCA-B09 要求可编辑/可删除）：
  删除二次确认、编辑走结构化表单并保留来源/归因事件；原型"只读 Browse"
  是原型层边界，真实端不受此限。
- **Journey**：配置状态与 Station 实际一致；断 Station 时显示不可用
  而非绿灯；编辑/删除一条记忆后检索结果与事件流如实变化。

### 5.9 V09 MCP 收口

- **闭环已基本真实**（Station 配置真相、STATION 真执行、CLIENT 本地
  真执行、revision、密文分离、refresh probe、readiness 绑定门槛）。
- **改动**：仅补缺：①React MCPTab 编辑保存后的"工具重发现"语义对齐
  revision bump（原型合同：编辑重置已发现工具）；②Form/JSON 双态在
  真实端齐平（JSON 批量导入已有）；③零工具/探测失败 server 不可绑定
  以 readiness 强制（核对绑定路径）；④一条 STATION owner、一条
  CLIENT owner 的端到端真实 Journey 进正式验收（当前多为单测层）。
- **不做**：Connected/Errors 百分比假遥测（台账 MCP-B03 reject 维持，
  除非用 Station 真实活动数据表达）。

### 5.10 V10 Providers / Models

- **闭环已真实**：双适配器（Direct/CLI）、CRUD、credential vault、
  `/provider/check`、model discover、thinking mode、每 Topic 模型选择。
- **改动**：①默认 provider/默认模型的显式星标与"设为默认"落到 Station
  runtime config（`provider_runtime_config` 已有 default_model 字段，
  核对 default provider 语义缺口）；②模型状态灯由真实 check/discover
  结果驱动（原型的恒 Unverified 在真实端变成真实状态 + 未检查态）；
  ③清理 CliProviderDetail 中任何不产生落库效果的字段。
- **边界**：PRV-B03（Global Prompt/全局 Args/Env）reject 维持——
  系统提示词在 Agent Profile；CLI profile 的 args/env 是该运行时的
  真实配置（真实端保留，与原型 reject 不矛盾：不同层）。

### 5.11 V11 Scheduled Tasks 持久调度

- **闭环**：在 Settings 用原型 CRN 抽屉创建 agent 定时任务（cron/
  interval/once、时区、model/effort/timeout override、一次性 delete
  after run、暂停、搜索）；任务持久在 Station；worker 到期经同一
  Turn admission 以任务身份发起 Turn（不绕过预算/能力策略）；
  run history 真实可查；重启不丢；Desktop 离线时任务仍可跑
  （STATION owner 能力范围内），需要 CLIENT 工具的任务如实标注执行器
  离线并保留失败/待重试记录。可选投递：把结果送到已绑定 Lark channel
  （复用 delivery 状态机）。
- **断点**：§2.1-10；Rust 假 cron；React 接假面。
- **改动**：
  - proto：`ScheduledJob`（schedule kind/expression/tz、agent 绑定、
    runtime override、delivery 可选、delete_after_run、next_due_at）、
    `ScheduledJobRun` 与 CRUD/list-runs 契约。
  - Station：新表 + sweep worker（启动注册进 agent.go worker 组，
    模式参照 channel automation 的 `next_due_at` 幂等扫描）；执行走
    turn service（带 scheduled_by 归因）；冻结决策：既有内存
    scheduler_service 保留给系统 silent_review/dogfood 且不进用户面，
    用户可见调度唯一来源是持久 ScheduledJob（见 AUD-20261025 Plan
    Hard Cut）。
  - **会话模型**：每个 ScheduledJob 创建时绑定一个专属 Conversation
    （job 与 conversation 一一对应），每次触发在其中追加 Turn；run 记录
    关联 turn_id，history 可直接跳到该次 Turn 与产物；job 删除不删
    历史会话（遵循不可变证据原则）。
  - Rust：cron 命令从本地 OnceLock 假仓切到 Station 透传（原子 cutover，
    删除假 run/runs 合成）。
  - React：CronJobsSettings/CronJobDrawer 改接真实 API；自然语言解析
    移植原型本地规则解析器（不引 cron 库）；移除 shell/workflow 两种
    执行类型（无执行权威；shell 类未来经"agent+工具"表达，不造假按钮）；
    Lark 投递为可选绑定（依赖渠道 delivery，本期末完成则隐藏不做假）。
- **Journey**：创建→触发→history→暂停→删除；一次性任务触发后退役；
  override 生效；重启存活；投递绑定的结果出现在目标渠道。

### 5.12 V12 Lark 渠道收口

- **闭环已端到端真实**（managed 建连、绑定 Agent、入站→turn→投递状态机、
  requester OAuth、retry）。
- **改动**：以真实权威重估原型 reject 项：
  - Event Triggers 真实化：UI 映射 `/channel/automation`（event/schedule
    两类、agent 绑定、回复方式、enabled），Last run/运行记录从
    `/channel/event-list`、delivery retry 真实读取——原型中"恒 Never"
    的诚实降级在真实端换成真实数据；
  - Diagnostics/Stats：投递状态/计数有 Station 权威则展示真实值
    （台账 CHN-B09 在真实端改判 adopt-with-authority），无权威的聚合
    仍不做；
  - 密钥护栏维持：app secret 只发 Station 加密落账，不回客户端
    （既有隐私决策）；
  - Channel Topics 只读投影从 Station conversation 真相读取（原型用
    本地快照）。
- **Journey**：managed 建连→事件规则→真实消息入站→绑定 Agent 回复→
  投递成功/失败可查。

### 5.13 V13 Bot ↔ Agent 绑定

- **闭环**：Bots 设置把 bot 身份绑定到名册中的一个 Station Agent；
  带 publishing grant 的入站消息进入既有 inbox 后，按绑定经与
  Lark 相同的 turn projection（复用 ChannelTurnExecutor 模式）发起
  Turn，回复以 bot actor 身份发布；未绑定维持纯收件（当前行为）。
- **断点**：§2.1-11。
- **改动**：
  - proto：bot 域新增 `BotAgentBinding`（bot_id→agent_id + 策略 +
    版本字段），bot subserver 持有 `bot_agent_bindings` 持久表（冻结
    决策见 AUD-20261025 Plan Hard Cut；不新建独立 binding 子系统）。
  - Station：conversation publishing 入口在落消息后查绑定并投影 turn；
    跨 subserver 调用复用 channel 已验证的注入方式；删除绑定不影响
    历史消息归因。
  - React：BotsSettings 增 Agent 选择（真实 roster API），状态/秘密
    轮换维持。
- **Journey**：绑定→外部 publishing 消息→真实 Agent 回复以 bot 发出；
  解绑后停止自动回复。

### 5.14 V14 Agent 身份、Profile 与命令面一致性

- **闭环**：全客户端只有一个 Agent 名册（Station agents 真相）；
  Cron/Bots/Lark 三处绑定选择器同源；Agent Profile 的 Extensions
  （Skills/MCP）唯一来自 capability binding snapshot；slash `/tools`
  `/skills` 读版本化 snapshot（已实现）；stale snapshot 禁用能力动作
  但不阻断普通对话（已实现）；原型 agentRoster 的本地身份概念在真实端
  不另建——直接消费 Station agents API。
- **改动**：核对真实端三处绑定确为同一 API（渠道自动化已是）；
  AgentGrowthTab 在 V11 调度器 cutover 后挂载（其调度器启停控件改接
  持久调度 API，记忆/技能/trust 投影本就是真实 API；未接好前继续不挂载，
  避免出现第二调度控制面）；命令面板维持静态帮助 + 动态 token。

---

## 6. 明确排除（团队/企业级与本期不做）

| 项 | 处置 | reopening / 理由 |
|---|---|---|
| Evaluation Lab 扩展（benchmark/dataset/run 实验面） | **defer（保留已建代码，不投投入、不进主工作面）** | MCA V2 曾列 required；Owner 本轮按"非团队级"排除则正式降级，见 Q4 |
| 商业市场 / Agent Hub / 社区共享 / Curator / 一键安装他人 Agent | defer | 信任与联邦治理需独立产品设计；个人 signed catalog（Discover 已建）保留 |
| 参考客户端 Cloud / 远程设备 / Remote Access 入口 | reject placement | 对应物是 Network→Your Station/Federation；云侧执行是 Station 未来合同 |
| Workflow templates / Dynamic workflow | defer | 无 workflow 运行时与消费构造 |
| Plugins / Hooks CRUD | defer | 无执行消费面（2026-10-24 已裁决） |
| 进程 status/kill、PDF/二进制文件读取 | defer | 需要进程托管与解析器；filesystem.read 仅文本 |
| 多 Agent team / canvas 协作扩展 | reject（本轮） | 归 Atelier；单 Agent 可用性是前置 |
| Sidecar task models / LLMBox / 租户配置 / PAT/服务账号 | reject | 竞品内部基础设施 |
| 假 Stats / 假 Diagnostics / 假可用率百分比 | reject | 无权威不展示；有 Station 权威的数据（渠道、check）除外 |
| Global Prompt/Args/Env 全局注入 | reject（放置） | Prompt 在 Agent Profile；CLI profile 自身配置合法保留 |
| 图片/视频生成、服务端音频/TTS 投入 | reject/defer | 非本产品能力；TTS 假桩按 Q8 处理 |
| Theme Hub、Mobile UI 交付 | defer | 多主题 token 体系；Mobile 仅保持合同兼容 |
| 服务端 consolidation、Knowledge/Skill Git 自动摄取与本地引用 | defer | 见 Q5/Q8 |
| Workspace DB 模拟文件 / 未注册 OSS presign 半成品 | 二选一收口 | 正式接线或删除，禁止长期并存 |
| Growth 临时 JSON 契约 | 收敛 | 被 V11/V14 触及时补 proto（proto-first 还债，不新借） |

---

## 7. 阶段 DAG（依赖顺序，非时间表）

```
P0 V01 预算真相 (Station)
   │
   ├──────────────► P3 V04 队列产品面 (React 为主，Station 语义微调)
   │
   ├─► P1 V02 写/命令执行面 (proto→Station→Rust→React)
   │       │
   │       ├─► P2 V06 真实产物 (proto/Station/Rust/React)
   │       ├─► P5 V03 Skill 资源包
   │       └─► P4 V05 恢复串验（依赖 V02/V04/V06 的活动类型）
   │
   ├─► P6 V07 Knowledge 设置面（可并行；检索升级按 Q5）
   ├─► P7 V11 持久 Cron（proto→Station→Rust cutover→React；可并行）
   ├─► P8 V13 Bot 绑定（proto→Station→React；可并行）
   ├─► P9 V12 Lark 收口 / V08 Memory 诚实化 / V09 MCP 收口 / V10 Provider
   │      / V14 身份一致性与 AgentGrowth 挂载（现成能力补面，可并行）
   │
   └─► P10 整体验收与收口
          · TD-J01…J05 真实 Native Journey（make desktop，非 Harness 注入）
          · V07…V14 各自命名 Journey + 证据
          · 既有能力回归 Journey：Topic 搜索/重命名/归档（Station 路由
            与 React store 已存在，仅验证不新建）、follow-up、clarification
          · 假面清理（本地 cron 已在 P7 删除；mock-gateway 死代码删除；
            Memory 假面 P9；TTS 按 Q8；AgentGrowthTab 随 V11 cutover 挂载）
          · 原型合同与本文双向同步、coverage 台账更新、i18n 全量
```

排序理由：P0 解开所有长任务的系统性误杀；P1 是"真正能干活"的分水岭，
产物/技能/恢复都依赖新活动类型；队列（P3）独立且直接修复"运行中不能
说话"的最大体感差距，尽早交付；设置面真实化（P6–P9）彼此独立可并行；
P10 做整体故事验收，避免单模块绿但整体不闭环（原型阶段已犯过一次，
见 settings plan §6.3）。

每阶段统一出口：proto 生成 + `go test ./...`（焦点包）+
`pnpm run check/test/build`（desktop）+ Rust check + 该阶段命名 Journey
的 FUNCTIONAL_PASS 与正式证据；证据绑定当前 commit/source digest。

---

## 8. 横切决策

1. **IA（真实 Settings）**：沿用真实端 module registry，不照搬原型五组
   皮肤；内容对齐冻结合同：AI 组补 Knowledge 节；Cron 内容留在工具/高级
   组原位做深；Memory 配置节诚实化；不新增一级入口。Settings 内是否补
   "Your Station 管理节"列 Q9。
2. **i18n**：所有新文案走 `packages/locales/`，错误用 locale key。
3. **安全**：密钥只 Station 加密落账且不回客户端（MCP/渠道既有模式）；
   写/命令默认审批 + workspace 沙箱；MCP SSRF/路径/frame 限制既有不回退；
   签名目录信任链不降级（启发式内容扫描不得宣称安全检测）。
4. **观测**：工具/调度/产物失败走领域 logger 带上下文，禁 debug 打印、
   禁记录密钥/PII。
5. **证据策略**：普通用户路径（无 Harness 额外工具）完成 TD-Journey；
   Station 执行位置与产物回读是正式证据的一部分；原型门禁继续作为
   UX 回归，不充当功能证据。
6. **原型关系**：本轮 UX 新分歧先改原型合同与 coverage 台账，再落真实端；
   原型不加真实后端（既有边界不变）。
7. **不提交**：按既定工作方式，Owner 在 `make desktop` 亲自验收前不打 MR；
   分支工作树保持干净变更集。

---

## 9. 风险与缓解

- **预算修复改变 provider 成本行为**：续跑上限提高可能增加消耗——预算
  仍有 max_agent_steps/tool_calls/五分钟墙与循环检测；Journey 核对成本。
- **写工具带来真实破坏面**：workspace 根 + 审批 + fenced exactly-once +
  before/after hash；默认目录在应用数据区，不触用户系统目录。
- **CLIENT owner 离线导致任务不可用**：能力广告随租约降级，首次任务
  说明阻塞；V11 调度任务对 CLIENT 工具的离线失败显式记录，不假成功。
- **Skill 资源包扩大攻击面**：文本资源只读、路径版本钉死、脚本必经
  命令 allowlist 与审批；签名包信任链既有。
- **Cron cutover 影响现有假数据用户**：假仓本就不持久、无正式合同；
  原子切换，不做迁移（无真实用户数据）。
- **Bot 入站自动回复的联邦滥用面**：复用渠道既有授权/去重/限幅；
  默认未绑定不回复；绑定为显式动作。
- **大文件超 64KB fenced 参数**：Plan 阶段定资源协议（分块/直传 OSS），
  不临时放宽安全上限。

---

## 10. 待 Owner 确认的问题（设计完成后一次性提出）

1. **北极星与范围**：确认以 TD-C01…TD-C06（§1.1）为本轮北极星，
   §5 的 V01–V14 全部在本轮？还是有优先级裁剪（例如先做体感最强的
   V04 队列 + V02 执行 + V11 Cron）？
2. **写/命令默认授权**：L1 写操作默认"逐次审批"、L2 命令默认逐次审批
   是否认可？shell allowlist 的具体命令清单（make/pnpm/go/cargo/
   git 只读等）有无要增减？workspace 默认根用应用数据下 per-agent
   目录，还是允许首次任务引导用户选择目录？
3. **External coding runtimes（Codex/Claude/Cursor CLI 等）**：本轮
   是否投入（per-turn 工具桥/活动归一/产物桥），还是只把 Direct Model +
   MCP + 本地工具做到可用，external 保持"可配置但不广告能力"？
4. **Evaluation Lab**：确认 defer（Station/Desktop 已有代码保留、
   不投投入、不进主工作面）？这将正式修订 MCA 的 V2 required 标记。
5. **Knowledge 检索深度 + Git 摄取**：选方案 A（保持 inline+hash 诚实
   标注）还是方案 B（复用 memory embedding+pgvector 持久向量化）？
   Knowledge Git 自动摄取、Skill 的本地 Git reference 安装本轮做不做
   （不做则只保留 official envelope / ZIP / 自建三通道）？
6. **Bot 自动回复（V13）**：本轮做，还是保持纯收件、稍后再绑？
7. **Cron**：确认 Station 持久调度 + 删除本地假 cron；shell/workflow
   执行类型确认撤下？
8. **Memory consolidation 与 TTS**：两者都 defer？现有 TTS 假桩是
   直接撤下入口还是保留待后端？
9. **Settings 是否补 Your Station 管理节**（多 Station 增删切换，
   当前仅登录引导）？
10. **交付节奏确认**：按 §7 DAG 直接在真实三端（proto/Station/Rust/
    React）实施，原型仅同步合同；仍不 commit，等你 `make desktop`
    逐阶段验收？
