# 端侧 Search「找回 + 打开」实施计划

> **Plan ID**: SRCH-20261022
> **Version ID**: 20261023-device-find-open-direct-write
> **Created**: 2026-10-23T02:00:00.000Z
> **Owner**: Search / Client

本计划只冻结实施模型，不表示实现已完成，也不授权 push、PR、发布、数据重置或历史改写。允许本地 checkpoint commit。Station 侧 S/F 区、联邦检索、Mobile 适配与 Ask/语义回答由后续独立计划承担。

## 目标与完成口径

完成后必须同时成立：

1. Desktop 普通启动、登录完成与账号切换默认进入 Chat；Search 只由按钮或 ⌘K 唤起为 singleton overlay，关闭恢复触发前页面（S-01/S-02，D-01）。
2. 用户可跨会话找回本机已恢复的端到端加密消息与会话，结果带会话/作者/时间/片段，打开定位到具体 message anchor（V-01 端侧部分）。
3. 中文短词、中英混合、附件名可被检索；分词与查询表达式由唯一共享 Rust 核心定义（D-13），不再使用整串 quoted phrase（unicode61 对 CJK 整串成一个 token 的遗漏已有实测，见 feasibility-evidence）。
4. 功能直达从受信任 descriptor catalog 匹配名称/别名/用途，打开原模块操作面；搜索本身不产生副作用（D-12，S-08）。
5. 端侧检索链路不产生任何 Station/网络请求；代码与设置中不存在公网搜索引擎、OS 文件、外部 connector 路径（D-19，含旧 ToolsTab 搜索商配置链）。
6. 旧搜索商 UI 与设置项、成功空 stub、`search` 默认落点在同一 hard cut 中删除，不保留双 owner、facade 或永久 flag。

人类可读的执行前后差异见 [outcome-comparison.md](./outcome-comparison.md)。其计划区进入 `planVersionDigest`，实际结果区初始全部 `UNPROVEN`，仅在对应 Task `doneWhen` 与 Journey 满足后按 current-source evidence 回填。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "SRCH-20261022",
  "versionId": "20261023-device-find-open-direct-write",
  "createdAt": "2026-10-23T02:00:00.000Z",
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/domains/search/README.md",
      "docs/architecture/domains/search/product.md",
      "docs/architecture/domains/search/design.md",
      "docs/architecture/domains/search/data-model.md",
      "docs/architecture/domains/search/module-layout.md",
      "docs/architecture/domains/search/integration.md",
      "docs/architecture/domains/search/extensions.md",
      "docs/architecture/domains/search/decisions.md",
      "docs/architecture/domains/search/feasibility.md",
      "docs/architecture/domains/search/feasibility-evidence.md",
      "docs/architecture/domains/search/prototype/README.md"
    ],
    "decisions": ["D-01", "D-02", "D-03", "D-04", "D-05", "D-06", "D-07", "D-12", "D-13", "D-16", "D-17", "D-19"]
  },
  "scope": {
    "sourceClaims": [
      { "pathPrefix": "model/domain/search", "mode": "exclusive-write" },
      { "pathPrefix": "model/build.sh", "mode": "exclusive-write" },
      { "pathPrefix": "packages/search-core", "mode": "exclusive-write" },
      { "pathPrefix": "packages/messaging-core", "mode": "exclusive-write" },
      { "pathPrefix": "apps/desktop", "mode": "exclusive-write" },
      { "pathPrefix": "packages/locales", "mode": "exclusive-write" },
      { "pathPrefix": "docs/architecture/domains/search", "mode": "exclusive-write" },
      { "pathPrefix": "docs/architecture/engineering/architecture-governance/architecture-modules.json", "mode": "exclusive-write" },
      { "pathPrefix": "docs/architecture/engineering/prototypes", "mode": "exclusive-write" },
      { "pathPrefix": "model", "mode": "shared-read" },
      { "pathPrefix": "apps/mobile", "mode": "shared-read" },
      { "pathPrefix": "apps/station", "mode": "shared-read" },
      { "pathPrefix": "packages/prototypes", "mode": "shared-read" },
      { "pathPrefix": "docs/client", "mode": "shared-read" }
    ],
    "nonGoals": [
      "Station S 区检索（人员/会话/Social/Agent/知识/附件的服务端 adapter 与行级权限链）",
      "F 区联邦按需检索与对端裁决",
      "Mobile / Android / iOS 的 Search UI 与 host adapter 切换",
      "Ask 问答、embedding、rerank、语义召回与外部模型二次授权",
      "Applet contributor 与 MCP/Skill 来源接入",
      "附件正文提取/OCR/音视频转写（本期只随消息检索附件名）",
      "通知/免打扰设置分区（生产尚不存在，catalog 不登记空目标）",
      "公网搜索、OS 任意目录文件检索、外部网站或 SaaS connector 的任何入口或配置",
      "跨 actor 管理员检索与搜索词云端历史",
      "保留旧搜索商页面、ToolsTab 搜索引擎配置或成功空 stub",
      "生产发布、push、Pull Request、远程部署、数据重置或历史改写"
    ]
  },
  "tasks": [
    { "id": "SRCH-D01", "workstreamId": "CONTRACT-CORE", "path": "tasks/SRCH-D01.md", "dependsOn": [] },
    { "id": "SRCH-D02", "workstreamId": "DEVICE-INDEX", "path": "tasks/SRCH-D02.md", "dependsOn": ["SRCH-D01"] },
    { "id": "SRCH-D03", "workstreamId": "COORDINATOR", "path": "tasks/SRCH-D03.md", "dependsOn": ["SRCH-D01", "SRCH-D02"] },
    { "id": "SRCH-D04", "workstreamId": "OVERLAY", "path": "tasks/SRCH-D04.md", "dependsOn": ["SRCH-D03"] },
    { "id": "SRCH-D04B", "workstreamId": "LANDING-CUT", "path": "tasks/SRCH-D04B.md", "dependsOn": ["SRCH-D03", "SRCH-D04"] },
    { "id": "SRCH-D04C", "workstreamId": "ANCHOR", "path": "tasks/SRCH-D04C.md", "dependsOn": ["SRCH-D04"] },
    { "id": "SRCH-D05", "workstreamId": "FUNCTIONS", "path": "tasks/SRCH-D05.md", "dependsOn": ["SRCH-D04"] },
    { "id": "SRCH-D06", "workstreamId": "HARD-CUT", "path": "tasks/SRCH-D06.md", "dependsOn": ["SRCH-D04B", "SRCH-D04C", "SRCH-D05"] }
  ],
  "outcomeComparison": {
    "path": "outcome-comparison.md"
  },
  "authorization": {
    "checkpoint": { "localCommit": "allowed", "amend": "allowed" },
    "delivery": { "push": "denied", "pullRequest": "denied" },
    "runtime": { "deployProfiles": [], "destructiveResetScopes": [] },
    "history": { "rewrite": "denied" }
  }
}
```

## 实施模型

1. **SRCH-D01 合同与查询核心。** 立 `model/domain/search/search.proto`（query/intent/scope/result/resourceRef/cursor/coverage/typed error，生成 Desktop TS；本期不启用 Go 生成物），建 `packages/search-core`：分词（CJK 二元接续 + 拉丁词）、AST 与表达式、RRF、cursor、取消、ports trait。纯机制，无 Tauri/DB/Station/UI 依赖。
2. **SRCH-D02 本机索引 CJK 化与跨会话。** FTS 表形与 unicode61 不变，Desktop 在原业务写入/恢复投影中直接写分词文本，并以同一分词生成 MATCH 表达式。无 generation/meta 表、启动迁移或兼容索引。Mobile 原 raw DML/MATCH 保持不变；会话内 SearchMessagesModal 继续作为 S-03 局部搜索。
3. **SRCH-D03 Desktop coordinator（新增不替换）。** 新增 typed 命令 suggest/submit/cancel 与真实 coordinator，注册到 invoke_handler 与 http_gateway；旧四个 stub 命令本任务保留可编译（旧 TS 仍消费），但不构成兼容层——其唯一用途是支撑到 D04B 的直接替换，不新增任何对旧命令的调用。依赖审查机械证明零 transport。
4. **SRCH-D04 生产 overlay。** 按 confirmed 原型实现 singleton overlay、查询 runtime/projection、i18n 与键盘/IME；⌘K 与搜索按钮唤起 overlay。
5. **SRCH-D04B 旧搜索世界直接替换：Chat 默认落点 + 旧 TS 消费者与旧 Rust stub 同批删除。** overlay 就绪后的下一个闭包即完成替换：`DEFAULT_READY_PAGE` 切 chat，盘点 hash/warm-resume/深链/侧栏/命令面板，移除旧搜索商 TS 链（api 包装、sources store/runtime、页面注册、mock gateway、旧 locale）、删除 SearchPage 文件，并在同一 commit 删除旧四个 Rust stub 命令、合同类型与 main.rs/http_gateway 注册——TS 无消费者与 native 删除原子完成，不保留死命令窗口。
6. **SRCH-D04C 资源定位与消息 anchor。** 新增导航解析负载（conversationId/messageId/source），打开会话后等待历史加载并复用 `scrollToMessageUlid` 滚动高亮；这是生产中当前不存在的新机制。
7. **SRCH-D05 功能直达。** 只登记生产真实存在的目标：隐私与安全（security）、身份与站台（federation/network）、存储与空间（storage）、新建 Agent（openAgentCreateFlow 接线）；别名/eligibility/无副作用。
8. **SRCH-D06 搜索商配置 hard cut 与零遗留收口。** 删除 **ToolsTab 搜索引擎配置整条链**（SettingsPage、desktop_api、application/tools、tauri_commands/tools、http_gateway、main.rs、双份 SearchPrimaryInput）；search-scoped 零遗留机械检查（含对 D04B 已删 stub 的复核）；全套源码检查、tauri:build 与当前源码 Journey 重跑。

## Hard Cut 与派生索引规则

- FTS 是原 Messaging 加密库中的派生状态；新写入和业务恢复投影直接写分词正文与附件名，禁止 plaintext dump。不迁移原文、恢复 cursor 或密钥。
- 共享 schema 不提升搜索版本、不增加 meta 表或 migration hook；表形/列/tokenizer 不变。Mobile 继续 raw 写入与整串 phrase 查询（Mobile messaging 测试为守卫）。
- 新产品直接迭代，不提供旧 raw 索引/客户端兼容和库级 downgrade。不声明启动已把旧 FTS 行重分词；已恢复内容重新投影只能通过原业务 owner，不通过旧查询 fallback。
- 旧路径直接迭代不留尾巴：D03 只允许一个开发迭代窗口的新增重叠（不新增旧命令调用）；D04B 在 TS 消费者拆除的同一 commit 删除旧 Rust stub/合同/注册与 SearchPage，不保留死命令；D06 删除 ToolsTab 搜索商链。回滚走 VCS revert，无运行时双轨、无 feature flag。
- Station `launcher` mock 检索路由本期不删除（shared-read，无任何客户端消费者，已机械核实）；其撤除与 INTEGRATION 文档更新作为 **Station S 区计划的显式跟踪项**，本计划不声称服务端已收口。
- 每个 Task 开始前从当前源码生成消费者/旧 owner inventory 与精确 changed-file allowlist；目录级 claim 只是上限。
- 所有用户可见文案进 `packages/locales`，禁止硬编码中英文。

## Acceptance Execution

本期为 DEVELOPMENT_ITERATION 收口：端侧 Journey 以 Desktop native Playwright（tauri-playwright，前置：`make desktop` 已启动、Station:18080 与测试账号、命名空间语料）FUNCTIONAL_CHECK 与聚焦源码检查证明；正式业务 Acceptance Gate 与 Station/双端 Suite 随后续计划注入。未运行 Gate 保持 UNPROVEN，不自动回填。

```json
{
  "closures": {
    "srch-d01-contract-core": [],
    "srch-d02-device-fts-cjk": [],
    "srch-d03-desktop-coordinator": [],
    "srch-d04-overlay": [],
    "srch-d04b-landing-cut": [],
    "srch-d04c-resource-anchor": [],
    "srch-d05-function-shortcuts": [],
    "srch-d06-zero-legacy": []
  },
  "completion": [],
  "full": []
}
```

## 审批边界

用户已于 2026-10-22 批准端侧「找回 + 打开」切分、CJK 分词进入首个切片，以及旧客户端搜索路径 clean cut；Station 侧检索明确后期再做。该批准不授权 push、PR、发布、远程部署、数据重置、历史改写，也不把 Journey 结论扩大为 Station、联邦或 Mobile 已验证。
