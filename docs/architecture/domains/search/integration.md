# Search 集成与验证合同

> **Status**: active
> **Created**: 2026-10-22
> **Owner**: Search / Client / Station
> 本文定义目标映射与验收义务，不是冻结执行计划，不表示已完成生产验证。

## 1. 现有能力如何接入

**门户与默认落点**：普通启动、登录完成与账号切换默认进入 `chat`；Search 按钮/已确认快捷键主动打开 Search，关闭或返回恢复原页。实施须同时检查 `types/navigation.ts` 默认值、hash fallback、identity warm-resume/last-active-page、无效对象跳转、Search descriptor 与前后导航；不能只改一个常量，让旧 Search 恢复路径继续自动显示。明确对象深链由独立导航合同处理。

D04–D06 源码接线：Shell singleton overlay 消费生成 query/source/coverage contract；旧 `SearchPage` 与成功空 native 命令物理删除，`searchRuntime`/store 替换为唯一 session owner。静态功能目录与账号 eligible source 分开；同账号导航上下文保留，身份/session/Station scope 变化取消并清理。Search UI 按需挂载；本机缓存复用前只读原 Messaging 状态版本，焦点/可见性及 2 秒轻量核对兜底漏事件，不重复 FTS。导航从 URL 前缀猜测切到 Messaging 原对象打开接口。ToolsTab 搜索商设置整条链已删除，真实运行证明仍单独核验。

消息 Open 先 native `resolve`，再由 Messaging 查询可读历史窗口。`messaging_list_messages.anchor_message_id` 与分页 cursor 互斥，主消息只读至目标 sequence 的有界窗口；回复进入原线程。虚拟列表先 `scrollToIndex` 再定位可见节点、还焦与高亮。返回搜索恢复同会话 query/mode/order/scroll；身份变化立即关闭返回入口。功能目录只导航真实 Settings 分区，未知分区/写操作不伪装成可用入口。

**人际消息**：复用 `messaging_message_search_fts` 和 Messaging runtime；由索引 Owner 提供会话/跨会话 scoped provider，保留 hidden/retracted/moderated 与恢复进度。门户、现有 MessageSearchModal、Mobile history search 使用同一查询能力，不能重新全库扫描正文。

**人员**：复用 Identity/Federation catalog 与 resolve，区分联系人/已知对象/当前联邦目录/完整远程 handle。将现有 Desktop discovery 与 Mobile people search 的 request identity、错误与 context 要求纳入统一结果 contract。

**Social**：原域提供公开帖/评论、受众/治理与 discoverability；私密正文在 Secure Content 允许边界处理，comment/read 必须考虑父帖。现有 feed/detail read 不能直接当作完整全文索引接口。

**Agent**：现有 Desktop topic 扫描与 Station `session_search` 是输入资产。应由 Agent Owner提供 actor-authorized message/topic provider，带真实 coverage、分页和稳定 anchor，替代前端无界扇出。当前 agent ID 工具查询不能未经 ownership 审核直接暴露全局用户入口。

Agent inference 复用当前 provider/runtime owner；completion、embedding、rerank 分别证明可调用与实际边界。Search 不增加第二套凭据/模型目录；已有 `KnowledgeClientResourceRef` 和 capability/readiness 用于资源身份与设备能力，不能直接当作全文检索已就绪。strict device-private 内容不进入 Station 模型；缺端侧 inference 时保留本机检索。

**Note / 知识 / 域内附件**：使用各自对象 ID、read-policy、revision 和 extraction task；附件随父消息/知识/帖子继承可见性；覆盖状态明确 title-only/body-ready/OCR-ready 等。没有业务 provider 时保持不可用，不以新 Search stub 宣称内容可搜。不存在独立 OS 文件来源。

**功能入口**：Shell/Settings、业务模块与 Applet 提供受信任功能 descriptor 与真实 navigation/action binding。搜索名称、别名、用途并打开原操作面；只显示当前账号 eligible 的入口；Search 不自己实施功能写入，也不通过显示名称猜路由。

**Applet**：未来真实接入时由 SDK/Host 解析通用 contributor binding 与既有
授权；内置、第三方和 standalone 只在能力真实可用时接入，且只能贡献其拥有
的域内对象。Applet 内部 resource 打开沿 launch options/Host resolver。
`web-search` Applet 的公网 search 路由不进入 Search 来源集合（D-19）。

Applet 当前只验证通用 descriptor/binding/adapter 留有干净接入口；具体 SDK、
部署与授权委托在真实接入时沿 Host 合同实施，不是本次设计门槛，详见
[extensions.md](./extensions.md)。贡献本域对象不自动取得其他来源读取或管理权。
现有 file API 是 Applet 沙箱读写，不扩大为 OS 文件检索。MCP/Skill 只有暴露
域内自有对象、稳定资源、coverage 和授权的 adapter 才能贡献来源。

**缓存与复用**：统一有效性/失效规则由 headless Search runtime/application
持有，入口不各建缓存；正文复用原域 read cache，Search 只保留必要投影、页与
session 引用。现有 `client-chat-core` 经 `client-storage` 持有受保护派生缓存，
是读侧复用资产，不证明 Search 已实现相同机制，也不要求 native core 直接
导入 TS 包。实际 storage/read port 由运行边界适配，见
[design 第 4.1 节](./design.md#41-共享缓存与实际读取路径)。

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

对 query/derived-index、域内附件及未来接入的外源 adapter 执行同一来源
contract：重复 ID 拒绝、未知 filter 拒绝、域外 kind 拒绝、分页不重复、取消
停止该订阅者后续读取、授权过滤 title/count/snippet、迟到事件不复活、卸载
清理和真实原对象打开。外源 adapter 按声明 binding 执行，不能偷偷挂完整 UI。

Model/TypeScript/Rust/Go 的 query intent、resource、source state 和 rank channel 对齐；同叶子不重复融合，不同 vector space 不混用。真实新 Applet 接入只提供 descriptor/binding/adapter，不新增全局页面分支或第二权限库。

### V-10 Cache / Reentry

对应 S-18/SEARCH-REUSE。先记录首次 query、正文读取和 authority 校验，再在
同一 runtime/账号/数据版本下验证以下行为；调用次数是验收断言，不是当前实测。

- 不变目录反复搜功能不重取声明、不调用模型；同条件有效查询、退格重输、
  Overlay/完整页切换、打开后返回/关闭重开，来源 query 与正文读取均为零次，
  输入、已加载页、选中与滚动恢复。新词/过滤条件不得使用旧截断页伪造完整。
- 选择/鼠标移经结果不无界取详情；相同有效预览零正文读取，缺字段按需读取。
  已加载页零重查，未加载页仅执行 continuation；cursor 到期不延寿，已加载
  可读页保留。原对象打开复用正文仍接受原 owner 当前权限和 anchor 裁决。
- 内容过期但读权有效时先显示带 freshness 的内容、有界更新；显式刷新即使
  命中也检验版本，unchanged 不重传正文且不自动续授权。断网、权限未知或
  私密租约到期不得借 stale-while-revalidate 显示旧标题/正文/计数/引用。
- 新内容使相关 query/empty cache 失效；编辑/隐藏/删除和父对象权限变化更新
  所有依赖投影。成员退出/受众缩小/来源停用/绑定替换后，warm cache、旧
  cursor 和迟到响应不泄漏或复活对象；A→B→A、lock/unlock、logout 单独覆盖。
- partial/timeout/failed 不缓存为 empty；后台失败保留可读旧值及真实状态。
  不相关来源的目录和正文仍可命中，不因一次变更全量重读。
- 两个有效订阅者共享同授权读取，取消一个不影响另一个；最后取消中止底层
  读，deadline 不被延长。批量 hydrate 只读 misses/失效字段，旧响应不覆盖
  新 revision/tombstone，也不改签为新 intent。
- 数量/字节额度和 LRU 淘汰有界，淘汰后正确回源；no-store、不允许持久化的
  字段及 D 区明文不进入错误 storage/Station/provider。短期恢复不启用持久
  搜索词历史，重启仍进入 Chat。

交叉序列必须覆盖：

- 同一 hydrate 批次包含 changed、unchanged、unavailable 和 retryable；
  outcome 与请求项一一关联。缺项/重复/额外项是协议错误，不写不存在负缓存；
  无 payload 的 unchanged 不形成空正文，内容未变不单独续权。
- 页面静止且无新请求、隐藏后恢复、设备休眠跨 read expiry、时钟变化和
  policy stream gap；已展示私密内容按当前读权主动遮蔽，恢复前校验。
  content index gap 与权限不确定分开，离线许可只沿原 owner 合同。
- 旧读在途→delete/hidden/revoke→payload/负缓存 LRU 淘汰→取消未及时生效的
  响应返回；operation 失效屏障不被淘汰，直接查询 adapter 同样不复活。
- Q1 第一页→换词→同词 Q2 命中→Q1 取消→Q2 翻页；分页归属有效 session，
  发布归属 Q2。两个入口保持独立浏览位置，continuation/已发集合串行推进，
  不重复、不混快照、不延长原 expiry。
- 两个 subscriber 共用读时，首个取消或 deadline 到达只 detach 它；
  最后退出、source 失效或底层预算到期才取消 operation ctx。新 attach
  不恢复旧 operation 的提交资格。

证据包含真实客户端恢复/遮蔽、原对象 receiver 结果和脱敏的调用/字节计数，
按冷读、有效命中、过期、权限失效与淘汰分开记录。不能只凭命中率或服务端
contract fixture 宣称用户体验、撤权安全或原对象打开已通过。

## 5. 质量评价

使用有权、脱敏、可重复的 corpus：中文短词/句子、混合英文、ID/handle、标题/正文、人名同名、附件、空/长文本、编辑删除、权限组和大规模数据。标注 query intent 与 relevant resource，按来源/语言/类型比较 Recall@10、MRR/NDCG、zero-results 和 open success。

性能记录首条可用结果、结果收敛/coverage、native index latency、fan-out、
cancel latency、内存/索引体积、rebuild 时长、弱网与旧设备；另记录缓存冷/热
恢复、原文读取与权限校验次数、传输字节和请求合并。目标数值在产品基线后
确定；已有独立组件测量不等于产品性能 PASS，详见[可行性研究](./feasibility.md)。

Suite 持有构建、客户端、账号、设备、Station 和索引 fixture；场景只持有命名空间数据与真实操作。同一底层 query/open Journey 运行一次，多 Gate 引用分项断言，避免每个来源重建/登录。证据绑定 source/runtime/provider/index generation，变更后不能继承旧 PASS。

## 6. 确认后应产生的产物

用户已给出封闭检索域（Peers 域内、端 + Station、当前 actor 有权限）、AI、功能搜索与 Chat 默认落点的方向。具体 S-01～S-18 / SEARCH-* 产品合同、记忆选择与 AI 处理边界仍为草案；确认后制作现有 Shell/Prototype Lib 中的连续原型并完成动态审阅，再按已确认能力产生正式执行计划、注册与真实证明。

Desktop「找回 + 打开」与 D-20 contributor/cache 合同已经确认并实施。
独立组件研究包含加密 FTS、PG、受控文件边界、协调器与模型实验；中文跨语言
semantic/简单 hybrid 排名未达标，限制见[实验记录](./feasibility-evidence.md)。
受控目录与公共 RSS 实验仅为历史机制证据，不属于封闭域产品能力。

V-01～V-10 的跨来源完整目标保持 NOT RUN/UNPROVEN。Desktop/Mobile 所选原生
Acceptance 覆盖消息 query/open、缓存复用/刷新、会话失效、分页与非法
scope/资源拒绝。正式 Journey 使用真实 Messaging 投递与接收；Desktop
回归包含原业务变更后的缓存失效与权限拒绝。早期隔离数据库探针仍只是开发
证据。指定源码、环境、不可变 run ID 和未证明范围见
[原生证明快照](./acceptance-evidence.md)，实际效果见执行计划的 outcome comparison。
真实产品性能分布、实机、OS 后台/锁屏和跨来源完整证明仍未运行。
本机 ONNX 不替代 Agent provider/readiness。
