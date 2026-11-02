# Peers UI — Integration

> **Status**: active
> **Created**: 2026-10-28 | **Updated**: 2026-10-29
> **Owner**: Client Platform / UI System

> **Target Design**: draft — 整体架构先确认，组件按设计推导

## 现有上游与下游

Product/领域合同拥有用途与真实结果；UI Identity拥有基础与Grammar；
UI System拥有有限目录、数值、资产、renderer与样本。
[EDX](../../../engineering/experience-design/README.md)拥有Experience Contract、
Wireflow、推理、Finding、ReviewResult与CER；Development Workflow拥有执行生命周期。
本设计补充输入和对应关系，不建立第二条设计、推理、审阅或执行工作流。

下游包含Desktop、Mobile Web、Dashboard、X Config、official site、Applet和
Prototype；JSX/Astro/import等是各自renderer适配，不是单独风格来源。
原生壳、资源解析、模型、业务协议和runtime架构保持各自Owner。

## 目标合同接入

### 整体体验与原生命周期

七项整体职责和制作事件映射见 [整体设计](./design.md#4-整体体验职责与应用制作周期)。
Product/EDX提供用户结果、概念/信息/导航、动作、状态/恢复与证明要求；
UI Identity提供完整视觉与感知政策，Runtime提供适应/运行约束。
公共UI承载能力、usage policy与组合执行，不能把上游义务缩成组件合法性。

Product/Prototype作者引用原Pattern与能力，形成使用决策、Wireflow、
Composition和对应证据；Definition供应合法空间，Resolution落实接受选择。
当前EDX已有动作表达和体验合同，不等于usageDecisionRefs及新的Pattern生产绑定
已经接通；新字段由原Owner扩展，保持UNPROVEN。

Development Workflow仍组织同一次应用制作。目标变化回Product，交互/选型变化
回EDX/能力/Pattern，视觉变化回UI Identity，运行变化回Runtime；
Quality/Acceptance证明结果，发布和外部反馈采集仍按既有授权。
不新增独立UI/UX执行状态机或事件服务。

### 原真源分工

UI Identity 拥有角色、合成限制和基础含义；tokens/assets 提供角色数值与资源。
能力目录/组件规范拥有 Definition 的 anatomy、投影、槽位、基数、归属、
合法变体和平台绑定引用。有限规则继续落在原 Grammar 和能力合同，
不另外登记通用设计插件或第二份规则目录。

Composition 从组件实际调用数据与具名 slot binding 派生；
业务 Pattern 声明 Surface 与对象关系，公共 UI 不能改写产品意图。
Definition 不默认把 standalone recipe 传播到子项；槽位身份是必经输入，
Field/选择/浮层/独立命令分别消费自己的合同。

semantics 对当前组合闭包纯解析角色、归属、瞬时派生及presentationRef；
web维护并注入平台绑定，执行其recipe、React/DOM、测量、事件和清理。
双方不能重复选择语义变体。UIProvider 注入环境，
OverlayHost 管理临时浮层，业务/资源 Owner 注入现有 projection/action。
双方不需要序列化一份镜像页面树或建立运行时注册 Store。

### 与 EDX 的精确边界

UI 的 plane 是绘制关系，EDX Surface 是任务/主对象合同；
新增平面不建立新任务，不免除 region 的 supportsSubject 义务。
跨组合规则沿 EDX 对完整当前 Surface 快照校验；
局部 resolved、原型截图或已有 Grammar actionRole 校验均不能替代新组合覆盖。

EDX 读取原有 trace/evidence 引用及 Resolution 的范围/来源；
确定性检查验证合法槽位、基数、归属、委托、绑定和输入摘要，
实际光学关系、交互动态与任务效果仍使用原有渲染、runtime 和独立评审证据。
无法取得当前完整 Surface 输入时，对应范围 UNPROVEN，不自动补齐期望。

### 与平台及底层 engine 的边界

Host 提供 theme/density/locale/direction/motion/输入能力。
平台适配只能从 Definition 已允许的 anatomy/recipe 中选择；
reduced motion、命中区下限、可访问义务和状态 Owner 不能被局部覆盖。
Portal 使用现有 Host，保留逻辑主对象和环境；
trap/close/focus-restore 按显式浮层合同执行，不由 z-index 决定。

成熟 editor/media/focus/virtualization engine 通过原 adapter 内部复用，
不对外暴露 supplier props，不改变 Definition/slot 语义。
Lynx 未支持的能力返回 unsupported，并保持目标原生证明 UNPROVEN。

Skill接入只增加原真源导航与消费义务；规则不复制进Skill。
UI验证沿原有入口和Gate Owner增强，基础engine按现有许可/资源/替换政策复用。
只用一个组件缺陷校准框架不够；共同规则须有不同能力族的正反/合法边界案例。

## 逐项设计与架构演进

每项工作读取接受的架构及其对应产品/Grammar合同，先完成该项设计，
审定后实现与证明，再把观察归因到原Owner。组件顺序、执行预算、依赖闭包
和资源复用由后续明确的执行计划决定，本文件不充当Task进度表。

发现架构缺口时形成proposed amendment，经过原工作流审查后更新原合同；
只重做失效的设计和证据，保留未失效的运行资源。不得让当前实现暗自改写
通用原则，也不得因一个问题追加对所有组件生效的禁令。

## 当前提案与迁移边界

用户本轮要求先完成整体设计架构，组件实现暂停。
现有20基础和Agent表达保留为draft研究材料，不当成已接受的架构或组件设计。
当前 [UI-20261028计划](./execution-plans/20261028-ui-system/plan.md)
仍是既有冻结输入；本轮不原地修改其合同，也不从它推导新架构已获实施授权。
设计得到确认后再修订同一计划，使逐项组件设计与实现绑定接受的整体架构。

Definition/Composition/Resolution 语义、usage policy/使用决策/designBasis绑定、
目录/Grammar目标字段、纯解析、renderer绑定、跨族/完整任务校准及 EDX 增强
均尚未实现；既有上游源的存在不能代替新连接的执行证明。
未来实施必须把受影响原规范、类型、组件、样本和验证绑定一起同步，
移除同一职责的局部规则；不保留并行真源或无期限兼容路径。
合同演进以明确受影响闭包切换；被切换组件不再消费旧的独立外观传播规则。
尚未切换的能力保持原证明范围，不能因新架构文件存在就被记为符合目标设计。
消费者迁移、active token推广、commit/push/PR/发布和原生/runtime证明不在本轮。
