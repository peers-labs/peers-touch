# UI/UX Skill、知识与 Agent 入口审计

> SOURCE_ONLY。只评价本轮“组件选型与自有库”需要的具体能力，不宣称整个 UI/UX 框架不合格。

## 1. 有效基础

- UI Identity foundations/interaction/accessibility：已有意图优先、真实状态、draft 保留、局部反馈、focus/reduced motion。
- components.md：已有 24/28/30/32/34/36/40 按钮尺度、圆角方形、同实体一组件、重复行轨道。
- composite-form-control-boundaries invariant：已有一个意图一个 FieldFrame、Icon/Label/Status slots；不能重造第二套错误/focus 规则。
- pt-frontend-component-tree-review：已有 Desktop/Mobile 生命周期与 Runtime/PageHost 区分；组件库不得改写。
- craft-quality 与 pt-prototype-design：已有动态证据、反例、独立评审和 Owner 确认；当前库存不是 UX PASS。
- ux-case-to-contract playbook：已有“先查现有合同→局部/族/跨端层级→平台 refinement→索引/证据”的路径。

## 2. 明确缺口

**G01 自有公共实现缺失**

- 依据：packages/ui/desktop/src/index.ts 是空导出；业务无实际消费。
- 影响：Skill 要求归一风格，但无自有 API 可以落实。
- 目标：自有 controls/render/contracts/assets + 全消费者闭包，不能以 wrapper/re-export 充数。

**G02 技术栈规则与新目标冲突**

- 依据：pt-prototype-design §3 要求 LobeUI 优先、antd 兜底、lucide/react-layout-kit；末尾 checklist 要求使用这组依赖。components.md §1/2 同样优先 LobeUI。
- 影响：Agent 遵循现有规则会继续直接调用上游。
- 目标：同一切换中改为 Peers API，内部低层 engines 单独治理；UI Identity 原则保留。

**G03 无全族场景合同入口**

- 依据：主线 UI Identity README 已登记 component-spec-map，但它仍为 draft/skeleton，没有完整全族 variant/scenario/implementation/specimen 合同；components.md 的 Buttons 只覆盖角色与通用约束。
- 影响：Agent 无法判断 Button/Link/Toggle、Submit/Stop/Retry 等合法关系，也不知未定义时找谁。
- 目标：canonical registry 派生 spec index；本包的 [逐项规范](./specs/README.md) 已对全部 134 条目录记录按同维度整理，Button B01–B20 作为补充。不能只要求 Agent 模仿 Button，再自行猜其它组件。

**G04 文档与数值真源分裂**

- 依据：shared prototype tokens 的 #667eea、140/240ms 与 Shell/focus 的 #6b5bd6 不同；图标直接 strokeWidth 分散。
- 影响：读取原则不能保证实际一致。
- 目标：唯一 token/asset numerical source + renderer generation；具体变化由打样验证，不能仅统一字符串。

**G05 没有同合同驱动的全量打样**

- 依据：已有业务原型和 Portal，但本次盘点未发现自有 UI 公共全族 Gallery；自有 package 无实现可供其消费。
- 影响：UI/UX Agent 没有可操作 reference specimen，对状态/恢复/motion 的判断缺底片。
- 目标：Portal 内 Gallery，所有公开组合/反例/平台 cell 可查；mock 与真实产品证据分别标注。

**G06 路径规则覆盖不足**

- 依据：client-ui-identity-before-edit owns 包含 apps/desktop/mobile、prototypes、docs，未列 packages/ui。
- 影响：新增自有包可能绕过现有 identity 和 component policy。
- 目标：新 invariant 覆盖实际库路径和 domain views，旧条目 superseded-by；read-before-edit 加载同一合同。

**G07 无组件缺口的统一 Owner 输入**

- 依据：现有 playbook 有 Product/Engineer/Reviewer 角色，但缺 capability/variant/state/platform 缺口的封闭输入与具体 ownerRef。
- 影响：Agent 可能私自造件，或对每一个问题反复问用户。
- 目标：OwnerGap 按 data-model.md；已接受规则能裁定则 Agent 修复，只有实质产品取舍升级。

## 3. 目标 Skill 索引

以下链接是**拟生效 canonical 路径**，目前未落库；本包现有对应文档在括号中。

- UI/UX 总入口：docs/client/common/ui-identity/README.md。
- 全集：docs/client/common/ui-identity/component-specs/README.md（[本轮源码全集](./component-catalog.md)、[逐项合同入口](./specs/README.md)）。
- 查找合同：packages/ui/contracts/catalog（[机器合同索引](./component-spec-index.json)、[模型](./data-model.md)）。
- 使用入口：packages/ui/web/src/public（[架构/包名](./design.md)）。
- 原型打样：Prototype Portal 的 UI System Gallery，仍由 make run-prototype 启动（[布局](./module-layout.md)）。
- icon/contour/easing：canonical component specs + tokens/assets（[本轮规范](./icon-motion-spec.md)）。
- 未表达清楚：OwnerGap→对应 UI/Domain/Presentation/Asset Owner（下节）。

在正式切换前，Agent 必须明确“现有库实现未完成”，不能将拟生效路径描述为现在可 import 的组件。

## 4. Agent 选型流程

1. 明确用户意图、对象、范围、输入方式、平台、状态真源与恢复。
2. 查 catalog 的 `deepSpecificationId/deepSpecificationRef`，沿机器索引的 `cases` 读取具体场景，判 Button/Link/Toggle、Select/Autocomplete、Overlay 等相邻选择。不能停留在名称摘要或上游 Props 摘录。
3. 检查 supported renderer、variant、anatomy、keyboard、失败/恢复和 token/icon/motion。
4. 查已有同实体/同组件实现，再查真实 specimen；不直接从上游组件名开始画界面。
5. 已有合同适用：使用自有 import 与既有 semantics；不页面内修默认样式。
6. 未覆盖或有冲突：提交 OwnerGap；不得标 UI/UX correct、不得 invent success。
7. 补合同后更新 registry、实现、specimen、索引和影响证据；受影响 proof 失效并重跑。

## 5. OwnerGap 提交模板

```text
component/capability:
usage-case / user task:
platform / viewport / input mode:
object / state owner:
existing spec checked:
why it does not cover:
missing capability / variant / state / copy / geometry / motion / platform / evidence:
source / visual / dynamic evidence:
proposed disposition and impact:
owner role / ownerRef:
blocking semantic choice:
```

- UI System Owner：控件语义/anatomy/variant、基线 token/focus/recovery。
- Domain Owner：消息/关系/Agent/附件/权限事实、命令和业务可逆性。
- Presentation Owner：Desktop/Mobile/Lynx 的输入、layout/lifetime/native adapter。
- Asset/Motion Owner：glyph/品牌许可、光学特例、curve/token。
- UX Reviewer：对真实样本作 findings-first 判断；不能代替业务 Owner 签发状态。

人员映射尚未建立，标 OWNER_UNASSIGNED，不虚构姓名或自动发消息。授权范围内可先准备完整 gap artifact；实际对外发送另需明确授权。

## 6. 本轮检查的相关来源

- tooling/skills/pt-product-design-methodology/SKILL.md。
- tooling/skills/pt-prototype-design/SKILL.md。
- tooling/skills/pt-frontend-component-tree-review/SKILL.md。
- tooling/skills/pt-prototype-replica-guard/SKILL.md。
- docs/client/common/ui-identity/* 现有 foundation、components、interaction、tokens、accessibility、craft。
- docs/knowledge/invariants/client-ui-identity-before-edit.md。
- docs/knowledge/invariants/composite-form-control-boundaries.md。
- docs/knowledge/playbooks/ux-case-to-contract.md。
- docs/knowledge/pitfalls/social-ui-identity-surface-fragmentation.md。

这是针对本需求的源码与文档审计；没有擅自修改 Skills 或把新 draft 加为硬权限门禁。
