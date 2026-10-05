# Atelier × Peers Agent Collaboration — 架构设计

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-20 | **Updated**: 2026-06-20
> **Owner**: Peers-Touch Agent Team

---

> **Boundary update (2026-07-02)**: 本文保留早期 Atelier 机制设计语言（如 Atelier Core、Workflow、Provider/Gate/Artifact）。当前 peers-touch 落地边界已调整为：Atelier 是 Desktop applet / personal workbench / projection surface；多 Agent 编排、Provider 调度、Gate 执行、Artifact 生产、Trace/Checkpoint/Resume 和事务性状态落地属于 Station subserver 与 `architecture/domains/agent/`。阅读本文时，应把 “Atelier Core / Workflow” 理解为后端 orchestration 能力在 Atelier 工作台中的投影需求，而不是 applet 内自建引擎。

## 1. 核心原则（不可妥协的不变量）

整个系统所有模块、所有演进阶段都必须满足。设计冲突时以不变量优先。

1. **决策与执行分离** — LLM/Agent 只产出「判断与提案」，状态变更只能由 Atelier Core 状态机事务执行。Agent 永远不能直接写 Task/Run/Project 状态。
2. **副作用先经 Provider，再经 Core 落账** — Provider 产出标准化结果，Core 决定是否改状态、写 Artifact。Provider 无状态写权限。
3. **完成必须可被状态谓词判定** — 任何「完成/通过/验收」都必须翻译成 Core 可查询的布尔表达式，不接受纯 LLM 口头声明。
4. **每个判断必须带证据引用（evidence_ref）** — 同意/反对/验收/风险标记都必须指向具体 Artifact 或 Trace。无证据的判断不进入共识计票。
5. **预算与权限是全局闸，不是分支** — 任何 Run 与协作轮次都从全局 Budget 扣费、过 Policy 校验，触顶/越权即熔断升级。
6. **一切可追踪、可重放、可恢复** — 每个动作进 Trace；每个 Run 幂等可重放；项目可从最近一个 accepted 锚点 resume。

---

## 2. 系统架构

### 2.1 分层与依赖方向

```
┌─────────────────────────────────────────────────────────┐
│  UI / Console        （目标录入、会话观察、escalation 决策）  │
├─────────────────────────────────────────────────────────┤
│  Atelier Workflow    （业务编排：目标→契约→共识→任务→验收）   │
├──────────────┬──────────────────────────────────────────┤
│ Atelier Core │  Peers Agent Collaboration               │
│ (确定性事务)  │  (协作引擎 + 共识 + 裁决 + 监督)             │
│ 状态机/路由/  │  Roundtable / Expert Mesh / Debate /      │
│ Gate/Artifact│  Swarm / Hierarchy / Expert-Hierarchy     │
├──────────────┴──────────────────────────────────────────┤
│  Provider Layer   （CodingProvider / DataProvider / …）   │
├─────────────────────────────────────────────────────────┤
│  Foundation  （Trace, Budget, Policy, Storage, EventBus） │
└─────────────────────────────────────────────────────────┘
```

依赖方向只能向下。约束关系：

- **Collaboration 与 Atelier Core 平级、互不持有状态写权**：Collaboration 产出 `Decision`，Core 消费 `Decision` 改状态。
- **Foundation（Trace/Budget/Policy/EventBus）是横切设施**，被所有层共享。
- **Peers Agent Collaboration 是通用底座，不隶属于 Atelier**：Atelier 是它的第一个消费方。（落地纪律见 §9 与 decisions D-07）

### 2.2 各层职责

| 层 | 职责 | 不负责 |
|----|------|--------|
| UI / Console | 目标录入、协作会话观察、escalation 人工决策 | 任务状态变更 |
| Atelier Workflow | 把用户目标转成 CollaborationTask、生成 Atelier Task / Task Contract / Provider Strategy / Gate Plan | 主观判断、共识 |
| Atelier Core | Task/Run 状态机、Provider 路由、执行循环、Artifact 收集、Gate 运行、Fix Loop、Review Gate、Memory Candidate | 主观判断、决策 |
| Peers Agent Collaboration | 多 Agent 协作、共识、裁决、任务拆解、执行监督、验收、升级 | 事务性状态落地 |
| Provider | 外部工具接入，返回标准化命令/动作/日志/结果/产物 | 直接改 Task/Run 状态 |
| Foundation | Trace、Budget、Policy、Storage、EventBus | 业务语义 |

---

## 3. 协作引擎与权力结构

### 3.1 六引擎适用矩阵

| 引擎 | 适用问题 | 收敛方式 | 默认场景 |
|------|---------|---------|---------|
| Roundtable | 方案发散、头脑风暴 | 主持人收敛 | 早期目标探索 |
| Expert Mesh | 能力互补、并行专精 | 聚合器合并 | 多子系统并行设计 |
| Debate Judge | 多方案冲突 | Judge 裁决 | 架构选型有争议 |
| Swarm | 海量同构并行子任务 | 结果归约 + 多数 | 批量改造/扫描 |
| Hierarchy | 长流程、强秩序 | 上级签字 | 项目主推进 |
| **Expert Hierarchy** | 长流程 + 能力互补 | **终裁者签字 + 无未决反对** | **默认** |

引擎不是静态的：**同一项目不同阶段可切换引擎**。目标共识用 Roundtable 发散→收敛；架构争议用 Debate Judge；主推进用 Expert Hierarchy；同构子任务用 Swarm。引擎选择写入 `CollaborationTask.engine`，由 Architect/Planner 在拆解时决定。

### 3.2 Expert Hierarchy 默认引擎的权力结构

角色之间必须有明确的**否决权与上报关系**，否则「层级」名不副实：

```
                Goal Owner（终裁者，唯一 final signoff 权）
                   │  否决任何偏离 contract.goals 的决定
        ┌──────────┼───────────┐
   Architect     Planner     Risk & Policy（对危险动作有硬否决 + 强制升级权）
   (架构否决权)   (拆解权)
        └──────────┼───────────┘
                Supervisor（推进与收敛控制，无内容否决权，有强制收敛/升级权）
                   │
        ┌──────────┴───────────┐
   Executor（执行，无判断权）   Verifier（验收否决权，判断必带 evidence）
```

权力规则（落地为代码约束）：

- **Goal Owner**：唯一能让 Session 进入 `reached` 的签字者；可否决一切偏离 `contract.goals`/触碰 `non_goals` 的提案。
- **Risk & Policy**：对命中 Policy 高危规则的动作有**硬否决**且**强制 escalate**，Goal Owner 也不能覆盖（安全优先于目标）。
- **Verifier**：对 Task/Milestone 验收有否决权，否决必须带 `evidence_ref`。
- **Supervisor**：不参与内容对错判断，只管「是否在推进」——检测停滞、触发 replan、触顶强制收敛/升级。
- **Executor**：纯执行，零判断权，只调 Provider。

### 3.3 长任务必备的两个补充角色

原 7 角色之外，长任务还需：

- **Integrator / Reconciler Agent**：并行子任务（Swarm/Mesh）产出后，合并冲突、消解重复、保证全局一致性。
- **Historian / Memory Curator Agent**：贯穿全程记录决策理由、失败原因、规则演化，持续产出 memory candidate，而非事后补。

---

## 4. 六大长任务机制

### 4.1 共识收敛机制（Verification Consensus）

```
进入 reached 的充要条件：
  authority_signoff == true
  AND open_objections.filter(unresolved && has_evidence).count == 0

反附和（anti-echo）规则：
  - 赞成票必须附 evidence_ref，否则不计入「无未决反对」判定
  - 反对票无 evidence 则降级为「疑虑」，记录但不阻断
  - Verifier 与 Executor 不得由同一模型实例承担（防同源盲区）

收敛失败处理：
  rounds 达 max_rounds 仍未 reached → state=escalated，
  带「分歧快照 + 各方 evidence」升级用户裁决
```

共识不是「多数票」，是「终裁者签字 + 无未决反对」。多 LLM 投票易退化为附和，故反对与赞成都须带证据。

### 4.2 验收可判定性分级（Verifiability Level）—— 自动化总开关

```
L0 二值可判定：test/build/lint/编译/schema 校验
   Verifier = 确定性脚本；自动验收；human-in-loop ≈ 0
L1 规则可判定：数值阈值、投资约束、数据质量规则、来源白名单
   Verifier = 规则引擎；自动验收；异常才升级
L2 主观需人判：研究结论质量、内容质量、策略合理性、不可逆动作
   Verifier = LLM 仅产出「建议 + 证据」，强制 awaiting_human
```

**本设计最重要的一条**：自动化深度不是全局开关，而是 per-task 由 level 决定。一个项目可同时含 L0/L1/L2 任务——L0/L1 自动流转，L2 在固定点汇聚给人。「减少 human-in-loop」= 最大化 L0/L1 占比，而非强行把 L2 自动化。

### 4.3 预算熔断（Budget & Circuit Breaker）

```
Budget（项目级，向下切片到 milestone/task/session）{
  token_cap, money_cap, wall_clock_cap
  max_fix_loops, max_collab_rounds, max_parallel_runs
}
每个 Run/Round 执行前预扣、执行后结算
任一维度触顶 → 该层熔断 → 升级用户（附：已花成本、当前进度、最近 accepted 锚点）
Swarm/Mesh 并行度受 max_parallel_runs 硬限
```

预算是与状态机平级的一等中枢，不是 escalation 的一个分支。

### 4.4 Supervisor Loop（推进与停滞检测）

```
周期性扫描所有 active milestone/task：
  - 停滞检测：task 在 fixing↔executing 间循环且 input_snapshot 无变化 → 判「无进展」→ escalate
  - 偏离检测：实际产物与 task_contract 偏离阈值 → 触发 replanning
  - 依赖死锁检测：Task Graph 出现环或全 blocked → escalate
  - 推进：将 ready 且依赖满足的 task 入队（受 budget/并发限）
```

### 4.5 Replan 机制（长任务必备）

```
触发源：Supervisor 偏离检测 / Verifier 多次 reject / Architect 架构漂移告警 / 外部条件变化
动作：开新 CollaborationTask(question="重规划 milestone X 的 Task Graph")
      → 产出新 Task Graph diff → Goal Owner 签字 → Core 原子替换子图
约束：已 accepted 的产物不丢弃（作为 resume 锚点）；replan 计入 budget
```

### 4.6 Escalation Guard（人工升级闸）

```
强制升级（不可被 Goal Owner 覆盖）：
  - Risk&Policy 硬否决：危险命令、越权路径、不可逆动作（数据迁移/发布/交易）
  - 预算任一维度触顶
  - 权限不足
强制升级（流程性）：
  - 目标冲突且 Goal Owner 无法在 contract 内裁决
  - max_rounds / max_fix_loops 耗尽仍未通过
  - L2 任务到达验收点
升级载荷必须含：问题、各方 evidence、已花成本、可选项、推荐项、回滚影响
```

---

## 5. Provider / Gate / Artifact / Memory

### 5.1 Provider —— 分领域接口，不强行通用

顶层只定义最小共性契约，领域差异下沉到子类型：

```
Provider（最小共性）{
  capabilities() → []Capability
  execute(command) → Result{ status, logs, artifacts, cost }   // 无状态写
  cancel(run_id)
}

CodingProvider extends Provider {
  产物：diff.patch, build_log, test_report
  特性：可重放、产物二值可校验、副作用局限工作区（沙箱）
  实例：Trae / Cursor / Codex / Claude Code
}
DataProvider extends Provider {
  产物：result.json, data_snapshot, quality_report
  特性：读多写少、可缓存、副作用可控
}
ActionProvider extends Provider {   // 高危，独立类型
  产物：execution_receipt, rollback_token
  特性：不可逆、带钱/带权、强制走 Risk 硬否决 + 人工确认 + 回滚预案
  实例：交易下单、发布、数据迁移
}
```

**落地纪律**：通用 `Provider` 接口只保留共性；研究/交易特性进子类型。真正的通用层是从 ≥2 个子类型**归纳**出来的，不是预设。ActionProvider 单列，因其不可逆性必须绑死 Risk 闸。

### 5.2 Gate

```
Gate { id, type, blocking_level: block|warn|info, evaluator, level: L0|L1|L2 }
能力要求（不变量级）：
  - block 级 gate 失败 → 必须阻断 task 进入 verifying，触发 fixing，回灌协作会话
  - Gate 结果进 Artifact，可被 trace/review/memory 引用
分领域：
  Coding：lint/typecheck/test/build/scope/security/review
  Data：schema/completeness/freshness/source-trust
  Investment：constraint/risk-limit/backtest-validity
  Content：fact-check/source/policy-compliance
注意：L2 的 Gate 只能 warn，不能 block（主观判断不能机器阻断）→ 退化为 human review 点
```

### 5.3 Artifact

```
Artifact { id, run_id, type, uri, checksum, produced_at, refs }
原则：Artifact 是唯一事实源；gate/verify/consensus/memory 的 evidence_ref 全指向它
保留：可重放所需的 input_snapshot 也作为 artifact 存档
```

### 5.4 Memory

```
两阶段：candidate → confirmed
MemoryCandidate { type, content, evidence_refs, scope: user|project|domain }
写入规则：
  - 默认只生成 candidate，由用户确认才入长期记忆（防自我污染）
  - confirmed 后按 scope 写入对应记忆层
  - 失败原因类记忆反哺 Planner/Risk，形成闭环改进
Historian Agent 负责持续生成 candidate
```

---

## 6. 大项目全链路

```
User Goal
 → [Roundtable/Expert-Hierarchy] 目标共识 → ProjectContract（含 acceptance+level+non_goals）
 → [Goal Owner signoff] → Project=contracted
 → [Planner] Milestone Tree（标依赖、标 level）
 → 逐 Milestone：
      [Planner] Task Graph
      → 逐 Task：选 engine/provider_strategy/gate_plan/level
        → Executor→Provider→Run→Artifact
        → GatePlan（block 失败→Fix Loop，受 max_fix_loops）
        → Verifier 验收（L0/L1 自动 / L2 awaiting_human）
        → 偏离则 Supervisor 触发 Replan
      → [Goal Owner+Verifier+Supervisor] Milestone Acceptance
 → 所有 Milestone accepted
 → Project Verification：逐条评估 AcceptancePredicate
      L0/L1 自动判定 / L2 → owner_signoff
 → Project=accepted
 → Historian 汇总 final report + residual risks + follow-ups + memory candidates
```

完成条件的可机器判定谓词见 [data-model.md](./data-model.md) §3。

---

## 7. 沙盘推演

### 7.1 沙盘 A：Coding 自增强 —— 「给 Atelier 增加 DataProvider 支持」（L0/L1 为主）

```
1. 目标录入：为 Atelier 接入 DataProvider。
2. 目标共识(Expert-Hierarchy)：
   - Goal Owner 定 contract.goals=["可注册DataProvider","可执行数据查询Run","产物入Artifact"]
   - non_goals=["不做UI可视化","不接真实交易"]
   - Verifier 反推 acceptance：
       P1(L0): "DataProvider 接口单测通过"
       P2(L0): "集成测试: 注册→execute→artifact 链路通过"
       P3(L1): "数据质量 gate 在样例数据上通过"
   - Risk&Policy：标记"数据源访问需走白名单 Policy"
   → Goal Owner signoff → contracted
3. Planner 拆 Milestone Tree：
   M1 接口抽象 → M2 一个具体 DataProvider 实现 → M3 数据质量 Gate → M4 集成测试
   依赖：M2 depends M1；M3 depends M2；M4 depends M2,M3
4. M1 → Task Graph：T1.1 定义接口 / T1.2 单测
   - T1.1: provider=CodingProvider(Codex), gate_plan=[lint,typecheck,build], level=L0
   - Executor→Run→产 diff.patch+build_log
   - Gate: typecheck 失败(block) → defect_proposal → fixing
   - 第2次 attempt：input_snapshot 变化(补类型) → Run → gate 全过
   - Verifier(L0=确定性)：build+test 绿 → accepted
   - T1.2 同理 → M1 accepted
5. M2：实现具体 provider；test gate 红→fix→绿；Verifier accepted
6. M3 数据质量 Gate(L1)：
   - 规则引擎校验 completeness/freshness → 样例数据 freshness 不达标(block)
   - Supervisor 检测：连续 2 次 fix 但 input_snapshot 未变(模型反复给同样修法)
     → 判"无进展" → escalate 用户："样例数据本身过期，需提供新数据源？"
   - 用户提供新数据源 → resume from M3 → gate 过 → accepted
7. M4 集成测试 accepted
8. Project Verification：P1/P2/P3 全 L0/L1 自动判定为 true
   - goal_owner_signoff（contract 要求）→ 用户一键签字 → accepted
9. Historian：success_pattern="DataProvider 接入范式"、failure_cause="样例数据过期导致 gate 假阴"
   → memory candidates → 用户确认入 project_memory
```

要点：L0/L1 占主导 → 几乎全自动；唯一两次人工介入是 (a) 外部依赖缺口（样例数据），(b) 最终签字。这是「减少而非取消 human-in-loop」的理想形态。

### 7.2 沙盘 B：选股研究 —— 「本季度科技股投资标的研究」（含大量 L2）

```
1. 目标共识：goals=["产出5只候选股+理由+风险"]，non_goals=["不自动下单","不做仓位管理"]
   acceptance：
     P1(L1): "每只标的含财务指标且通过投资约束(PE<X,负债率<Y)"
     P2(L1): "数据来源在白名单内且 freshness<24h"
     P3(L2): "投资逻辑合理性" → 强制 human signoff
   Risk&Policy：标记"任何下单动作=ActionProvider=硬否决+人工"
2. Planner：M1 数据采集 → M2 量化筛选(L1) → M3 定性研究(L2) → M4 报告整合
3. M1/M2：DataProvider 跑筛选，规则引擎 gate(L1)自动验收 → 产 result.json+quality_report
4. M3 定性研究(L2)：
   - 引擎切换为 Expert Mesh（分析师/行业专家/风控并行）
   - Executor 调研究类 Provider 产出 analysis + 推理链 artifact
   - Verifier(L2)：LLM 只能产"建议+证据"，不能 accept → task=awaiting_human
   - 汇聚点：把 5 只标的的逻辑+证据+反对意见(带 evidence)一次性呈给用户
   - 用户对 2 只有异议 → reject → Supervisor 触发对这2只的 replan(补充调研)
5. M4 报告：Integrator 合并并行产物，消解分析师间结论冲突
6. Project Verification：P1/P2 自动 true；P3(L2)→awaiting_owner_signoff→用户签字→accepted
7. 若用户后续说"按这个下单" → 命中 ActionProvider
   → Risk 硬否决自动执行 → 强制 escalate(附回滚影响) → 必须人工确认
```

要点：选股的「研究」本质是 L2，系统不假装能自动验收，而是把人集中在「逻辑合理性签字」这一高价值点；数据/约束 L1 部分仍自动化。交易动作走 ActionProvider 被 Risk 硬闸拦死。

### 7.3 沙盘 C：失控与恢复 —— 预算熔断 + 断点恢复

```
1. 长项目执行到 M5，某 Swarm Task 并行 30 个子 Run 扫描代码库
2. 子 Run 普遍失败重试，token 消耗激增
3. Budget.token_cap 触顶 → Circuit Breaker 熔断该 milestone
   → 所有 running Run cancelled，状态落盘
   → escalate 用户：已花$X、M1-M4 已 accepted、M5 卡在 Swarm、
      推荐：缩小扫描范围/提高单 Run 预算/放弃 M5
4. 用户选"缩小范围+提高预算" → 更新 Budget + replan M5 的 Task Graph
5. Project resume from M4(最近 accepted 锚点) → M5 重新执行
6. 已 accepted 的 M1-M4 产物复用，不重跑
```

要点：熔断不是失败终止，而是**带快照的可恢复暂停**；resume 锚点是「最近 accepted milestone」，保证不白干。

---

## 8. 组件关系与数据流（小结）

```
用户目标 ──► Atelier Workflow ──创建──► CollaborationTask
                                          │
                Peers Agent Collaboration ─┤ 产出 Decision（含 Contract/Plan/TaskGraph）
                                          ▼
Atelier Core ◄──消费 Decision──── 改 Project/Milestone/Task 状态
   │
   ├─ 路由 ──► Provider ──► Run ──► Artifact
   ├─ 跑 Gate ──► GateResult ──(block 失败)──► Fix Loop ──回灌──► Collaboration
   ├─ Verifier 验收 ──► accepted / rejected / awaiting_human
   └─ Historian ──► MemoryCandidate ──(用户确认)──► 长期记忆

横切：Trace 记录全部转移；Budget 全局扣费熔断；Policy 全局校验；EventBus 驱动 Supervisor Loop
```

---

## 9. 落地路线（按可验收性分层铺开）

不按「框架先行」，按 **verifiability_level 从 L0 向 L2 推进**，每个阶段都是端到端可用的完整系统：

```
阶段1（L0 闭环全要素）：状态机 + Trace + Budget + Policy + CodingProvider
        + L0 Gate + 共识收敛 + Escalation —— 在 coding 自增强上跑通完整链路
        （不是"砍功能的 MVP"，而是先把所有不变量在最易验收的领域全部落地）
阶段2（L1）：DataProvider + 规则引擎 Verifier + Domain Gate + Replan + Resume
阶段3（L2）：研究/内容 Provider + LLM-建议型 Verifier + 强制人工验收汇聚点
        + Expert Mesh/Debate 引擎 + Integrator/Historian 角色
阶段4（高危）：ActionProvider + 硬否决闸 + 回滚预案 + 交易/发布场景
阶段5（通用层归纳）：从已有 ≥2 个 Provider 子类型归纳通用接口；
        将 Collaboration 从 Atelier 中抽离为独立底座（被第二个消费方逼出）
```

**两层抽象的落地纪律**（见 decisions D-07）：阶段 1-4 期间，协作逻辑直接长在 Atelier 内，**先不拆** Peers Agent Collaboration 独立底座；待 coding 闭环稳定、真要接第二个消费方时，在阶段 5 再抽离。「通用底座」应被第二个使用者逼出，而非提前规划。
