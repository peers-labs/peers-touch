# 持续任务工作台（Task Workbench）

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-11-02
> **Owner**: Peers-Touch Agent Team
> **Plan**: [execution-plans/20261102-task-workbench/plan.md](../execution-plans/20261102-task-workbench/plan.md)（Plan ID `TW-20261102`）

## 定位

本目录是“持续任务工作台”的正式架构源：一个任务从目标、资料、执行、介入到成果、反馈、验证与重开，始终引用同一组身份与版本。它是现有 Modern Chat Agent / Agent 可用性深度建设的产品与架构演进，不新增 Home、第二任务页或第二套业务真源。

产品论点：**让一个 Agent 在可理解、可控制、可恢复的工作环境里，把任务持续推进到可阅读、可修改、可验证的结果。**

## 阅读顺序

1. [产品定义与范围](./product-definition.md)：用户、价值、18 项能力（C01–C18）、平台边界。
2. [体验合同](./experience-contract.md)：完整 Journey、交互与工艺要求。
3. [状态模型](./product-state-model.md)：任务、Turn、资源、连接与人的介入。
4. [工作台架构](./design.md)：系统关系、责任、执行模型、失败合同、禁止关系。
5. [任务、会话和成果合同](./data-model.md)：TaskRun ↔ canonical Conversation ↔ Turn、事件、成果版本与接受。
6. [复用、改造与删除](./integration.md)：既有建设去向、成组替换（R01–R07）与数据切换。
7. [模块归属](./module-layout.md)：Model、Station、Rust worker、Desktop 各层文件归属。
8. [关键决策](./decisions.md)：TW-D01–TW-D10 accepted 决策与被拒绝方案。
9. [验收矩阵](./acceptance-matrix.md)：操作实例、接收断言与真实验证要求。
10. [替换总账](./replacement-inventory.md)：旧入口、合同、调用方与同次删除。
11. [基准取舍](./benchmark-disposition.md) 与 [产品审查结论](./product-review.md)：外部机制取舍与终品审查记录。

## 外部 runtime 证据

[codex-source-review/](./codex-source-review/) 是外部双向 runtime（Codex app-server 等）的源码研究与接入证据门输入：start/resume、活动输入、审批、中断、epoch 身份、进程生命周期、文件/工具回读与缺口处理。它是设计输入，不是运行证明；适配器只在证据门通过后接入，Station 始终独占任务目标、队列、Memory 与准入。

## 原型证据

[prototype/](./prototype/) 与 [工作区交互提案](./workspace-experience-proposal.md) 记录已被 Owner 确认的交互合同。原型内的浏览器、终端、模型执行全部是模拟（fixture/simulation/localStorage），不构成生产能力或运行证据。

## 证据纪律

设计确认、原型交互验证、真实产品功能验证、正式验收是四件不同的事，不能互相替代。各切片的生产结果只按当前源码证据回填到执行计划的 outcome comparison；未跑即为 `UNPROVEN`。
