# 端侧 Search「找回 + 打开」：执行前后效果对比

> **Plan**: `SRCH-20261022`
> **Version**: `20261023-device-find-open-direct-write`
> **用途**: 实施前确认预期效果，实施后按当前源码核对端侧 Journey 与源码零遗留
> **当前阶段**: Desktop Find/Open 与 contributor/cache 已落地；开发检查与受控变更探针见本 worktree `tmp/search-native/`。正式 Acceptance 未运行。

## Outcome Comparison Contract

```json
{
  "kind": "peers-touch-outcome-comparison-contract",
  "schemaVersion": 1,
  "planId": "SRCH-20261022",
  "plannedSectionDigest": "sha256:3d5f645460c174becd62d6f42f5c0f8ab470d18db79a43444598c750ff36c059",
  "criteria": [
    {
      "id": "SRCH-O01",
      "dimension": "user-experience",
      "title": "Chat 是默认落点，Search 是不打断上下文的覆盖层",
      "taskIds": ["SRCH-D04", "SRCH-D04B", "SRCH-D06"],
      "gateIds": []
    },
    {
      "id": "SRCH-O02",
      "dimension": "user-experience",
      "title": "找回结果可定位到具体消息与设置分区",
      "taskIds": ["SRCH-D04C", "SRCH-D05"],
      "gateIds": []
    },
    {
      "id": "SRCH-O03",
      "dimension": "product-capability",
      "title": "跨会话找回本机加密消息，中文短词与附件名可召回",
      "taskIds": ["SRCH-D02", "SRCH-D03", "SRCH-D04", "SRCH-D04C"],
      "gateIds": []
    },
    {
      "id": "SRCH-O04",
      "dimension": "product-capability",
      "title": "同一搜索框直达受信任功能且无副作用",
      "taskIds": ["SRCH-D05"],
      "gateIds": []
    },
    {
      "id": "SRCH-O05",
      "dimension": "architecture",
      "title": "查询语义只有一个 Rust 核心，renderer 不复制引擎",
      "taskIds": ["SRCH-D01", "SRCH-D03"],
      "gateIds": []
    },
    {
      "id": "SRCH-O06",
      "dimension": "architecture",
      "title": "封闭域：端侧检索零外发，无公网/OS/connector 路径",
      "taskIds": ["SRCH-D01", "SRCH-D03", "SRCH-D06"],
      "gateIds": []
    },
    {
      "id": "SRCH-O07",
      "dimension": "technology",
      "title": "CJK 分词直写既有加密 FTS，共享表形和 Mobile 行为不变",
      "taskIds": ["SRCH-D01", "SRCH-D02"],
      "gateIds": []
    },
    {
      "id": "SRCH-O08",
      "dimension": "technology",
      "title": "查询/结果合同 proto-first，双端与 Station 后续复用",
      "taskIds": ["SRCH-D01"],
      "gateIds": []
    },
    {
      "id": "SRCH-O09",
      "dimension": "quality-operations",
      "title": "旧路径零遗留 hard cut，当前源码通过检查、构建与 exact-source Journey",
      "taskIds": ["SRCH-D02", "SRCH-D03", "SRCH-D04", "SRCH-D04B", "SRCH-D04C", "SRCH-D05", "SRCH-D06"],
      "gateIds": []
    }
  ]
}
```

## Planned Outcome Comparison

### SRCH-O01: Chat 是默认落点，Search 是不打断上下文的覆盖层

- Before: 生产默认落点是 `DEFAULT_READY_PAGE='search'`，Search 是持久路由页；Rust 搜索命令永远返回成功空结果，搜索商来源界面承担首屏。
- Target: D04 交付 singleton overlay（⌘K/按钮唤起、Esc 还焦）；D04B 把默认落点切为 chat，拆除 hash/warm-resume/侧栏/命令面板中的 search 页路由与旧 TS 消费者；无会话、无来源、身份恢复时都不自动弹搜索。
- Expected effect: 启动即进入人际聊天；检索是按需动作，不抢占 Chat 默认落点，也不留下独立搜索页标签。
- Non-claim: 不声明 Mobile 行为已切换；overlay 不等同完整结果页（本期桌面单形态）。

### SRCH-O02: 找回结果可定位到具体消息与设置分区

- Before: 搜索结果为空或外部搜索商条目；没有"消息 anchor 定位"路径（生产无 ResourceResolver），功能设置需要用户自己记住菜单层级。
- Target: D04C 新增类型化打开负载，消息结果打开会话、等待历史加载后滚动高亮到目标 ULID，失效目标可恢复；D05 让功能结果直达真实存在的 Settings 分区（security/federation/storage）或 Agent 新建流程；返回保留 query/filter/scroll。
- Expected effect: "我记得有这么句话/那个设置"的任务一步闭环，而不是只给一个会话让用户自己翻。
- Non-claim: 不保证 Social 帖、Agent 轮次与知识段落 anchor（Station/内容侧来源后期提供）；通知/免打扰分区尚不存在，不提供假入口。

### SRCH-O03: 跨会话找回本机加密消息，中文短词与附件名可召回

- Before: FTS5 unicode61 把连续 CJK 串切成单个 token，查询又被包成整串 quoted phrase，中文短词系统性漏召回；现有查询只支持单会话。
- Target: 索引与查询共用 CJK 二元接续分词；支持跨会话只读检索；附件名随消息可搜；hidden/retracted/删除不复活。
- Expected effect: 用户用中文片段、中英混合、附件名都能在已恢复的本机历史中找回内容，且每条结果仍只来自其本来有权打开的会话。
- Non-claim: 召回质量指标（Recall@10/MRR）基线未冻结，本期只做语料探针级证明，不宣称排序达标。

### SRCH-O04: 同一搜索框直达受信任功能且无副作用

- Before: 功能导航与搜索无关；原型验证过"功能"意图但生产无 catalog。
- Target: 单一 descriptor catalog 提供名称/别名/用途匹配与 eligibility 过滤；打开只导航到原操作面，写操作在原表单确认；不可用入口不显示。
- Expected effect: 输入"隐私/站台/存储/新建 Agent"等自然词即可到达，不需要知道菜单结构；搜索不产生任何业务写入。
- Non-claim: Applet、第三方与 MCP/Skill 功能来源本期不接入。

### SRCH-O05: 查询语义只有一个 Rust 核心，renderer 不复制引擎

- Before: Desktop TS 侧有来源/结果模型与搜索商分组，Rust 侧是 StubPayload；没有共享查询语义；Mobile 另有自己的搜索 hook。
- Target: `packages/search-core` 独占分词、AST、RRF、cursor、取消与 ports trait；Desktop coordinator 与 Tauri 命令是 typed adapter；renderer 只维护输入/选中/预览投影。
- Expected effect: 后续 Mobile 与 Station 接入时复用同一份语义，不再各写一套查询/融合代码。
- Non-claim: Station Go 实现与 Mobile host 切换不在本期；核心目前只有测试与 Desktop 两个消费者。

### SRCH-O06: 封闭域：端侧检索零外发，无公网/OS/connector 路径

- Before: 旧产品形态含搜索商 provider、web 来源图标、Settings ToolsTab 搜索引擎配置与 Station mock 搜索结果，语义上连接域外。
- Target: proto scope 只有 closed-domain/device 值，域外请求在 admission 被 `SCOPE_OUTSIDE_SEARCH_DOMAIN` 拒绝；coordinator 与 search-core 无 Station transport 依赖（机械 allowlist 检查）；D06 删除 ToolsTab 搜索商配置整条链（TS API、Rust tools 命令、双份合同、UI 卡片），UI/descriptor/command 三层无公网、OS 文件、connector 入口。
- Expected effect: 检索 E2EE 内容时明文不出设备；用户界面与设置中都不存在搜索引擎配置，架构上没有可绕过的开关。
- Non-claim: Station launcher mock 路由本期仅失去客户端消费者，服务端代码撤除随 Station 计划；S/F 区权限链与联邦存在性不泄漏在后续计划证明。

### SRCH-O07: CJK 分词直写既有加密 FTS，共享表形和 Mobile 行为不变

- Before: FTS schema 由 messaging-core 统一持有（unicode61），Desktop/Mobile 各自维护硬编码 DML；查询被包成整串 quoted phrase，没有分词版本概念。
- Target: 表形/列/tokenizer 不变；Desktop 业务写入/恢复投影直接写分词正文与附件名，查询使用同一核心；没有搜索 generation/meta 表、迁移钩子、启动重建或兼容查询。
- Expected effect: 新写入和重新恢复的本机消息可用中文片段查找，不产生明文派生文件；Mobile 既有 raw DML/MATCH 与 retract 行为不变。
- Non-claim: 不做跨设备索引同步，不保证原有 raw FTS 行已自动重分词或旧客户端兼容；真实 corpus 体积与耗时未冻结。

### SRCH-O08: 查询/结果合同 proto-first，双端与 Station 后续复用

- Before: 无 search proto domain；TS/Rust/Go 各自定义形状。
- Target: `model/domain/search/search.proto` 本期生成 Desktop TS 产物（build.sh 最小修改为无 go_package 的 proto 跳过 Go 生成）；QueryIntent、Scope、ResultItem、ResourceRef、Cursor、Coverage 与 typed error 单一真源；Go 生成物待 Station S 区计划启用。
- Expected effect: SRCH 后续 Station/Mobile 计划不需要重新谈判线合同；renderer DTO 与生成代码一致。
- Non-claim: 生成产物的 Station 业务消费本期不存在；proto 中 S/F 枚举值保留但不实现。

### SRCH-O09: 旧路径零遗留 hard cut，当前源码通过检查、构建与 exact-source Journey

- Before: 成功空 stub、搜索商 SearchPage、sources store、`search` 默认落点并存，容易被误认为已实现搜索。
- Target: D04B 在 overlay 就绪后的同一替换闭包内删除旧 stub/SearchPage/TS 消费者（TS 拆链与 native 删命令同一 commit，无死命令窗口）；D06 原子删除 ToolsTab 搜索商配置链；search-scoped 机械零遗留检查（不波及通用 StubPayload）通过；Desktop check/test/build、tauri:build 与四条 exact-source Journey（overlay/默认落点/anchor/功能）在当前 commit 为 FUNCTIONAL_PASS。
- Expected effect: 新链路就绪即替换旧世界，代码库只有一种搜索现实，不保留兼容层、废弃别名或 feature flag；源码回滚由 VCS 管理，不预建运行时兼容模式。
- Non-claim: 未运行 Completion/Full 正式 Acceptance 与 Station/双端 Suite；这些 Gate 保持 UNPROVEN。

### 明确不变与非目标

- Messaging 继续拥有消息正文、E2EE、恢复、redaction 与 FTS 写入时机；Search 只拥有派生检索合同。
- Station 业务真源、launcher mock 服务端代码、联邦协议本期不改不动。
- 不做 Mobile 切换、Station S/F 区、Ask/语义、Applet 来源、附件正文/OCR、公网或 OS 检索。
- 不授权 push、PR、发布、远程部署、数据重置与历史改写。

### 风险与回滚影响

- FTS 表形不改但 Desktop 写入与查询语义改变：Mobile cargo check 与 messaging 测试守住现有行为；Mobile 真正切换属后续计划。
- 分词直写覆盖新写入和业务恢复投影；已有 raw FTS 行不保证中文短词命中。未恢复历史需要如实显示 coverage，绝不回退服务端搜私密正文。
- 不支持旧查询、旧 raw FTS 兼容或库级 downgrade；不以历史数据兼容为由添加代际体系。
- D03 只在一个开发迭代窗口内新增命令（不新增旧命令调用）；D04B 同 commit 拆 TS 消费者并删除旧 native stub；D06 删 ToolsTab 搜索商链：每个中间提交可编译可运行，且不保留死命令或兼容层。
- 任一 Journey 或零遗留检查失败，计划保持 UNPROVEN，不得用构建成功替代。

## Actual Outcome Results

```json outcome-comparison-results
{
  "kind": "peers-touch-outcome-comparison-results",
  "schemaVersion": 1,
  "planId": "SRCH-20261022",
  "sourceIdentity": {
    "worktree": "/Users/bytedance/Documents/Projects/peers-touch/peers-android",
    "branch": "analysis/android-platform-alignment",
    "commit": "cb54f5708cfa8eee7c0458fd2673a8583e8abd75",
    "evidenceRef": "tmp/search-native/result.json",
    "binding": "该结果保存运行前后 workspaceDigest 与逐文件 SHA-256；源码评审另绑定 tmp/search-structure-decision.json。"
  },
  "items": [
    { "id": "SRCH-O01", "status": "PARTIAL", "actualEffect": "普通登录默认 Chat；Search 按需单例覆盖层。重开、退格返回保留查询且零次来源读取，重载保留现有页面，退出重登清除搜索状态。", "evidenceRefs": ["tmp/search-native/result.json", "tmp/search-native/01-default.png", "tmp/search-native/02-initial.png"], "deviation": "功能检查为 DEVELOPMENT_ITERATION；同设备多账号 UI 切换缺少已登记夹具，未运行；窗口/账号隔离另有 native registry 测试。" },
    { "id": "SRCH-O02", "status": "PASS", "actualEffect": "真实消息结果经 native resolve 打开、落焦与高亮；返回条独占 Shell 导航空间，返回恢复查询；隐私入口打开真实 Security 分区。受控历史窗口外消息与线程回复均通过原生结果点击定位。", "evidenceRefs": ["tmp/search-native/result.json", "tmp/search-native/04-anchor.png", "tmp/search-native/05-functions.png", "tmp/search-native/09-history-anchor.png", "tmp/search-native/10-thread-anchor.png"], "deviation": "历史/线程使用隔离本机语料，未证明其业务投递生命周期。设置页重载沿原模块重置子分区；原型用 toast 表达 anchor，生产定位实际消息；未声明跨业务 anchor。" },
    { "id": "SRCH-O03", "status": "PARTIAL", "actualEffect": "本机恢复语料中文周会命中；CJK/中英/附件名由共享分析器生成 FTS 表达式。受控消息更新后只重读一项投影，隐藏与成员失权排除热缓存和旧打开引用。", "evidenceRefs": ["tmp/search-native/result.json", "tmp/search-core-current.log", "tmp/search-messaging-probe.log"], "deviation": "编辑/隐藏/撤权探针只改隔离数据库，不证明业务投递与接收端生命周期；真实附件上传搜索未运行，排序质量基线未冻结。" },
    { "id": "SRCH-O04", "status": "PASS", "actualEffect": "单一受信函数目录提供 Settings 分区及 Agent 操作面导航，Help 复用相同静态目录，搜索不产生业务写入。", "evidenceRefs": ["apps/desktop/src/components/search/functions.ts", "tmp/search-native/result.json"], "deviation": "Agent 项进入原模块，创建须由原操作面显式触发；未提供不存在的通知/免打扰入口。" },
    { "id": "SRCH-O05", "status": "PASS", "actualEffect": "Rust 核心提供 query/hydrate/resolve 契约和统一缓存，native 绑定原 Messaging 真源与发布屏障；renderer 仅保留输入和有界结果帧。", "evidenceRefs": ["packages/search-core/README.md", "tmp/search-structure-decision.json", "tmp/search-conformance.log", "tmp/search-native/result.json"], "deviation": "本期单一 Messaging contributor，RRF 为核心资产，未接入多来源融合；Applet 仅留 adapter/binding。" },
    { "id": "SRCH-O06", "status": "PASS", "actualEffect": "本机 Search 无网络或模型读取路径；Station scope、伪造 authority、任意打开 URL 被 native 拒绝；旧 provider 设置和命令链已删除。", "evidenceRefs": ["tmp/search-native/result.json", "tmp/search-structure-decision.json", "tmp/search-legacy-scan.log"], "deviation": "源码与 native admission 证明，不等同全客户端网络抓包；Station 服务端历史 mock 不属于本期。" },
    { "id": "SRCH-O07", "status": "PARTIAL", "actualEffect": "Messaging 继续写既有加密 FTS 表；Desktop 正文与附件名直写共享分词，无 schema/generation/meta/启动重建。", "evidenceRefs": ["tmp/search-messaging-probe.log", "tmp/search-core-current.log", "apps/desktop/src-tauri/src/messaging/store.rs"], "deviation": "Mobile 源码未改，本轮未做 Mobile 编译/运行；旧 raw FTS 不自动重分词。" },
    { "id": "SRCH-O08", "status": "PASS", "actualEffect": "proto 是唯一线合同，新增 authority namespace、通用 anchor、descriptor、批量 outcome、内容 validator/读权有效性；Desktop TS 与 Rust 消费生成物。", "evidenceRefs": ["model/domain/search/search.proto", "tmp/search-ts-check.log", "tmp/search-driver-build.log"], "deviation": "Go/Station/Mobile 尚未消费，未声明未来来源可用。" },
    { "id": "SRCH-O09", "status": "PARTIAL", "actualEffect": "旧 SearchPage、sources/AI DTO、tools provider 命令与消费者已删除；核心/现有前端测试、检查与 native 构建通过，开发 Journey 保留源码和清理证据。", "evidenceRefs": ["tmp/search-native/result.json", "tmp/search-structure-decision.json", "tmp/search-current-tests.log", "tmp/search-ts-check.log", "tmp/search-driver-build.log"], "deviation": "正式 Acceptance NOT RUN/UNPROVEN；无提交、推送、PR、远程部署或发布。完整跨平台/跨来源验证未运行。" }
  ]
}
```
