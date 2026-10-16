---
name: "pt-plan-and-document"
description: "Persists accepted product, architecture, or execution models. For execution planning it renders and validates an explicit frozen Plan Version without creating runtime workspace occupancy."
stage: "PLAN"
requires: ["accepted source model", "repository documentation rules"]
produces: ["persisted documents", "validated frozen Plan Version", "review prompt"]
next: "pt-dev-workflow agent review loop"
---

# Plan And Document

本 Skill 是 repository persistence adapter：负责把已经接受的内容模型落到
正确文件、校验结构并建立可发现性。它不负责重新设计内容。

## 职责边界

本 Skill 负责：

- 查找并执行文档规范；
- 选择落盘目录和文件名；
- 渲染 accepted model；
- 创建 frozen Plan Version / Task Slice 文件；
- 运行结构校验；
- 更新导航；
- 生成 review prompt。

本 Skill 不负责：

- 定义 Product Journey 或可见状态；
- 决定架构边界、ownership、协议或 failure semantics；
- 设计 vertical closure、dependency DAG 或 Acceptance 风险；
- 选择 current Task、Ready Queue、并发 lane；
- 执行计划、测试、Acceptance 或交付；
- 修改一个未被上游方法论接受的模型来“让校验通过”。

## 触发场景

- 用户要求将讨论结果落盘为正式文档。
- `pt-architecture-execution-methodology` 已产出 accepted plan model。
- 正式 Plan Version 需要创建、机械修订或迁移。
- 文档需要按项目规范更新导航和 review prompt。

若输入仍包含产品/架构/计划语义分歧，返回对应 owner，不在本 Skill 内解决。

## 0. 显式 No-Plan 边界

若当前用户请求明确包含 `no plan`、`不要 plan`、`不创建计划` 或等价指令：

- 返回 `PLAN_PERSISTENCE_FORBIDDEN`；
- 不创建或修改 Plan Version、Task Slice 或可选任务记录；
- 不把任务规模、仓库规范、测试、Acceptance 或 PR 提交要求解释成隐式 Plan
  授权；
- 将执行权返回 `pt-dev-workflow` 的 standalone 路径。

只有用户后续明确撤销 no-Plan 指令并要求正式规划，才可重新进入本 Skill。

## 1. 选择规范和位置

先读取：

- `docs/README.md`
- `docs/global/architecture-document-standard.md`
- `docs/architecture/engineering/architecture-governance/architecture-modules.json`
- 最近的模块 `README.md`
- 对应上游方法论 Skill
- `docs/knowledge/playbooks/documenting-large-requirements.md`（大需求）

路径规则：

```text
架构真源      -> docs/architecture/<taxonomy>/<module>/
平台落地      -> docs/client/<platform>/ 或 docs/station/
编码规范      -> docs/global/coding-guide/
历史上下文    -> docs/context/
临时工作草稿  -> .trae/documents/（不是真源）
执行计划      -> <owner>/execution-plans/<date>-<slug>/
```

## 2. 持久化架构文档

遵循固定文件集：

```text
docs/architecture/<taxonomy>/<module>/
├── README.md
├── design.md
├── decisions.md
├── data-model.md       # optional
├── module-layout.md    # optional
├── integration.md      # optional
└── execution-plans/
```

每个正式文件保留 status/version/date/owner 元数据和最近 README 导航。

新建 active 架构模块，或修改尚未登记的 active 模块时，必须在同一落盘变更
中新增其正向 module registry projection。按模块特征推导
`requiredDocuments`，登记非重叠 `governedPaths`、当前 capability allowlist
和外部 capability ID 引用；不得登记已删除名称、历史别名或迁移黑名单。

## 3. 持久化 Plan Version

将 accepted plan model 渲染为：

```text
execution-plans/<date>-<slug>/
├── plan.md
├── tasks/<task-id>.md
└── archive/
```

`plan.md` 持有：

- stable goal、scope/non-goals；
- product/architecture traceability；
- Task index 和 dependency DAG；
- version identity 与 authorization；
- 唯一的 `Acceptance Execution` contract；
- 不包含 execution worktree、Task lifecycle 或 current selection。

每个 Task Slice 只持有一个 vertical closure：

- Journey/functional boundary；
- read/write set 和预算；
- focused checks；
- risk/state-based formal proof references；
- done/failure/non-claim；
- 不包含 durable evidence 或 current execution snapshot。

每个 Task Slice 同时是一个 progress unit。它必须小到一次 bounded execution
能直接验证 `doneWhen` 并明确解锁哪些后继 Task。若做不到，回到
`pt-architecture-execution-methodology` 按真实依赖拆分，禁止加入主观权重或
命令级百分比。Task 文件不保存可变 lifecycle 或 evidence。

## 4. 机械边界

- manifest 不超过 300 行 / 20 KiB；
- Task Slice 不超过 200 行 / 12 KiB；
- Plan Version 冻结后不可原地修改；
- archive 不参与 discovery、resume 或状态；
- 每个 closure 在 `Acceptance Execution` 中恰好出现一次；
- repository path 使用 repo-relative POSIX 表示；
- 不创建第二套 active plan/status 文件。

Execution plans MUST NOT contain a `## Context Anchor` section.

Context Anchor 只存在于聊天；执行进度如需跨会话恢复，由 Dev Workflow 在
消费 worktree 的 `.dev-workflow/tasks/<taskId>/` 中明确创建。

## 5. 校验和登记

1. 写入 package 和导航。
2. 运行：

```bash
make plan-validate PLAN=<package-plan.md>
node tooling/scripts/architecture/module-governance.mjs validate
```

3. 生成并记录完整 Plan Version digest；不得把 authoring worktree 写入 Plan。
4. 使用 `planctl inspect --plan <package-plan.md>` 从明确路径读取冻结版本；
   不创建 PlanMount、ExecutionRun、declaration、Session 或 active-work。
5. 复杂任务如需恢复，由 Development Run 以明确 `taskId` 创建可选任务记录，
   并把 Plan 路径与 digest 作为普通 `planRef` 保存。多个任务互不占用整个
   workspace。
6. 落盘后将 review prompt 返回 Development Run。Development Run 调用项目
   Review Skills 完成评审、修复与重审；通过后，current Task 的选择由
   Development Run 从明确 Plan 和 taskId 完成。本 Skill 不自行启动 EXECUTE，
   不创建任务记录，也不写 project memory。

## 6. 修订

机械修订只持久化上游已经接受的 delta：

- inventory/path 更新；
- dependency/deliverable mapping 更新；
- Task Slice 拆分或合并；
- risk/state proof mapping 更新；
- authorization 或 execution-worktree selection 的已批准更新。

任何已冻结内容变更都创建新的 `versionId` 和 digest；不得原地修改冻结版本。
执行 worktree 是调用方的显式输入，不修改 Plan source。

若修订改变 Journey、架构 ownership、协议、failure semantics 或 proof
strength，返回 `PRODUCT_AMENDMENT_REQUIRED`、`DESIGN_AMENDMENT_REQUIRED` 或
`PLAN_MODEL_REQUIRED`。

## 7. Review Prompt

落盘后生成独立 review prompt，至少包含：

- package path；
- product/architecture source paths；
- vertical closure 和 dependency 审查；
- scope/cutover/deletion 审查；
- risk/state-based verification 审查；
- authorization 和 claim boundary；
- `planctl validate` 结果。

Reviewer 输出 `通过 / 有条件通过 / 需要修改` 和具体 source-backed
findings。本 Skill 不自审自批，但 Development Run 必须自动将 prompt 交给
独立 Agent 或独立的 findings-first review pass，并调用适用的
`pt-quality-check`、`pt-completion-auditor`、`pt-github-review`。对 accepted
sources 已能裁决的问题，Agent 自动修复并重审；仅当存在 DWF-D20 定义的
破坏性、外部授权或无法由接受源裁决的语义选择时才升级给用户。

## 8. 完成检查

- [ ] 输入模型已被 owning methodology 接受
- [ ] 文件位置、命名、元数据、导航正确
- [ ] Plan Version 和所有 Task Slice 通过 `planctl validate`
- [ ] 涉及的 active 架构模块已登记并通过共享 module governance validator
- [ ] Plan Version digest 已冻结且不含 execution worktree identity
- [ ] `planctl inspect` 可直接读取明确 Plan Version 和 Task Slice
- [ ] `Acceptance Execution` 唯一且 closure 完整
- [ ] scenario/Gate 映射来自 product state 或 concrete risk
- [ ] frozen version 未伪造任务进度或 workspace 占位记录
- [ ] 没有 `## Context Anchor`
- [ ] review prompt 已生成
- [ ] review prompt 已交回 Development Run，未把例行评审委托给用户

## 与其他 Skill 的关系

| 输入/后续 | Owner |
|---|---|
| Product model | `pt-product-design-methodology` |
| Architecture model | `pt-architecture-design-methodology` |
| Vertical execution model | `pt-architecture-execution-methodology` |
| Development Run | `pt-dev-workflow` |
| Status projection | `pt-context-anchor` |

## 反模式

禁止：

- 覆盖用户明确的 no-Plan 指令或创建 placeholder Plan；
- 边落盘边重新设计；
- 从文件清单反推产品或架构；
- 把通用 success/network/timeout/invalid/cancel 套餐写进每个 closure；
- 创建 active 单文件计划或第二套状态表；
- 把 runtime 日志、raw output 或 Context Anchor 写进 package；
- 写共享 `project_memory.md active_work` 表；
- 从 branch、目录、mtime 或历史 active-work 猜选 Plan/Task；
- 为 Plan 使用创建或切换 worktree；
- 把 plan review prompt 当作用户交互停点；
- 由本 Skill 选择 current Task、执行或宣称完成。
