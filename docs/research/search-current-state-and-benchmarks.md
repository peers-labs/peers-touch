# Search 现状、历史与行业参照

> **Status**: draft
> **Created**: 2026-10-22
> **Owner**: Search / Client / Station
> **Scope**: 源码与历史核对、官方产品资料研究。不是运行时验收报告。

## 1. 结论与证据边界

门户 Search 的核心问题是能力没有接成闭环：页面依赖的来源、查询和 AI 命令返回空 stub；真实消息、人员、Agent 会话检索分别存在于其他模块，未通过统一内容接入协议进入门户。不能把当前空结果解释为“索引里没有内容”。

已核对历史显示两个明确变化：2026-03-23 引入 React Search 的 HTTP 调用，03-24 改为 Native application 命令并提供空 stub；Flutter 历史树曾定义类型化 Provider、聚合、取消与键盘选择。前者是调用链退化的源码证据，后者是设计资产缺失的证据。两者都不证明历史版本曾具有完整可运行的全局搜索。

本次没有启动真实 Desktop/Mobile 搜索 Journey，也未测延迟、召回率或账号切换泄漏。本文严格区分源码事实、历史事实、推论和设计建议。

主审阅工作树为 `peers-android`，审阅时 HEAD `89ca1936372698d85a58d46fb9178a7a8fd2ae0b`；本文件落在主文档工作树 `peers-touch`，文档基线 `fac77ca549f862c0a41bf9f56da2a0db4b61a045`。最新 master 在研究期间进入 `beed4961b`，所以这里记录的是指定快照的证据，不冒充整合后的运行证明。

## 2. 当前门户调用链

Desktop：

```text
SearchPageContainer
  → SearchPage / useSearchStore
  → desktop_api.searchSources / search / aiSearch
  → Tauri search_* 或 http_gateway 对同名 command 的分发
  → application/search/mod.rs
  → AppResult success + sources[] / results[] / answer:""
```

源码定位：

- `apps/desktop/src/pages/SearchPageContainer.tsx:10–13`：通过 Shell navigation 回调打开结果。
- `apps/desktop/src/pages/SearchPage.tsx:149–170`：来源顺序分组，每组显示 5 条；`hasSearched` 由正命中或回答决定，零结果仍保留首页 Hero。
- 同文件 `:219–260`：来源 Tab 动态生成，AI Tab 无条件存在。
- 同文件 `:409–420`：零结果有 Empty，因此不是“没有空态”；问题是空结果与失败未分开，搜索页形态又依赖命中。
- 同文件 `:479–524`：通用 clickable div 结果；没有 typed resource/open 语义，键盘和辅助技术行为需补合同。
- `apps/desktop/src/store/search.ts`：每来源请求最多 20 条，无全局游标；来源载入异常被吞掉，查询失败变成空数组；只用 query 字符串丢弃旧响应，无法区分 A→B→A 的不同请求；没有取消。
- `apps/desktop/src/services/desktop_api.ts:1461–1490,5938–5948`：手写 `SearchSource` / `SearchResultItem`，内容类型、权限、覆盖度、跳转和错误都未形成共享协议。
- `apps/desktop/src-tauri/src/application/search/mod.rs:20–51`：三种 Search 操作返回成功的空内容。
- `apps/desktop/src-tauri/src/interface/http_gateway/mod.rs:4539–4545`：同一 application stub；增加 HTTP 客户端不会使其具备搜索能力。

`searchRuntime.ts:1–35` 声明 app scope，来源缓存跨 logout/login 保留，teardown 不清理；`SearchPage.descriptor.tsx:10–17` 设置 eager / forever。保留同账号导航上下文有合理产品目的，但“来源独立于身份”不适合未来带账号、Station、权限与 Applet 的来源集合。存在身份隔离设计风险；尚未复现数据泄漏。

`hooks/useNavigation.ts:47–68` 只处理 `/chat`（转 Agent）、`/agent-profile/`、`/notes/` / `/pages/`（回默认页）和 `/settings`。人员、Social 帖子、Chat message anchor、Applet resource 与外链没有在这个函数形成完整打开链。

### 2.1 默认落点与本机文件检索的证据边界

2026-10-22 源码核对：主文档工作树及 PR #152 整合工作树的 `apps/desktop/src/types/navigation.ts` 均定义 `DEFAULT_READY_PAGE='search'`；主文档工作树 `useHashRouter.ts` 在无 hash、未知路径与 reset 时使用该默认值。Search descriptor 的 eager/forever 注释明确以 landing page 为理由。PR #152 的 Shell 页面合同将 `chat` 与 `agent` 分开，`SocialChatPage` 是人际 Chat 页面。

用户要求普通启动默认 Chat、点击 Search 才显示首屏。落实时需核对默认值、hash fallback、identity warm resume/last-active-page 和 Page descriptor 的完整调用链；本文没有修改导航代码，也不把产品方向视为运行证明。

当前已确认的本地 FTS 资产属于 Messaging。它不直接提供 OS 授权目录、本机任意文件的正文提取或文件打开合同。本次没有完成跨工程的文件检索能力 inventory，不能断言整个 Peers 没有任何文件检索组件；新文件来源需先核对 Host 权限、系统索引/通知和成熟解析资产。

## 3. 独立能力与可复用资产

### 3.1 人际消息

`packages/messaging-core/src/store/schema.rs:424–430` 定义 `messaging_message_search_fts`，使用 `unicode61`。Desktop `src-tauri/src/messaging/store.rs:3890–3965` 和 Mobile `src-tauri/src/messaging/adapter.rs:4780–4835` 查询本地 FTS，按 conversation 筛选，排除 retracted、hidden、moderated，按时间与 message ID 排序。

Desktop `store/socialChat.ts:2532–2589` 枚举当前 conversation，逐个调用 runtime search，每会话 50 条，汇总截为 100 条。已有 `components/chat/SearchMessagesModal.tsx`，不是“无消息搜索 UI”。当前实现是会话级检索再由 TS 扇出；跨会话索引、排序、覆盖度与分页还未形成门户能力。

Mobile `features/chat/useChatHistorySearch.ts` 已有 request revision、session/conversation scope 防旧响应、游标、retry/previous/next；这些语义值得复用，不应重造另一个无隔离的查询 store。

### 3.2 人员发现

Mobile `features/social/socialStore.ts:2002–2056` 根据完整 handle 走 Federation resolve，否则走 Federation actor catalog；要求 federation context，使用 request identity 与 profile gateway 防旧响应。Desktop 有 `store/discovery.ts` 与 `pages/moments/UserSearchPage.tsx`。

Station `subserver/social/handler.go:80,159,2049–2057` 有 `/api/v1/social/users/search`，调用 actor 搜索；该端点存在不等于完整 Federation/global search。门户需要保留“熟悉的人”“当前联邦目录”“精确远程地址”之间的语义区别。

### 3.3 Agent 会话

Desktop `store/agentSearch.ts:25–85` 扫描最多 50 个 topic、抓取 messages 后做 substring，最多 40 个结果，失败的 topic 被 `allSettled` 隐去。是可用的局部检索资产，但成本、覆盖度、取消和分页需要更合适的 Owner。

Station `subserver/agent/service/session_search_service.go:57–133` 做 SQL LIKE，按 agent ID 约束、按 conversation 去重，最多 5 个；`:234–254` 注册为 `session_search` 工具。这是 Agent 工具能力，不能直接推导为面向任意当前 actor 的全局授权查询；接入前必须审核 actor 与 conversation ownership。当前源码还记录原始 query，需纳入日志改造范围。

### 3.4 Launcher 与 Web Search Applet

Station `subserver/launcher/service/search_service.go` 搜索 11 条固定 mock（Alice、Bob、帖子、Applet）；结果是内存 substring 筛选。`launcher.go:78–85` 路由是 `GET /launcher/search`，展示的组合只有 LogID wrapper。尚未核对最外层路由认证，不能断言部署后的匿名可达性。

`model/domain/launcher/launcher.proto` 有通用 SearchRequest/Result/Response，但缺少来源能力、权限、覆盖、游标和 resource reference；历史 `INTEGRATION.md` 的 `/api/launcher/search` 与源码路由也不一致。

`packages/applets/web-search/src/api.ts` 调用 `POST /api/v1/search`；在主审阅 Station Go 路由检索中没有找到该字面路由。文档证据不足以宣称部署环境必然 404，但当前集成没有得到源码闭环。

同文件 crawl action 启动 SDK task 后即写 `last_crawl` 并把 articles 加一，没有等待任务结果；因此这些数字不是实际完成抓取或入索引的证明。Applet manifest 有 network/storage/tasks 权限，`capabilities: []`；`packages/applet-sdk/src` 未发现 Search 专用 contract。这里需要内容接入协议，不仅是调用 search API 的权限。

### 3.5 SDK、资源与模型复用边界

`packages/applet-sdk/src/index.ts` 已组合 file、navigation、tasks、agent、ai 等 facade；`packages/applet-contract/src/{capability,manifest,complex}.ts` 有 capability allowlist、service/skill 声明、HostPageRoute 和 launch 参数。它们可以承载 Search 的调用与绑定，但当前列表没有 Search 专用合同。

`packages/applet-sdk/src/capabilities/file.ts` 提供 read/write/delete/list/getInfo。Desktop native `application/applets/mod.rs` 的 `applet_files_dir`、`applet_file_path`、`handle_file` 将读写限定到 applet 自己的 `applets/{id}/files` 根。这不是用户选择任意 OS 目录的 grant API；实现 Search 用户文件来源不能重定义现有 `file.read` 为整机读取。

`model/domain/agent/capability.proto` 已有 `CapabilityManifest`、connector permission/resource revision、`KnowledgeResourceDescriptor` 和 `KnowledgeClientResourceRef`。后者含 opaque resource、device 和 required capability，适合复用资源身份；它不证明文件已完成正文提取、索引或 Search 查询。Search 需补覆盖和定位，不复制知识 authority。

当前 `agent/design.md` 将 Direct Model 调用放在 Station adapter，本地 MCP 通过显式 client execution owner 执行。SDK `AIAPI` 当前可见方法是 generate/chat；本次窄范围查询未发现统一 embedding/rerank API 闭环，不能把模型列表、memory prefetch 或 completion 可调用视为这两种能力已经存在。

## 4. 历史产物应如何使用

### 4.1 Flutter：有协议骨架，没有完整供应者闭环证据

查看 `6fe9b1d69^`：

- `client/desktop/lib/features/launch/service/search/search_provider_interface.dart`：scope、priority、实时支持、Stream search、cancel。
- `search_aggregator_service.dart`：registerProvider、按 scope 选择、按 Provider 顺序串行消费 Stream、cancelAll。
- `model/search_result.dart`：friend/post/chat/applet/stationContent 类型。
- `controller/search_controller.dart`：300ms debounce、上下选择与执行；执行动作仅记录日志并关闭。
- `binding/launch_binding.dart`：注册聚合服务，未见 provider 注册。
- 该范围 `git grep 'registerProvider\|implements SearchProvider'` 只命中注册方法声明。
- `repository/launch_repository.dart`：Station Search proto 调用路径为 POST，而当前 Station 路由为 GET，不能拿它当作当下可复用生产连接。

处置：保留 Provider admission、取消、类型与快捷入口思想；不恢复 Flutter 代码、串行调度或占位动作。

### 4.2 React 迁移：发生调用链替换

`6fe9b1d69`（2026-03-23）`apps/desktop/src/services/api.ts:1082–1093` 使用 `/search/sources`、GET `/search?q=...`、POST `/search/ai`。`f843aef35`（03-24）删除这些 HTTP 调用并新增 Native application Search stub。之后 `63df4a63b`、`7822e560e` 到当前快照仍为空。

已证实“原有客户端 HTTP 查询路径被空 Native 实现替换”。尚未找到旧 HTTP backend 的生产实现及运行证据，所以不能宣称它之前能搜完整真实数据，也不能把 2026-10 的导航改动认定为 stub 起因。

### 4.3 历史文档与原型

- `docs/context/features/RADAR_SEARCH_NEXT_STEPS.md`：2026-01-03 Actor fuzzy search、Flutter UI、WebFinger/Relay 后续设想，已有 historical 标记；不是门户合同。
- `docs/architecture/domains/chat/message-search.md`：包含本地 E2EE 思路，但“Desktop 无消息搜索 UI”、新 `chat_search_local` 待接、服务端 pre-E2E plaintext 搜索等段落与当前实现混杂。`simple` 不等于中文词语切分。实施前应由 Chat Owner 把它更新为当前消息能力合同。
- `packages/prototypes/{desktop/features/social-chat,mobile/chat}`：有消息搜索局部原型。没有在本次文件清单中找到完整门户 Search 的已确认产品原型。

## 5. 官方行业证据及取舍

资料访问日均为 2026-10-22；以下只据成功读取的官方正文，不引用搜索摘要替代正文。

### Slack：跨类型结果与可解释筛选

[Search in Slack](https://slack.com/help/articles/202528808-Search-in-Slack)：全局入口、建议、消息/文件/人员/频道/画板分类、`in:` / `from:` / 时间 / phrase 等筛选，以及会话内搜索。

采用：全局与局部 scope 同义；自然语言/筛选条件可视化为用户可编辑约束；消息打开原会话与上下文。调整：Peers 的 E2EE 消息保持本地，不能照搬企业服务端内容索引。

### Notion：快速打开与深检索连续，能力范围明确

[Search in your workspace](https://www.notion.com/help/search)：⌘P/⌘K、最近访问、标题/全文差异、作者/位置/时间筛选、相关性/日期排序；明确 workspace search 和 database search 不同，且 comments 等不覆盖。

[Enterprise Search](https://www.notion.com/help/enterprise-search)：Home 中问答、连接来源、页面/人员上下文、来源过滤、回答引用；默认包含 web 是 Notion 的产品选择。

采用：门户 Find/Open 连续、来源过滤、引用原对象、明确可搜字段。调整：Peers 默认检索已授权内部来源，Web 与私密内容的 AI 外发由用户显式选择。

### Glean：内容接入必须同时接入权限和身份

[Permissions](https://developers.glean.com/api-info/indexing/documents/permissions)：datasource、document permissions、users/groups/membership、access check；权限同步是异步的。

采用：来源不是一个 URL，而是稳定身份、对象、权限、增量、删除和检索合同。调整：Peers 有 Federation 和本地 E2EE，不能用一个企业 ACL mirror 代替所有域的 authority；异步 ACL 索引之外仍需当前权限校验。

### Raycast：显式可执行意图与扩展生命周期

[Lifecycle](https://developers.raycast.com/information/lifecycle)：root search 启动 command、alias、fallback、deeplink；command 运行后卸载，有资源边界。

采用：快捷 Search 能打开对象、转移查询或调用显式动作；Applet/provider 按声明加载。调整：输入内容和按 Enter 默认只打开选中结果；发送、关注、删除、创建等动作需进入原域操作合同，不能由检索词自动执行。

### SQLite 与 PostgreSQL：复用现有索引，语言能力不能凭配置名推定

[SQLite FTS5](https://www.sqlite.org/fts5.html)：BM25、snippet/highlight、prefix、tokenizer、external-content 更新删除、rebuild 与 secure-delete；trigram 支持 substring，但少于三个 Unicode 字符的全文匹配有边界。

[PostgreSQL Text Search](https://www.postgresql.org/docs/current/textsearch-intro.html)：token parser、dictionary/normalization、rank/index；LIKE 不能代替完整检索模型。

采用：本地继续 SQLCipher/FTS5，Station 复用 PostgreSQL 的派生投影与权限查询。中文短词、混合文本、handle、编号需要独立 corpus 验证；不能把 unicode61/simple 写成“已支持中文高召回”。

### Meilisearch：成熟多索引聚合与租户过滤，仍不拥有业务授权

[Federated search](https://www.meilisearch.com/docs/capabilities/multi_search/getting_started/federated_search)：multi-search 合并、来源权重、分页、跨索引 distinct；远端 facet 计数有准确性边界。

[Tenant tokens](https://www.meilisearch.com/docs/learn/security/tenant_tokens)：服务端生成短期 token 与 filter，只授权 search endpoint；token 不能替代业务资源的实时撤权。

候选用途：Station 需要成熟 typo/CJK/hybrid、规模或运维证据表明 PG 方案不满足时，使用官方 SDK 接入。当前没有测量，不冻结引入第二个引擎；不自研搜索引擎。引擎的 federation 是结果合并机制，不等于 Peers Federation 信任协议。

Mastodon 与 Matrix 的官方文档正文在本次工具访问中未成功取得，因此没有据它们写确定性产品结论。

### Spotlight 与 Raycast：轻入口，查询后逐层展开

[Spotlight macOS Tahoe 26](https://support.apple.com/guide/mac-help/search-with-spotlight-mchlp1008/26/mac/26)：按钮/快捷键唤起，边输入边出结果，top match 优先；可以打开、预览、显示位置与执行动作。本文使用明确版本的官方手册，不根据未限定版本页面推定全部设备能力。

[Raycast Search Bar](https://manual.raycast.com/search-bar)：同一个 Root Search 呈现应用、命令、文件/目录、联系人、Settings 和 AI 入口。Compact Mode 在空输入时只保留搜索框，输入或打开操作面后展开。精确 alias、前缀、标题模糊匹配、关键词与使用频率共同影响排名；不是把所有内容按网络返回顺序拼起来。

[Raycast File Search](https://manual.raycast.com/file-search)：文件直接进入 Root Search，Search Files 再提供更完整的列表、元数据与操作面。默认匹配文件名，Content Search 单独启用并复用 Spotlight/Windows Search；索引在本机，不同步或上传 Raycast。可授予单独目录、配置 scopes/ignore，并如实显示 OS 正文索引不可用状态。

[Raycast AI Extensions](https://manual.raycast.com/ai/ai-extensions)：扩展把命令声明为工具，AI 在 Quick AI、AI Chat 或 Root Search 中选择调用；File Search 可通过自然语言进入同一索引，工具权限有独立控制。索引本机保留不等于 AI 调用绝不外发；两者必须分别核对。

**产品判断**：这组资料最适合 Peers 的触达和文件/功能直达。统一检索框与深入结果不是两套产品；快速找具体对象不必经历生成长答案。Raycast 自身是 Launcher，因此其 Root Search 是本产品首页；不能据此要求 Peers 的默认工作页也必须是 Search。

### 手机 Finder：用户选范围，自然语言仍有覆盖边界

[Samsung Finder](https://www.samsung.com/us/support/answer/ANS10013035/)：支持 Home screen 的 Finder 按钮和可配置的应用检索范围，较新版本的自然语言检索覆盖 Notes、Calendar、Reminders、My Files 等指定内容。官方说明入口和能力受软件/设备版本影响，不能泛化到所有 Android 手机。其 reservation/recall cards 属于可控制的附加能力。

**产品判断**：可借鉴按需入口、指定来源和自然语言找个人内容。负一屏 Feed、主动推荐卡片与搜索是不同能力；用户要求轻量搜索不足以授权复制个人通知分析或完整资讯 Feed。

### Google：传统结果、自动摘要和深入问答并存

[AI Overviews](https://support.google.com/websearch/answer/14901683?hl=en)：系统在认为生成式 AI 有帮助时，在普通结果中给出摘要与来源链接；Web filter 可以只显示网页链接。

[AI Mode](https://support.google.com/websearch/answer/16011537?hl=en)：另有主动进入的深入问答路径，可拆分问题并行搜索，再组织带链接的回答和追问；低置信时可能返回网页链接集合。用户可在 All 和 AI Mode 之间切换，Google 个人内容连接也有独立选择。

**产品判断**：AI 搜索不是单纯在检索结果后加一个总结按钮，也不必把所有查询变成聊天。明确对象优先打开，信息问题可提供短答案，复杂问题再深入；具体是否自动展示短摘要是 Peers 的产品选择。Google 的自动摘要表明“AI 永远要单独点击”不是业界统一规则。

### Notion 与 Glean：来源覆盖、权限和引用共同构成产品

Notion 的 [Workspace Search](https://www.notion.com/help/search) 从侧栏/快捷键打开紧凑窗口，先提供最近页与快速打开；Search all sources with AI 进入完整结果并按来源/标题/作者筛选。搜索也可直达 Home、Settings 等功能。

Notion 的 [Enterprise Search](https://www.notion.com/help/enterprise-search) 默认可包含已连接来源和 Web，用户可调整；答案引用来源。这个默认与本草案的网络显式启用不同，不能说业界一致默认关闭 Web。

Glean 的 [Permissions](https://developers.glean.com/api-info/indexing/documents/permissions) 明确把文档权限、用户、组和成员关系纳入 indexing API，并说明异步处理。它支持 Peers 建立来源接入协议的判断，但不证明 Peers 可省略 E2EE 或当前权限重校验。

### 系统接入协议与混合检索

[Apple IndexedEntity / OpenIntent](https://developer.apple.com/documentation/appintents/making-app-entities-available-in-spotlight.md)：App 声明实体、可索引字段和稳定 ID，并提供重建与原对象打开意图；系统搜索不靠猜页面 URL 找原对象。官方也描述 lexical/semantic search；不能直接推导全部平台版本都具备同一实现。

[Android AppSearch](https://developer.android.google.cn/develop/ui/views/search/appsearch?hl=en)：数据具有 schema、namespace/ID、TTL、rank、分页和 snippet；平台索引仅可检索应用自己贡献或另一应用明确共享的数据，并可控制是否出现在 System UI。手机系统级搜索也需要内容声明和共享权限，不自动读取所有 App 私有数据。

[Elastic Hybrid Search](https://www.elastic.co/docs/solutions/search/hybrid-search)：在同一请求运行全文与向量检索，再合并为一个排名列表，官方推荐 RRF。它是成熟引擎的检索路径示例，不是 Peers 引入 Elasticsearch 的选型结论。

**归纳与证据范围**：Spotlight、Raycast 和 Notion 均支撑“统一入口、快速结果、深入处理逐层展开”；Raycast、Apple 和 Android 均支撑“索引/对象接入需要声明与权限边界”。Google 和 Notion 对自动 AI 摘要、默认 Web 的选择不同，说明这些是依赖产品定位的取舍。资料核对日为 2026-10-22，以上为官方正文证据，未在实机独立验证产品延迟、召回或所有版本的 UI。

## 6. 设计输入与需补证据

> 范围更新（2026-10-22，决策 D-19）：Search 已收窄为 Peers-Touch 封闭域（端 + Station、当前 actor 授权）。本文关于公网搜索、搜索商接入、OS 授权目录与外部 connector 的行业资料仅保留为历史调研；对应产品方向已移出范围，不作为待接入能力。

已支撑的设计输入：门户调用链断裂、内容接入合同缺失、独立搜索资产可复用、账号/Station scope 必须明确、打开原对象不可省略、错误/零命中/覆盖不全必须区分。

实施前需补：真实 Search Journey 基线；搜索历史具体可用版本；当前账号/Station 切换与数据销毁行为；各内容域 read/revoke 合同；中文/混合语种 corpus 与索引体积；域内附件/Federation 来源 producer 与 receiver 可见完成证据，以及域外来源无法接入的否定证明。

补充研究见[组件可行性](../architecture/domains/search/feasibility.md)：已有真实公开文档的加密 FTS/PG、受控文件边界、协调器与模型测量（公共网络实验仅为历史机制证据）；默认中文短词遗漏、中文查询英文/混合文档的语义召回不足均被观察。本文仍是指定快照的源码/行业研究，不把独立实验追写为原生产品基线。

后续合同入口：[Search 设计草案](../architecture/domains/search/README.md)。本文不授予实施、上线或搜索引擎选型授权。
