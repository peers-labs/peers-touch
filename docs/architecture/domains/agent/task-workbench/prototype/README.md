# 持续任务工作区原型

状态：interaction contract accepted（Owner 2026-11-02 确认）。原型内全部执行为模拟（fixture/simulation/localStorage），是交互合同证据，不构成生产实现或运行证据。

> peers-ui 重构参照（drafting，2026-11-06）：新能力（模型工具审批、能力 readiness、版本终态、人工接管）在 `@peers-touch/ui` 原语上的重构原型见 [peers-ui-refactor.md](./peers-ui-refactor.md)，入口同为 `?site=desktop&state=task-workbench`（当前分支构建）。

## 打开与评审

地址：<http://10.37.246.80:3201/?site=desktop&state=task-workbench>。点击“全屏预览”。

源码位于 `packages/prototypes/desktop/shell/`，运行于唯一 Prototype Portal / Desktop Shell。已有服务继续保留；启动入口为 `VITE_PROTOTYPE_HOST=0.0.0.0 VITE_PROTOTYPE_PORT=3201 make run-prototype`。

先体验任务列表中的两件工作：

1. **场地研究 · 网页到方案**：若角色未绑定浏览器，点击“管理浏览器能力”，在 Profile 启用 Integrated browser 后返回。接管同一网页，完成成员登录，归还并继续。Agent 重新观察页面并整理研究文档。文档反馈进入主草稿，发送“补充风险与应对”产生新版本，再核验与接受。可以在 Agent 处理时选回网页，检查新结果是否只提示、不抢当前阅读。
2. **报名页 · 制作与验证**：从执行活动打开文件变更和失败检查；开发服务标签中重新启动服务，打开服务进入浏览器。接管后可填写报名表单。引用网页问题或检查失败到对话，发送修复要求，回到代码变更运行检查。关闭终端标签、收起工作区与结束进程分别体验；服务结束后，浏览器恢复动作指向同一终端。

“开放工作日”保留资料、历史版本、派生 HTML、编辑和导出的路径。

## 空间与动作

工作区顶行显示已打开对象实例。标签行的“+”只打开工作文件、浏览器、终端或旁聊；任务标题旁的“⋯”打开任务目标、重命名、固定、派生、标签和删除。文件与执行活动打开同一对象，标签溢出使用组件的对象列表。右上固定锚点收起整个工作区；标签上的关闭只关闭查看。放大/恢复并排、拖动/键盘调整列宽只改变布局。

文档的版本、编辑和反馈在对象操作行；核验与接受在底部。网页的后退/前进/刷新在地址栏；接管和归还在控制权状态行。终端的结束进程与查看服务属于该进程。只有来源下钻才出现具名返回。

跟随只作用当前任务。手动选标签或编辑退出跟随，后台结果保留提示。恢复跟随才打开最新结果。草稿、标签、选中对象、阅读位置与布局按任务保留；关闭页面后运行状态恢复为断连，需要重新核对，不能从缓存推断进程仍活着。

Settings 管理扩展安装/配置；Profile 管理角色绑定；输入旁的“工具”选择本次调用，活动记录打开该次调用的对象。未实现调用的工具保持禁用，不回退成普通回答冒称执行。

## 复用与状态责任

消费 [工作区提案](../workspace-experience-proposal.md)、[体验合同](../experience-contract.md)、[状态模型](../product-state-model.md) 与 [操作矩阵](../acceptance-matrix.md)。

AgentChatPage 是原型唯一任务状态 Owner，保存连续对话、Turn、队列、资料、成果、网页会话、进程和检查。`agentWorkspaceModel.ts` 提供纯状态转换，`AgentTaskWorkspace` 与 Browser/Execution panels 呈现对象。浏览器/进程不由查看组件的挂载决定生命周期。旧本机预览数据在读取边界升级，编辑草稿与历史保留；旧的任务内会话层级不再显示或写入。

复用既有 Shell、Profile、Composer、Search、Markdown reader、RailSearchHeader、PanelToggleDock 和 antd 的可关闭标签/菜单/输入控件；不添加另一个应用入口。已有资料修订、用户标签、任务派生、Memory 候选与单任务排队保持各自 Owner。

## 原型边界

顶部“交互原型”标记适用于整个工作区。网页是有界场景页面；成员登录不收取密码，不连接真实账号。导航、接管、重新观察、代码修订、服务、终端输出和检查由确定状态转换呈现，不执行系统命令或联网请求。

文档正文、编辑、版本、下载、资料文件输入和本机持久化使用实际浏览器数据。资料自动整理与改写有界，失败保留输入。旁聊回复为任务上下文的有界表达；未证明独立模型执行。代码复测只校验场景中的内容条件，不是生产测试。

真实 Browser Use、Computer Use、外部执行宿主、服务端持久化、多端同步、并发模型、完整文件系统及生产 Acceptance 均为 **UNPROVEN**。完整操作矩阵、暗色、完整辅助技术和长时间性能仍需各自证据；局部截图与点击不外推。

当前检查与渲染证据位于工作区交付目录 `agent-workspace-prototype-20261102/`，详见 [本轮自审](./review-20261102.md)。Product acceptance、独立 Experience receipt 与 Reasoning admission 尚未成立，状态不提升为 confirmed。
