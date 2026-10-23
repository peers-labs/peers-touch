# Search 关键设计决策

> **Status**: active
> **Created**: 2026-10-22
> **Owner**: Search / Client / Station
> 下表登记已确认的约束；其余细节是后续设计输入，不表示实现或验收完成。

## 决策索引

| 决策 | 约束 | 状态 |
| --- | --- | --- |
| D-01 | Chat 默认落点与 Search 按需 singleton 入口 | accepted |
| D-02 | 域内来源通过显式接入合同准入 | accepted |
| D-03 | Client/Station 分别执行其信任区查询 | accepted |
| D-04 | Desktop 复用原 Messaging 加密 FTS | accepted |
| D-05 | 结果和打开受当前读权持续约束 | accepted |
| D-06 | 派生索引由原域可靠投影、删除不复活 | accepted |
| D-07 | 排名、分页和 coverage 不夸大 | accepted |
| D-12 | 功能检索只打开受信操作面 | accepted |
| D-13 | 一个客户端 Rust 查询核心，Renderer 不复制执行引擎 | accepted |
| D-16 | 叶子排名只融合一次 | accepted |
| D-17 | 查询与后台投影独立、资源有界 | accepted |
| D-19 | 封闭域、当前 actor 可见性、域外来源禁止 | accepted |

缓存复用规则见已确认的 D-20；它细化 D-05/D-07/D-17。Desktop 原域切片已
开始实施，性能、完整恢复与离线授权期限仍按证据分别确认。

## D-01 Search 按需唤起，Chat 是默认落点

**Status**: accepted
**Date**: 2026-10-22

### Context

**方向输入**：用户要求普通启动默认显示 Chat，点击 Search 才显示搜索首屏；明确对象深链继续遵循导航合同。

### Decision

**建议**：Search 按钮全局可达；首屏采用主搜索框、少量最近/固定入口和紧凑范围选择，查询后再展开深度。门户、快捷框与局部检索共享意图和原对象打开语义；Ask 为用户主动触发的连续能力。

### Rationale

**依据**：用户选择 Chat 作为日常入口；当前源码 `DEFAULT_READY_PAGE='search'`，Search descriptor 为 eager/forever。Slack/Notion 参照支持全局与局部连续；负一屏是用户给定的触达和克制参照，不推导其具体系统能力已经在 Peers 实现。

### Alternatives Considered

拒绝把独立 Search 页面作为默认首页；confirmed Shell 原型使用 singleton overlay。

### Consequences

**取舍**：Search 的触达由全局按钮和建议快捷键保证。跨启动旧 Search 路由不能抢占默认 Chat；同一使用会话内保留查询与返回位置。具体按钮位置、快捷键与布局仍需原型确认。

## D-02 内容接入是显式协议

**Status**: accepted
**Date**: 2026-10-22

### Context

封闭检索域需要明确来源、权限和对象打开合同。

### Decision

**建议**：内置业务与受信 Applet 统一声明域内资源、字段、权限、执行边界、增量、删除、覆盖和打开；schema/授权/proof 决定 eligible。外部 connector 被 D-19 排除。

### Rationale

**依据**：现有 source/result 字符串与 metadata 不能表达这些合同；Glean indexing permissions 展示 identity/group/document 同步的重要性。

### Alternatives Considered

拒绝自动索引全部数据库或页面文本；后续 contributor 未实施。

### Consequences

**代价**：每模块需提供 provider 和否定用例。可自动注册 manifest，但不能自动把所有数据库表、工具输出或页面文本变为可搜内容。来源目录只是原 capability/安装/grant 的检索投影，不能再建一套授权 authority。

## D-03 Client 与 Station 两级聚合

**Status**: accepted
**Date**: 2026-10-22

### Context

系统仍为 Client ↔ Station；端侧私密正文不由 Station 持有。

### Decision

**建议**：私密本地内容由 Client 聚合；Station 仅聚合其有权处理的域与来源；双方共享 query/coverage/result contract。

### Rationale

**依据**：已有本地 Messaging FTS 与 E2EE，Station 无私密正文真源。当前 Client ↔ Station 拓扑。

### Alternatives Considered

拒绝上传私密明文集中建索引；本期不实现 Station 执行。

### Consequences

**代价**：跨边界排序/分页较复杂；接受短期 query session。集中明文索引不满足产品隐私合同；全部 Renderer fan-out 缺少资源与 authority 边界。

## D-04 复用索引，搜索引擎按证据选型

**Status**: accepted
**Date**: 2026-10-22

### Context

本期端侧消息已有加密 FTS owner。

### Decision

**建议**：本地复用 Messaging SQLCipher/FTS5；Station PG 派生投影为默认候选。需要成熟 CJK/typo/hybrid 或规模证据时用官方 SDK 集成 Meilisearch 等引擎。

### Rationale

**依据**：SQLite/PG/Meilisearch 官方文档；[独立组件研究](./feasibility.md) 已有真实文档 corpus 与加密 FTS/PG 测量，原生产品与大规模基线仍缺。

### Alternatives Considered

拒绝另建聊天正文真源；Station 后端选型未冻结。

### Consequences

**代价**：FTS5 unicode61/PG simple 的中文短词遗漏已复现；分词验证改善关键词召回，但不足以冻结完整中文/跨语言 analyzer。现在冻结第二引擎会引入未经测量的运维和 ACL 同步成本；自研搜索引擎不合理。

## D-05 授权在结果、预览与 AI 上持续生效

**Status**: accepted
**Date**: 2026-10-22

### Context

对象存在性本身可能泄露私密内容。

### Decision

**建议**：索引过滤加当前领域 batch read-policy；权限/删除事件使结果/cursor/AI evidence 失效。counts/facets 不返回未授权命中。

### Rationale

**依据**：索引 ACL 异步；领域权限可能变化；标题/ID/计数也可能泄漏。

### Alternatives Considered

拒绝前端过滤和“仅标题可见”的旁路。

### Consequences

**代价**：需要 batch hydration、deny 优先队列和离线租约合同。不能把旧 ACL、source token 或授权一次作为永久阅读权；离线远端撤权无法即时得知，必须如实描述。

## D-06 派生状态可重建，事件可靠投影

**Status**: accepted
**Date**: 2026-10-22

### Context

原文、编辑、撤回与派生索引必须保持同一当前状态。

### Decision

**建议**：transactional outbox 或具有 watermark 的可靠 snapshot/change adapter；幂等 revision、tombstone 防复活。当前 Desktop 直接写同一 FTS 派生投影，不实现搜索代际迁移或双索引。

### Rationale

**依据**：更新/删除/权限变化影响同一个可搜对象，来源断线和迟到事件必须可恢复。

### Alternatives Considered

拒绝 page-mount 刷新和历史版本兼容体系作为正确性机制。

### Consequences

**代价**：生命周期验证比“注册 query handler”复杂。UI mount 全量抓取或定时盲扫不能作为唯一一致性合同。

## D-07 排序和覆盖是产品合同

**Status**: accepted
**Date**: 2026-10-22

### Context

截断结果不能冒充全量，成功查询不能冒充完整覆盖。

### Decision

**建议**：精确对象优先、来源内 ranking、跨来源 rank fusion；分页快照有身份/权限/expiry 约束；partial 和 unknown count 显式。

### Rationale

**依据**：当前结果按 source 顺序、截断条数冒充 total；Meilisearch 官方说明展示跨索引分页/去重与远端 count 边界。

### Alternatives Considered

拒绝原始异构分数直接比较和无依据的 ready/total。

### Consequences

**代价**：渐进响应要保护焦点/已展示顺序；参数需标注 corpus。不能直接比较异构 raw scores，不能因查询成功 exit code 就声称全范围完整。

## D-08 Search 与 Agent 共用证据，生成仍由 Agent 持有

**建议**：AI 增强意图理解、语义召回、排序和问题回答；Search 返回 authorized evidence 并持有查询/结果，Agent 负责模型/provider 执行与生成。明确对象优先直达，提交问题可以给短答案，用户选择深入后才多轮研究。证据仅来自当前 actor 可读的域内对象；D 区内容只在端侧处理，S 区内容到 Station Agent 与外部模型是两次分别授权。

**依据**：已有 Agent 和 provider 系统；重复 AI 搜索会复制授权、模型和引用逻辑。

**代价**：需将现有 `search_ai` 占位接口换为有来源的合同。外部模型接收后不可追溯撤回，不能承诺虚假删除能力。

## D-09 历史记录与离线规则分开确认

**建议**：搜索词历史本机账号内默认关闭；最近访问/固定对象另行管理。断网私密搜索遵循原域有效缓存/授权租约。

**依据**：查询词可以暴露私密兴趣/内容；当前跨账号缓存风险尚未现场复现。产品选择属于建议，不能当作用户已经授权。

**代价**：默认便捷性与隐私有取舍。历史默认值、离线保留期限、来源级模型外发范围须在产品确认时确定。

## D-10 网络搜索（已被 D-19 取代）

**状态：superseded-by D-19（2026-10-22 用户收窄范围）。** 公网搜索、搜索商接入与浏览器 fallback 不属于 Search；不再保留网络范围选择、credential 或 supplier 配置。未来若产品重新决定引入，按新范围决策重开 ADR。

## D-11 OS 授权目录检索（已被 D-19 取代）

**状态：superseded-by D-19（2026-10-22 用户收窄范围）。** 不索引 Peers 之外的 OS 文件/目录，不设 LocalFileGrant、系统索引复用或目录 picker 生命周期。Peers 平台自己管理的附件作为域内对象在 D-19 中处理，随父对象授权。

## D-12 功能搜索直达受信任入口

**Status**: accepted
**Date**: 2026-10-22

### Context

**范围输入**：用户要求功能搜索与现代、克制的体验。

### Decision

**建议**：功能以稳定 module/capability/action、名称/别名/用途与当前可用性接入；搜索可以找“换模型”“添加好友”等意图并打开正确操作面。关键词/别名可独立于 AI 工作，语义匹配复用同一 catalog。

### Rationale

**依据**：现有 Shell/Settings/Applet 入口可提供原对象导航；Raycast 参照支持检索到显式 action，写操作继续由 Peers 原域合同授权。

### Alternatives Considered

拒绝搜索提交直接执行写操作；D05 仅登记真实存在目标。

### Consequences

**取舍**：功能结果须可真实打开且恢复原任务；搜索词与 Enter 不直接执行发送/删除等副作用。首屏不堆放全部功能，结果随意图展开。

## D-13 客户端只有一份查询核心

**Status**: accepted
**Date**: 2026-10-22

### Context

客户端共享 Rust runtime；跨域查询机制需要唯一 owner。

### Decision

**约束**：客户端分词、排名、cursor 与取消机制只有一份 Rust 核心，Renderer 只投影。`packages/search-core` 已登记，当前仅 Desktop 消费；Mobile 适配与完整请求生命周期后置，不能以核心类型存在证明取消或分页已闭环。

### Rationale

**理由**：两端已有 Rust runtime 和 Messaging/secure-content 共享实践；跨来源查询属于 Search，不适合放进 Messaging 或 Agent。

### Alternatives Considered

**替代**：各端独立 coordinator 容易在取消/分页/权限上分叉；同时新建 TS 与 Rust core 会造成状态重叠；统一放 Station 无法保持本机私密范围。

### Consequences

**代价**：新共享包要定义纯 port 与跨实现 conformance；Station Go application 不直接共享 Rust 编排实现。若发现已有适合 owner 或证据表明 FFI/跨实现成本不可控，重新审查包边界，不能绕过协议。

## D-14 扩展点分职责，复用已有能力目录

**建议**：source contributor、index backend、domain attachment extractor、function catalog、result presentation 和 Agent evidence 是分离 port；Applet 使用既有 contract/SDK/bridge，只能贡献其拥有的域内对象；MCP/Skill 不作为域外内容来源（D-19）。

**理由**：已有 manifest、service、capability、任务和 Agent 目录可以提供 identity 与执行 binding；Search 只补检索字段、coverage 与原对象定位。

**替代**：万能插件让数据、权限、渲染和执行混成一个 authority；每新增来源修改页面 switch 会让 Search 成为业务耦合点；抓全部数据库既有安全风险也复制索引。

**代价**：每来源要实现并证明 query/permission/open/lifecycle；协议过宽会增加接入成本，所以 query-adapter 与 derived-index 分开、按能力选择。若来源实际不需要某 port，应使用明确能力 profile，不生成空实现。

## D-15 模型执行服从 Agent 的现有 owner

**建议**：Search 不增加模型目录/凭据/调用后门。现有 Station 模型调用只处理已允许到 Station 的 S 区 query/evidence；D 区语义只有平台/Agent 已声明并可用的端侧 inference 才提供，无端侧能力时保留 lexical 路径。

**理由**：当前 Agent Direct Model 由 Station adapter 调用，client-local MCP 是独立执行 owner。embedding/rerank 不由 completion 方法名推定。

**替代**：客户端自建模型执行会与 Agent 配置/权限分叉；把私密索引上传则改变信任边界；调用本机 MCP 模型也不能绕过既有 ownership；接入系统索引语义会把 OS 文件重新引入检索域，违反 D-19。

**代价**：严格 device-private 来源在无端侧能力时只能用词法检索。若产品必须承诺自有离线语义与问答，应先接受 Agent/平台 inference 能力及隐私合同，而不是在 Search 内临时补通。

## D-16 跨来源排名只融合同一叶子一次

**Status**: accepted
**Date**: 2026-10-22

### Context

两级聚合不能重复计入同一个叶子命中。

### Decision

**建议**：source 返回 source/resource kind/strategy/generation 的 leaf rank provenance；Client 对本地和远端叶子排名最终融合，Station-only 查询可由 Station 完成同一最终排序。精确对象优先，模型只重排有界授权候选。

### Rationale

**理由**：异构分数不可直接比较；两级聚合若把融合后分数再当叶子会重复加权。稳定分页和 partial 需知道每个叶子 continuation。

### Alternatives Considered

**替代**：按 source 返回顺序拼接会偏向快来源；比较 raw BM25/vector score 没有共同尺度；让 LLM 对全部正文排序增加成本并扩大数据处理。

### Consequences

**代价**：continuation 与 rank channel 需要明确协议；跨来源迟到结果不随意移动焦点。融合参数和小 catalog 策略由标注语料实测，召回/排序不达标时调整策略或后端，不改变授权/open 合同。

## D-17 查询与后台索引独立调度

**Status**: accepted
**Date**: 2026-10-22

### Context

页面生命周期不是数据一致性或资源生命周期。

### Decision

**建议**：交互 query、后台 scan/extraction/embedding、重建分优先级且都有上限；UI 按需挂载，来源 worker 由授权/runtime 持有。先返回可用来源，慢源显示 partial。

### Rationale

**理由**：打开搜索页不应触发整库解析；关闭页面也不应丢更新/删除。来源生命周期是资源合同，UI lifetime 不是数据一致性机制。

### Alternatives Considered

**替代**：每次 query 全量扫描或挂载 Applet 页面会放大延迟/内存；没有预算的独立后台队列容易占满设备。

### Consequences

**代价**：worker 需 checkpoint、quota、公平性、暂停与取消；资源与延迟阈值待实测。发现后台工作挤占交互时先修复调度/预算，不靠缩小用户承诺范围掩盖。

## D-18 语义执行与检索质量分别准入

**建议**：模型/embedding 可调用只进入 capability-ready；source 还需独立中文、英文、跨语言、ID/名称与描述性语料证明 relevance。当前 E5 和简单 BM25/RRF 不作为已确定的默认模型/排序。

**依据**：[实验](./feasibility.md) 中本机 ONNX 查询向量 P95 约 3 ms，原中文六题前五 2/6，简单混合前五 1/6；英文翻译诊断 6/6。该差异支持将跨语言质量列为单独问题，不能由运行速度、模型品牌或人工翻译补成 PASS。

**代价**：双语 analyzer/metadata、query rewrite、分块、模型与 reranker 需要同语料对照和设备预算。翻译不得扩大 source/权限或悄悄出网；小样本命中不当作通用 Recall。模型/策略替换绑定新 generation 并重做质量证据，关键词与功能别名始终可独立工作。

## D-19 封闭检索域：只搜 Peers-Touch 域内、当前 actor 有权限的对象

**Status**: accepted
**Date**: 2026-10-22

### Context

**范围输入（用户决策，2026-10-22）**：“只能搜 Peers Touch 域内的东西，端 + Station，且只能搜当前用户有权限的。范围和边界要设计好。”此决策取代 D-10、D-11。

### Decision

**决策**：

- 检索宇宙限定为 Peers-Touch 平台拥有的对象，分布在三个信任区：D 端侧私有（E2EE 已恢复消息、端侧私密记忆/附件）、S 本站授权（Social、会话元数据、Agent 会话/知识/笔记、Peers 管理附件、人员目录）、F 联邦授权（现有联邦上下文中对端站可见对象，仅按需查询）。
- 每个对象经准入、索引/候选过滤、当前 read-policy hydration、预览/打开再校验四道链；标题、片段、计数、facet、建议、AI evidence 全部按当前 actor 过滤，deny 不泄漏存在性。
- Peers 管理附件（随消息/知识/任务/帖子进入平台存储）是域内对象，随父对象授权；它不是 OS 文件来源。
- 功能直达保留为域内导航对象（只含当前账号 eligible 入口），不承载外部内容。
- 公网网页/搜索商、Peers 之外的 OS 目录与文件、外部网站/SaaS connector、跨 actor 全局检索为明确非目标，不存在配置开关、Applet 或 MCP 旁路。
- AI 只在域内证据上工作；D 区内容端侧处理且不上传，S 区内容到 Station Agent / 外部模型是两次独立显式授权。处理位置不改变检索宇宙。

### Rationale

**依据**：E2EE 与 Station 无权持有私密正文的既有架构；[现状研究](../../../research/search-current-state-and-benchmarks.md) 中门户来源未闭环；[可行性实验](./feasibility.md) 证明域内加密 FTS 与受控权限模式可行。公网 RSS 与受控 OS 目录实验只作为历史机制证据，不是产品能力。

### Alternatives Considered

**替代方案与拒绝理由**：统一索引公网与本机文件可提升表面覆盖，但引入域外凭据、抓取、OS grant 与外发隐私面，违背“域内、当前权限”的产品边界；由各模块自行在结果中过滤权限会产生旁路和泄漏面，因此权限链必须在 Search 合同中强制执行而非前端约定。

### Consequences

**代价**：Web Search Applet 的 `search` 路由不进入门户来源；Launcher mock 搜索与 `tools_search_providers` 固定数据应在实施时移除或改造为域内来源，不保留兼容双轨。Federation 覆盖受限于已建立的联邦上下文，不承诺全联邦搜索。未来重新引入外部来源必须作为新范围决策，重开产品与架构确认。

## D-20 缓存由统一读边界持有，内容与授权分别有效

**Status**: accepted
**Date**: 2026-10-23

### Context

**用户场景输入**：长期不变的内容不应在每次搜索时重新获取；输入/退格、
反复预览、打开后返回和离线恢复需要复用。已有 `client-chat-core` 通过
`client-storage` 持有原域派生缓存，可复用读侧 ownership。安全合同要求当前
读权，不能由“内容未变”推导“永久可读”。本期通用缓存及 Desktop 原域
绑定已落地；其他来源与跨设备仍待接入。

### Decision

**决策**：headless Search runtime/application 在 contributor 共通读边界
统一处理目录、资源投影与短期查询/session 的复用、in-flight 合并及失效，
正文优先复用原域 read cache。持久派生索引单独持有。静态目录按 revision，
可变查询按依赖/watermark 与有界新鲜期；内容 validator 与 read-scope/租约
分别有效。三个读方法保持 `query/hydrate/resolve`，hydrate 使用统一批量
请求/outcome；逐项 validator/字段在请求、读取结论在响应，不增加缓存 RPC。
headless runtime 主动使已展示投影在读权到期时失效。可淘汰 payload 不拥有
在途失效屏障；内部排序 session 与 subscriber lifetime 分开，operation
仅在最后 subscriber 退出、来源失效或底层预算到期时取消。

### Rationale

**理由**：有明确有效性的数据可以零次来源/正文读取恢复；缺字段才补齐，
变更按依赖失效。统一有效性防止 Overlay、局部搜索与 Agent 各自延长私密
读取期限；新 intent 可复用值，执行身份仍阻断旧响应回写。

### Alternatives Considered

每次强制 hydrate RPC 会重复传输不变内容；全局固定 TTL 同时混淆目录新鲜度、
正文新鲜度与私密读权；每来源/页面自行缓存会复制失效和授权逻辑。仅用命中
对象版本也无法发现新内容，故查询页必须依赖检索范围 watermark 或有界新鲜期。

### Consequences

**代价**：统一 wrapper 需维护依赖失效、分区/字节限额、订阅者取消和独立读取
有效性，以及有界 operation 失效标记、session continuation 串行推进和读权
expiry 调度。原域未提供可靠变更或租约时保守重读/拒绝私密旧值，不能为命中率
放宽读权。容量淘汰允许增加读取，离线授权政策由原 authority 决定。
S-18/V-10 是目标证明；性能、缓存参数和真实产品恢复均 UNPROVEN。测量若表明
缓存维护成本超过重复读取收益，可调整具体缓存角色与额度，不能改变授权边界。
