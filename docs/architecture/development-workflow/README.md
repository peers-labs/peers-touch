# Development Workflow Control Plane

> **Status**: accepted
> **Version**: v1.2
> **Created**: 2026-09-13 | **Updated**: 2026-09-17
> **Owner**: Platform Team

---

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
    该 Slice 对 completed/total 进度和后续解锁项的影响。

## 4. Document Navigation

| Document | Purpose |
|---|---|
| [design.md](./design.md) | 控制面边界、Plan Package、Task Slice 和恢复数据流 |
| [data-model.md](./data-model.md) | Plan、Task、Session、Checkpoint、Run 与状态机 schema |
| [decisions.md](./decisions.md) | DWF-D01..DWF-D16 关键决策 |
| [module-layout.md](./module-layout.md) | 文档、CLI、machine store 和 Skill 的文件职责 |
| [integration.md](./integration.md) | 与 Skill、Make、Local Dev、Acceptance、Quality 的映射 |
| [Progress-bearing workflow plan](./execution-plans/20260917-progress-bearing-development-loop/plan.md) | Anchor、Goal、profile policy 与环境看板的落地计划 |
| [Mobile Shell plan](../mobile/execution-plans/20260827-mobile-shell-implementation.md) | `DWF-B` 自举闭环与首个真实 Plan Package pilot |

## 5. Current Status

DWF-D01..DWF-D16 已接受，Plan Package pilot 正在由唯一 active Mobile Shell
计划的
`DWF-B` workstream 自举工具和最终迁移；不会创建第二个 active plan。
