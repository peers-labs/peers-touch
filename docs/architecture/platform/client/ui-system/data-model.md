# Peers UI — Data Model

> **Status**: active
> **Created**: 2026-10-28 | **Updated**: 2026-10-29
> **Owner**: Client Platform / UI System
> **Target Design**: draft — 目标字段尚未进入类型或机器 schema

## 当前已经存在的模型

纯语义类型在 `packages/ui/contracts/src/index.ts`；
唯一能力目录在 `packages/ui/contracts/capability-catalogue.json`，
`src/catalogue.ts` 是派生代码。ActionIntent、Availability、FieldValidation、
ChoiceOption、OverlayIntent、ResourceView 与 QueryProjection 表达输入、投影和意图。
CapabilityRecord目前含描述字符串和实现/证据字段，不等于本提案的设计绑定已实现。

idle/pending/succeeded/failed/recovering来自命令Owner；业务成功不能由
Promise、关闭或动画结束推导。选择控件存open/query/active等瞬时状态；
远端query epoch、实体身份、持久草稿和资源解析仍由原Owner拥有。
OverlayHost只持当前document临时栈，卸载释放自己的listener/observer。

现有FieldFrame拥有一个语义输入的label/helper/error/focus关联，
子控件不重复拥有该轮廓。它是已有约束，不代表所有组合关系已经建模。

## 整体体验输入与目标语义模型

以下是 proposed 的字段形状和含义，供整体架构审阅；不是已经发布的 TS/API。
接受后由原 contracts、Grammar 与 EDX Owner 将各自字段落实到现有类型，
保持一个定义源和派生索引。三个核心对象不形成三份可独立编辑的目录。

引用 `Ref` 含稳定 ID、来源位置及内容摘要，接受状态来自原合同；
引用不一致、缺失或摘要失效不能继续当作当前输入。诊断中的 Owner 是合同
维护者，状态中的 Owner 是现有值的权威来源，两者不得混用。

### 整体输入引用，不另建产品模型

产品目标、概念、信息架构、动作、路径成本、状态/恢复、平台差异和性能预算
引用既有 EDX ExperienceContract；视觉 ID 与模块表达引用 UI Identity/craft，
树寿命与资源预算引用 Frontend Runtime。原型/实现/证据引用现有 EDX trace。

Composition 根的 `designBasis` 是这些已有输入的引用视图：

```text
designBasis
  experienceContractRef / journeyRefs / wireflowRefs
  identityRefs / modulePolicyRef / platformPolicyRefs
  patternRef                 optional when a shared Pattern applies
  usageDecisionRefs          chosen capability, applicable policy and alternatives
  stateRequirementRefs / performanceBudgetRefs / evidenceRequirementRefs
```

使用决策由 Product/Prototype 作者产生并绑定原 Experience Case/trace，
不是 Resolution 自动作出的产品取舍。决策含上下文引用、候选 Capability IDs、
硬约束排除理由、最终选择依据和待验证效果；不复制 Journey/动作/状态字段。
`usageDecisionRefs` 的机器接入尚未实现，需原 EDX schema Owner 统一定义。

普通部件沿已声明槽位继承相关设计依据；不要求每个 Text/Icon单独拥有完整Case。
目标、选型或设计政策变化，使相关派生失效；事件路由沿既有 Finding/工作流，
不新增可写 UX Event 或 Design Session Store。

### Definition：一种能力的合法空间

```text
Definition
  capabilityId       existing Capability ID
  specRef            Ref to accepted component specification
  grammarRefs        Ref[] to roles and composition constraints
  usagePolicy        applicability, exclusions, adjacent alternatives, policyRefs
  anatomy            named internal parts and declared semantic children
  projections        named external or interaction inputs, applicability, ownerRef
  variants           axis -> finite values, default, allowed bindings
  rootBinding        standalone role, plane policy, responsibilities
  slots              Slot[]
  presentationRefs   Ref[] to platform recipes and allowed fallbacks

Slot
  id                 stable name within Definition
  accepts            Capability ID[] or named grammar roles
  cardinality        { min: nonnegative integer, max: integer | unbounded }
  planeRelation      shared-plane | nested-plane | portal-plane
  subjectBinding     inherit | self | explicit
  bindingRole        allowed semantic identity in this slot
  allocations        purpose, target binding, owner, optional draw delegation
  inputBindings      named projection / event / interaction-gate relationships
  focusPolicy        own targets | shared navigation | contained | trapped
  variantPolicy      finite allowed values / required slot binding
  environmentAxes    axes which may be overridden here
```

`anatomy` 只引用本能力内部部件或声明的子 Definition，不允许循环。
`accepts` 的角色集合来自 Grammar，不能用任意函数筛选子组件。
缺 `rootBinding` 的能力只能作为对应槽位部件使用，不能假设 standalone。
槽位不默认 shared 或 nested；未声明关系是定义缺口。
`min=0` 可为空，`max=unbounded` 可重复；每个实际子实例 ID 必须唯一。

`usagePolicy` 是当前能力的原规范内容：所服务的意图、适用/禁止条件、相邻
能力及选择依据、必要上下文/状态/平台和证据要求。硬条件来自已声明合同，
任务品质判断引用 Product/EDX，不采用函数插件或无来源“智能选型分数”。
缺输入保持设计缺口；语义槽位匹配只证明可以组合，不能替代本次使用决策。
Pattern以原规范定义稳定任务关系、可调整轴和限制，使用同样的能力/组合内核；
本模型不创建第二份Pattern目录或模板引擎。

`projections` 引用现有 ActionIntent/FieldContract/ChoiceOption/OverlayIntent/
ResourceView/QueryProjection 或已有业务投影，不复制其结果 schema。
局部 open/active/hover 等由现有交互算法拥有；派生 selected 必须指向
整体 value 与 option identity。父级限制激活只绑定明确目标，不改业务投影。

表达 purpose 采用有限语义角色，所需项由能力声明。`allocations` 区分
语义 Owner 和绘制实例；委托不能改变 Owner。实际焦点目标和命中目标
在 anatomy/binding 中明确，focusPolicy 不自动改变表达的绘制实例。

`variants` 有有限默认值；平台适配和槽位绑定属于约束，不是任意样式 props。
`presentationRefs` 指向角色/状态/环境的有限绑定，保持唯一匹配。
它们可复用同一 recipe；必需绑定不能靠 CSS cascade 或 wildcard fallback 补齐。

平台绑定是 Definition 引用的记录，不是第四个独立目录：

```text
Presentation binding
  renderer / platform / bindingRole
  variantCases       disjoint sets of declared axis values
  recipeRef          owned platform structure and drawing recipe
  stateExpressions   allocated purpose/target -> disjoint state cases and role values
  planeConstraints   allowed geometry, material and relief for this binding
  environmentPolicy  declared adaptation and accessibility lower bounds
  fallbackRef        optional, explicitly equivalent supported binding
```

selector 只使用声明轴的有限值，不支持任意脚本条件或CSS匹配。
省略的非相关轴意味着该绑定明确适用于其所有合法值，不意味着选首项兜底；
同一合法输入下不得有两个绑定或同用途状态分支同时匹配。
每个适用状态必须有分支或明确默认；不适用的业务状态不参与选择。

状态表达按purpose分解，避免枚举所有环境和状态的全笛卡尔积：
selected可以决定selection填充，focus决定独立焦点表达；
同用途的hover/pressed竞争必须在该能力的状态政策中明确裁定。
组合约束再检查多purpose叠加、对比度和relief是否被当前平面允许。
这不是全局“pressed永远优先”或“选中永远抬升”的统一规则。

绑定记录由平台Owner维护并注入纯解析；semantics选出presentationRef，
web实现其recipe和DOM效果，不再另选一遍语义或变体。
边框、内描边、填充、投影和装饰材质必须消费已分配表达及planeConstraints；
实际CSS若额外绘制外壳属于renderer违约，要由渲染审查发现，
不能声称仅靠结构schema即可拦截全部视觉夹层。

### Composition：实际使用关系

```text
Composition
  surfaceRef         Ref to existing EDX SurfaceContract
  designBasis        read-only references to the accepted experience/design inputs
  root               Instance

Instance
  instanceId         stable within the mounted semantic tree
  definitionRef      Ref to Definition
  subjectRef         as required by root / slot subjectBinding
  regionRole         if this instance defines an EDX region
  slotBindings       slotId -> Instance[] / declared content parts
  projectionBindings named read-only inputs and their ownerRefs
  actionBindings     named intents / callbacks to existing owners
  variantValues      explicit values on declared axes only
  environmentValues  explicit values on permitted axes only
```

Composition 是实际 React 组合的语义视图，不要求页面同时维护 JSON 和 JSX。
跨组件的具名槽位与语义绑定是输入，普通内部 anatomy 从 Definition 展开；
可以为设计审查或 EDX 导出快照，不能让快照变成另一份页面真源。
动态子项通过稳定业务 key 绑定；卸载释放对应瞬时状态与既有Host资源。

每个语义组合以自己的调用数据构造闭包；父槽位只接受可辨识的能力绑定，
普通内容不是任意交互扩展点。解析器不遍历不透明 ReactNode 猜测能力。
跨组合 Surface 检查需要完整当前快照，沿 EDX 验证；缺快照不能从局部结果
推导全页符合主要承诺数量、主对象或 region 约束。

`surfaceRef` 在页面/Pattern 根显式绑定；复用控件可以消费上层 Surface，
独立设计样本由 Prototype host 提供样本合同。EDX 未要求对象的 navigation
region 遵从既有例外，其余 region 按已有主对象约束；新平面不豁免该约束。
局部 `subjectRef` 可以是主对象的字段、选项或关联实体，其支持关系必须明确，
不能把每个嵌套控件都声明为新的 EDX Surface。

`subjectBinding=inherit` 使用父对象，`self` 使用当前能力有权声明的对象，
`explicit` 要求调用方给出关系；缺少时无隐式 fallback。
身份资源仍由原资源 Owner 解析；subjectRef 不是原生资源定位协议。

### Resolution：只读且有来源的结果

```text
Resolution
  inputRefs          definitions, grammar, recipes, tokens/assets, renderer
  mode               production | study
  scope              semantic composition closure, surface snapshot reference
  environment        effective host/environment snapshot
  nodes              ResolvedNode[]
  allocations        expressionId -> owner instance, draw instance, target
  dependencies       relevant input / output references
  trace              field -> source Ref and applied binding

ResolvedNode
  instanceId / definitionRef / subjectRef / surfaceRef
  effectiveRole / effectiveVariants / effectiveEnvironment
  planeId / parentPlaneId / planeRelation
  expressionIds / hitTargetIds / focusTargetIds / focusPolicy
  visibleState / localActivationGate
  presentationRef / roleValueRefs / allowedFallbackRef

ResolutionResult
  resolved           complete Resolution
  invalid            Diagnostic[]
  unsupported        renderer/platform and missing supported binding

Diagnostic
  kind / instanceId / slotPath / affectedField
  expected / observed / sourceRefs / ownerRef
```

ResolutionResult 三个分支互斥。`invalid` 不附带可执行的部分绘制结果；
unsupported 只用于该能力明确未支持目标 renderer/platform，
已声称支持但绑定缺失属于 invalid。运行失败仍经现有错误边界处理。
Study 可解析 draft 定义，但 trace 保留接受状态，不晋升 production 或证据。
证明状态由 EDX 管理，`resolved` 不等于视觉、行为或产品效果 PASS。

`planeId` 由当前 root 和允许创建新平面的语义实例派生，不读取 DOM depth。
shared 子项继承同一 planeId；nested/portal 创建新 ID 并保留 parentPlaneId。
浮层实例另引用 OverlayIntent，trigger/close/focus-restore 由现有 Host 管理。
绘制平面不是 z-index、浏览器 stacking context、EDX Surface 或业务 scope。

表达标识由 `(planeId, purpose, subjectId, targetId)` 派生，targetId 指具体
轮廓、选择位置或控件目标。Owner 与 draw instance 单独记录：
FieldFrame 可拥有 Input 焦点表达并委托 slot 绘制，Input 仍是 focus target。
两个声明指向同一表达却有不同 Owner 返回冲突；一个 Owner 重复委托绘制
也返回冲突。合法多选可为不同 option target 分配各自 selection 表达。

普通分组可以采用留白而不画边框；它仍有结构归属。Recipe 可以按状态
不绘制某项表达，但不能在该状态引入新的未分配外壳。
不同 purpose 同时绘制须满足 Grammar 的合成约束；形式唯一不证明光学质量。
具体材质合成约束仍由各能力/Grammar定义，不把 CSS 属性数量作为代用品。

## 默认、继承与覆盖的确定性规则

定义不支持 `extends` 或多重继承。共享含义通过 Grammar 引用和组合复用；
定义的有限 variant 值整体替换，不逐层深合并样式或供应商配置。

1. root/slot 绑定先决定合法身份和归属，不允许实例改写。
2. 实例显式 variant 在允许集合内取值，否则返回 invalid；
   没有显式值则使用该绑定声明的默认，不能选第一项猜测。
3. environment 的合法局部值优先于父值，父值优先于 Host 默认；
   未列为可覆盖的轴不能局部设置。
4. reduced motion 按系统、父级、局部的限制并集生效；任何一级关闭运动，
   下级不能开启。有效 density 再受目标平台命中区/可读性下限约束。
5. 状态只从命名投影或已声明派生取得，不继承“所有父状态”。
   本地 activation gate 可以收紧动作，不能覆盖权限或伪造服务端结果。
6. role/variant/state/environment 只选择唯一已声明平台绑定；
   主题数值不会改变 role，平台 recipe 不会改变业务状态。

表达隔离、焦点隔离、对象绑定、命令作用域分别声明；没有总开关同时切断它们。
Portal 保留逻辑环境和主对象，Dialog trap 由 focusPolicy 显式指定；
Menu 的 portal-plane 不隐含 trap 或新的 EDX Surface。

## 具体推导样例

下例是语义设计记法，不是 proposed 公共组件 API。

```text
Segmented(mode)
  value <- ModeOwner.currentMode
  plane p1; grouping/selection owner = Segmented
  planeConstraints = continuous selection; independent action relief disallowed
  option[chat, task]: shared-plane; role = choice-option
    selected <- currentMode == option.value
    hit/focus target = that option
    selection draw <- Segmented allocation
    activate -> ModeOwner.select(option.value)
```

整体负责单选和共享焦点导航，option 保留实际目标；绑定使用 choice recipe。
带 standalone raised-command 绑定的 Button 不在该槽位合法空间内；
同一选项再分配独立 selection 外壳产生归属冲突。允许一个 selection 标记
和一个当前焦点表达，它们用途不同且要经过材质合成审查。
Tabs 若切换内容导航则绑定导航合同，不使用本例的选择状态/事件替代。

```text
Field(accountName)
  contract <- FormOwner.accountNameField
  plane p2; grouping/validation/focus owner = FieldFrame
  label/helper/error: shared-plane; associate fieldId
  control: shared-plane; role = editable-input
    value/change <- DraftOwner
    focus target = Input
    focus/validation draw <- FieldFrame allocation
  reveal action: declared command slot
    own hit target, accessible name and action intent
```

控制输入不重复分配同一轮廓；reveal 仍是独立动作。
多个字段组成 Form，各自 fieldId 和验证 Owner 不会因同父项而被合并。
Form submit 的 pending 不自动赋给各字段或 reveal；输入保护由原表单合同绑定。
富文本需要独立编辑舞台时选择明确允许 nested-plane 的对应定义，
不能在普通 Input 槽位中临时增加有材质的 wrapper。

这两例加上 [设计中的跨族检验](./design.md#8-用跨能力实例检验核心) 检验
对象关系、表达、动作与焦点各自归属。当前仅完成纸面推导，runtime 仍 UNPROVEN。

## 状态维度

- 业务执行投影：availability/execution及已有授权、读回和结果Owner。
- 组件交互：hover、focus、pressed、selected、expanded、active cursor等；
  按组件适用，不与业务状态共用一个万能enum。
- 资源投影：available/loading/failed/unavailable及来源/失败原因。
- 环境与策略：theme、density、locale、direction、motion、输入方式和支持能力。

变体轴相互独立，只声明确有意义的合法组合；不机械遍历完整笛卡尔积。
静态Text/Icon/Divider没有命令进程，声明NOT_APPLICABLE而非虚构pending。
具体默认值与可见行为归各能力合同。

## Evidence 与架构修订

使用EDX现有TraceLink、EvidenceRequirement、Finding和ReviewResult；
UI目录仅提供能力/规范/实现/样本引用和必要的设计摘要。
可持久的渲染快照与截图观察在外部Evidence Store，不把runtime状态写入目录。
Trace引用当前 Definition、组合绑定与 Resolution 来源，依赖摘要沿既有
sourceDigest 机制，不另建摘要服务或把每次瞬时状态变化保存为正式证明。

每个修订在原Owner合同中记录目标差异、依据、替代方案、合法行为保留、
依赖影响与证据失效范围。proposal与accepted输入区分；派生索引从唯一源生成。
修改contract/renderer/token/asset/platform/oracle后，不继承受影响的旧PASS。
Definition 是原能力合同的扩展；Composition 是实际使用的语义视图；
Resolution 是纯派生。现有业务、资源及生命周期真源均保留。
