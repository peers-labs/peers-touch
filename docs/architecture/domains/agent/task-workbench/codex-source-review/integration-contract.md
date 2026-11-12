# Codex 接入 Peers 的具体合同

状态：proposal。协议名来自研究提交，Peers 命令及新增字段是拟实施语义，不能当作已有 API。

## Owner 与进程部署

Station 的 ChatTaskService/TurnAdmission 持 TaskRun、目标修订、活动执行权、用户队列、审批和完成判定。ExternalRuntimeService 持 Conversation 到宿主会话的耐久绑定与恢复状态，现有 Go externalruntime 层负责路由及归并，不对本机页面自行 spawn 进程。

实际设备的 Rust `desktop_executor_worker` 扩展宿主 supervisor：启动获验证 `codex app-server` 二进制、保持 stdio 双向连接、关联 RPC、持本机事件/命令回执缓存、处理账号 teardown 和资源清理。它沿现有租约、resource registry 和 ToolDispatch，不能成为第二个 Task Owner。服务端宿主若启用也走同一执行设备合同，其真实机器不冒充用户 Desktop。

React Runtime 订阅 Station 任务事件，已有 store 呈现任务/轮/成果；Page 不持 app-server 子进程，切页不重建宿主。Desktop 全进程退出后，记录宿主中断/待核对；跨应用退出保持执行需要另外具备已验证的常驻执行设备，本提案不假定存在。

按 actor、执行设备、授权配置隔离 host home，另按 TaskRun 注册工作根和写租约。不得共用当前 shell 用户的 `.codex` 或静默读取其他账号、Memory、MCP、Skills。Dashboard 持配置、安装目录、登录与分配 Owner；worker 回报本机二进制和登录就绪，引用已授权配置。服务器 CLI 已安装不等于用户机器已安装。

## 固定版本与握手

保存 `binaryVersion / binaryDigest / schemaDigest / adapterVersion / requiredMethods / enabledExperimentalFields`。研究 SHA 只作为候选契约来源，运行 binary 须单独证明对应实现。

initialize 声明实际 client/version；需要 humanCommand 时同时声明 `experimentalApi=true` 与 `requiredHumanApproval=true`。只打开必需实验字段；`initialized` 完成后再发业务命令。握手没有完整能力列表，方法和有效配置以匹配 schema 与有界行为验证为准。

配置基线要求：Codex Memory feature 及 generate/use/dedicated tools 关闭；自主 Goals 关闭；Peers 不使用宿主 queue 写接口；未授权 MCP/plugin/tool 不载入。读取有效权限/模型/账号配置核对命名配置、写根与网络边界。不能以 prompt 写“禁止”代替沙箱和有效配置。目标配置不支持这些约束时不准入。

插件组件按真实授权集过滤；本提交`disabledPluginIds`只保存选择，不作为执行撤权。不能有效隔离不同角色工具目录的线程不得共用一个扩大能力集的宿主配置，沿已有host配置/资源隔离，不用前端隐藏代替执行边界。installed或空appsNeedingAuth不能证明MCP/Apps运行就绪。

研究提交对应的候选配置如下；在隔离host home中生成并读取有效值，不能只看此文件的期望值：

```toml
[features]
goals = false
memories = false

[memories]
generate_memories = false
use_memories = false
dedicated_tools = false
dual_write = false
```

键来自 [Feature声明](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/features/src/lib.rs#L1398-L1404) 与 [Memory配置](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/config/src/types.rs#L322-L343)。实际binary不匹配或策略覆盖时拒绝配置，不能认为配置文本足以证明隔离。

## 会话与轮身份

Conversation 持 `hostKind / hostInstanceId / hostThreadId / executionDeviceId / configRevision / schemaDigest`。一次连接有 `connectionEpoch`；Turn/Step 持 `hostTurnId / rootTurnId / executionAttemptId / leaseEpoch`。Item 保存 `hostItemId`，Process 保存 `(hostInstanceId, connectionEpoch, processId)`。

Station 命令有 `commandId / inputDigest / taskId / conversationId / expectedRevision`。本机持意图、发送状态、RPC request ID、宿主回执及入库状态；同命令 ID 不同摘要拒绝，旧 lease/epoch 回执不能推进当前执行。

RPC request ID 是传输关联，不能代替 Peers 幂等 ID 或业务版本。`clientUserMessageId` 可做对应输入定位，不假定它提供所有副作用 exactly-once。

## 命令与事件消费

1. **打开任务**：先读 Station 投影；已有 host thread 用 `thread/read` 读取元信息，需执行时 `thread/resume(excludeTurns=true)`。历史用 turns/items 分页，不强制每次完整回传。
2. **首次执行**：Station 准入并冻结上下文，worker `thread/start` 建会话并核对配置，随后 `turn/start`。会话创建与第一轮发送分别登记不确定状态，不能超时后无条件再创建。
3. **续轮**：Station task/资源写租约就绪、host 无冲突活动轮时才 start。如果返回当前已有 host turn，与准入的预期不符，则暂停新准入并核对，不将它冒记成新轮。
4. **执行中补充**：`turn/steer(expectedTurnId)`；输入追加到指定 Turn 的 amendment 序列，保存资料/反馈版本与接收回执。目标、Profile 或 Memory 修改默认影响下一轮，不能静默改已经冻结的规则。
5. **排队、移动、删除待办**：只更新 Station task queue，带 revision 前置条件；活动轮终态后由 Station 重新检查当前权限和资料准入下一项。
6. **批准与澄清**：`item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、用户输入/elicitation 请求映射到现有 Station pending request。回传同一宿主请求的有效一次决策或回答。MCP verification 若有绑定连接/账号的特殊所有权，按专门合同处理，不一般化为任意跨端可答。
7. **停止**：Station 先暂停后续队列；worker `turn/interrupt(threadId, turnId)`，记录请求中，等实际终态；仍存活的任务相关命令另按资源合同处理。断连/超时先核对，不宣称取消撤销文件或外部写入。
8. **实际工具**：宿主原生 command/file tools 的批准与 Item 进入 Peers；Peers Memory/知识/连接器工具用 `item/tool/call` 回现有 ToolDispatch，返回类型化结果。同一调用只有一个执行 Owner。
9. **事件**：thread/status、turn started/completed、item started/completed、输出 delta、plan updated、文件 patch、错误、pending request 转为现有 TaskEventWriter 的类型化事件。保留实际退出码、失败、patch 和引用；安全显示不压平语义。
10. **成果**：文件变更/模型输出只登记待回读结果，worker 在授权根读取实际字节及摘要；Station 事务写不可变版本/Blob/来源并发布成果事件。Portal、消息、Search、导出都引用该版本。HTML 预览隔离运行环境，不继承宿主账号或本机执行权。

## 工作台交互、Browser和插件的消费者

工作台以task/conversation/resource/version/anchor定位对象；已完成历史和活动尾部分开投影，分组不跨轮。分页、stream、后台批准不清空手动展开/选区/草稿或抢当前焦点；当前用户滚动离开末尾时暂停自动跟随。既有Runtime持订阅/数据，Store持投影/本机交互状态，Page只呈现；原位搜索保留查询、明确历史失败和retry，不重建整个列表。

Browser候选优先采用成熟Playwright MCP，经现有Native MCP worker/ToolDispatch对实际页面执行；包/设备兼容性仍需验证。BrowserSession记录task/设备/账号引用/页面/控制租约/有效政策，读取/选区/操作/上传下载回TaskEvent与资源引用；人工接管暂停Agent，归还重新观察。HTML成果预览继续归Portal，Computer Use单独绑定实际设备能力，不互相代替。

插件包复用现有Skill/MCP/Connector/Hook等Owner与能力manifest；Provisioning流程扩展发现/详情、安装、账号连接、角色binding、有效目录回读和升级/停用/卸载。组件实际可调用性由Capability authority/readiness核对，安装目录或角色选择仅为状态输入。当前任务缺能力可跳到对应Profile/已有全局配置并带return target，配置结束返回原task/draft；真实调用和结果消费后才能声明该能力闭环。

现有Codex插件install会触发运行配置刷新和OAuth，因此此类操作属于受授权的Provisioning，不在普通task首次读目录时偷偷安装/登录。对已使用组件升级或撤权，记录binding/版本变化，处理旧请求并刷新Skills/MCP/hooks；不复制第二工具注册表。完整源码对照见 [能力复审](./capability-review.md)。

源码方法/事件入口：[common.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/common.rs#L503-L681)、[控制与工作项](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/common.rs#L1855-L1889)、[事件](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/common.rs#L2022-L2071)。

## 可恢复事件与资源

宿主 stdout 由 supervisor 独立消费；控制请求和输出写入分开排程。复用既有本机回执缓存，增加每任务字节上限、磁盘上限和保留期限，提交 Station 后可回收。日志对敏感字段做展示脱敏；不在通用日志保存 prompt/凭据/本机全路径。

大输出使用 blob/chunk 引用；流式 chunk 有本机序号和 byte offset，网络重传按既有事件 ID/接收 offset 去重。缓存满、磁盘不可写或落库无法推进时暂停新准入，保留错误并核对活动执行；不能无界堆内存或静默丢输出再显示成功。控制通道不可因读者不消费 delta 而饿死。

页面与 Station 断连：worker 若仍健康保持已有连接，已获授权活动轮可继续执行；新批准需要有效授权，缓存有界。撤权/租约到期按设备合同停止，不能将不可达视为永久授权。

worker 或 app-server 断连：connection epoch 作废，process 投影变为待核对/已终止；新宿主按 host thread 回读历史状态。宿主历史缺失或已删除时保留 Station 历史，并明确无法继续此绑定；不得自动另开线程冒称恢复原任务。

入库后的 Peers cursor 用于跨端恢复；未入库 gap 用宿主历史和文件读取核对。只有收到的输出才能形成完整命令日志；streamed output 不保证最终 response 再包含全文。无法恢复的缺口显式保存。对发送后没有回执的命令不自动重发。

## 上下文与 Memory

沿 `PromptAssemblyService` 生成一个有来源/版本/摘要的冻结 manifest：目标条件、资料版本、Profile 规则、已确认 Memory、Skills/能力及有效权限。宿主 start/resume 的 developer instructions 承载同一已授权规则；用户资料以明确引用与读取工具消费，不能把不可信正文升级为系统规则。

按有界目录和分层读取交 Skills/Knowledge；工具详情只在实际授权时读取。初始 instruction_sources 与宿主实际加载来源登记到执行 provenance；隐含全局规则或未知 MCP 使配置核对失败。继续已有 thread 时必须证明最新 manifest 被接收，不能只保存 Peers hash 就声称模型采用。

Codex Memory 关闭并不意味着丢弃既有记忆：已确认 Memory 仍来自 Peers，并在通用模型及 Codex 两条路径采用相同作用域和质量合同。需要详情时通过受控 Peers Memory read 工具；写入产生候选，按当前用户规则确认后入正式记忆。

后台 job 在现有 Memory Owner 扩展：claim key 含 actor/作用域/来源修订/提取器版本；租约 token 对提交做条件检查，过时 worker 不能写回；无输出不当失败；整理只对已确认选集运行，选集摘要及 schema 不变且输出有效才跳过。删除/纠错/撤权使后续快照立即失效，并清理相应设备快照。此前已发模型的数据无法追回，不伪称撤回。

## Fork 与成果验收

派生由 Station 建新任务和来源边界记录，用户选择的资料/成果按精确版本继承。若用 host fork，传明确终态截点与权限覆写，返回后检查实际附件与配置；当前附件与选集不符先纠正、回读，未核对完禁止首轮。另准备授权资源根，不能认为 cwd 或历史复制自动隔离了写入。

检查记录必须带成果字节摘要、输入/条件修订、执行环境、方法及结果；人工接受独立绑定版本。宿主 plan 是执行计划观察；`review/start` 是模型审查调用；它们都不替代检查、人工接受及 Task Owner 完成判定。

Terminal 按持续进程需要打开。命令日志、退出码和检查在原任务中消费；交互式进程按 connection-scoped write/resize/terminate 与资源清理验证，关闭查看不结束进程。实际连接断开后不复用旧句柄。
