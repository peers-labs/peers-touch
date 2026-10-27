# Acceptance 执行模型提案

> **Status**: draft
> **Authority**: non-normative
> **Created**: 2026-10-22 | **Updated**: 2026-10-26
> **Owner**: Acceptance
> **Module**: `tooling/acceptance/`

This proposal is retained for unresolved design work and historical analysis.
It is not an operating guide. Current behavior is defined by the active
[Acceptance architecture](../../README.md) and executable contracts.

## 范围

本提案修订现有 Acceptance 的执行关系：基础能力先证明，Suite 统一持有资源，
一个场景执行产生多个可引用的断言，Gate 按自己的合同判定。
核心工程目标是有效反馈进入秒级、热态闭环进入分钟级，并让框架以真实指标
诊断和优化自己的执行成本。时延目标、样本口径和自优化边界属于架构合同。
它属于现有 Acceptance 模块，不建立另一个框架、工作流或审批系统。

上游是现有 Acceptance D-20、D-21、操作语言设计和当前 Development Workflow。
本提案不改变 Chat/Social 产品语义，也不替代尚未完成的原生产品回归。
Only the items marked `STILL PROPOSED` below remain proposed. Landed behavior
is governed by active documents and source, not by this draft.

## 已核实的问题

- R001-05 的功能和证明命令重复相同 19 个 Chat Gate。
- R001-06 的功能和证明命令重复相同 5 个 Moments Gate。
- 两个 interactions Gate 还各自执行完整 Direct＋Group 场景。
- 外层 Runner 按 Gate 准备、清理资源，无法通过相同 environment 自动复用。
- 普通 Mobile 登录前置无条件重启 WebView，还等待 Social 就绪。
- 现有流水线审计检查声明与账本，尚不检查命令对应的实际执行图。

“都发消息”不足以判断重复。场景中的消息可能是登录接管、离线恢复、MLS
成员移除或未读变化的探针，必须保留对应条件和独立断言。
能发出消息也不等于完成接收解密、防篡改和拒绝越权验收。

## 目标

1. 用户选择的能力集合展开为可解释的前置和证明依赖图。
2. 同一执行身份的场景只有一个生产者；多个 Gate 读取其精确断言。
3. 资源复用不削弱设备、账号、平台、拓扑、故障条件和证据强度。
4. 新 Gate 接入时由机器检查 ownership、依赖、覆盖和重复执行。
5. 功能调试、正式证明和发布聚合保持各自语义，避免重复的大范围运行。
6. 记录完整阶段时间线、关键路径、返工放大和证明完整性，约束端到端时延。
7. 由框架自动选择合法的复用、缓存、并发和等待策略，验证收益并控制自身开销。

## 文档入口

- [盘点与源码依据](audit.md)：确定的重复、必要重复和未知范围。
- [架构设计](design.md)：依赖图、资源边界、执行与失败语义。
- [耗时调查](performance-research.md)：历史 114 次运行、规划探针与取证成本。
- [时延与自优化设计](performance-design.md)：SLO、指标、策略控制器和框架效率 Gate。
- [数据模型](data-model.md)：执行身份、证据关系与状态转换。
- [设计决策](decisions.md)：选择、替代方案和代价。
- [现有系统集成](integration.md)：已有实现的保留、替换和回归要求。
- [模块职责](module-layout.md)：唯一注册源、依赖方向和防复发约束。

## Disposition

### LANDED

- Explicit execution dependency graph and prerequisite evidence references.
- Closed execution-input qualification and current-source revalidation.
- Fixed-scope bounded continuation with durable session and repair records.
- Suite lifecycle ledger, reuse audit, and supporting-evidence boundary.
- Lifecycle budgets, cleanup/publication reserve, and first-over-budget stop.

These contracts now belong to active source and architecture documents. Their
draft descriptions here may be stale and carry no authority.

### STILL PROPOSED

- One business Scenario producer serving multiple Gate judgments without
  weakening each Gate's Oracle or evidence strength.
- Actual outer Suite ownership and reuse of product resources across Gates.
- Accepted end-to-end performance SLOs, policy controller, and measured
  parallel scheduling.

### HISTORICAL

- The PR #150, R001, 17-Gate, 114-run, 60-source-version, and 67-Gate release
  references describe the 2026-10-22 investigation only.
- Those observations are neither a current performance baseline nor product
  readiness evidence.

Any remaining proposal requires a fresh current-source audit, acceptance into
the active decision record, implementation, and current evidence before it can
become operating guidance.
