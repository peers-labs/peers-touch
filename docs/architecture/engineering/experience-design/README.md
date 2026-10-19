# Experience Reasoning Kernel

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-19 | **Updated**: 2026-10-19
> **Owner**: Experience Design

---

## 1. Document Scope

本模块定义 Peers-Touch UI/UX 评审的体验推理内核：

- 事实、产品合同、推断和未证明项的分层输入；
- 有界 Journey 的状态图、信任边界和恢复路径检查；
- 首要 Finding 的确定性选择与完整可追溯结果；
- Wireflow / Prototype 进入高保真的准入条件；
- Quality 独立拥有的盲测、计分、污染账本和晋级边界。

本模块不定义：

- 业务 Journey、信任语义、恢复承诺或平台产品行为；
- Station、Federation、Identity 等运行时状态机；
- 页面布局、视觉 token、组件库或平台适配细节；
- 答案密钥、评分逻辑、晋级裁决或发布批准；
- 自动判断产品语义真伪的通用 UI/UX 规则引擎。

## 2. 背景与问题

首次六案例盲测得到 `70/100`。评审能够保持源码证据纪律并正确通过正向对照，
但在两个案例中让真实的次要问题压过了有界 Journey 的首要产品故障：

- 缺失可见恢复入口时，分析下沉到点击后的实现路径；
- Station scope 切换时，没有继续传播身份、作用域和下一 Gate 的信任语义；
- race、键盘和其他实现风险能够挤掉更早、更强的产品合同违背。

该结果证明需要一个可复算的评审过程，而不是更多页面级启发式规则。旧案例已经
暴露并进入训练材料，不能再次作为晋级证据。

## 3. 设计目标

1. 首要 Finding 必须由合同强度、用户影响和最早可达状态确定。
2. 信任与恢复检查只投影已接受 Product / Client 合同，不发明业务语义。
3. 每个 Finding 都能回溯到闭合的事实、合同、推断和候选账本。
4. 源码风险不能在缺少可见动作与响应时成为首要 UI/UX Finding。
5. 无阻断 Finding 不等于自批准；高保真准入仍需独立评审和完整证据。
6. fresh holdout 一旦暴露即永久污染，不得通过换状态或换运行复用。
7. 最小实现只校验 schema、引用、排序和哈希，不建设通用设计规则引擎。

## 4. 文档导航

| 文档 | 说明 |
|---|---|
| [design.md](./design.md) | 四层边界、评审管线、组件关系和质量结果 |
| [decisions.md](./decisions.md) | 已接受的架构决策和明确排除项 |
| [data-model.md](./data-model.md) | ReviewResult、排序 tuple、恢复与 holdout 状态模型 |
| [module-layout.md](./module-layout.md) | 正式文档、最小工具和校准资产的目录职责 |
| [integration.md](./integration.md) | Product、Client、Prototype、Quality 和 Review 接入 |

## 5. Current State

- Architecture：`active`
- Blind calibration baseline：`70/100`，旧六案例仅作训练材料
- Minimal tooling：尚未证明
- Layer 3 admission：尚未通过 fresh holdout 晋级
