# Search 集成与验证合同

> **Status**: active
> **Created**: 2026-10-22
> **Owner**: Search / Client / Station
> 本文定义目标映射与验收义务，不是冻结执行计划，不表示已完成生产验证。

## 1. 现有能力如何接入

**门户与默认落点**：普通启动、登录完成与账号切换默认进入 `chat`；Search 按钮/已确认快捷键主动打开 Search，关闭或返回恢复原页。实施须同时检查 `types/navigation.ts` 默认值、hash fallback、identity warm-resume/last-active-page、无效对象跳转、Search descriptor 与前后导航；不能只改一个常量，让旧 Search 恢复路径继续自动显示。明确对象深链由独立导航合同处理。

D04 由 Shell singleton overlay 消费统一 query/source/coverage contract；D04B 物理删除旧 `SearchPage`、`searchRuntime`、store 与其旧 native 命令。静态 descriptor 与账号 eligible source 分开；同账号导航上下文保留，身份/锁定/Station scope 变化取消并清理。Search UI 按需挂载，查询状态和域内后台索引独立于页面树。导航从 URL 前缀猜测切到 Shell Resource Resolver。D06 删除现有搜索商设置（`tools_search_providers` 固定数据）整条链；这些任务当前未完成。

**人际消息**：复用 `messaging_message_search_fts` 和 Messaging runtime；由索引 Owner 提供会话/跨会话 scoped provider，保留 hidden/retracted/moderated 与恢复进度。门户、现有 MessageSearchModal、Mobile history search 使用同一查询能力，不能重新全库扫描正文。

**人员**：复用 Identity/Federation catalog 与 resolve，区分联系人/已知对象/当前联邦目录/完整远程 handle。将现有 Desktop discovery 与 Mobile people search 的 request identity、错误与 context 要求纳入统一结果 contract。

**Social**：原域提供公开帖/评论、受众/治理与 discoverability；私密正文在 Secure Content 允许边界处理，comment/read 必须考虑父帖。现有 feed/detail read 不能直接当作完整全文索引接口。

**Agent**：现有 Desktop topic 扫描与 Station `session_search` 是输入资产。应由 Agent Owner提供 actor-authorized message/topic provider，带真实 coverage、分页和稳定 anchor，替代前端无界扇出。当前 agent ID 工具查询不能未经 ownership 审核直接暴露全局用户入口。

Agent inference 复用当前 provider/runtime owner；completion、embedding、rerank 分别证明可调用与实际边界。Search 不增加第二套凭据/模型目录；已有 `KnowledgeClientResourceRef` 和 capability/readiness 用于资源身份与设备能力，不能直接当作全文检索已就绪。strict device-private 内容不进入 Station 模型；缺端侧 inference 时保留本机检索。

**Note / 知识 / 域内附件**：使用各自对象 ID、read-policy、revision 和 extraction task；附件随父消息/知识/帖子继承可见性；覆盖状态明确 title-only/body-ready/OCR-ready 等。没有业务 provider 时保持不可用，不以新 Search stub 宣称内容可搜。不存在独立 OS 文件来源。

**功能入口**：Shell/Settings、业务模块与 Applet 提供受信任功能 descriptor 与真实 navigation/action binding。搜索名称、别名、用途并打开原操作面；只显示当前账号 eligible 的入口；Search 不自己实施功能写入，也不通过显示名称猜路由。

**Applet**：SDK/Host 增加 contributor binding 与权限；内置、第三方和 standalone 只在能力真实可用时接入，且只能贡献其拥有的域内对象。Applet 内部 resource 打开沿 launch options/Host resolver。`web-search` Applet 的公网 search 路由不进入 Search 来源集合（D-19）；其 crawl task producer 与 completion 不闭环的问题随来源移除而不再属于门户范围。

Applet 贡献本域数据、查询本域、查询其他已授权域内来源和管理来源是分离 permission profile，详见 [extensions.md](./extensions.md)。现有 file API 是 Applet 沙箱读写，不扩大为 OS 文件检索。MCP/Skill 只有暴露域内自有对象、稳定资源、coverage 和授权的 adapter 才能贡献来源。

**Launcher**：Feed 和 Search 分属不同产品任务。真实 Search capability 生效时删除 production mock source 与固定搜索商数据；旧 route 是否撤除按真实调用 inventory 决定，不能制造永久兼容层或双 owner。

## 2. API、Runtime 与治理

正式接受后登记：

- Search shared Model contract、Station public API 和权限能力；
- 来源与领域 adapter 的 owner/allowed dependency；
- Desktop/Mobile 共用 headless 查询语义和各端 index/transport adapter；
- Search UI module identity、singleton overlay、alive/render/resource limits；
- Applet capability manifest 与 schema 验证；
- Search business Acceptance providers/scenarios/oracles；
- 文档和 Operational Knowledge 的真实路径。

Core Acceptance 继续保持 domain-neutral。Search 注册、source eligibility、数据 fixture 和断言属于业务注入；不能为缺失 Search provider 修改 Core 为 PASS。

Client 推荐一个共享 Rust Search core；Model 和 SDK 一份 schema，UI 不重复实现查询引擎。Station 保持一个 Search application，来源 identity/capability 继续由原 registry 决定。架构 registry 在方案接受后登记，当前不为草案生成 active ownership 或 synthetic schema/version。

## 3. 切换不变量

切换单元按 source/resource scope 定义。某来源新 provider 启用前，证明 admission、read-policy、query/open、update/delete 和 coverage；该 scope 的旧 live path 随切换退出，不让两个索引/查询 Owner 同时处理相同对象。

当前 Desktop 在原 encrypted store 业务写入和恢复投影中直接生成分词索引，
不提供旧 raw 索引兼容、启动迁移或 generation/meta 表。既有未重投影内容的
新中文查询召回未证明；不能以启动成功宣称完整历史已收录。后续来源若需要
重建，由原 owner 负责且不得损失业务原文、恢复 cursor 或密钥。

Source ID 或 resource namespace 变更必须显式迁移引用、history/cursor、深链与 tombstone；不据标题猜旧对象。旧查询会话返回过期/来源变化后重建，不 silently replay。

当前历史文档 `chat/message-search.md` 由 Chat Owner更新；Search design 不替它伪造已经实现的全局消息能力。修改 production Search 时同步现有 Prototype Lib 和原型合同。

## 4. 待执行的完整 Journey

### V-01 Find/Open

两种真实客户端中，从全局/快捷/局部入口搜人、会话、消息、帖子、文档与 Applet；混合/同名结果可辨认；打开正确原对象与 anchor；返回保存 query/filter/scroll。验证键盘、触摸与辅助技术。

普通启动/登录/账号切换进入 Chat；无会话、无搜索来源与上次停在 Search 均不自动显示搜索首屏。点击 Search 才打开，关闭回到原页；明确对象深链仍打开指定对象。域内附件在父对象上下文打开，功能打开原模块操作面；结果列表不出现公网或 OS 文件对象。

### V-02 Scope / Identity

两账号、两 Station、至少一个已授权 Federation context；账号/Station/联邦切换、logout、lock/unlock、来源卸载过程中存在慢响应与分页；证明旧结果/预览/建议/AI chunk 不回写。A→B→A 单独覆盖。

### V-03 Permission / Privacy

有权和无权用户检索相同私密 fixture；验证结果、计数、facet、建议、snippet、preview、AI evidence 和 deep link 无泄漏。期间撤权/退出成员/父帖受众缩小/消息隐藏/删除，再执行旧 cursor 与迟到 upsert。

E2EE 消息搜索时，检查真实客户端/Station/provider 的网络边界，证明正文和 embedding 未被自动送到远端。离线过期授权政策由原域提供，不能把服务器 API negative proof 替代客户端可见行为。

### V-04 Freshness / Durability

create→edit→search→delete/revoke→search；重复事件、乱序、进程重启、checkpoint gap、snapshot/backfill 与 index generation 切换。验证迟到事件不复活、权限 deny 先于索引清理、原文和恢复状态不丢失。

### V-05 Failure / Coverage

局部索引锁定、部分来源 timeout、全断网、缺失历史、正在提取、filter 不支持、cursor expiry、query cancellation；界面有正确原因、保留成功结果、只重试失败范围。零结果不与失败合并。

### V-06 Ask

主动问答→选择实际来源/处理边界→有权证据→带 revision/anchor 引用→打开原位置；零证据/冲突/过期/撤权、模型失败和 prompt injection。确认找内容仍工作；动作不自动执行。

另验自然语言条件和语义检索：展示可修改条件，处理范围不扩大；未配置/失败的模型不阻断关键词、附件名和功能别名检索；输入建议不触发外发，D 区正文不进入远端模型。

### V-07 Source lifecycle

注册→schema/权限验证→授权→snapshot/catch-up→ready→更新→暂停→移除→purge；真实 receiver 显示各状态。提取/索引任务失败不增加收录数；provider fake/fallback 不计产品通过。

### V-08 域内附件 / 功能 / 域外拒绝

Peers 管理附件随消息/知识/帖子进入存储→名称/正文检索→在父对象上下文中预览/打开→父对象撤回/受众缩小/删除→附件名称/正文/缩略图/计数同步消失；新设备历史未恢复时显示真实覆盖。确认 D 区附件正文、路径与向量从不上传 Station/外部模型。

功能输入别名→命中当前账号可用入口→打开表单→由原域执行，证明搜索本身不产生副作用；不可用/未安装入口不显示为可用。否定证明：公网搜索请求、OS 目录/文件路径、外部 connector endpoint 经 UI、descriptor、Applet、MCP/Skill 任一通道提交都被拒绝（SCOPE_OUTSIDE_SEARCH_DOMAIN），且不存在可绕过的配置开关。

### V-09 Extension conformance

对 query/derived-index、域内附件与 Applet adapter 执行同一来源 contract：重复 ID 拒绝、未知 filter 拒绝、域外 kind 拒绝、分页不重复、取消停止后续读取、授权过滤 title/count/snippet、迟到事件不复活、卸载清理和真实原对象打开。Applet 页面未挂载时符合 declared execution binding，不能偷偷挂完整 UI。

Model/TypeScript/Rust/Go 的 query intent、resource、source state 和 rank channel 对齐；同叶子不重复融合，不同 vector space 不混用。真实新 Applet 接入只提供 descriptor/binding/adapter，不新增全局页面分支或第二权限库。

## 5. 质量评价

使用有权、脱敏、可重复的 corpus：中文短词/句子、混合英文、ID/handle、标题/正文、人名同名、附件、空/长文本、编辑删除、权限组和大规模数据。标注 query intent 与 relevant resource，按来源/语言/类型比较 Recall@10、MRR/NDCG、zero-results 和 open success。

性能记录首条可用结果、结果收敛/coverage、native index latency、fan-out、cancel latency、内存/索引体积、rebuild 时长、弱网与旧设备。目标数值在产品基线后确定；已有独立组件测量不等于产品性能 PASS，详见[可行性研究](./feasibility.md)。

Suite 持有构建、客户端、账号、设备、Station 和索引 fixture；场景只持有命名空间数据与真实操作。同一底层 query/open Journey 运行一次，多 Gate 引用分项断言，避免每个来源重建/登录。证据绑定 source/runtime/provider/index generation，变更后不能继承旧 PASS。

## 6. 确认后应产生的产物

用户已给出封闭检索域（Peers 域内、端 + Station、当前 actor 有权限）、AI、功能搜索与 Chat 默认落点的方向。具体 S-01～S-17 / SEARCH-* 产品合同、记忆选择与 AI 处理边界仍为草案；确认后制作现有 Shell/Prototype Lib 中的连续原型并完成动态审阅，再按已确认能力产生正式执行计划、注册与真实证明。

当前产品与架构仍为设计草案。独立组件研究已完成真实公开文档的加密 FTS、PG、受控文件边界、协调器合同及模型实验；中文跨语言 semantic/简单 hybrid 排名未达标，结果与限制见[实验记录](./feasibility-evidence.md)。其中受控目录与公共 RSS 实验只作历史机制证据，不属于封闭域产品能力。

原型、默认落点代码、生产 Search provider、域内附件/索引迁移、部署、产品性能验证和上述 V-01～V-09 均未执行，保持 NOT RUN/UNPROVEN。受控 SQL reader 标签不替代真实 actor，本机 ONNX 不替代 Agent provider/readiness，域外来源拒绝仍需否定证明。
