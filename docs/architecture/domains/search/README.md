# Search 门户能力

> **Status**: active
> **Created**: 2026-10-22
> **Owner**: Search / Client / Station
> **Review state**: 封闭域与 Desktop「找回 + 打开」方向已确认；D01–D02 已落地，D03 为限定 native 实现，生产覆盖层及 D04–D06 尚未完成。

## 范围

Search 的目标是按需唤起的统一搜索入口，**检索宇宙封闭在 Peers-Touch 域内**：端上私密对象、Station 业务对象以及联邦授权上下文中可见的对端对象，并只返回当前 actor 当前有权限读取的内容；另含域内功能直达。公网搜索、Peers 之外的 OS 文件/目录、外部 connector 不属于检索域（决策 D-19）。本期只实施 Desktop 本机消息「找回 + 打开」；Station、联邦、Mobile 与 Ask 后置。Chat 默认落点和 singleton Search overlay 是已确认的目标，当前生产导航仍待 D04/D04B 替换。

它拥有检索产品与派生索引合同，不拥有 Chat、Social、Agent、Note、Applet 或附件存储的业务真源和写操作。门户、建议快捷搜索和模块内检索共享查询、内容类型、权限与打开语义。各模块是否可搜、哪些字段可搜、内容属于 D/S/F 哪个信任区、撤权/删除如何生效，必须通过内容接入协议声明。

## 阅读顺序

1. [现状、历史与行业参照](../../../research/search-current-state-and-benchmarks.md)：指定源码快照、历史资产、可复用能力与证据缺口。
2. [产品合同](./product.md)：用户任务、入口、结果、恢复、覆盖、权限与问答。
3. [技术设计](./design.md)：Owner、运行拓扑、查询聚合、索引、授权与生命周期。
4. [数据与接入协议](./data-model.md)：来源声明、对象身份、查询/结果、增量与游标。
5. [扩展与接入](./extensions.md)：域内来源/SDK、索引后端、附件格式、功能、展示和 Agent/MCP 的独立扩展点（不含域外来源）。
6. [目录与职责](./module-layout.md)：已落地路径、模块边界与后续实现范围。
7. [集成与验证](./integration.md)：现有模块映射、切换约束与待执行的证据要求。
8. [关键决策](./decisions.md)：推荐、理由、代价及仍需实测的选择。
9. [可行性研究](./feasibility.md)与[实验记录](./feasibility-evidence.md)：真实加密 FTS、PG、
   受控文件边界、协调器及模型实验，包含中文跨语言召回反例；其中公网 RSS/OS 目录实验仅作历史机制证据。
10. [目标架构图](./architecture-diagram.md)：D/S/F 信任区、两级执行、四级权限链与否定边界。
11. [原型（confirmed）](./prototype/README.md)：唯一 Desktop Shell 内的封闭域 Search 覆盖层，Owner 已于 2026-10-22 用户层确认。
12. [执行计划：Desktop 端侧「找回 + 打开」](./execution-plans/20261022-device-search-find-open/plan.md)（SRCH-20261022，实现中；Station S/F 区、联邦、Mobile、Ask 属后续计划）。

## 当前设计位置

现状研究已完成到源码/历史/官方文档层，独立组件可行性研究已完成。300 份真实文档的 SQLCipher/FTS5 查询 P95 为 2.883 ms，默认中文短词遗漏已复现；分词后的八个关键词探针均找到前十预期对象。PG、文件边界、删除/撤权和协调器机制得到有限实验支撑。

AI 模型执行可行，但当前 E5 中文问题检索英文/混合文档前五仅 2/6，简单融合为 1/6；同意图英文诊断为 6/6。模型、双语分析器与排序尚未选定。这些是组件实验，不能证明生产 Search 性能、正式 Acceptance 或后续语义检索能力；V-01～V-09 的完整目标仍 UNPROVEN。

已确认的边界是一份协议、两级执行、三个信任区（D/S/F）、四级权限执行链、一个客户端查询核心。原业务域继续拥有正文、权限和写操作；Search 只拥有派生检索投影。Desktop Shell 原型已于 2026-10-22 确认。

当前源码已有 `model/domain/search/search.proto`、`packages/search-core`、Desktop CJK 分词直写 FTS 与跨会话查询，以及 `search_suggest/search_submit/search_cancel` native 命令。共享 FTS 表形未改，无搜索 generation/meta 表、迁移钩子或兼容索引。原有数据不会在启动时自动重分词；新写入与业务恢复投影直接使用新分词。

D04/D04B 生产覆盖层与旧页面/命令删除、D04C 全局 ResourceRef 打开、D05 功能目录、D06 ToolsTab 搜索商链清理尚未完成。现有会话内搜索可复用新的分词查询；其截图不证明全局覆盖层已交付。端侧执行 DTO、请求取消及 coverage 仍须与 proto 和生命周期合同逐项核对，不以目录存在证明合同全部闭环。

当前 native 命令使用生成的 protobuf bytes；Submit 只接受 DEVICE/FIND/MESSAGE，
支持消息 keyset 分页，其他 scope、intent 和 kind 明确拒绝。Suggest 支持消息、
会话与 RRF 建议；取消按窗口/账号/request ID 管理，session revision 与 Engine
身份校验阻止失效结果发布。未鉴权 HTTP gateway 拒绝私有 Search。
完整混合检索与 coverage 生命周期仍是 D03 的未完成范围。

## 相关真源

- [架构文档入口](../../README.md)
- [Chat 消息检索专题](../chat/message-search.md)：需由 Chat Owner 更新过时段落。
- [Desktop Runtime projections](../../../client/desktop/runtime-projections.md)
- [Client UI Identity](../../../client/common/ui-identity/README.md)
- [Applet Runtime](../../platform/applet-runtime/README.md)
- [API Governance](../../engineering/api-governance/README.md)

Search 架构在 [模块治理表](../../engineering/architecture-governance/architecture-modules.json) 登记；`client.search.portable-core` 只声明 Desktop 共享 Rust 核心消费。Runtime、业务来源和 Acceptance 的后续登记必须与实际实现一致，不能把架构 active 解释为产品 ready。
