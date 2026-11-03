# 结构化合同模型及执行边界

> PROPOSED；这是可运行的审阅模型，不是产品运行时代码或已接受公共 API。

[typed-registry.json](./typed-registry.json)覆盖 134→130 映射及 269 个公共符号引用，每份能力都含逐条轴、一个按该项真实风险编写的 typed constraint、有限交互模板、ports、observable assertion 和全部原场景引用。字段已区分枚举、集合、限制/边界/精度/期限/policy 引用；default 有 literal、owner-projection 或 required-or-derived。

## 什么能执行

[evaluate.mjs](./evaluate.mjs)只支持 field/literal 及 eq/ne/lte/gte/gt/and/or/implies，缺字段或错类型为 UNPROVEN/INVALID_INPUT，非法组合为 VIOLATED。不存在 eval、脚本、函数字符串或自动修输入。引用的输入字段必须在 capability 的 evaluationInput 中声明；规则只对这个有界投影负责。

例如 Slider 检查 minimum≤lower≤upper≤maximum 和 stepAligned；DatePicker 检查 date-only 不被 UTC 转换、完整范围及有序端点；Tag 检查 purpose 与 interaction；IconButton 检查低风险、具名且重复。它们不是复制同一个 pending 模板。其余能力的专项约束均在 registry，正/负/边界/缺字段输入在 [校准数据](./calibration.json)。

执行示例：

```sh
node evaluate.mjs typed-registry.json calibration.json
node validate.mjs
```

命令均在本目录运行。输出判定及准确 claimScope；不产生 UX_PASS。

## 状态与 ports

有限机器区分 command、field、overlay、disclosure、resource、domain projection 与 passive。Copy、Download、Switch、Confirm、Secret、Freeze 有具体模板；其余 machine 是明确标注的 review interaction template。domain 枚举只保存来源提案，真实合法转移必须绑定 existing owner，不能凭 UI 文档创建新协议。

UI_INTENT_ONLY 只能提交意图；OWNER_PROJECTION/PORT_OBSERVATION 才能供终态。modal 关闭、scan、browser handoff、motion ended 不能提升为业务成功。passive 不生成 pending/retry/cancel。Ports 只有具名输入、输出、能力、失败和 scope，不透传第三方 UI type，不持 OS path/凭据/Station cache。

## 什么仍不能执行

547 条场景仍缺逐场景 operation、oracle、finalizer；probeRef 与 ownerRef 均空。anatomy、a11y、极端数据、几何与清理的自然语言完整保留在 retainedHumanReview，明确没有编译。布尔字段如 scopeDeadlineOwnerReadback 是观察输入的合同要求；只有独立 probe/资源 owner 产生的证据能证明它为真，作者填 true 永远只是校准。

因此不得声称“全部规范已可自动验收”。当前完成的是结构化审阅骨架和有界判定；下一阶段将逐能力/逐场景绑定真实 registry、renderer、operations 与 probes，才形成可执行产品合同。

## 唯一数值真源

默认保留冻结的 active tokens：instant/fast/normal/slow=0/100/200/300ms，standard=(0.645,0.045,0.355,1)、out=(0.215,0.61,0.355,1)、emphasized=(0.78,0.14,0.15,0.86)、overshoot=(0.12,0.4,0.29,1.46)。连续真实 progress 使用 fast linear，拖动/输入直接跟手。旧 icon-motion-spec 新 curve 是未接受 amendment；没有偷换生效。

视觉高度 24/28/30/32/34/36/40 与圆角 6/8/10/12 沿当前合同；44 触摸等价目标、glyph stroke 1.8、optical assets、具体品牌/暗色对比依旧待打样接受。值一致只证明引用同一来源，无法证明几何、可读性或手感质量。

## Canonical 落点

确认后 contracts 进入 packages/ui/contracts/catalog，文本从同一模型派生到现有 UI Identity/component-spec-map 与 component-specs；当前目录只是隔离审阅包。不得将 evaluator/ports 另建全局 EDX 或业务 runtime。EDX/CER 继续拥有独立评审、来源绑定、holdout 与因果比较；这个模型仅提供组件语义投影。
