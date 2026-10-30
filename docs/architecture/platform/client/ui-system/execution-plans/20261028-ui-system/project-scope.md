# UI/UX 项目总账

> **Status**: draft
> **Updated**: 2026-10-29
> **Owner**: Client Platform / UI System
> **Scope**: 本次 Agent UI/UX 体系工程，不是整个 Peers-Touch 的业务开发清单
> **Authority**: 范围与现状投影；不替代 accepted 架构、frozen Plan 或实现授权

## 工作树与文档真源

- 工作树：`/Users/bytedance/Documents/Projects/peers-touch/peers-ui-system`。
- 分支：`feat/peers-ui-system-20261028`。
- 本次核实 HEAD：`879e4d51133b7372272b2cba0037f04d63e73913`；
  文档及大量已有改动尚未提交，HEAD不能独自表示当前工作区内容。
- 架构与规范真源：[UI System](../../README.md)；
  即本工作树的 `docs/architecture/platform/client/ui-system/`。
- 本文件：同一工作树的
  `docs/architecture/platform/client/ui-system/execution-plans/20261028-ui-system/project-scope.md`。
- `peers-touch/master` 的 `deliverables/ui-design-architecture-20261029/`
  是方便阅读的交付副本；该主工作树当前没有上述架构源目录。
  交付副本不是另一个实施工作树或设计真源。

## 北极星与最新设计约束

让Agent在完整应用制作与演进中，从用户任务推导一致、可用、可验证的UI/UX。
职责、制作阶段、用户状态与环境共同决定覆盖；重点元素问题不限定总体范围。

视觉方向以用户给出的外部参考及本次明确反馈为依据：
**克制、简约、柔和、互联网化、内容主导，保持方圆骨架，避免传统SaaS拼装感与锐利感。**
参考需转译成自己的产品对象、比例、空间、文字和轻材质关系。
已有配色和样本不视为满足该方向；必须由真实场景样板先验证整体气质。

必须交付：统一风格指导、全量元素集、覆盖真实场景的组件搭配集。
组件的制作、组合、选型与视觉ID是重点校验项；完整任务、内容/导航、
状态/恢复、平台品质、Agent牵引和持续演进同样属于项目。

## 本次核实的现状

- **整体架构：有草稿，待接受与接入。** UI-D01–UI-D04是已接受基线；
  UI-D05–UI-D10仍为proposed。新组合内核、usage policy、使用决策、
  designBasis与完整制作事件的连接尚未实现。
- **整体风格：需要重做可视校准。** 用户明确反馈旧表达过于锐利，
  未达到指定参考的整体气质；不继续把旧样本作为可推广基准。
- **能力目录：存在130个唯一ID。** 当前类别为action/input/content/identity/
  feedback/layout/disclosure/navigation/overlay/media/code/runtime/domain。
  目录标注109项PRESENTATION_IMPLEMENTED、21项EXISTING_CONSUMER_CUTOVER；
  这只是目录/源码状态，不代表新视觉体系已完成。
- **样本：20项基础draft已制作。** 留存报告含49项浏览功能检查，
  visualApproval=PENDING、fullContracts=UNPROVEN。
  本次核对报告中的13份源码摘要均匹配当前文件；
  没有重新运行浏览器，也不从摘要匹配推导视觉认可或完整runtime证明。
- **证据边界：全目录130项evidenceStatus均为UNPROVEN。**
  目录对Web标记implemented、Lynx标记unsupported。
  不把Web样本推导成Desktop/Mobile原生、跨端或业务接收端证明。
- **旧计划：有UI-F01～UI-F07，覆盖不足。** 现冻结版仍围绕旧风格和
  基础样本展开，未绑定下面的完整项目范围。本轮不原地改写其冻结内容。
- **进度恢复：本次建立canonical任务记录。** 此前
  `.dev-workflow/tasks/`没有任务；新记录只追踪这轮范围/现状整理，
  不伪造17个工作包已开工或已获准实施。

## 完整工作包

以下ID用于讨论范围和完成义务，不是已冻结的Task Slice。
状态是2026-10-29的源码/对话/留存证据投影；运行进度以canonical task记录为准。
正式实施拆分、顺序、预算、Gate与依赖闭包在接受架构与范围后冻结。

### UI-W01 — 整体架构与职责合同

产出：整体职责/生命周期、原Owner关系、唯一真源、失败与扩展边界、
UI-D05–UI-D10接受结果，明确新机制与既有EDX/Runtime/Workflow的接入。
完成依据：组件层与完整任务都可推导；未知行为有Owner，职责不重复。
现状：**草稿已形成，未接受，执行机制未实现**。
Owner：Architecture Design；源为[设计](../../design.md)、[模型](../../data-model.md)。
依赖：用户目标与UI-W02场景输入；与风格校准相互检验。

### UI-W02 — 全场景盘点与应用体验总图

产出：真实模块/角色/任务与状态清单、全局Shell、入口/导航/搜索、
模块之间的协同、主对象与返回位置。
范围从现有Chat、Agent、Social、Settings、Auth、Applet、
Station/operator与官网场景核对，按实际产品/平台声明边界。
完成依据：每个要求场景均有Journey、可见结果与失败/恢复关系；
不以孤立页面清单替代协同体验。
现状：**完整项目盘点尚未形成**；已有各模块合同可复用。
Owner：Product/EDX；约束UI-W04、UI-W10、UI-W11、UI-W15。

### UI-W03 — 整体风格北极星与参考校准

产出：参考观察及取舍、克制柔和的自有视觉论点、表达强度、
空间/文字/材质/几何/图像/动效的共同指导、正例与负例。
完成依据：能解释真实内容如何形成层级；符合用户参考与最新反馈，
风格判断经过可视材料而不是配色文字承诺。
现状：**参考研究存在，风格目标尚未达到，需重做**。
Owner：Product Craft/UI Identity；
研究源为[参考记录](../../prototype/README.md)。
依赖：UI-W02；对应旧UI-F01/UI-F02的一部分。

### UI-W04 — 统一Shell下的风格样板

产出：风格校准板，以及主入口、内容/对话、设置三个协同场景样板；
包含关键状态、实际内容、宽窄与代表性输入。
完成依据：同一产品气质贯通场景；用户认可整体呈现；
保留原型与生产证据边界。
现状：**新一轮三场景样板未制作**；旧Agent/20基础仅研究输入。
Owner：Prototype Design；依赖UI-W02/UI-W03。
这是下一批应先交付的可视结果，暂不推广旧样本。

### UI-W05 — 设计基础、Token与资产体系

产出：字体与字阶、间距/轨道、几何/命中区、色彩/材质、
图标/身份/资源、动效/主题，以及可调整轴与平台下限。
完成依据：值与含义分离，唯一Owner；由接受的风格和场景推导，
不让页面自造数值或候选泄露到active主题。
现状：**既有基础与候选存在，新体系未冻结**。
Owner：UI Identity/tokens/assets；依赖UI-W03/UI-W04。
对应旧UI-F02。

### UI-W06 — 全量元素清点与缺口核对

产出：全目录、语义分类、基础元素覆盖、缺项/重复/重叠核对，
每项合同/实现/样本/平台/证据状态及可发现入口。
完成依据：以实际场景需求检验130项基线，不把130当作永远固定总数；
文字、空间、资产与运动基础均可追溯。
现状：**130项目录已存在；完整缺口与重叠审定未完成**。
Owner：UI System；[目录源](../../../../../../../../packages/ui/contracts/capability-catalogue.json)。
可先核对现有内容；视觉定稿依赖UI-W05。

### UI-W07 — 全量元素设计与可运行样本

产出：各元素意图/anatomy/状态/变体/极值/生命周期/可访问性规范、
完整样本及明确接受范围，覆盖基础、通用高级、业务能力。
完成依据：样本与公共实现相同；功能、视觉认可、平台证明分别记录；
未完成项显示真实缺口。
现状：**20基础draft存在；全量新视觉与完整变体未完成**。
Owner：UI System/Prototype；依赖UI-W05/UI-W06/UI-W08。
对应旧UI-F03/UI-F04，但旧目录实现不自动算新体系完成。

### UI-W08 — 组合语法与执行内核

产出：Definition/Composition/Resolution、具名槽位、
继承/覆盖/隔离/冲突、表达委托、状态/焦点/命中归属与平台绑定。
完成依据：命令、选择、Field、浮层、身份/阅读的正例、拒绝例与
合法边界均能推导；实际绘制遵守合同并经渲染检验。
现状：**设计草稿存在，公共类型/解析/renderer接入未实施**。
Owner：Architecture/UI System；依赖UI-W01及具体能力设计。

### UI-W09 — 组件选型与使用指导

产出：在哪里能用/不能用、相邻能力如何选择、独立/嵌入政策、
usage policy与EDX使用决策引用。
完成依据：从任务、风险/频率、数据形态、精度、可发现性、
输入/平台和已有Pattern推导选择；结构合法不替代使用适合。
现状：**已有描述与拟定模型，完整决策合同/接入未完成**。
Owner：Product/EDX/能力规范；依赖UI-W02/UI-W06/UI-W08。
对应旧UI-F06的一部分。

### UI-W10 — 覆盖真实场景的组件搭配集

产出：共享Pattern、实体组合与场景搭配实例，含适用/禁止条件、
输入/状态Owner、内容轨道、动作/恢复、平台适配与可调整轴。
完成依据：逐项对应UI-W02场景；跨页面复用任务关系与语义，
不以若干相似Card堆出“搭配集”。
现状：**零散现有组合可复用，系统搭配集未交付**。
Owner：Pattern原Owner/Prototype；依赖UI-W02/UI-W07/UI-W08/UI-W09。
对应旧UI-F04的场景部分。

### UI-W11 — 内容、交互、状态与恢复全链路

产出：文案概念与i18n、任务路径、反馈/等待、权限与信任、
失败/结果未知、输入保留、撤销/取消、离开/返回/恢复与动效因果。
完成依据：全部适用Journey的状态与转换可达且可操作；
真实业务结果由原Owner提供，无本地伪成功。
现状：**既有EDX/模块合同存在，新体系完整绑定与验证未完成**。
Owner：Product/EDX/业务Runtime；依赖UI-W02/UI-W10并约束元素设计。
对应旧UI-F05；交互设计不能等全部视觉完成后才补。

### UI-W12 — 平台、包容性与运行品质

产出：Desktop/Mobile/Web/Applet的精确支持范围，keyboard/touch/读屏、
语言扩展/缩放、宽窄/主题/reduced motion、布局稳定、长列表、
组件树寿命/订阅/资源与性能预算。
完成依据：按声明平台与状态证明；原生、读屏、触摸和性能各用对应证据。
现状：**部分Web检查已有，全量及原生/辅助技术证明未完成**。
Owner：Accessibility/Frontend Runtime/平台；约束UI-W05～UI-W11。

### UI-W13 — 底层能力复用与平台Adapter

产出：编辑器、Markdown/代码/数学、图表、媒体、虚拟化、
焦点/浮层与资源底层engine的实际复用审计、依赖/许可与adapter合同。
完成依据：复用已有SDK/组件，外部props与资源/业务真源不泄露；
unsupported平台有明确替代/未支持边界。
现状：**已有依赖和实现，完整目标审计与适配仍待完成**。
Owner：UI/平台/资产与原engine Owner；依赖UI-W06/UI-W12。

### UI-W14 — Agent Skills牵引、发现与执行接入

产出：pt-dev-workflow、Product/Architecture/Prototype及Quality/Acceptance
的薄消费接入，能查目录、选型、样本、接受状态、依赖与证据范围；
制作事件/Finding按原Owner处理。
完成依据：Agent使用既有入口完成设计/实现/验证，不重复造Grammar、
Case、流程、Store或临时验证路径；失效时只重做相关闭包。
现状：**Owner与接入方向已明确，新体系尚未正式进入Skills**。
Owner：Development Workflow及相应Skill原Owner；
依赖接受的UI-W01/UI-W05/UI-W09/UI-W11。
对应旧UI-F06，并扩展到整体事务。

### UI-W15 — 原型与生产一致、消费者迁移

产出：明确目标模块/平台的合同映射、原型与实现一致性、
受影响生产消费者切换、旧表达/重复路径清除及用户操作说明。
完成依据：用户测试及当前源码证明；每个目标与授权明确，
无半迁移和并行设计真源。
现状：**生产替换暂停；工作树已有消费者改动不等于本次获准迁移**。
Owner：各消费者/Runtime与UI System；依赖对应已接受设计和UI-W14。

### UI-W16 — 真实验收与Agent收益独立比较

产出：合同/视觉/动态/产品runtime证据，完整场景测试、
正反/边界与独立blind A/B，实际用户效果、Agent误用/遗漏、
时间/token成本与偏差。
完成依据：当前源码、冻结任务/Oracle/上下文、相应独立评审；
缺证明保持UNPROVEN，功能检查不批准视觉。
现状：**留存有界样本检查存在，完整验收与框架收益未证明**。
Owner：EDX/Quality/Acceptance；逐项绑定已接受的声明范围。
对应旧UI-F07；不自动执行全项目重验。

### UI-W17 — 持续追踪、反馈与体系演进

产出：当前任务/范围/结果与证据引用、变更影响、设计漂移检查、
使用指南更新、组件/Pattern退役、反馈及知识回流机制。
完成依据：接单/中断/恢复/修订/交付均可继续；参考、规范、原型、
实现与证据不漂移，更新沿原Owner，不从局部缺陷堆全局禁令。
现状：**本次补齐总账与恢复记录；完整演进接入未实施**。
Owner：Development Workflow/EDX/各设计源Owner。

## 旧UI-F01～UI-F07与本总账

原[冻结计划](./plan.md)及[效果比较](./outcome-comparison.md)继续保留，
不把最新任务列表偷偷覆盖到已冻结输入：

- UI-F01：对应风格研究/UI-W03和候选样本；最新风格反馈要求重新校准。
- UI-F02：对应UI-W05的基础规范确认，尚未完成全量接受。
- UI-F03：对应UI-W07中20基础draft，不代表全量设计完成。
- UI-F04：对应UI-W07高级和UI-W10搭配集，未完成整体场景覆盖。
- UI-F05：对应UI-W11及UI-W12部分交互，不含全部应用生命周期。
- UI-F06：对应UI-W09/UI-W14的发现与选择，接入尚未完成。
- UI-F07：对应UI-W16，独立收益未证明。

新总账扩展的范围尚未冻结为实施Plan；接受后再将上述工作包拆成
有真实依赖、预算与验收闭包的Task，避免机械地一包等于一任务。
旧计划“先全量外观、后交互”的安排不能覆盖新架构的前置体验设计要求。

## 追踪与下一项交付

当前任务ID：`uiux-project-scope-20261029`。
canonical记录：本工作树
`.dev-workflow/tasks/uiux-project-scope-20261029/task.json`。
由既有 `dev-work.mjs`维护checksum/revision，不手工维护第二份进度JSON。
本总账提供稳定工作义务与带日期的现状，不替代该记录或frozen Plan。

读取：

```sh
node tooling/scripts/local-dev/dev-work.mjs status \
  --workspace-root /Users/bytedance/Documents/Projects/peers-touch/peers-ui-system \
  --task uiux-project-scope-20261029
```

本轮只整理范围与追踪，不开始样板/组件/公共schema实施、不提交或发布。
下一项可视交付为UI-W03/UI-W04：参考约束的风格校准板与统一Shell三场景样板；
UI-W02场景盘点/UI-W06目录核对可为它提供独立输入。
总体架构与风格样板分别确认，前者不能替代后者。

## 证据与来源

- [架构草稿](../../design.md)、[决策](../../decisions.md)、
  [集成](../../integration.md)、[样本入口](../../prototype/README.md)。
- 目录与其状态：本工作树
  `packages/ui/contracts/capability-catalogue.json`。
- 留存样本报告：
  `peers-touch/deliverables/ui-f03-basic-material-20261029/result.json`；
  它是样本功能观察，非最新风格接受或整体产品证明。
- 临时 `/tmp/peers-basic-material-evidence-20261029/`报告本次已不可访问，
  使用上述留存副本；不伪造临时文件仍存在。
