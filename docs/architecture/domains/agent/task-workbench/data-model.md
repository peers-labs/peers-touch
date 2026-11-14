# 任务、会话和成果合同

> **Status**: accepted（Owner 2026-11-02 确认；实施承接：TW-20261102）
> **Version**: v2.0
> **Created / Updated**: 2026-11-01
> **Owner**: Peers-Touch Agent Team

以下为拟修改的共享语义，不是已有字段声明。跨端字段与枚举先修改Model并生成Go/Rust/TS，不手工创建另一份业务类型。

## 任务关系

`TaskRun 1 ↔ 0..1 个用户可见的 canonical Conversation 1 → N Turn`；任务草稿可先于Conversation存在，首次发送时在同一事务建立二者。`ExecutionStep` 归 TaskRun 并绑定实际 Turn；外部宿主 thread/session 只是运行时绑定，不作为用户可见 Conversation，也不进入任务会话层级。资源授权归任务/设备能力链。

现有 ChatTaskService 已以 `conversation_id` 唯一寻找 surface=CHAT 的 TaskRun。目标不是改成“一任务多用户会话”，而是把该关系提升为显式 canonical task/conversation 合同：Conversation 保存 `task_id` 唯一归属，TaskRun 保存 canonical conversation 引用；已有 Conversation、消息、Turn 和 TaskRun 身份尽可能保持。宿主 fork/subagent 可产生内部运行记录，但不能在任务导航下生成第二个用户会话。

TaskRun增加明确的目标/接收条件修订、用户标签、当前资料引用及默认角色。任务运行状态、会话状态、Turn状态分别定义；不继续使用手工百分比表示真实执行，也不因TaskRun曾服务协作就强迫单Agent加载协作DAG。

TaskRun生命周期区分草稿/可执行/执行中/暂停/待核对/已完成/已取消/失败；等待批准、等待回答、排队是独立执行/请求投影，不能因为一个Conversation空闲推断Task完成。Turn保留进行中/完成/中断/失败，控制请求另有已申请/已确认/超时或待核对状态。准确枚举在Model合同确认时生成。

任务活动根执行权以task ID、lease epoch和实际资源写租约约束；用户QueueItem只在Station保存，绑定conversation、输入修订、资料、顺序和revision。宿主queue和goal不作为第二真源，宿主plan只保存观察。

原AgentTask中有意义的目标、标题、备注和子项进入TaskRun及任务条件。绑定相同conversation的卡片与运行任务按实际关系合并；冲突不由标题相似性猜测。没有conversation的卡片可转为未执行任务，打开后再创建会话。历史人工“完成”保留为历史动作，不转换成已验证的当前接受。

## 输入与上下文

当前资料集合保存来源ID、版本、授权范围、内容摘要及采用标记，正文沿对象存储读取。Turn冻结目标修订、来源版本、Profile规则版本、已确认Memory版本和能力快照；上下文manifest另保存宿主接收与实际instruction来源。运行中补充以`TurnInputAmendment`追加，带指定Turn、来源/反馈版本、序号、命令ID与接收回执，不覆盖初始快照。

资料更新影响后续轮次；同名文件不作为全局身份，合并需要明确资源关系。中文“南门/北门”更新由真实资料/模型与用户核对，不把原型关键词替换规则搬入生产。

未发送草稿、暂存附件、选区引用及正文编辑草稿是设备本地状态，复用既有缓存Owner扩展持久化键。它们不是Station任务真源，原生端不能依赖reader组件存活或仅保存在localStorage。跨设备未发送草稿同步不在本次承诺范围。

## 宿主绑定、事件和Memory

Conversation宿主绑定保存actor/执行设备/host kind/instance/thread ID、授权配置revision、binary/schema/adapter身份。连接epoch只代表一次实际连接；Turn/Step绑定hostTurn/rootTurn、attempt与lease epoch；Item保留hostItem ID；Process ID必须与host instance/connection epoch组合，不能跨连接复用为活动句柄。

命令有command ID、输入摘要、revision前置条件及意图/已发送/已回执/已入库/未知状态；RPC request ID仅为传输关联。宿主事件入现有TaskEventWriter，以实际item、事件种类与接收身份去重；delta另记offset。Station cursor只覆盖入库记录，宿主分页cursor单独保存，输出缺口和未知副作用保留核对状态。

MemoryItem仍由MemoryService持来源、作用域和确认/纠错/删除版本；MemoryExtractionJob增加actor/作用域/来源修订/提取器版本、claim token、空输出/失败/完成与重试预算。Consolidation记录已确认选集摘要、输出schema和精确已消费版本；过期租约不能写回。embedding索引保存provider/model/dimensions/schema，升级先重建验证后切换，日常读写没有双Memory生成路径。

## 交互、Browser与插件投影

本机交互选择包含task/conversation/resource/version/anchor、手动展开、滚动/跟随方式、query/caret与return target，复用既有缓存Owner；这些不是任务运行真源。活动分组保留真实Item ID/Turn关系，分页只修复同轮邻接对象，不因新输出改变用户阅读位置。后台pending request按所属task定位，不改当前焦点。

BrowserSession拟保存task/执行设备/账号安全引用/page或tab/观察修订/控制租约/有效政策；选区引用保存采集版本、内容锚点和来源URI。真实页面操作事件与HTML成果版本分别记录；账号/页面改变或控制移交使旧操作前置条件失效。Computer Use引用独立设备能力和应用身份。

插件package保存源身份、安装版本及组件引用，角色binding/readiness继续复用现有Capability合同；安装、选择、授权、账号、实际目录与运行就绪分别投影。包升级/撤权使相应组件版本/binding失效，snapshot不能继续引用旧有效集。`disabledPluginIds`是宿主选择观察，不是Peers授权字段或执行阻断证明。

## 成果

复用TaskArtifact / TaskArtifactBlob及事件写入事务。每次新字节产生新的不可变版本ID，逻辑成果ID连接同一文件的版本；历史正文不能通过同一个blob ID的UPDATE改写。

当前Blob写入按artifact ID与body kind查找并可UPDATE，不能据此宣称历史版本已经不可变。新写入路径要保证新版本、新正文摘要及来源关系一起落库，再发布事件；并发人工编辑以基础版本前置条件控制。

成果版本绑定task、conversation/turn/step、真实字节摘要、内容类型、资料修订、来源成果版本及反馈锚点。网页来源指向确切正文版本；来源过时或不可读必须提示，不能换另一篇正文兜底。导出与查看读取同一版本。

消息里的artifact卡片、文件树、Portal、Search和通知均引用该版本。旧消息内确有字节的结果一次性导入成果体系；不得伪造原始来源或验证记录。

## 检查、接受和完成

检查记录绑定成果版本/摘要、接收条件修订、输入资料修订、检查类型、实际执行环境和结果。文本结构检查、真实命令/E2E与人工审阅分别记载，不互相替代。

接受记录绑定成果版本、当前检查集合与用户。正文和网页各自接受；修改成果/目标/条件/来源/环境使相关依据失效，重新检查不能自动恢复接受。历史记录保留。

列表“成果已接受”是当前必需成果的接受投影。任务完成由Task Owner核对当前接收合同和必需检查，不能由Agent回复、模型自评、退出码0或UI按钮单独决定。部分接受与取消不伪装全部完成。

## 派生、调度与多端

派生从明确终态历史截点创建TaskRun和Conversation；继承用户选定的历史、资料及成果引用，重绑目标内部来源关系。不继承活动请求、队列、草稿、写权限或接受证明。资源复制与隔离另走能力授权，不用会话复制冒充worktree。

Codex fork默认复制当前附件关联且可继承权限，不满足Peers精确截点合同。ForkReceipt须保存所选边界/引用、实际宿主返回附件、覆写后权限、独立资源准备与核对结果；缺资料或未授权写根时禁止派生首轮。资源不可读明确失败，不将同名新资料作为替代。

已有调度任务产生/关联同一TaskRun执行记录，再走Turn准入、能力执行和成果写入；调度配置保留于原Owner。协作执行可继续使用TaskRun/Step/Artifact核心，不能为工作台再制造另一套事件。

跨端同步权威事件与获授权结果引用。本机process、浏览器账号和文件根属于实际设备，其他端不能因为能看历史而获得操作权。
