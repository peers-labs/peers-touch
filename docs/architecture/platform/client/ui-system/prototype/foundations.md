# Frontend Eles — 基础候选合同

> **Status**: superseded（2026-11-01，增量 25）。本文记录的表达研究、三方向候选与
> 20 项基础组件批次已退役：Gallery 旧 tab（expression / foundations / basics /
> consumer / catalogue）删除，候选结论沉淀进
> [self-training-methodology.md](./self-training-methodology.md) 与
> north-star-pine-glass 候选主题；当前能力真值是基础元素 tab 的
> `registry.ts`（已验收 / 已实现待样本 / 缺口）。下文保留为历史来源。

> ~~**Status**: draft~~
> **Created**: 2026-10-28 | **Updated**: 2026-10-29
> **Owner**: Client Platform / UI System

## Purpose And Trace

本步属于 [UI-20261028 / UI-F01、UI-F03](../execution-plans/20261028-ui-system/plan.md)，
为 [EDX](../../../../engineering/experience-design/README.md) 既有 Agent UI/UX
推理提供可审阅的设计基准输入。它是候选样本，不是 accepted Grammar、生产
替换或新设计流程。所有六维均待用户逐项确认。

Thesis：把参考的色彩、材质、排版、空间与状态表达共同用于我们的 Agent 元素。
暖白/奶油底层、薄荷与灰青表面、琥珀选择和深色动作形成角色关系，
局部色彩弥散、透光身份层、短阴影与细边界形成层次。
主对象是 Agent Groups，包含成员选择、名称/描述/编排、
当前组预览与讨论；字段来自现有产品，身份来自现有 Agent 原型。
控件几何保持方圆规则；动作只作用于本地示例，不发送业务请求。

## Editorial Expression Specimens

视觉研究输入：[外部表达参考（脱敏研究，不入仓）](./README.md)。
它记录用户指定参考、同上传者作品与当前样本的差距；不代表候选已得到认可。

默认入口 `?site=frontend-eles&eles=expression`，可单看
`&sample=selection|input|preview`。组合视图共享当前组草稿；
单项查看保留草稿状态。既有基础拆解仍在 `eles=foundations`。

视觉论点：用 Agent 身份、专长与成员关系承载内容，而非参考业务素材。
成员项紧凑并列，以薄荷、奶油与灰青材质区分相应身份；其半透明方圆层
承载 Code Review、Writing Assistant、DevOps Agent 原有标记，不增加业务资产。
编排方式使用深色动作面，成员选择使用琥珀强调。
成员关系区域由已选身份与编排方式派生；摘要跨其下边缘附着，方圆头像沿讨论起点排列。
小标题、细图标、轻字重、较大计数和元信息形成层级；不对正文泛用玻璃或模糊。
方圆来自既有 `geometry.radius` 与控件密度；不引入圆形按钮或胶囊输入。
数值和材质集中于 `packages/ui/tokens/src/expression-candidate.ts`；
`expressionCandidate` 带 `draft` / `specimen-review`，生产token不消费它。

signature 候选：成员、编排、摘要和讨论共享同一组对象，状态变化明确反映到预览。
用户给出的图作为表达校准；不复制其中的圆形控件、业务数据、品牌或图片。
局部静态渐变用于身份和关系区域的材质表达；阅读、输入与动作保持明确边界。
hover/press只有短距离反馈；焦点有可见轮廓，禁用保留原因，
创建反馈同步动作与组状态。reduced-motion移除位移与过渡，不使用持续装饰动效。
字段依据：`apps/desktop/src/pages/AgentGroupsPage.tsx` 的 name/description/orchestrationMode；
身份依据：`packages/prototypes/desktop/features/agent/src/runtime.ts` 的 Code Review、
Writing Assistant、DevOps Agent。样本专长/说明是相应职责的短表达，不代表实际运行结果。
摘要计数派生成员和本地讨论；创建只记录本地示例状态，输入清空并保留消息焦点。
状态仅在 mounted `AgentStyleStudy` 存活，不保存密码、确认状态或业务数据。
组件完整交互与独立EDX准入仍在后续阶段，本轮不晋升confirmed。

## Candidate Directions

三方向同内容、同语义、同图标资产，同一 renderer：

- 清晰：中性矿白、克制蓝色、开阔文字层级、轻边界；优先日常阅读。
- 温和：暖纸与深褐、适量红铜、舒展比例；优先人和共同创作。
- 精密：冷白与墨绿、紧凑但可读的轨道、方正轮廓；优先高频组织。

差异是表达候选，不是主题批准。不能拼接各方向局部值再称为统一体系。
最终需要对整体组合和各基础角色同时确认。
数值集中在 `packages/ui/tokens/src/foundation-candidates.ts`；
输出带 `status: draft`、`allowedUse: specimen-review`，只在 Gallery 的 scoped
UIProvider 使用。active `getUITokens()` 保持独立，禁止候选污染生产。

## Six Dimensions

- 文字：页面/章节/条目/正文/元信息；中英文、扩展文案、持续阅读。
- 几何：size-relative 圆角方形、比例、间距、线条；图标和控制不是全圆。
- 色彩：阅读/动作/分隔/状态角色；不用颜色单独表达状态。
- 图标：已有语义资产的候选线重、尺寸和图文光学关系；不代表完整图标集已重做。
- 表面：画布、阅读、轻分组和真正抬升的浮层；内容面不泛用玻璃。
- 布局：共同阅读轴、元信息/动作轨道、混合行高、窄屏重排。

用户已对当前方向给出正向反馈，并明确授权整批制作20项基础组件供查看。
20项使用同一draft表达，逐项基准和组件认可仍待完成；其余89高级、21业务组合与交互逐批推进。
130项目录完整保留。原基础样本退出当前审阅，不作为 accepted 依据。

## Foundation Component Batch

入口 `?site=frontend-eles&eles=basics`，总览精确覆盖目录中的20基础ID。
文字、图标、按钮/分支动作、图标动作/动作组、链接、人物/Agent/群头像、
文件类型、原生表情、计数、标签、快捷键、内容表面、分隔、Flex/Center、
Grid、Card和PageHeader复用公共导出；总览与目录单项使用同一renderer。
`standard / long / disabled` 控制样本文案和动作可用性，不表示业务投影。
本地版本、计数、移除/恢复、收藏、示例创建与快捷键有实际状态反馈。
EmojiArtwork此批为目录允许的原生text模式，插画资源版未制作。

材质外观集中在Web Owner `packages/ui/web/src/expression.css`，
只在明确带 `pt-expression-candidate` 的scoped UIProvider启用；
颜色仍来自draft token Owner。原型CSS只组织总览、阅读轨道和示例内容。
20项有界基础样本无高级引擎挂载，不引入业务store、计时器或远程写请求。

边界合同：quiet / inline动作的hover不能引入未声明边框；
Segmented每个目标拥有独立留白，焦点内收且仍清晰可见，选中不等同hover。
编排方式复用共享Segmented，禁用保留原因。分支菜单执行或Escape返回入口，
outside关闭保留用户新选中的焦点。材质层只改变表达，不拥有命令或授权。

## Calibration And Boundaries

继承 shared UI Identity 的语义角色、关系轴、rounded-square 身份、可读性、
克制强调色及原Owner边界；候选允许调整比例、节奏、线重和中性色表达。
signature 候选是“同一内容共享稳定轨道”：主体、人物与状态沿同一轴连续展开。

保留：内容先于装饰；留白服务阅读；一处强调；浮层有层次理由。
拒绝：SaaS 卡片拼图、装饰渐变、到处玻璃、胶囊堆叠、低对比小字、仿制Apple标识。

Apple HIG 作为工艺校准来源：
[Layout](https://developer.apple.com/design/human-interface-guidelines/layout)、
[Typography](https://developer.apple.com/design/human-interface-guidelines/typography)、
[Branding](https://developer.apple.com/design/human-interface-guidelines/branding)、
[Materials](https://developer.apple.com/design/human-interface-guidelines/materials)。
采用内容优先、光学平衡、渐进披露与按层级使用材质；没有Apple品质认证或实测
对比证据，不声明达到相同水平。

Shell由Portal拥有；Gallery拥有候选比较轨道；主题由scoped UIProvider派生。
一次挂载三个有界 Agent 元素样本或一个单项，不挂载多个业务页面。
基础拆解仅挂载所选维度的1或3个样本。
整批查看挂载20项有界基础样本；单项查看只挂载一项，不挂载高级/业务全集，
不订阅业务runtime/store。
切换不做装饰动效；reduced-motion语义不变。URL只保存审阅位置，不保存确认。

## Evidence And Admission

当前为 drafting，供明确授权的基础探索。EDX独立ReviewResult/准入与CER收益
尚未证明，不生成独立receipt，不称高保真准入已通过或pending-review/confirmed。
本轮L1/L2/L3仅检查样本阅读和Gallery操作；正式组件交互在UI-F05。

本轮必检：整版材质、摘要跨边缘附着、浅深色、390px/宽屏、方圆几何、
成员/关系/编排选择、名称/目标输入、hover/reduced-motion、
摘要计数、空名称/无成员/空消息禁用、消息焦点、单项查看、深链刷新、
内容无横向溢出及退出卸载，截图须实际打开。
UI-F03另检20项精确覆盖、单项深链、标准/长文案/禁用、菜单焦点、
标签移除恢复、计数上限与真实名称、快捷键、卡片和标题动作。
真实读屏、触摸设备、生产性能分布、原生平台、用户认可及Agent效果均为UNPROVEN。
