# Search 目录与职责

> **Status**: active
> **Created**: 2026-10-22
> **Owner**: Search / Client / Station
> Desktop 与 Mobile 共享原生读取协调器；公开及已获取的私密 Social
> 已接入原领域读取端口。源码落地与所选原生证明分开记录，见
> [证据快照](./acceptance-evidence.md)。其他 Station 来源、Ask/Applet 接入
> 仍是后续范围。

## 1. 领域边界

Search domain 负责 contributor admission、query、derived indexing、coverage、ranking 和 read-result contract，覆盖 Peers 域内对象（消息、Social、人员、Agent/知识、域内附件、Applet 贡献对象）与功能导航。检索宇宙封闭（D-19）：不存在公网、OS 文件或外部 connector adapter。原域持续负责正文、权限和写操作。

当前已落地：

```text
model/domain/search/search.proto      查询/结果/ResourceRef 协议源
packages/search-core/src/
  tokenize.rs / query.rs              CJK/拉丁分词、索引文本与 MATCH 表达式
  ranking.rs / cursor.rs              RRF 融合与游标机制
  model.rs / ports.rs                 候选投影、统一 Contributor 与 operation ctx
  contributor.rs                     注册/候选/批量 outcome 协议校验
  cache.rs                           共享读取、内存额度、subscriber 与失效屏障
  runtime.rs                         query/hydrate/resolve 协调与源回复校验
  session.rs                         三来源有界排序/continuation/已发引用关联
  projected.rs / remote.rs            原 owner 投影与远端生成协议的通用适配
  requests.rs                        身份分区/request ID 准入、取消与完成裁决
packages/messaging-core/src/search.rs
                                      原 Messaging 读取端口与共享 Contributor
apps/desktop/src/gen/proto/domain/search/search_pb.ts
                                      生成的 Renderer 协议类型
apps/desktop/src-tauri/src/
  messaging/store.rs                 原 Messaging SQLCipher/FTS5 读写 owner
  messaging/engine.rs                消息检索与会话名称候选适配
  application/search/runtime.rs       Desktop 身份/Store publication guard 与执行调度
  application/search/messaging.rs     共享 Messaging Contributor 的重导出
  application/search/private.rs      原 SecureContent 读端口到共同投影适配
  application/search/social.rs       原 Social public 的受信 Station 读适配
  secure_content/search*.rs          私密派生 FTS、批量原权限复核与目标窗口
  interface/tauri_commands/search.rs  suggest/submit/cancel/resolve/read-state 入口
  interface/http_gateway/mod.rs       拒绝未鉴权的私有 Search 调用
apps/desktop/src/
  services/search.ts                  生成协议到 native IPC 的薄适配
  runtimes/searchRuntime.ts           session 缓存、取消、原 owner 状态核对
  runtimes/searchInvalidations.ts     Host 组合原 Messaging/Social 失效订阅
  runtimes/searchOpeners.ts           source-bound 受信任原对象打开注册
  store/search.ts                     输入/结果/选择/滚动投影
  components/search/                  singleton overlay 与受信任功能目录
  messaging/openResource.ts           原 Messaging 会话/历史/线程定位
apps/mobile/src-tauri/src/
  messaging/adapter/search.rs         原 Store 读权、批量投影、全局/会话 FTS 与索引重建
  messaging/search.rs                 MessagingSearchReader 本机端口
  runtime/search.rs                   OAuth/OS/独立领域 Store 发布边界与原生调度
  runtime/search/social/private.rs    私密投影的共同 Contributor 接线
  runtime/search/social.rs            public Social 原生认证传输
  social/search.rs                   原私密 Social 读端口、批量权限复核
  secure_content/store/search.rs      私密派生 FTS/checkpoint/读屏障
  commands/search.rs                  生成协议 suggest/submit/cancel/resolve/read-state
apps/mobile/src/gen/proto/domain/search/search_pb.ts
                                      生成的 Mobile Renderer 协议类型
apps/mobile/src/
  services/search.ts                  protobuf IPC 薄适配，不接受 Renderer 账号选择
  runtimes/searchRuntime.ts           独立于页面的输入/结果投影、失效与返回核对
  runtimes/searchInvalidations.ts     原领域失效事件到来源 ID 的 Host 接线
  features/search/                    有界呈现状态和受信任 Mobile 设置目录
  pages/SearchPage.tsx                按需挂载全屏详情及 BoundedList 结果
  components/SearchEntry.tsx          Shell 注入既有一级页 header action rail
  features/chat/useChatMessageAnchor.ts
                                      原 Messaging 投影中的 message/thread 定位
  acceptance/searchActions.ts         同协议的类型化查询/解析/取消诊断，不代替 UI
packages/prototypes/mobile/chat/src/
  pages/SearchPage.tsx                同一 Shell 全屏详情的样本表达
  MobileShell.tsx                     四个一级入口、会话范围和返回来源
apps/station/app/subserver/social/
  application/public_read.go          public point/batch 的共同读策略 owner
  application/public_search*.go       原 public 表的检索协议适配
  application/private_read_policy.go  私密当前权限批量读契约
  infrastructure/private_read_policy.go
                                      原私密 Store 的有界权限事务
  search_handler.go / read_policy_handler.go
                                      已鉴权生成协议 HTTP 边界
```

Mobile 旧 `messaging_search_messages` IPC、输入 DTO、注册和服务 wrapper 已删除。
现有 Acceptance `messaging.search` 为原 Chat Gate 保留结果投影合同：先经统一
Search 协议取得命中 ID，再由原 Messaging owner 读取投影。它不持有查询实现、
独立 FTS、缓存或 Renderer 账号选择。新增 `search.*` 诊断保留 native typed
denial，正式 Search 的输入、筛选、打开、返回和结果行仍须通过 UI 证明。

FTS 表形继续由 Messaging 统一持有。两端写入和查询共用 `search-core` 分词。
Mobile 从原消息表重建既有 FTS，每批最多 128 行；原 Store 中的
`messaging_search_index_progress` 保存 token format、rowid checkpoint 与完成状态。
它不迁移正文、密钥或消息恢复 cursor，不保留旧查询路径或第二套索引。
索引未完成时返回 `INDEXING`，不缓存不完整候选页。

`packages/search-core` 已作为 `client.search.portable-core` 登记，消费者包括
Desktop/Mobile Rust 与 Messaging 的共享协议适配器。该 crate 不依赖 Tauri、
Messaging 数据库或网络 SDK。`model.rs` 是端侧候选执行投影，不可替代 proto
成为第二份业务线合同；适配器必须遵循生成类型。

通用请求生命周期与读取协调机制唯一位于共享核心。宿主实现 `SearchExecutor`
和 `SearchBinding`；前者提供原生调度，后者提供已认证的分区、原来源水位、
Contributor 与串行发布裁决。Contributor 构造可读取原 Store，必须在 Store
发布锁之外完成，再在发布锁内重新核对身份和水位并登记。Desktop 原通用
协调器及请求实现已经删除，平台文件只保留 Binding 和调度适配。

`build.rs` 通过 prost 生成 `search.proto` 的 Rust 类型；`model.rs`
重导出生成的枚举与 ResourceRef，仅 scored candidate 属于内部投影。
Native IPC 使用生成 Request/Response 的 protobuf bytes。Submit 以集合条件
选择本机 Messaging、已获取的私密 Social 和当前 Station public Social；
post/comment 独立分页和打开。Suggest 不发网络请求，私密 Social 没有离线读
租约时不产生正文建议；会话优先语义仍属于 Messaging。
cancel 只关闭调用者订阅，最后订阅者退出才中止 operation；同词查询和资源
投影各按语义键复用，身份变化主动失效对应窗口分区。binding session revision
阻止 A→B→A 旧结果发布，原 Store 水位 guard 串行裁决缓存提交与响应发布。
分页绑定原来源快照，后续页保留首次查询到期点。
完整混合结果分页、所有来源 coverage 和锁定 Journey 仍未证明。

Mobile 原生分区由 current native session 的 Station、Actor、device、Session、
认证操作 revision 和 OS generation 推导，独立于 Messaging 实例。Renderer 不选账号。
OAuth 操作标记、OS 前后台事件锁、Messaging active lock 和 Store 水位锁共同
裁决缓存与最终响应发布；后台、身份过期或旧实例均拒绝读取。
会话筛选进入生成协议语义键及签名 cursor，不授予会话读权。
`attachment_names_only` 限定原 FTS 的附件名称列，返回附件所在消息的原地址；
它不创建附件资源或读取附件正文。该条件进入缓存和 continuation 语义键。

Mobile `detail:search` 由 Search runtime descriptor 持有，只挂载当前详情。
Renderer 最多保留一个 100 行结果页和 32 个分页 cursor，不复制 native 检索
执行器或内容缓存。打开消息或真实 Settings 详情后，返回先核对 native
scope/revision/expiry，再恢复结果、筛选、选择、滚动和焦点。原账号变化清空
投影；同账号后台/恢复保留呈现元数据并重新取得合法结果。界面始终说明
尚未取得的历史不在搜索范围，不能从缺省 recovery marker 推导完整历史。

后续实现位置：

- **Station**：public Social source 已在原 Social owner 接入共同读协议。其他
  Station 来源和 Federation 未实施；不新增平行 Search subserver 或调用客户端 Rust core。
- **Mobile 扩展证明**：现有 Android/iOS 模拟器 Journey 已有指定源码证明；实机、OEM、辅助技术与 OS 后台/锁屏仍未证明。
- **Applet / Agent**：沿现有 SDK、Host 和 evidence owner 接入；本期没有 contributor/Ask 实现。

Renderer 不建立第二个 TypeScript 查询执行引擎。取消、cursor 和完整 coverage 的执行闭环需要真实请求生命周期与 conformance，不能用 core 中存在相应类型代替。

Search 业务验收的共享采样脚本唯一位于 `tooling/acceptance/search_capture.py`。
Messaging 与 Social 的 Desktop/Mobile Gate 及源码回放直接消费该模块的绘制等待、
DOM 变更观察、原目标可见性和连续性判据；Gate 不通过另一 Gate 导入或重导出
这些脚本。业务断言、运行拓扑和生命周期仍由各 Journey owner 持有，
domain-neutral Acceptance Core 不包含 Search 选择器或业务采样规则。

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

UI → Client application/coordinator → Search core ports → 领域/域内附件/功能/Station adapters。
当前 Station Social interface → 原 Social application/read owner → 原 domain/repository。
adapter 依赖原 owner 的读取与权限接口，原业务模块不 import Search 内部库。

Search core 不依赖 Messaging store、Tauri、UI、Go subserver 或特定模型。Search 不持有原业务写入与密码；Agent 消费 query/evidence contract，不 import Search 页面；来源也不 import排名/分页/UI状态。依赖关系和禁止调用详见 [design.md](./design.md)。

## 4. 单一真源约束

来源/结果类型由 Model 或已登记 schema 生成；SDK、native、Station 不各自复制手写模型。UI 的展示 model 是明确的投影，不能重新定义权限与 canonical ID。

旧 SearchPage、来源/AI store、四个成功空 native stub、双份旧 DTO 与 ToolsTab 搜索商配置链已经物理删除。`searchRuntime` 名称保留给唯一 session owner，其旧 app-scope 实现已替换。Settings 帮助使用受信任静态目录。Station Launcher mock 属 Station 后续范围，不得作为本机搜索 fallback。

Search 架构及共享核心在原 registry 登记。当前 Runtime、UI alive policy 和正式 Acceptance 的未实施范围保持显式；架构登记不授予已删除路径或尚未实施 adapter 权限。

当前 Station 来源直接复用原 Social application 的 query/read adapter，
不创建平行 Search subserver，也不为 source catalog、ranking、indexing、
AI answer 各自创建微服务。正文保持原 owner 存储，索引引擎属于 infrastructure
port；独立进程仅在已接受的真实部署需要时出现。
