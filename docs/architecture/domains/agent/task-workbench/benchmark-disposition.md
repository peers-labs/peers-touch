# 持续任务能力 — 基准取舍

状态：accepted 参考（Owner 2026-11-02 确认）。TW-20261101。

证据入口：2026-11-01 调研报告（工作区本地交付物，不随仓库分发）。报告已记录官方 URL、固定源码 SHA、Peers 基线 `99be6b609` 及证据边界。这里取舍行为，不把公开声明当独立实测。

- **B01 全局任务发现 — adopt。** TRAE/TraeWork 任务与 Query 检索，Codex thread list，报告 C02/C12/R05；对应 C01/02。在既有 Desktop Search 接任务来源，拒绝角色内标题检索作为全局入口。
- **B02 持续任务与并行观察 — adapt。** C01/C06/R04；对应 C02/03/10。不同任务可并行观察；共享写资源的执行必须受控，不以标签页证明隔离。
- **B03 File/Browser/Terminal/Diff/Summary — adopt。** C01/C03/C06/R06；对应 C05/06/08/09/10。一份任务上下文、多种工作面，引用反馈回流，拒绝独立孤岛页。
- **B04 实时跟随 — adapt。** C01；对应 C02/10。只跟当前任务，手动选择立即退出跟随，不抢用户控制。
- **B05 HTML 批注与产物空间 — adapt。** C14/C15；对应 C05/17。先闭合版本阅读与批注再改；全局产物可通过 Search 和任务结果访问，不引入第二套资源 Owner。
- **B06 Local/Worktree/Cloud — adapt。** C06/C12；对应 C04/15。用户见实际位置和能力；不恢复独立 Project CRUD，不用临时目录冒充可恢复工作树。
- **B07 线程恢复、fork、rollback、steer — adapt。** C07/C24/R04/R05；对应 C02/03/04/09。采用完整行为合同；fork 说明历史与资源继承，rollback 单独授权且核对副作用。
- **B08 双向外部执行宿主 — adopt 行为，架构待确认。** C25/C26/R04/R06；对应 C03/08/09/10。富客户端优先复用成熟宿主，保留完整审批、计划、Diff 和退出语义；SDK 批作业不冒充交互宿主。Peers 不重建执行引擎。
- **B09 Memory 候选、整理、使用反馈与删除 — adapt。** C16/R01/R02/R03；对应 C11/12。强调中文、来源、作用域、纠错与遗忘。公开 feature-flag 管线不证明账户质量；拒绝“条目数=能力”和无关快照兜底。
- **B10 规则、Skills、Knowledge — adopt。** C05/C08/C09/C17/C18；对应 C11/13/14。解释本轮来源及版本，按需使用；角色管理不复制模型或连接器凭据 Owner。
- **B11 插件与渠道授权 — adapt。** C20/C21/C22；对应 C14/15。复用已有官方 CLI/SDK 与权限体系；有读取也有产出回写，渠道身份与上下文不自动合并。
- **B12 Computer Use — defer。** C23；对应 C07。平台控制、权限和 Native 证明未闭合，不让 Browser 标签代理它。
- **B13 自动化、多 Agent — defer 当前广告。** C10/C11/S27；对应 C16。已有基础仍保留，先验收单任务到结果链，不恢复隐藏 Atelier。
- **B14 分享与公开版本 — degrade/defer。** C13/C14；对应 C17。支持权限内指定版本读取/导出；公开会话分享待撤销与敏感来源合同。
- **B15 竞品名称、布局皮肤、Project 组织 — reject。** 品牌不进入 Peers 用户文案与角色命名；继承 Peers UI ID，采用工作流价值，不复制外部产品身份。
- **B16 仅输出自然语言“完成” — reject。** R08 公开完成判断与 S15/S16 失效证明；对应 C10/18。对话结束、工具结束、验证完成和产品交付分别判断，所有未执行验收保持 UNPROVEN。

未做同模型同环境性能/成功率比较；不承诺“超过竞品”。设计目标是可独立验证的完整用户工作。

## 当前源码复审的适配

本轮阅读 Codex `67f0994b` 与 LobeHub `483c4a343e437bf6e812b5f71a9a47ce7b5c7be4` 的本地源码。LobeHub 事实仅针对这个 checkout，不外推线上版本。

- **对象与返回：适配。** LobeHub `src/store/chat/slices/portal/initialState.ts` 的 `PortalViewData` 使用具体对象引用；`action.ts:821–873` 管理 push/pop/replace。Peers 在任务内保存已打开实例和当前标签，来源下钻才保存标签的 returnTo。TRAE 现场的文件、网页与终端并行查看用于校准空间关系；关闭查看、收起工作区与终止执行分别成立，不增加 Portal store。
- **扩展安装和角色绑定分离：采用，凭据边界按 Peers 合同。** LobeHub `src/store/tool/slices/connector/action.ts:265–282` 挂载/卸载后刷新两侧目录，`:358–377` 同步工具后回读；`mcpStore/action.ts:213–256` 区分安装取消、连接测试及安装。Peers 复用 Settings/AgentProfile，各消费者读同一目录；当前原型只验证配置格式。生产端仍由 Station 管理凭据，不向客户端回传秘密。
- **执行历史与当前活动分开：采用。** Codex `codex-rs/tui/src/chatwidget.rs:1–31` 区分 committed transcript 与 live tail，busy 从真实生命周期推导，并抑制重复进度；命令解析与执行接受分开。Peers 保留消息、Turn 与 task run Owner，命令在执行准入检查可用性；回读结果位于同一任务。
- **完整工作台名称和能力数量：不照搬。** Codex 的执行环境和 LobeHub 的工具 UI 不能由一个 Browser Tab 或若干开关代替。当前仅展示可完成的本地交互，联网浏览/接管、安装执行、Memory 效果与真实验证仍需后续设计和证明。

对应可操作路径、截图和缺口见 [原型自审](./prototype/review-20261102.md)。
