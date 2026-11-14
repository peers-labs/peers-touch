# 工作台完整能力复审：UI/UX、任务、浏览器、插件及交付

**落地对象是完整任务工作台。** Codex 的执行协议、TUI 交互投影、插件生命周期和浏览器政策都是参照；Memory 只是其中一个能力。每个维度都要落实用户动作、真实数据、执行 Owner、结果消费者与异常恢复。

源码基线：Codex `67f0994b532b8740f14b5b738af7b7b2a915b1d6`。以下区分源码实现、已阅读测试规格、既有原型静态观察与拟实施合同。没有运行 Codex 测试、真实浏览器或生产集成；不把开源 TUI 的机制推导为商业图形客户端的视觉实现。

## C01 UI/UX：工作过程、阅读与输入同时成立

**Codex 怎么做。** `ChatWidget` 区分已提交历史和原位更新的活动 cell；transcript overlay 读取缓存的活动尾部，通过变化键刷新，不在每帧重新构建。Agent 运行与 MCP 启动独立跟踪，再派生统一 busy 提示；流式 commentary 时避免重复进度提示。Computer/探索活动按真实 Item 分组，跨分页仅合并同一轮内相邻工作，并保留展开详情。

来源：[ChatWidget](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/chatwidget.rs#L1-L31)、[Computer 分组](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/thread_transcript/computer_groups.rs)、[探索分组](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/thread_transcript/exploration_groups.rs)、[跨页一致性规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/thread_transcript/computer_groups_tests.rs#L1-L108)。

**Peers 怎么落地。** 保留已认可的 Agent 列表、任务栏、连续对话区与对象工作面；沿已有 `AgentWorkbench`/`ConversationRail`/`Portal` 演进。历史、活动尾部、资料和成果分别投影到同一任务；消息中的回执不重复全文或替代正文 reader。标题原行显示当前状态，详情按需展开；批准和错误必须能打开对应工作，不只发 toast。

工作面按需挂载，阅读状态独立持久：`task / conversation / resource / version / anchor` 定位对象，其中 conversation 是任务的连续对话而不是任务下可切换会话；手动滚动不被新 delta 拉回底部，主动“回到最新”才恢复跟随。分页合并保持展开、选区和滚动锚点，身份不匹配的事件不更新当前任务。静置和无变化同步不触发全局初始化。

**静态观察。** 本轮查看了既有宽屏概览及窄屏正文截图：任务上下文、对象 toolbar 和窄屏返回已放在连续工作面；这支持保留当前布局方向。截图不能证明流式稳定、读屏、触摸和焦点恢复。生产 `PortalPanel` 仍从消息解析成果并有宽度约束，须切到权威版本并贯通窄屏阅读。

来源：生产组件 `apps/desktop/src/components/agent/workbench/AgentWorkbench.tsx`、`apps/desktop/src/components/portal/PortalPanel.tsx`（研究基线路径，以当前 master 为准）、[宽屏截图](./assets/after-overview.png)、[窄屏截图](./assets/after-narrow-document.png)。

**验收。** 流式输出、跨页、切任务、重开、窗口缩放、Profile返回、阅读中批准均保持对象/选区/草稿；键盘进入、退出后回原触发点，窄屏按钮可达。Native 静置及真实流式记录单独测，不能复用截图声明通过。

## C02 任务与会话：持续推进、独立介入和输入恢复

**Codex 怎么做。** thread 负责会话，turn 负责一轮执行；start/steer/queue 是不同路径。TUI 保存 thread input state，恢复时用已确认 user message IDs 识别未确认输入；非当前会话的交互请求仍有明确呈现路径，避免后台批准无人发现。queue 测试规定中断暂停待办、失败可推进待办；媒体在 enqueue/update 前快照，文件删除不改变已排输入。

来源：[输入恢复](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/chatwidget/input_restore.rs#L1-L140)、[后台待处理请求](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/app/thread_routing.rs#L465-L510)、[已确认输入恢复](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/app/thread_routing.rs#L1795-L1865)、[失败/中断队列规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/ext/queue/tests/queue_service.rs#L480-L518)、[媒体快照规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/ext/queue/tests/queue_service.rs#L826-L880)。

**Peers 怎么落地。** TaskRun 持业务目标、接收条件与连续对话；Conversation 是用户可见对话并在内部绑定宿主 thread；Turn/Step 持实际执行。Station独占任务级队列、持续推进、配额与准入，不叠加宿主主动 Goal/Queue。复用队列机制的前置条件、身份与输入冻结方式，不照搬“失败后自动推进”到需要人工核对的资料/写操作，也不把内部 thread 恢复暴露成“续接新会话”。

草稿、暂存附件、引用与游标按任务保存；待办输入绑定确定资料版本，排队后修改资料需显式更新待办。发送后未回执输入显示待核对，不能直接再发。后台任务继续工作但不抢当前焦点；列表和通知提示需批准/回答，打开后定位准确请求。

停止暂停本任务后续准入并等待实际终态；另一任务不被误停。派生选终态历史及资料/成果，独立授权写根，不继承接受、草稿、队列或审批。任务完成属于成果合同，不由宿主 idle/completed 推断。

**验收。** 多任务并行、同任务连续对话、后台批准、排队编辑/取消、资料更新、发送竞态、独立停止、断连和派生都需真实旅程。协议细节继续消费 [接入合同](./integration-contract.md)。

## C03 寻找与选择：搜索状态不能破坏工作状态

**Codex 怎么做。** search footer 在原行渲染 query/caret，区分正在搜索、加载早期历史、加载失败、没有更多命中。测试覆盖保留查询阅读、缩放后导航、只展开命中内容、保留手动展开，以及读取失败后的显式重试。

来源：[搜索呈现](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/transcript_view/search_footer.rs)、[保留阅读与查询规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/transcript_view/search_tests.rs#L115-L155)、[选择性展开规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/transcript_view/search_tests.rs#L1020-L1060)、[历史失败规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/transcript_view/search_tests.rs#L1412-L1450)。

**Peers 怎么落地。** 保留已确认标签与头部原位搜索，不加入固定运行状态 Tab。任务搜索覆盖目标、条件、标签和会话；全局 Search 打开真实消息/资源版本，用同一 opener。命中内容可暂时展开，退出恢复手动选择；读取失败与“无结果”分开，重试保留查询和草稿。

现有原型 `RailSearchHeader` 已有原位替换、Esc与焦点返回，应复用其交互合同；生产组件与Runtime分别实现视图、查找及获授权打开。来源：原型组件 `packages/prototypes/desktop/shared/RailSearchHeader.tsx`（原型树，不进生产构建）。

## C04 浏览器与Computer Use：预览、实际网页操作和系统操作分别有合同

**Codex 怎么做。** browser policy 区分origin访问、上传、下载、full CDP、自动审查、持久批准及批准存续范围；Computer Use 用应用标识表达权限。MCP调用带当前step模型政策、thread/session与originating call信息；TUI将`cua_repl`作为Computer活动呈现。这些路径证明政策/上下文/事件表达，不能证明本仓库提供可直接复制的商业浏览器控制服务。

来源：[Browser/Computer requirements](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/config/src/browser_computer_use_requirements.rs)、[应用权限](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/config/src/computer_use.rs)、[MCP政策与调用身份](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/core/src/mcp_tool_call.rs#L1428-L1495)、[Computer活动识别](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/history_cell/mcp.rs#L61-L73)、[requirements传播规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/tests/suite/v2/config_requirements_browser_use_tests.rs)。

**Peers 怎么落地。**

- **成果网页预览**：Portal读取确切HTML版本、来源正文与选区，隔离脚本/执行权限；反馈回原会话。不承诺登录态或互联网操作。
- **真实Browser能力**：优先集成成熟控制组件，候选为Playwright MCP，经已有客户端MCP worker/ToolDispatch执行；另核对包、平台、账号与会话可用性。把页面、账号、执行设备、task、权限与控制租约绑定，操作记录回任务；下载登记真实资源版本，上传只读已授权资料。
- **Computer Use能力**：由独立设备能力适配实际系统权限与应用控制；浏览器导航不能代替系统操作，当前未取得完整生产执行证据。

人工接管移交控制租约并暂停Agent操作；归还后重新观察页面/账号，再准入下一动作。真实页面选区的反馈带session/page/采集时间与内容锚点；网页变化使锚点过期时重新定位，不静默引用另一页面。

**复用边界。** 现有Native worker已经有MCP执行与资源/回执Owner；不新建前端直连Browser服务，也不把所有工具输出当HTML预览。浏览器读取和发布是不同授权，提交表单/发布需实际回读结果。

来源：既有 Native MCP 执行 `apps/desktop/src-tauri/src/application/desktop_executor_worker/local_executor.rs#L94-L198`、MCP 服务 Owner `apps/station/app/subserver/agent/service/mcp_server_service.go#L43-L115`（研究基线路径，以当前 master 为准）。

**验收。** 真实导航、阅读、点击/填表、反馈、上传下载、登录接管、账号变化、错任务、断连/停止与发布回读分别验证。政策字段传播不是实际执行阻断证明，需对选定控制组件做允许/拒绝实测。

## C05 插件：安装、启用、登录、角色绑定和实际可调用分别回读

**Codex 怎么做。** plugin manifest是skills、MCP、apps、hooks及展示信息的组合。Summary区分来源、remote/local version、installed、enabled、availability与disabled reason；Detail展开实际组件。安装完成后清缓存、重新加载配置、刷新MCP与hook runtime，并发起所需OAuth/返回appsNeedingAuth；卸载清包与配置。插件页测试还检查目录/详情返回位置、不可安装操作和本地/远端去重。

来源：[manifest组件](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/core-plugins/src/manifest.rs#L48-L122)、[Summary/Detail](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/v2/plugin.rs#L704-L779)、[安装链](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/request_processors/plugins.rs#L1481-L1593)、[刷新消费者](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/effective_plugin_change.rs#L22-L68)、[卸载](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/request_processors/plugins.rs#L2012-L2042)、[UI规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/chatwidget/tests/plugin_catalog_tests.rs)、[卸载规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/tests/suite/v2/plugin_uninstall.rs#L30-L65)。

**不能照搬的两个边界。** 该提交明确写明`disabledPluginIds`保存选择但尚未过滤能力；安装结果的`appsNeedingAuth`在Apps runtime不就绪时也可为空。API-key账号有隐藏Apps的测试。因此选择已保存、installed=true、空待登录列表均不能单独证明能力已授权/就绪。

来源：[thread设置边界](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/README.md#L472-L495)、[Apps就绪分支](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/request_processors/plugins.rs#L1794-L1861)、[API-key账号规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/tests/suite/v2/plugin_read.rs#L2140-L2177)。

**Peers 怎么落地。** 复用现有Skill/MCP/Connector manifest、能力authority/readiness及Profile binding。包是交付/安装单元，具体能力仍有既有Owner；不再造一套插件工具注册表。来源身份用包ID+版本+来源，不以名称去重掉不同对象。

产品流程为发现/详情→安装→登录或补配置→绑定角色→回读可调用目录→任务真实调用→结果消费。能力入口沿Profile；账号/模型供应商沿全局已有管理层。当前任务缺能力的提示可直达对应配置并保存返回task/draft；不强迫用户依次找多个孤立列表。

展示分别反映安装、角色选择、账号就绪、有效权限和当前运行可调用性；不铺成五套常驻导航。停用/升级/卸载刷新Skills/MCP/hooks及快照，阻断旧binding的新准入；正在运行的请求按撤权/租约合同处理。Codex侧需要实际过滤授权组件或隔离宿主配置，不能仅发`disabledPluginIds`；native/tool目录核对失败就阻断。

来源：现有 MCP 修订/注册 `apps/station/app/subserver/agent/service/mcp_server_service.go#L43-L115`、binding/manifest 授权 `apps/station/app/subserver/agent/service/authorized_capability_set.go#L180-L258`、Connector manifest `apps/station/app/subserver/agent/service/connector_manifest_service.go`（研究基线路径，以当前 master 为准）。

**验收。** 一个Skill包和一个带实际MCP/OAuth的包分别跑上述链；补测失效账号、配置缺失、策略禁用、角色撤权、更新版本、运行中停用、卸载和重开。插件hooks/调度如有消费者也需要调用/结果证据，不能因为安装成功就自动授予系统写权限。商业Apps授权另核对，不假定克隆源码即可使用。

## C06 文件、Diff、成果与工具界面：操作对象共同归任务

Codex FileChange/McpToolCall/CommandExecution保留实际类型与来源；MCP UI含资源引用，而artifact marker仅识别操作。Peers所有消息、文件、网页、Diff、Search、通知打开同一授权版本；文件编辑/选区反馈显式发回原草稿，保存产生新版本。MCP app UI资源通过同一Portal隔离加载，不能自动获得本机桥或账号。

来源：[工作项与MCP UI](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L354-L437)、[MCP UI资源类型](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/protocol/src/items.rs#L442-L452)、[成果边界分析](./source-analysis.md#s14-能复用执行和协议不能推导出商业-ui服务可复制)。

阅读格式沿现有Markdown/代码/附件组件，缺Office格式再选成熟viewer；实际支持范围按平台验证。Terminal 按持续进程需要打开，命令结果和日志进入任务/检查消费者；查看、收起和结束进程各自独立。

## C07 Profile、Memory、模型与验收：配置必须影响下一轮及交付

Profile规则/Skills、已确认Memory和有效工具目录沿同一prompt manifest被真实模型消费；模型安装/登录/用户分配仍沿Dashboard，Desktop只引用授权能力。源码研究对这些边界的详细结论继续消费 [S11–S14](./source-analysis.md#s11-memory-写入是有界版本化的后台工作)。

验证至少贯通：输入来源→真实行为→文件/页面字节→反馈→新版本→检查→人工接受→重开。插件安装、浏览器操作、命令成功、Turn completed和Memory候选都只是各自生命周期事实，不能直接完成任务。

## C08 落地依赖与删除

完整范围按下列关系执行，不能把UI/Browser/插件推迟成最后的装饰层：

1. **A00/A01**：固定协议/授权边界、统一任务与历史；能力目录、宿主接入和可回读事件一起证明。
2. **A02/A03**：真实资料/成果与工作台交互；流式/分组、跨页、搜索、宽窄、草稿及后台介入一起交付。
3. **A04/A05**：Profile/Memory实际消费、代码/Diff/检查、独立派生；保留通用执行与Codex两条路径。
4. **A06**：Browser与插件各自跑完整业务链，共用已证明Task/Turn/Artifact/Capability Owner；未就绪能力不出空入口。
5. **A07**：Scheduler/Connector/协作等真实消费者与全量删除收口，完整运行和正式文档一致。

删除项仍包括重复手工任务真源、消息解析正式成果、有损持续协议、全量Memory回退和无人消费开关/路由；不删除已有真正工作的Skill/MCP/Connector/资源/回执底座。每个切换同步协议、缓存、实际消费者、数据迁移、正式文档和验证。

详细生产字段/Owner 见 [架构设计](../design.md) 与 [模块归属](../module-layout.md)，完整体验与能力验证见 [验证计划](./validation-plan.md)。原型认可不等于这些生产能力已完成；生产证据以 TW-20261102 执行计划切片为准。
