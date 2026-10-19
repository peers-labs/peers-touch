# Experience Design Control Plane

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-10-18 | **Updated**: 2026-10-20
> **Owner**: Developer Experience / Product Design
> **Module**: `tooling/scripts/experience-design/`

---

## 1. Document Scope

本模块定义 Agent 设计 Peers-Touch 用户体验时的工程控制面：

- Product Intent 到 UI Grammar 的分层合同；
- 内容语义、信息架构、任务路径、状态恢复和动作表达的机器模型；
- Wireflow、视觉原型和 L1-L4 证据之间的 trace；
- source-fenced Journey、信任、恢复和首要 Finding 推理；
- 正例、反例和边界例校准；
- contract drift、finding 路由和 fail-closed 行为。

本模块不定义：

- 具体业务模块的产品承诺、文案或页面结构；
- Desktop、Mobile 的具体视觉值和组件实现；
- 生产 UI 的业务状态或后端 authority；
- 由评估器自动批准产品、架构、原型或发布。

## 2. 背景与问题

现有方法论能约束 UI Identity 和视觉证据，但缺少一个可执行的设计中间层。
Agent 可以在视觉上遵守 token，却仍然产出重复文案、错误信息层级、过长任务路径、
缺失恢复状态或跨文档流程漂移。问题通常在高保真原型或实现后才暴露。

本控制面把这些判断前移到 Wireflow 之前，并通过结构化合同和校准 fixture 使评审
可重复。机器规则只处理可确定的合同，不替代对真实渲染和用户任务的独立判断。

## 3. 设计目标

1. 在视觉设计前冻结内容语义、信息架构、路径成本、状态恢复和动作表达。
2. 让每个设计结论可追溯到产品 Journey、Wireflow、UI Grammar 和证据。
3. 对缺失或冲突合同 fail closed，不让高保真结果掩盖语义缺口。
4. 用正例、反例和边界例共同校准，避免把个人偏好固化为全局规则。
5. 让评估器只产生 finding 和 evidence，不自批合同或自己的输出。
6. 把缺陷路由给真实 owner，而不是在 prototype 或 review 层打补丁。

## 4. 文档导航

| 文档 | 说明 |
|---|---|
| [design.md](./design.md) | 分层、边界、组件和质量 Gate |
| [decisions.md](./decisions.md) | 已选择方案、替代方案与代价 |
| [data-model.md](./data-model.md) | 合同、fixture、finding、evidence 与状态机 |
| [module-layout.md](./module-layout.md) | 真源、工具和 fixture 的目录职责 |
| [integration.md](./integration.md) | Product、Prototype、UI Identity、Review 与 Quality 接入 |
| [reasoning-kernel.md](./reasoning-kernel.md) | 下属体验推理内核、source fence 和 Finding 排序 |
| [review-result.md](./review-result.md) | ReviewResult、Journey 图、恢复、排序和 holdout 模型 |
| [execution-plans/](./execution-plans/) | 冻结执行计划 |

## 5. Current State And Downstream Entry

- 客户端方法论：
  `docs/client/common/interaction-design-methodology.md`
- UI Grammar：
  `docs/client/common/ui-identity/grammar-bindings.json`
- Rule Catalog：
  `docs/architecture/engineering/experience-design/rules.json`
- 产品设计适配器：
  `tooling/skills/pt-product-design-methodology/SKILL.md`
- 原型设计适配器：
  `tooling/skills/pt-prototype-design/SKILL.md`

当前 active 状态包含架构、方法论、UI Grammar、Rule Catalog 和 source-only
控制面实现。Product/Prototype/Quality Skills 已作为薄 consumer 切换到统一
入口：

```bash
node tooling/scripts/experience-design/experience-design.mjs check
```

架构 registry 登记 `experience.design.evaluate`。该 capability 只证明闭合
schema、确定性 finding、精确 evidence、独立 review receipt、三类 calibration
和 holdout 完整性；它不证明未见设计可用，也不替代明日真实案例的首次 blind
评审。

普通 Agent 工作流使用稳定作者/评审者 ID、精确摘要绑定和 reviewer
non-overlap，不要求用户或 Agent 管理签名密钥。内容寻址负责不可变性，独立
工作流负责语义评审与职责分离。

体验推理内核是控制面的下属组件，不是第二个模块或第二条工作流。它的第二轮
fresh holdout 得分为 `93/100`，但因把 Exit 错误编码为 RecoveryPath 出现一个
hard failure，因此该轮结果已退役且不能单独建立高保真准入。
