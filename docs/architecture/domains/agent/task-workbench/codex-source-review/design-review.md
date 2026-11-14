# 用 Codex 源码复审 Peers 工作台设计

审阅结论：**TaskRun / Conversation / Turn、Station 成果真源和原位演进方向成立；实际接入必须满足以下边界，才是可实施合同。** 当前结论是设计审阅，不是生产 readiness 或运行证明。

## 必须满足的约束

**F01 单一执行准入。** Codex 的 queue 和 active goal 均可能自动发轮。Station 持有任务级活动执行权、用户队列、持续推进与预算；适配器禁用宿主自主 Goals，不向宿主队列写待办。冷恢复先核对 queue/goal，再允许 Station 发新输入。否则 Stop、撤权和续跑不是闭环。[依据 S03/S04](./source-analysis.md#s03-codex-已有持久队列不能再叠一层自动调度)。

**F02 真实宿主连接。** Rust worker 持有 app-server 连接和实例，React 切页不关闭它。host instance/connection epoch 必须进入绑定与回执；宿主断开后的进程与未确认副作用均先核对。不能把持久 session ID 推导成进程永远存活。[依据 S07](./source-analysis.md#s07-连接生命周期与进程生命周期相关)。

**F03 输入有明确目的和前置条件。** 普通开始只在 Station 与宿主均无冲突活动轮时允许；补充走 steer 并绑定 expectedTurnId；排队留 Station。宿主返回的 turn ID 与映射不符时暂停准入，不能自动合并。补充是不可变上下文追加，不覆盖初始快照。[依据 S02](./source-analysis.md#s02-发送执行中补充队列是不同操作)。

**F04 Stop 不吞回执。** 暂停后续队列、核对活动 turn、中断、处理终态、清理或保留资源。收到 TurnAborted/终态与相关工具处理结果之前不显示已停止。超时进入待核对，禁止盲重试有副作用输入。[依据 S05](./source-analysis.md#s05-stop-有提交和实际中断两个时刻)。

**F05 批准不扩权。** 批准使用现有 Station request 与 actor/设备/授权版本，宿主 pending request 与其一一对应。一次许可不升级 acceptForSession 或永久策略。拒绝与取消分别映射；旧 epoch、旧 actor、已处理请求返回冲突。[依据 S06](./source-analysis.md#s06-批准是有身份和作用域的请求)。

**F06 Memory 单一生成与消费。** Peers Memory 保留跨端数据、Profile 作用域和纠错；Codex 自有读写及 Memory 工具关闭，宿主只接已确认快照或经 Peers 工具读取获授权详情。后台提取/整理借鉴有界 claim、来源版本、空输出、租约 fencing、增量选集；不搬一套用户目录 Memory 和 Go Memory 双向同步。[依据 S11/S12](./source-analysis.md#s11-memory-写入是有界版本化的后台工作)。

**F07 派生重新核对资源和权限。** 选定终态历史截点、资料版本、成果引用；新的 TaskRun/Conversation 不继承队列、活动轮、接受或写授权。宿主 fork 默认当前附件和继承权限均不满足此合同，需覆写并回读验证；复制不完整时派生不可执行。[依据 S09/S10](./source-analysis.md#s09-附件是当前关联不是不可变成果库)。

**F08 明确三类“结果”。** 宿主 Item 是执行事实；附件是当前关联；成果是已回读字节的不可变版本。三者不能用 artifact 名字合并。command exit 0、插件 create 标记、Turn completed 都不能自动产生检查通过、成果接受或任务完成。[依据 S01/S14](./source-analysis.md#s01-执行状态与产品完成分层)。

**F09 恢复承認缺口。** Station Event cursor 只覆盖已经入库的 Peers 事件。宿主断连靠历史分页回读收敛 terminal Item，缺失 delta 或无法验证命令不补造成功。适配器的命令账本先记录意图，再发送和记回执；传输不确定时停在 unknown，跨库无法原子提交的副作用不宣称 exactly-once。[依据 S08](./source-analysis.md#s08-历史回读和实时事件分别处理)。

**F10 源码、schema、二进制同版本。** 固定协议 schema、实验项白名单、宿主 binary 版本/摘要和行为集。握手通过不等于能力全开；不支持必需方法时拒绝这一配置。TS exec SDK 和重依赖 Rust facade 都不作为持续控制的兜底成功路径。[依据 S14](./source-analysis.md#s14-能复用执行和协议不能推导出商业-ui服务可复制)。

**F11 工具路径只执行一次。** 宿主原生命令/文件工具由宿主执行并遵循有效沙箱，Peers 只做准入、批准和回执消费；Peers 的 Memory/知识库/连接器等经动态工具请求回 ToolDispatch。不能收到宿主命令通知后再调用本机 shell 执行同一命令。对外部浏览器选择一种受控工具实现，避免两边持有同一个账号操作权。[依据 S06/S13/S14](./source-analysis.md#s13-profileskills-消费需要来源和权限)。

**F12 交互状态有独立生命周期。** 历史与流式活动分开投影；展开、滚动锚点、选区、搜索和草稿按对象保存。后台任务/批准不得抢当前任务焦点，分页不能破坏活动分组。原型布局保留，生产全生命周期需实测。[完整UI/任务对照](./capability-review.md#c01-uiux工作过程阅读与输入同时成立)。

**F13 插件选择不能冒充有效权限。** `disabledPluginIds`在本提交只保存选择，未过滤能力；installed/空appsNeedingAuth也不能证明就绪。实际component目录、账号、binding/readiness、MCP/hooks和配置回读须一起验证，撤权阻断执行。[插件对照](./capability-review.md#c05-插件安装启用登录角色绑定和实际可调用分别回读)。

**F14 Browser不是预览标签。** HTML成果预览、真实网页操作与Computer Use分别定义执行/账号/设备/页面/控制租约及回读；政策传输须有实际控制组件阻断证明。人工接管和归还不能同时拥有两份操作权。[浏览器对照](./capability-review.md#c04-浏览器与computer-use预览实际网页操作和系统操作分别有合同)。

## 可复用的既有建设

保留 TaskRun/ExecutionStep/Event/Lease/Checkpoint、TurnAdmission/ToolDispatch、外部会话绑定、Native 资源与回执 worker、Dashboard 配置授权、Profile/Skills、MemoryService、Artifact/Blob、工作台/Portal/Search/缓存。源码范围和读取时摘要在 [Peers 证据](../source-evidence.json)。

每项建设必须进入实际链路：Profile/Memory 影响下一轮输入；能力带来真实结果；Artifact 被预览/反馈/检查/导出消费；TaskRun 支撑旧工作回读及新任务控制。Terminal 作为持续进程的按需查看，命令事实在任务执行记录和检查结果中消费；关闭查看不终止执行。

## 可复用的 Codex 与需要自有的部分

直接复用执行二进制、thread/turn/item 协议、沙箱执行、批准、中断、分页历史和真实命令/文件结果。代码机制借鉴用于 Peers Memory 的租约、版本、选集和预算；源 schema 用于窄适配器协议校验。

Peers 自有任务完成、跨端权威队列/Memory、成果版本和接受、资料权限、设备资源授权，以及已确认工作台交互。Browser 组件与 Office reader 分别选已有可集成实现；没有源码或现场证据的商业能力不纳入“已经可复用”。

## 对落地顺序的要求

完整协议与所有权验证必须成为前置技术链，不能到完成UI、Memory后才检验Codex能否被持续控制。先证明thread恢复、steer、审批、interrupt、通知缺口、真实文件和能力目录；工作台交互与成果消费者一起落地，再用同一Task/Artifact/Capability链贯通Browser及插件安装/配置/调用/停用。

数据迁移、重复任务/消息成果/有损适配删除跟各消费切换同时实施；不能暂留两套可写业务真源。最终集成验证包括直接执行与宿主执行，不因优先接 Codex 而抛弃已有通用模型循环。

## 仍待实施阶段取证

当前可安装二进制与本提交 schema 的关系；目标 OS 沙箱有效性；Dashboard 登录/命名配置到实际设备宿主的授权路径；旧外部 thread 的队列/目标/隐含规则；大历史与低速落库的内存上限；已部署旧消费者、旧数据关系和备份恢复；真实中文 Memory 的质量样本。

这些条件分别阻断对应准入、迁移或交付声明。源码对照能排除错误设计，不能代替真实模型、Native 操作和用户任务验证。
