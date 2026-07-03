# Atelier × Peers Agent Collaboration

> **Status**: draft
> **Version**: v0.2
> **Created**: 2026-06-20 | **Updated**: 2026-07-02
> **Owner**: Peers-Touch Agent Team
> **Module**: 待落地（规划路径见 design.md §9）

---

## 1. Document Scope

本文档集定义：

- Atelier 作为「个人 Agent 工作台」的定位、边界与设计目标
- Atelier Applet / UI Projection / Runtime Bridge 的交互形态
- Atelier 如何呈现 Station / Agent orchestration 产出的任务、协商、决策、Artifact、Gate 和上下文
- 从用户视角出发的个人工作台体验、可验收性表达和 human-in-loop 触点
- Atelier 与 Desktop Host、Applet SDK、Station subserver、Agent orchestration 的职责边界

本文档集不定义：

- 通用 Agent 编排引擎、Provider 调度、共识收敛、checkpoint、trace、gate 执行、artifact 生产等后端真源机制；这些属于 `architecture/agent/` 与 Station subserver
- Desktop / Station 平台内部的具体落地写法，见 `client/`、`station/`
- 现有 Agent 自成长 / Memory / Skill 架构，见 `architecture/agent/`
- A2A 协议细节，见 `architecture/agent/a2a/`
- 具体编码规范，见 `global/coding-guide/`

---

## 2. 背景与问题

Atelier 最初是为 peers-touch 自我增强而设计：接入 Trae、Cursor、Codex、Claude Code 等 coding agent CLI，让系统能创建任务、写代码、验证、修复、review、沉淀经验。

随后定位被抽象为更通用的「个人 Agent 工作台」，不仅服务 coding/self-enhancement，也要承载研究、选股、交易分析、内容生产、数据分析、运营自动化等复杂个人任务工程。

核心问题：**单 Agent + 一次 prompt 无法自动完成大项目**。大项目需要被当作可拆解、可监督、可验收、可恢复的工程系统来推进，而不是依赖单个 Agent 的智力。

关键洞察：**「自动化推进到完成」的上限不由 Agent 智力决定，而由「完成」是否可被廉价、客观、二值地验证决定。** 因此本设计以「可验收性分级（Verifiability Level）」为自动化总开关，而非按 coding/非 coding 二分。

当前落地边界：Atelier 不自建多 Agent 编排引擎。Atelier 是 peers-touch Desktop 中的 applet/workbench，消费 Station subserver 投影出的 workspace snapshot 和 projection event；Agent orchestration 才是任务执行、Provider 调度、决策恢复、Artifact/Gate 生产和持久化真源。

---

## 3. 设计目标

1. Atelier 是个人 Agent 工作台，承载跨场景复杂任务工程，而非 IDE 延伸或单一 coding agent。
2. Coding/self-enhancement 是第一条落地工作流，不是底层边界。
3. 通过展示 Agent orchestration 产出的协作、共识、任务拆解、执行监督、质量验收和记忆沉淀，**减少而非取消** human-in-loop。
4. 大项目通过 Project Contract、Milestone Tree、Task Graph、Supervisor Loop、Verification Consensus、Escalation Guard 等机制持续推进；这些机制由 Station / Agent orchestration 落地，Atelier 负责投影、交互和人工决策回写。
5. 决策与执行分离：协作层产出判断，Station 做确定性事务落地，Atelier 只通过声明式 capability 回写用户选择。
6. 一切副作用经 Station / Provider / Core 落账；Atelier 不绕过真源直接改 orchestration 状态。

---

## 4. 文档导航

| 文档 | 说明 |
|------|------|
| [execution-plans/user-view.md](./execution-plans/user-view.md) | **从这里开始读**：用户视角 7 个功能块 → 每块怎么做 → 底座怎么撑 |
| [execution-plans/functional-modules.md](./execution-plans/functional-modules.md) | **功能模块清单**：从用户工作台视角列出能力；其中多 Agent 协商能力应映射到 Station / Agent orchestration，不在 Atelier applet 内自建 |
| [design.md](./design.md) | 架构设计草案：包含早期协作引擎设想；阅读时必须套用本文的最新边界，后端编排真源归 Station / Agent orchestration |
| [data-model.md](./data-model.md) | 数据契约（字段级 schema）、状态机图、完成条件谓词 |
| [decisions.md](./decisions.md) | 关键设计决策（ADR-lite）与评审结论 |
| [execution-plans/roadmap.md](./execution-plans/roadmap.md) | **积木式落地路线**：每块积木「搭完什么样、怎么算搭完」+ 阶段检查点 |
| [execution-plans/feature-matrix.md](./execution-plans/feature-matrix.md) | **功能点对齐矩阵**：48 个功能点 ↔ 三份文档逐一对齐 + 缺口清单 |
| [execution-plans/ui-implementation-mapping.md](./execution-plans/ui-implementation-mapping.md) | **UI/UX ↔ 底层实现映射**：从可运行原型每个控件反推到机制 / 数据契约 / 状态机 / Provider，逐元素映射表 + 关键交互时序 + UI 暴露的新缺口（GAP-UI） |
| [execution-plans/multi-engine-feasibility.md](./execution-plans/multi-engine-feasibility.md) | **多引擎可落地性论证**：把每个引擎机制锚定到 Station 真实 Go 代码（turn_service / delegation_service），逐条标清复用 / 缺口 / 第一批范围；诚实区分原型能证明与证明不了的 |

---

## 5. 核心结论

- 方向成立：把大项目当工程系统（分解 + 监督 + 验收 + 恢复），而非赌单 Agent 智力。
- 自动化深度按 per-task `verifiability_level`（L0/L1/L2）决定，不是全局开关。
- 真正难的三件事——**共识收敛、验收可判定、成本熔断**——必须落为显式机制，不能靠角色名堆叠掩盖。
- 落地按 verifiability level 从 L0 向 L2 推进，每个阶段都必须由 Station / Agent orchestration 提供可验证真源，再由 Atelier 做 projection 呈现，而非在 applet 内堆一套平行状态机。
