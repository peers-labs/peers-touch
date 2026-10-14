# Peers-Touch 开发工作流

> **Status**: active
> **Created**: 2026-09-13 | **Updated**: 2026-10-14
> **Owner**: Platform Team

## 从哪里开始

了解一个需求如何从北极星目标进入接单并推进到交付，请阅读
[规范研发流程](../../../global/workflow.md)。北极星位于所有步骤上游，流程状态不能
替代最终结果；该文档是唯一的研发操作正文，按实际工作顺序说明目标、职责、
确认事项和完成条件。

本目录说明项目如何用工具支持这些规矩，包括计划执行、工作记录、运行验证、评审和收尾。工具的内部名称、记录字段和状态协议不另构成一套研发流程。

流程正文和本目录设计已按 DWF-D42 落地。普通工作不再依赖强制登记、OWNER
回执、PlanMount 或状态对账；真实副作用仍由对应运行入口检查权限、目标、源码身份
和资源锁。

## 本目录负责什么

- 将已确定的需求、方案和执行安排接到对应方法论与项目工具。
- 在选定 worktree 内保存修改范围、任务进度和恢复所需信息。
- 关联本次源码、运行结果和评审证据，避免使用过期结果宣称完成。
- 协调需要的运行资源，并在结束、取消或中断后处理本次工作。
- 提供工作状态和故障检查，区分实现进度、环境状态与验收结论。

产品行为由各业务领域的产品文档决定，编码细则由[编码规范](../../../global/coding-standards.md)和 [coding-guide](../../../global/coding-guide/)决定。本文不替代它们。

## 与其他工程文档的关系

运行环境是研发过程的一部分。这里说明任务何时需要环境、需要验证什么，以及如何交付；[local-dev](../local-dev/README.md)说明 Profile、端口、进程、部署和重置资源的具体管理方式。

两者服务同一次研发工作，职责与生命周期不同：纯代码任务可以不启动环境，运行中的服务也可能在多个任务之间复用。worktree 隔离源码，不能单独保证共享 Station、数据库或设备互不干扰。

[Acceptance](../acceptance/README.md)说明正式功能证据如何产生和保存；[Quality](../quality/README.md)说明审查如何使用代码、规范和证据作出结论。检查通过不能代替实际功能验证，评审通过不能代替合并或发布授权。

## 文档导航

先读规范、设计与计划即可理解目标，其他文件按问题查阅。旧决策记录保留历史内容，
其当前状态由 DWF-D42 统一替代。

- [规范研发流程](../../../global/workflow.md)：需求从接单到交付的工作顺序与要求。
- [重构设计](./design.md)：职责划分、失败边界及保留保护。
- [冻结实施计划](./execution-plans/20261013-development-flow-rebuild-accepted/plan.md)：
  实施范围、验证和授权边界。
- [产品定义](./product-definition.md)：开发者应得到的结果。
- [操作合同](./experience-contract.md)：普通修改、恢复、安装、运行、验证和收尾。
- [数据约定](./data-model.md)：可选任务与操作记录、证据和恢复。
- [设计决定](./decisions.md)：已接受 DWF-D42 及被替代的历史决定。
- [模块调整](./module-layout.md)：当前模块职责与已删除路径。
- [接入与切换](./integration.md)：Skill、Make、Runtime 和 Acceptance 消费者。
- [IDE 接入](./host-neutral-agent-integration.md)：事件、提示和选定范围安装。
- [完成审查](./completion-review.md)：明确范围与当前证据的审查。
- [状态模型](./product-state-model.md)与[只读呈现](./progress-observability.md)：状态
  含义、事实来源及未知项。
- [验收清单](./acceptance-matrix.md)：工具场景与可选现场 smoke 的证明边界。
- [其他实施计划](./execution-plans/)：历史计划不自动参与当前选择。
