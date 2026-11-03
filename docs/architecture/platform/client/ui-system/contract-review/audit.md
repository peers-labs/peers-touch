# 全组件合同审定

> 本包是 Design 审阅输入；没有生效 active 合同或实现自有库。全部 134 条目录记录、130 份能力合同、269 个来源公共候选已进入核对。独立接受与产品有效性仍 UNPROVEN。

## 直接结论

现有 draft 不能直接作为代码生成规范。发现了动作表示与动效真源冲突、混合轴、业务投影默认值、缺 operation/oracle/finalizer 与 owner 绑定。机器模型已给出有限域和逐能力约束；它只判读输入投影，不会从自然语言或布尔值推断真实 UI 行为。

### UI-AUDIT-01 · BLOCKING_CONFLICT

危险操作纯图标入口与 active EDX §4.6 冲突。

处置：preserve active EDX; IconButton 限低风险重复命令；危险操作采用具名 Button/ConfirmDialog，确认面不能豁免入口。

状态：`MODEL_RESOLVED_PROPOSED_CORRECTION`；依据：`basis.edx`、`basis.components`。影响 1 份合同，逐项引用见 [audit.json](./audit.json)。

### UI-AUDIT-02 · BLOCKING_CONFLICT

审阅稿标准/进入/退出曲线与 active tokens §8 不同。

处置：默认沿用 active 100/200/300ms 与登记 curve；新曲线须单独 Product/Asset amendment 和动态对比，当前模型不提升其地位。

状态：`MODEL_RESOLVED_PRESERVE_ACTIVE`；依据：`basis.tokens`。影响 2 份合同，逐项引用见 [audit.json](./audit.json)。

### UI-AUDIT-03 · CUTOVER_REQUIRED

现行 components、component map、prototype Skill 仍指导直接 LobeUI/antd，目标自有 UI 尚未生效。

处置：同一全消费者切换更新优先级、Skill、知识和导航；本包不改 active 规则。

状态：`PENDING_ARCHITECTURE_ACCEPTANCE_AND_CUTOVER`；依据：`basis.components`、`basis.componentMap`、`basis.prototype`。影响 130 份合同，逐项引用见 [audit.json](./audit.json)。

### UI-AUDIT-04 · MODEL_DEFECT

业务状态、平台 capability、query/risk 与可选 variant 混列，静态 default 会制造事实。

处置：区分 CONFIGURATION / READ_ONLY_PROJECTION / OWNER_POLICY，未知不合成为 ready/zero/success。

状态：`MODEL_RESOLVED_PROPOSED_CORRECTION`；依据：`basis.interaction`、`basis.reasoning`。影响 130 份合同，逐项引用见 [audit.json](./audit.json)。

### UI-AUDIT-05 · MODEL_DEFECT

输入入口、操作集合、限制记录写作 slash enum，互斥关系不成立。

处置：显式 set、limits-policy、bounds-policy、deadline-policy；保留 required/derived，不自动选第一项。

状态：`MODEL_RESOLVED_PROPOSED_CORRECTION`；依据：`basis.form`。影响 5 份合同，逐项引用见 [audit.json](./audit.json)。

### UI-AUDIT-06 · BINDING_GAP

547 条场景是自然语言要求，没有实际 operations/oracles/finalizers。

处置：逐条标 NEEDS_CASE_SPECIFIC_OPERATION_ORACLE_AND_FINALIZER；约束校准不升级为 Gallery/产品证据。

状态：`UNPROVEN_IMPLEMENTATION_BINDING`；依据：`basis.edx`、`basis.reviewBinding`。影响 130 份合同，逐项引用见 [audit.json](./audit.json)。

### UI-AUDIT-07 · BINDING_GAP

130 个 Owner 只有角色；没有人员/模块引用及平台 cell。

处置：ownerRef=null；按已存在 owner 绑定，不新增业务状态机；实际 supported renderer 单独确定。

状态：`OWNER_UNASSIGNED`；依据：`basis.reasoning`。影响 130 份合同，逐项引用见 [audit.json](./audit.json)。

### UI-AUDIT-08 · OWNERSHIP_RISK

资源 source/保存/OS handle 容易把解析、授权、缓存迁入 UI。

处置：沿 existing resource owner 和授权 asset bridge；公开合同只接受受限 projection/port。

状态：`MODEL_RESOLVED_OWNER_BINDING_REQUIRED`；依据：`basis.components`、`basis.nativeAsset`。影响 5 份合同，逐项引用见 [audit.json](./audit.json)。

### UI-AUDIT-09 · POLICY_GAP

现有 identity-before-edit owns 未包含 packages/ui，可能绕过共同合同。

处置：正式切换扩展路径覆盖，同一个 canonical registry 派生导航。

状态：`PENDING_ATOMIC_CUTOVER`；依据：`basis.identityInvariant`。影响 130 份合同，逐项引用见 [audit.json](./audit.json)。

### UI-AUDIT-10 · SPECIFIC_RISK

二维码模块、缩放/quiet zone、真实设备扫描不属于普通 Icon 光学合同。

处置：独立 QR capability refinement；session/确认回读与真实光学扫描分开验证。

状态：`UNPROVEN_NATIVE_OPTICAL_AND_BINDING`；依据：`basis.qr`。影响 2 份合同，逐项引用见 [audit.json](./audit.json)。

### UI-AUDIT-11 · MODEL_DEFECT

全集文档共用 family 描述不能推出万能 Input/Overlay；值语义、关闭/提交边界不同。

处置：typed discriminants + capability-specific bindings；模板只是 review projection，不是一个通用 renderer API。

状态：`MODEL_RESOLVED_PROPOSED_CORRECTION`；依据：`basis.form`、`basis.components`。影响 5 份合同，逐项引用见 [audit.json](./audit.json)。

### UI-AUDIT-12 · PROOF_BOUNDARY

规范重复计数和 JSON 合法不能证明选型、评审及产品结果提升。

处置：复用 EDX reasoning 与 CER；独立新案例、匹配 baseline、真实 Journey 和成本向量；当前 usefulness UNPROVEN。

状态：`UNPROVEN_USEFULNESS`；依据：`basis.reasoning`、`basis.comparative`。影响 130 份合同，逐项引用见 [audit.json](./audit.json)。

## 审定范围

每份合同都核对十个维度；[逐项记录](./audit.json)保留每条轴的类型、默认政策、约束与未证实项。规则与模型修正可供接受，但 authored calibration 只能证明判定器按这些提案运行；不能证明提案正确、场景充分或整个规范有用。跨能力公共字段及几何仍需具名 owner 审阅。

## 当前依据

主线依据冻结到 `879e4d51133b7372272b2cba0037f04d63e73913`。库存/source-audit 的旧身份仍作为历史输入保存；没有把旧的 1,109 文件扫描计数改称此次主线全量扫描。新审定只冻结下面明确列出的合同/知识/工具接口。

- `basis.identity`：`docs/client/common/ui-identity/README.md` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/identity.md)。
- `basis.components`：`docs/client/common/ui-identity/components.md` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/components.md)。
- `basis.tokens`：`docs/client/common/ui-identity/tokens.md` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/tokens.md)。
- `basis.accessibility`：`docs/client/common/ui-identity/accessibility.md` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/accessibility.md)。
- `basis.interaction`：`docs/client/common/ui-identity/interaction.md` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/interaction.md)。
- `basis.optimistic`：`docs/client/common/ui-identity/patterns/optimistic-commit.md` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/optimistic.md)。
- `basis.componentMap`：`docs/client/common/ui-identity/component-spec-map.md` @ `879e4d51133b`，DRAFT_INVENTORY；[冻结内容](./sources/componentMap.md)。
- `basis.form`：`docs/client/common/form-control-ux-contract.md` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/form.md)。
- `basis.ux`：`docs/client/common/ux-design-methodology.md` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/ux.md)。
- `basis.edx`：`docs/architecture/engineering/experience-design/design.md` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/edx.md)。
- `basis.reasoning`：`docs/architecture/engineering/experience-design/reasoning-kernel.md` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/reasoning.md)。
- `basis.comparative`：`docs/architecture/engineering/experience-design/comparative-experience-review.md` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/comparative.md)。
- `basis.grammar`：`docs/client/common/ui-identity/grammar-bindings.json` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/grammar.json)。
- `basis.edxRules`：`docs/architecture/engineering/experience-design/rules.json` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/edxRules.json)。
- `basis.compositeInvariant`：`docs/knowledge/invariants/composite-form-control-boundaries.md` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/compositeInvariant.md)。
- `basis.identityInvariant`：`docs/knowledge/invariants/client-ui-identity-before-edit.md` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/identityInvariant.md)。
- `basis.qr`：`docs/knowledge/pitfalls/qr-transform-measurement-density-budget.md` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/qr.md)。
- `basis.nativeAsset`：`docs/knowledge/pitfalls/native-selected-file-preview-requires-asset-authorization.md` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/nativeAsset.md)。
- `basis.reviewBinding`：`docs/knowledge/pitfalls/experience-review-binding-and-graph-closure.md` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/reviewBinding.md)。
- `basis.prototype`：`tooling/skills/pt-prototype-design/SKILL.md` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/prototype.md)。
- `basis.workflow`：`tooling/skills/pt-dev-workflow/SKILL.md` @ `879e4d51133b`，ACTIVE_CONTRACT_OR_KNOWLEDGE；[冻结内容](./sources/workflow.md)。
- `basis.comparativeSchema`：`tooling/scripts/experience-design/comparative-schema.mjs` @ `879e4d51133b`，SOURCE_INTERFACE；[冻结内容](./sources/comparativeSchema.mjs)。
- `basis.reviewSchema`：`tooling/scripts/experience-design/review-result-schema.mjs` @ `879e4d51133b`，SOURCE_INTERFACE；[冻结内容](./sources/reviewSchema.mjs)。
- `basis.holdout`：`tooling/scripts/experience-design/holdout.mjs` @ `879e4d51133b`，SOURCE_INTERFACE；[冻结内容](./sources/holdout.mjs)。

技能负责调度，不能覆盖产品语义；上游代码负责发现能力，不能批准 Peers 公共 API。component-spec-map 虽已进入主线导航，frontmatter 与正文都仍为 draft/skeleton。正式整合应填充这个入口并派生索引，避免第二个 active 真源。
