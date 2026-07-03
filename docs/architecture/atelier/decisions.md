# Atelier × Peers Agent Collaboration — 设计决策

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-20 | **Updated**: 2026-06-20
> **Owner**: Peers-Touch Agent Team

---

> **Boundary update (2026-07-02)**: 本文的 Decision 仍有效的是“决策与执行分离、证据化共识、预算/权限门禁、可恢复”等原则；其中 “Atelier Core” 是早期命名。当前落地中，确定性事务、Provider/Gate/Artifact、Trace/Resume 属于 Station / Agent orchestration，Atelier applet 只负责展示 projection 并通过 Host capability 回写用户选择。

## 决策索引

| ID | 决策 | 状态 |
|----|------|------|
| D-01 | 以「可验收性分级」作为自动化总开关，而非 coding/非 coding 二分 | accepted |
| D-02 | 决策与执行分离：Collaboration 出 Decision，Core 落状态 | accepted |
| D-03 | 共识 = 终裁者签字 + 无未决反对（带证据），而非多数投票 | accepted |
| D-04 | 预算熔断为一等中枢，与状态机平级 | accepted |
| D-05 | Provider 分领域子类型，不预设通用接口；ActionProvider 单列 | accepted |
| D-06 | 默认引擎用 Expert Hierarchy，并显式定义权力结构 | accepted |
| D-07 | 落地按 verifiability level 从 L0 向 L2 铺开，两层抽象暂不拆 | accepted |
| D-08 | 补充 Replan 与 Resume 机制；新增 Integrator/Historian 角色 | accepted |
| D-09 | Memory 两阶段：默认只存 candidate，用户确认才入长期记忆 | accepted |

---

## D-01: 以「可验收性分级」作为自动化总开关

**Status**: accepted
**Date**: 2026-06-20

### Context

原设计按 coding / 非 coding 区分工作流。但「自动化推进到完成」的真正瓶颈不在 Executor 能否干活，而在 Verifier 能否客观判定「完成」。coding 有 test/build 二值信号；研究/选股/内容的验收标准本身模糊、主观、甚至无 ground truth。

### Decision

引入 `VerifiabilityLevel`（L0 二值 / L1 规则 / L2 主观），每个 Task/Acceptance 在生成时打级。自动化深度 per-task 由 level 决定：L0/L1 自动验收，L2 强制人工签字。

### Rationale

把「能否自动化」从模糊的领域判断变成可操作的、per-task 的工程属性。「减少 human-in-loop」= 最大化 L0/L1 占比，而非强行自动化 L2（那只会产出无法验收的假完成）。

### Alternatives Considered

- 按 coding/非 coding 二分：无法解释「同一项目内既有自动可验收任务也有主观任务」，且把研究类全部当不可自动，过于粗糙。
- 全局 human-in-loop 开关：要么过度打扰，要么放任不可验收任务自动「完成」。

### Consequences

- 正面：自动化边界清晰、可度量；L2 任务有明确人工汇聚点。
- 负面：需要为每个 Acceptance/Gate 正确打级，打级错误会导致假自动或过度打扰。

---

## D-02: 决策与执行分离

**Status**: accepted
**Date**: 2026-06-20

### Context

多数 multi-agent 系统把状态管理塞进 LLM 上下文，导致状态漂移、不可重放、不可审计。

### Decision

Peers Agent Collaboration 只产出 `Decision`；Atelier Core 消费 Decision，通过确定性状态机事务改 Project/Milestone/Task/Run 状态。Agent 永不直接写状态。

### Rationale

把主观判断与事务落地解耦，保证可追踪、可重放、可恢复（不变量 1/2/6）。

### Alternatives Considered

- Agent 直接操作状态：实现快，但不可控、不可审计。

### Consequences

- 正面：状态可信、可重放。
- 负面：需要维护 Decision → 状态转移的映射层，增加一次间接。

---

## D-03: 共识 = 终裁者签字 + 无未决反对（带证据）

**Status**: accepted
**Date**: 2026-06-20

### Context

多 LLM 角色协作极易出现「互相附和」（虚假共识）或「反复拉锯不收敛」。原设计列了 Goal Owner / Verifier / Debate Judge 等会判断的角色，但没定义共识如何达成与收敛。

### Decision

定义 CollaborationSession 收敛语义：`reached ⟺ authority_signoff == true AND 无带证据的未决反对`。赞成票须附 evidence_ref 才计入；无证据反对降级为「疑虑」不阻断；Verifier 与 Executor 不得同模型实例承担。`max_rounds` 触顶强制 escalate。

### Rationale

把「共识」从不可控的投票变成有终裁权威 + 证据约束 + 迭代预算的可收敛过程，根治附和与死循环。

### Alternatives Considered

- 多数投票：易退化为同源附和。
- 无上限辩论：不收敛，烧 token。

### Consequences

- 正面：协作可收敛、可终止、抗附和。
- 负面：终裁者角色质量成为单点；需要可靠的 evidence 引用机制。

---

## D-04: 预算熔断为一等中枢

**Status**: accepted
**Date**: 2026-06-20

### Context

原设计仅把「成本超上限」作为 escalation 的一个分支。Swarm 等并行引擎在无预算闸时会成本爆炸。

### Decision

引入全局 `Budget`（token/money/wall_clock/max_fix_loops/max_collab_rounds/max_parallel_runs），与状态机平级。每个 Run/Round 预扣结算，触顶即熔断升级并落盘快照。

### Rationale

成本失控是长任务自动化最现实的风险，必须 day-1 就有硬闸而非事后补。

### Consequences

- 正面：成本可控，失控可恢复（配合 Resume）。
- 负面：预算切片粒度需要调参，过紧会频繁打扰。

---

## D-05: Provider 分领域子类型，不预设通用接口

**Status**: accepted
**Date**: 2026-06-20

### Context

coding CLI 的共性是「指令→diff/log→二值校验」；研究/交易/数据的产物形态、副作用、可逆性根本不同构。用同一抽象套全部会导致抽象泄漏。

### Decision

顶层 `Provider` 只保留最小共性（capabilities/execute/cancel，无状态写）。领域差异下沉为 `CodingProvider`/`DataProvider`/`ActionProvider` 等子类型。ActionProvider（不可逆、带钱/带权）单列，强制绑定 Risk 硬否决 + 人工确认 + 回滚预案。通用层等 ≥2 个子类型后归纳。

### Rationale

抽象应被归纳出来，而非预设。过早通用 = 过早错的抽象。把高危动作单列以绑死安全闸。

### Alternatives Considered

- 预设 universal Provider：抽象泄漏，难以演进。

### Consequences

- 正面：每个领域接口贴合实际；高危动作安全。
- 负面：阶段 5 需要一次归纳重构（已在路线中规划）。

---

## D-06: 默认引擎 Expert Hierarchy，并显式定义权力结构

**Status**: accepted
**Date**: 2026-06-20

### Context

长流程任务需要强秩序（Hierarchy）+ 能力互补（Expert）。但只列角色不定义否决权与上报关系，「层级」名不副实。

### Decision

默认引擎为 Expert Hierarchy。显式定义权力结构：Goal Owner 唯一 final 签字权；Risk&Policy 对高危动作有不可被覆盖的硬否决 + 强制升级；Verifier 验收否决须带证据；Supervisor 只管推进无内容否决权；Executor 零判断权。引擎可按阶段切换（目标共识用 Roundtable，架构争议用 Debate，同构并行用 Swarm）。

### Rationale

权力结构是层级组织价值所在；可切换引擎兼顾不同协作形态。

### Consequences

- 正面：协作有明确权威与安全优先级。
- 负面：7+2 角色对早期阶段偏重，阶段 1 可由少数模型实例分饰多视角（见 D-07）。

---

## D-07: 落地按 L0→L2 铺开，两层抽象暂不拆

**Status**: accepted
**Date**: 2026-06-20

### Context

用户要求长期落地蓝图而非砍功能的 MVP。同时演进「通用协作底座」与「Atelier 业务层」会产生双向未定接口，反复重构。

### Decision

落地顺序按 verifiability level 从 L0 向 L2 推进（见 design §9），每阶段都是端到端可用的完整系统。阶段 1-4 协作逻辑直接长在 Atelier 内，**不拆** Peers Agent Collaboration 独立底座；阶段 5 在有第二个真实消费方时再抽离，并归纳通用 Provider 接口。

### Rationale

「先把所有不变量在最易验收的领域全部落地」≠「砍功能」。通用底座应被第二个使用者逼出，而非提前规划，避免双向未定接口反复推倒。

### Alternatives Considered

- 框架先行（先搭通用底座 + 全引擎 + 全角色）：大量未验证接口契约，易先花数月搭一个跑不起来的框架。

### Consequences

- 正面：每阶段可用、风险可控、抽象由实践归纳。
- 负面：阶段 5 有一次明确的抽离/归纳重构成本（可接受，已规划）。

---

## D-08: 补充 Replan 与 Resume；新增 Integrator/Historian

**Status**: accepted
**Date**: 2026-06-20

### Context

原六大机制缺两个长任务必备件：里程碑假设会过时（需重规划）、长任务一定会中断（需断点恢复）。并行子任务产出会互相冲突，经验沉淀需有人执行。

### Decision

新增 Replan 机制（偏离/多次 reject/架构漂移触发，产新 Task Graph diff，Goal Owner 签字后原子替换）与 Resume 语义（从最近 accepted milestone 恢复，已 accepted 产物复用）。新增 Integrator（合并并行产物、消解冲突）与 Historian（持续产 memory candidate）两个角色。

### Rationale

补齐长任务「可重规划、可恢复、可一致合并、可沉淀」的闭环。

### Consequences

- 正面：长任务真正可持续推进与恢复。
- 负面：状态机增加 replanning 态与恢复锚点管理复杂度。

---

## D-09: Memory 两阶段，默认只存 candidate

**Status**: accepted
**Date**: 2026-06-20

### Context

多数 agent 系统自动写记忆 → 污染 → 错误自我强化。

### Decision

Memory 分 candidate → confirmed 两阶段。默认只生成 candidate，由用户确认才写入长期记忆，按 scope（user/project/domain）落到对应记忆层。失败原因类记忆反哺 Planner/Risk。

### Rationale

防止记忆污染与错误自强化，同时保留经验沉淀能力。

### Consequences

- 正面：长期记忆质量可控。
- 负面：需要用户确认动作；可设计批量确认降低打扰。
