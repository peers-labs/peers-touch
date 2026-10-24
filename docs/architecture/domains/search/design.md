# Search 技术设计

> **Status**: active
> **Created**: 2026-10-22
> **Owner**: Search / Client / Station
> **Basis**: 封闭域与 Desktop「找回 + 打开」方向、Shell 原型已确认；
> Mobile 已接受同一查找/打开范围。已授权多来源与 Social 接入；实现与原生证明
> 分别核验。Federation、Ask 尚未实施。

## 0. 设计依据与层级

本合同位于 Search 业务域，因为它约束跨模块检索、内容接入、覆盖和派生数据。Desktop/Mobile 平台文档细化 Host 与 UI 生命周期；Agent、Messaging、Social、Identity、Applet 继续拥有各自真源。Model 是双方生成类型的协议层。

- **verified_fact**：Desktop/Mobile 原生入口、跨会话 FTS 与读取协调器消费同一 `search-core`；Desktop 覆盖层、Mobile 按需详情及旧链删除已落地。路径见 [module-layout.md](./module-layout.md)，所选原生证明见 [证据快照](./acceptance-evidence.md)。
- **verified_fact**：Applet SDK 已提供 file、navigation、tasks、agent、ai API；`file.*` 的 Desktop native 实现使用 `applets/{id}/files` 沙箱，不是 OS 用户目录许可。当前 SDK 和 manifest 未提供 Search 专用协议。
- **verified_fact**：Agent 已有 `CapabilityManifest`、connector/knowledge resource、readiness 与 execution-owner 合同。原生模型调用与本地 MCP 是不同所有权，Search 不将它们合并为自有通道。
- **inference**：缺少内容接入/打开/覆盖闭环是门户弱化的重要结构原因；各独立能力的源码存在不证明当前 Search runtime 可用或性能达标。
- **component_observation**：[可行性研究](./feasibility.md) 实测 SQLCipher/FTS5、PG、受控文件边界与本机模型；基础索引机制可行，默认中文短词遗漏及 E5 跨语言召回不足均已观察。它不证明 production Search 或手机资源预算；其中公网 RSS 与受控目录实验只作为历史机制证据，封闭域决策后不属于产品能力。
- **accepted_direction（用户决策，2026-10-22）**：检索宇宙封闭在 Peers-Touch 域内（端 + Station），只返回当前 actor 有权限的对象；公网、OS 任意文件、外部 connector 不进入来源集合。详见 [D-19](./decisions.md)。
- **accepted_direction**：一份协议、两级执行、可替换索引 adapter；本期已实施 Desktop/Mobile D 区消息与功能导航。产品预算、完整中文检索质量和 Agent 模型调用闭环仍待基线验证。
- **unproven**：域内附件正文提取覆盖、模型 embedding/rerank 的公共调用闭环、全域 batch read-policy、Federation 按需查询、实机/OS 后台锁屏 Journey 与现场性能。不得凭 SDK 方法名或行业实现补全。

架构 active 表示边界有效。[执行计划](./execution-plans/20261022-device-search-find-open/plan.md) 保留冻结的 Desktop 切片；后续已授权的 Mobile 实施见其平台与验收合同。所选 macOS/iOS Simulator/Android Emulator 原生 Journey 已在[指定快照](./acceptance-evidence.md)通过，后续源码需重验。后续章节的 S/F、语义与其他 contributor 是目标合同，不冒充已部署能力。

## 1. 原则与所有权

Search 是跨域检索能力与派生投影 Owner。业务对象、可见性、历史读取、删除/撤回、身份、Federation 访问和写操作仍由原域决定。

**封闭检索域**：Search 的检索宇宙只包含 Peers-Touch 平台拥有的对象——端上私密对象、Station 业务对象，以及在联邦授权上下文中可见的对端对象。公网网页、Peers 之外的 OS 文件/目录、外部网站与 SaaS connector 不是 Search 来源，也不提供配置入口。

系统仍为 Client ↔ Station；Model 是双方使用的协议层，不是第三个运行时。采用两级聚合：

- **Client Search Coordinator**：合并本账号端侧私密内容、域内功能目录和 Station 返回的可见结果；持有本轮 query identity、排序快照、取消、预览和返回上下文。端侧私密内容不经过 Station。
- **Station Search Application**：在当前 actor 权限下调用本站域 adapter、查询本站派生索引，或经现有 Federation 协议按需查询对端授权对象；持有远端 fan-out、预算、分页和来源状态。不调用任何公网搜索商或外部 connector。

禁止 Station 回调客户端获取私密明文后集中建索引；禁止 Renderer 直接查询任意业务数据库；禁止各页面创建自己的全局刷新/扇出机制；禁止新增域外来源 adapter。

人员、消息、Social、Agent/知识、域内附件、Applet 贡献对象、功能是来源/资源维度；keyword/semantic/rerank 是检索策略，Ask 是证据消费意图。同一 contributor 可支持多种策略，AI 不另建一套来源、权限或查询结果 owner。

### 1.1 信任区与对象归属

| 信任区 | 对象 | 正文/索引位置 | 远端可见性 |
|---|---|---|---|
| **D 端侧私有** | E2EE 已恢复消息、端侧私密 Agent 记忆、设备私有附件、本机搜索历史 | 仅本账号受保护存储（SQLCipher/FTS 等），含 embedding | 永不上传 Station/外部模型 |
| **S 本站授权** | Social 帖/评论、会话元数据、Agent 会话/知识/笔记、Peers 管理附件、人员目录 | Station 派生索引，行级 actor/ACL 约束 | 仅 actor 经当前 read-policy 可见 |
| **F 联邦授权** | 对端 Station 上当前联邦上下文可见的人员、帖等 | 不整站抓取；按需经 Federation 协议查询，只缓存被授权投影 | 由对端 Station 按 actor 实时裁决 |

“Peers 管理附件”指通过平台消息/知识/任务进入平台存储的文件，随父对象继承权限；它与 OS 用户主动选择的任意外部目录有本质区别，后者不在范围内。

### 1.2 当前 actor 权限执行链

actor 身份只取自认证上下文（跨边界一律 `ptid`，禁止自报 user ID 或内部 `actor_id`，遵循 [Actor Identity Boundary](../../../knowledge/invariants/actor-identity-boundary.md)）。每个对象在返回前经过四道链：

1. **准入**：只有域内 contributor 可注册；schema/能力/绑定校验通过才 eligible。
2. **索引/候选过滤**：D 区索引按账号密钥隔离；S 区查询带 actor 谓词；F 区查询携带认证的联邦身份，由对端裁决。
3. **当前读权 hydration**：标题、片段、计数、facet、建议、AI evidence 发布前，
   以原域当前 read-policy 或仍有效的 authority read lease 裁决。有效缓存可
   复用，缺失/过期才批量复核和补齐投影；deny/unknown 直接丢弃且不区分
   “不存在/无权限”。当前读权不等于每次远端重取正文。
4. **预览/打开再校验**：preview 与 Resource Resolver 使用当前上下文判断
   revision/权限/定位可用性，可复用有效投影与绑定；原域保留最终打开裁决。

建议、历史、count、snippet 与 AI 回答全部走同一条链；不存在“仅标题可见”的旁路。撤权/删除/隐藏事件立即阻断读取，再异步清理派生物。

### 1.3 禁止关系

- 禁止公网搜索商、外部抓取/connector、OS 目录/系统索引 adapter 进入 source registry。
- 禁止跨 actor 检索接口、调试“搜全部”入口或 Station 集中保存 E2EE 明文/向量。
- 禁止 Renderer/Applet 自报 actor、自注册服务端 adapter 或指定任意 endpoint。
- 禁止把“已安装/已连接/可联网”当作可读授权；Federation 可达不等于可目录发现。

## 2. 检索流与信任边界

```text
Portal / Shortcut / Scoped UI
  → 当前账号 Search intent
  → Client native/headless Coordinator
      ├─ D 区 provider → 本账号受保护索引（消息/私密记忆/私有附件）/ 功能目录
      └─ Station request（认证 actor 上下文）→ 原领域 Search read application
                              ├─ S 区 domain query adapter（当前 actor 谓词）
                              ├─ S 区 derived index（行级 ACL）
                              └─ F 区 Federation on-demand adapter（对端裁决）
                           → batch read-policy hydrate → 可见结果
  → 合并 / 去重 / 排序 / coverage（只含域内对象）
  → 结果与按需预览 → 原域 Resource Resolver → 原对象
```

输入包含当前 actor/session、profile、Station 与 Federation scope；这些由 Host / Station 认证上下文取得，不能相信来源声明或请求正文自报 user ID。

内容域执行 authority read、policy 和生命周期；Search 只取得必要投影。公开内容是否允许目录发现由原域表达。来源不能把“已安装”或“联邦可达”变成“可索引所有数据”。流中不存在公网或 OS 文件分支。

## 3. 来源接入与供应者执行

采用一个 Search Contributor Contract，内置域和受信 Applet 使用同一语义。它定义哪些类型/字段可搜、哪些用户/作用域允许、在哪个信任区处理、如何查询和打开、如何撤权和删除。协议详见 [data-model.md](./data-model.md)。contract 拒绝域外来源类型（公网、OS 文件、外部 connector）注册。

两种检索模式：

- **query adapter**：复用已有领域检索/目录 API；声明过滤、排序、游标、覆盖和重校验能力。对小型设置/入口也可以是已授权的内存索引。
- **derived index**：业务提交后通过可靠变更投影写入索引；必须提供完整快照、增量、删除和权限事件。

两种模式都必须经过 schema/capability 校验、权限否定用例、open Journey、分页/撤权/删除证据后成为 eligible 来源。只完成 manifest 注册的来源为 registered，不能冒充 ready。

Applet 注册经 Host 授权，静态声明由受信任 Host 固化；Renderer/Applet 不能自行注册任意服务端 adapter 或指定 actor。扩展执行沿现有 bridge/service/task 权限，不另开无审计插件执行通道。来源返回的是可验证的 resource reference，不能返回脚本或未经校验的 HTML。

域内来源固定为：Messaging（D 区 FTS）、Identity/人员目录（S/F 区）、Social（S/F 区）、Agent 会话/知识/笔记（D/S 区，按处理策略）、Peers 管理附件（随父对象 D/S 区）、受信 Applet 贡献对象（按其声明的边界）、Shell/模块功能 catalog（导航而非内容）。不存在 OS 文件授权 adapter 或 Web 搜索商 adapter。

Search source registry 是检索能力投影，不重新拥有 Applet 安装、Agent capability、Federation 关系或附件存储。它引用原 owner 的稳定 ID/revision，再保存检索字段、可支持条件和 index coverage；来源撤销由原 owner 的状态收敛到 Search。

扩展方式、公共 port 和独立演进合同见 [extensions.md](./extensions.md)。source、retrieval engine、extractor、function action 与 Agent answer 是不同扩展点，不使用一个万能插件接口。内置模块也遵循相同接入语义。

### 3.1 组件关系与生命周期

- **Shell / Search UI**：输入、范围选择、结果、预览和返回位置；消费 typed query events。UI 可触发查询或打开，不能直接查数据库、持有来源凭据或决定业务权限。按钮常驻，页面按需挂载；只显示一个预览。
- **Client Coordinator**：由客户端 Search runtime 持有，输入为 query intent、认证快照和 eligible sources，输出为 result batches/coverage/cursor。依赖源查询 port、policy hydration 和 Shell resolver；持有有界查询状态与统一缓存复用策略，不写业务对象。账号锁定/切换使它取消并关闭对应缓存分区。
- **Source registry projection**：输入已验证 manifest、安装/联邦关系 revision 和 readiness；输出当前身份可参与的域内 source set。静态 schema 可进程级缓存；授权集合按账号/会话持有。不能将 source 自报的 actor/permissions 当 authority。
- **Local source adapters**：由设备 Search executor 调度 Messaging FTS、端侧私密记忆/附件索引与功能目录，返回候选、rank/provenance 和 coverage。只访问本账号授权读端口；不能经 UI 遍历全量正文或请求 Station 获取 E2EE 明文，也不读取 Peers 存储边界之外的 OS 文件。来源可以随调用短暂激活，不必挂载页面。
- **Station 来源 read adapter**：当前由原 Social application 持有，输入认证
  上下文和 query，复用原 domain/repository 与 batch read-policy，返回必要
  投影和真实来源状态。其他本站来源与 Federation 按需查询仍是未实施的目标；
  不据此创建平行 Search subserver。限并发、限候选、限时间；不访问本机目录、
  不调用公网搜索/外部 connector、不继承另一 actor 凭据。
- **Index projection workers**：由各信任边界的后台 runtime 持有，输入 snapshot/change/extraction 状态，输出 index generation/checkpoint/coverage。只写派生索引；grant/source/policy revoke 优先阻断读取。与 UI 查询共享 IO/CPU 预算，但无页面挂载依赖。
- **Agent model / evidence adapter**：输入允许的 query understanding 或已授权 evidence bundle，返回条件、rerank/embedding 能力结果或 cited answer。复用 Agent provider/runtime；不能新增另一套凭据、Turn 或自动副作用。只在提交后按处理策略调用。
- **Shell Resource Resolver**：输入 typed ResourceRef/action ID，调用原域或 Host 在域内存储边界内打开/预览；输出 opened/unavailable/permission-required。它不猜 URL 前缀，不打开域外任意路径，也不把对象 metadata 当执行脚本。

这些是逻辑组件。部署仍复用 Client native runtime 与 Station subserver；无需为每组件建立独立服务、队列系统或数据库。

## 4. 查询计划、调度与取消

统一解析 normalized text、phrase、typed filters 和 scope，得到 QueryIntent AST。编译为各来源支持的约束，SQL/FTS/engine 使用参数化 API；普通搜索文本不直接作为任意 FTS/SQL 表达式执行。

每个 subscriber 捕获 `intentId + identityEpoch + sourceSetRevision + policyEpoch`。
A→B→A 必须形成三轮不同 identity；结果、AI chunk、预览和分页只向当前有效
subscriber 发布。subscriber 取消只停止其订阅/发布；共通 wrapper 持有独立
operation ctx，最后 subscriber 退出、来源失效或 operation deadline 到达
才中止 native/HTTP/backend。来源不以首个 intent 的 ctx 持有共享读 lifetime。

计划按成本和信任域选择来源：本地名称/消息优先出结果，Station 域异步补齐，Federation 仅在已授权联邦上下文内按需调度。来源类型筛选缩小执行图，不先搜索全部再前端过滤；计划中不存在公网/OS 文件分支。

输入建议与提交查询分开调度：建议只来自我机/本站域内来源；语义 embedding 或 Ask 的模型调用按 processing policy 决定执行位置（端侧或 Station），不因每次按键自动外发。查询策略记录 keyword/semantic/rerank 与实际处理边界；自然语言理解不能扩大可读范围、移除用户筛选或追加未允许来源。

实现复用 Go `context`、受限并发/单飞与既有 transport；不自研完整作业引擎。必须声明 per-source timeout、候选/字节上限、总 fan-out 预算、公平性与 rate limit。具体参数在 corpus/设备测量后冻结，当前不伪造 SLA。

完整来源失败返回 failed/timeout/unavailable；其余来源继续。单来源重试带新 attempt ID，成功结果不反复执行。预算耗尽保留 partial 与 coverage；不将错误压成 `results: []`。

规划优先使用确定的 URL/身份/功能别名、显式条件和低成本查询；模型仅增强模糊意图，不是查找的必要前置。计划中 remote allow、local grants、模型策略和预算固定，模型只能细化允许范围。输入改写、scope 扩大或深度研究产生新 intent/revision，不静默增加成本。

交互查询、手动重建与后台提取分为独立优先级；每 actor、source、grant 有有界队列和 fair scheduling。过载先暂停后台任务，再拒绝超额查询/候选并返回 partial/overloaded。重建、OCR 和 embedding 不在用户 query 中现场执行；没有绑定预算的来源不能 ready。

### 4.1 共享缓存与实际读取路径

Desktop 与 Mobile 原生宿主消费同一 `search-core::runtime::SearchRuntime` 和
`requests::SearchRequests`。核心持有读协调、资源批量补齐、规范缓存键、取消、
逐项回复校验与内存缓存；`SearchExecutor` 注入调度及 Future 执行，
`SearchBinding` 注入当前认证分区、原来源水位、Contributor 构造和发布锁。
核心不 import AppState、Tauri、MessagingEngine 或 SQL 驱动。平台保留身份与
原 Store 的锁顺序，缓存提交和最终 IPC bytes 发布都必须通过同一裁决。

宿主在阻塞线程上使用现有 `futures-lite` 驱动 Contributor Future，不进入
Tokio 异步执行上下文。原 Station 传输提供同步响应读取；在 Tokio Future
中调用该读取会触发 `blocking_recv` panic。Search 不替换原传输，也不为每个
来源创建异步运行时；Desktop/Mobile 执行器共同承担这条适配边界。

认证分区来自平台 Session，独立于 MessagingEngine。当前生产 composition
声明 `device.messaging`、`device.social`、`station.social.public`；
每来源独立检查 readiness、binding、content/policy revision。Messaging 不可用
不能阻断 Social。空输入 recent-conversation 语义只由 Messaging Contributor
提供，通用核心不改写业务类型。

`SearchBinding::read_authority` 区分本机 `LocalSnapshot` 和远端 `RemoteOwner`。
本机读回复必须与原 Store 的冻结 content/policy 水位相同，再在原 Store 锁内
发布。远端 Host 只冻结认证分区、原 owner/source/binding 与 actor read scope，
读取前不虚构 content/policy observation；远端回复保留原 owner 实际观察版本。
不同 HTTP 读取可观察不同 PostgreSQL 快照，不把预先查询的快照当下一次读取的
权限水位。当前远端模式强制 no-store、owner-check、零离线租约；补齐结果更新
当前响应的逐来源观察，continuation/resolve 再由原 owner 核权。本机出版锁仅
防止身份/路由切换，不能宣称服务器权限变更已被本机锁线性化。

受信 contributor descriptor 可声明 authority namespace 根。共同验证器只接受
该根自身或以冒号分隔的后代；不接受任意字符串前缀或通配符。公开 Social Host
固定根 `social:public`，原 owner 从持久化原作者 Home Station 生成后代 namespace；
Renderer/candidate 均不能扩大 descriptor 的授权根集合。

共享 query session 协调器按 generated `kinds/scopes` 集合选择并收窄来源；
suggestions 只选 Device，主动提交明确允许 Device 与当前 Station。
私密 Social 没有离线读租约时不生成正文建议；建议过程不得为它请求 Station。
每来源候选上限 100，最终页默认 20、最大 100；最多三个来源，
所有来源并发共用最初 5 秒 deadline。候选、已发 identity、各来源 continuation
和首次 expiry 由有界客户端 session 持有，opaque authenticated cursor
仅引用 session。来源改变或到期拒绝旧 continuation，串行推进避免重复/丢失。
跨来源使用 rank 融合，不比较 raw score；来源失败独立报告 coverage，
成功来源结果继续可用。读缓存与 session 候选共享总内容上限 8 MiB，
沿既有 200 展示行、32 frames、640 items 上限约束 admission。

响应使用 source state 向量与逐项 read validity；来源失效只遮蔽对应投影。
全局 resolve 经受信 composition 的原域 opener registry，未知 binding 拒绝，
不返回任意 URL。SocialComment 使用独立 comment ID 与 typed SocialPost parent；
原域打开接口取得历史目标帖和有界评论 anchor 窗口，返回由 Search 保留上下文。
查询与原对象打开分别持有操作生命周期。来源失效立即遮蔽查询投影，但原域
打开的读取/回填不取消自身；打开仍由原域当前读权、结果可用性及身份/用户
intent 屏障裁决。打开期间不启动查询重读，完成后若仍显示 Search 再协调。
查询协调在每次异步等待后重新检查 Open 状态；等待前的空闲观察不能授权
等待后的重读或错误投影，避免已开始的原对象打开被迟到协调覆盖。
Social 评论的 ResultItem.title 是原域复核可读的父帖摘要，snippet 是评论命中片段；
帖子仍以自身正文提供 title/snippet。两端以原 Social 身份投影显示作者、类型和时间，
不在结果行另建 profile 查询或正文缓存。父帖不可读时，评论及其父帖摘要一并消失。

Contributor 的 descriptor 构造可能读取原 Store，不能在持有 Store 发布锁
时再次取得该锁。核心先在当前绑定下复用已登记实例；缺失时在锁外构造，
随后在身份和原 Store 发布锁内核对水位再登记，拒绝迟到的旧身份实例。
Desktop 被替代的通用协调器与请求 owner 同步删除，不保留并行查询路径。

`messaging-core::search` 唯一持有消息 Contributor 的 query/hydrate/resolve
协议实现。它消费 `MessagingSearchReader` 的授权候选和批量投影；Desktop/Mobile
原 Store 分别执行 SQL、权限和内容读取，Search 核心不复制原域策略。
显式 `conversation_id` 同时约束查询、缓存语义和签名 continuation。
`attachment_names_only` 是同一原 Messaging 查询的字段条件，只匹配 FTS
附件名称列，并返回所在消息地址。它参与生成协议、缓存和 cursor 语义；
不等同于附件正文检索或独立附件资源。

Mobile 按 OAuth admission → native lifecycle event → 对应来源 active →
原域 Store revision 的锁顺序发布。OAuth 的异步操作只持有 active 标记，
不跨 await 持有 mutex；读取拒绝操作中的或过期的 Session。OS background
事件在其原生边界立即拒绝私密发布，无需等待页面卸载。engine incarnation
与认证操作 revision 使 A→B→A 无法重新接受旧结果。
Mobile Search 详情按需挂载，runtime 保留一个结果页及有界分页/输入/选择元数据。
原生后台、内容变化或身份变化立即遮蔽结果；返回和恢复先核对原 owner
scope/revision/expiry。相同身份的生命周期 generation 变化保留用户输入，
新身份清空全部私密投影。界面和原对象定位合同见
[Mobile Search](../../../client/mobile/search-experience-contract.md)。

目标是 [S-18](./product.md#s-18-重复使用缓存与刷新) 的重复使用体验。缓存由
headless Search runtime/application 持有，位于 contributor 调用的共通读边界；
Overlay、完整页、局部入口和 Agent 复用同一有效性规则。Client/Station 在各自
信任区执行，缓存不跨 actor 或 D/S/F 搬运正文，不增加独立缓存服务。

缓存分工为：版本约束的静态声明/功能目录、授权分区内的资源投影、短期查询页/
负结果/session。持久派生索引仍由原索引 owner 持有，不能当成可随 LRU 删除的
查询缓存。正文优先通过原域 read port 复用已有 read cache；Search 只持有
必要的检索投影、引用及依赖，不给每个页面/provider 建另一套正文缓存。

每次请求从既有身份/registry runtime 读取当前认证、eligible sources 和读策略
快照，再定位规范复用键；不在每次按键重新发现来源、加载目录或联网取配置：

1. 内容与读权同时有效，直接形成当前 intent 的响应；不重查来源、不重取正文，
   也不为了证明“查过权限”强制发一个远端 hydrate RPC。
2. 只有内容过期、读权仍有效且允许旧值时，先显示带 freshness 的结果；
   一次有界后台条件读取更新内容。收到新匹配先提示更新，保持选中与滚动；
   delete/hidden/revoke 立即移除，不能等用户点击更新。
3. 缺失、字段不足或不能复用旧值时，按查询计划调用 contributor。候选批量
   hydrate 只补缺失字段或复核失效读权；内容未变时可使用 validator 确认而
   不重传正文。显式刷新检验内容更新，不全量清空其他缓存。
4. 读权未知、到期、撤销或分区变化时，不发布旧私密投影；必要的权限复核由
   原 authority 执行，允许后才继续读取。

预览按用户请求补齐，重复预览和原对象打开复用有效内容；原模块/Host resolver
拥有打开时的最终权限与定位判断。成员关系、绑定与定位变化仍需重新裁决，
复用正文不能绕过这一边界。

缓存有效性由 content validator/新鲜期与 authority/read-scope 独立决定。
稳定目录按 revision 复用；immutable 对象只保证其内容版本不变，不保证访问
许可永不变。可靠事件优先定向失效，无可靠事件的可变来源使用有界新鲜期和
条件读取；不能为所有对象设置同一 TTL，也不能让私密授权随正文 TTL 延长。
细化的键、元数据和失效规则唯一维护在 [data-model 第 7 节](./data-model.md#7-cursor缓存与复用)。

同授权操作可合并 in-flight，hydrate misses 批量执行；取消按订阅者处理，
最后使用者退出或 deadline 到达才中止底层读。缓存提交和响应发布分别检查
当前 source/binding/identity/policy/revision，拒绝旧响应复活删除对象或覆盖
新内容。intent/attempt 是发布屏障，不是复用键。

批量 hydrate 使用统一 HydrationRequest/Reply，明确逐项 changed/unchanged、
unavailable 与 retryable；字段/validator 在请求、读取有效性在响应，认证
ctx 只提供允许范围。省略项不是不存在，unchanged 不单独续权，也不能在缺
payload 时制造空投影。这样不同 adapter 不需要自行解释批量缺项。

读取权限由 headless runtime 持续约束。沿原 authority 生命周期在最早读权
到期点主动失效已展示结果、预览和引用；页面静止、隐藏、休眠不把失效延迟到
下一次请求。唤醒/恢复显示前判断，时钟回拨不能延寿。policy stream gap 使
依赖其连续性的读取 unknown；内容索引 gap 仅改变 freshness/coverage。

payload 的 LRU 淘汰不淘汰在途操作失效标记；直到旧读结束/超时才回收保护。
失效、缓存提交和可见发布由同一 owner 串行/原子裁决，旧 operation 不能因
新 intent 复用同词而重新获得提交资格；无需另建永久 tombstone/cache 服务。

### 4.2 返回、失效与成本边界

Desktop 表现层由 `runtimes/searchQueries.ts` 内唯一 TanStack Query
Client/Observer 管理查询订阅、取消和短期结果存储，替代手写 frames Map；
不接入 React Query Provider，也不新增 UI/CSS 依赖。原生 Search/Messaging
继续裁决权限、内容水位与读取有效性，Query 的 staleTime 不构成授权。
每次复用前与响应后检查原 owner read-state；账号、Session、Station 与
匹配的 Messaging 失效事件清除表现层查询分区。

输入草稿与已展示 query/mode 分离。Observer 仅在原 read-scope/revision/
expiry/lease 仍有效时允许 `keepPreviousData`；新结果原子替换正文和展示
query，防止旧行被新词高亮。120ms 输入 admission、200ms stalled 提示和
固定输入区状态槽保持列表几何；最早 expiry/lease 定时器主动遮蔽旧结果。
原生 cache/read port 是业务读取复用层，Query 是有界客户端结果订阅层，
两者不复制权限策略或建立第二套原文存储。交互规则唯一维护在
[Desktop Search continuity](../../../client/desktop/search-experience-contract.md)。

返回或重开时恢复短期 session 和已加载页，页面可以卸载。内部排序 session
持有 snapshot/continuation/已发集合；UI intent 是独立 subscriber，符合相同
查询和当前授权才可 attach，取消旧 intent 不取消新的 subscriber。页值仍有效即复用；
cursor 过期只阻止继续翻页，不清空仍可读的已加载内容。新的查询不沿用过期
cursor，也不把旧 event 改签为本轮响应。缓存淘汰后重新读取是允许的成本，
不保证无限期保留每次查询。

session owner 串行推进来源 continuation 和已发对象集合，subscriber 各自持有
浏览位置。最后 detach 停止在途读，可保留有界 session 值至原到期点；新 attach
仅创建新的读，不复活旧 operation。不可复用时继续翻页前建立新分页上下文，
不把新旧快照拼接；当前限定 D03 不因此被写成已支持完整共享 session。

来源变化使受影响的查询页、负结果、count/facet 和 cursor 失效；资源变化
只刷新相关投影和引用。无法精确确定匹配依赖时按该来源保守失效，不能漏掉
新内容而长期复用空结果。全部失败/partial 不写成功空缓存；后台更新失败
保留仍获准读取的值并显示真实状态。

缓存总量、分区/来源额度、字段/条目字节数和 session expiry 都受预算约束。
静态不变数据不反复轮询，敏感数据不因此无限期保存；lock/logout/revoke
先关读、清订阅与可见投影，再按原 storage retention 处理受保护数据。

## 5. 聚合、排序与分页

资源去重以 authority namespace 和稳定对象 ID 为准，不能按标题或用户名。消息、thread、附件与父会话不是同一对象；是否折叠由显式 parent/group relation 决定。

排序采用可解释阶段：

1. 精确对象 ID / canonical handle / title match 处理明确打开意图。
2. 来源内使用已声明 relevance 或 temporal ranking。
3. 跨来源使用 rank fusion（建议 RRF）合并，并限制单来源占满；不比较不同引擎的原始 BM25/semantic 分数。
4. 同等匹配可用 recency、用户明确固定/近期访问作有限 tie-break；不默认用社交热度决定私密检索顺序。

Source weights、fusion 常数与 personalization 需在标注 corpus 验证，属于待测参数。解释面向用户说明“标题匹配/正文匹配/来自选定范围”，不暴露内部分数。

渐进结果和稳定分页分开处理。当前选中/首屏已展示对象不随慢来源到达而跳位；显示补充结果提示，用户明确刷新时才重新排序。

分页 Coordinator 保留短期 query session：排序候选快照、各来源 continuation token、已发对象集合、未发候选、revision 和过期时间；数量有上限。cursor 不包含私密明文，绑定 actor/session/scope/filter/ranking/source-set。状态过期返回 `CURSOR_EXPIRED`，不能静默翻回第一页。

当前 D03 的单一 DEVICE/FIND/MESSAGE keyset continuation 复用 `search-core` 的
HMAC-SHA256 codec：认证完整位置字段、查询及窗口/账号/session revision/Engine
incarnation 绑定，最长有效期五分钟。AppState 生成进程内随机密钥，重启即失效，
不持久化密钥或查询。篡改、过期、上下文替换在读取来源前拒绝；消息检索先由
共享查询核心验证，纯标点等无 token 输入返回 `INVALID_QUERY`。完整混合来源
快照与 coverage 生命周期属于后续跨来源范围，本期单来源证明不覆盖它们。

数据更新/权限变化时，允许从当前页移除失效对象；结果快照不冻结权限。总量与 facet 只基于当前授权范围；重校验后缺乏准确全量就返回 lower-bound/estimated/unknown，不泄漏未经授权的 raw hit count。

### 5.1 关键词、语义与融合

精确 ID、附件名、数字与功能别名走 lexical path；描述性问题可在声明 semantic 的来源上并行召回。语义并不覆盖全部数据类型：函数/联系人小 catalog 可通过别名与有限候选重排完成，不要求建立向量库。

排名 channel 标识绑定 source/resource kind/retrieval strategy/index generation。Station 返回已授权的候选及来源内 rank provenance，Client 对本地和远端叶子 channel 进行一次最终融合；禁止重复合并相同 channel 或将已融合排名伪装成原始 source 排名。Station-only 查询可在 Station 完成同一合同的最终排序，响应明确 aggregation owner。

昂贵 rerank 只作用于有界且已授权候选，保留精确对象快速打开语义；模型失败使用已有 lexical/hybrid 排名。训练数据、长久个性化与自动记忆不是正确性前提。文本片段与时间排序各自有明确字段，不以一个 raw score 混合相关性与日期。

独立实验中，六个中文自然语言问题检索英文/混合文档，E5 量化与 FP32 前五均为 2/6，简单 BM25/RRF 为 1/6；同意图英文诊断为 6/6。RRF 只融合已有候选，不能代替双语 analyzer、模型/分块与重排质量证明。当前不冻结 E5 或简单 RRF 为默认；原问题指标与后验翻译诊断必须分开保存。

## 6. 存储与索引

### 6.1 本地受保护内容

Chat 继续由 Messaging Store 持有 SQLCipher/FTS5，Search provider 查询当前授权投影，不复制一份全量聊天数据库。跨会话检索放到拥有该索引的 native/headless 层，避免 TS 对所有会话发无界请求。

当前 Desktop 直接在既有 FTS 表写入 `search-core` 分词文本，并以同一分词生成参数化 MATCH 表达式。表形和 `unicode61` 不变；没有搜索 generation/meta 表、版本切换、启动重建或 downgrade 兼容路径。既有未重写 FTS 行不保证新中文短词召回；原消息写入和业务恢复投影使用新分词。Messaging 原文、密钥和恢复 cursor 不因 Search 改动迁移或删除。

Mobile 统一切换到相同 token stream。Messaging 原 Store 初始化时清空旧的
派生 FTS 并建立 `messaging_search_index_progress`；只从既有原消息及附件投影
读取，每批最多 128 行，在同一事务中写索引与 rowid checkpoint。原消息、密钥、
附件对象和消息恢复 cursor 保留。原 Messaging worker 在联网工作之前分批继续，
每批释放 Store 锁并重新核对生命周期，后台挂起后恢复。未完成时返回 `INDEXING`
coverage；候选页不缓存为完整结果。新写入和编辑始终使用同一分词路径，
不保留旧索引查询或双索引切换。

接受的 Direct edit 和 sender/MLS interaction edit 在原事务中刷新派生行，
以 effective edited text 和附件名称生成索引。隐藏、撤回和治理谓词同时阻止
编辑重新收录不可见对象；检索 snippet 读取最新 effective text。

本机 Social 索引附着原 SecureContentStore / PrivateSocialStore 的 SQLCipher
数据库，只索引 ContentReady 且当前可读的帖子/评论 token、稳定 ID 与 revision。
评论依赖可读父帖；原 projection commit/revoke/delete 事务同时维护 token、
generation/checkpoint 与 deny/tombstone。恢复以原域有界 snapshot 分批回填，
未追平标 recovering；不在每次查询扫描全量 `projections/read_projections`。
Search 不持有原文副本、密码、root key 或恢复 cursor。每账号/设备 storage scope、
OS key lifecycle、lock/unlock 和 purge 沿原域；无 renderer localStorage 明文正文。

本机投影的签名/完整性沿原 commit owner 校验。当前无可执行的离线读租约时，
query/hydrate 使用原 Social authenticated
`POST /api/v1/social/moments/read-policy` 批量核对父帖与评论当前可读性。
Model `CheckMomentReadPolicyRequest/Response` 只传原域对象引用与逐项读取决定，
最多 100 项，不传正文、密钥或 Search cursor，也不签发离线 grant。
point 与 batch 共用原域 CanRead、block、moderation 和 interaction policy；
禁止逐候选 HTTP 读取或重新解密整页。该来源声明 no-store，Renderer、原生
缓存和分页 session 对正文复用共同遵守；后续页须重新补齐/核权。
签名校验成功和本机 Store 发布锁都不能替代服务器当前权限。

FTS/index 和 snippet 是敏感派生内容。撤回/删除/编辑必须同步修改正文投影和搜索表；无法立即物理擦除时先禁止读取，后台 compact/rebuild/vacuum 按 storage policy 执行，并验证 WAL、缓存和向量副本。不能仅 DELETE 业务行而遗留可检索 FTS 词项。

### 6.2 Station 派生索引

当前公开 Social source 复用原 PostgreSQL `social_public_posts/social_comments`，
参数化字面量子串查询与 pg_trgm GIN 附着原表，不建立正文镜像或平行 Search
subserver。Social application 复用原 CanRead、互动可见性与 moderation，
按作者/父帖批量构建权限上下文；point/batch 读取共用一个 policy owner。
authenticated POST `/api/v1/social/search/{query,hydrate,resolve}` 只映射共同 Model
Contributor 读协议；Desktop StationClient、Mobile StationTransportRuntime
继续拥有认证、取消与错误边界。

公开 analyzer 是 literal-substring，私密 analyzer 是共同 CJK/FTS5；
中文短词、英文、混合文本以同一 corpus 校验召回与查询计划。短 CJK 的索引
性能尚未证明，不能以全表扫描宣称性能达标。分页按最后扫描位置推进，
权限过滤或扫描预算导致的不完整页报告 partial，不能误认来源耗尽。
远端读取保留原域 policy observation；有可执行 lease 时才允许依约复用。
当前 public Social 没有离线 lease，所有 query/hydrate/resolve 都 no-store 并
复核原权限。本机锁不线性化服务器写入，预读取的 PostgreSQL 快照也不是租约。

一个逻辑 Search 能力可分多个权限/来源分区；物理数据库/索引布局由部署与 schema Owner 决定，不预先要求跨业务 DB 任意 JOIN。Search hydration 通过领域 application/read contract，不直接依赖业务表细节。

SQLite unicode61、PG simple 都不能保证中文词语召回。必须验证短词、长句、混合英文、姓名、handle、ID、emoji 与短语。短查询的候选扩展只能有限、可解释；不能靠全库 LIKE 扫描修饰性能缺口。

若成熟 typo/CJK/hybrid 能力或规模测量不满足，接入 Meilisearch 等成熟引擎的官方 SDK；保持相同 contributor/read-policy/cursor contract。先比较 PG 与候选引擎的召回、ACL、撤权、内存、重建和运维，确认后冻结一种生产默认。关键词/向量是可能同时存在的检索结构；同一信任分区不长期维护两套竞争的正文 projection owner。

Station semantic 若采用向量存储，优先评估当前 PostgreSQL 的成熟扩展与 provider SDK，避免另开一套业务库。vector 绑定 resource/chunk/content revision、model identity、dimension、analyzer/extractor revision 和 policy reference；模型切换需新 generation 回填，禁止跨不同 embedding space 比较。

### 6.3 域内附件提取

附件名称、正文、OCR、转写是不同 extraction scope。提取由附件/文档所属模块（Messaging、Knowledge、Agent 任务、Social）的既有任务 Owner 在域内存储边界内执行，Search 只消费成功的 projection；不在用户查询中现场解析整库文件，也不抓取消息中的外部链接目标。

名称/元数据索引与正文/向量提取分别记录 coverage；支持的 PDF、Office、文本、媒体格式由所属模块的真实解析能力声明，不靠扩展名声称全文已可搜。D 区附件的正文、chunk 与 embedding 只写入本账号受保护存储；S 区附件按 Station 行级授权投影。

### 6.4 域内附件生命周期

附件原文件由所属模块的存储真源持有（本机受保护存储或 Station 对象存储），Search 派生索引绑定 resource/chunk/content revision 与 extraction revision，不复制文件二进制为第二真源。附件随父对象继承可见性：消息撤回/隐藏、帖子受众缩小、知识文档失权时，父域事件同时驱动附件 projection 的 deny/tombstone。

附件更新/删除走与正文相同的 outbox/watermark 机制；删除优先阻断读取，再异步清理索引、向量与预览。历史未恢复的设备上附件保持“未恢复”coverage，不回退到 Station 搜索 E2EE 正文。

### 6.5 功能目录

功能 catalog 由 Shell、业务模块与 Applet 声明稳定 capability/action ID、名称/别名/用途、平台和当前账号 eligibility。Search 做匹配与导航；原模块拥有表单、写入和确认。不执行来源返回的脚本、shell 或任意内部 command。功能别名无需模型也能工作，语义匹配继续遵守同一 catalog。功能是域内导航对象，不引入任何外部 URL 来源。

## 7. 可靠更新、删除与重建

业务变更与 outbox 在同一提交边界产生；跨库消费 at-least-once，使用 source/resource revision 幂等应用。没有事务 outbox 的来源提供 watermark snapshot + reconciliation，不能只靠 UI mount 刷新。

事件分为 upsert、delete、permission change、source disabled/removed 和 extraction completion。删除/撤权优先于普通追加；tombstone revision 必须压住迟到的旧 upsert。

初次索引：取得 snapshot watermark → 分页快照 → 处理 watermark 后的变更 → 对齐删除/权限 → 宣布对应 coverage ready。丢失 checkpoint 或遇到序列缺口时进入 catching-up/rebuild-required，不能保持 ready。

后续来源若确有增量/重建需要，应由索引 owner 从同一业务真源重投影并验证权限、coverage 和打开行为，再启用读取。当前 Desktop FTS 不实现代际迁移、双索引或旧查询兼容；新产品不为未存在的部署兼容要求预建版本体系。

暂停保留 policy 允许的索引但停止更新并显示 stale；移除来源立刻撤销 query admission、缓存/cursor/AI evidence，按声明清理派生内容；业务原文由原域保留或删除。

## 8. 授权与隐私生命周期

授权在 source admission、index write、candidate query、projection hydrate、preview/open 和 AI evidence 分别执行。一次来源注册/旧 ACL snapshot 不代表永久内容访问。

索引尽量做权限前置过滤；返回 title/snippet/object ID/计数前仍须满足当前
authority read。有效原域缓存/授权租约可承接该判断，失效时 batch read-policy
复核，避免逐条 N+1 和反复重取正文。deny/unknown 都不得以私密 metadata
解释“你没权限看这个命中”；统一不可用反馈由原域决定。

Session/actor/Station/Federation 变化、锁定、模块卸载、权限事件使对应 query cache、history suggestions、preview、AI citations 失效。来源静态描述可 app-scope；eligible sources 与所有用户结果必须 identity-scope。

远端权限变化在断网设备无法瞬时得知。离线可读性遵循原域受保护缓存/有效授权租约政策；显示本机已同步范围与时间，不宣称全局最新撤权。已知撤权立即阻断，过期租约/不可确定的私密读取 fail closed；具体离线保留期限由原域确认。

日志和指标不记录 query、snippet、正文、向量、token。记录匿名意图 ID、来源耗时/状态、数量语义、coverage lag、drop-stale/cancel 和权限否定事件；原始日志脱敏/留存遵循现有策略。

## 9. Ask 与 Agent 集成

Search 输出 AuthorizedEvidenceBundle：原对象 ID、revision、可见片段、来源、授权与处理边界。Agent 负责模型/provider、生成与流生命周期，Search 负责检索和 evidence eligibility；避免两个 AI Search pipeline。

语义召回/向量提取与模型生成分别受 processing policy 约束。复用已有 Agent 模型/provider 管理，但 Search 持有 query plan、排名和结果；Agent 持有模型执行。D 区对象的 query embedding 只在端侧生成，不能为了语义检索自动上传本地语料；端侧无可用 inference 时 D 区保留 lexical 路径。自有端侧 embedding/LLM 需要 Agent/平台已有的明确执行能力，不能仅因选择“本地模型”就假定存在。

现有 Agent 公共架构中 Direct Model 由 Station adapter 调用，本地 MCP 使用明确的 client execution owner。Search 不借 MCP 绕开模型执行 owner，也不借 MCP 引入域外内容来源。严格 device-private 来源不调用 Station Agent；S 区内容只有在来源策略与用户授权允许时才可发送到 Station Agent，Station 再到外部 provider 是第二次独立授权边界。

原生 Coordinator 在本机合并私密候选，只有用户允许外发的 bundle 能上传。禁止上传私密全索引、密钥、可逆内容摘要或 embedding；embedding 也按敏感内容处理。

provider 内容是资料而不是执行指令。截断/净化、引用与上下文隔离、预算、工具 allowlist 沿 Agent 合同。检索结果不得诱导系统绕过权限或自动执行动作。

答案绑定本轮 source/revision/authorization；零 evidence → evidence insufficient，部分来源 → coverage disclosure。引用 preview/open 再做权限检查；撤权或删除使相关缓存答案停止展示可读原文。外部模型已收到的内容不能追溯撤回，外发决策处须准确告知。

## 10. 客户端树与资源释放

UI 只投影 Search intent，不负责来源发现/历史同步。复用 Page/Runtime/Boot 和 Mobile runtime owner：

- Shell 普通启动、登录完成与账号切换落到 `chat`；Search 由按钮/已确认快捷键主动唤起，不能由启动 fallback 或跨启动旧 Search 路由恢复自动显示。明确对象深链遵循独立导航规则。
- 静态 provider/function descriptors 可常驻；身份 eligibility runtime 随认证/session reconcile。Search UI 按需挂载，不为默认首页 eager/forever；轻量 entry 和有界 query 状态与页面树分离。
- 同账号短期 query 状态在 headless store；Page hidden 后暂停结果订阅与预览渲染。
- headless read-validity 失效与 expiry 调度独立于 Page 订阅；恢复显示前先校验。
- 列表按窗口渲染；只挂载所选预览；不隐藏挂载全部 source editor、Applet 或 Agent 会话。
- Overlay singleton，由 Shell 管；back stack 保存稳定 resource reference。
- search session、候选、缓存和 provider worker 有数量/字节/并发上限；
  session/cursor 有有效期，内容与读权分别按第 4.1 节判断。logout/lock/
  session-end 取消读取并关闭相应用户分区，静态无用户声明可继续复用。

Desktop/Mobile 默认落点、alive policy、组件树和 runtime registry 已更新到对应平台合同；后续来源也必须遵循这些边界。域内附件/消息索引是有预算的后台能力，页面关闭不必停索引；搜索页面也不能成为索引工作者的唯一生命周期 owner。

## 11. 架构验证与尚未冻结事项

需验证：Chat 默认落点与 Search 按需显示；同账号跨页面连续性；账号/Station/联邦切换无回写；域内附件随父对象权限过滤与撤回；Federation 对端不可见不泄漏存在性；功能直达真实入口；权限过滤与撤权；迟到 upsert 不复活已删对象；D 区内容不外发；partial/cancel/cursor expiry；索引重建无数据丢失；按原对象 anchor 打开；中文与规模 corpus。另需否定证明：公网/OS 文件/外部 connector 无法通过任何配置、Applet 或 MCP 路径成为来源。

这些是完整目标的证明义务，不是已完成的测试结果。Desktop 已选择共享 CJK/拉丁分词与既有 SQLCipher/FTS5；Station 引擎、语义 analyzer、预算、离线授权期限和 contributor 资源限制需后续领域/测量输入。当前显式执行计划和 registry 只登记真实已实施切片。

缓存设计另由 [V-10](./integration.md#v-10-cache--reentry) 验证：功能目录重复
使用、同词/退格重输、返回/重开、预览与页复用、条件刷新、新内容使负缓存
失效、权限租约到期、成员变化、共享读取消与容量淘汰。记录来源 query、正文
读取、authority 校验次数、字节量和冷/热恢复耗时；有效命中的零次来源/正文
读取是合同要求；所选消息 Journey 已记录原来源读取计数，完整跨来源成本仍需测量。不能用缓存命中率代替权限否定证明。

独立[组件实验](./feasibility.md)与[原始证据索引](./feasibility-evidence.md)已补充基础可行性：300 份真实文档加密 FTS 查询 P95 2.883 ms，中文分词关键词探针 8/8；PG 和生命周期机制有受控验证。域内附件正文 provider、Federation 按需查询、端侧 inference、完整产品 Acceptance 及产品性能仍未证明，不能将实验数值变成上述 SLA 或 readiness。已执行的端侧消息原生 Journey 单独绑定[证据快照](./acceptance-evidence.md)。

基线使用同一设备/runtime、当前源码与可重复语料，分别记录首条可用结果、全选范围收敛、取消、原对象打开和更新/撤权可见耗时的 P50/P95/P99，以及 memory/index size/IO/fan-out。标注语料按中文/英文混合、短词、ID、同名、权限组、文件格式与规模分层，比较 Recall@10/MRR/NDCG。目标阈值在实测后冻结，不凭 industry 数字宣称达标。

通过来源耗时、排队/取消、候选数、policy 否定、coverage lag、generation/checkpoint 和 Resolver outcome 归因问题；日志不存 query/正文/路径/embedding/secret。验证必须包含慢源、快速换词、账号切换、大文件、断网/重启、删除/迟到事件及来源卸载。协议 conformance、索引测试与原生产品 Journey 是不同证据。
