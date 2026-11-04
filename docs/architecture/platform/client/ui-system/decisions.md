# Peers UI — Decisions

> **Status**: active
> **Created**: 2026-10-28 | **Updated**: 2026-10-29
> **Owner**: Client Platform / UI System
> **Target Design**: UI-D05–UI-D10 为 proposed；不得作为已接受实现依据

| ID | Decision | Status |
|---|---|---|
| UI-D01 | 自有公共入口 | accepted |
| UI-D02 | 共享语义，分别证明平台 | accepted |
| UI-D03 | 业务与资源真源保留 | accepted |
| UI-D04 | 目录与证据独立 | accepted |

## UI-D01: 自有公共入口

**Status**: accepted
**Date**: 2026-10-28

### Context

空公共包和页面直接依赖供应商 API 无法承载长期统一合同。

### Decision

`@peers-touch/ui` 是 Web 公共入口。基础控件由 Peers 渲染，禁止高层供应商 import/re-export/props type 泄露。每种能力有语义合同、实现、样本和状态；参考上游只是能力发现输入。

### Rationale

由拥有状态和渲染意义的 Owner 决定合同，依赖和证据可分别替换与验证。

### Alternatives Considered

一层 re-export 仍保留供应商 props 与渲染所有权。

### Consequences

调用方依赖语义 API，自有基础控件需要维护可访问性。

## UI-D02: 共享语义，分别证明平台

**Status**: accepted
**Date**: 2026-10-28

### Context

当前两种客户端共享 Web UI，原生壳的能力与验证并不相同。

### Decision

沿 CCR-D13 复用 headless 合同；Desktop/Mobile Web 共用 renderer，密度按 presentation policy 派生。Lynx 未支持不能推导 native PASS。

### Rationale

由拥有状态和渲染意义的 Owner 决定合同，依赖和证据可分别替换与验证。

### Alternatives Considered

把 DOM 控件当成 Lynx 原生支持会伪造能力与证明。

### Consequences

合同可复用，release target 的 native 证据仍独立。

## UI-D03: 业务与资源真源保留

**Status**: accepted
**Date**: 2026-10-28

### Context

头像资源解析、消息发送和草稿状态已有业务或平台真源。

### Decision

命令、幂等、授权、草稿、身份与资源解析留在既有 Domain/Runtime Owner。控件只存瞬时 view state，实体组合不复制业务协议。

### Rationale

由拥有状态和渲染意义的 Owner 决定合同，依赖和证据可分别替换与验证。

### Alternatives Considered

把 IPC、权限或跨页草稿藏进通用 UI 会形成双真源。

### Consequences

View 通过既有 projection/action 组合；资源清理仍由原 Owner 执行。

## UI-D04: 目录与证据独立

**Status**: accepted
**Date**: 2026-10-28

### Context

清单数量、类型检查与真实用户效果具有不同证据强度。

### Decision

目录是有限能力全集；accepted、implemented、specimen-built 与 evidence 各自有字段。采用现有 EDX/CER 验证决策和真实用户效果，不用计数或自编演示证明有用。

### Rationale

由拥有状态和渲染意义的 Owner 决定合同，依赖和证据可分别替换与验证。

### Alternatives Considered

从 Gallery 或静态 schema 自动推广 PASS 无法证伪用途。

### Consequences

保留未证明范围；独立比较冻结上下文、Oracle、成本和源码。

## UI-D05: 设计从完整架构推导

**Status**: proposed
**Date**: 2026-10-29

### Context

现有包与能力目录明确了代码Owner，但未形成产品、基础、组件、组合、
呈现与证据之间的完整设计推导。公共组件和共享token不能独自决定体验。

### Decision

每个实现绑定已接受的整体架构与产品/Grammar合同。组件先设计，再实现；
空间、文字、色彩/材质、几何/资产、交互、时间/可访问性共同约束设计。
130目录作为覆盖，既有样本作为研究输入，不反过来定义架构。

内核只采用 Definition、Composition、Resolution 三个对象：
现有能力合同定义合法空间，实际调用数据表达组合，纯解析给出只读结果和来源。
字段形状在 [数据模型](./data-model.md) 明确；不引入定义继承链、
通用规则插件、镜像页面树或新渲染引擎。

### Rationale

角色与关系约束局部选择，组件不再通过独立外观或CSS覆盖拼接。

### Alternatives Considered

只扩充token不能裁定组合含义；从各个缺陷不断追加全局规则缺少完整模型。
自建模板/样式编译器重复React及现有UI职责；只保存文字规范则无法检查槽位、
状态和归属是否一致。

### Consequences

增加前置设计成本，但可以提前发现跨组件矛盾。不能仅因材料齐全批准设计；
用户对整体方向与逐项设计的反馈仍需真实呈现。若引用链不能减少遗漏或误用，
须以既有独立任务比较重新审定流程。
Definition与组件API的绑定增加维护成本；必须从同一合同派生校验输入，
不能让目录和renderer分别维护默认值。当前未实现，收益仍UNPROVEN。

## UI-D06: 组合关系具有独立设计职责

**Status**: proposed
**Date**: 2026-10-29

### Context

Field已有单一轮廓Owner；其它控件的独立外观仍可能在组合时产生重复表面。
空间层次、交互边界、DOM层级与图形插画不是同一概念。

### Decision

Page/Pattern拥有内容关系；Composite拥有具名槽位及其绑定；
Child按槽位身份呈现。每个槽位显式声明shared-plane、nested-plane或portal-plane。
表达按plane/purpose/subject/target分配唯一Owner，可委托一次绘制而不转移Owner；
命中目标、焦点策略和业务状态分别声明。合法独立子动作、浮层与身份图形保留。

未声明槽位、基数错误、能力不接受、归属/委托冲突和非法新平面确定性拒绝，
不自动改样式掩盖。不同purpose共存仍需Grammar合成约束和渲染审查。
EDX Surface与绘制plane不同，新plane不获得新的任务或主对象权限。

### Rationale

复用语义与交互的同时，组合可以保持一个可理解的任务结构。

### Alternatives Considered

全局禁止嵌套、阴影或统一一层会破坏合法浮层、编辑与身份表达；
每个页面自行覆盖选择器会形成隐含组合规则。
一个isolated开关同时重置状态/焦点/环境会丢失真实业务关系。

### Consequences

需要补齐槽位和继承信息，复杂组合不能无条件套用独立控件皮肤。
若既有组合能力足以表达关系，直接复用；仅有真实规则差异才扩展合同，
不为了形式新增大量包装组件。
语义槽位不能接收任意不透明交互子树；调用方需要声明能力绑定。
形式上的Owner唯一不能证明视觉良好，独立光学与动态观察仍不可省略。

## UI-D07: 状态与表达按独立维度组织

**Status**: proposed
**Date**: 2026-10-29

### Context

业务执行、组件交互、资源状态与环境条件来源不同；
选中、主要承诺、hover和成功不能互相替代。

### Decision

保留已有状态Owner，按组件适用性组织正交维度与合法组合。
表达同时解析布局、文字、资产、材质、反馈和运动；派生值不能写回业务。

环境只按白名单继承，显式合法轴替换默认值，槽位身份与非法显式变体
发生冲突时拒绝而非静默覆盖。motion只能收紧、density遵从平台下限；
父pending不默认传播，interaction gate只收紧已声明目标的本地激活。
纯解析核对引用、展开结构、分配职责、绑定状态、选择唯一recipe并返回完整结果；
web继续执行事件/DOM/焦点/清理，React继续拥有渲染生命周期。

### Rationale

状态含义稳定，平台和主题变化不改变命令、导航或阅读语义。

### Alternatives Considered

万能状态enum会混淆所有权；把状态仅映射成颜色无法解释恢复或操作变化。

### Consequences

需按风险选择成对/专项场景，避免全笛卡尔积。静态能力明确NOT_APPLICABLE；
原生与宿主差异继续由平台Owner证明。发现两个维度并非独立时由原合同裁定，
不能以实现方便合并其状态来源。
recipe无匹配或多匹配属于合同失败；只有明确声明的语义等价降级才可采用。
缓存依据实际依赖失效，不能缓存另一个业务状态源。

## UI-D08: 证据证明不同的设计问题

**Status**: proposed
**Date**: 2026-10-29

### Context

类型、点击、无溢出和截图存在不证明结构含义、光学关系或真实用户价值。
现有EDX已经区分L1-L4、独立评审和CER。

### Decision

复用既有EDX/UI Gate，分别绑定合同一致性、实际渲染、动态行为、
平台/runtime和用户任务效果。设计推导和组合关系成为待增强的输入；
不从一个检查数量、一个案例或一个总PASS推导其它维度。

局部Resolution只覆盖该组合闭包；跨组合Surface规则需当前完整快照，
沿EDX验证。缺快照为UNPROVEN，unsupported与invalid保留各自诊断，
不会自动降级为PASS。Study可以消费draft定义，其接受状态不被解析改变。

### Rationale

证据的对象明确，遗漏可以归因到设计、实现或证据Owner。

### Alternatives Considered

另建视觉审批服务重复EDX职责；只增加机械CSS规则无法判断使用意义。

### Consequences

确定性校验只裁定显式合同；视觉/语义仍需独立观察。
框架校准必须同时保留正例、反例和合法边界例；没有独立效果比较，
只能声称机制被验证，不能声称设计品质或Agent收益。

## UI-D09: 逐项设计反哺原架构

**Status**: proposed
**Date**: 2026-10-29

### Context

架构需要在不同组件和任务中接受检验；
局部修复不能暗自改变共同规则，也不能迫使架构永远不变。

### Decision

Finding按原Owner归类；共同规则修订带依据、替代方案、影响范围和合法行为保留。
proposal审定后同步原合同及派生消费者，按依赖闭包失效证据；
复用未失效的环境和资源。组件设计顺序留给接受架构后的同一执行计划。

### Rationale

经验形成可复用规则，后续实现消费同一接受源。

### Alternatives Considered

冻结全部设计会阻碍校准；把每个缺陷升格成全局禁令会制造新误判。

### Consequences

跨Owner修订需明确归属，不能借改一个组件扩大到全局验收。
只有证据证明存在共同职责才扩展架构；组件特例留在其Owner，
未被新输入影响的证据和资源继续复用。
扩展按Pattern/既有变体/新能力/新通用语义归原Owner；
禁止靠任意样式参数、规则优先级插件或临时开关绕过组合合同。

## UI-D10: 整体体验职责约束组件执行与应用制作

**Status**: proposed
**Date**: 2026-10-29

### Context

组件/组合合法性不能证明用户目标、信息/导航、交互过程和任务结果正确。
当前Product/EDX、UI Identity、Frontend Runtime与Development Workflow各有真源，
需要明确它们同公共UI、使用决策、Pattern生产及制作事件的连接。

### Decision

从用户认知、行动、结果与上下文推导七项职责：用户目标与价值；
认知/内容/信息架构；交互与时间过程；视觉与感知语言；
能力供给/组合生产/使用决策；包容性/平台/运行品质；证据/交付/演进。
重点组件问题是校验输入，不限定整体边界。

沿原Owner和研发生命周期协作。Product/Prototype作者在体验上下文中选择
Pattern/能力；Definition提供usage policy，Composition引用designBasis，
Resolution只落实接受的选择。用户运行事件与制作事件分别归Runtime和工作流，
不新增全能设计服务、生命周期状态机或可写事件Store。

### Rationale

局部实现能够追溯至完整任务；跨页面、时间、输入和变更的缺口有明确归属。
组件良好、组合合法和同色同圆角不再被当作整体验收的替代证据。

### Alternatives Considered

以四项或任意组件清单限定总体职责会漏掉认知、路径、恢复和运行问题。
把所有职责塞进UI解析器会复制Product/EDX和Runtime的真源；
另建UIUX流程会同既有Development Workflow形成并行执行权。

### Consequences

需要接通usage policy、使用决策与designBasis的原schema绑定，以及完整任务和
制作事件验证；当前均为proposed/UNPROVEN。小部件继承所属组合的设计依据，
不为每个元素制造完整Case。未来未知事件返回原Owner的设计缺口，
不得从文件齐全推断Agent已经能独立完成未见UI/UX事务。
