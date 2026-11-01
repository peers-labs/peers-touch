# Peers UI System

> **Status**: active
> **Created**: 2026-10-28 | **Updated**: 2026-10-29
> **Owner**: Client Platform / UI System

Agent参与应用UI/UX整体事务的架构：用户目标、认知/内容/信息架构、
交互过程、视觉感知、能力供给与使用、平台与运行品质、证据与演进共同约束。
它通过原Product/EDX、UI Identity、Runtime、Quality和Development Workflow
协作，覆盖应用制作周期；本模块拥有公共UI与组合执行。

组件与组合的执行内核为 **Definition → Composition → Resolution**：
定义合法能力与槽位，声明实际使用关系，从只读状态与环境纯解析呈现。
继承按白名单、覆盖按声明轴、隔离按绘制/焦点/对象分别处理；
同一用途和目标只有一个表达Owner，委托不转移语义归属。
React/现有公共UI承担渲染和生命周期，EDX承担完整Surface校验和证据；
不新增渲染引擎、业务Store或镜像页面树。

应用制作和用户交互是不同生命周期。使用决策、Pattern生产与完整任务验证
连接上游体验合同和执行内核；组件合法不能独自证明使用合适或任务有效。
重点问题用来检验整体职责，不能限定总体覆盖范围。

已接受基线为UI-D01–UI-D04。整体设计UI-D05–UI-D10当前为
**draft/proposed，等待用户确认**；模块active不表示新提案已接受或实现。
本轮只设计架构，组件实现暂停。130目录与现有20基础样本是覆盖和研究输入，
不能替代组件设计、审阅、平台或产品效果证明。

## 项目范围与追踪

工作树为`peers-ui-system`，分支`feat/peers-ui-system-20261028`；
本目录是该工作树的设计源，`peers-touch/master/deliverables/`仅为交付副本。
用户最新视觉要求为克制、简约、柔和、互联网化，保持方圆并避免传统SaaS与
锐利感；旧风格样本需重新校准，尚未得到整体视觉认可。

[项目总账](./execution-plans/20261028-ui-system/project-scope.md)列出全部工作包、
产出、完成依据、现状、原Owner、依赖及旧UI-F01～UI-F07映射。
当前恢复记录为`.dev-workflow/tasks/uiux-project-scope-20261029/task.json`，
只追踪本轮范围整理；新范围尚未冻结为实施Plan，不能由总账推导开工或完成。

## 文档入口

- [整体职责、制作周期与组合规则](./design.md)
- [决策](./decisions.md)
- [核心对象形状、默认值与推导样例](./data-model.md)
- [模块布局](./module-layout.md)
- [集成](./integration.md)
- [组件 Gallery](./prototype/README.md)
- [自训练 UI/UX 方法论（六 tab、缺口先行、晋升门禁）](./prototype/self-training-methodology.md)
- [设计基础候选与 Agent 框架定位（已 superseded，历史来源）](./prototype/foundations.md)
- [验证入口与证据强度](../../../../../tooling/scripts/ui-system/README.md)
- [执行计划](./execution-plans/20261028-ui-system/plan.md)
- [全项目范围、现状与追踪](./execution-plans/20261028-ui-system/project-scope.md)
- [UI Identity](../../../../client/common/ui-identity/README.md)
