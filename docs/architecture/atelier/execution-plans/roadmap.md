# Atelier 落地路线 — 积木式

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-20 | **Updated**: 2026-06-20
> **Owner**: Peers-Touch Agent Team

---

## 0. 怎么读这份路线

这份路线**不按横向分层推进**（不是先做完 Core、再做完 Provider、再做完协作），而是**按纵切积木推进**：

- 每块积木 = 一个**能跑、能演示**的纵切，自己穿过多个层。
- 每块积木都有明确的**「完成的样子」**——一个人能亲眼看到/跑出来的东西，而不是「代码写完了」。
- 后一块积木**复用前面所有积木的地基**，只往上加一个新形状。地基（状态机 / Trace / Budget / Policy / Gate 框架）一次搭好，后面换形状不换地基。
- 验收一块积木 = 能现场演示它的「完成的样子」，并满足「验收信号」。

每块只回答三个问题：**搭完能看到什么** / **怎么算搭完** / **复用了什么、新增了什么**。

阶段 = 若干积木凑齐后，**整个系统长成的样子**（见 §3 检查点）。

---

## 1. 积木依赖图

```
[B0 任务台账]
   └─►[B1 单次真实执行]
          └─►[B2 执行循环]
                 └─►[B3 门禁阻断]
                        └─►[B4 修复回路]
                               └─►[B5 自动验收]
   [B6 预算熔断]──────────────────┤   （横切，越早越好）
   [B7 危险动作闸]────────────────┘
                                  ▼
                        ┌── 检查点 A：单任务自动闭环 ──┐
                                  │
                 [B8 协作拆解]────┤
                 [B9 共识收敛]────┤
                 [B10 项目聚合]───┤
                 [B11 经验沉淀]───┘
                                  ▼
                        ┌── 检查点 B：L0 项目级闭环 ──┐
                                  │
                 [B12 L1 领域]────┤  换形状不换地基
                 [B13 L2 主观]────┤
                 [B14 高危动作]───┤
                 [B15 抽离底座]───┘
                                  ▼
                        ┌── 检查点 C/D/E ──┐
```

---

## 2. 积木逐块定义

### B0 ｜任务台账

- **搭完能看到什么**：创建一条 Task，库里有这条记录；列表里能看到它 `state=created`；Trace 里有一条「任务被创建」的事件。一个最小列表界面（或 CLI）能列出/查看任务。
- **怎么算搭完**：`create → list → get` 可用；状态落库；每次状态变化进 Trace。
- **复用 / 新增**：新增 Task 状态机最小骨架 + Trace + 存储。这是地基的第一块砖。

### B1 ｜单次真实执行

- **搭完能看到什么**：对一条 Task 触发一次 Run，Atelier **真实调用**一个 coding CLI（Codex / Claude Code 其一），命令跑完，回收 stdout/日志和产物文件，存成 Artifact，`Run.state=succeeded`。界面能看到这次运行的日志和产出的 `diff.patch`。
- **怎么算搭完**：真实 CLI 调用（**不 mock**）；Artifact 落盘且可下载；Run 状态正确；cost（token/时长）被记录。
- **复用 / 新增**：复用 B0 台账；新增 Provider 接口（先只 CodingProvider 一个实例）+ Run 实体 + Artifact 存储。

### B2 ｜执行循环

- **搭完能看到什么**：提交一条 Task，**无需手动点每一步**，它自动从 `created → ready → executing → succeeded` 跑到产出。全过程状态实时可见、可追踪；对同一 `input_snapshot` 重放能得到等价结果。
- **怎么算搭完**：状态自动流转；可重放（幂等）；Trace 完整。
- **复用 / 新增**：复用 B0/B1；新增执行循环（Core 的 Run loop）。

### B3 ｜门禁阻断（L0 Gate）

- **搭完能看到什么**：给 Task 配上 `build/test/lint` gate。故意提交一段会编译失败的改动 → gate **变红** → Task **不进** verifying、停在 `gating→fixing`，界面能看到失败的 gate 结果和生成的 defect。
- **怎么算搭完**：block 级 gate 失败能**真正阻断**流转（不只是报告）；GateResult 进 Artifact。
- **复用 / 新增**：复用 B2；新增 Gate 框架 + GatePlan + `gating/fixing` 态。

### B4 ｜修复回路（Fix Loop）

- **搭完能看到什么**：一个简单的 typecheck 错误，系统**自动修一轮**后 gate 变绿、Task 继续，全程无人介入。反面：把错误改成它修不动的，达到 `max_fix_loops` 或检测到「无进展（input_snapshot 没变）」→ **自动 escalate**，而不是无限死循环烧钱。
- **怎么算搭完**：失败自动退回 Executor 重试；`attempt_no` 受限；无进展检测生效；上限触发 escalate。
- **复用 / 新增**：复用 B3；新增 Fix Loop + 无进展检测。

### B5 ｜自动验收（L0 Verifier）

- **搭完能看到什么**：一条 Task 从创建一路**自动**跑到 `accepted`，验收依据是一条**可查询的谓词**（`latest_run.succeeded ∧ block gate 全过`），而不是某个 LLM 嘴上说「完成了」。
- **怎么算搭完**：L0 验收完全确定性、无人介入；accepted 由谓词判定。
- **复用 / 新增**：复用 B4；新增 L0 Verifier（确定性脚本）+ task 级完成谓词。

### B6 ｜预算熔断（横切，尽早搭）

- **搭完能看到什么**：把 `token_cap` / `wall_clock_cap` 调到很小，跑任务触顶 → **立刻熔断**：正在跑的 Run 被 cancelled、状态落盘，弹出 escalation（含**已花成本 + 当前进度快照 + 最近 accepted 锚点**）。
- **怎么算搭完**：任一预算维度触顶即熔断升级；熔断后状态可恢复（不是崩溃）。
- **复用 / 新增**：复用 B2 起的执行链；新增 Budget 中枢（全局闸，非分支）。

### B7 ｜危险动作闸（Policy / Escalation Guard）

- **搭完能看到什么**：任务试图执行 `rm -rf`、`git push`、访问白名单外路径 → 被 Policy **硬拦**，Task 进 `escalated`，等人确认；**即使「任务需要」也拦**。
- **怎么算搭完**：高危命令/越权路径被拦截；产生带上下文的 escalation；硬否决不可被绕过。
- **复用 / 新增**：复用执行链；新增 Policy 引擎 + Escalation Guard。

> **检查点 A 在此达成**（见 §3）。

### B8 ｜协作拆解（Planner→Executor→Verifier）

- **搭完能看到什么**：给一个目标「加一个 X 功能」，Planner 产出 3–5 条带依赖的 Task（TaskGraph），系统按依赖顺序逐个执行 + 验收，最后汇总。界面能看到这张 Task Graph。
- **怎么算搭完**：单目标→多 Task 自动拆解；按依赖调度；逐个走完 B0–B7 的闭环。
- **复用 / 新增**：复用单任务闭环；新增 3 角色 + TaskGraph + 最小协作引擎（Expert Hierarchy 精简版）。

### B9 ｜共识收敛

- **搭完能看到什么**：拆解方案有分歧时，能在 `max_rounds` 内**收敛到终裁者签字**；超轮次 → escalate 带「分歧快照 + 各方证据」。界面能看到「为什么这么拆」的证据链。
- **怎么算搭完**：`reached ⟺ 终裁签字 ∧ 无带证据的未决反对`；反附和规则生效；超轮次升级。
- **复用 / 新增**：复用 B8；新增 CollaborationSession 收敛语义 + 证据约束。

### B10 ｜项目聚合（Milestone / Project Acceptance）

- **搭完能看到什么**：一个**小项目**从 `ProjectContract`（含 acceptance + non_goals）一路到 `Project=accepted`，完成由**完成谓词**判定，残余风险 / follow-up 落账。能看到 Milestone Tree 的逐个 accepted。
- **怎么算搭完**：project/milestone/task 三级完成谓词可求值；残余风险有去向。
- **复用 / 新增**：复用 B9；新增 Milestone/Project 状态机 + Contract + 完成谓词 + Blocker/ResidualRisk 实体。

### B11 ｜经验沉淀（Memory Candidate）

- **搭完能看到什么**：项目结束**自动产出** memory candidates（成功范式 / 失败原因），用户**一键确认**后写入 `project_memory`；下次 Planner/Risk 能引用到它。
- **怎么算搭完**：candidate 自动生成；默认不写入、确认才入库；后续协作能检索到。
- **复用 / 新增**：复用 B10；新增 Historian 角色 + Memory 两阶段写入。

> **检查点 B 在此达成。L0 coding 自增强整条线闭环。**

### B12 ｜L1 领域（换形状不换地基）

- **搭完能看到什么**：接入一个 DataProvider，跑一个「数据查询 + 规则校验」任务，规则引擎 Verifier（L1）**自动验收**；引入 Replan 与 Resume：项目中断后能从最近 accepted 锚点恢复。
- **复用 / 新增**：复用 B0–B11 全部地基；新增 DataProvider 子类型 + 规则引擎 Verifier + Domain Gate + Replan + Resume。

### B13 ｜L2 主观

- **搭完能看到什么**：跑一个研究/内容任务（如选股研究），L2 Verifier 只产「建议 + 证据」，任务停在 `awaiting_human`，把多个结论 + 证据 + 反对意见**一次性汇聚**给人签字；并行子任务由 Integrator 合并去冲突。
- **复用 / 新增**：复用全部地基；新增研究/内容 Provider + LLM-建议型 Verifier + 人工验收汇聚点 + Expert Mesh/Debate 引擎 + Integrator 角色。

### B14 ｜高危动作

- **搭完能看到什么**：一个会下单/发布/迁移数据的任务命中 ActionProvider → 被 Risk **硬否决自动执行** → 强制 escalate（附**回滚影响**）→ 人工确认后才动手，且带 rollback_token。
- **复用 / 新增**：复用 B7 的闸；新增 ActionProvider 子类型 + 回滚预案。

### B15 ｜抽离通用底座

- **搭完能看到什么**：出现**第二个**协作消费方时，把 Peers Agent Collaboration 从 Atelier 内抽离成独立底座，两个消费方都能用；从 ≥2 个 Provider 子类型**归纳**出通用 Provider 接口。
- **复用 / 新增**：不加新功能，做一次「被第二个使用者逼出来」的抽离与归纳重构。

---

## 3. 阶段检查点（每个阶段「系统长成的样子」）

| 检查点 | 含哪些积木 | 系统这时长成的样子（一句话能演示） |
|--------|-----------|------------------------------------|
| **A 单任务自动闭环** | B0–B7 | 给一条明确的 coding 任务，它能自己执行、验证、修复，受预算和安全约束，自动验收，卡住才升级。 |
| **B L0 项目级闭环** | B8–B11 | 给一个 coding 项目目标，Agent 群拆解、协作（带共识收敛）、执行、验收、沉淀经验，全程少人介入，只在冲突/高危/超限时找你。 |
| **C 多领域可验收** | B12 | 同一套地基能跑「有客观验收信号」的非 coding 任务（数据类），并能中断恢复。 |
| **D 全场景含高危** | B13–B14 | 研究/内容这类主观任务在固定点汇聚给人签字；交易/发布等不可逆动作被硬闸拦死、带回滚。 |
| **E 通用底座** | B15 | 协作底座独立、可被多个工作台复用；Provider 通用层由实践归纳而成。 |

---

## 4. 与架构文档的关系

- 本路线是 [design.md §9](../design.md) 抽象阶段划分的**可执行展开**——design 讲「是什么」，本文件讲「一块块怎么搭、搭完什么样」。
- 每块积木用到的数据契约见 [data-model.md](../data-model.md)；关键取舍见 [decisions.md](../decisions.md)。
- 真正动代码前，按 AGENTS.md §4.3 套用 `architecture-execution-methodology`（域职责 → 执行闭环 → 依赖顺序 → 可验证交付）逐块落地。
