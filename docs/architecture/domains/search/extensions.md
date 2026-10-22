# Search 扩展与接入合同

> **Status**: draft
> **Created**: 2026-10-22
> **Owner**: Search / Model / Applet Host / Domain Owners
> 下列接口、ID 和绑定是待确认设计，不是已实现 SDK、API 或已登记能力。

## 1. 扩展目标与边界

新增域内业务来源、附件格式、索引引擎或展示类型时，不修改 Search 的查询状态机、全局页面业务分支或原域权限规则。一个扩展只实现对应 port，并通过 canonical schema、授权和 conformance 校验。扩展不能扩大检索宇宙：公网、OS 文件与外部 connector 不是可扩展来源（D-19）。

Search 是一份逻辑语义合同，在 Client 和 Station 各有执行实例。source registry 只投影原模块的身份、安装、联邦关系、capability 和 readiness；不是第二个安装系统、凭据系统、业务权限库或模型目录。

扩展分为域内内容来源、检索后端、域内附件提取、功能目录、结果投影与 Agent 证据消费。每一种扩展有固定边界，不允许一个插件同时自行定义身份、读取整个数据库、返回任意 HTML 和执行写操作。

## 2. 内容来源 SearchContributor

所有内置域与官方/第三方 Applet 的域内对象使用 [SearchContributorDescriptor](./data-model.md)。descriptor 指向受信任 provider binding，运行时实现按两个分离方向提供能力。descriptor kind 仅允许域内类型，外部 connector、网络搜索商、OS 文件来源在 schema 校验阶段被拒绝。

### 2.1 Query adapter

逻辑 port：

- **Describe**：返回可检索对象/字段、过滤/排序/策略、分页、coverage、预算与绑定 revision；不能自行授予权限。
- **Query**：接收已经限制范围的 QueryIntent 与 Host/Station 提供的执行上下文，返回有界候选、排名 channel、来源状态和 continuation；不能忽略不支持的筛选。
- **ValidateAndHydrateBatch**：原域批量确认当前可读性，再返回标题、片段、元数据和必要引用；候选 ID 或 count 本身也是敏感投影，未授权不能发布给调用方。
- **Resolve**：把稳定 ResourceRef 转为当前可读预览和受信任 open action；写动作仍由原模块实施。
- **Cancel**：通过当前查询 context/attempt 停止运行与后续 fetch；支持的 resume/cursor 语义显式声明。

例如人员目录、现有 Chat FTS、少量功能 catalog 可以直接 query。来源已有索引时不要求再复制一次正文；没有完整全文能力时声明 metadata-only/known-only，不冒充完整来源。

### 2.2 Derived index adapter

逻辑 port：

- **Snapshot**：分页返回授权 projection，提供 snapshot identity 和 watermark。
- **Changes**：返回 watermark 后的 upsert/delete/policy/extraction/source 事件、checkpoint 与 gap indicator。
- **Reconcile**：用于源无可靠事件流、checkpoint gap 或语料核对；扫描可重建，不跳过删除和权限状态。
- **ValidateAndHydrateBatch / Resolve**：继续由业务 owner 实现；索引不取得永久读取权。

业务 outbox 与原事务一起提交；域内附件使用所属模块的变更事件加水印核对。Search 的索引 worker 幂等消费并事务推进 checkpoint；tombstone/revoke 压住迟到旧 upsert。快照未追平时报告 catching-up，索引 generation 切换只改变派生投影。

### 2.3 一次接入示例

笔记 Applet 声明可搜 title/body/tags、account scope、read-policy、revision 和 block anchor，选择已有 query 或 snapshot/change 绑定；Host 校验安装实例、manifest 和权限后投影 eligible source。Search 用已有结果行显示笔记，并通过 Applet 的 open binding 进入正确笔记和段落。

该 Applet 的页面没有挂载时，provider 可通过已有 service 或被 Host 托管的 headless capability 工作。若它只能在页面 alive 时执行，必须声明这一限制：未打开时返回 unavailable/需打开，不能为了搜索偷偷挂载完整 Applet UI 或伪造空结果。

允许参与全局搜索不等于允许 Applet 查询其他来源。Applet 自己的数据贡献与它消费 Search 结果是两种独立权限。

## 3. 接入、消费与执行权限

建议在现有 `applet-contract` 和 `applet-sdk` 中增加 typed Search facade，而不是创建第二套桥接协议。方法名称在正式 Model/SDK 合同中冻结，逻辑权限至少分开：

- **source.contribute**：贡献该 applet/service 自己拥有的对象；不读取别人数据。
- **query.own**：查询自己的来源。
- **query.selected**：查询用户明确授予且当前可读的其他来源；授权由 Host 决定。
- **source.configure**：配置当前 applet 允许管理的来源实例；不管理全局任意来源。
- **resource.open**：打开其可读对象；不隐含写入、发送、安装或系统命令。

这些不是当前已存在的 permission literal。现有 `network.request`、`file.read`、`skills.register` 和 `tasks.start` 不自动取得上述权限。

source 描述、Model 消息和 schema 为一份真源生成 TypeScript/Rust/Go 类型；Applet bridge 使用既有 envelope/session/error 合同。声明包含 capability/service binding、支持平台与完整性引用；Host 注入 actor/session 与联邦授权上下文，不接受 Applet 自报 actor ID 或任意 backend URL。

贡献的数据被当前用户、另一用户或 Agent 查询，分别验证 source visibility、document read-policy 与 processing policy。descriptor 中 `public` 只表示该来源声明的允许处理边界；调用身份与 authority 仍必须验证。

## 4. 来源准入与卸载

生命周期：

```text
发现声明 → schema/完整性验证 → 校验执行绑定
         → 取得当前授权 → 能力检查通过 → eligible
eligible → 初始化/追平/ready/partial/stale/locked
撤权/停用/卸载 → 立即退出 source set → 关闭读取 → 派生数据清理
```

准入校验覆盖：

- source ID/authority namespace/capability owner 唯一，重复声明拒绝；
- provider binding 可解析，平台和 runtime 有真实能力；
- 安装、联邦关系与 actor/session revision 当前有效；
- filters/排序/paging/coverage 与数据处理边界完整；
- query/open、权限否定、更新/删除/撤权、取消与 source cleanup 的 conformance 和产品证明符合所宣称范围。

协议结构通过与当前用户 eligible 是不同状态；当前 eligible 与索引 complete 又是不同状态。没有 provider 或证明不完整的来源保留 UNPROVEN/不可用，不阻断其他来源，也不登记为 ready。

停用 source 退出新查询，已返回结果、预览、AI evidence 和 cursor 立即失效。只是暂停索引时可按 policy 保留已知只读结果并标 stale；失权时必须关闭读取。provider 更新改变支持条件、schema、rank channel 或 processing policy 时，当前 query session 失效并要求重新查询。

不需要恢复 Applet UI 才能清理旧索引。provider 崩溃、卸载中断或恶意超限由 Host 隔离并报告 source failure，不能拖死整个搜索。

## 5. 检索引擎与域内附件提取扩展

**IndexBackend** 只负责 index generation、upsert/delete、query、cursor 与健康信息。它接收已经允许落盘的投影和约束；不拥有 OAuth、用户权限或原文。D 区使用 SQLCipher/FTS5 等端侧受保护后端，S 区使用 PostgreSQL 或经验证的成熟独立搜索引擎；不存在 OS 系统索引后端。不同信任分区可有不同后端。

全文与向量结构可以并存，但同一正文投影只有一个 authority。backend 更换通过 generation 重建和原子 reader 切换完成，不长期双写两个竞争 owner。更换引擎不能改变 ResourceKey、来源资格、删除语义或打开接口。

**AttachmentExtractor** 声明 MIME/格式、名称/正文/OCR/转写的支持、输入字节上限和可输出 chunk/anchor；输入是所属模块已授权读取的域内附件字节，不读取 Peers 存储边界之外的 OS 文件。使用成熟库或隔离 worker，限制 CPU/内存/时间/临时文件，并可靠释放。格式未知、损坏、加密或超限时保留附件名称结果和真实 extraction state。

Extractor 只产生可索引文本，不控制查询或回答；处理中的附件不在输入检索时现场反复解析。相同 content revision/extractor revision 的结果可以幂等复用；父对象失权后不读取缓存正文或继续执行。

向量 projection 绑定模型 ID/revision、dimension、chunk schema、content revision 与授权参考。一个 embedding space 的候选不能与另一 space 直接比较；模型变更重建，不复用旧向量假装新模型可用。严格 device-private 对象不自动上传到 Station 或模型商。

## 6. 功能与结果展示扩展

**FunctionContributor** 从现有 Shell/模块/capability catalog 派生入口、别名、用途、平台、可用性与 action ID。功能发现是 app/module 入口的搜索投影，不复制目录所有权。

功能结果分开描述 navigation/read 与 mutation effect；默认主动作打开正确页面或草稿面，危险/发送等动作仍经原域授权与确认。扩展不能用 title 决定执行命令，也不能自动注册任意 shell/JavaScript。

**Result presentation** 使用平台统一的 typed row，基础类型为 person、conversation/message、domain-attachment/document、post/comment、agent-session、applet、function。所有来源都可提供安全标题、片段、元数据、parent/anchor 与 open action；没有 web/外部 URL 行类型。

新业务 subtype 优先映射已有行结构；确需独特预览时，经受信 Host 注册纯展示 renderer，输入仅为已授权投影。不将第三方 HTML、脚本或带副作用的 Applet 页面挂到结果列表。新视觉类型也不允许决定权限、排名或读数据库。

展示 registry 按客户端能力提供 fallback：不支持的预览仍可使用通用结果行与原对象打开，不假装有本机不存在的能力。

## 7. AI、MCP 和 Skill 如何复用

Search 为 Agent 暴露 typed query/resolve/evidence 能力，普通 UI 与 Agent 调用同一授权查询 application。Agent tool wrapper 不能形成另一套扫描数据库、文本拼接或权限缓存。

MCP/Skill 不是 Search source，也不能借工具通道引入域外内容。仅当一个 MCP/Skill 工具暴露的是 Peers 域内、它自己拥有的对象，并具备稳定 ResourceRef、字段/过滤、paging/coverage、read-policy 与 open binding 时，才可经合格 adapter 作为域内 contributor。外部网页、SaaS 数据、任意文件系统工具不接入；任意字符串输出、原始工具日志或工具成功状态不能伪装成完整来源。

Search 使用 Agent 既有 provider/runtime 提供理解、embedding、rerank 或答案生成；实际支持的 inference capability 需声明并验证。不能因 chat completion 可用推定 embedding/rerank 可用。

查找、回答和深度研究有不同调用预算。明确对象走即时结果，提交问题可给有引用短答案，用户明确深入时再执行多轮搜索/追问。每轮都保持来源、处理策略和取消边界；研究模式只在当前 actor 可读的域内证据上工作，不能扩大可读范围或把 D 区语料送到远端。

模型未配置/超时/权限不允许时，保留普通检索和来源状态；答案不足就给证据不足，不编造出处。Search 不创建默认 Agent 或新会话来完成每次关键词输入；用户选择“继续到 Agent”后才由 Agent 创建或进入正式会话。

## 8. 扩展的成本与可演进性

每 source 声明 query timeout、候选/字节限额、并发、后台队列与 index quota，Host/Station 有最终总预算。interactive query 优先于 scan/OCR/embedding/rebuild；按 source/actor 公平调度，过载返回可恢复错误与 partial。禁止一个来源占满结果页、工作线程或磁盘。

协议只冻结语义必要字段，能力协商决定可用 filters/strategies/preview；未知字段不承担权限或路由。新增 source instance 通常只需注册 adapter/binding，已有 renderer、query lifecycle 与 storage port 保持不变。

新增资源类型、处理策略或 breaking wire 变化需同时校验全部生成客户端、Model 和接入 conformance；遵循仓库当前协议演进政策，不自动增加版本号，不通过永久 compatibility shim 保留双 owner。

验收以一个可重复 contributor fixture 对所有 port 实现做相同 contract 校验，再补真实授权来源与客户端原对象打开 Journey，并包含域外来源注册被拒绝、外部内容无法经 Applet/MCP 旁路进入的否定证明。不能用 conformance PASS 代替 receiver proof。

## 9. 当前资产与缺口

已有可复用资产：Model proto-first、Applet manifest/bridge/capability/service、SDK navigation/tasks/Agent、Messaging FTS、Agent connector/knowledge descriptors、身份 runtime 与受保护 storage。

仍需新接入闭环：Search typed schema/SDK、域内附件随父对象授权、跨模块资源打开、source registry projection、统一 query/rank/cursor/coverage、可靠索引更新、Federation 按需查询、来源 conformance（含域外来源拒绝的否定证明）和真实客户端证明。它们是目标合同，不是本次已经实现的能力。
