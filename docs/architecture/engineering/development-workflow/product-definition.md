# Development Workflow 产品定义

> **Status**: active
> **Created**: 2026-09-26 | **Updated**: 2026-10-07
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/`, `tooling/scripts/plan/`

---

## 1. 产品命题

Development Workflow 是 Peers Touch 面向人类开发者与 Agent 并行研发的操作产品。它把
已经接受的产品、架构和计划工作投影为一个可观察、有边界、可由当前源码证据
验证的交付闭环。

目标用户包括：

- 需要判断每个 worktree 实际工作状态的开发者；
- 需要不可变执行根和当前 Task 边界的 Agent；
- 需要核对完成声明是否匹配当前源码与义务的 reviewer；
- 需要通过一份可执行指南理解工作流的维护者。

Development Workflow 不是通用项目管理器、CI 替代品、IDE 或运行时部署平台。

## 2. 产品承诺

开发者从一个明确选定的 worktree 执行规范安装后，应能观察：

1. 哪个 Plan 和 Task 拥有当前工作；
2. Agent 正在执行什么动作；
3. 工作是推进、等待、阻塞、停滞、循环还是发生漂移；
4. 完成声明是否通过独立的当前源码审查；
5. 每项声明由哪个 owner、命令和证据义务支撑。
6. 同一 Plan 为什么被修订、影响哪些 Task/Gate，以及是否触及 North Star。

Conversation 不得静默改变执行根。Task 或 Plan 不得因聊天文本、陈旧证据或
实现者自报成功而被判定完成。

## 3. Canonical 决策映射

`decisions.md` 是决策状态的唯一 owner。本表只提供产品追踪关系，不替代 ADR：

| ID | Canonical 含义 | 在本产品中的作用 | 状态 |
|---|---|---|---|
| DWF-D24 | Source invalidation | 当前源码证据失效时，由 Plan 声明的单一 owner 重开最早失效闭环 | accepted |
| DWF-D25 | Machine-local interaction overlay | Overlay 只能改变交互呈现，不能改变执行政策 | accepted |
| DWF-D33 | Owner-rooted binding lineage | 一个可见开发会话拥有一个 OWNER root，内部 WORKER/REVIEWER 只能作为 assigned child | accepted |
| DWF-D27 | Workflow Snapshot | 跨 owner 的只读一致性投影 | accepted |
| DWF-D28 | Completion Review | 独立的当前源码完成审查 | accepted |
| DWF-D29 | Action Receipt | 有界、脱敏的 Agent 动作收据 | accepted |
| DWF-D30 | Workflow Doctor | 可执行的工作流自诊断 | accepted |
| DWF-D38 | Frozen Plan and PlanMount | 已由 DWF-D42 取代 frozen-version 语义，保留显式 worktree 占用 | superseded |
| DWF-D32 | Cross-module resource aggregation | runtime acquisition 前统一解析 target、复用、容量与 park | accepted |
| DWF-D40 | Explicit no-Plan standalone | 用户拒绝 Plan 时不制造 tracked owner state | accepted |
| DWF-D41 | Coordinated Development close | 一个可恢复收据编排独立 owner 的关闭顺序 | accepted |
| DWF-D42 | Stable Plan amendments | North Star 必须显式批准；普通执行调整原地记录并继续，只有 North Star 变化需要重新批准与 owner 决策 | accepted |

Accepted 决策定义目标合同，不等于实现或验收已经通过。在当前源码完成验证前，
消费者仍须把尚未证明的能力投影为 `UNPROVEN`。

## 4. 能力画像

| ID | Capability | Class | Decision | Readiness claim |
|---|---|---|---|---|
| DEV-C01 | Owner-rooted execution | required | DWF-D33 | 首个可阻断工具事件绑定一个不可变 OWNER 执行根；内部会话必须携带 assignment；缺少强制能力时 fail closed |
| DEV-C02 | Truthful completion review | required | DWF-D28 | Task 和 Plan 完成需要绑定当前源码与义务的独立审查收据 |
| DEV-C03 | Development observability | required | DWF-D27/DWF-D29 | Workflow Snapshot 一次性输出 worktree、Plan、Task、活动、阻塞、漂移、循环和停滞 |
| DEV-C04 | Human and agent operating guide | required | DWF-D30 | 人类指南中的可执行声明均有机器检查 |
| DEV-C05 | Self-diagnosis | required | DWF-D30 | 一个 Doctor 入口检查安装、Hook、mount/run、状态 owner 和完成 Gate |
| DEV-C06 | Mutation from Workflow Snapshot | unsupported | DWF-D27 | Snapshot 保持只读，所有写入由 owner CLI 执行 |
| DEV-C07 | Cross-worktree writes | unsupported | DWF-D33 | OWNER lineage 可读取其他 worktree，但只能写入自己的不可变执行根 |
| DEV-C08 | Plan mount occupancy | required | DWF-D42 | 一个 worktree 在完成、取消或显式 unmount 前只执行一个 stable Plan；普通修订不重挂 |
| DEV-C09 | Plan-level resource preparation | required | DWF-D32 | 多模块影响在 runtime acquisition 前聚合；复用、容量、冲突和 park 由一个资源计划裁决 |
| DEV-C10 | Resumable Development close | required | DWF-D41 | exact selector 串行关闭 owner；只有 `DevelopmentCloseReceipt=CLOSED` 支持 close-ready |
| DEV-C11 | Explicit North Star approval | required | DWF-D42 | Agent 生成的 North Star 是 candidate；只有绑定当前 `planId + northStarDigest` 的用户决定允许 mount/execute |

## 5. 首次可用结果

目标首次闭环是：

1. 开发者运行 `make skills IDE=trae`；
2. 运行 `make workflow-snapshot`；
3. 命令输出当前 worktree 由 owner state 推导的状态记录并退出；
4. 安装路径的合成 `PreToolUse` 验证能够绑定新 conversation；
5. Doctor 对缺失或不一致环节返回 typed failure，而不是伪报
   `INSTALLED`、`COMPLETE` 或 `HEALTHY`。

这些步骤是产品验收目标，不是本文档对当前实现结果的声明。

## 6. 持续价值

- Agent 动作产生有界且脱敏的活动证据。
- Plan 百分比只来自 Task closure，Task 不使用虚构百分比。
- 源码或义务漂移会使完成审查失效；只有 source invalidation 通过 DWF-D24 的
  owner 路径重开。
- 每个 worktree 可独立诊断，无需读取其他 conversation。
- 文档中的操作声明由 Doctor 持续校验。

## 7. Non-Goals

- 自动修改声明 worktree 之外的产品源码。
- 替代 Git、Plan Package、Development Session、Acceptance 或 CI。
- 把生成状态、截图或 Agent 摘要当作完成证据。
- 为旧 Hook、旧 rollout 或 completion bypass 保留兼容路径。
- 从 Skill 路径、branch 名、工作目录或相邻仓库推断 execution root。
- 为绕过 Plan binding、lifecycle 或资源冲突而由 Agent 自建 worktree。
- 让 DWF-D25 Overlay 扩大范围、授权、证据强度或停止条件。

## 8. 产品风险

- IDE Hook 能力可能随宿主而异。安装必须执行宿主级合成回调，并明确报告
  unsupported contract。
- Agent 活动可能产生噪声。DWF-D29 只保留有界收据，并由 DWF-D27 reducer
  归并为稳定状态。
- 完成审查可能流于形式。DWF-D28/DWF-D37 必须绑定 source、obligation、
  delegated assessment provenance、findings 和 verdict，并在漂移后失效；
  独立 reviewer launch 由 Dev Workflow 编排。
- Doctor 可能误把局部成功当作整体健康。DWF-D30 必须逐项检查产品承诺并以
  非零退出码暴露 required failure。

## 9. 平台适配

| Capability | TRAE | Cursor/Codex | Browser |
|---|---|---|---|
| Binding projection | DWF-D33 目标能力；需 installed-path proof | 保留 host adapter 合同；逐宿主证明 owner/child lineage | 不适用 |
| Completion Review | DWF-D28 host-neutral 目标 | 同一 host-neutral 合同 | 只读投影 |
| Progress and activity | DWF-D29 收据输入 | adapter 能力需单独证明 | DWF-D27 Snapshot 投影 |
| Workflow Doctor | DWF-D30 完整检查目标 | 未证明能力必须显示 unsupported/unproven | 只展示 server/read-model 状态 |

本文档不宣称任何平台单元已经通过；平台 readiness 必须由当前目标源码和对应
Acceptance 单元独立证明。

## 10. 可行性闭环

| Capability | Canonical basis | Missing closure | Smallest executable proof |
|---|---|---|---|
| DEV-C01 | DWF-D33 已定义 owner/child binding 约束 | 对目标源码、安装投影和宿主回调做当前验证 | 临时宿主目录安装加合成 `PreToolUse` |
| DEV-C02 | Plan、Task、Session 和 lifecycle owner 已定义 | 实现并验证独立 request/receipt 与 closure guard | 缺失/陈旧 receipt 被拒，精确 receipt 通过 |
| DEV-C03 | Workflow Snapshot 是按需只读投影 | 接入 owner snapshot、action reducer 与 review state | CLI/library contract 验证投影一致性 |
| DEV-C04 | 架构文档和应用 README 已存在 | 确立唯一操作指南并将每条命令纳入 truth audit | 从干净 worktree 执行所有已声明命令 |
| DEV-C05 | 现有 audit 可作为候选检查输入 | 组合为一个 typed Doctor 并验证公开承诺 | healthy fixture 与故障注入 fixture |
| DEV-C08 | PlanMount 隔离同步进入仓库的外来 Plan | 增加 stable Plan、snapshot history、run、in-place amendment 与显式 unmount | mount conflict、amendment、snapshot immutability 与并发测试 |
| DEV-C09 | Machine ledger、Local Dev lease 和 Acceptance runtime manifest 已有明确 owner | 增加标准 ModuleImpact、target closure 与 fenced PlanResourcePlan | 多模块、复用、容量不足、all-or-none、quarantine replacement 与跨 Plan 冲突测试 |
| DEV-C10 | Declaration、Session、active-work、PlanMount、lease 与 environment 已有独立 owner | 增加幂等 close coordinator、receipt 与新任务准入守卫 | 中断恢复、错误 owner、tracked/standalone、cancel 和 deleted-worktree orphan 测试 |

表中 `Canonical basis` 只说明可继续设计或实现的当前输入，不构成实现完成或
Acceptance 通过证明。

## 11. Snapshot 证据边界

Workflow Snapshot 以一次性 JSON 保留以下信息层级：

```text
worktree identity
  -> Plan progress
      -> current Task progress
          -> agent activity / blocker / review state
```

Snapshot 不启动 server 或 browser，也不持有刷新状态。其他 worktree 的端口
状态、测试计数或历史运行结果不能作为当前证明。
