# Atelier × Peers Agent Collaboration — 数据模型

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-20 | **Updated**: 2026-06-20
> **Owner**: Peers-Touch Agent Team

---

本文档给出字段级数据契约、状态机图与可机器判定的完成条件谓词。先定数据，再定行为。下方 schema 用语言无关的伪 IDL 表达，后续在 `model/domain/` 下落为 proto。

---

## 1. 核心数据契约

### 1.1 可验收性分级（贯穿全系统的枚举）

```
enum VerifiabilityLevel {
  L0   // 二值可判定：test/build/lint/编译/schema 校验。Verifier=确定性脚本，全自动
  L1   // 规则可判定：数值阈值/约束/数据质量/白名单。Verifier=规则引擎，自动+异常升级
  L2   // 主观需人判：结论质量/内容质量/不可逆动作。Verifier=LLM 仅建议，强制人工
}

enum EvaluatorKind { deterministic, rule_engine, human }
```

### 1.2 Project / Contract

```
Project {
  id            : ID
  goal          : string                 // 用户原始目标
  contract      : ProjectContract
  milestone_tree: MilestoneTree
  state         : ProjectState
  budget_ref    : BudgetID
  policy_ref    : PolicyID
  trace_root    : TraceID
}

ProjectContract {
  goals          : []Goal                // 必达目标
  non_goals      : []string              // 显式非目标（防 scope 蔓延）
  acceptance     : []AcceptancePredicate // 项目级验收，每条必须可判定或显式标 L2
  constraints    : []Constraint          // 时间/成本/安全/合规上限
  invariants     : []string              // 本项目额外不变量（如"不得改 prod 数据"）
  owner_signoff_required : bool
}

AcceptancePredicate {
  id        : ID
  expr      : string              // 例: "all_milestones.status == accepted"
  level     : VerifiabilityLevel
  evaluator : EvaluatorKind
  // 运行期结果
  last_eval : bool | null
  human_signoff : bool            // 仅 L2 使用
}
```

> **约束**：`acceptance` 在立项时写死，每条标 `level`。含 L2 条目的项目天然无法 100% 自动收尾，必须预留人工签字位。

### 1.3 Milestone / Task / Run

```
Milestone {
  id, parent_id : ID                    // 树结构
  contract      : MilestoneContract     // 局部目标 + 局部验收谓词
  depends_on    : []MilestoneID
  state         : MilestoneState
  tasks         : []TaskID
  acceptance    : []AcceptancePredicate
}

AtelierTask {
  id, milestone_id   : ID
  task_contract      : TaskContract      // 输入、期望产物、验收谓词
  provider_strategy  : ProviderStrategy  // 选哪个 provider、降级链、并发度
  gate_plan          : GatePlan          // 必过哪些 gate、阻断级别
  verifiability_level: VerifiabilityLevel
  state              : TaskState
  runs               : []RunID
  escalation_policy  : ref
}

Run {
  id, task_id  : ID
  provider_id  : ID
  attempt_no   : int
  input_snapshot : blob                  // 幂等重放所需的完整输入
  state        : RunState
  artifacts    : []ArtifactID
  gate_results : []GateResult
  cost         : Cost { tokens, wall_clock, money }
  trace_id     : TraceID
}
```

### 1.4 协作侧

```
CollaborationTask {
  id           : ID
  source       : enum{ project, milestone, task, defect }
  question     : string                  // 要协作解决的具体问题
  engine       : EngineType              // 默认 expert_hierarchy
  participants : []AgentRole
  authority    : AgentRole               // 终裁者（默认 goal_owner）
  max_rounds   : int
  budget_slice : ref
  session      : CollaborationSession
}

CollaborationSession {
  state       : enum{ proposing, converging, reached, escalated, aborted }
  rounds      : []Round
  decision    : Decision | null
  exit_reason : enum{ signoff, no_objection, max_rounds, budget, policy, abort }
}

Decision {
  outcome         : string
  authority_signoff : bool
  open_objections : []Objection          // 每个都带 evidence_ref
  evidence_refs   : []ArtifactID
  produces        : []Contract | Plan | TaskGraph   // 共识的产物
}

Objection {
  by          : AgentRole
  claim       : string
  evidence_ref: ArtifactID | null        // null → 降级为"疑虑"，不阻断
  resolved    : bool
}
```

### 1.5 Provider / Gate / Artifact / Budget / Memory

```
Provider {                               // 最小共性，子类型见 design §5.1
  capabilities() : []Capability
  execute(command) : Result { status, logs, artifacts, cost }   // 无状态写
  cancel(run_id)
}

Gate {
  id, type     : ID/string
  blocking_level : enum{ block, warn, info }
  evaluator    : EvaluatorKind
  level        : VerifiabilityLevel      // L2 的 gate 只能 warn
}
GateResult { gate_id, run_id, passed: bool, blocking: bool, artifact_ref }

Artifact { id, run_id, type, uri, checksum, produced_at, refs : []ArtifactID }

Budget {
  token_cap, money_cap, wall_clock_cap : number
  max_fix_loops, max_collab_rounds, max_parallel_runs : int
  spent : Cost
}

MemoryCandidate {
  type : enum{ success_pattern, failure_cause, project_rule,
               domain_rule, arch_decision, workflow_improvement }
  content      : string
  evidence_refs: []ArtifactID
  scope        : enum{ user, project, domain }
  confirmed    : bool                    // 默认 false，用户确认才写长期记忆
}
```

---

## 2. 状态机

### 2.1 Run 状态机（最底层，确定性）

```
enum RunState { queued, running, succeeded, failed, cancelled, escalated }

queued ──start──► running
running ──ok────► succeeded ──► (gate 入口)
running ──err───► failed ──► (Fix 决策)
running ──budget/policy──► escalated
running ──cancel──► cancelled

不变量：succeeded/failed 后必产 Artifact；任何转移必入 Trace
```

### 2.2 Task 状态机（含 Fix Loop / Gate / 验收）

```
enum TaskState { created, planning, ready, executing, gating,
                 fixing, verifying, awaiting_human, accepted, rejected,
                 replanning, escalated }

created → planning → ready → executing
executing → gating（跑 GatePlan）
gating ──全过────────► verifying
gating ──可阻断失败──► fixing（生成 defect_proposal，回 Executor）
fixing → executing（attempt_no++，受 max_fix_loops 限）
fixing ──超 fix 上限──► escalated
verifying ──L0/L1 自动判定──► accepted | rejected
verifying ──L2────────────► awaiting_human ──► accepted | rejected
rejected → fixing | replanning
任意态 ──budget/policy/危险动作──► escalated

Fix Loop 硬约束：
  attempt_no <= max_fix_loops
  每次 fix 必须改变 input_snapshot；否则判"无进展循环"直接 escalate
```

### 2.3 Milestone 状态机

```
enum MilestoneState { planned, active, blocked, replanning, accepted, abandoned }

planned → active → (所有 task accepted) → accepted
active → blocked（有未闭环 blocker）→ active | abandoned
active → replanning（Task Graph 与现实偏离）→ active
```

### 2.4 Project 状态机

```
enum ProjectState { draft, contracted, executing, blocked,
                    verifying, awaiting_owner_signoff, accepted, escalated }

draft → contracted（Goal Owner signoff）→ executing
executing → blocked → executing | escalated
executing → verifying（所有 milestone accepted）
verifying ──全部 AcceptancePredicate 真──► accepted
verifying ──含 L2──► awaiting_owner_signoff → accepted
```

### 2.5 CollaborationSession 状态机

```
proposing → converging → reached
proposing/converging ──max_rounds/budget/policy──► escalated
任意态 ──abort──► aborted

进入 reached 充要条件（见 design §4.1）：
  authority_signoff == true
  AND open_objections.filter(unresolved && has_evidence).count == 0
```

---

## 3. 完成条件谓词（可机器查询）

项目级「完成」必须翻译为 Core 可求值的布尔表达式，不接受 LLM 口头声明：

```
project.accepted ⟺
     all(m in milestones        : m.state == accepted)
  ∧  open_blockers.count == 0
  ∧  all(p in contract.acceptance where p.level in {L0,L1} : p.eval() == true)
  ∧  all(p in contract.acceptance where p.level == L2       : p.human_signoff == true)
  ∧  all(r in residual_risks    : r.state in {logged, downgraded, follow_up})
  ∧  goal_owner_signoff == true
  ∧  no_unclosed_blocker(verifier, risk, supervisor)
  ∧  memory_candidates.generated == true
```

milestone 级：

```
milestone.accepted ⟺
     all(t in tasks : t.state == accepted)
  ∧  all(p in milestone.acceptance where level in {L0,L1} : p.eval() == true)
  ∧  all(p in milestone.acceptance where level == L2       : p.human_signoff == true)
  ∧  milestone.open_blockers.count == 0
```

task 级：

```
task.accepted ⟺
     latest_run.state == succeeded
  ∧  all(g in gate_plan where g.blocking_level == block : gate_result(g).passed)
  ∧  ( level in {L0,L1} ? verifier_predicate.eval()
                        : verifier_human_signoff == true )
```

---

## 4. 持久化与重放策略（要点）

- **事实源**：Artifact 是唯一事实源；所有 evidence_ref 指向 Artifact。
- **幂等重放**：`Run.input_snapshot` 完整保存重放所需输入，Run 可重跑得到等价结果。
- **恢复锚点**：Project resume 时回到最近 `accepted` 的 Milestone；其下已 accepted 产物复用，不重跑。
- **Trace**：所有状态转移、协作轮次、Gate 结果、预算扣费写入 Trace，支撑追踪与复盘。
- **落地映射**：上述 schema 后续落为 `model/domain/atelier/*.proto` 与 `model/domain/collaboration/*.proto`，与现有 `model/domain/agent/` 对齐。
