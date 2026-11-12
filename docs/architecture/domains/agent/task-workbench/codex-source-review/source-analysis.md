# Codex 的相关设计与实现

固定源码：`67f0994b532b8740f14b5b738af7b7b2a915b1d6`。下文“实现”指代码读取，“测试规格”指已阅读测试；本轮均未运行这些测试。

## S01 执行状态与产品完成分层

`ThreadStatus` 是 `notLoaded / idle / systemError / active`；active 下另有等待批准、等待输入标记。`TurnStatus` 是 `completed / interrupted / failed / inProgress`。Thread 是宿主持久会话，Turn 是执行轮，Item 是命令、文件变更、消息、工具调用等可观测工作项。

这套类型适合执行投影，不能直接承担 Peers 的目标、成果接受和任务完成：空闲可表示中断或执行结束，completed 也没有说明当前必需成果是否满足接收条件。

来源：[Thread 状态](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1711-L1734)、[Turn 状态](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L30-L39)、[工作项](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L354-L437)。

Peers 应保留 TaskRun → Conversation → Turn，并保存外部 thread/turn/item 身份；TaskRun 的完成仍由当前成果版本、检查和用户接受推导。

## S02 发送、执行中补充、队列是不同操作

`turn/start` 内部走 `start_or_steer_turn`，不是“始终创建新轮”的原语。显式 `turn/steer` 要求非空 `expectedTurnId`，交给当前活动轮验证。测试分别覆盖没有活动轮的拒绝及返回真实活动轮 ID。

来源：[start 调用](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/request_processors/turn_processor.rs#L660-L720)、[steer 实现](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/request_processors/turn_processor.rs#L1077-L1135)、[steer 参数](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L321-L359)、[测试规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/tests/suite/v2/turn_steer.rs#L41-L68)。

Peers 必须明确用户动作：空闲开始、对指定活动轮补充、加入待办队列。不能把第二次发送直接交给 start 后再猜它到底产生了哪种行为。运行中补充作为追加输入修订记录，原轮上下文快照不覆盖。

## S03 Codex 已有持久队列，不能再叠一层自动调度

协议提供 `thread/queue/add/list/update/delete/reorder/start`，标为 experimental；实现与 thread store 负责身份、顺序和持久化。测试规格确认冷恢复会发出持久队列项，interrupt 保留队列，活动时 queue/start 返回 busy。

来源：[队列协议](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/common.rs#L646-L681)、[队列实现](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/request_processors/thread_queue_processor.rs)、[冷恢复规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/tests/suite/v2/thread_queue.rs#L430-L455)、[中断保留队列规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/tests/suite/v2/thread_queue.rs#L560-L581)、[busy 规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/tests/suite/v2/thread_queue.rs#L701-L721)。

推荐 Station 独占用户队列和任务级准入，不调用 Codex queue 写接口。恢复接入前检查宿主已有队列；发现不为空须核对归属和处理，不能让两边竞相续跑。

## S04 宿主 Goal 会触发执行

`thread/goal/set` 的实现明确写出：active goal 可立即注入目标或启动空闲轮，并在恢复时恢复 goal runtime。它不是仅保存目标文本的接口。

来源：[Goal 方法](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/common.rs#L631-L645)、[执行入口](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/request_processors/thread_goal_processor.rs#L115-L205)。

该提交的Goals默认开启，配置键为`features.goals`，接入必须显式关闭并验证生效。[Feature声明](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/features/src/lib.rs#L2114-L2120)。

Peers 的持续推进由 Task Owner 持目标、预算、准入及停止状态。推荐接入配置关闭宿主自主 Goals，不把 TaskRun 的目标直接设成 Codex active goal。否则用户停止 Peers 队列后，宿主仍可能再启动轮次。需要未来开放宿主目标时，应作为独占执行委托设计，不能只做状态映射。

## S05 Stop 有提交和实际中断两个时刻

普通 `turn/interrupt` 检查活动 turn ID，并把请求留在 pending_interrupts；终态事件处理中释放回执：TurnAborted，或中断竞态中已经到达的TurnComplete。RPC成功本身不说明取消了副作用，客户端仍要核对实际终态。启动期间空 turn ID 的中断另有分支，不能混为普通轮停止回执。

来源：[中断实现](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/request_processors/turn_processor.rs#L1470-L1534)、[完成竞态](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/bespoke_event_handling.rs#L192-L206)、[中断事件](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/bespoke_event_handling.rs#L1269-L1282)、[回执处理](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/bespoke_event_handling.rs#L1636-L1650)。

Peers 的 Stop 应先原子暂停任务后续准入，再中断准确活动轮，最后核对工具子进程和成果。只显示“停止请求”不能当作“已停止”；超时或断连时进入待核对状态。停止没有撤销外部已经发生的副作用。

## S06 批准是有身份和作用域的请求

决策枚举区分 accept、acceptForSession、策略修改、decline 和 cancel；decline 拒绝本操作，cancel 是中断。请求发送与响应核对有接收连接范围，pending 请求可对合格连接重放。

managed humanCommand 必须用 `experimentalApi + requiredHumanApproval` 声明客户端能力，且只接受一次性的 accept/decline/cancel。没有合格连接时不能靠 session/persistent 批准绕过。

来源：[批准枚举](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L68-L115)、[接收者与身份](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/outgoing_message.rs#L388-L438)、[pending 重放](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/outgoing_message.rs#L525-L578)、[握手](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/v1.rs#L42-L78)、[humanCommand 合同](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/README.md#L1-L16)。

Peers 的批准必须绑定 actor、设备、任务、轮、请求及授权版本；一次批准只回答这一请求。宿主重放 pending 不代表允许重放已执行命令。用户交接、撤权和连接换代都要再次核对。

## S07 连接生命周期与进程生命周期相关

`command/exec` 运行会话按连接 ID 与 process ID 定位；可写 stdin、resize、terminate。断开该连接会终止其进程。测试使用两条连接同名 process ID，另一连接不能 terminate 第一条的进程，然后确认第一条断开使进程消失。

stdio 单客户端断开会进入 app-server shutdown。命令流式输出也不会在最终结果重复完整缓冲。

来源：[命令连接范围](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/command_exec.rs#L64-L114)、[断连清理](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/command_exec.rs#L388-L415)、[进程规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/tests/suite/v2/command_exec.rs#L1167-L1248)、[流式规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/tests/suite/v2/command_exec.rs#L868-L930)、[stdio 关闭](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/lib.rs#L1196-L1220)。

持久连接应由本机 Rust worker 管理，页面只订阅 Peers。页面关闭可保留 worker；整个 Desktop/worker 退出后的存活不是本提案保证。绑定记录必须有 host instance 与 connection epoch；旧 epoch 的 process 不能在新连接冒充活跃。

## S08 历史回读和实时事件分别处理

read 可只读元信息；resume 的 `excludeTurns` 支持避免装载整个历史。`thread/turns/list` 与 `thread/items/list` 分页，Item anchor 在指定 Turn 内校验。实现协议保留相同工作项类型用于实时通知和历史。

来源：[resume 轻量恢复](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L419-L439)、[历史分页](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1737-L1875)、[Item anchor 合同](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/README.md#L685-L704)。

Codex 分页游标不是 Peers TaskEvent 游标，也不是所有通知的持久重放序号。适配器把观察记录落 Peers 事件；丢失通知后读取 host thread/turn/item 收敛最终状态，不能把缺失 delta 自动补成已成功。大历史按需读；切换会话不让全局 store 重新初始化。

## S09 附件是当前关联，不是不可变成果库

迁移 0051 的 thread_artifacts 存身份键和 payload；0055 已改名 thread_attachments。attachment add/list/remove 不创建或删除资源字节。

fork 复制源会话当前附件，而不是所选历史截点的附件；新关联 ID，引用同一资源，复制失败可以让 fork 成功但没有附件。不能把这种成员关系当“已复制文件”或“来源完整”。

来源：[0051](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/state/migrations/0051_thread_artifacts.sql)、[0055](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/state/migrations/0055_thread_attachments.sql)、[附件合同](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/README.md#L403-L470)。

Peers 资料集合仍在 Task Owner，Turn 冻结真实版本；成果字节仍在 Artifact/Blob Owner。Codex attachment 只在确有消费者时作为投影，不能成为第二资料真源。

## S10 Fork 的历史隔离不等于资源与权限隔离

paginated fork 保留源 lifecycle reservation，物化来源，再用明确 HistoryPosition 绑定历史边界；通过活动 Turn 的截点被拒绝。测试又确认 fork 可继承 permission profile 和 approvals reviewer。

来源：[fork 准备](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/thread-store/src/local/paginated_fork.rs#L15-L86)、[边界校验](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/thread-store/src/local/paginated_fork.rs#L87-L166)、[权限继承规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/tests/suite/v2/thread_fork.rs#L321-L359)。

Peers 派生选择历史、资料版本与成果引用，创建新任务；权限重新授予，写根另行准备。不能仅调用 fork 就宣称独立 worktree、完整截点资料或接受证明继承。宿主 fork 返回后要重新核对实际配置与附件；失败的派生不得准入。

## S11 Memory 写入是有界、版本化的后台工作

root 启动、非 ephemeral、feature 开启等条件才进入后台 pipeline。Phase 1 领取有限来源，限制并发，区分无输出与失败；输出带来源更新时间，提交用 ownership_token 做事务前置条件。Phase 2 有文件工作区锁和全局 job claim，同步选中来源，再依据实际 diff 与输出有效性决定是否跳过，成功标记精确消费的来源版本。

来源：[启动](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/memories/write/src/start.rs#L20-L95)、[Phase 1](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/memories/write/src/phase1.rs#L119-L189)、[写入 fencing](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/state/src/runtime/memories.rs#L859-L934)、[Phase 2](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/memories/write/src/phase2.rs#L50-L163)、[精确来源消费](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/state/src/runtime/memories.rs#L1260-L1305)。

不能照搬文档的“始终无网络沙箱”描述：worker 对 Managed 权限设置仅 Memory 根可写、网络关闭，但对父 Disabled / External 权限保留该模式。文档陈述不能覆盖实际分支。

来源：[worker 权限构造](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/memories/write/src/phase2.rs#L310-L368)。

Peers 应在现有 MemoryService/后台 job 与租约边界借鉴这些机制：候选有来源修订、提取版本、去重键、租约和空输出状态；整理对作用域串行，对当前已确认集合做增量更新。采用修订集合摘要判断变化，不要求再引入一份 Git Memory 仓库。

## S12 Memory 实际读取不等于线程摘要 API

当前 prompt 读取在 `ext/memories`：extension 按 feature/use_memories 决定是否贡献上下文，读取选定 MemoryVersion 的摘要，限制 token；摘要缺失返回 None，V2 不回读 V1。配置更新还保留初始 namespace，确保摘要和检索工具一致。`thread/memory/read` 另用于展示该线程解析版本的摘要。

来源：[extension](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/ext/memories/src/extension.rs#L37-L149)、[prompt reader](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/ext/memories/src/prompts.rs#L31-L68)、[版本隔离规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/ext/memories/src/prompts_tests.rs#L38-L66)、[线程展示读取](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/src/request_processors/thread_memory.rs#L1-L30)、[开关合同](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/config/src/types.rs#L322-L365)。

推荐 Peers Memory 单一生成和消费 Owner，接入宿主默认关闭 Codex Memory feature、generate/use 与专用 Memory 工具；每轮只传 Station 已授权确认快照。仅关闭 generate 不会关闭读取。新建隔离 host home 也不能代替显式配置检查。

Peers 当前 Search 失败回全量快照，默认 hash embedding 按空白切词；这些是质量和边界问题。Codex 的读取机制本身没有证明中文语义 embedding 可复用，不能把其 Memory pipeline 整体迁入 Go 再宣称质量解决。

来源：Peers 回退路径 `apps/station/app/subserver/agent/service/memory_service.go#L1362-L1400`、Peers embedding 接口和 hash `apps/station/app/subserver/agent/service/memory_embedding.go#L19-L70`、Peers prompt 消费 `apps/station/app/subserver/agent/service/prompt_assembly_service.go#L164-L192`（研究基线路径，以当前 master 为准）。

## S13 Profile/Skills 消费需要来源和权限

thread start/resume 可传 base/developer instructions；它们是明确配置，不等于模型 personality。Skills extension 在 step preparation 解析一次策略并准备目录，区分 host 与 executor 来源，使用捕获的 selected roots；read 仍按权限上下文，呈现有预算。

来源：[thread instructions](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L62-L111)、[Skills step 准备](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/ext/skills/src/preparation.rs#L1-L132)、[呈现预算](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/ext/skills/src/render.rs#L22-L34)、[filesystem authority 规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/ext/skills/tests/executor_file_system_authority.rs#L260-L285)、[权限上下文缓存规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/ext/skills/tests/executor_file_system_authority.rs#L1076-L1101)。

Peers 复用 Profile/Skills/prompt ledger：选择角色后把规则、skills 目录和读取引用按版本交宿主，工具调用回现有授权链；不同时扫描两个重复目录或把 description 目录当已读正文。宿主实际加载的 instructions 需登记来源，避免宿主用户目录的全局规则隐式污染当前 actor。

## S14 能复用执行和协议，不能推导出商业 UI/服务可复制

TypeScript SDK `exec.ts` 为 `codex exec --experimental-json` 子进程包装，每次 run 启动执行；它不提供本次所需完整双向 app-server 接口。Rust `app-server-client` 虽有 remote facade，但 crate 本身仍依赖 app-server/core 等，并含 in-process 运行和本地无界消费事件队列。将它整个带入 Tauri 不是轻量客户端方案。

来源：[TS exec](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/sdk/typescript/src/exec.ts#L78-L183)、[Rust facade 与队列](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-client/src/lib.rs#L5-L27)、[依赖](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-client/Cargo.toml#L15-L38)。

协议导出有稳定与实验两套预计算 schema，握手不返回完整 feature 目录。推荐复用获验证的 Codex 二进制与其匹配 schema，窄适配器只实现本次命令与事件；升级以同一行为验证集校验。不能仅设 experimentalApi 就认为所有实验能力都可用。

来源：[schema 导出](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/precomputed_exports.rs#L14-L96)、[握手返回](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server-protocol/src/protocol/v1.rs#L79-L94)。

artifact_operation 只识别可信 marketplace/plugin/script 的“开始 create/edit 操作”标记及输出格式/数量，测试拒绝无归属或非法标记；没有提供版本字节、用户接受或真实性检查。browser_use 配置提供来源、上传下载和 CDP 权限字段；这份源码不能证明已包含完整商业浏览器 UI、远程浏览器服务或 Office viewer。

来源：[操作识别](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/core-plugins/src/artifact_operation.rs#L16-L108)、[拒绝规格](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/core-plugins/src/artifact_operation_tests.rs#L31-L105)、[Browser 配置](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/config/src/browser_use.rs#L1-L22)、[许可证](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/LICENSE)、[NOTICE](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/NOTICE)。

因此 Browser 接已有 MCP/worker 与成熟控制组件；预览沿现有 reader；版本、检查、接受沿 Station。直接使用或分发 Codex 二进制/源码时保留 Apache-2.0 及 NOTICE；云账号、商业插件和其他依赖的可用性分别核对。
