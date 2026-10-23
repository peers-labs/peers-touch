# Search 门户能力

> **Status**: active
> **Created**: 2026-10-22
> **Owner**: Search / Client / Station
> **Review state**: Desktop D01–D06 源码闭包已落地；原生「找回 + 打开」与缓存开发检查通过。Search Acceptance 已接入并通过结构与源码合同校验；尚无正式原生 E2E PASS。

## 范围

Search 的目标是按需唤起的统一搜索入口，**检索宇宙封闭在 Peers-Touch 域内**：端上私密对象、Station 业务对象以及联邦授权上下文中可见的对端对象，并只返回当前 actor 当前有权限读取的内容；另含域内功能直达。公网搜索、Peers 之外的 OS 文件/目录、外部 connector 不属于检索域（决策 D-19）。本期实施 Desktop 本机消息「找回 + 打开」；Station、联邦、Mobile 与 Ask 后置。生产导航已切为 Chat 默认落点和 singleton Search overlay。

它拥有检索产品与派生索引合同，不拥有 Chat、Social、Agent、Note、Applet 或附件存储的业务真源和写操作。门户、建议快捷搜索和模块内检索共享查询、内容类型、权限与打开语义。各模块是否可搜、哪些字段可搜、内容属于 D/S/F 哪个信任区、撤权/删除如何生效，必须通过内容接入协议声明。

## 阅读顺序

1. [现状、历史与行业参照](../../../research/search-current-state-and-benchmarks.md)：指定源码快照、历史资产、可复用能力与证据缺口。
2. [产品合同](./product.md)：用户任务、入口、结果、恢复、覆盖、权限与问答，
   S-18 定义重复查询、返回、预览、翻页、刷新和离线复用。
3. [技术设计](./design.md)：Owner、运行拓扑、查询聚合、索引、授权与生命周期；
   第 4.1 节定义共享缓存读边界。
4. [数据与接入协议](./data-model.md)：来源声明、对象身份、查询/结果、增量、
   游标及第 7 节的缓存键、逐项读取 outcome、主动读权到期、操作失效屏障、
   session/subscriber 归属与两层取消。
5. [扩展与接入](./extensions.md)：域内来源/SDK、索引后端、附件格式、功能、展示和 Agent/MCP 的独立扩展点（不含域外来源）。
6. [目录与职责](./module-layout.md)：已落地路径、模块边界与后续实现范围。
7. [集成与验证](./integration.md)：现有模块映射、切换约束与待执行的证据要求；
   V-10 包含缓存复用和恢复的调用成本与权限否定证明。
8. [关键决策](./decisions.md)：推荐、理由、代价及仍需实测的选择。
9. [可行性研究](./feasibility.md)与[实验记录](./feasibility-evidence.md)：真实加密 FTS、PG、
   受控文件边界、协调器及模型实验，包含中文跨语言召回反例；其中公网 RSS/OS 目录实验仅作历史机制证据。
10. [目标架构图](./architecture-diagram.md)：D/S/F 信任区、两级执行、四级权限链与否定边界。
11. [原型（confirmed）](./prototype/README.md)：唯一 Desktop Shell 内的封闭域 Search 覆盖层，Owner 已于 2026-10-22 用户层确认。
12. [执行计划：Desktop 端侧「找回 + 打开」](./execution-plans/20261022-device-search-find-open/plan.md)（SRCH-20261022，实现中；Station S/F 区、联邦、Mobile、Ask 属后续计划）。
13. [Desktop Search Acceptance](./acceptance.md)：专用 Feature/Gates、连续原生 Journey、证据与授权边界。

## 当前设计位置

现状研究已完成到源码/历史/官方文档层，独立组件可行性研究已完成。300 份真实文档的 SQLCipher/FTS5 查询 P95 为 2.883 ms，默认中文短词遗漏已复现；分词后的八个关键词探针均找到前十预期对象。PG、文件边界、删除/撤权和协调器机制得到有限实验支撑。

AI 模型执行可行，但当前 E5 中文问题检索英文/混合文档前五仅 2/6，简单融合为 1/6；同意图英文诊断为 6/6。模型、双语分析器与排序尚未选定。这些是组件实验，不能证明生产 Search 性能、正式 Acceptance 或后续语义检索能力；V-01～V-10 的完整目标仍 UNPROVEN。

已确认的边界是一份协议、两级执行、三个信任区（D/S/F）、四级权限执行链、一个客户端查询核心。原业务域继续拥有正文、权限和写操作；Search 只拥有派生检索投影。Desktop Shell 原型已于 2026-10-22 确认。

通用 contributor 保持 descriptor 与 query/hydrate/resolve 三个读方法；未来
外源 adapter 留 binding 位置，具体 Applet SDK/部署/委托不是当前设计门槛。
D-20 已接通 proto、Rust core/native 与 renderer：目录按版本复用，授权资源
投影与查询帧有界保留；内容与读权独立有效。原生探针确认重复查询、重开、
退格恢复零次来源读取，显式刷新进入真源；不同查询复用已读资源。

hydrate 的统一批量请求/响应明确未变、允许投影、不可用与可恢复失败；
读权到期主动关闭已展示内容，payload 淘汰不解除在途操作失效屏障。
排序 session 可被符合当前授权的新 subscriber 复用，旧 intent 取消不连带
取消其他 subscriber，cursor 保持原到期点。共享缓存机制有独立 conformance
探针，Desktop 会话失效与分页有原生证明；其他来源的完整 V-10 仍未证明。

当前源码已有 `model/domain/search/search.proto`、`packages/search-core`、Desktop CJK 分词直写 FTS 与跨会话查询，以及 `search_suggest/search_submit/search_cancel/search_resolve/search_read_state` native 命令。共享 FTS 表形未改，无搜索 generation/meta 表、迁移钩子或兼容索引。原有数据不会在启动时自动重分词；新写入与业务恢复投影直接使用新分词。

D04/D04B singleton 覆盖层与旧页面/命令删除、D04C ResourceRef 消息定位、
D05 真实功能目录、D06 ToolsTab 搜索商链清理均已落地。当前原生检查包含
中文查询、结果打开还焦、返回、设置直达、重载、非法资源与退出重登。
本轮原生结果与截图保存在 worktree 的 `tmp/search-native/`，仅为开发证据。

当前 native 命令使用生成的 protobuf bytes；Submit 只接受 DEVICE/FIND，
支持本机消息 keyset 分页与会话名读取，其他 scope/intent/不支持的 kind 拒绝。
Suggest 使用会话名和消息候选，消息按时间顺序；RRF 是核心资产，本期单来源
不宣称混合排序质量。取消按窗口/账号/request ID 管理，session revision 与 Engine
身份校验阻止失效结果发布。未鉴权 HTTP gateway 拒绝私有 Search。
其他来源、完整混合检索与跨设备未运行；正式原生 Acceptance 尚未证明。

## 相关真源

- [架构文档入口](../../README.md)
- [Chat 消息检索专题](../chat/message-search.md)：需由 Chat Owner 更新过时段落。
- [Desktop Runtime projections](../../../client/desktop/runtime-projections.md)
- [Client UI Identity](../../../client/common/ui-identity/README.md)
- [Applet Runtime](../../platform/applet-runtime/README.md)
- [API Governance](../../engineering/api-governance/README.md)

Search 架构在 [模块治理表](../../engineering/architecture-governance/architecture-modules.json) 登记；`client.search.portable-core` 只声明 Desktop 共享 Rust 核心消费。Runtime、业务来源和 Acceptance 的后续登记必须与实际实现一致，不能把架构 active 解释为产品 ready。
