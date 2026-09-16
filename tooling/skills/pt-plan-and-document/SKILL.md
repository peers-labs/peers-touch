---
name: "pt-plan-and-document"
description: "规划落盘与计划追踪。当用户要求把讨论结果转为正式设计文档/执行计划/任务清单并落盘追踪时调用。教 agent 找到项目文档规范、选对落盘位置、按标准结构输出。"
stage: "PLAN"
requires: ["analysis output from pt-architecture-execution-methodology OR standalone planning request"]
produces: ["bounded Plan Package and Task Slices", "active_work registration", "plan review prompt"]
next: "pt-context-anchor → pt-execution-plan-guardian"
---

# 规划落盘与计划追踪（Plan & Document）

当用户说"列成计划"、"落盘"、"准备好文档再实施"、"出个执行计划"、"先规划再动手"时，本 skill 指导你**完整执行从讨论到正式文档的落地流程**。

---

## 1. 触发场景

- 用户要求把讨论结果**写成正式文档**
- 用户要求**先出计划/设计再动手**
- 用户要求**追踪进度**（任务清单、阶段状态）
- 用户说"落盘"、"列计划"、"准备好再实施"

---

## 2. 第一步：找到项目文档规范

在写任何正式文档之前，**必须先读这些规范文件**确认格式与位置：

| 你要做什么 | 先读什么 |
|-----------|---------|
| 写产品定义、体验/状态合同、benchmark disposition 或产品验收矩阵 | `tooling/skills/pt-product-design-methodology/SKILL.md` |
| Architecture design methodology | `tooling/skills/pt-architecture-design-methodology/SKILL.md` |
| 写架构设计文档 | `docs/global/architecture-document-standard.md`（文件集/命名/元数据/结构） |
| 判断文档该放哪一层 | `docs/README.md` §3-4（三层真源体系 + 按问题找位置） |
| 大需求文档化流程 | `docs/knowledge/playbooks/documenting-large-requirements.md` |
| 做执行计划拆解 | `tooling/skills/pt-architecture-execution-methodology/SKILL.md` |
| 做原型 | `tooling/skills/pt-prototype-design/SKILL.md` |

**禁止**不读规范就凭记忆写文档。每次落盘前至少确认：放对位置 + 用对结构。

---

## 3. 第二步：确定落盘位置

按问题层级选目录：

```
"系统为什么这么设计" → docs/architecture/<domain>/
"某平台内部怎么落地" → docs/client/<platform>/ 或 docs/station/
"怎么写代码"        → docs/global/coding-guide/
"历史材料"          → docs/context/
"工作过程草稿"      → .trae/documents/（不作为正式真源）
```

### 架构模块文件集（必须遵守的固定命名）

```
docs/architecture/<module>/
├── README.md              # [必选] 入口导航
├── design.md              # [必选] 架构设计
├── decisions.md           # [必选] 设计决策 ADR
├── data-model.md          # [可选] 数据模型/协议/schema
├── module-layout.md       # [可选] 目录结构与文件职责
├── integration.md         # [可选] 映射/影响面/迁移
├── execution-plans/       # [可选] 分阶段实施计划
└── prototype/             # [可选] 原型入口说明
```

### Plan Package

正式执行计划放在对应模块的 `execution-plans/<日期-需求名>/`：

```text
execution-plans/<date>-<slug>/
├── plan.md
├── tasks/<task-id>.md
└── archive/
```

`plan.md` 包含唯一的 `Plan Package` JSON 块，记录稳定目标、scope、架构引用、
Task DAG/lifecycle、Acceptance Execution、授权，以及经过验证的 `Branch`、
`Workspace ID`、`Initial HEAD`、`Expected HEAD` 和 worktree-set digest。
`tasks/*.md` 每个只描述一个可恢复的 Journey/功能闭环。不得另建
active-plan 状态文件，也不得再创建 active 单文件计划。

---

## 4. 第三步：文档结构要求

### 4.1 元数据块（每个文件顶部必须有）

```markdown
> **Status**: draft | active | superseded | deprecated
> **Version**: v1.0
> **Created**: YYYY-MM-DD | **Updated**: YYYY-MM-DD
> **Owner**: @handle 或团队名
```

### 4.2 Plan Package 结构

```markdown
# <需求名> — 执行计划

> **Status**: prepared
> **Branch**: `<branch>`
> **Workspace ID**: `<workspace-id>`
> **Initial HEAD**: `<full-head>`
> **Expected HEAD**: `<full-head>`
> **Worktree-set Digest**: `<sha256>`

---

## Plan Package

```json
{
  "schemaVersion": 1,
  "kind": "peers-touch-plan-package",
  "planId": "example-plan",
  "status": "prepared",
  "binding": {
    "branch": "<branch>",
    "workspaceId": "<workspace-id>",
    "initialHead": "<full-head>",
    "expectedHead": "<full-head>",
    "worktreeSetDigest": "<sha256>"
  },
  "workClass": "infrastructure",
  "architecture": {
    "sources": ["docs/architecture/<module>/design.md"],
    "decisions": ["<decision-id>"]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": "<owned-path>", "mode": "exclusive-write"}
    ],
    "nonGoals": ["<non-goal>"]
  },
  "tasks": [
    {
      "id": "TASK-01",
      "workstreamId": "<workstream-id>",
      "path": "tasks/TASK-01.md",
      "dependsOn": [],
      "status": "pending",
      "blocker": null
    }
  ],
  "exhaustion": null,
  "authorization": {
    "checkpoint": {"localCommit": "denied", "amend": "denied"},
    "delivery": {"push": "denied", "pullRequest": "denied"},
    "runtime": {"deployProfiles": [], "destructiveResetScopes": []},
    "history": {"rewrite": "denied"}
  }
}
```

## Acceptance Execution

```json
{
  "schemaVersion": 1,
  "closures": {"<closure-id>": ["<gate-id>"]},
  "completion": ["<gate-id>"],
  "full": ["<gate-id>"]
}
```
```

每个 `tasks/<task-id>.md` 必须包含一个闭合 `Task Slice` JSON 块，声明
`taskId/workstreamId`、Journey/functional boundary、read/write set、预算、
checks、done/failure 行为、durable evidence 和不超过 30 行的 current
snapshot。Task lifecycle 只存在于 manifest；Task 文件不得复制
`pending/in_progress/blocked/done` 状态。

机械边界由 `planctl validate` 强制执行：manifest 不超过 300 行/20 KiB，
Task 不超过 200 行/12 KiB，archive 不参与 discovery、状态或恢复。

### 4.3 设计文档推荐结构

参照 `docs/global/architecture-document-standard.md` §5 各文件编写规范。

### 4.4 Context Anchor 边界

- Execution plans MUST NOT contain a `## Context Anchor` section.
- `plan.md`、Task Slice 和 archive **均不得**包含 `## Context Anchor`。
- PRODUCT / DESIGN 阶段尚无正式执行计划时，不创建占位 `active_work` 行。
- `plan.md` 和初始 Task Slices 创建并通过 `planctl validate` 后，才在
  `project_memory.md` 的 `active_work` 登记 repo-relative package
  `plan.md` 路径、`stage: PLAN`、`current_task_id/current_task_path=NONE`、
  `dev_state=NONE`、已验证 binding、blocker 与 session 日期。
- Plan review 通过后，通过 manifest 原子选择一个 dependency-ready Task；
  active pointer 随后镜像该 `current_task_id/current_task_path`。
- `pt-context-anchor` 只从 active pointer、compact manifest、当前 Task、
  当前 Session 和被引用的 durable evidence 生成聊天投影；不扫描 archive
  或全部 Task，也不把聊天状态回写为第二套真源。

---

## 5. 第四步：计划追踪

### 方式一：Plan Package（正式真源）

- `plan.md.tasks[]` 是唯一 Task lifecycle/current-selection 真源。
- `planctl status/current/next/advance` 负责读取和原子更新 manifest。
- Task Slice 只在 meaningful milestone 更新 compact snapshot 和 durable
  evidence 引用；attempt、first failure 和 transition 写入机器 Dev root 的
  Development Session。
- 禁止在 package 末尾追加 dated progress、完整日志或第二张状态表。

### 方式二：TodoWrite（推荐会话内短任务）

对于当前会话内可完成的任务，用 TodoWrite 工具实时追踪。

### 方式三：pt-dev-workflow session（推荐代码交付）

需要走完整开发流程（plan → code → review → release）时，使用 `pt-dev-workflow` skill。

---

## 6. 第五步：更新可发现性

文档写完后必须做：

1. **更新最近的 README.md** — 确保目录内有链接指向 package `plan.md`
2. **更新 `docs/README.md`**（如果是新的真源文档）— 加入 §4 对应层级
3. **登记 `active_work`** — 仅在 package 已存在并通过
   `planctl validate` 后登记；先通过
   `tooling/scripts/verify-worktree-binding.py` capture + verify 当前明确选择的
   worktree，再完整保存 package `plan.md`、`current_task_id`、
   `current_task_path`、`dev_state`、branch、`workspace_id`、`initial_head`、
   `expected_head` 与 `worktree_set_digest`。Verifier 的 `workspaceId` 和
   worktree-set digest 分别映射到对应 snake_case 字段；identity 缺失时
   返回 `WORKTREE_IDENTITY_UNAVAILABLE`，不一致时返回
   `WORKTREE_IDENTITY_MISMATCH`
4. **告知用户正式文档路径** — 在实施前明确列出落盘位置
5. **校验唯一性** — 同一个 `workspace_id` 不得存在第二个 active package；
   新工作必须延续或修订当前 plan，或者由用户明确创建另一个 worktree

---

## 7. 第六步：生成计划 Review Prompt

执行计划落盘后、开始实施前，**必须生成一个结构化 Review Prompt**，供用户交给独立 agent 做计划评审。

### 7.1 为什么

- 计划作者（本 agent）有认知盲区，独立 reviewer 能发现遗漏依赖、顺序风险、scope 膨胀
- 结构化 prompt 确保 reviewer 聚焦在可操作的维度，而非泛泛评论
- 与架构 review 形成闭环：架构→计划→review→实施

### 7.2 Review Prompt 模板

```markdown
你是一个执行计划评审专家。请审阅以下 Peers-Touch 项目的执行计划。

## 计划背景
<1-3 句话描述计划的来源和目标>

## 上游架构基线
<列出计划依赖的已通过架构文档路径>

## 计划路径
<Plan Package 的 plan.md 路径>

## 评审维度

1. **依赖顺序**：各 phase/step 之间的依赖关系是否正确？是否有隐含的前置条件未列出？
2. **scope 边界**：计划是否做了超出架构文档授权的决策？是否引入了架构层未定义的新边界？
3. **验收标准**：每个 phase 的完成条件是否可验证（可执行命令/可观测结果）？
4. **风险覆盖**：关键风险是否被识别？缓解措施是否与架构约束一致？
5. **proto-first**：涉及跨端合约的步骤是否把 proto 修改放在实现之前？
6. **可并行性**：哪些步骤可以并行？当前顺序是否不必要地串行化？
7. **遗漏**：架构文档中的 invariants/forbidden relationships 是否在计划中有对应的实施步骤？
8. **Acceptance 调度**：每个 closure 是否只运行必要 Gate，completion/full
   是否分离，环境和预计耗时是否明确，是否存在默认触发昂贵 Gate？

## 输出格式

### 总体判断：[通过 / 有条件通过 / 需要修改]

### 各维度评估
1. 依赖顺序：[正确 / 有问题] — 理由
2. Scope 边界：[正确 / 有越界] — 理由
3. 验收标准：[充分 / 不充分] — 理由
4. 风险覆盖：[充分 / 不充分] — 理由
5. Proto-first：[正确 / 有违反] — 理由
6. 可并行性：[合理 / 可优化] — 建议
7. 遗漏：[无 / 有] — 列出
8. Acceptance 调度：[合理 / 过宽 / 有缺口] — 理由

### 修改建议（如有）
- ...
```

### 7.3 生成规则

1. **每次落盘执行计划后都必须生成** — 不是可选的
2. **Prompt 必须包含计划路径和架构路径** — reviewer 需要能读到原文
3. **Prompt 不内联完整计划内容** — 给出文件路径让 reviewer 自己读，避免复制漂移
4. **用户拿到 prompt 后决定是否发起 review** — agent 不自动发起

---

## 8. 完整检查清单

落盘完成后逐项确认：

- [ ] 读过了相关规范文件（§2 表格中至少一个）
- [ ] 文档放在了正确层级目录
- [ ] 文件命名遵循固定命名规则（不加模块前缀）
- [ ] 顶部有完整元数据块
- [ ] 结构清晰（背景/目标/方案/阶段/验收）
- [ ] package `plan.md` 和每个 Task Slice 均通过 `planctl validate`
- [ ] 包含唯一的 `Acceptance Execution` 合同，且每个 Task closure ID 恰好出现一次
- [ ] 每个 Gate 已注明 closure/completion/full 执行时点、环境和预计耗时
- [ ] 已向用户展示本次立即执行和延迟执行的 Acceptance
- [ ] 当前 worktree 只有一个 active Plan Package
- [ ] `plan.md`、Task Slice 和 archive 中没有 `## Context Anchor`
- [ ] 正式计划创建后才登记 `active_work`，且 plan 路径、branch、
      `current_task_id`、`current_task_path`、`dev_state`、`workspace_id`、
      `initial_head`、`expected_head` 与 `worktree_set_digest` 已验证
- [ ] 最近 README.md 已更新链接
- [ ] 已告知用户文档路径
- [ ] Task lifecycle/current selection 只存在于 manifest
- [ ] 如有执行计划，已生成 Review Prompt 并交付用户

---

## 9. 反模式

- **不读规范就写** — 导致放错位置、格式不对、命名不规范
- **只写在 `.trae/documents/` 不提升到 `docs/`** — 工作草稿不是正式真源
- **只列目标不列交付物** — 计划必须可验收
- **跳过确认直接实施** — 大需求必须用户确认计划后再动手
- **不更新导航** — 新文档如果在目录导航里找不到，等于不存在
- **不生成 review prompt** — 跳过独立评审就开始实施，等于自审自批
- **继续创建 active 单文件计划** — DWF-D13 之后的新计划必须是 Plan Package
- **把 Session 日志写回 Task** — transition/attempt/first failure 属于机器 Session

---

## 10. 与其他 skill 的关系

| 场景 | 用哪个 skill |
|------|-------------|
| Product definition / benchmark disposition / user journeys / visible states / product acceptance | `pt-product-design-methodology` |
| Architecture design / system boundaries / ownership / contracts | `pt-architecture-design-methodology` |
| 架构落地/领域拆解 | `pt-architecture-execution-methodology` |
| 完整开发周期（code→PR） | `pt-dev-workflow` |
| 创建/修改原型 | `pt-prototype-design` |
| 本 skill | 讨论→正式文档落盘→计划追踪 |

本 skill 是"文档落盘入口"——告诉你去哪找规范、在哪写、怎么写、怎么追踪。产品定义与体验验收交给 `pt-product-design-methodology`；架构边界设计交给 `pt-architecture-design-methodology`；具体架构拆解方法论交给 `pt-architecture-execution-methodology`。
