# Development Workflow Control Plane

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-13 | **Updated**: 2026-09-13
> **Owner**: Platform Team

---

## 1. Document Scope

本文档集定义 Peers Touch 非平凡开发任务从需求进入到关闭的工作流控制面，并重点
补齐 `EXECUTE` 阶段内部的产品优先循环：

- 以用户 Journey 为单位的开发闭环。
- 从复现、实现、聚焦检查、checkpoint、部署到 Native 功能验证的状态机。
- Development、Acceptance、Quality、Local Dev Control Plane 之间的所有权边界。
- 从首次写入前开始，向所有 worktree 发布并确认资源声明的机器级公共账本。
- checkpoint commit、部署、reset、push 和 branch rewrite 的授权模型。
- 开发期验证结果、失败分类、预算、失效和晋级规则。
- 低噪声的状态汇报与仓库外临时诊断记录。

本文档集不定义：

- 产品能力、用户体验和 Journey 的产品语义；它们由产品文档和领域契约定义。
- Profile、slot、Station capability lease 和机器运行资源；它们由
  [Local Dev Control Plane](../local-dev-control-plane/README.md) 定义。
- 正式产品证明及 Evidence Store；它们由
  [Acceptance Framework](../acceptance-framework/README.md) 定义。
- PR 质量证据和最终合并判断；它们由
  [Quality Framework](../quality-framework/README.md) 定义。
- 具体实施阶段；架构接受后再创建 execution plan。

## 2. Verified Problem

当前外层流程已经定义：

```text
PRODUCT -> DESIGN -> PLAN -> EXECUTE -> DELIVER
```

但 `EXECUTE` 内没有强制的产品优先状态机。已验证的结果包括：

- 实现、Acceptance 注入、全量 Gate 和文档更新可以在同一长循环中反复交错。
- static、typecheck 或 Harness 结果可能被误读为用户功能已可用。
- 远端 `make station` 只部署 Git HEAD，未提交源码无法进入 exact-source 运行时。
- 长计划吸收逐次运行日志后，恢复上下文和识别首个失败点的成本持续增长。
- 同一 source 状态可以重复生成大量 Acceptance 记录，而用户关键 Journey 仍未通过。

## 3. Design Goals

1. 用户 Journey 是开发进度的最小可交付单位。
2. 产品变更先通过 exact-source 功能闭环，再进入完整 Acceptance。
3. 开发诊断与正式 Acceptance 证明使用不同执行策略和存储语义。
4. 一次失败只产生一个首要失败点，不触发无界 Gate 扩散。
5. checkpoint、部署和 destructive action 使用任务级显式授权，不逐命令反复询问。
6. 仓库只保留当前状态和 durable decision，不追加运行日志。
7. 所有状态和结论都绑定 source、workspace、Journey 和 runtime identity。
8. 所有 worktree 在编辑或占用运行资源前都能发现冲突。
9. 通过一个 Chat pilot 验证流程，再决定是否推广到所有 Domain。

## 4. Document Navigation

| Document | Purpose |
|---|---|
| [design.md](./design.md) | 控制面边界、组件关系、双循环和运行语义 |
| [data-model.md](./data-model.md) | Work Item、Journey、Session、Checkpoint、Run 与状态机 |
| [decisions.md](./decisions.md) | 关键设计决策、替代方案和后果 |
| [integration.md](./integration.md) | 与现有技能、Make、Local Dev、Acceptance 和 Quality 的映射 |
| [execution plan](./execution-plans/20260913-development-workflow-control-plane.md) | 公共账本、Skill 切换和治理收口计划 |

## 5. Current Status

本架构已由 Owner 接受。实现状态与运行证据由本模块 execution plan 追踪；
文档生效不代表 `work.json`、Dev Runner 或 Skill 改造已经落地。
