# 展开与折叠 · 逐项合同

> DRAFT。所有自有实现 NOT_IMPLEMENTED，打样 NOT_BUILT；本章定义目标行为，不证明现有产品符合。

[总入口与共用政策](./README.md) · [源码全集](../component-catalog.md)

- [Accordion](#ui.spec.accordion)
- [Disclosure](#ui.spec.collapsible)

<a id="ui.spec.accordion"></a>
## Accordion

合同 ID：`ui.spec.accordion`。来源记录：[Accordion](../component-catalog.md#ui.family.accordion)。

### 意图、选择与边界

组织多段可独立展开的信息。设置帮助用单开或多开；长详情默认展开关键段；FAQ 按标题检索。相邻选择：一个局部区域用 Disclosure；平级页面用 Tabs。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.accordion)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Root/Item/Header/Trigger/Panel；标题与trigger关系明确，header辅助动作独立。

UI Owner管展开；Page/Domain Owner管panel内容与alive。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- expansion=single/multiple；默认 single，独立帮助段可multiple。
- initial=important-open/all-closed；默认 important-open。
- mount=preserve/conditional；默认 preserve仅按PageHost允许隐藏。

禁止：header整体button里嵌button、collapsed可Tab、collapse清dirty、multi却只保一个值。

### 状态转换与可执行恢复

collapsed→expanded；lazy panel另有loading/error/retry；收起不表示业务任务停止；非法展开ID忽略并可诊断。

### 具体使用场景

<a id="ui.spec.accordion.case.01"></a>
#### 设置帮助

- **选择**：single
- **触发与可观察结果**：展开一段并收前段
- **失败、等待与恢复**：关键错误不藏在收起段。

<a id="ui.spec.accordion.case.02"></a>
#### 多组详情

- **选择**：multiple
- **触发与可观察结果**：各段独立开合
- **失败、等待与恢复**：不因第二段展开清第一段输入。

<a id="ui.spec.accordion.case.03"></a>
#### 加载详情

- **选择**：lazy
- **触发与可观察结果**：展开后显示该段等待
- **失败、等待与恢复**：失败原位重试。

<a id="ui.spec.accordion.case.04"></a>
#### 长FAQ

- **选择**：important-open
- **触发与可观察结果**：关键内容默认可见
- **失败、等待与恢复**：200%字不裁panel。

### 键盘、焦点、触摸与读屏

Enter/Space展开；可选header箭头/Home/End定位；隐藏内容inert；触摸header目标；reader heading与expanded。

### 图形、几何与动效

所有header共享indicator/title/action轨；panel normal开合；reduced即时；不固定高度裁内容。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

0项、超长标题、嵌套、panel有表单、lazy失败与200%字。

展开值按stableID；收起时焦点若在panel移回trigger；observer/动画清理；draft归owner。

### 自有公共合同形状

items/expandedIds/expansionMode/initialPolicy/mountPolicy/onExpandedChange。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.collapsible"></a>
## Disclosure

合同 ID：`ui.spec.collapsible`。来源记录：[Collapsible](../component-catalog.md#ui.family.collapsible)。

### 意图、选择与边界

展开单个补充区域。消息推理详情、附件元数据、过滤高级条件。相邻选择：多节并列用 Accordion；阻断决策用 Dialog。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.collapsible)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

DisclosureTrigger/SinglePanel/optionalSummary；只一个补充区域。

UI Owner管Disclosure；内容owner管状态。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- purpose=details/advanced-controls；默认 details。
- initial=open/closed；默认 closed，关键任务不得隐藏。
- content=passive/interactive；默认 passive，interactive有焦点与draft政策。

禁止：关键错误默认藏、hover才展开、收起取消任务、无label chevron。

### 状态转换与可执行恢复

closed↔open；内部loading独立；收起不吞失败与正在审批状态。

### 具体使用场景

<a id="ui.spec.collapsible.case.01"></a>
#### 推理详情

- **选择**：details
- **触发与可观察结果**：按需展开可读过程
- **失败、等待与恢复**：流式断开保留内容。

<a id="ui.spec.collapsible.case.02"></a>
#### 附件属性

- **选择**：passive
- **触发与可观察结果**：展开MIME/大小
- **失败、等待与恢复**：未知值明确未知。

<a id="ui.spec.collapsible.case.03"></a>
#### 高级筛选

- **选择**：interactive
- **触发与可观察结果**：展开高级字段
- **失败、等待与恢复**：收起保留draft。

<a id="ui.spec.collapsible.case.04"></a>
#### 收起焦点

- **选择**：open interactive
- **触发与可观察结果**：收起先回trigger
- **失败、等待与恢复**：不把焦点遗留hidden。

### 键盘、焦点、触摸与读屏

Enter/Space；aria-expanded/controls；panel隐藏退出Tab；触摸trigger；关闭时子焦点回trigger。

### 图形、几何与动效

chevron自有glyph与title同轨；normal高度变化，reduced即时；不整条message缩放。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

空panel、长日志、嵌套、未保存输入和流式增高。

展开偏好可由Page持有；component清observer；不unmount仍running业务。

### 自有公共合同形状

label/open/onOpenChange/contentPurpose/mountPolicy。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

