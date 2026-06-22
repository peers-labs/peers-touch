# Atelier 功能点对齐矩阵

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-20 | **Updated**: 2026-06-20
> **Owner**: Peers-Touch Agent Team

---

## 0. 怎么用这张表

- 这是全部功能点的**单一清单**，每条有稳定编号（F-XX-NN），后续讨论/排期/落地都引用编号。
- 三个对齐列分别指向：[design.md](../design.md) 章节、[data-model.md](../data-model.md) 章节、[roadmap.md](./roadmap.md) 积木。
- **状态**：✅ 三处一致；⚠️ 有缺口/错位（在 §3 列明）；空 = 该列本就不该覆盖。
- 本表是「对齐用」的活文档；每次改动功能点，先改这里，再改对应文档。

---

## 1. 功能点清单（按域）

### A. Foundation 横切设施（F-FD）

| 编号 | 功能点 | design | data-model | roadmap | 状态 |
|------|--------|--------|------------|---------|------|
| F-FD-01 | Trace 全链路追踪 | §1.6, §2 | §2(不变量), §4 | B0 | ✅ |
| F-FD-02 | Budget / Circuit Breaker 预算熔断 | §4.3 | §1.5 Budget | B6 | ✅ |
| F-FD-03 | Policy 引擎 | §4.6, §3.2 | — | B7 | ⚠️ data-model 缺 Policy 实体 |
| F-FD-04 | Storage 存储 | §2.1 | §4 | B0 | ✅ |
| F-FD-05 | EventBus（驱动 Supervisor Loop） | §8 | — | B9.5* | ⚠️ 无独立积木，data-model 缺 |

### B. Atelier Core 执行内核（F-CO）

| 编号 | 功能点 | design | data-model | roadmap | 状态 |
|------|--------|--------|------------|---------|------|
| F-CO-01 | Task 状态机 | §2.2 | §2.2 | B0/B2 | ✅ |
| F-CO-02 | Run 状态机 | §2.2 | §2.1 | B1 | ✅ |
| F-CO-03 | Milestone 状态机 | §2.2 | §2.3 | B10 | ✅ |
| F-CO-04 | Project 状态机 | §2.2 | §2.4 | B10 | ✅ |
| F-CO-05 | Provider 路由 | §2.2 | §1.3(provider_strategy) | B1 | ✅ |
| F-CO-06 | 执行循环 Run Loop | §2.2 | §2.1 | B2 | ✅ |
| F-CO-07 | Artifact 收集 | §5.3 | §1.5 Artifact | B1 | ✅ |
| F-CO-08 | Gate Runner | §5.2 | §1.5 Gate | B3 | ✅ |
| F-CO-09 | Fix Loop（含无进展检测） | §2.2 | §2.2 | B4 | ✅ |
| F-CO-10 | Verifier（L0/L1/L2 三档） | §4.2 | §1.1, §3 | B5/B12/B13 | ✅ |
| F-CO-11 | 完成谓词求值器 | §1.3 | §3 | B5/B10 | ✅ |
| F-CO-12 | Resume / 恢复锚点 | §1.6, §7.3 | §4 | B12 | ⚠️ 错位：应前移到 B6 |
| F-CO-13 | input_snapshot 幂等重放 | §1.6 | §1.3, §4 | B2 | ✅ |

### C. Provider 接入层（F-PR）

| 编号 | 功能点 | design | data-model | roadmap | 状态 |
|------|--------|--------|------------|---------|------|
| F-PR-01 | Provider 最小共性接口 | §5.1 | §1.5 Provider | B1 | ✅ |
| F-PR-02 | CodingProvider | §5.1 | §1.5(注) | B1 | ✅ |
| F-PR-03 | DataProvider | §5.1 | — | B12 | ⚠️ data-model 仅在注释 |
| F-PR-04 | ActionProvider（高危单列） | §5.1 | — | B14 | ⚠️ data-model 缺实体 |
| F-PR-05 | 工作区 / 沙箱 | §5.1(一句带过) | — | — | ⚠️ 缺：无积木无 schema |
| F-PR-06 | Provider Strategy（降级链/并发） | §2.2 | §1.3 | B1/B8 | ✅ |

### D. Gate 门禁（F-GT）

| 编号 | 功能点 | design | data-model | roadmap | 状态 |
|------|--------|--------|------------|---------|------|
| F-GT-01 | Gate 框架 + GatePlan | §5.2 | §1.5 Gate | B3 | ✅ |
| F-GT-02 | L0 coding gates（lint/type/test/build） | §5.2 | §1.1 | B3 | ✅ |
| F-GT-03 | L1 Domain gates | §5.2 | §1.1 | B12 | ✅ |
| F-GT-04 | L2 warn-only gates | §5.2 | §1.5(注) | B13 | ✅ |
| F-GT-05 | block 阻断 + 回灌协作 | §5.2 | §2.2 | B3 | ✅ |

### E. Collaboration 协作底座（F-CL）

| 编号 | 功能点 | design | data-model | roadmap | 状态 |
|------|--------|--------|------------|---------|------|
| F-CL-01 | CollaborationTask / Session | §3, §4.1 | §1.4, §2.5 | B8/B9 | ✅ |
| F-CL-02 | 六协作引擎 | §3.1 | §1.4(EngineType) | B8/B13 | ⚠️ data-model 缺 EngineType 枚举 |
| F-CL-03 | 九角色 + 权力结构 | §3.2, §3.3 | §1.4(AgentRole) | B8/B11/B13 | ⚠️ data-model 缺 AgentRole 枚举 |
| F-CL-04 | 共识收敛 + 反附和 | §4.1 | §2.5 | B9 | ✅ |
| F-CL-05 | Decision → Core 消费 | §1.1, §8 | §1.4 Decision | B8 | ✅ |
| F-CL-06 | 任务拆解 / TaskGraph | §6 | §1.4(produces) | B8 | ⚠️ data-model 缺 TaskGraph 实体 |
| F-CL-07 | Supervisor Loop | §4.4 | — | — | ⚠️ 缺：无积木无 schema |
| F-CL-08 | Replan 机制 | §4.5 | §2.2/§2.3(replanning) | B12 | ⚠️ 错位：应前移到 B 阶段 |
| F-CL-09 | Integrator 合并去冲突 | §3.3 | — | B13 | ⚠️ data-model 缺；并行前置条件未定 |
| F-CL-10 | Escalation Guard | §4.6 | §2(escalated 态) | B7 | ✅ |

### F. Project 生命周期（F-PJ）

| 编号 | 功能点 | design | data-model | roadmap | 状态 |
|------|--------|--------|------------|---------|------|
| F-PJ-01 | Project Contract | §6 | §1.2 | B10 | ✅ |
| F-PJ-02 | Milestone Tree | §6 | §1.2(MilestoneTree) | B10 | ⚠️ data-model 缺 MilestoneTree 结构 |
| F-PJ-03 | Task Graph | §6 | §1.4(produces) | B8 | ⚠️ 同 F-CL-06 |
| F-PJ-04 | Milestone Acceptance | §6 | §3 | B10 | ✅ |
| F-PJ-05 | Project Verification / Acceptance | §6 | §3 | B10 | ✅ |
| F-PJ-06 | Residual Risk / Follow-up | §6 | §3(引用) | B10 | ⚠️ data-model 缺 ResidualRisk 实体 |
| F-PJ-07 | Blocker 管理 | §6 | §3(引用) | B10 | ⚠️ data-model 缺 Blocker 实体 |

### G. Memory 记忆沉淀（F-MM）

| 编号 | 功能点 | design | data-model | roadmap | 状态 |
|------|--------|--------|------------|---------|------|
| F-MM-01 | Memory Candidate 生成 | §5.4 | §1.5 | B11 | ✅ |
| F-MM-02 | 两阶段 confirm 写入 | §5.4 | §1.5(confirmed) | B11 | ✅ |
| F-MM-03 | 失败记忆反哺 Planner/Risk | §5.4 | — | B11 | ⚠️ data-model 无反哺链路字段 |

### H. UI / Console（F-UI）

| 编号 | 功能点 | design | data-model | roadmap | 状态 |
|------|--------|--------|------------|---------|------|
| F-UI-01 | 目标录入 | §2.2 | — | B0/B8 | ✅ |
| F-UI-02 | 会话 / 任务观察 | §2.2 | — | B0/B1/B8 | ✅ |
| F-UI-03 | Escalation 人工决策 | §2.2, §4.6 | — | B6/B7 | ✅ |
| F-UI-04 | Memory 确认 | §5.4 | — | B11 | ✅ |

### I. Human-in-loop（F-HL）

| 编号 | 功能点 | design | data-model | roadmap | 状态 |
|------|--------|--------|------------|---------|------|
| F-HL-01 | 升级触发条件（强制/流程性） | §4.6 | §1.4(exit_reason) | B7/B13 | ✅ |
| F-HL-02 | 升级载荷（证据/成本/选项/回滚影响） | §4.6 | — | B6/B7 | ⚠️ data-model 缺 EscalationPayload |

---

## 2. 对齐总览

- **功能点总数**：48
- **三处一致 ✅**：30
- **有缺口/错位 ⚠️**：18

⚠️ 主要集中在两类：(1) **data-model 缺实体/枚举**（被 design 和谓词引用却没定义）；(2) **roadmap 积木错位/缺失**（机制类积木排错阶段或没排）。

---

## 3. 缺口清单（按优先级）

### P0 — data-model 自洽性硬伤（谓词引用了不存在的定义）

| 缺口 | 涉及功能点 | 修法 |
|------|-----------|------|
| GAP-01 | Blocker 实体未定义 | F-PJ-07 | 补 `Blocker{ id, owner, severity, state, evidence_ref }` |
| GAP-02 | ResidualRisk 实体未定义 | F-PJ-06 | 补 `ResidualRisk{ id, desc, state:logged/downgraded/follow_up, evidence_ref }` |
| GAP-03 | Project 缺字段 | F-PJ-05/06/07 | 补 `goal_owner_signoff / residual_risks / open_blockers / memory_candidates` |
| GAP-04 | AgentRole 枚举未定义 | F-CL-03 | 列九角色枚举 |
| GAP-05 | EngineType 枚举未定义 | F-CL-02 | 列六引擎枚举 |
| GAP-06 | MilestoneTree / TaskGraph 结构未定义 | F-PJ-02/03, F-CL-06 | 补节点+边+依赖结构 |
| GAP-07 | Policy / Defect 实体未定义 | F-FD-03, F-CO-09 | 补 Policy 规则与 Defect/defect_proposal |

### P1 — roadmap 积木错位/缺失（影响阶段能否凑齐，见上轮审计）

| 缺口 | 涉及功能点 | 修法 |
|------|-----------|------|
| GAP-08 | Supervisor Loop 无独立积木 | F-CL-07, F-FD-05 | 新增 B9.5；EventBus 随之落地 |
| GAP-09 | Replan 错排到 C 阶段 | F-CL-08 | 前移到 B 阶段（B10 之前） |
| GAP-10 | Resume 错排到 C 阶段 | F-CO-12 | 前移并与 B6 熔断绑定 |
| GAP-11 | 工作区/沙箱无积木无 schema | F-PR-05 | B1 内显式加子项 + 补 Workspace schema |
| GAP-12 | Integrator 并行前置条件未定 | F-CL-09 | 明确「B 阶段 TaskGraph 仅串行」或前移 Integrator |

### P2 — 字段级补全（不阻塞但应补）

| 缺口 | 涉及功能点 | 修法 |
|------|-----------|------|
| GAP-13 | EscalationPayload 未定义 | F-HL-02 | 补结构化升级载荷 schema |
| GAP-14 | 记忆反哺链路无字段 | F-MM-03 | 补 candidate→Planner/Risk 引用 |
| GAP-15 | DataProvider/ActionProvider 仅注释 | F-PR-03/04 | 在 data-model 落为正式子类型 schema |
| GAP-16 | 完成谓词冗余 | F-CO-11 | 合并 `open_blockers==0` 与 `no_unclosed_blocker(...)` |

---

## 4. 下一步对齐动作（建议顺序）

1. **修 P0（GAP-01~07）**：补 data-model 实体/枚举，让完成谓词可求值——这是「完成可机器判定」不变量在文档层的兑现。
2. **修 P1（GAP-08~12）**：按上轮审计把 Supervisor/Replan/Resume 前移、补沙箱、定并行约束，更新 roadmap 与本表。
3. **修 P2（GAP-13~16）**：字段级补全。
4. 每修完一项，回本表把对应 ⚠️ 翻成 ✅，保持矩阵与三份文档一致。
