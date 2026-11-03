# 动作与命令 · 逐项合同

> DRAFT。所有自有实现 NOT_IMPLEMENTED，打样 NOT_BUILT；本章定义目标行为，不证明现有产品符合。

[总入口与共用政策](./README.md) · [源码全集](../component-catalog.md)

- [Button / SplitButton](#ui.spec.button)
- [IconButton](#ui.spec.actionicon)
- [ActionGroup](#ui.spec.actionicongroup)
- [CopyAction](#ui.spec.copybutton)
- [DownloadAction](#ui.spec.downloadbutton)
- [ConfirmAction](#ui.spec.confirmaction)
- [OverflowToolbar](#ui.spec.overflowtoolbar)

<a id="ui.spec.button"></a>
## Button / SplitButton

合同 ID：`ui.spec.button`。来源记录：[Button](../component-catalog.md#ui.family.button)。另有 [Button B01–B20 深度场景](../button-spec.md)，与本合同一起读取。

### 意图、选择与边界

发出一次明确意图。保存/发送/停止/取消/删除/重试/复制/批准各用独立场景；emphasis、tone、density 正交。相邻选择：导航用 Link；持久选择用 ToggleButton；详见 button-spec.md。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.button)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Label/Icon/ExecutionSlot 与唯一 control contour；SplitButton 的 Main/Menu 是两个具名触发区。

UI Owner 管激活和外观；Form、Messaging、Agent 与 Domain runtime 各自管校验、幂等和终态。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- emphasis=primary/secondary/quiet/inline；默认 secondary；主要承诺用 primary。
- behavior=action/submit/reset；默认 action；提交、恢复初值显式。
- tone=neutral/danger；默认 neutral；按实际影响选 danger。
- execution=idle/pending/succeeded/failed/recovering；默认 idle，消费外部投影。

禁止：href 与 action 混合、pressed 持久值、多个无关 primary、未具名 icon、pending 隐藏取消；完整反例见 B01–B20。

### 状态转换与可执行恢复

activate→pending→owner 确认 succeeded 或 failed；失败保留对象；retry 绑定业务恢复意图；stop 请求与 stopped 终态分开。详见 B01–B20。

### 具体使用场景

<a id="ui.spec.button.case.01"></a>
#### 保存配置

- **选择**：primary+submit
- **触发与可观察结果**：提交 dirty 字段，owner 确认后显示已保存
- **失败、等待与恢复**：校验定位字段；写入失败保留草稿。

<a id="ui.spec.button.case.02"></a>
#### 停止输出

- **选择**：secondary+action
- **触发与可观察结果**：running 发 stop intent，显示 stopping 直到 stopped
- **失败、等待与恢复**：请求失败保留已生成内容并可重试。

<a id="ui.spec.button.case.03"></a>
#### 删除选中对象

- **选择**：danger+具名范围
- **触发与可观察结果**：冻结所选对象并确认，成功逐项回读
- **失败、等待与恢复**：混合失败保留未删除项，不重删成功项。

<a id="ui.spec.button.case.04"></a>
#### 替代发送方式

- **选择**：SplitButton
- **触发与可观察结果**：主区直接发送；菜单区选择定时发送
- **失败、等待与恢复**：不可用变体显示原因；打开菜单不触发发送。

### 键盘、焦点、触摸与读屏

Enter/Space 激活；IME 未结束不提交；单一焦点轮廓；触摸命中区不重叠；读屏具名动作和真实 pending。Split 菜单关闭返回菜单 trigger。

### 图形、几何与动效

24/28/30/32/34/36/40 既有视觉尺度按角色使用；圆角方形；fast 颜色反馈，pending 不换宽。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

超长本地化标签、批量对象数、零可提交内容、别端已处理与200%文本。

清理自身反馈 timer；卸载不冒充取消业务；identity 变化拒绝旧对象回调。

### 自有公共合同形状

actionId/label/behavior/emphasis/tone/density/availability/execution/onActivate；Split 另有 defaultActionId/alternatives。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.actionicon"></a>
## IconButton

合同 ID：`ui.spec.actionicon`。来源记录：[ActionIcon](../component-catalog.md#ui.family.actionicon)。

### 意图、选择与边界

紧凑工具操作。消息复制、行尾更多、头部搜索；高风险删除需可见名称或确认；常用动作可加 Tooltip。相邻选择：主要承诺用文本 Button；持久开关用 ToggleButton。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.actionicon)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Glyph/optionalHint/ExecutionSlot；IconButton 自身拥有 label、边界与焦点。

UI Owner 管具名激活；对象 action owner 执行命令。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- density=inline/header；默认 inline；头部工具用 header。
- intent=command/menu-trigger；默认 command；触发菜单不同时执行命令。
- emphasis=quiet/secondary；默认 quiet；频繁关键承诺用文本 Button。

禁止：没有label、用选中背景冒充Toggle、仅hover可用、glyph点击与父行导航双触发。

### 状态转换与可执行恢复

idle→pressed→pending→结果；menu-trigger 则 closed→open→closed；禁用原因不只在 Tooltip。

### 具体使用场景

<a id="ui.spec.actionicon.case.01"></a>
#### 复制消息

- **选择**：inline quiet
- **触发与可观察结果**：激活复制当前消息并显示已复制
- **失败、等待与恢复**：Clipboard拒绝提供手动选择。

<a id="ui.spec.actionicon.case.02"></a>
#### 头部搜索

- **选择**：header quiet
- **触发与可观察结果**：打开具名搜索面，键盘进入输入
- **失败、等待与恢复**：面板关闭恢复入口；加载失败不跳空页。

<a id="ui.spec.actionicon.case.03"></a>
#### 行尾更多

- **选择**：inline menu-trigger
- **触发与可观察结果**：打开该行命令菜单
- **失败、等待与恢复**：对象被删时关闭并回到列表安全位置。

<a id="ui.spec.actionicon.case.04"></a>
#### 危险操作

- **选择**：secondary+danger语义
- **触发与可观察结果**：进入具名确认面
- **失败、等待与恢复**：不能仅凭红色垃圾桶表达影响范围。

### 键盘、焦点、触摸与读屏

Enter/Space 激活；菜单 ArrowDown 打开；触摸有可见入口；读屏 label 指定对象；glyph aria-hidden。

### 图形、几何与动效

glyph16/18/20 按密度；外框24/36按角色，独立44目标提案；不采用圆形按钮；fast颜色变化。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

多个同行图标、长动作名称、触摸放大和无鼠标场景；仅 Tooltip 不算触摸说明。

反馈 timer与menu anchor卸载释放；虚拟行复用后 label与命令对象必须同时更新。

### 自有公共合同形状

iconId/label/actionId/density/execution/availability/onActivate/optionalMenuId。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.actionicongroup"></a>
## ActionGroup

合同 ID：`ui.spec.actionicongroup`。来源记录：[ActionIconGroup](../component-catalog.md#ui.family.actionicongroup)。

### 意图、选择与边界

同一对象的相关操作集合。消息复制/编辑/更多；工具栏按频率排序；窄屏转 OverflowToolbar。相邻选择：互斥值用 Segmented；多选工具用 ToggleGroup。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.actionicongroup)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

GroupLabel/ActionSlots/OverflowTrigger；子动作有各自命令与状态，组不是大按钮。

UI Owner 管组和溢出；Domain Owner 供竞争关系。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- layout=inline/toolbar；默认 inline；多项键盘工具用 toolbar。
- overflow=wrap/menu；默认 wrap，空间不足按优先级进入 menu。
- ordering=semantic-priority；默认按任务频率，禁止按图标宽度重排。

禁止：整个组onClick、不同对象动作混组、busy一项锁所有不相关动作、复制两套命令定义。

### 状态转换与可执行恢复

每项 pending 独立；同对象竞争动作由owner锁定；溢出迁移不丢菜单或焦点。

### 具体使用场景

<a id="ui.spec.actionicongroup.case.01"></a>
#### 消息工具

- **选择**：inline
- **触发与可观察结果**：显示复制/编辑/更多，各自指向同条消息
- **失败、等待与恢复**：发送中编辑不可用但复制可用。

<a id="ui.spec.actionicongroup.case.02"></a>
#### 编辑工具栏

- **选择**：toolbar
- **触发与可观察结果**：箭头在具名工具间移动
- **失败、等待与恢复**：禁用项按统一焦点政策跳过并说明原因。

<a id="ui.spec.actionicongroup.case.03"></a>
#### 窄窗口

- **选择**：menu overflow
- **触发与可观察结果**：低频动作移入更多，高频留在原位
- **失败、等待与恢复**：resize不丢正在执行的动作。

<a id="ui.spec.actionicongroup.case.04"></a>
#### 竞争操作

- **选择**：同对象
- **触发与可观察结果**：删除pending时冻结冲突编辑
- **失败、等待与恢复**：终态到达再解除，不用全页禁用。

### 键盘、焦点、触摸与读屏

inline顺序Tab；toolbar采用roving箭头/Home/End；触摸可发现所有命令；读屏组名与独立label。

### 图形、几何与动效

同轨高度、相同glyph基线；gap来自spacing；溢出测量不动画抖动。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

一项/零项/几十项、200%标签、窄面板；零项不留空操作轨。

ResizeObserver与快捷键按scope释放；动作进入overflow后保持同actionId。

### 自有公共合同形状

groupLabel/actions/actionPriority/layout/overflowPolicy。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.copybutton"></a>
## CopyAction

合同 ID：`ui.spec.copybutton`。来源记录：[CopyButton](../component-catalog.md#ui.family.copybutton)。

### 意图、选择与边界

复制当前对象的指定内容。消息正文、代码、恢复词分别指定 payload；敏感值默认不外显。相邻选择：文件保存用 DownloadAction。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.copybutton)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

PayloadDescriptor/Trigger/ResultHint；敏感载荷由 SecretValue 授权，不呈现在隐藏DOM。

UI Owner 管反馈；Clipboard adapter 管写入；Credential Owner 管秘密。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- format=plain/code/reference；默认 plain，引用明确包含出处。
- sensitivity=ordinary/secret；默认 ordinary；secret走受限port。
- feedback=inline/toast；默认 inline，避免复制按钮宽度跳变。

禁止：await前显示已复制、复制过期秘密、错误把敏感值写进toast、空载荷伪成功。

### 状态转换与可执行恢复

idle→copying→copied/denied/unavailable；成功以adapter返回为准；失败允许手动选择可公开内容。

### 具体使用场景

<a id="ui.spec.copybutton.case.01"></a>
#### 复制代码

- **选择**：code
- **触发与可观察结果**：复制无行号原文，显示已复制
- **失败、等待与恢复**：权限拒绝提供原文选择。

<a id="ui.spec.copybutton.case.02"></a>
#### 复制引用

- **选择**：reference
- **触发与可观察结果**：复制正文与规范出处
- **失败、等待与恢复**：出处失效显示状态，不造链接。

<a id="ui.spec.copybutton.case.03"></a>
#### 复制恢复词

- **选择**：secret
- **触发与可观察结果**：确认可读取后由port写clipboard
- **失败、等待与恢复**：授权过期重新认证，UI不存明文。

<a id="ui.spec.copybutton.case.04"></a>
#### 复制不可用

- **选择**：ordinary
- **触发与可观察结果**：显示平台不支持及替代路径
- **失败、等待与恢复**：手动选择只针对可公开内容。

### 键盘、焦点、触摸与读屏

Enter/Space复制；不强行覆盖原文字选区；触摸具名入口；polite播报一次结果。

### 图形、几何与动效

用IconButton或文本Button轮廓；success glyph不跳尺寸；fast提示，计时与动效分离。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

空内容、超长代码、无clipboard权限、富文本转纯文本、敏感载荷过期。

取消成功提示timer；payload identity变化清旧结果；不缓存秘密到组件state/日志。

### 自有公共合同形状

payloadId/format/sensitivity/resolvePayload/clipboardPort/resultLabel。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.downloadbutton"></a>
## DownloadAction

合同 ID：`ui.spec.downloadbutton`。来源记录：[DownloadButton](../component-catalog.md#ui.family.downloadbutton)。

### 意图、选择与边界

导出或保存指定资源。附件保存、导出会话、报告下载。相邻选择：复制文本用 CopyAction；打开预览用 PreviewAction。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.downloadbutton)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

ResourceSummary/Trigger/Progress/Cancel/Failure；进度来自资源owner。

Resource/Export Owner 管内容权限、取消与终态；UI只投影。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- mode=save/export；默认 save；生成新文件用 export。
- progress=known/unknown；默认 unknown，已知总量才显示百分比。
- destination=browser/native；由platform能力注入，业务不传OS路径。

禁止：浏览器启动即声称已写盘、重复点击多份export、无限retry、下载URL作为持久资源identity。

### 状态转换与可执行恢复

idle→preparing→transferring→handoff/confirmed-save；取消requested不等于cancelled；失败按准备/传输/保存分层。

### 具体使用场景

<a id="ui.spec.downloadbutton.case.01"></a>
#### 保存附件

- **选择**：save native
- **触发与可观察结果**：选保存位置，port报告已保存
- **失败、等待与恢复**：权限拒绝保留附件并可换位置。

<a id="ui.spec.downloadbutton.case.02"></a>
#### 导出会话

- **选择**：export
- **触发与可观察结果**：准备文件后传输，分别显示阶段
- **失败、等待与恢复**：生成失败保留导出参数。

<a id="ui.spec.downloadbutton.case.03"></a>
#### 大文件

- **选择**：known progress
- **触发与可观察结果**：loaded/total真实更新，可取消
- **失败、等待与恢复**：中断按owner支持续传或重启。

<a id="ui.spec.downloadbutton.case.04"></a>
#### 浏览器下载

- **选择**：browser
- **触发与可观察结果**：明确显示已启动下载
- **失败、等待与恢复**：不能验证写盘时不声称已保存。

### 键盘、焦点、触摸与读屏

具名下载和取消可键盘/触摸；进度节流播报；原入口焦点不因更新丢失。

### 图形、几何与动效

Trigger按Button密度；真实Progress；不可测写盘不画100%完成动画。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

零字节、未知总量、重复文件名、过期URL、磁盘满和无保存权限。

卸载释放受限资源handle；是否后台继续由owner决定；只清任务拥有的临时资源。

### 自有公共合同形状

resourceId/exportIntent/progressView/destinationCapabilities/onSave/onCancel/onRetry。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.confirmaction"></a>
## ConfirmAction

合同 ID：`ui.spec.confirmaction`。来源记录：[ConfirmAction](../component-catalog.md#ui.requirement.confirmaction)。

### 意图、选择与边界

轻量且明确的风险确认。可撤销删除、断开、移除；不可逆改用 ConfirmDialog。相邻选择：普通按钮不强行二次确认。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.confirmaction)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

Trigger/ConsequenceSummary/Confirm/Cancel/optionalUndo；短确认不隐去对象。

Domain Owner 定风险和补偿；UI Owner 管确认交互。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- risk=reversible/irreversible；默认 reversible；不可逆转ConfirmDialog。
- placement=anchored/dialog；默认 anchored；长范围或复杂后果用dialog。
- resolution=pending/confirmed/cancelled/expired；以owner为准。

禁止：超时默认批准、只写确定、不可逆伪Undo、确认与实际目标集合不一致。

### 状态转换与可执行恢复

idle→asking→executing→confirmed/failed；取消asking不提交；撤销有期限且须owner支持。

### 具体使用场景

<a id="ui.spec.confirmaction.case.01"></a>
#### 移除收藏

- **选择**：可撤销anchored
- **触发与可观察结果**：确认移除并出现真实撤销入口
- **失败、等待与恢复**：失败仍保留收藏。

<a id="ui.spec.confirmaction.case.02"></a>
#### 断开设备

- **选择**：后果明确dialog
- **触发与可观察结果**：展示影响设备后确认断开
- **失败、等待与恢复**：远端失败显示未断开。

<a id="ui.spec.confirmaction.case.03"></a>
#### 取消询问

- **选择**：asking
- **触发与可观察结果**：Escape返回原触发器不发命令
- **失败、等待与恢复**：触发器被删时返回安全列表。

<a id="ui.spec.confirmaction.case.04"></a>
#### 撤销移除

- **选择**：有期限undo
- **触发与可观察结果**：期限内提交补偿并回读恢复
- **失败、等待与恢复**：过期隐藏失效动作并说明。

### 键盘、焦点、触摸与读屏

焦点默认落安全选项；Escape取消询问；触摸不靠hover；读屏对象、影响和期限。

### 图形、几何与动效

短浮层用Popover轮廓/normal；Confirm和Cancel同轨；danger依影响不依颜色喜好。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

对象已删除、权限变化、长名称、多对象数量与undo期限归零。

anchor失效关闭询问；提交后关闭不取消命令；undo计时用owner时间。

### 自有公共合同形状

actionId/targetSummary/consequence/reversibility/undoDeadline/onConfirm/onCancel。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

<a id="ui.spec.overflowtoolbar"></a>
## OverflowToolbar

合同 ID：`ui.spec.overflowtoolbar`。来源记录：[OverflowToolbar](../component-catalog.md#ui.requirement.overflowtoolbar)。

### 意图、选择与边界

有限空间中的动作优先级。常用可见，低频收进 Menu；键盘命令相同。相邻选择：单按钮不用工具栏；不能隐藏唯一恢复动作。

来源公共值逐项归属见 [符号处置](../public-symbol-dispositions.md#ui.spec.overflowtoolbar)；Provider、聚合入口和子槽位不是额外的独立控件。

### Anatomy 与状态所有权

VisibleActions/OverflowMenu；唯一actions模型同时驱动两处。

UI Owner 管布局；产品Owner定动作优先级。人员映射：OWNER_UNASSIGNED。

### 正交轴、默认值与非法组合

- priority=required/frequent/secondary；默认 secondary；required先保留。
- layout=inline/toolbar；默认 toolbar。
- overflow=menu；宽度不够搬移低频动作，不缩小命中区。

禁止：通过CSS隐藏仍可聚焦、复制命令回调、把primary不可逆动作无说明藏入溢出。

### 状态转换与可执行恢复

测量→分配→渲染；动作pending仍绑定原intent；菜单打开时重排保持稳定focused actionId。

### 具体使用场景

<a id="ui.spec.overflowtoolbar.case.01"></a>
#### 编辑器窄屏

- **选择**：priority
- **触发与可观察结果**：保存留外部，格式工具进入更多
- **失败、等待与恢复**：保存pending不因迁移再提交。

<a id="ui.spec.overflowtoolbar.case.02"></a>
#### 附件工具

- **选择**：同action模型
- **触发与可观察结果**：打开/保存可见，低频详情溢出
- **失败、等待与恢复**：格式不支持时同理由同步两处。

<a id="ui.spec.overflowtoolbar.case.03"></a>
#### 放大文字

- **选择**：测量重排
- **触发与可观察结果**：标签增长后仍有完整入口
- **失败、等待与恢复**：焦点按actionId恢复。

<a id="ui.spec.overflowtoolbar.case.04"></a>
#### 窗口快速变化

- **选择**：稳定分配
- **触发与可观察结果**：连续resize只更新几何
- **失败、等待与恢复**：已开菜单不闪关闪开。

### 键盘、焦点、触摸与读屏

roving箭头导航；overflow Enter打开；触摸更多可见；读屏菜单和工具栏同一action名称。

### 图形、几何与动效

同轨高度与gap；Resize跟随无弹簧；不得把动作压成不可点细条。 轮廓与时间函数统一引用 [资产/动效提案](../icon-motion-spec.md)；新增数值均待打样确认。

### 极端数据与生命周期

极窄只剩更多、全为required、超长标签、缩放200%、RTL。

释放ResizeObserver；窗口变化不重注册重复命令；unmount关闭所属menu。

### 自有公共合同形状

actions/priorities/minVisibleActions/availableWidth/overflowLabel。这是语义字段提案，不是可导入类型；平台属性在 renderer adapter 中定义，不继承或导出第三方 Props。

### 正例、反例与必要证据

每个上述场景须有自有组件 specimen，驱动完整“触发→等待或变化→结果→失败→恢复”适用分支；观察点按该场景逐条断言。被动组件验证数据变化和阅读结果，不伪造提交状态。

反例至少包括本项所有禁止组合；极端数据使用本项边界，再叠加总入口的主题、文字放大、RTL、输入模式和 reduced-motion 条件。生命周期验证本项资源释放与身份切换，不只验证默认截图。

specimen 当前为 **NOT_BUILT**；规范结构检查不等于视觉、交互、原生或业务 Journey PASS。业务事实与 receiver 侧结果仍需对应业务 Gate。

