# Development Workflow Control Plane

> **Status**: active
> **Created**: 2026-09-13 | **Updated**: 2026-10-04
> **Owner**: Platform Team

---

## 1. Document Scope

本文档集定义 Peers Touch 非平凡开发任务从需求进入到关闭的工作流控制面：

- 以用户 Journey 或等价功能边界为开发闭环。
- 从资源声明、实现、聚焦检查、checkpoint、部署到功能验证的状态机。
- Development、Local Dev、Acceptance 和 Quality 的所有权边界。
- 所有 worktree 可见的机器级资源声明。
- 跨模块 `ModuleImpact` 聚合、target 依赖、峰值容量和资源复用计划。
- compact Plan Package、独立 Task Slice 和跨会话恢复协议。
- checkpoint、部署、reset、push 和 branch rewrite 的授权模型。
- 低噪声状态汇报和仓库外瞬态诊断记录。
- 顶层开发会话与内部 worker/reviewer 会话的 binding lineage、liveness 和
  completion claim 边界。

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

当前 binding 路径有三个已验证问题：

1. 宿主字段被跨 host 等价归一，TRAE 内部 reviewer、retry 或 subtask 的
   `session_id` 会创建新的顶层 owner binding。
2. Binding schema 没有 role、root/parent lineage 或 child lifecycle；没有
   release receipt 的历史记录会永久被视为 active。
3. Completion Review 在近期 Action Receipt 解析失败后枚举整个 worktree 并
   强制全局唯一，使过期 child 历史阻断当前 reviewer。

这三个问题共同把执行历史误当成实时授权状态。目标设计必须把一个可见开发会话
固定为唯一 OWNER，并让 child identity、liveness 和 completion claim 全部显式、
可校验。

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
17. 个人交互习惯通过 machine-local Overlay 选择性叠加；共享 `pt-ew` 与
    canonical Skill rollout 不携带任何用户专属策略。
18. 每个 IDE conversation 在首次可阻断 `PreToolUse` 时原子绑定一个不可变
    `executionRoot`；工具目标作为独立 `subjectRoot` 校验，跨 worktree 只读
    允许、写入拒绝。
19. Workflow Snapshot 是 CLI、Context Anchor、Doctor 与 Peers Dev 的统一
    只读投影；Action Receipt 只描述活动，不替代 Task 进度。
20. Task 和 Plan 完成必须有独立、当前源码绑定的 Completion Review。
21. completed 且已释放的 workspace 通过显式 generation advance 承接下一
    Plan；Agent 不得把新建 worktree 当作绕过绑定的手段。
22. 模块 Skill 只输出影响与逻辑需求；Dev Workflow 在 runtime acquisition
    前形成唯一 `PlanResourcePlan`，具体资源生命周期仍由既有 Runtime/Suite
    Owner 管理。
23. 一个可见开发会话只有一个 OWNER binding；WORKER/REVIEWER 必须由
    assignment 创建 child binding，并以 lease/terminal receipt 管理生命周期。
    状态和完成声明只能消费当前事件的 `BindingProjection`，不能枚举同
    worktree 的历史 binding 猜 owner。
24. 普通 Agent integration 投影只消费精确 OWNER grant 和短期机器锁，不要求
    无关 worktree idle；机器级 legacy store hard cut 与 retired projection GC
    使用独立命令、独立 grant，并且只有这两类破坏性清理要求全局 idle。

## 4. Document Navigation

| Document | Purpose |
|---|---|
| [design.md](./design.md) | 控制面边界、Plan Package、Task Slice 和恢复数据流 |
| [data-model.md](./data-model.md) | Plan、Task、Session、Checkpoint、Run 与状态机 schema |
| [decisions.md](./decisions.md) | DWF-D01..DWF-D34 关键决策 |
| [module-layout.md](./module-layout.md) | 文档、CLI、machine store 和 Skill 的文件职责 |
| [integration.md](./integration.md) | 与 Skill、Make、Local Dev、Acceptance、Quality 的映射 |
| [host-neutral-agent-integration.md](./host-neutral-agent-integration.md) | DWF-D21/DWF-D22/DWF-D33 的 Kernel、宿主投影和 rollout 流程 |
| [product-definition.md](./product-definition.md) | Peers Dev 产品能力、用户和 Journey |
| [experience-contract.md](./experience-contract.md) | Peers Dev 可见状态与交互合同 |
| [product-state-model.md](./product-state-model.md) | Stage、Plan、Task、Review 与 Agent activity 状态 |
| [acceptance-matrix.md](./acceptance-matrix.md) | Peers Dev 产品验收映射 |
| [completion-review.md](./completion-review.md) | 独立 Completion Review 合同 |
| [progress-observability.md](./progress-observability.md) | Snapshot、Action Receipt 与 UI 投影边界 |
| [Progress-bearing workflow plan](./execution-plans/20260917-progress-bearing-development-loop/plan.md) | Anchor、Goal、profile policy 与环境看板的落地计划 |
| [Immutable workspace Plan binding](./execution-plans/20260918-immutable-workspace-plan-binding/plan.md) | 多 Plan 同仓库下的 workspace 单一不可换绑 hard cut |
| [Mobile Shell plan](../mobile/execution-plans/20260827-mobile-shell-implementation.md) | `DWF-B` 自举闭环与首个真实 Plan Package pilot |

## 5. Current Status

DWF-D01..DWF-D34 已接受。仓库与 PR 可包含多个 active Plan Package，但每个
workspace 只解析机器级当前 generation 指向的一个 Plan；同步进入分支的外来
Plan 不参与本 workspace 的发现。completed 且 quiescent 的 generation 可由
显式 owner command 原子推进，不能由 repository discovery 或 Agent 新建
worktree 代替。Plan Package 只保留 immutable initial HEAD；当前
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
