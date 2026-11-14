# 关键决策提案

> **Status**: accepted（Owner 2026-11-02 确认；决策 ID TW-D01…TW-D10；实施承接：TW-20261102）
> **Version**: v2.0
> **Created / Updated**: 2026-11-01
> **Owner**: Peers-Touch Agent Team

以下决策（TW-D01…TW-D10）已于 2026-11-02 经 Owner 确认为本架构源的 accepted 决策；实施按 TW-20261102 执行计划切片落地，切片完成证据以计划 outcome comparison 为准。

## D01 复用TaskRun，收口重复任务生命周期

选择现有持久TaskRun/Step/Event底座，使Conversation承接任务的连续对话。改造手工AgentTask消费者，迁移其用户资料并删除重复状态与接口。拒绝新建WorkbenchTask及长期维护Task/Topic/AgentTask映射层，也不向用户暴露“续接新会话”。

收益：运行、队列、成果和恢复共用任务身份；既有租约和回执投入保留。代价：连续对话与宿主thread的内部映射、任务级准入、Home/任务卡调用方需要一起迁移，不能靠改名字完成。

复审条件：发现TaskRun无法满足隔离或其他Owner的实际硬约束时，先调整正式合同，不能加旁路。

## D02 产物成为版本化资源

在现有Artifact/Blob Owner上引入不可变版本及接受证明，消息仅引用。拒绝以最新消息/代码块解析作为正式结果真源；也拒绝每个reader独立保存正文。

收益：打开、反馈、人工修订、网页来源、导出和检查可使用同一版本。代价：需改现有Blob覆盖写入、补已有成果一次性导入及所有结果消费者。

## D03 统一任务协议，保留执行方式差异

Peers模型与工具循环是默认首条真实执行链；持久外部runtime按完整宿主协议适配，作为可替换adapter而不是产品状态Owner。同一Task/Turn合同对用户呈现实际能力，模型接入不广告宿主不存在的能力。

收益：先打通现有Station/设备能力，避免在宿主二进制未验证前重写整个Agent；同时把主流 runtime 已验证的恢复、审批、工具和资源生命周期机制吸收到 Peers 合同内。代价：协议版本、批准映射、权限边界、恢复和资源清理必须验证；部分适配器只具备有限能力。

具体选择：在Peers proto/Station/Rust worker内实现 durable event/inbox/run coordinator、Terminal viewer/resource 分离和 Browser attachment 语义；Codex 或其他双向 host 走 ExternalRuntime 证据门（binary+schema+窄适配器）。不使用一次性TS exec SDK冒充持续控制，不默认把依赖core/app-server的Rust facade嵌进Desktop，也不直接打包外部core作为第二业务Owner。Station独占队列、持续目标与准入；关闭宿主自主Goals/Queue/Memory，不向宿主队列写入。外部宿主能自动发轮，双Owner会破坏Stop/恢复合同。

宿主原生命令/文件由宿主执行并遵循有效沙箱；Peers工具经动态调用回现有ToolDispatch，不能重复执行。宿主由实际设备worker持连接，ExternalRuntimeService保留绑定/路由/归并；Page只订阅Peers。

## D04 Memory改进原Owner

保留记忆数据、作用域、纠错及prompt processor；结构化候选、授权确认、相关召回和整理都进入MemoryService现有边界，embedding沿现有接口选择。拒绝另建CloudMemory store，也拒绝全量快照兜底冒称相关召回。

收益：用户历史和基础建设都得到消费。代价：模型费用、提取误差和索引升级需要预算与质量样本。缺embedding/检索失败时明确降级，不注入无关项；必需记忆条件缺证据时保持阻塞。

Codex自有Memory feature、generate/use及专用工具关闭，实际消费Peers确认快照；复用机制为有界提取、来源版本、空输出、租约条件提交和确认选集增量整理，进入现有Memory Owner。禁止两边生成/读写后做同步桥；仅关闭generate不满足单一读取要求。

## D05 保留核心，删掉重复产品与接口

Project CRUD、重复任务入口、原型模拟逻辑、无人消费的开关/路由，以及被替换的协议和store要删除。共享能力按真实消费者判定，不按旧页面归属删除。

收益：运行只剩当前架构；用户数据可继续使用。代价：切换需覆盖部署版本和迁移校验，不能长期双运行。未知外部消费者是一项切换前检查，不以永久兼容层掩盖。

## D06 按真实交付链落地

先打通Peers任务事件、准入、队列、成果和设备能力回执，再完成资料任务及跨任务恢复、Memory质量、Terminal和Browser；外部宿主控制/权限/恢复并行取证，但只在证据门通过后替换或扩展runner。每段同时交付服务、UI、来源、失败恢复和删除。拒绝“前端完成→后端补齐→最后补测试”的孤岛阶段。

收益：每段都有可用消费者与独立结果；原型所示操作不会变成空按钮。代价：需要先把核心身份、版本与权限做正确；最终完整交付仍包括全部required能力。

## D07 连接、上下文和派生都有可核对边界

连接epoch变化后process句柄失效；宿主历史read/resume与Peers事件cursor分别恢复。命令先记意图/发送/回执，不确定副作用停止重放；普通Page关闭与实际worker退出分开。大输出有界落磁盘并可回收，不直接照搬无界事件消费队列。

Turn初始manifest不可变；活动轮补充只在Station确认仍可安全并入时作为amendment，请求已发出后进入下一轮队列，支持实时steer的runtime必须单独广告能力。Profile/Memory修改默认下一轮。Fork只继承选择的终态历史和资料/成果引用，重新授权并核对实际宿主附件，不能继承接受或假定worktree。

收益：状态与实际设备/来源一致，避免断连重复写和派生扩权。代价：每种故障、来源冲突及fork差异都要真实验证；协议无法观察的结果保持未知，不能自动补成功。

## D08 完成属于成果合同

Codex thread idle、Turn completed、command exit 0、插件artifact marker和模型review均是不同级别的事实，不能代替当前成果检查/用户接受。Station检查字节版本、条件/来源及环境，必需接受集合满足后由Task Owner完成。持续进程提供按需Terminal查看，必要命令事实进入任务执行/检查记录；关闭标签不结束进程，断连不能从缓存推断存活。

源码依据见 [设计复审](./codex-source-review/design-review.md)；各决策的生产落地证据以 TW-20261102 执行计划 outcome comparison 为准。

## D09 UI交互状态与执行事实分离

工作区空间采用原型确认后的任务标题菜单与工作对象标签行分工。历史/活动尾部按真实Item投影，已打开实例、布局、跟随、滚动锚点、选区、搜索、草稿和具名返回归既有本机缓存Owner；后台工作与批准提示不抢当前焦点。终端/浏览器查看者与设备资源生命周期分离，TRAE现场用于校准多对象空间，不把商业GUI视觉当开源事实。

收益：执行持续进行，用户仍能稳定阅读和介入。代价：流式、分页、缩放/宽窄、键盘和静置要真实Native验证，截图不代替交互证明。

## D10 Browser和插件必须有实际消费者

真实Browser按设备attachment模型接入现有设备worker：Desktop browser host连接任务后授予能力，操作携带browser session、tabID和一次性snapshot ref，command/result具备关联、超时和断连恢复；account/task/控制租约及政策完整绑定。Playwright MCP或内置host只是实现候选，不能让MCP配置替代session/page/account回读。HTML预览归Portal，Computer Use按独立设备能力取证。插件是现有Skill/MCP/Connector/hooks的交付包，安装/登录/角色binding/有效目录/任务调用/停用卸载通过既有Capability authority/readiness管理，不新建工具注册表。

Codex`disabledPluginIds`仅保存选择，不能当权限执行边界；installed或空appsNeedingAuth不作ready证据。配置与实际目录不符时阻断准入，不用隐藏菜单兜底。详细来源及链路见 [完整能力复审](./codex-source-review/capability-review.md)。
