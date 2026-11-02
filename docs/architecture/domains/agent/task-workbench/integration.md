# 既有建设的复用、改造与删除

> **Status**: accepted（Owner 2026-11-02 确认；实施承接：TW-20261102）
> **Version**: v2.0
> **Created / Updated**: 2026-11-01
> **Owner**: Peers-Touch Agent Team

每项保留必须说明新链路中的输入、消费者与验证；每项替换同时登记所有调用方、协议、缓存、测试、文档和删除项。下列是当前源码核对后的责任清单，执行前还需补齐运行部署和外部消费者。

## 直接沿用的底座

- **ChatTaskService / TaskEventWriter / ExecutionStep / ExecutorLease / Checkpoint**：继续承担持久执行、事件恢复、租约隔离和回执；工作台增加任务级消费。验证：断连、重启、重复事件和过时租约不重复执行。
- **TurnService / TurnAdmission / ToolDispatch及本机worker**：继续承接准入、队列、审批、工具授权、定向执行与结果验证；同一连续对话内的并发控制收口到task ID，内部宿主thread恢复不形成用户可切换会话。验证：停止/撤权后不准入，其他任务不受误伤。
- **Profile / Skills / MCP / Connector / Knowledge / prompt assembly**：保留规则、绑定目录、真实工具执行和来源组装；Profile返回仍保留原任务，新轮读取新版本。每个binding必须通过实际任务调用和结果消费验证。
- **Capability authority/readiness与Provisioning**：复用manifest/版本、角色binding、目录注册、就绪与撤权。插件包安装/登录/升级/卸载在这些Owner中处理其组件，不新建独立工具注册表；真实Browser沿现有MCP worker执行并回当前任务。
- **Provider / Credential / Dashboard / 模型目录**：保留配置、安装、连接、命名配置和用户分配；工作台不重建供应商管理。验证：配置→授权→选模型→真实回答→撤权→恢复。
- **ExternalRuntime绑定与reset/cleanup**：保留持久session身份、版本检查、恢复不可用和清理失败处理；增加实际设备/host instance/connection epoch/协议身份，完整协议适配替换有损completed item解析。Station保留绑定/路由/事件，实际设备worker持连接。验证：恢复会话、审批/中断、通知缺口与文件/命令真实回读。
- **产物元数据和正文存储**：保留TaskArtifact、Blob、引用URI及事件事务，扩展不可变版本、来源、检查与接受。验证：正文、预览、历史和导出的字节一致。
- **MemoryService及embedding provider接口**：保留CRUD、作用域、来源、快照、冻结/纠错和上下文消费；在原Owner内改进提取、确认、检索和后台整理。验证：第二任务中文改写召回，纠错/删除/撤权后旧项停止消费。
- **AgentWorkbench、AgentRail、TopicRail、ConversationRail、Portal、消息、Composer、Search及缓存**：原位演进为已认可交互，保留组件能力和已有服务边界。单会话命名可以改，但不能留下两个可写的任务/Topic投影。

## 必须成组替换

**R01 任务卡与聊天任务统一。** `AgentTaskService`、`store/tasks.ts`、`TasksPage`、`TaskIndicator`、Home command/projection、API和验收消费者目前存在真实引用。把有意义的任务输入、幂等命令、readiness和结果定位接到TaskRun后，移除手工状态/百分比、旧任务卡接口和重复页面。不能只删UI而让Home继续写旧表。

**R02 成果真源统一。** `extractMessageArtifacts`可解析消息内容，Portal当前依此获取结果；Station已有产物存储。消息卡片、Portal、文件、进度和Search切到权威成果引用后，删除作为正式成果写入源的文本解析路径及重复包装。确有展示用途的代码块渲染继续归消息组件。

**R03 Memory质量与入口收口。** 去掉 `BuildRelevantSnapshot` 检索错误时全量任意快照回退；明确的常驻规则与相关召回分别处理。复用Provider embedding接口替换默认token-hash作为生产语义召回依据，保留确定性实现仅在确有隔离测试消费者的测试范围。候选必须确认，临时指令不能自动升级为长期偏好。角色Memory在Profile管理，个人设置沿全局Settings；移除重复业务页面前先迁其有效操作和链接。

MemoryService仍是唯一跨端记忆Owner，Codex的自有feature、generate/use及Memory工具显式关闭；现有prompt ledger冻结并交给宿主已授权版本，避免双生成/双注入和本机用户目录串读。提取/整理复用现有job/lease接口，借鉴Codex的来源版本、空输出、ownership-token条件提交与选集增量更新；不能复制整个Rust pipeline再与Go同步。索引迁移验证中文改写召回、无关项排除、纠错/删除/撤权和过期worker回写拒绝。

**R04 完整外部协议。** `externalruntime/protocol.go`将command/file/todo等压成completed标题，manager发一次prompt后关闭stdin。声明持续交互的Codex接入替换为实际设备Rust supervisor双向app-server连接、类型化Peers事件和命令/回执账本，Go ExternalRuntime Owner保留绑定/路由/归并；同一宿主不保留旧解析器兜底成功。

Station独占用户队列和持续目标准入，不向Codex queue写待办，关闭自主Goals；新建和恢复前核对有效配置/既有queue/goal。start、steer(expectedTurnId)、批准、interrupt及实际回执分别适配。宿主工具与Peers工具各有一个执行Owner，不能接收到事件后重复执行。fork回读资料与权限，worker退出/连接换代不得复用旧process；输出缺口不能压成completed。

一次性CLI模型调用如仍有独立真实消费者，归Provider模型接口并使用显式有限合同，不承担持久任务/控制能力。没有该消费者时删除其注册与路径。SDK `exec`包装不适合本次双向控制；Rust app-server-client依赖整个core/app-server，不默认嵌入Desktop。复用获验证二进制和匹配schema，窄协议适配器新增仅限集成职责。

**R05 宽窄工作面统一。** 当前ConversationRail仅在非窄屏挂Portal；原型已验证窄屏可打开同一对象。替换限定宽屏的挂载条件和被替换详情结构，阅读选择与编辑草稿持久于既有Owner；保持按需挂载，不同时活着全部面板。

**R06 同步与寻找。** 扩展Agent任务Contributor、页内目标/条件/资料检索与统一opener；删除无人调用的客户端逐Topic扫描。保留已有同步机制，消除无变化刷新触发的全局初始化和无谓选会话，不增加第二套轮询。

**R07 交互与能力状态收口。** 历史/活动尾部、展开/滚动/选区、搜索与独立草稿沿既有Runtime/Store/缓存Owner，后台请求定位不抢焦点。插件安装/选择/账号/readiness分开回读，撤权刷新实际Skills/MCP/hooks；不拿Codex已保存`disabledPluginIds`冒充执行过滤。Browser真实session/page/account/控制租约接MCP worker，预览留Portal，Computer Use独立能力取证。删除相应仅隐藏菜单却未阻断调用、仅模拟成功及无人消费的重复状态路径。

## Codex复用边界

复用官方执行二进制、thread/turn/item、实际命令/文件事件、沙箱、审批、中断和分页历史。协议schema固定稳定/实验版本并配合有界行为验证；Apache-2.0/NOTICE按实际源码/二进制使用和分发保留。商业账号、云端服务及插件不是仓库许可证自动授予的能力。

不搬Codex Task/Goal/Queue/Memory业务Owner、不把thread attachments作为成果库、不把plugin操作标记作为检查，也不推断开源repo包含商业Browser/Office UI。Browser沿成熟MCP/现有worker，reader沿Portal，成果版本和接受沿Station。Terminal按持续进程需要打开；命令、日志、退出码和检查沿任务消费者，资源与查看生命周期分离。

完整方法和故障边界见 [接入合同](./codex-source-review/integration-contract.md)；源码与测试规格见 [源码分析](./codex-source-review/source-analysis.md)。

## 有用能力与无消费者代码

调度、协作、成长/评估、连接器不能因本次未显示一级菜单而一律删除，也不能因“以前做过”而自动保留：

- 有真实输入与结果消费者的实现，接入当前Task/Turn/Artifact、Profile或已有管理Owner，保留对应测试。
- 只剩静态页、注册开关或没人使用的服务/适配，在其调用迁移后删除实现、注册、路由、状态和失效文档。
- 需要未来产品决策的独立能力保留于有Owner、有当前消费者的模块；不存在消费者时不能在生产以隐藏代码“留待以后”。

本轮没有取得这些全部模块的运行证据，执行前必须逐项证明。不能据本提案猜测哪些服务可安全删除。

## 数据与切换

旧用户会话、文件、规则、Memory和授权记录是资产，不是应清空的代码遗产。一次性迁移至目标结构，校验记录数、身份/归属、字节摘要、引用连通性和旧记录回读；冲突、孤立引用、运行中对象先停在可核对状态，不能静默删数据。

迁移逻辑只用于该schema版本升级，不成为日常读写兼容层。已部署客户端和已知服务消费者在切换前核对版本；不支持的旧客户端明确要求升级，不偷偷走旧业务写路径。迁移映射报告供核查，不新增永久ID别名服务。

每个原子切换包含目标合同、全部消费者、数据迁移、旧实现删除、正式文档和验证。回退使用版本/部署控制；数据回退必须遵守写入边界，不能把代码revert当数据库回滚。

切换前备份并完成还原演练；新schema开放写入前可恢复旧备份，开放写入后只能通过有验证的补偿/前向修复或经授权的恢复方案处理，不能丢弃新数据。生产迁移与删除另行授权。
