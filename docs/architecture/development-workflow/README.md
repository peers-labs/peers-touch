# Development Workflow Control Plane

> **Status**: accepted
> **Created**: 2026-09-13 | **Updated**: 2026-09-21
> **Owner**: Platform Team

---

This module is the control-plane implementation contract. The single human
operating standard is [docs/global/workflow.md](../../global/workflow.md);
documents here define ownership, schemas, decisions, and integration details
without creating another procedure.

## 1. Document Scope

本文档集定义 Peers Touch 非平凡开发任务从需求进入到关闭的工作流控制面：

- 以用户 Journey 或等价功能边界为开发闭环。
- 从资源声明、实现、聚焦检查、checkpoint、部署到功能验证的状态机。
- Development、Local Dev、Acceptance 和 Quality 的所有权边界。
- 所有 worktree 可见的机器级资源声明。
- compact Plan Package、独立 Task Slice 和跨会话恢复协议。
- checkpoint、部署、reset、push 和 branch rewrite 的授权模型。
- 低噪声状态汇报和仓库外瞬态诊断记录。

本文档集不定义：

- 产品能力、用户体验和 Journey 的产品语义；由产品文档和领域契约定义。
- Profile、slot、Station capability lease 和机器运行资源；由
  [Local Dev Control Plane](../local-dev-control-plane/README.md) 定义。
- 正式产品证明及 Evidence Store；由
  [Acceptance Framework](../acceptance-framework/README.md) 定义。
- PR 质量证据和最终合并判断；由
  [Quality Framework](../quality-framework/README.md) 定义。

## 2. Verified Problem

外层流程已经定义：

```text
PRODUCT -> DESIGN -> PLAN -> EXECUTE -> DELIVER
```

但当前恢复链路仍存在两个已验证问题：

1. `EXECUTE` 缺少强制的产品优先状态机，source/static 结果可能被误读为
   用户功能已经可用。
2. 单文件执行计划同时承载稳定范围、完整 DAG、当前状态和逐次运行叙事。
   Mobile Shell 计划已增长到 4,000 行以上；恢复需要重新读取与过滤大量历史内容。

这两个问题互相放大：状态没有机器 Owner 时，人会把运行日志写回计划；计划越长，
状态恢复越依赖聊天和人工解释。

## 3. Design Goals

1. 用户 Journey 是产品开发进度的最小可交付单位。
2. 源码闭环以 `SOURCE_READY` 如实结束；运行时闭环通过 exact-source
   `FUNCTIONAL_PASS` 后再进入完整 Acceptance。
3. 一次失败只产生一个首要失败点，不触发无界 Gate 扩散。
4. Plan manifest 保持稳定、紧凑且可机械验证。
5. 每个 Task Slice 独立可恢复，只包含当前闭环和 durable evidence 引用。
6. Dev Session 拥有瞬态状态、attempt 和 first failure，不回写运行日记。
7. Context Anchor 只投影 active pointer、manifest、current task 和 session。
8. 所有状态和结论绑定 source、workspace、task/Journey 和 runtime identity。
9. 先用当前 Mobile Shell 计划完成真实迁移，再推广到其他 active plan。
10. Context Anchor 的续作单位是可关闭一个 Task 的 Progress Slice，并明确
    该 Slice 完成后的精确 completed/total、目标百分比和后续解锁项。
11. 一次用户授权启动一个连续 Plan Run；Goal Slice 保持单 Task 边界，但
    Task 关闭、内部 review 和 Context Anchor 不再把控制权反复交回用户。
12. Agent 默认调用项目 Review Skills 自审、自修和重审；只有破坏性操作、
    外部授权或接受源无法裁决的语义选择才升级给用户。
13. 调度、运行验证、Session 和 evidence 语义保持宿主无关；TRAE、Cursor、
    Codex 只通过可选 Host Adapter 提供已暴露的工具 transport。
14. `peers-dev-workflow` 只拥有规范实现和下发；每个消费 worktree 独立
    派生并写入自己的 machine-local 运行状态。
15. 内部 Development Workflow 不发布 `vN`；Plan、Task、Acceptance
    Execution 和 rollout receipt 只有一个当前严格格式。
16. 用户或 accepted Plan 已明确授权的操作在 Plan Run 内直接执行；只有
    超出授权包或实际外部权限失败才提出权限问题。
17. Context Anchor 的耗时观测只从已有 bounded Session journal 临时聚合；
    不新增 Metrics 状态、写入工具或 Agent 调用。
18. 个人交互习惯通过 machine-local Overlay 选择性叠加；共享 `pt-ew` 与
    canonical Skill rollout 不携带任何用户专属策略。

## 4. Document Navigation

| Document | Purpose |
|---|---|
| [design.md](./design.md) | 控制面边界、Plan Package、Task Slice 和恢复数据流 |
| [data-model.md](./data-model.md) | Plan、Task、Session、Checkpoint、Run 与状态机 schema |
| [decisions.md](./decisions.md) | DWF-D01..DWF-D27 关键决策 |
| [module-layout.md](./module-layout.md) | 文档、CLI、machine store 和 Skill 的文件职责 |
| [integration.md](./integration.md) | 与 Skill、Make、Local Dev、Acceptance、Quality 的映射 |
| [host-neutral-skill-rollout.md](./host-neutral-skill-rollout.md) | DWF-D21/DWF-D22 按 worktree 语义集成、审计与宿主 catalog 投影 |
| [Progress-bearing workflow plan](./execution-plans/20260917-progress-bearing-development-loop/plan.md) | Anchor、Goal、profile policy 与环境看板的落地计划 |
| [Immutable workspace Plan binding](./execution-plans/20260918-immutable-workspace-plan-binding/plan.md) | 多 Plan 同仓库下的 workspace 单一不可换绑 hard cut |
| [Trusted autonomous development](./execution-plans/20260920-trusted-autonomous-development/plan.md) | Task closure 真值、统一状态快照、自动续跑与 Acceptance 准入 hard cut |
| [Mobile Shell plan](../mobile/execution-plans/20260827-mobile-shell-implementation.md) | `DWF-B` 自举闭环与首个真实 Plan Package pilot |

## 5. Current Status

DWF-D01..DWF-D27 已接受。仓库与 PR 可包含多个 active Plan Package，但每个
workspace 只解析机器级不可变绑定指向的一个 Plan；同步进入分支的外来 Plan 不
参与本 workspace 的发现。Plan Package 只保留 immutable initial HEAD；当前
source HEAD 由 Git、Development declaration、Session checkpoint 与
消费 worktree 的 machine-local active-work projection 在各自生命周期中持有。
`peers-dev-workflow` 只负责规范实现和 rollout，不持有消费 worktree 的可变
运行时状态。Plan Package pilot 正在由唯一 active
Mobile Shell 计划的
`DWF-B` workstream 自举工具和最终迁移；该 pilot workspace 不会绑定第二个
Plan。
一次授权可在 accepted Plan 内连续跨越多个 Task 和 agent review gate；
精确用户授权和 Plan `authorization` 字段在这些内部边界后仍然有效，不能因
操作类别敏感而重复询问；
调度和 runtime verification 由项目 Owner 定义，TRAE、Cursor、Codex 仅为
可替换 transport。流程源码从本仓下发，但消费 worktree 的可变状态始终留在
各自 workspace machine root。`pt-ew` 仅作为 Overlay host；用户专属行为由
独立的 machine-local registry 和 digest-addressed installed copy 管理，未安装
Overlay 的用户保持原始 `pt-god-view` 行为。
