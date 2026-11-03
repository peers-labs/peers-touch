# 全组件合同审定与有效性方案

> 2026-10-28 · Design 审阅输入已形成。合同 DRAFT；自有库 NOT_IMPLEMENTED；Gallery NOT_BUILT；有效性与产品 Journey UNPROVEN。

> 溯源（2026-10-29 迁入活动树）：本包为**冻结审阅产物**，`validate.mjs` 的 source-fence 以原始根（交付副本 `deliverables/ui-component-foundation-20261028/`）的同级文件摘要为准。迁入后同级 `../README.md` 等已为活动树 active 版，故在本目录直接跑 `validate.mjs` 的摘要比对不适用；冻结完整性在原始根验证。运行时探针绑定不在本冻结包回填（`probeStatus` 枚举仅 `NOT_BOUND`），而由 `tooling/scripts/ui-system/suites/*.json` + `evaluate-specimens.mjs` 独立承载。

本阶段在原库存之后、代码实施之前，解决“哪些规则有依据、模型能判什么、怎样独立证伪价值”。130 份能力已全部审定登记，401 条轴被拆为有限配置、只读投影或 owner policy；134 条目录记录、269 个来源公共候选、547 个场景引用保持完整。

## 审阅入口

- [合同审定](./audit.md)：12 项明确冲突/缺口与处置，逐能力记录在 [audit.json](./audit.json)。
- [结构化模型及执行边界](./model.md)：[typed-registry.json](./typed-registry.json)、[封闭模型 Schema](./registry.schema.json)、[判定器](./evaluate.mjs)。每能力都有专项 typed constraint；人类审阅字段不伪装成已编译。
- [有效性验收](./usefulness.md)：[冻结协议提案](./usefulness-protocol.json)。选型、实质缺陷审查、真实 Journey 分别比较；复用 EDX/CER，fresh 案例与独立答卷尚不存在。
- [执行依赖提案](./execution.md)：[机器提案](./execution-proposal.json)。四项接受边界、垂直闭包、全消费者切换、预算/归因/清理。
- [来源依据](./source-basis.json)：24 个主线合同/知识/工具接口精确快照；[内容冻结清单](./freeze-manifest.json)。
- [验证结果](./validation.json)：仅来源/映射/模型/公开校准/文档检查；[520 个公开校准输入](./calibration.json)全部为同作者训练材料。

## 当前证明与剩余

已证明：本包字段、引用与 source digest 一致；有界约束在正/负/边界/缺输入条件下按明确预期判定；所有原能力与来源候选未遗漏。Schema/校准通过不能证明规范语义正确或实际有用。

尚未证明：公共 API/平台支持/Owner 接受；逐场景 operations/oracles/finalizers；真实 renderer、Gallery、读屏/光学/性能；业务接收端效果；独立选型/审查/Journey 比较。所有状态保留准确边界。

冻结只指文件内容和摘要，不等于接受规范或实施授权。后续代码实施以公共合同、平台范围和 owner 绑定明确接受为前提。
