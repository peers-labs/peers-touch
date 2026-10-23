# Search 目录与职责

> **Status**: active
> **Created**: 2026-10-22
> **Owner**: Search / Client / Station
> Desktop D01–D02 已落地，D03 有限定能力的 native 实现；其余目录仅表示后续 owner，不表示实现或验收完成。

## 1. 领域边界

Search domain 负责 contributor admission、query、derived indexing、coverage、ranking 和 read-result contract，覆盖 Peers 域内对象（消息、Social、人员、Agent/知识、域内附件、Applet 贡献对象）与功能导航。检索宇宙封闭（D-19）：不存在公网、OS 文件或外部 connector adapter。原域持续负责正文、权限和写操作。

当前已落地：

```text
model/domain/search/search.proto      查询/结果/ResourceRef 协议源
packages/search-core/src/
  tokenize.rs / query.rs              CJK/拉丁分词、索引文本与 MATCH 表达式
  ranking.rs / cursor.rs              RRF 融合与游标机制
  model.rs / ports.rs                 候选投影、查询 port 与 CancelToken
apps/desktop/src/gen/proto/domain/search/search_pb.ts
                                      生成的 Renderer 协议类型
apps/desktop/src-tauri/src/
  messaging/store.rs                 原 Messaging SQLCipher/FTS5 读写 owner
  messaging/engine.rs                消息检索与会话名称候选适配
  application/search/mod.rs           本机查询聚合
  interface/tauri_commands/search.rs  suggest/submit/cancel native 入口
  application/search/requests.rs      window/account/request ID 取消生命周期
  interface/http_gateway/mod.rs       拒绝未鉴权的私有 Search 调用
```

FTS 表形继续由 Messaging 统一持有。Desktop 的写入和查询共用 `search-core` 分词；无搜索 schema generation、版本元数据或启动迁移。Mobile 不消费 `search-core`，其既有写入/查询保持原行为。

`packages/search-core` 已作为 `client.search.portable-core` 登记，当前消费者仅 Desktop Rust。该 crate 不依赖 Tauri、Messaging 数据库或网络 SDK。`model.rs` 是端侧候选执行投影，不可替代 proto 成为第二份业务线合同；适配器必须遵循生成类型。

`build.rs` 通过 prost 生成 `search.proto` 的 Rust 类型；`model.rs`
重导出生成的枚举与 ResourceRef，仅 scored candidate 属于内部投影。
Native IPC 使用生成 Request/Response 的 protobuf bytes。Submit 当前仅支持
DEVICE/FIND/MESSAGE 和按时间、消息 ID、会话 ID 的 keyset 分页；其他控件
明确失败。Suggest 支持会话、消息和两者的 RRF 建议。取消由账号和窗口限定，
每次 binding 变更递增的 session revision 阻止 A→B→A 旧结果发布。
完整混合结果分页、所有来源 coverage 和锁定 Journey 仍未证明，D03 保持 PARTIAL。

后续实现位置：

- **Shell / Renderer**：D04 singleton overlay 与有界查询投影；D04B 删除 `SearchPage`、旧 `searchRuntime` 和搜索商 store/命令；D04C 由 Shell Resource Resolver 打开消息 anchor。
- **功能目录**：D05 接真实模块 action/eligibility；D06 物理删除 ToolsTab 搜索商配置链。
- **Station**：一个 Search application/subserver 执行 S/F 区协议并适配原领域读权。尚未建立，不通过 RPC 调用客户端 Rust core。
- **Mobile**：未来 native adapter 消费共享核心，UI 仅维护输入/选中/滚动投影；当前没有 Search 核心消费或新 UI。
- **Applet / Agent**：沿现有 SDK、Host 和 evidence owner 接入；本期没有 contributor/Ask 实现。

Renderer 不建立第二个 TypeScript 查询执行引擎。取消、cursor 和完整 coverage 的执行闭环需要真实请求生命周期与 conformance，不能用 core 中存在相应类型代替。

## 2. 原模块继续拥有的职责

- **Messaging**：会话、消息投影、SQLCipher/FTS5、编辑撤回/隐藏、恢复进度、message/thread anchor。
- **Social / Secure Content**：公开/私密帖、评论、受众、治理、私密读取与索引处理允许范围。
- **Identity / Federation**：人员 identity、catalog、精确 handle resolve、成员/目录访问；Search 不新增另一套 resolver。
- **Agent**：会话/topic、消息/知识/产物 ownership、模型与回答生成；Search 不代管 provider。
- **Note / Attachment**：域内正文与附件提取、版本、读取权限和原对象定位；附件随父对象授权。
- **Applet Host / SDK**：安装实例、能力许可、bridge、service/task binding 与卸载；Search 不执行任意插件代码，也不经 Applet 引入域外来源。
- **Shell**：Chat 默认落点、Search 全局按钮/快捷键、singleton overlay、返回路径、navigation/Resource Resolver 与受信任功能 catalog。
- **Search**：上述来源的规范接入与检索聚合、派生投影、coverage 与 query lifecycle。

## 3. 组件依赖方向

UI → Client application/coordinator → Search core ports → 领域/域内附件/功能/Station adapters。Station interface → Search application → domain/index/Federation adapters。adapter 依赖原 owner 的读取与权限接口，原业务模块不 import Search 内部库。

Search core 不依赖 Messaging store、Tauri、UI、Go subserver 或特定模型。Search 不持有原业务写入与密码；Agent 消费 query/evidence contract，不 import Search 页面；来源也不 import排名/分页/UI状态。依赖关系和禁止调用详见 [design.md](./design.md)。

## 4. 单一真源约束

来源/结果类型由 Model 或已登记 schema 生成；SDK、native、Station 不各自复制手写模型。UI 的展示 model 是明确的投影，不能重新定义权限与 canonical ID。

旧 `application/search` 成功空 stub 和旧搜索页面仍是 D04B 的待删除范围，与新命令无适配关系。D04B 按 [integration.md](./integration.md) 同批删除旧 TS 消费者和 native 命令；D06 删除搜索商配置。Station Launcher mock 属 Station 后续范围，不得作为本机搜索 fallback。

Search 架构及共享核心在原 registry 登记。当前 Runtime、UI alive policy 和正式 Acceptance 的未实施范围保持显式；架构登记不授予已删除路径或尚未实施 adapter 权限。

Search application 保持 Station 内的一个领域模块，不为 source catalog、ranking、indexing、AI answer 各自创建微服务。已有 query adapter 直接复用，不先把所有正文集中复制。索引引擎是 infrastructure port，独立进程只在成熟引擎的真实部署需要时出现。
