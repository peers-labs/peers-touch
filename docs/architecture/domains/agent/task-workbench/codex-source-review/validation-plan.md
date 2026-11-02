# 落地验证计划

状态：未执行。以下为方案确认后要取得的真实证据；本轮没有 Codex 测试、模型调用或 Native 集成运行记录。

## 前置：固定被测对象

干净专用 worktree、已审阅生产基线、已认可原型合同；记录 Peers 源文件摘要、生成 Model/schema、Codex binary/version/digest、adapter/schema、OS/沙箱和执行设备。准备脱敏日志、任务/轮/命令 ID、lease/epoch、来源修订、artifact 摘要及宿主状态观测。

早期先做受控 Native 旅程与必要边界检查，随后补触及协议/租约/迁移的定向测试及正式 Acceptance。不为文档或可逆小改动编写镜像测试，不先运行全仓长测试。

## V01 协议和 Owner 可以实际工作

匹配 schema 的 binary 启动、initialize、start/read/resume、turn/items 分页；同一任务恢复原 thread。必需实验字段/方法不支持时应拒绝配置。

核对 Codex Memory 读写/工具关闭、自主 Goals 关闭、队列为空、有效账号/模型/权限及 instruction sources。任务由 Station 独占准入；尝试让旧宿主 queue 或 goal 在冷恢复发轮，确认系统阻断接入而非出现双执行。

参考规格：[queue 冷恢复](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/tests/suite/v2/thread_queue.rs#L430-L455)。本项实际通过才进入完整 UI 接线。

## V02 真实执行和中途介入

给受控根真实资料与明确条件，启动任务；活动时补充输入及选区反馈，核对 expectedTurnId、amendment 顺序与实际模型采用；切到其他任务并返回，独立草稿不丢失。

活动时加入两个 Station 待办，移动/删除产生版本冲突需正确拒绝；观察只有 Station 在终态后发下一轮。不同任务在不重叠写根与配额内有限并行，同根写租约冲突须阻断。

## V03 批准、停止、撤权和账号切换

受控命令触发 fresh humanCommand，批准只作用本操作；拒绝与取消分别观察。旧 request/turn/actor/epoch 决策不得释放新操作。

Stop 原子暂停后续队列、仅中断指定任务；记请求时间、真实 TurnAborted/终态及工具处理结果。其他任务不被误停。连续重复 Stop 有明确可回读状态。

批准期间撤权或切账号，旧授权不执行。错误配置不自动切成 danger-full-access，也不静默改成另一个模型/角色。故障造成无法核对时保持未知，不显示已完成。

## V04 连接故障与副作用不会被盲重放

关闭页面、断开 Station、停止 worker、结束 app-server 四种故障分别验证。前两种仍有 healthy worker 时可按有效租约保留连接；后两种不复用旧 process。

在命令意图落账后、发送后回执前、回执后 Station 入库前分别制造故障，观察重新接入先核对 host history/文件；没有幂等能力的文件/外部写入不重发。重复事件不产生第二成果版本。

小缓存/慢落库/磁盘满时验证内存有界、控制请求可响应、缺口有记录。对 streamed output 确认不能仅靠最终响应重建全部日志。

参考规格：[连接范围和断连](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/tests/suite/v2/command_exec.rs#L1167-L1248)、[流式结果](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/app-server/tests/suite/v2/command_exec.rs#L868-L930)。

## V05 成果、反馈、检查和接受闭环

真实资料 → 模型/工具消费 → 文件字节回读 → 不可变成果 → Portal → 选区反馈 → 新版 → 检查 → 人工接受 → 导出 → 重开。

独立比较实际文件、Station Blob、预览及导出的摘要；修改后旧版本字节不变。网页来源定位到确切正文版本；正文和网页分别接受，列表按全部当前必需成果推导。

制造 exit 0 但无必需文件、plugin 操作标记但字节不存在、Turn completed 但条件不满足等情形：都不能完成任务。修改输入/条件/成果使对应检查和接受失效。

## V06 Memory 与 Profile 真正影响行为

通用模型和 Codex 两条路径分别做：角色规则 → 任务采用；候选提取 → 确认 → 第二任务中文改写召回 → 无关任务不注入 → 纠错/删除 → 再次任务验证。

检索失败不得全量注入；必要 Memory 不可用时明确阻塞或按合同降级。跨 actor/角色/设备撤权无串读；宿主 home 中故意放旧摘要，确认它未注入。

并发提取、过期租约回写、来源更新、空输出、整理无变化、索引 schema/embedding 维度升级均验证；删除后的来源不因整理回到正式集合。已开始轮次的冻结快照和补充记录可追溯。

## V07 派生和大历史

从终态截点派生，新任务只继承选定资料版本、反馈与成果引用；给源任务增加截点后的附件，确认未混进派生输入。模拟宿主 fork 附件复制失败，不得准入首轮。

新任务没有父写权/接受/队列，独立根需真实授权；另端能看历史不自动能操作本机。超过首次页面规模的历史验证双向分页、anchor 范围及重复 page 不丢不重。错误不作为“历史已结束”。

## V08 Browser、已有能力和迁移收口

Browser 经选定成熟 MCP/worker 真实读取、选区反馈、执行、回读；人工接管暂停 Agent 操作，归还后重新观察账号/页面。错任务、错账号和权限撤销阻断操作。

插件验证覆盖实际包安装、配置/登录、角色binding、有效工具目录、任务调用、结果回读、升级/停用/卸载。`disabledPluginIds`已保存但工具仍暴露、installed=true但MCP未启动、空appsNeedingAuth但runtime不可用这三类反例均应阻断就绪声明；商业Apps按实际账号可用范围验证，不能仅因源码存在纳入能力集。

Scheduler、Connector、协作及 Profile 中保留能力均有任务输入与结果消费者；未实现能力无空入口。检查 Home/搜索/通知/消息/Portal 只写当前 Task/Artifact Owner。

旧数据备份并完成还原演练；迁移校验身份、数量、归属、字节摘要与引用，保留历史人工完成为旧动作。删除被替换接口/store/解析器后执行旧用户任务回读和新任务全生命周期；对已知部署消费者完成版本切换。

## 证据表达

每条通过需有精确源/运行身份、命令与回执、输入与成果摘要、实际观测、失败支路和输出消费者。不同证据分别标记原型交互、源码规格、模型审查、真实旅程、正式 Acceptance。

用户亲自测试后再进入 MR；本提案不代替提交、生产迁移或部署授权。所有 required 旅程取得真实证据且被替换路径/正式文档同步清理后，才声明完整落地。

## V09 UI/UX、寻找和后台工作连续性

基于已认可紧凑布局，验证真实流式/活动分组与全部历史分页，手动展开、滚动位置、选区和版本不跳动；只有主动回到最新才恢复跟随。后台任务产物/批准不抢当前任务焦点，待处理提示打开准确request。切任务、切会话、Profile返回、窄屏reader返回保留独立草稿/附件/引用与返回点。

页内/全局搜索验证目标/条件/资料/正文命中，选择性展开、Unicode锚点和回读权限；加载失败与无结果分开，retry保留query。键盘、focus-visible、Esc局部退出、读屏名称、长内容、窄屏按钮可达、静置与无变化同步分别取证。Codex TUI截图/测试规格和既有原型截图不能替代Native实测。
