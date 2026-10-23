# Search 扩展与接入合同

> **Status**: draft
> **Created**: 2026-10-22
> **Owner**: Search / Model / Applet Host / Domain Owners
> 下列接口、ID 和绑定是待确认设计，不是已实现 SDK、API 或已登记能力。

## 1. 扩展目标与边界

新增域内业务来源、附件格式、索引引擎或展示类型时，不修改 Search 的查询状态机、全局页面业务分支或原域权限规则。一个扩展只实现对应 port，并通过 canonical schema、授权和 conformance 校验。扩展不能扩大检索宇宙：公网、OS 文件与外部 connector 不是可扩展来源（D-19）。

Search 是一份逻辑语义合同，在 Client 和 Station 各有执行实例。source registry 只投影原模块的身份、安装、联邦关系、capability 和 readiness；不是第二个安装系统、凭据系统、业务权限库或模型目录。

扩展分为域内内容来源、检索后端、域内附件提取、功能目录、结果投影与 Agent 证据消费。每一种扩展有固定边界，不允许一个插件同时自行定义身份、读取整个数据库、返回任意 HTML 和执行写操作。

本次设计评审只要求通用来源接口干净、简洁、有效，并能由未来外源 adapter
接入。Applet 是扩展性检验例，具体 SDK、部署、授权委托和后台运行集成留待
实际接入任务；不把完整 Applet 接入工程作为当前接口设计的通过条件。

## 2. 内容来源 SearchContributor

执行器只依赖一个 `SearchContributor` 读侧接口。内置模块与未来外源 adapter
提供相同语义；descriptor 使用 [SearchContributorDescriptor](./data-model.md)，
引用平台可解析的 binding。来源可以复用原域查询，或由标准派生索引 adapter
提供检索，执行器和全局 UI 不增加来源专用业务分支。允许的资源类型仍受 D-19
约束，注册声明不扩大读取或处理权限。

### 2.1 最小公共接口

以下 TypeScript 仅表达逻辑签名；正式类型由同一 Model schema 生成，不是新增
SDK 或已实现接口：

```typescript
interface SearchContributor {
  readonly descriptor: SearchContributorDescriptor;
  query(input: QueryIntent, ctx: SearchExecutionContext): Promise<SourcePage>;
  hydrate(refs: readonly ResourceRef[], ctx: SearchExecutionContext): Promise<readonly AuthorizedProjection[]>;
  resolve(ref: ResourceRef, ctx: SearchExecutionContext): Promise<ResolvedResource>;
}
```

三个方法各有一个职责：

- **query**：在允许的范围与条件下召回有界候选，返回来源内 rank、分页和真实
  coverage。不支持的筛选明确失败，候选与 count 不绕过来源的读权过滤。
- **hydrate**：以当前读权批量形成允许展示或使用的投影；有效原域缓存/读租约
  可承接判断，失效才复核，deny/unknown 的对象不返回。排序候选、缓存和派生
  索引都复用这一读入口，避免逐条 N+1 或另一套权限实现。原
  `ValidateAndHydrateBatch` 的语义由此方法完整承接。
- **resolve**：在当前上下文下判断资源及 anchor，返回受信任的只读打开目标。
  有效内容和定位绑定可复用；实际导航及最终打开裁决交给原域/Host resolver，
  不执行写操作、脚本或任意命令。

`SourcePage` 是来源候选页，`AuthorizedProjection` 是原对象按读权及字段策略
形成的有界投影，`ResolvedResource` 是可读资源与受信打开绑定；它们对应
data-model 中的候选、结果和资源语义，不形成第二套业务 DTO 真源。

descriptor 在注册/绑定时读取，不提供单独的 `Describe` RPC。它只声明身份、
资源 namespace、类型、支持能力与 binding，不能自行授予权限。

身份、允许范围、deadline 和 cancellation 统一通过 `SearchExecutionContext`
提供。取消由查询 owner 与 transport adapter 传播到已有执行机制，来源不再
各建一个 `Cancel` API；取消后停止该订阅者后续读取与投影，并拒绝迟到发布。
合并读还有其他有效订阅者时不一并取消，最后订阅者退出才中止底层操作。

已有 FTS、人员目录或功能 catalog 直接适配这三个读方法。来源已有索引时不再
复制一次正文；metadata-only/known-only 来源如实声明覆盖范围。

三个方法定义读语义，不要求每次调用都执行 RPC 或重读正文。Search runtime
在统一 wrapper 中完成缓存定位、有效性判断、in-flight 合并与失效；来源
只通过原 read port 提供投影、validator、当前读策略与已有变化通知。有效
query/preview/resolve 缓存可直接形成响应，miss/失效才进入真实读取。

可选 typed 缓存元数据和条件读取提示放在同一 Model 的 request/response 或
受信 binding envelope，表达字段、validator、changed/unchanged 和缓存限制，
不新增 `validateVersion`、`GetCache` 等方法。内容版本和读权独立有效，
来源提示不能扩大 Host grant；元数据不足时保守重读，不默认永久命中。
原域已有 read cache 时复用它，来源不被要求各建缓存系统。统一规则见
[data-model 第 7 节](./data-model.md#7-cursor缓存与复用)。

### 2.2 可选的派生索引供给

需要 Search 维护派生索引的来源，额外提供 `IndexFeed`，只有两项供给能力：

- **snapshot**：分页返回允许落盘的 projection，绑定视图范围、snapshot identity
  和 watermark。
- **changes**：返回该范围 watermark 后的 upsert/delete/policy/extraction/source
  事件、checkpoint 与 gap indicator。

标准 projection worker 复用 snapshot 做核对与 gap 恢复，不新增来源侧
`Reconcile` 方法。它幂等应用变更并事务推进 checkpoint；deny/tombstone 压住
迟到 upsert，快照未追平时报告 catching-up。

标准索引 adapter 提供 `query`，`hydrate/resolve` 继续委托原业务读端口，对外
仍呈现同一 `SearchContributor`。原文与业务权限仍归原模块；直接查询来源不被
要求实现 feed、后台队列或索引管理。

### 2.3 外源接入的预留验证

未来笔记 Applet 的 adapter 可以把自有查询、批量读取和资源打开绑定适配为
上述接口；Search 仍接收同样的 ResourceRef、候选和授权投影。来源 binding
可以被 Host 代理解析，不要求把 Applet 源码编译进 Search。

当前只保留这一能力边界与 typed binding 位置。具体 Applet SDK 方法、部署拓扑、
委托凭据和 headless runtime 的产品证明，在实际接入时沿既有 Host/SDK 合同
实施，不在本次增加 Applet 专用注册、权限或执行系统。

## 3. 共通上下文与协议边界

descriptor、QueryIntent、ResourceRef、投影和错误沿同一 Model/schema 真源生成
TypeScript/Rust/Go 类型。adapter 负责传输与已有原域接口映射，Search core
不感知来源部署地址、UI 技术栈或 Applet 生命周期细节。

`SearchExecutionContext` 由 Host/Station 的认证与 policy owner 提供，来源不能
自报 actor、扩大 scope 或改变 processing policy。注册贡献本源不隐含查询
其他来源、管理全局来源或执行写操作；现有网络、文件、Skill/Task 能力也不
自动取得这些许可。

SourceHandle 只引用既有 capability/service/grant binding。Query、hydrate 与
resolve 始终受当前身份、来源 namespace 和原域读权约束。来源返回的资源、
投影类型和打开目标须匹配受信 binding，标题、ID、count 与 snippet 没有旁路。

撤权、来源停用或绑定变更由既有 owner 使上下文和查询会话失效；Search 停止
读取和发布，再按策略清理派生内容。不新建 Search 安装目录、凭据库或权限
authority，也不让当前 Applet 集成的未实现细节成为通用接口设计的门槛。

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
