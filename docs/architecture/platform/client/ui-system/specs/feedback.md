# 反馈与结果 · 逐项合同

> DRAFT。所有自有实现 NOT_IMPLEMENTED，打样 NOT_BUILT；本章定义目标行为，不证明现有产品符合。

[总入口与共用政策](./README.md) · [源码全集](../component-catalog.md)

- [InlineAlert](#ui.spec.alert)
- [Badge](#ui.spec.badge)
- [EmptyState](#ui.spec.empty)
- [GuideStep](#ui.spec.guidecard)
- [Progress](#ui.spec.progress)
- [ResultState](#ui.spec.result)
- [Skeleton](#ui.spec.skeleton)
- [BusyIndicator](#ui.spec.spin)
- [StatusTag / FilterChip](#ui.spec.tag)
- [Toast / ToastHost](#ui.spec.toast)

<a id="ui.spec.alert"></a>
## InlineAlert

合同 ID：`ui.spec.alert`。来源记录：[Alert](../component-catalog.md#ui.family.alert)。

### 意图、选择与边界

影响当前意图的局部消息。字段组保存失败内联；权限不足显示下一步；可忽略提示可关闭；系统故障才用全局条。相邻选择：短暂完成用 Toast；整页阻断用 Result。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.alert)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

SeverityIcon/Title/Body/RecoveryAction/optionalDismiss；错误对象可追溯。

Failure/Domain Owner管原因与恢复；UI管局部反馈。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- severity=info/success/warning/error；默认 info取真实事实。
- scope=field-group/page/system；默认 field-group。
- dismiss=persistent/allowed；默认 persistent，关键阻断不得消失。

禁止：错误只toast、dismiss=已修复、无权限只写失败、阻断信息自动消失。

### 状态转换与可执行恢复

visible→recovering→resolved或failed；dismiss仅隐藏可忽略提示，不标故障已解决。

### 具体使用场景

<a id="ui.spec.alert.case.01"></a>
#### 保存失败

- **选择**：field-group error
- **触发与可观察结果**：显示保留草稿及重试
- **失败、等待与恢复**：重试失败不清错误上下文。

<a id="ui.spec.alert.case.02"></a>
#### 访问受限

- **选择**：warning
- **触发与可观察结果**：说明受限范围与请求权限
- **失败、等待与恢复**：不展示密钥或内网细节。

<a id="ui.spec.alert.case.03"></a>
#### 可忽略提示

- **选择**：info allowed
- **触发与可观察结果**：用户关闭该提示
- **失败、等待与恢复**：原业务状态不被改。

<a id="ui.spec.alert.case.04"></a>
#### 系统不可用

- **选择**：system error
- **触发与可观察结果**：全局明确受影响能力
- **失败、等待与恢复**：局部仍可用任务不全部禁用。

### 键盘、焦点、触摸与读屏

重要新失败适度announce；恢复按钮键盘/触摸可达；不抢input焦点；reader有错误和下一步。

### 图形、几何与动效

图/文/动作同轨，颜色与文字双表达；normal局部进出；长内容自动增高。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

多错误、重复错误、长诊断、离线与授权不足；technical details仅展开需要部分。

同scope合并重复消息；清理dismiss timer；真实故障持久状态由owner。

### 自有公共合同形状

messageId/severity/scope/title/body/recoveryActions/dismissPolicy。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.badge"></a>
## Badge

合同 ID：`ui.spec.badge`。来源记录：[Badge](../component-catalog.md#ui.family.badge)。

### 意图、选择与边界

补充计数或离散提醒。未读计数截断 99+ 并提供完整可读数；在线状态仅在解释需要时显示。相邻选择：状态名称用 StatusTag；可选条件用 FilterChip。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.badge)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

CountOrDot/HostAssociation/AccessibleSummary。

Unread/Presence Owner管事实；UI管标记。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- kind=count/attention/presence；默认 count；presence需解释。
- zero=hidden/shown；默认 hidden未读0不占位。
- cap=declared-display-cap；默认99+提案，保留真实总数。

禁止：unknown当0、显示99+且读屏也99、dot冒充在线确认、marker自己点击删除未读。

### 状态转换与可执行恢复

count更新投影；loading/unknown不写0；attention消失依真实read/resolve政策。

### 具体使用场景

<a id="ui.spec.badge.case.01"></a>
#### 未读会话

- **选择**：count
- **触发与可观察结果**：显示3条，阅读后消费owner新计数
- **失败、等待与恢复**：加载中保持unknown。

<a id="ui.spec.badge.case.02"></a>
#### 大量通知

- **选择**：cap
- **触发与可观察结果**：视觉99+读出完整130条
- **失败、等待与恢复**：不丢真实值。

<a id="ui.spec.badge.case.03"></a>
#### 在线点

- **选择**：presence
- **触发与可观察结果**：已知在线附可读说明
- **失败、等待与恢复**：unknown不放中性装饰点。

<a id="ui.spec.badge.case.04"></a>
#### 需要处理

- **选择**：attention
- **触发与可观察结果**：父入口说明有待办
- **失败、等待与恢复**：点消失不等于审批完成。

### 键盘、焦点、触摸与读屏

非独立control；reader读真实数量与对象；触摸有具名父入口；更新节流不每条打断。

### 图形、几何与动效

count容器允许数字宽度稳定；presence marker独立label；badge圆形属于marker不复制到Button。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

负数、超大、0与unknown、RTL数值、多个重叠marker。

订阅归消息/通知owner；Badge不计算未读；组件无持久计数缓存。

### 自有公共合同形状

kind/count/attention/presence/displayCap/associationLabel。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.empty"></a>
## EmptyState

合同 ID：`ui.spec.empty`。来源记录：[Empty](../component-catalog.md#ui.family.empty)。

### 意图、选择与边界

解释为什么没有内容并指向下一步。初次使用=创建；过滤无结果=清除筛选；权限不可见=请求访问；已清空=状态说明。相邻选择：加载用 Skeleton；错误用 RecoveryState。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.empty)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

ReasonTitle/Explanation/RelevantAction/optionalIllustration；空的原因先于装饰。

Query/Privacy Owner管原因；UI管空态。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- reason=first-use/filter-empty/permission/cleared；必选。
- scope=inline/panel/page；默认 panel。
- action=create/clear-filter/request-access/none；按reason唯一选型。

禁止：断网当空、所有空都创建、权限空暴露隐藏对象、loading先闪“没有数据”。

### 状态转换与可执行恢复

loaded-empty才出现；loading→Skeleton，failed→Recovery；action等待和结果归对应owner。

### 具体使用场景

<a id="ui.spec.empty.case.01"></a>
#### 第一次Agent使用

- **选择**：first-use
- **触发与可观察结果**：显示创建Agent入口
- **失败、等待与恢复**：创建失败转具名错误。

<a id="ui.spec.empty.case.02"></a>
#### 筛选无结果

- **选择**：filter-empty
- **触发与可观察结果**：保留条件并提供清除
- **失败、等待与恢复**：不删除原数据。

<a id="ui.spec.empty.case.03"></a>
#### 没有权限

- **选择**：permission
- **触发与可观察结果**：说明可见范围和请求路径
- **失败、等待与恢复**：不泄露未授权名单。

<a id="ui.spec.empty.case.04"></a>
#### 主动清空

- **选择**：cleared
- **触发与可观察结果**：说明内容已清空和合法恢复
- **失败、等待与恢复**：无恢复能力不放假Undo。

### 键盘、焦点、触摸与读屏

标题有语义；行动键盘/触摸可达；不自动聚焦；reader空原因与下一步。

### 图形、几何与动效

留白随scope；图仅合法资产且不压正文；不循环摇动装饰。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

零结果但仍有筛选、所有内容无权限、极窄高度、长原因、多种空同时。

不在mount自动创建对象；data scope变化更新reason；不持久错误状态。

### 自有公共合同形状

reason/scope/title/explanation/actionDescriptor/illustrationRef。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.guidecard"></a>
## GuideStep

合同 ID：`ui.spec.guidecard`。来源记录：[GuideCard](../component-catalog.md#ui.family.guidecard)。

### 意图、选择与边界

帮助完成一个具体任务。空 Agent 引导创建；身份恢复步骤；可再次打开。相邻选择：营销介绍不用任务卡；整段流程用 OnboardingFlow。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.guidecard)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

TaskTitle/OneStepInstruction/PrimaryNext/SkipOrDismiss/ProgressContext。

Journey Owner管进度；UI管教学呈现。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- entry=first-use/contextual/resume；默认 contextual。
- dismiss=allowed/required-step；默认 allowed；required不能伪可跳过。
- progress=local-guidance/business；默认 local不冒充业务完成。

禁止：点击开始即completed、不能再次打开、强制教学挡已会用户、孤立引导无目标。

### 状态转换与可执行恢复

offered→started→waiting→completed/needs-action；dismiss只是引导偏好；事实完成由journey owner。

### 具体使用场景

<a id="ui.spec.guidecard.case.01"></a>
#### 创建Agent

- **选择**：first-use
- **触发与可观察结果**：说明一步可操作创建
- **失败、等待与恢复**：失败保留实际创建状态。

<a id="ui.spec.guidecard.case.02"></a>
#### 身份恢复

- **选择**：required-step
- **触发与可观察结果**：展示下一项必要动作
- **失败、等待与恢复**：不能用skip绕安全验证。

<a id="ui.spec.guidecard.case.03"></a>
#### 重新打开

- **选择**：resume
- **触发与可观察结果**：从帮助入口回到真实未完成步
- **失败、等待与恢复**：不重置已做步骤。

<a id="ui.spec.guidecard.case.04"></a>
#### 关闭提示

- **选择**：allowed
- **触发与可观察结果**：隐藏教学卡继续任务
- **失败、等待与恢复**：不取消后台业务。

### 键盘、焦点、触摸与读屏

步骤和按钮可键盘/触摸；不自动抢当前操作焦点；reader当前任务与可跳过政策。

### 图形、几何与动效

Card reading/action轨道，内容不超过任务所需；normal出现，无自动轮播。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

已完成任务、断线中途、重复显示、长说明、用户关闭后再开。

偏好按账号持久；guide不管理业务session；进度恢复消费owner。

### 自有公共合同形状

guideId/entry/taskState/instruction/nextAction/dismissPolicy/reopenDestination。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.progress"></a>
## Progress

合同 ID：`ui.spec.progress`。来源记录：[Progress](../component-catalog.md#ui.family.progress)。

### 意图、选择与边界

可量化工作的进度。附件已传字节/总字节；分阶段导出；无总量用 indeterminate。相邻选择：无法测量不要显示假百分比；短等待用 BusyIndicator。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.progress)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Label/Value/Track/Phase/optionalCancel；数值与取消分别归owner。

Task/Resource Owner管度量；UI管进度投影。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- measurement=determinate/indeterminate；默认 indeterminate。
- shape=linear/circular；默认 linear，circular适用紧凑状态。
- unit=bytes/items/phase；必须供真实单位。

禁止：按时间假增长、100%=已写盘、unknown显示0%、取消请求立即completed。

### 状态转换与可执行恢复

pending随loaded/total变化→completed/failed/cancel-requested；total变化重算并说明；不能用视觉计时补进度。

### 具体使用场景

<a id="ui.spec.progress.case.01"></a>
#### 附件上传

- **选择**：bytes known
- **触发与可观察结果**：显示已传字节/总量
- **失败、等待与恢复**：中断留真实已传量与续传入口。

<a id="ui.spec.progress.case.02"></a>
#### 导出准备

- **选择**：unknown
- **触发与可观察结果**：显示正在准备
- **失败、等待与恢复**：无总量不造百分比。

<a id="ui.spec.progress.case.03"></a>
#### 批量导入

- **选择**：items
- **触发与可观察结果**：显示成功/失败/总项
- **失败、等待与恢复**：混合失败不写全部完成。

<a id="ui.spec.progress.case.04"></a>
#### 分阶段任务

- **选择**：phase
- **触发与可观察结果**：解释当前阶段和后续
- **失败、等待与恢复**：阶段变化不能跳过错误。

### 键盘、焦点、触摸与读屏

progressbar min/max/value或aria-valuetext；更新节流；触摸取消独立按钮；不可量化读正在准备。

### 图形、几何与动效

known值normal插值，文字保持实际；unknown reduced静态文本；0/100视觉不冒业务终态。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

0total、total未知/变化、loaded>total异常、多阶段、停滞。

数据订阅owner；presentation animation清理；unmount不终止transfer。

### 自有公共合同形状

taskId/measurement/loaded/total/unit/phase/terminalState/cancelAction。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.result"></a>
## ResultState

合同 ID：`ui.spec.result`。来源记录：[Result](../component-catalog.md#ui.family.result)。

### 意图、选择与边界

完整任务的结果或整面阻断。设备绑定完成、权限阻断、不可恢复错误。相邻选择：局部消息用 InlineAlert；无内容用 EmptyState。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.result)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

OutcomeTitle/Explanation/AffectedSummary/NextAction/optionalDetails。

Task/Policy Owner管终态；UI管整面结果。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- outcome=success/partial/blocked/failed；必选。
- scope=task/page；默认 task。
- continuation=next/retry/return；按可执行事实选择。

禁止：请求发出当成功、整页错误无返回、partial只绿勾、点击继续再执行同命令。

### 状态转换与可执行恢复

真实terminal或整面block才显示；retry进入新recovering；partial逐项说明，不自动归success。

### 具体使用场景

<a id="ui.spec.result.case.01"></a>
#### 设备绑定完成

- **选择**：success
- **触发与可观察结果**：显示已确认设备和下一步
- **失败、等待与恢复**：仍待手机批准不能用此态。

<a id="ui.spec.result.case.02"></a>
#### 部分导入

- **选择**：partial
- **触发与可观察结果**：列成功与失败项
- **失败、等待与恢复**：重试仅失败项。

<a id="ui.spec.result.case.03"></a>
#### 权限阻断

- **选择**：blocked
- **触发与可观察结果**：说明受限任务与申请路径
- **失败、等待与恢复**：不暴露敏感内部错误。

<a id="ui.spec.result.case.04"></a>
#### 不可恢复任务

- **选择**：failed
- **触发与可观察结果**：提供返回和保留输出
- **失败、等待与恢复**：无合法retry不放重试。

### 键盘、焦点、触摸与读屏

任务切面焦点至标题；动作键盘/触摸；reader真实结果和未完成部分；不强制抢背景页。

### 图形、几何与动效

简洁结果面与PageHeader轨道；success不放庆祝循环；normal进出。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

长对象列表、部分成功、远端陈旧结果、无恢复路径。

result由task owner持久；重复mount不重发命令；return恢复来源。

### 自有公共合同形状

outcome/taskId/confirmedSummary/remainingItems/nextActions/detailsRef。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.skeleton"></a>
## Skeleton

合同 ID：`ui.spec.skeleton`。来源记录：[Skeleton](../component-catalog.md#ui.family.skeleton)。

### 意图、选择与边界

已知结构加载期间的占位。头像+文本行；首屏卡；局部内容渐进。相邻选择：未知结构短等用 BusyIndicator；失败不能无限骨架。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.skeleton)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

ShapeSlots/LoadingLabel；结构来自预期内容不是伪造数据。

Query Owner管pending；UI管占位结构。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- scope=row/card/panel；默认 row。
- layout=known/unknown；默认 known，unknown改BusyIndicator。
- motion=shimmer/static；默认遵循MotionPolicy。

禁止：失败无限占位、伪标题可点击、已有内容刷新全清、假人像当头像。

### 状态转换与可执行恢复

真正pending→Skeleton→content/empty/error；失败停止占位；已有数据刷新保留内容。

### 具体使用场景

<a id="ui.spec.skeleton.case.01"></a>
#### 联系人首屏

- **选择**：row
- **触发与可观察结果**：已知头像+文字结构加载
- **失败、等待与恢复**：失败转Recovery而非永久占位。

<a id="ui.spec.skeleton.case.02"></a>
#### 资源卡

- **选择**：card
- **触发与可观察结果**：加载尺寸与最终卡接近
- **失败、等待与恢复**：空列表转EmptyState。

<a id="ui.spec.skeleton.case.03"></a>
#### 局部刷新

- **选择**：retain content
- **触发与可观察结果**：旧内容留住并标刷新
- **失败、等待与恢复**：不闪整面Skeleton。

<a id="ui.spec.skeleton.case.04"></a>
#### 减弱运动

- **选择**：static
- **触发与可观察结果**：静态shape和加载文字
- **失败、等待与恢复**：状态仍可理解。

### 键盘、焦点、触摸与读屏

占位不进Tab，reader隐藏shape并一次宣布加载；触摸不放伪可点按钮。

### 图形、几何与动效

尺寸与实际结构对齐减跳动；reduced无shimmer；不能替头像放真实人像占位。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

慢请求、超时、0结果、长内容、200%文本改变行高。

animation停在unmount/failed；pending owner有预算；Skeleton不自行fetch。

### 自有公共合同形状

layoutDescriptor/loadingLabel/loadingState/motionPolicy。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.spin"></a>
## BusyIndicator

合同 ID：`ui.spec.spin`。来源记录：[Spin](../component-catalog.md#ui.family.spin)。

### 意图、选择与边界

无法量化的短等待。局部操作 pending；首次连接。相邻选择：可测进度用 Progress；加载结构用 Skeleton。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.spin)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

BusyGlyph/BusyLabel/optionalElapsedOrNext；不量化等待。

Execution Owner管预算和状态；UI管busy呈现。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- scope=action/region；默认 action。
- presentation=glyph+label/label；默认 glyph+label。
- wait=short/needs-next-step；默认 short，超预算提供恢复。

禁止：spinner当百分比、永久busy无下一步、动效停=任务停、隐藏全部可取消操作。

### 状态转换与可执行恢复

真实pending→completed/failed；取消是独立intent；长等待按owner预算转可行动状态。

### 具体使用场景

<a id="ui.spec.spin.case.01"></a>
#### 短保存

- **选择**：action
- **触发与可观察结果**：显示正在保存直到确认
- **失败、等待与恢复**：失败回可重试且留draft。

<a id="ui.spec.spin.case.02"></a>
#### 首次连接

- **选择**：region
- **触发与可观察结果**：显示正在连接与真实阶段
- **失败、等待与恢复**：超预算提供连接恢复。

<a id="ui.spec.spin.case.03"></a>
#### 后台工作

- **选择**：label
- **触发与可观察结果**：解释任务后台继续
- **失败、等待与恢复**：页面卸载不取消任务。

<a id="ui.spec.spin.case.04"></a>
#### reduced motion

- **选择**：static
- **触发与可观察结果**：文字说明等待
- **失败、等待与恢复**：不依赖旋转传递pending。

### 键盘、焦点、触摸与读屏

aria-busy区域和具名文字；不每帧播报；取消按钮键盘触摸；reduced以静态glyph+label。

### 图形、几何与动效

glyph尺寸与action不变；linear转动仅normal motion；控件宽度固定。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

瞬间成功、超慢、断线、后台任务与多个busy区域。

清理animation；计时读owner起始不是本地伪超时；不建自己的retry循环。

### 自有公共合同形状

pendingView/label/scope/motionPolicy/nextActions。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.tag"></a>
## StatusTag / FilterChip

合同 ID：`ui.spec.tag`。来源记录：[Tag](../component-catalog.md#ui.family.tag)。

### 意图、选择与边界

描述状态或可操作筛选条件。status 用静态 Tag；筛选选中用 FilterChip；可关闭标签。相邻选择：计数用 Badge；不能让所有 tag 都像按钮。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.tag)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

StaticLabel/optionalIcon，FilterChip另有Selected/Remove/Toggle。

Status/Filter Owner管值；UI管角色与动作。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- purpose=status/filter/removable-value；必选。
- tone=neutral/info/warning/danger/success；默认 neutral依据事实。
- interaction=none/toggle/remove；按purpose，禁止万能onClick。

禁止：status看着可点无handler、静态tag aria-pressed、remove清全筛选、未知显示success。

### 状态转换与可执行恢复

status随投影；filter选中改查询draft；remove执行合法移除，pending与已删除分开。

### 具体使用场景

<a id="ui.spec.tag.case.01"></a>
#### 任务状态

- **选择**：status
- **触发与可观察结果**：文字显示等待批准
- **失败、等待与恢复**：不使用绿色冒完成。

<a id="ui.spec.tag.case.02"></a>
#### 筛选条件

- **选择**：filter
- **触发与可观察结果**：切换选中更新查询
- **失败、等待与恢复**：失败标数据归属而非清条件。

<a id="ui.spec.tag.case.03"></a>
#### 成员标签

- **选择**：removable-value
- **触发与可观察结果**：移除某一memberId
- **失败、等待与恢复**：权限锁定有原因。

<a id="ui.spec.tag.case.04"></a>
#### 只读类别

- **选择**：none
- **触发与可观察结果**：阅读分类无操作
- **失败、等待与恢复**：不进入无意义Tab。

### 键盘、焦点、触摸与读屏

静态不Tab；filter pressed或checkbox语义；remove具名；触摸删除区不重叠；reader状态文字。

### 图形、几何与动效

圆角token，selected不只色；remove与label同轨；fast状态变化。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

超长标签、百个chips、0条件、未知status、不可删除项。

查询/值集归owner；组件不推断danger；无timer持久状态。

### 自有公共合同形状

purpose/valueId/label/tone/selected/removalView/onToggle/onRemove。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.toast"></a>
## Toast / ToastHost

合同 ID：`ui.spec.toast`。来源记录：[Toast](../component-catalog.md#ui.family.toast)。

### 意图、选择与边界

不需决策的短暂反馈。复制成功、保存已完成；undo 仅在真实可撤销时。相邻选择：需处理的错误用 InlineAlert/RecoveryState；批准不用 toast。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.toast)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Message/Severity/optionalUndo/Dismiss；ToastHost同window有序队列。

UI Owner管Host/队列；Domain Owner管反馈事实和undo。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- importance=transient/persistent；默认 transient；需决策转Alert/Permission。
- action=none/undo；默认 none，undo需真实期限。
- dedupe=message-scope；默认同对象同意图合并。

禁止：重要失败仅短暂toast、秒数是假undo、不同window共用错host、关闭即业务取消。

### 状态转换与可执行恢复

enqueue→visible→dismissed；dismiss不改业务事实；undo→pending→confirmed/failed，过期移除动作。

### 具体使用场景

<a id="ui.spec.toast.case.01"></a>
#### 复制成功

- **选择**：transient
- **触发与可观察结果**：Clipboard确认后短提示
- **失败、等待与恢复**：拒绝显示失败与替代。

<a id="ui.spec.toast.case.02"></a>
#### 保存完成

- **选择**：transient
- **触发与可观察结果**：真实保存成功才显示
- **失败、等待与恢复**：原表单仍可回读。

<a id="ui.spec.toast.case.03"></a>
#### 撤销移除

- **选择**：undo
- **触发与可观察结果**：期限内提交补偿
- **失败、等待与恢复**：期限到关闭动作而非继续可点。

<a id="ui.spec.toast.case.04"></a>
#### 重复反馈

- **选择**：dedupe
- **触发与可观察结果**：同意图结果只出现一次
- **失败、等待与恢复**：保留重要错误详情路径。

### 键盘、焦点、触摸与读屏

polite为默认，紧急错误按importance；hover/focus停自动消失；触摸可关闭；不抢焦点。

### 图形、几何与动效

同一锚定host，normal进出；timer独立于motion；多条有界而非叠满。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

长文、重复结果、屏幕键盘、后台窗口、undo超时和toast多语言。

host队列/timer清理；业务结果留在原任务，不只toast；切账号清跨身份队列。

### 自有公共合同形状

messageId/scope/message/importance/dedupeKey/undoDescriptor/expiry。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

